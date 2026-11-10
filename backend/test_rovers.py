"""Run: python test_rovers.py (checks NASA MMGIS Perseverance & Curiosity traverses)"""
from rovers import ROVERS

assert [r["name"] for r in ROVERS] == ["Perseverance", "Curiosity"]
p, c = ROVERS
assert p["distance_km"] > 40 and p["latest_sol"] >= 2000
assert c["distance_km"] > 35 and c["segments"] > 1000
assert 500 <= len(p["path"]) <= 1000 and 500 <= len(c["path"]) <= 1000
assert p["path"][0] == p["start"] and p["path"][-1] == p["current"]
assert abs(p["start"][0] - 18.44) < 0.05 and abs(p["start"][1] - 77.45) < 0.05
assert abs(c["start"][0] - (-4.59)) < 0.05 and abs(c["start"][1] - 137.44) < 0.05
print("all rover traverse checks passed")
