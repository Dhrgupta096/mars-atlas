"""Mars terrain from NASA MGS MOLA MEGDR (32 px/deg, ~1.85 km/px), heights in metres vs the Mars areoid.
File: data/mola_32ppd.img — big-endian int16, row 0 = 90°N, col 0 = 0°E, east-positive.
"""
from functools import lru_cache
from pathlib import Path
import struct
import zlib
import numpy as np

PPD = 32
DEM = np.memmap(Path(__file__).parent.parent / "data" / "mola_32ppd.img", dtype=">i2", mode="r", shape=(180 * PPD, 360 * PPD))


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

_RUST_H = np.array([-7000.0, -3800.0, -1500.0, 800.0, 3500.0, 8000.0, 16000.0])
_RUST_RGB = np.array([
    [52, 28, 20],     # deep basalt depression
    [94, 43, 27],     # northern plains dark rust
    [142, 63, 36],    # mid-elevation oxide
    [186, 88, 48],    # Martian rust highland
    [214, 118, 68],   # bright ochre plateau
    [232, 156, 104],  # sunlit volcanic flank
    [245, 204, 168],  # summit dust
], dtype=np.float32)


def _encode_png(rgb: np.ndarray) -> bytes:
    h, w, _ = rgb.shape
    raw = np.concatenate([np.zeros((h, 1), dtype=np.uint8), rgb.reshape(h, w * 3)], axis=1).tobytes()
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, level=1)) + chunk(b"IEND", b"")


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

    c0 = c_flt.astype(np.int32) % DEM.shape[1]
    c1 = (c0 + 1) % DEM.shape[1]
    dc = (c_flt - np.floor(c_flt))[None, :]

    z00 = DEM[r0[:, None], c0[None, :]].astype(np.float32)
    z01 = DEM[r0[:, None], c1[None, :]].astype(np.float32)
    z10 = DEM[r1[:, None], c0[None, :]].astype(np.float32)
    z11 = DEM[r1[:, None], c1[None, :]].astype(np.float32)
    grid = (1 - dr) * ((1 - dc) * z00 + dc * z01) + dr * ((1 - dc) * z10 + dc * z11)

    h = grid[1:-1, 1:-1]
    step_deg = max((lat_n - lat_s) / size, 1e-4)
    step_m = step_deg * (3396000.0 * np.pi / 180.0)
    dzdx = (grid[1:-1, 2:] - grid[1:-1, :-2]) / (2.0 * step_m)
    dzdy = (grid[:-2, 1:-1] - grid[2:, 1:-1]) / (2.0 * step_m)

    exag = 4.5 if mode == "themis" else 3.5
    nx, ny, nz = -dzdx * exag, -dzdy * exag, np.ones_like(h)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    # NW illumination (azimuth 315°, altitude 38°)
    shade = (-0.55 * nx + 0.55 * ny + 0.62 * nz) / norm
    shade = np.clip(0.32 + 0.82 * shade, 0.22, 1.18)[:, :, None]

    knots, pal = (_ELEV_H, _ELEV_RGB) if mode == "elevation" else (_RUST_H, _RUST_RGB)
    rgb = np.empty((size, size, 3), dtype=np.float32)
    for ch in range(3):
        rgb[:, :, ch] = np.interp(h, knots, pal[:, ch])

    out = np.clip(rgb * shade, 0, 255).astype(np.uint8)
    return _encode_png(out)
