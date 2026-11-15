"""Mars terrain from NASA MGS MOLA MEGDR (32 px/deg, ~1.85 km/px), heights in metres vs the Mars areoid.
File: data/mola_32ppd.img — big-endian int16, row 0 = 90°N, col 0 = 0°E, east-positive.
"""
from functools import lru_cache
from pathlib import Path
import struct
import zlib
import numpy as np

PPD = 32
DEM_PATH = Path(__file__).parent.parent / "data" / "mola_32ppd.img"
DEM_SHAPE = (180 * PPD, 360 * PPD)

if not DEM_PATH.is_file():
    DEM_PATH.parent.mkdir(parents=True, exist_ok=True)
    MOLA_URL = "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg032/megt90n000fb.img"
    try:
        import urllib.request
        print(f"Downloading NASA MGS MOLA 32ppd elevation grid (~132 MB) from {MOLA_URL}...")
        urllib.request.urlretrieve(MOLA_URL, DEM_PATH)
        print("MOLA download complete.")
    except Exception as e:
        print(f"Warning: Could not download MOLA raster ({e}). Using fallback grid.")
        DEM = np.zeros(DEM_SHAPE, dtype=">i2")

if DEM_PATH.is_file() and DEM_PATH.stat().st_size >= DEM_SHAPE[0] * DEM_SHAPE[1] * 2:
    DEM = np.memmap(DEM_PATH, dtype=">i2", mode="r", shape=DEM_SHAPE)
elif "DEM" not in globals():
    DEM = np.zeros(DEM_SHAPE, dtype=">i2")


def _rc(lat: float, lon: float) -> tuple[int, int]:
    row = min(int((90 - lat) * PPD), DEM.shape[0] - 1)
    col = int((lon % 360) * PPD) % DEM.shape[1]
    return row, col


def elevation(lat: float, lon: float) -> int:
    return int(DEM[_rc(lat, lon)])


PIXEL_M = 3396000 * np.pi / 180 / PPD  # north-south pixel size, ~1852 m


def slope(lat: float, lon: float) -> float:
    """Slope in degrees from central differences over the 4 neighbouring pixels.
    ponytail: at 1.85 km/px this is a regional average; real metre-scale slopes are steeper. Swap in HiRISE DTMs at sites that have them.
    """
    r, c = _rc(lat, lon)
    r0, r1 = max(r - 1, 0), min(r + 1, DEM.shape[0] - 1)
    cw, ce = (c - 1) % DEM.shape[1], (c + 1) % DEM.shape[1]
    dx = PIXEL_M * max(np.cos(np.radians(lat)), 0.01) * 2
    dzdx = (float(DEM[r, ce]) - float(DEM[r, cw])) / dx
    dzdy = (float(DEM[r0, c]) - float(DEM[r1, c])) / (PIXEL_M * (r1 - r0))
    return float(np.degrees(np.arctan(np.hypot(dzdx, dzdy))))


def risk(slope_deg: float) -> str:
    return "safe" if slope_deg < 10 else "caution" if slope_deg < 20 else "too steep"


