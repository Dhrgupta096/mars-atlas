"""Real NASA JPL MMGIS rover traverses for Perseverance (M2020) and Curiosity (MSL)."""
import json
from pathlib import Path
from terrain import elevation

DATA_DIR = Path(__file__).parent.parent / "data"

_NASA_IMG = lambda pia: f"https://images-assets.nasa.gov/image/{pia}/{pia}~small.jpg"

_META = [
    ("Perseverance", "m20_traverse.json", "Jezero Crater", "Octavia E. Butler Landing", "#7fd1c7", [
        ("PIA24486", "Mastcam-Z · First 360° panorama at Octavia E. Butler Landing"),
        ("PIA24542", "Mastcam-Z · Jezero crater floor basaltic boulder field"),
        ("PIA24924", "Mastcam-Z · Ancient river delta scarp & Kodiak butte strata"),
        ("PIA25287", "Mastcam-Z · Enchanted Lake finely laminated delta mudstones"),
    ]),
    ("Curiosity", "msl_traverse.json", "Gale Crater · Mt. Sharp", "Bradbury Landing", "#ff8a50", [
        ("PIA16101", "Mastcam · Bradbury Landing looking toward Mount Sharp"),
        ("PIA19803", "Mastcam · Missoula geologic contact at Marias Pass"),
        ("PIA19920", "Mastcam · Cross-bedded sandstone & Murray mudstone strata"),
        ("PIA21719", "Mastcam · Vera Rubin Ridge hematitic bedrock outcrop"),
    ]),
]


def _load_one(name: str, filename: str, site: str, landing: str, color: str, photos: list, max_pts: int = 800) -> dict:
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
    if name == "Curiosity":
        milestones = [
            ("Bradbury Landing", 0, "Curiosity landing site in Gale Crater floor"),
            ("Pahrump Hills", n // 4, "Murray Formation · Basal laminated lacustrine mudstone"),
            ("Vera Rubin Ridge", n // 2, "Hematite-rich resistant bedrock ridge on Mt. Sharp"),
            ("Mount Sharp Ascent", n - 1, f"Gediz Vallis Ridge & Sulfate Unit ({round(total_m / 1000, 1)} km driven)"),
        ]
    else:
        milestones = [
            ("Butler Landing", 0, "Octavia E. Butler Landing in Jezero Crater floor"),
            ("Delta Front", n // 4, "Ancient Neretva river delta scarp & Kodiak butte strata"),
            ("Enchanted Lake", n // 2, "Finely laminated lacustrine delta mudstones"),
            ("Current Position", n - 1, f"Jezero Margin Carbonates ({round(total_m / 1000, 1)} km driven)"),
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
            {
                "label": lbl, "detail": det, "lat": sampled[i][0], "lon": sampled[i][1],
                "elevation_m": elevation(*sampled[i]), "pia": photos[k][0],
                "caption": photos[k][1], "image": _NASA_IMG(photos[k][0]),
            }
            for k, (lbl, i, det) in enumerate(milestones)
        ],
        "path": [list(p) for p in sampled],
    }


ROVERS = [_load_one(*m) for m in _META]
