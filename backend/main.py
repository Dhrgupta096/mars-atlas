"""Run: uvicorn main:app --reload --port 8000"""
from collections import defaultdict, deque
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import ssl
import time as _time
from urllib.request import Request, urlopen
from fastapi import FastAPI, HTTPException, Query, Request as FastAPIRequest, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from mars_time import mars_time
from terrain import elevation, slope, risk, render_mola_tile, render_mola_heightmap, ai_slope_analysis
from geochem import geochem_at, ELEMENTS
from route import straight_line, safest_path, science_path, eva_plan, slope_hazards, chain_legs
from rovers import ROVERS
from water import water_sites, water_at

app = FastAPI(title="Mars Map API")
_CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "tile_cache"
_LAYER_RE = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")

# Strict CORS: allow local dev, GitHub Pages, and Vercel deployments
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://dhrgupta096.github.io",
    ],
    allow_origin_regex=r"^https://[a-zA-Z0-9-]+\.vercel\.app$",
    allow_methods=["GET"],
    allow_headers=["*"],
)

# Sliding-window rate limiter & security headers (pure stdlib, no external deps)
# ponytail: in-memory per-IP buckets; replace with Redis/Cloudflare WAF for multi-worker prod
_RATE_BUCKETS: dict[tuple[str, str], deque[float]] = defaultdict(deque)


@app.middleware("http")
async def security_firewall_middleware(request: FastAPIRequest, call_next):
    path = request.url.path
    if path.startswith("/api/"):
        ip = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip() or (
            request.client.host if request.client else "unknown"
        )
        if path.startswith("/api/route"):
            bucket_key, limit = (ip, "route"), 30
        elif path.startswith(("/api/tiles/", "/api/heightmap/", "/api/trek/")):
            bucket_key, limit = (ip, "tiles"), 600
        else:
            bucket_key, limit = (ip, "api"), 180

        now = _time.monotonic()
        q = _RATE_BUCKETS[bucket_key]
        while q and now - q[0] > 60.0:
            q.popleft()
        if len(q) >= limit:
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Slow down requests."},
                headers={"Retry-After": "60"},
            )
        q.append(now)

    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return response

# (name, lat, lon east-positive, kind)
# ponytail: hand-picked list; replace with full USGS Gazetteer (~2k features) via a data script on day 5
PLACES = [
    ("Olympus Mons", 18.65, -133.8, "volcano"), ("Valles Marineris", -13.9, -59.2, "canyon"),
    ("Hellas Planitia", -42.4, 70.5, "basin"), ("Utopia Planitia", 46.7, 117.5, "plain"),
    ("Arsia Mons", -8.26, -120.09, "volcano"), ("Elysium Mons", 25.02, 147.21, "volcano"),
    ("Jezero Crater", 18.38, 77.58, "crater"), ("Gale Crater", -5.4, 137.8, "crater"),
    ("Planum Boreum", 87.0, 0.0, "ice"), ("Planum Australe", -87.0, 0.0, "ice"),
    ("Perseverance", 18.44, 77.45, "rover"), ("Curiosity", -4.59, 137.44, "rover"),
    ("Opportunity", -1.95, -5.53, "rover"), ("Spirit", -14.57, 175.47, "rover"),
    ("Zhurong", 25.07, 109.93, "rover"), ("Sojourner", 19.13, -33.22, "rover"),
    ("InSight", 4.5, 135.62, "lander"), ("Phoenix", 68.22, -125.75, "lander"),
    ("Viking 1", 22.27, -47.95, "lander"), ("Viking 2", 47.67, -134.29, "lander"),
]


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/time")
def time(lon: float = Query(0.0, ge=-180, le=180), lat: float = Query(0.0, ge=-90, le=90),
         utc: str | None = Query(None)):
    when = datetime.fromisoformat(utc.replace("Z", "+00:00")) if utc else None
    if when and when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return mars_time(when=when, lon=lon, lat=lat)


@app.get("/api/places")
def places():
    return [dict(name=n, lat=la, lon=lo, kind=k) for n, la, lo, k in PLACES]


@app.get("/api/terrain")
def terrain(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=360)):
    ai = ai_slope_analysis(lat, lon)
    return {"lat": lat, "lon": lon, "elevation_m": elevation(lat, lon), "slope_deg": ai["slope_deg"],
            "risk": risk(ai["slope_deg"]), "ai_slope": ai, "water": water_at(lat, lon),
            "geochem": geochem_at(lat, lon), "source": "MGS MOLA MEGDR 32 px/deg"}


@app.get("/api/geochem")
def geochem(lat: float = Query(0.0, ge=-90, le=90), lon: float = Query(0.0, ge=-180, le=360)):
    return {"point": geochem_at(lat, lon), "catalog": ELEMENTS}