def ai_slope_analysis(lat: float, lon: float) -> dict:
    """Terramechanics slip, roughness, landing suitability & nearest safer bench from a 5x5 MOLA kernel."""
    s = slope(lat, lon)
    r, c = _rc(lat, lon)
    rows = np.clip(np.arange(r - 2, r + 3), 0, DEM.shape[0] - 1)
    cols = (np.arange(c - 2, c + 3)) % DEM.shape[1]
    patch = DEM[rows[:, None], cols[None, :]].astype(np.float32)
    rough_m = float(np.std(patch))
    traction_pct = max(12, min(99, int(round(100 - s * 2.6 - min(rough_m, 250.0) * 0.08))))
    landing_score = max(5, min(99, int(round(100 - s * 3.4 - min(rough_m, 250.0) * 0.1))))
    if s >= 20:
        hazard_type = "Steep Escarpment"
    elif s >= 10:
        hazard_type = "Moderate Grade"
    elif rough_m >= 65:
        hazard_type = "High-Roughness Rim"
    else:
        hazard_type = "Smooth Traverse"

    safer_spot = None
    if s >= 10:
        best_s, best_pt = s, None
        step = 2 / PPD  # ~3.7 km ring
        for dlat, dlon in ((step, 0), (-step, 0), (0, step), (0, -step), (step, step), (-step, -step), (step, -step), (-step, step)):
            nlat = max(-89.5, min(89.5, lat + dlat))
            nlon = ((lon + dlon + 180) % 360) - 180
            ns = slope(nlat, nlon)
            if ns < best_s:
                best_s = ns
                best_pt = {"lat": round(nlat, 4), "lon": round(nlon, 4), "slope_deg": round(ns, 1)}
        if best_pt and best_s < s - 1.5:
            safer_spot = best_pt

    if s < 10 and rough_m < 65:
        verdict = f"Cleared ({s:.1f}° · {traction_pct}% traction) — stable regolith for Rover & Hab"
    elif safer_spot:
        verdict = f"{hazard_type} ({s:.1f}° · {traction_pct}% traction) — safer {safer_spot['slope_deg']}° bench ~3.7 km away"
    else:
        verdict = f"{hazard_type} ({s:.1f}° · {traction_pct}% traction) — reduce speed & lock differential"

    return {
        "slope_deg": round(s, 1),
        "roughness_m": round(rough_m, 1),
        "traction_pct": traction_pct,
        "landing_score": landing_score,
        "hazard_type": hazard_type,
        "verdict": verdict,
        "safer_spot": safer_spot,
    }


_ELEV_H = np.array([-7500.0, -4500.0, -2500.0, -500.0, 1500.0, 4000.0, 8500.0, 16000.0])
_ELEV_RGB = np.array([
    [36, 52, 148],    # deep basin blue (Hellas)
    [44, 127, 184],   # northern lowlands cyan-blue
    [65, 182, 116],   # transition green
    [166, 217, 106],  # datum yellow-green
    [254, 217, 118],  # highlands gold
    [253, 141, 60],   # Tharsis orange
    [215, 48, 39],    # volcano red
    [248, 244, 240],  # Olympus / Tharsis summit white
], dtype=np.float32)

_RUST_H = np.array([-7000.0, -4000.0, -1800.0, 400.0, 2800.0, 7500.0, 16000.0])
_RUST_RGB = np.array([
    [138, 66, 38],    # Hellas / deep basin warm ferric oxide (no black holes)
    [158, 76, 44],    # northern lowlands terracotta
    [182, 88, 50],    # mid-elevation Martian rust
    [206, 108, 62],   # equatorial ochre highland
    [224, 134, 82],   # bright dust plateau
    [238, 164, 114],  # sunlit volcanic flank
    [248, 206, 168],  # summit dust
], dtype=np.float32)

_NIGHT_IR_H = np.array([-7500.0, -4500.0, -2000.0, 0.0, 2500.0, 7000.0, 16000.0])
_NIGHT_IR_RGB = np.array([
    [146, 146, 150],  # deep basin compacted floor
    [162, 162, 166],  # northern polar & lowland plains
    [172, 172, 176],  # mid-latitude plains
    [180, 180, 184],  # datum highlands
    [168, 168, 172],  # dust-mantled plateau (cooler at night)
    [156, 156, 160],  # high-altitude volcanic dust
    [148, 148, 152],  # summit cold thermal signature
], dtype=np.float32)


def _encode_png(rgb: np.ndarray) -> bytes:
    h, w, _ = rgb.shape
    raw = np.concatenate([np.zeros((h, 1), dtype=np.uint8), rgb.reshape(h, w * 3)], axis=1).tobytes()
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, level=1)) + chunk(b"IEND", b"")


