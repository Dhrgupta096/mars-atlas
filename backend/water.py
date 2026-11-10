"""Mars water ice & hydrated mineral resources (NASA SWIM, Mars Odyssey MONS, SHARAD, MRO CRISM).
Provides both mapped ISRU resource deposits and continuous point/route water availability assessment.
"""
from route import distance_m
from terrain import elevation

# (name, lat, lon, kind: "ice" | "mineral", radius_km, depth_or_wt, source, note)
WATER_SITES = [
    ("Arcadia Planitia Ice Sheet", 39.2, -168.0, "ice", 320, "1–3 m depth", "SWIM / SHARAD", "Buried glacier sheet; prime human landing & ISRU water target"),
    ("Deuteronilus Mensae Glaciers", 42.5, 24.0, "ice", 260, "1–4 m depth", "SHARAD Radar", "Radar-confirmed pure lobate debris-covered glaciers (>80% H₂O)"),
    ("Phlegra Montes Buried Ice", 39.8, 163.5, "ice", 240, "2–5 m depth", "SWIM / HiRISE", "Mid-latitude glacial aprons along scarp valleys"),
    ("Utopia Planitia Ice Deposit", 46.7, 117.5, "ice", 450, "1–10 m depth", "SHARAD / MONS", "Subsurface water volume comparable to Lake Superior"),
    ("Phoenix Ice Table (Vastitas)", 68.22, -125.75, "ice", 300, "0.05 m (5 cm)", "Phoenix Lander", "Shallow pure water-ice table directly trenched by NASA Phoenix"),
    ("Planum Boreum (North Cap)", 86.5, 0.0, "ice", 500, "0 m (surface)", "MOLA / SHARAD", "Exposed 3 km thick H₂O polar ice cap"),
    ("Planum Australe (South Cap)", -86.5, 0.0, "ice", 420, "0 m (surface)", "MARSIS / OMEGA", "Layered H₂O ice cap capped by seasonal CO₂ slab"),
    ("Jezero Delta Clays & Carbonates", 18.45, 77.36, "mineral", 95, "4–8 wt% H₂O", "MRO CRISM / Perseverance", "Fe/Mg-smectite clays & littoral carbonates from ancient lake"),
    ("Nili Fossae Phyllosilicates", 21.5, 74.5, "mineral", 160, "5–8 wt% H₂O", "MRO CRISM", "Regional clay and carbonate exposures adjacent to Jezero"),
    ("Mawrth Vallis Clay Plateau", 24.0, -19.0, "mineral", 180, "6–10 wt% H₂O", "MRO CRISM / OMEGA", "One of Mars' thickest phyllosilicate clay sequences"),
    ("Mt. Sharp Sulfate & Clay Unit", -4.78, 137.45, "mineral", 90, "5–9 wt% H₂O", "Curiosity SAM / CRISM", "Polyhydrated sulfates and smectite clays confirmed by Curiosity"),
    ("Candor Chasma Hydrated Sulfates", -6.5, -70.8, "mineral", 170, "4–7 wt% H₂O", "CRISM / TGO FREND", "Canyon floor polyhydrated sulfates & high hydrogen anomaly"),
]


def water_sites() -> list[dict]:
    return [
        {
            "name": name, "lat": lat, "lon": lon, "kind": kind, "radius_km": rad,
            "yield": yld, "source": src, "note": note, "elevation_m": elevation(lat, lon),
        }
        for name, lat, lon, kind, rad, yld, src, note in WATER_SITES
    ]


def water_at(lat: float, lon: float) -> dict:
    """Assess water/ISRU availability at (lat, lon) from mapped deposits + latitude/elevation ice stability."""
    nearest = min(
        ((distance_m(lat, lon, la, lo) / 1000, name, kind, rad, yld, src) for name, la, lo, kind, rad, yld, src, _ in WATER_SITES),
        key=lambda x: x[0],
    )
    dist_km, name, kind, rad, yld, src = nearest
    if dist_km <= rad:
        return {
            "status": "Shallow Ice" if kind == "ice" else "Hydrated Minerals",
            "detail": f"{name} ({yld})",
            "source": src,
            "isru_rating": "high",
        }
    alat = abs(lat)
    elev = elevation(lat, lon)
    if alat >= 60:
        return {"status": "Shallow Ice Table", "detail": "0.1–0.5 m depth (>25% WEH permafrost)", "source": "MONS / SWIM", "isru_rating": "high"}
    if alat >= 35:
        depth = "1–5 m" if elev < -2000 else "3–10 m"
        return {"status": "Mid-Lat Buried Ice", "detail": f"{depth} depth (10–25% WEH)", "source": "SWIM / SHARAD", "isru_rating": "medium"}
    if dist_km <= rad + 250:
        return {"status": f"Near {name}", "detail": f"{round(dist_km - rad)} km to {yld}", "source": src, "isru_rating": "medium"}
    return {"status": "Dry Regolith", "detail": "1.5–3 wt% adsorbed H₂O (high bake energy)", "source": "MONS Global", "isru_rating": "low"}
