"""Run: python test_water.py (checks NASA SWIM/MONS/CRISM water resource lookups)"""
from water import water_sites, water_at

sites = water_sites()
assert len(sites) >= 10
assert {"ice", "mineral"} == {s["kind"] for s in sites}

# Phoenix landing site: shallow ice
assert water_at(68.22, -125.75)["isru_rating"] == "high"
# Jezero Crater delta: hydrated minerals (smectite clays & carbonates)
jez = water_at(18.44, 77.45)
assert jez["isru_rating"] == "high" and "Jezero" in jez["detail"], jez
# Arcadia Planitia: shallow buried ice sheet
arc = water_at(39.2, -168.0)
assert arc["status"] == "Shallow Ice" and arc["isru_rating"] == "high"
# Equatorial dry spot far from mapped deposits (e.g., 0°N, 0°E)
eq = water_at(0.0, 0.0)
assert eq["isru_rating"] == "low"
print("all water resource checks passed")
