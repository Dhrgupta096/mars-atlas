"""Marswalk routes.
Step 6: straight great-circle line A→B.  Step 7: safest path (A* over a slope-cost grid).
Step 8: walk/rover times, 8 h EVA check, "Why this route?".
"""
import heapq
from math import ceil, hypot
import numpy as np
from terrain import DEM, PPD, elevation, slope, risk, PIXEL_M

MARS_R = 3389500.0  # mean radius, metres (IAU)
MAX_SLOPE = 20.0    # blocked above this — same line our risk scale calls "too steep" (Apollo LRV spec was 25°)
MAX_GRID = 400      # A* grid edge; bigger areas are downsampled
WALK_FLAT_KMH = 3.0   # assumed suited walking speed on flat ground
ROVER_FLAT_KMH = 10.0 # unpressurised rover cruise (Apollo LRV averaged ~8–10 km/h)
EVA_HOURS = 8         # suit time per EVA (ISS EMU nominal)
WALKBACK_HOURS = 4.0  # Apollo emergency walk-back suit O₂ reserve if rover fails at B


def _unit(lat, lon):
    la, lo = np.radians(lat), np.radians(lon)
    return np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])


def distance_m(lat1, lon1, lat2, lon2) -> float:
    a, b = _unit(lat1, lon1), _unit(lat2, lon2)
    return float(MARS_R * np.arctan2(np.linalg.norm(np.cross(a, b)), np.dot(a, b)))


def straight_line(lat1, lon1, lat2, lon2, max_samples=2000) -> dict:
    a, b = _unit(lat1, lon1), _unit(lat2, lon2)
    d = distance_m(lat1, lon1, lat2, lon2)
    n = int(min(max(d / PIXEL_M, 2), max_samples)) + 1  # ~1 sample per DEM pixel
    ang = d / MARS_R
    t = np.linspace(0, 1, n)[:, None]
    w1, w2 = (np.sin((1 - t) * ang) / np.sin(ang), np.sin(t * ang) / np.sin(ang)) if ang > 1e-9 else (1 - t, t)
    pts = w1 * a + w2 * b  # slerp along the great circle
    lats = np.degrees(np.arcsin(np.clip(pts[:, 2] / np.linalg.norm(pts, axis=1), -1, 1)))
    lons = np.degrees(np.arctan2(pts[:, 1], pts[:, 0]))
    return _analyse(lats, lons, d)


def _hours(seg_m, grade) -> tuple[float, float]:
    """Walking and rover hours over segments with signed grades (rise/run).
    ponytail: Tobler's hiking function scaled to 3 km/h suited flat speed; rover 10 km/h slowing linearly to 20% at 25°.
    No Mars-gravity or suit-mobility correction yet — swap in NASA EVA analog data (Desert RATS) when we have it.
    """
    walk_kmh = WALK_FLAT_KMH / 5.036 * 6 * np.exp(-3.5 * np.abs(grade + 0.05))
    rover_kmh = ROVER_FLAT_KMH * np.clip(1 - np.degrees(np.arctan(np.abs(grade))) / 25, 0.2, 1)
    km = seg_m / 1000
    return float((km / walk_kmh).sum()), float((km / rover_kmh).sum())


def _sci_exposure(slopes: np.ndarray) -> np.ndarray:
    """Geological outcrop/contact exposure (0..1): 0 on flat dust (0°) and cliffs (>=20°), peaks at 10° bedrock benches."""
    return (np.sin(np.pi * np.clip(slopes, 0, MAX_SLOPE) / MAX_SLOPE) ** 0.7) * (slopes <= MAX_SLOPE)