@app.get("/api/route")
def route(lat1: float = Query(0.0, ge=-90, le=90), lon1: float = Query(0.0, ge=-180, le=360),
          lat2: float = Query(0.0, ge=-90, le=90), lon2: float = Query(0.0, ge=-180, le=360),
          pts: str | None = Query(None)):
    if pts:
        try:
            waypoints = []
            for p in pts.split(";")[:6]:
                if "," not in p:
                    continue
                la, lo = (float(v) for v in p.split(",", 1))
                if not (-90.0 <= la <= 90.0 and -180.0 <= lo <= 360.0):
                    raise ValueError("Out of bounds")
                waypoints.append((la, lo))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid waypoints in 'pts'")
        if len(waypoints) < 2:
            raise HTTPException(status_code=400, detail="At least 2 valid waypoints required")
    else:
        waypoints = [(lat1, lon1), (lat2, lon2)]
    direct = chain_legs(straight_line, waypoints)
    safe = chain_legs(safest_path, waypoints)
    science = chain_legs(science_path, waypoints)
    return {"direct": direct, "safe": safe, "science": science, "plan": eva_plan(direct, safe, science),
            "hazards": slope_hazards(waypoints[0][0], waypoints[0][1], waypoints[-1][0], waypoints[-1][1]),
            "water": water_at(waypoints[-1][0], waypoints[-1][1]),
            "geochem": geochem_at(waypoints[-1][0], waypoints[-1][1])}


@app.get("/api/rovers")
def rovers():
    return ROVERS


_ROVER_IMG_CACHE: dict = {}


@app.get("/api/rover-images/{rover_name}")
def rover_images(rover_name: str):
    """Live raw surface imagery from NASA JPL Mars 2020 / MSL API."""
    name = rover_name.lower().strip()
    cat = "mars2020" if "perseverance" in name or "m20" in name else "msl"
    now_ts = _time.time()
    cached = _ROVER_IMG_CACHE.get(cat)
    if cached and (now_ts - cached["ts"] < 1800):
        return cached["data"]

    url = f"https://mars.nasa.gov/rss/api/?feed=raw_images&feedtype=json&category={cat}&num=10&order=sol+desc"
    try:
        ctx = ssl._create_unverified_context()
        req = Request(url, headers={"User-Agent": "Mozilla/5.0 MarsAtlas/1.0"})
        with urlopen(req, context=ctx, timeout=6) as resp:
            raw = json.loads(resp.read().decode())
            imgs = []
            for item in raw.get("images", []):
                files = item.get("image_files") or {}
                img_url = files.get("medium") or files.get("small") or files.get("full_res") or item.get("url")
                if not img_url:
                    continue
                cam = item.get("camera") or {}
                inst = cam.get("instrument") or item.get("title") or "Navigation Camera"
                imgs.append({
                    "sol": item.get("sol"),
                    "title": item.get("title") or f"{cat.upper()} Sol {item.get('sol')}",
                    "instrument": inst,
                    "date_utc": item.get("date_taken_utc") or item.get("date_received"),
                    "image": img_url,
                    "caption": item.get("caption") or f"Raw surface telemetry from {inst} on Sol {item.get('sol')}",
                })
            if imgs:
                result = {"rover": cat, "count": len(imgs), "sol": imgs[0]["sol"], "images": imgs}
                _ROVER_IMG_CACHE[cat] = {"ts": now_ts, "data": result}
                return result
    except Exception:
        pass

    return cached["data"] if cached else {"rover": cat, "count": 0, "images": []}


@app.get("/api/water")
def water():
    return water_sites()


@app.get("/api/tiles/{mode}/{z}/{y}/{x}.png")
def tile(mode: str, z: int, y: int, x: int):
    return Response(
        content=render_mola_tile(mode, max(0, min(z, 10)), y, x),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/api/heightmap/{z}/{y}/{x}.bin")
def heightmap(z: int, y: int, x: int):
    return Response(
        content=render_mola_heightmap(max(0, min(z, 8)), y, x),
        media_type="application/octet-stream",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/api/trek/{layer}/{z}/{y}/{x}.jpg")
def trek_tile(layer: str, z: int, y: int, x: int):
    if not _LAYER_RE.fullmatch(layer) or ".." in layer:
        raise HTTPException(status_code=400, detail="Invalid layer name")
    z = max(0, min(z, 7))
    y = max(0, min(y, 1 << z))
    x = max(0, min(x, 2 << z))
    cache_root = _CACHE_DIR.resolve()
    cache_file = (cache_root / layer / str(z) / str(y) / f"{x}.jpg").resolve()
    if not cache_file.is_relative_to(cache_root):
        raise HTTPException(status_code=400, detail="Invalid tile path")
    if cache_file.is_file():
        return Response(
            content=cache_file.read_bytes(),
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=604800"},
        )
    url = f"https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/{z}/{y}/{x}.jpg"
    try:
        req = Request(url, headers={"User-Agent": "MarsAtlas/1.0"})
        with urlopen(req, timeout=8) as resp:
            data = resp.read()
        if data[:2] == b"\xff\xd8":
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            cache_file.write_bytes(data)
            return Response(
                content=data,
                media_type="image/jpeg",
                headers={"Cache-Control": "public, max-age=604800"},
            )
    except Exception:
        pass
    return Response(
        content=render_mola_tile("themis", z, y, x),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )


_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _DIST.is_dir():
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="static")
