"""Run: uvicorn main:app --reload --port 8000"""
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from fastapi import FastAPI, Query, Response
from fastapi.staticfiles import StaticFiles
from mars_time import mars_time
from terrain import elevation, slope, risk, render_mola_tile, render_mola_heightmap, ai_slope_analysis
from route import straight_line, safest_path, science_path, eva_plan, slope_hazards, chain_legs
from rovers import ROVERS
from water import water_sites, water_at

app = FastAPI(title="Mars Map API")
_CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "tile_cache"

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
            "risk": risk(ai["slope_deg"]), "ai_slope": ai, "water": water_at(lat, lon), "source": "MGS MOLA MEGDR 32 px/deg"}


@app.get("/api/route")
def route(lat1: float = Query(0.0, ge=-90, le=90), lon1: float = Query(0.0, ge=-180, le=360),
          lat2: float = Query(0.0, ge=-90, le=90), lon2: float = Query(0.0, ge=-180, le=360),
          pts: str | None = Query(None)):
    if pts:
        waypoints = [(float(p.split(",")[0]), float(p.split(",")[1])) for p in pts.split(";") if "," in p][:6]
    else:
        waypoints = [(lat1, lon1), (lat2, lon2)]
    direct = chain_legs(straight_line, waypoints)
    safe = chain_legs(safest_path, waypoints)
    science = chain_legs(science_path, waypoints)
    return {"direct": direct, "safe": safe, "science": science, "plan": eva_plan(direct, safe, science),
            "hazards": slope_hazards(waypoints[0][0], waypoints[0][1], waypoints[-1][0], waypoints[-1][1]),
            "water": water_at(waypoints[-1][0], waypoints[-1][1])}


@app.get("/api/rovers")
def rovers():
    return ROVERS


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
    z = max(0, min(z, 7))
    cache_file = _CACHE_DIR / layer / str(z) / str(y) / f"{x}.jpg"
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