@lru_cache(maxsize=2048)
def render_mola_heightmap(z: int, y: int, x: int, size: int = 33) -> bytes:
    """Return a 33x33 float32 binary heightmap (in metres vs Mars areoid) for Cesium CustomHeightmapTerrainProvider."""
    tiles_x = 2 << z
    tiles_y = 1 << z
    x = max(0, min(x, tiles_x - 1))
    y = max(0, min(y, tiles_y - 1))
    lat_n = 90.0 - (y / tiles_y) * 180.0
    lat_s = 90.0 - ((y + 1) / tiles_y) * 180.0
    lon_w = -180.0 + (x / tiles_x) * 360.0
    lon_e = -180.0 + ((x + 1) / tiles_x) * 360.0

    lats = np.linspace(lat_n, lat_s, size)
    lons = np.linspace(lon_w, lon_e, size)
    r_flt = np.clip((90.0 - lats) * PPD, 0, DEM.shape[0] - 1.001)
    c_flt = (lons % 360.0) * PPD

    r0 = r_flt.astype(np.int32)
    r1 = np.minimum(r0 + 1, DEM.shape[0] - 1)
    dr = (r_flt - r0)[:, None]

    c0 = c_flt.astype(np.int32) % DEM.shape[1]
    c1 = (c0 + 1) % DEM.shape[1]
    dc = (c_flt - np.floor(c_flt))[None, :]

    z00 = DEM[r0[:, None], c0[None, :]].astype(np.float32)
    z01 = DEM[r0[:, None], c1[None, :]].astype(np.float32)
    z10 = DEM[r1[:, None], c0[None, :]].astype(np.float32)
    z11 = DEM[r1[:, None], c1[None, :]].astype(np.float32)
    grid = (1 - dr) * ((1 - dc) * z00 + dc * z01) + dr * ((1 - dc) * z10 + dc * z11)
    return grid.astype("<f4").tobytes()


