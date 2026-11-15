import json
import pathlib
import sys
import numpy as np

root = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(root / "backend"))

from main import PLACES, route as api_route
from rovers import ROVERS
from water import water_sites
from terrain import DEM, PIXEL_M, render_mola_tile, render_mola_heightmap
from geochem import ELEMENTS, load_grs_dataset

dist = root / "frontend" / "dist"
dist.mkdir(parents=True, exist_ok=True)
(dist / ".nojekyll").write_text("")
api_dir = root / "frontend" / "public" / "api"
api_dir.mkdir(parents=True, exist_ok=True)

# 1. Build 90x180 (2 deg) elevation & slope grids + geochem grids
step_r = DEM.shape[0] // 90
step_c = DEM.shape[1] // 180
elev_sub = DEM[::step_r, ::step_c][:90, :180].astype(int).tolist()

z = DEM[::step_r, ::step_c][:90, :180].astype(float)
dy = PIXEL_M * step_r
lats = np.linspace(89.0, -89.0, 90)
dx = dy * np.maximum(np.cos(np.radians(lats)), 0.05)[:, None]
gy, gx = np.gradient(z)
slope_sub = np.round(np.degrees(np.arctan(np.hypot(gx / dx, gy / dy))), 1).tolist()

_, grs_grids_full = load_grs_dataset()
first_g = next(iter(grs_grids_full.values()))
gr_r = max(1, first_g.shape[0] // 90)
gr_c = max(1, first_g.shape[1] // 180)
grs_sub = {k: np.round(g[::gr_r, ::gr_c][:90, :180], 2).tolist() for k, g in grs_grids_full.items()}

# 2. Pre-compute exact A* routes for the 3 PRESET_EVAS
presets = [
    "18.4446,77.4509;18.468,77.434;18.489,77.405;18.515,77.375",
    "-4.5895,137.4417;-4.654,137.38;-4.73,137.362;-4.81,137.36",
    "18.35,-133.25;18.52,-133.58;18.68,-133.92",
]
preset_routes = {p_str: api_route(0, 0, 0, 0, pts=p_str) for p_str in presets}

bundle = {
    "places": [dict(name=n, lat=la, lon=lo, kind=k) for n, la, lo, k in PLACES],
    "rovers": ROVERS,
    "water": water_sites(),
    "geochem_catalog": ELEMENTS,
    "geochem_grids": grs_sub,
    "elev_grid": elev_sub,
    "slope_grid": slope_sub,
    "preset_routes": preset_routes,
}
(api_dir / "static_bundle.json").write_text(json.dumps(bundle, separators=(",", ":")))
print("static_bundle.json written, size:", (api_dir / "static_bundle.json").stat().st_size // 1024, "KB")

# 3. Render z=0,1 tiles and heightmaps
modes = ["elevation", "slope", "night_ir"] + [f"grs_{k}" for k in ELEMENTS]
for m in modes:
    for z_lvl in (0, 1):
        for y in range(1 << z_lvl):
            for x in range(2 << z_lvl):
                out_p = api_dir / "tiles" / m / str(z_lvl) / str(y) / f"{x}.png"
                out_p.parent.mkdir(parents=True, exist_ok=True)
                out_p.write_bytes(render_mola_tile(m, z_lvl, y, x))

for z_lvl in (0, 1):
    for y in range(1 << z_lvl):
        for x in range(2 << z_lvl):
            out_h = api_dir / "heightmap" / str(z_lvl) / str(y) / f"{x}.bin"
            out_h.parent.mkdir(parents=True, exist_ok=True)
            out_h.write_bytes(render_mola_heightmap(z_lvl, y, x))

print("Static tiles & heightmaps successfully generated!")
