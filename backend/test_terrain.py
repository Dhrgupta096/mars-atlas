"""Run: python test_terrain.py  (checks MOLA heights against published values)"""
from terrain import elevation, slope, risk, render_mola_tile, render_mola_heightmap

assert abs(elevation(-4.59, 137.44) - (-4501)) < 100      # Curiosity landing site, published -4,501 m
assert elevation(18.65, -133.8) > 19000                   # Olympus Mons summit region
assert elevation(-42.4, 70.5) < -5000                     # Hellas basin floor
assert elevation(18.65, -133.8) == elevation(18.65, 226.2)  # -133.8°E is the same place as 226.2°E
elevation(-90, 0); elevation(90, 180)                     # poles + date line don't crash

assert slope(46.7, 117.5) < 3 and slope(-4.59, 137.44) < 3  # Utopia plain, Curiosity landing: flat
assert slope(-3.15, -71.85) > 25                          # Valles Marineris canyon wall
assert slope(20.95, -138.0) > 25                          # Olympus Mons basal cliff
slope(-90, 0); slope(90, 179.99)                          # poles + date line don't crash
assert [risk(5), risk(15), risk(30)] == ["safe", "caution", "too steep"]
for m in ("elevation", "themis"):
    png = render_mola_tile(m, 1, 0, 0)
    assert png[:8] == b"\x89PNG\r\n\x1a\n" and len(png) > 2000
hmap = render_mola_heightmap(1, 0, 0)
assert len(hmap) == 33 * 33 * 4
print("all terrain checks passed")
