"""Real NASA JPL MMGIS rover traverses for Perseverance (M2020) and Curiosity (MSL)."""
import json
from pathlib import Path
from terrain import elevation

DATA_DIR = Path(__file__).parent.parent / "data"

_META = [
    ("Perseverance", "m20_traverse.json", "Jezero Crater", "Octavia E. Butler Landing", "#7fd1c7"),
    ("Curiosity", "msl_traverse.json", "Gale Crater · Mt. Sharp", "Bradbury Landing", "#ff8a50"),
]


def _load_one(name: str, filename: str, site: str, landing: str, color: str, max_pts: int = 800) -> dict:
    raw = json.loads((DATA_DIR / filename).read_text())["features"]
    pts, total_m, max_sol = [], 0.0, None
    for ft in raw:
        props = ft.get("properties") or {}
        total_m += float(props.get("length") or props.get("Length") or 0.0)
        if props.get("sol"):
            max_sol = max(max_sol or 0, int(props["sol"]))
        g = ft.get("geometry")
        if not g:
            continue
        lines = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"] if g["type"] == "MultiLineString" else []
        for seg in lines:
            for c in seg:
                pts.append((round(float(c[1]), 6), round(float(c[0]), 6)))  # [lat, lon]

    step = max(1, len(pts) // max_pts)
    sampled = pts[::step]
    if sampled[-1] != pts[-1]:
        sampled.append(pts[-1])

    n = len(sampled)
    milestones = [
        ("Landing", 0, landing),
        ("Quarter Traverse", n // 4, f"25% of {site} route"),
        ("Midpoint", n // 2, f"50% of {site} route"),
        ("Current Position", n - 1, f"Latest rover position ({round(total_m / 1000, 1)} km driven)"),
    ]
    return {
        "name": name,
        "site": site,
        "landing": landing,
        "color": color,
        "distance_km": round(total_m / 1000, 2),
        "segments": len(raw),
        "latest_sol": max_sol,
        "start": list(sampled[0]),
        "current": list(sampled[-1]),
        "waypoints": [
            {"label": lbl, "detail": det, "lat": sampled[i][0], "lon": sampled[i][1], "elevation_m": elevation(*sampled[i])}
            for lbl, i, det in milestones
        ],
        "path": [list(p) for p in sampled],
    }


ROVERS = [_load_one(*m) for m in _META]
