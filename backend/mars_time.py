"""Mars time from NASA GISS Mars24 (Allison & McEwen 2000).
https://www.giss.nasa.gov/tools/mars24/help/algorithm.html
Longitudes are planetocentric, east-positive, degrees.
"""
from datetime import datetime, timezone
from math import asin, acos, cos, sin, tan, radians, degrees, floor

_LEAP = [  # (UTC unix time the count took effect, TAI-UTC seconds)
    (915148800, 32), (1136073600, 33), (1230768000, 34),
    (1341100800, 35), (1435708800, 36), (1483228800, 37),
]


def _tt_minus_utc(unix: float) -> float:
    # ponytail: table starts 1999 (pre-1999 uses 32 s, off by up to ~22 s before 1972); append here if IERS adds a leap second
    return 32.184 + max([s for t, s in _LEAP if unix >= t], default=32)


SOL_RATIO = 1.0274912517  # Mars sol / Earth day
MY1_START_JD = 2435208.5  # Mars Year 1 began 1955-04-11 (Clancy et al. 2000)
MARS_YEAR_DAYS = 686.9725

_PBS = [  # (A, tau, phi) planetary perturbation terms
    (0.0071, 2.2353, 49.409), (0.0057, 2.7543, 168.173), (0.0039, 1.1177, 191.837),
    (0.0037, 15.7866, 21.736), (0.0021, 2.1354, 15.704), (0.0020, 2.4694, 95.528),
    (0.0018, 32.8493, 49.095),
]


def _hms(hours: float) -> str:
    s = round((hours % 24) * 3600) % 86400
    return f"{s // 3600:02d}:{s // 60 % 60:02d}:{s % 60:02d}"


def mars_time(when: datetime | None = None, lon: float = 0.0, lat: float = 0.0) -> dict:
    when = when or datetime.now(timezone.utc)
    unix = when.timestamp()
    jd_tt = 2440587.5 + (unix + _tt_minus_utc(unix)) / 86400
    dt = jd_tt - 2451545.0

    m = radians(19.3871 + 0.52402073 * dt)
    alpha_fms = 270.3871 + 0.524038496 * dt
    pbs = sum(a * cos(radians(0.985626 * dt / tau + phi)) for a, tau, phi in _PBS)
    nu_m = ((10.691 + 3.0e-7 * dt) * sin(m) + 0.623 * sin(2 * m) + 0.050 * sin(3 * m)
            + 0.005 * sin(4 * m) + 0.0005 * sin(5 * m) + pbs)
    ls = (alpha_fms + nu_m) % 360
    lsr = radians(ls)
    eot = 2.861 * sin(2 * lsr) - 0.071 * sin(4 * lsr) + 0.002 * sin(6 * lsr) - nu_m  # degrees

    msd = (jd_tt - 2451549.5) / SOL_RATIO + 44796.0 - 0.0009626
    mtc = (24 * msd) % 24
    lmst = (mtc + lon / 15) % 24
    ltst = (lmst + eot / 15) % 24
    dec = degrees(asin(0.42565 * sin(lsr))) + 0.25 * sin(lsr)

    # Mars Year: count from MY1, then fix rounding near Ls=0 using the actual Ls
    years = (jd_tt - MY1_START_JD) / MARS_YEAR_DAYS
    my, frac = floor(years) + 1, years % 1
    if frac > 0.9 and ls < 90:
        my += 1
    elif frac < 0.1 and ls > 270:
        my -= 1

    # ponytail: geometric sunrise/sunset (sun centre on horizon, no refraction or terrain); fine for EVA planning to ~minutes
    x = -tan(radians(lat)) * tan(radians(dec))
    polar = "polar day" if x <= -1 else "polar night" if x >= 1 else None
    h0 = degrees(acos(x)) / 15 if polar is None else None  # half-day length, hours
    is_day = polar == "polar day" or (h0 is not None and abs(ltst - 12) < h0)

    season = ["spring", "summer", "autumn", "winter"][int(ls // 90)]
    return {
        "utc": when.astimezone(timezone.utc).isoformat(),
        "mars_year": my,
        "sol_date": round(msd, 5),
        "ls": round(ls, 3),
        "season_north": season,
        "season_south": ["autumn", "winter", "spring", "summer"][int(ls // 90)],
        "mtc": _hms(mtc),
        "lmst": _hms(lmst),
        "ltst": _hms(ltst),
        "ltst_hours": round(ltst, 4),
        "is_day": is_day,
        "sunrise_ltst": _hms(12 - h0) if h0 is not None else None,
        "sunset_ltst": _hms(12 + h0) if h0 is not None else None,
        "polar": polar,
        "solar_declination": round(dec, 3),
        "lon": lon,
        "lat": lat,
    }
