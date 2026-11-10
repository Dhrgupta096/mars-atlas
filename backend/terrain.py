"""Mars terrain from NASA MGS MOLA MEGDR (32 px/deg, ~1.85 km/px), heights in metres vs the Mars areoid.
File: data/mola_32ppd.img — big-endian int16, row 0 = 90°N, col 0 = 0°E, east-positive.
"""
from pathlib import Path
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
