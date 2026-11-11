"""Run: python test_route.py"""
from route import distance_m, straight_line, safest_path, science_path, eva_plan, _hours

# Quarter of Mars' equator = pi/2 * 3389.5 km
assert abs(distance_m(0, 0, 0, 90) - 5324.2e3) < 1e3
assert distance_m(10, 20, 10, 20) == 0

# Curiosity landing → Mount Sharp: 0.64° apart × 59.16 km/° ≈ 37.8 km, climbs ~5 km
r = straight_line(-4.59, 137.44, -5.08, 137.85)
assert 37e3 < r["distance_m"] < 38.5e3, r["distance_m"]
assert r["climb_m"] > 3000, r["climb_m"]
assert r["path"][0] == [-4.59, 137.44] and r["path"][-1] == [-5.08, 137.85]

# Crossing the date line goes the short way (~59 km), not around the planet
assert distance_m(0, 179.5, 0, -179.5) < 60e3

# Same point twice doesn't crash
assert straight_line(18.4, 77.5, 18.4, 77.5)["distance_m"] == 0

# Safest path: never steeper than the straight line, never through "too steep" ground, ends exactly at A and B
for a, b in [((-4.59, 137.44), (-5.08, 137.85)), ((-2.0, -71.85), (-5.0, -71.85)), ((0, 179.5), (0.5, -179.5))]:
    s, p = straight_line(*a, *b), safest_path(*a, *b)
    assert p is not None
    assert p["max_slope_deg"] <= s["max_slope_deg"] and p["risk"] != "too steep", (a, b, p["max_slope_deg"])
    assert p["distance_m"] >= s["distance_m"] * 0.99
    assert p["path"][0] == list(a) and p["path"][-1] == list(b)
assert safest_path(18.4, 77.5, 18.4, 77.5) is not None

# Times: 3 km flat = 1 h walking, 0.3 h rover; uphill is slower than flat; round trip covers both ways
import numpy as np
walk, rover = _hours(np.array([3000.0]), np.array([0.0]))
assert abs(walk - 1.0) < 0.01 and abs(rover - 0.3) < 0.01
assert _hours(np.array([3000.0]), np.array([0.2]))[0] > walk
r = straight_line(-4.59, 137.44, -5.08, 137.85)
assert r["walk_round_trip_h"] > r["walk_h"] > 0 and r["rover_h"] < r["walk_h"]

# EVA plan picks the right mode and always explains itself
short = safest_path(-4.59, 137.44, -4.60, 137.45)          # ~0.8 km stroll (within 1 pixel)
assert short is not None and short["distance_m"] > 500 and eva_plan(straight_line(-4.59, 137.44, -4.60, 137.45), short)["mode"] == "walk"
mid = safest_path(-4.59, 137.44, -4.75, 137.44)            # ~9.5 km: too far on foot, fine by rover
assert mid is not None and eva_plan(straight_line(-4.59, 137.44, -4.75, 137.44), mid)["mode"] == "rover"
far = safest_path(-4.59, 137.44, -5.08, 137.85)            # Mount Sharp, 44 km
assert far is not None and eva_plan(straight_line(-4.59, 137.44, -5.08, 137.85), far)["mode"] == "expedition"
assert eva_plan(straight_line(0, 0, 1, 1), None)["mode"] == "none"
assert "41.1°" in eva_plan(straight_line(-2.0, -71.85, -5.0, -71.85), safest_path(-2.0, -71.85, -5.0, -71.85))["why"]

# Step 9: High Science path stays safe (<=20°), yields >= safest path science score at Jezero, and places stations S1..S3
jez_safe = safest_path(18.38, 77.58, 18.65, 77.30)
jez_sci = science_path(18.38, 77.58, 18.65, 77.30)
assert jez_safe is not None and jez_sci is not None and jez_sci["risk"] != "too steep"
assert jez_sci["science_score"] > jez_safe["science_score"], (jez_sci["science_score"], jez_safe["science_score"])
assert [st["id"] for st in jez_sci["stations"]] == ["S1", "S2", "S3"]
assert all(st["image"].startswith("https://images-assets.nasa.gov/image/PIA") and st["task"] for st in jez_sci["stations"])

# Step 13: Apollo Walk-Back safety check (B->A emergency return <= 4.0 h)
assert short["walkback_ok"] is True and short["walk_back_h"] <= 4.0
assert far["walkback_ok"] is False and far["walk_back_h"] > 4.0
print("all route checks passed")