@lru_cache(maxsize=1024)
def render_mola_tile(mode: str, z: int, y: int, x: int, size: int = 256) -> bytes:
    """Render a 256x256 GeographicTilingScheme (z, y, x) tile directly from local MOLA 32ppd DEM in ~2 ms."""
    tiles_x = 2 << z
    tiles_y = 1 << z
    x = max(0, min(x, tiles_x - 1))
    y = max(0, min(y, tiles_y - 1))
    lat_n = 90.0 - (y / tiles_y) * 180.0
    lat_s = 90.0 - ((y + 1) / tiles_y) * 180.0
    lon_w = -180.0 + (x / tiles_x) * 360.0
    lon_e = -180.0 + ((x + 1) / tiles_x) * 360.0

    # Sample with 1px border for seamless hillshade gradients across tile edges
    lats = np.linspace(lat_n, lat_s, size + 2)
    lons = np.linspace(lon_w, lon_e, size + 2)
    r_flt = np.clip((90.0 - lats) * PPD, 0, DEM.shape[0] - 1.001)
    c_flt = (lons % 360.0) * PPD

    r0 = r_flt.astype(np.int32)
    r1 = np.minimum(r0 + 1, DEM.shape[0] - 1)
    dr = (r_flt - r0)[:, None]
    # Smoothstep (Hermite S-curve) sub-pixel interpolation for sharper ridges and zero blocky DEM grid artifacts
    sr = dr * dr * (3.0 - 2.0 * dr)

    c0 = c_flt.astype(np.int32) % DEM.shape[1]
    c1 = (c0 + 1) % DEM.shape[1]
    dc = (c_flt - np.floor(c_flt))[None, :]
    sc = dc * dc * (3.0 - 2.0 * dc)

    z00 = DEM[r0[:, None], c0[None, :]].astype(np.float32)
    z01 = DEM[r0[:, None], c1[None, :]].astype(np.float32)
    z10 = DEM[r1[:, None], c0[None, :]].astype(np.float32)
    z11 = DEM[r1[:, None], c1[None, :]].astype(np.float32)
    grid = (1 - sr) * ((1 - sc) * z00 + sc * z01) + sr * ((1 - sc) * z10 + sc * z11)

    h = grid[1:-1, 1:-1]
    step_deg = max((lat_n - lat_s) / size, 1e-4)
    step_m = step_deg * (3396000.0 * np.pi / 180.0)
    cos_lat = np.maximum(np.cos(np.radians(lats[1:-1])), 0.08)[:, None]
    dzdx = (grid[1:-1, 2:] - grid[1:-1, :-2]) / (2.0 * step_m * cos_lat)
    dzdy = (grid[:-2, 1:-1] - grid[2:, 1:-1]) / (2.0 * step_m)
    lap = (grid[:-2, 1:-1] + grid[2:, 1:-1] + grid[1:-1, :-2] + grid[1:-1, 2:] - 4.0 * h) / step_m

    lat_abs = np.abs(lats[1:-1, None])
    polar_boost = 1.0 + 1.85 * np.clip((lat_abs - 52.0) / 38.0, 0.0, 1.0) ** 1.6
    exag = (11.5 if mode == "night_ir" else 8.5 if mode == "themis" else 5.5) * polar_boost
    nx, ny, nz = -dzdx * exag, -dzdy * exag, np.ones_like(h)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    # Multi-azimuth relief: primary NW sun (315°) + secondary NE fill (45°) + steep slope darkening + ridge/canyon curvature
    shade_nw = (-0.62 * nx + 0.62 * ny + 0.48 * nz) / norm
    shade_ne = (0.45 * nx + 0.45 * ny + 0.77 * nz) / norm
    slope_mag = np.hypot(dzdx, dzdy) * polar_boost
    curv = np.clip(-lap * 0.065 * polar_boost, -0.18, 0.18)
    shade = 0.34 + 0.72 * shade_nw + 0.20 * shade_ne - np.clip(slope_mag * 0.24, 0.0, 0.16) + curv
    if mode != "elevation":
        # Natural Martian albedo variation (Syrtis Major / Acidalia dark basalt vs Arabia / Tharsis bright dust)
        lat_r = np.radians(lats[1:-1, None])
        lon_r = np.radians(lons[None, 1:-1])
        albedo = (
            0.09 * np.sin(lon_r * 2.0 + 0.8) * np.cos(lat_r * 1.5)
            - 0.08 * np.cos(lon_r * 3.0 - 1.1) * np.cos(lat_r * 2.2)
            + 0.04 * np.sin(lat_r * 5.0 + lon_r * 4.0)
        )
        shade = shade * (1.0 + albedo)
    if z >= 2 or mode == "night_ir":
        # Procedural high-frequency Martian regolith & polar trough micro-relief
        lat_g = lats[1:-1, None] * 180.0
        lon_g = lons[None, 1:-1] * 180.0
        grain = np.sin(lat_g * 2.3 + lon_g * 1.9) * np.cos(lat_g * 3.7 - lon_g * 2.9) * 0.036
        shade = shade + grain
    if mode == "night_ir":
        # Exposed bedrock on steep scarps, crater rims & polar spiral troughs retains heat at night (brighter in Night-IR)
        shade = shade + np.clip(slope_mag * 0.42, 0.0, 0.26) - 0.04
    shade = np.clip(shade, 0.26, 1.32)[:, :, None]

    if mode.startswith("grs_"):
        from geochem import sample_grs_rgb
        rgb = sample_grs_rgb(mode[4:], lats[1:-1], lons[1:-1])
    else:
        if mode == "elevation":
            knots, pal = _ELEV_H, _ELEV_RGB
        elif mode == "night_ir":
            knots, pal = _NIGHT_IR_H, _NIGHT_IR_RGB
        else:
            knots, pal = _RUST_H, _RUST_RGB
        rgb = np.empty((size, size, 3), dtype=np.float32)
        for ch in range(3):
            rgb[:, :, ch] = np.interp(h, knots, pal[:, ch])

    out = np.clip(rgb * shade, 0, 255).astype(np.uint8)
    return _encode_png(out)
