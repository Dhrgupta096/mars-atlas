"""Run: uvicorn main:app --reload --port 8000"""
from fastapi import FastAPI, Query
from mars_time import mars_time
from terrain import elevation, slope, risk
from route import straight_line, safest_path, eva_plan

app = FastAPI(title="Mars Map API")

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
def time(lon: float = Query(0.0, ge=-180, le=180), lat: float = Query(0.0, ge=-90, le=90)):
    return mars_time(lon=lon, lat=lat)


@app.get("/api/places")
def places():
    return [dict(name=n, lat=la, lon=lo, kind=k) for n, la, lo, k in PLACES]


@app.get("/api/terrain")
def terrain(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=360)):
    s = slope(lat, lon)
    return {"lat": lat, "lon": lon, "elevation_m": elevation(lat, lon), "slope_deg": round(s, 1),
            "risk": risk(s), "source": "MGS MOLA MEGDR 32 px/deg"}


@app.get("/api/route")
def route(lat1: float = Query(..., ge=-90, le=90), lon1: float = Query(..., ge=-180, le=360),
          lat2: float = Query(..., ge=-90, le=90), lon2: float = Query(..., ge=-180, le=360)):
    direct, safe = straight_line(lat1, lon1, lat2, lon2), safest_path(lat1, lon1, lat2, lon2)
    return {"direct": direct, "safe": safe, "plan": eva_plan(direct, safe)}
