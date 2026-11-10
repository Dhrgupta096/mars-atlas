"""Run: python test_mars_time.py  (checks against published Mars24 / mission values)"""
from datetime import datetime, timezone
from mars_time import mars_time

utc = lambda *a: datetime(*a, tzinfo=timezone.utc)

# Mars24 worked example, 2000-01-06 00:00 UTC: Ls 277.18758, MTC 23:59:39
t = mars_time(utc(2000, 1, 6))
assert abs(t["ls"] - 277.188) < 0.01, t["ls"]
assert t["mtc"] == "23:59:39", t["mtc"]

# Curiosity landing 2012-08-06 05:17 UTC: Mars Year 31, Ls ~150.7
t = mars_time(utc(2012, 8, 6, 5, 17, 57))
assert t["mars_year"] == 31 and abs(t["ls"] - 150.7) < 0.3, t

# Mars Year boundaries (Ls=0): MY38 began 2024-11-12, MY39 began 2026-09-30
assert mars_time(utc(2024, 11, 10))["mars_year"] == 37
assert mars_time(utc(2024, 11, 14))["mars_year"] == 38
assert mars_time(utc(2026, 9, 28))["mars_year"] == 38
assert mars_time(utc(2026, 10, 2))["mars_year"] == 39

# Local time shifts 1 h per 15° east
a, b = mars_time(utc(2000, 1, 6), lon=0), mars_time(utc(2000, 1, 6), lon=15)
assert round((b["ltst_hours"] - a["ltst_hours"]) % 24, 3) == 1.0

print("all mars_time checks passed")
