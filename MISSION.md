# Mission — read this before every step

**Challenge:** NASA Space Apps 2026 — *Interplanetary Survival Guide: Martian Map*
https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/

**In one line:** a layered map, built from multiple NASA missions' data, that helps astronauts **plan and carry out a safe, science-rich Marswalk (EVA)**.

## Must answer (judges look for these)
1. A science goal + a place on Mars to do it
2. Data layered from multiple NASA missions (MOLA height, HiRISE/CTX images, CRISM minerals…)
3. Route planning that weighs **safety** (slope, cliffs, sand), **science value**, and **limits** (distance, time, suit oxygen)
4. **"Why this route?"**: explain the trade-offs (safest vs fastest vs most science)

## Our extras (from the "Potential Considerations")
- Three formats: habitat console (main), tablet, **helmet HUD** ⭐
- Works anywhere on Mars; high detail where NASA has sharp data
- Apollo-style numbered science stops and a timed plan
- Choose a future walk date (sunrise/sunset from the Mars clock)
- Rover photos + ground-level preview at each stop
- Walk vs pressurised rover; crew pairs; **walk-back safety limit**

## Progress
- [x] 3D Mars globe, NASA imagery + elevation layers, search, landing sites
- [x] Live Mars clock (Mars24, tested), local solar time, sunrise/sunset
- [x] Logo → back to full globe
- [x] Route planner 1/8: click → pin + coordinates
- [x] 2/8: download NASA height data (MOLA 32 px/deg, verified)
- [x] 3/8: height at a point
- [x] 4/8: slope at a point (+ safe / caution / too steep)
- [x] 5/8: start pin A + end pin B
- [x] 6/8: straight line + distance (+ climb, descent, steepest point)
- [x] 7/8: safest path (A*, blocks >20°, widens search if walled in)
- [x] 8/8: route info panel (walk/rover round-trip time, 8h EVA check, "Why this route?")
- [x] 9/14: 3rd route — "High Science" path (weighs geological targets + terrain, Apollo stations S1–S3)
- [x] 10/14: interactive elevation profile chart along the route (hover traces 3D globe)
- [x] 11/14: real NASA rover traverse paths (Perseverance 46.1 km Sol 2022 & Curiosity 38.2 km from NASA JPL MMGIS)
- [x] 12/14: water ice & hydrated mineral resource layer (SWIM, SHARAD, MONS, CRISM + ISRU assessment)
- [x] 13/14: walk-back safety limit ring (6 km foot EVA ring, 12 km Apollo rover walk-back ring, 4h B→A emergency check)
- [x] 14/14: helmet HUD visor mode (first-person 3D view, compass heading tape, PLSS O2 reserve & walk-back telemetry, waypoint stepper)

## Today's Tasks (Phase 2 — Operational Polish & Judge-Winning Extras)
- [x] 15/18: future EVA date & daylight window planner (pick any future UTC date/time, compute future Sol/Ls/sunrise/sunset, dust-storm season warning, + LIVE reset)
- [ ] 16/18: rover surface photos & station field previews (real NASA Perseverance/Curiosity ground imagery & geological context at waypoints and stations S1–S3)
- [ ] 17/18: timed Apollo EVA cuff checklist & mission manifest (step-by-step timeline from Egress A → S1..S3 → B → Ingress A, 20-min science stops, O2 budget, exportable brief)
- [ ] 18/18: 3-format crew interface switcher (Habitat Console · Wrist Tablet Cuff · Helmet Visor HUD)