def _stations(lats: np.ndarray, lons: np.ndarray, heights: np.ndarray, slopes: np.ndarray, k: int = 3) -> list[dict]:
    """Pick up to k well-spaced Apollo-style science stations at top outcrop exposures along the path."""
    n = len(lats)
    if n < 3:
        return []
    exp = _sci_exposure(slopes)
    picked = []
    min_gap = max(1, n // (k + 1))
    for idx in np.argsort(-exp):
        i = int(idx)
        if 0 < i < n - 1 and all(abs(i - j) >= min_gap for j in picked):
            picked.append(i)
            if len(picked) == k:
                break
    picked.sort()
    meta = lambda s: (
        ("Layered Outcrop", "PIA25287", "Mastcam-Z / SHERLOC · Core drill & UV Raman scan of laminated strata") if s >= 8 else
        ("Geologic Contact", "PIA19803", "Mastcam / PIXL · X-ray lithochemistry across unconformity contact") if s >= 3 else
        ("Regolith Sample", "PIA24542", "SuperCam / Drive Tube · Regolith & basaltic float cobble sample")
    )
    return [
        {
            "id": f"S{m + 1}",
            "idx": i,
            "kind": meta(float(slopes[i]))[0],
            "pia": meta(float(slopes[i]))[1],
            "image": f"https://images-assets.nasa.gov/image/{meta(float(slopes[i]))[1]}/{meta(float(slopes[i]))[1]}~small.jpg",
            "task": meta(float(slopes[i]))[2],
            "lat": round(float(lats[i]), 4),
            "lon": round(float(lons[i]), 4),
            "elevation_m": int(heights[i]),
            "slope_deg": round(float(slopes[i]), 1),
            "science_score": round(float(exp[i] * 100)),
        }
        for m, i in enumerate(picked)
    ]


def _hm(hours: float) -> str:
    m = round(max(hours, 0.0) * 60)
    return f"T+{m // 60:02d}:{m % 60:02d}"


def _manifest(lats, lons, heights, seg, grade, walk_back: float, rover_back: float, stations: list[dict]) -> list[dict]:
    """Apollo-style timed EVA cuff checklist: Airlock Egress A -> Science Stops S1..S3 (+15m each) -> Dest B (+20m) -> Ingress A."""
    steps = [{
        "code": "EVA-A", "title": "Airlock Egress · Start A",
        "lat": round(float(lats[0]), 4), "lon": round(float(lons[0]), 4), "elevation_m": int(heights[0]),
        "km": 0.0, "walk_t": "T+00:00", "rover_t": "T+00:00", "o2_walk_h": 8.0, "o2_rover_h": 8.0,
        "action": "PLSS suit integrity check (4.3 PSI), comm link sync, egress habitat airlock",
    }]
    w_cum = r_cum = d_cum = 0.0
    prev = 0
    for st in stations:
        idx = st["idx"]
        dw, dr = _hours(seg[prev:idx], grade[prev:idx]) if idx > prev else (0.0, 0.0)
        d_cum += float(seg[prev:idx].sum()) / 1000 if idx > prev else 0.0
        w_cum += dw
        r_cum += dr
        steps.append({
            "code": st["id"], "title": f"Station {st['id']} · {st['kind']}",
            "lat": st["lat"], "lon": st["lon"], "elevation_m": st["elevation_m"],
            "km": round(d_cum, 2), "walk_t": _hm(w_cum), "rover_t": _hm(r_cum),
            "o2_walk_h": round(max(8.0 - w_cum, 0.0), 1), "o2_rover_h": round(max(8.0 - r_cum, 0.0), 1),
            "action": f"15 min stop · {st['task']}",
        })
        w_cum += 0.25  # 15 min station sampling
        r_cum += 0.25
        prev = idx

    end = len(lats) - 1
    dw, dr = _hours(seg[prev:end], grade[prev:end]) if end > prev else (0.0, 0.0)
    d_cum += float(seg[prev:end].sum()) / 1000 if end > prev else 0.0
    w_cum += dw
    r_cum += dr
    steps.append({
        "code": "OBJ-B", "title": "Destination B · Primary Objective",
        "lat": round(float(lats[-1]), 4), "lon": round(float(lons[-1]), 4), "elevation_m": int(heights[-1]),
        "km": round(d_cum, 2), "walk_t": _hm(w_cum), "rover_t": _hm(r_cum),
        "o2_walk_h": round(max(8.0 - w_cum, 0.0), 1), "o2_rover_h": round(max(8.0 - r_cum, 0.0), 1),
        "action": "20 min stop · Primary site survey, subsurface core & ISRU assay",
    })
    w_cum += 1 / 3 + walk_back
    r_cum += 1 / 3 + rover_back
    steps.append({
        "code": "RTB-A", "title": "Return Traverse & Airlock Ingress A",
        "lat": round(float(lats[0]), 4), "lon": round(float(lons[0]), 4), "elevation_m": int(heights[0]),
        "km": round(d_cum * 2, 2), "walk_t": _hm(w_cum), "rover_t": _hm(r_cum),
        "o2_walk_h": round(max(8.0 - w_cum, 0.0), 1), "o2_rover_h": round(max(8.0 - r_cum, 0.0), 1),
        "action": "Return B→A, dust mitigation brush-down, ingress airlock & repressurise",
    })
    return steps


def _analyse(lats, lons, d) -> dict:
    """Shared stats for any path: climb, descent, steepest point, risk, travel times, science score & stations."""
    heights = np.array([elevation(la, lo) for la, lo in zip(lats, lons)])
    slopes = np.array([slope(la, lo) for la, lo in zip(lats, lons)])
    dh = np.diff(heights)
    worst = int(slopes.argmax())
    seg = np.array([distance_m(lats[k], lons[k], lats[k + 1], lons[k + 1]) for k in range(len(lats) - 1)])
    grade = np.divide(dh, seg, out=np.zeros_like(seg), where=seg > 0)
    walk_out, rover_out = _hours(seg, grade)
    walk_back, rover_back = _hours(seg, -grade)  # return trip: uphill and downhill swap
    exp = _sci_exposure(slopes)
    sci_score = round(float((0.4 * exp.mean() + 0.6 * np.percentile(exp, 80)) * 100))
    stations = _stations(lats, lons, heights, slopes)
    return {
        "distance_m": round(d),
        "climb_m": int(dh[dh > 0].sum()),
        "descent_m": int(-dh[dh < 0].sum()),
        "max_slope_deg": round(float(slopes[worst]), 1),
        "max_slope_at": {"lat": round(float(lats[worst]), 4), "lon": round(float(lons[worst]), 4)},
        "risk": risk(float(slopes[worst])),
        "walk_h": round(walk_out, 2),
        "walk_back_h": round(walk_back, 2),
        "walkback_ok": bool(walk_back <= WALKBACK_HOURS),
        "walk_round_trip_h": round(walk_out + walk_back, 2),
        "rover_h": round(rover_out, 2),
        "rover_round_trip_h": round(rover_out + rover_back, 2),
        "science_score": sci_score,
        "stations": stations,
        "manifest": _manifest(lats, lons, heights, seg, grade, walk_back, rover_back, stations),
        "path": [[round(float(la), 5), round(float(lo), 5)] for la, lo in zip(lats, lons)],
        "profile_m": heights.tolist(),
    }


def eva_plan(direct: dict, safe: dict | None, science: dict | None = None) -> dict:
    """Which way to travel + the plain-English 'Why this route?' line comparing Direct, Safest, and High Science."""
    if safe is None:
        return {"mode": "none", "why": f"Every way to B crosses slopes over {MAX_SLOPE:.0f}°. Pick a different destination."}
    if safe["walk_round_trip_h"] <= EVA_HOURS:
        mode, fit = "walk", f"Walking there and back takes {safe['walk_round_trip_h']:.1f} h, inside one {EVA_HOURS} h EVA."
    elif safe["rover_round_trip_h"] <= EVA_HOURS:
        wb = f"within the {WALKBACK_HOURS:.0f} h walk-back limit ({safe['walk_back_h']:.1f} h B→A)" if safe["walkback_ok"] else f"past the {WALKBACK_HOURS:.0f} h walk-back limit ({safe['walk_back_h']:.1f} h B→A; buddy rover required)"
        mode, fit = "rover", f"Too far to walk ({safe['walk_round_trip_h']:.1f} h round trip); by rover it's {safe['rover_round_trip_h']:.1f} h ({wb})."
    else:
        mode, fit = "expedition", f"Too far for one {EVA_HOURS} h EVA even by rover ({safe['rover_round_trip_h']:.1f} h). Needs a multi-sol expedition."
    extra_km = (safe["distance_m"] - direct["distance_m"]) / 1000
    if direct["risk"] == "too steep":
        why = f"Safest route avoids a {direct['max_slope_deg']}° cliff on the direct line (+{extra_km:.1f} km)."
    elif safe["max_slope_deg"] < direct["max_slope_deg"] - 2:
        why = f"Safest route cuts max slope from {direct['max_slope_deg']}° to {safe['max_slope_deg']}° (+{extra_km:.1f} km)."
    else:
        why = "Direct line is already gentle, so the safest route stays close to it."
    if science and science["science_score"] > safe["science_score"]:
        sci_km = (science["distance_m"] - direct["distance_m"]) / 1000
        why += f" Science route boosts outcrop yield from {safe['science_score']} to {science['science_score']}/100 (+{max(sci_km, 0):.1f} km vs direct, {len(science['stations'])} stations)."
    return {"mode": mode, "why": f"{why} {fit}"}


def safest_path(lat1, lon1, lat2, lon2) -> dict | None:
    """Search near A–B first; if walls block every way, widen the search area before giving up."""
    for spread in (0.5, 2, 5):
        p = _astar(lat1, lon1, lat2, lon2, spread, mode="safe")
        if p:
            return p
    return None


def science_path(lat1, lon1, lat2, lon2) -> dict | None:
    """High-science path: stays safe (<=20°) while detouring toward exposed bedrock outcrops & geologic contacts."""
    for spread in (0.6, 2, 5):
        p = _astar(lat1, lon1, lat2, lon2, spread, mode="science")
        if p:
            return p
    return None


def _astar(lat1, lon1, lat2, lon2, spread, mode="safe") -> dict | None:
    """A* over the MOLA grid around A and B. Cost = distance × (1 + (slope/10°)²); slopes > MAX_SLOPE are blocked.
    Returns None if every way is blocked.
    ponytail: 8-connected grid → slightly zig-zag paths; pure-Python A* (~1 s on 400²). Upgrade: path smoothing, scikit-image MCP.
    """
    nrows, ncols = DEM.shape
    lon2u = lon1 + ((lon2 - lon1 + 180) % 360 - 180)  # unwrap so we go the short way across 180°
    r1, c1 = (90 - lat1) * PPD, (lon1 % 360) * PPD
    r2, c2 = (90 - lat2) * PPD, c1 + (lon2u - lon1) * PPD
    pad = max(20, spread * max(abs(r2 - r1), abs(c2 - c1)))
    rmin, rmax = max(int(min(r1, r2) - pad), 0), min(int(max(r1, r2) + pad) + 1, nrows)
    cmin, cmax = int(min(c1, c2) - pad), int(max(c1, c2) + pad) + 1
    # Slope at full DEM resolution first, so thin cliffs can't hide between samples
    # ponytail: areas over 3000 px (~5,500 km) are pre-sampled before slope; fine for EVA-scale routes
    pre = max(1, ceil(max(rmax - rmin, cmax - cmin) / 3000))
    rows_f, cols_f = np.arange(rmin, rmax, pre), np.arange(cmin, cmax, pre)
    z = DEM[rows_f][:, cols_f % ncols].astype(float)
    dy_f = PIXEL_M * pre
    dx_f = dy_f * np.maximum(np.cos(np.radians(90 - (rows_f + 0.5) / PPD)), 0.01)
    gy, gx = np.gradient(z)
    s_f = np.degrees(np.arctan(np.hypot(gx / dx_f[:, None], gy / dy_f)))

    # Shrink to an A* grid of ≤ MAX_GRID cells per side; each cell keeps its STEEPEST slope (safe side)
    step = max(1, ceil(max(s_f.shape) / MAX_GRID))
    H, W = ceil(s_f.shape[0] / step), ceil(s_f.shape[1] / step)
    s = np.pad(s_f, ((0, H * step - s_f.shape[0]), (0, W * step - s_f.shape[1])), mode="edge")
    s = s.reshape(H, step, W, step).max(axis=(1, 3))
    rows, cols, k = rows_f[::step], cols_f[::step], pre * step
    dy, dx = dy_f * step, dx_f[::step] * step

    cell = lambda r, c: (min(max(round((r - rmin) / k), 0), H - 1), min(max(round((c - cmin) / k), 0), W - 1))
    start, goal = cell(r1, c1), cell(r2, c2)
    if start == goal:
        return straight_line(lat1, lon1, lat2, lon2)
    if mode == "science":
        # Mean slope for outcrop exposure so we target sustained geologic benches, while max slope `s` still blocks cliffs
        s_mean = np.pad(s_f, ((0, H * step - s_f.shape[0]), (0, W * step - s_f.shape[1])), mode="edge").reshape(H, step, W, step).mean(axis=(1, 3))
        mult = (1 + 5.0 * (1 - _sci_exposure(s_mean))).tolist()
    else:
        mult = (1 + (s / 10) ** 2).tolist()
    blocked = (s > MAX_SLOPE).tolist()
    blocked[start[0]][start[1]] = blocked[goal[0]][goal[1]] = False
    dxl, dxmin = dx.tolist(), float(dx.min())
    gi, gj = goal
    h = lambda i, j: hypot((i - gi) * dy, (j - gj) * dxmin)  # admissible: never overestimates

    best = {start: 0.0}
    came = {}
    heap = [(h(*start), 0.0, start)]
    while heap:
        _, g, (i, j) = heapq.heappop(heap)
        if (i, j) == goal:
            break
        if g > best[(i, j)]:
            continue
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                ni, nj = i + di, j + dj
                if (di or dj) and 0 <= ni < H and 0 <= nj < W and not blocked[ni][nj]:
                    ng = g + hypot(di * dy, dj * dxl[ni]) * (mult[i][j] + mult[ni][nj]) / 2
                    if ng < best.get((ni, nj), float("inf")):
                        best[(ni, nj)], came[(ni, nj)] = ng, (i, j)
                        heapq.heappush(heap, (ng + h(ni, nj), ng, (ni, nj)))
    else:
        return None

    cells = [goal]
    while cells[-1] != start:
        cells.append(came[cells[-1]])
    cells.reverse()
    lats = np.array([90 - (rows[i] + 0.5) / PPD for i, _ in cells])
    lons = np.array([((cols[j] + 0.5) / PPD + 180) % 360 - 180 for _, j in cells])
    lats[0], lons[0], lats[-1], lons[-1] = lat1, lon1, lat2, lon2
    d = sum(distance_m(lats[k], lons[k], lats[k + 1], lons[k + 1]) for k in range(len(lats) - 1))
    return _analyse(lats, lons, d)
