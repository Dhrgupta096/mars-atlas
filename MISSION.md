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
- [ ] 10/14: interactive elevation profile chart along the route
- [ ] 11/14: real NASA rover traverse paths (Perseverance & Curiosity)
- [ ] 12/14: water ice & hydrated mineral resource layer
- [ ] 13/14: walk-back safety limit ring
- [ ] 14/14: helmet HUD visor mode (first-person 3D view)
