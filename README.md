# MARS / ATLAS — Interplanetary Survival Guide: Martian Map

**2026 NASA Space Apps Challenge Submission** · [Challenge Brief](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/)

**In one line:** A multi-mission 3D Martian EVA (Marswalk) planning console, 5-layer planetary & geochemical 3D globe (`Viking`, `THEMIS 100m`, `Night-IR`, `MOLA Elevation`, and `Odyssey GRS + TES DCI Elements`), NASA Eyes-style 3D orbital telemetry tracker (`MRO`, `TGO`, `Odyssey`), space-weather & dust-storm emergency survival simulator, 5-node habitat microgrid builder, forearm wrist-cuff checklist, and first-person spacesuit helmet HUD built from real NASA & ESA planetary datasets.

---

## Quick Start

### Option A — Development (2 terminals, live reload)
```bash
# 1. Backend (Python / FastAPI) -> http://127.0.0.1:8000/docs
cd backend && ../.venv/bin/uvicorn main:app --reload --port 8000

# 2. Frontend (React + CesiumJS + Vite) -> http://localhost:5173
cd frontend && npm run dev
```

### Option B — Single-Command Production Server
After building the frontend (`cd frontend && npm run build`), FastAPI automatically serves the compiled 3D web app and all `/api/*` endpoints together on port `8000`:
```bash
cd backend && ../.venv/bin/uvicorn main:app --port 8000
# Open http://localhost:8000
```

### Option C — Docker & 1-Click Cloud Deployment (Render / Railway / Fly.io)
A multi-stage [Dockerfile](file:///Users/dhruvgupta/.gemini/antigravity/scratch/mars-map/Dockerfile) and [render.yaml](file:///Users/dhruvgupta/.gemini/antigravity/scratch/mars-map/render.yaml) are included at the repository root. The container builds the React/CesiumJS frontend, automatically fetches the NASA PDS MGS MOLA 32ppd global DEM (`data/mola_32ppd.img`) if not mounted, and serves the unified production app:
```bash
docker build -t mars-atlas .
docker run -p 8000:8000 mars-atlas
```

First-time local setup on a new machine:
```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
cd frontend && npm install
```

---

## Core Capabilities

### 1. 5-Layer 3D Planetary & Geochemical Globe (`1`–`5`) + Real 3D MOLA Mesh
- **5 Authentic Global Map Layers:**
  1. **`Imagery` (`1`):** NASA Viking MDIM 2.1 global color mosaic (`232 m/px`) fused with MOLA shaded relief.
  2. **`THEMIS 100m` (`2`):** USGS Astrogeology / Mars Odyssey THEMIS IR Day (`100 m/px`) blended with MOLA topography.
  3. **`Night-IR` (`3`):** Full-globe (`90°S` to `90°N`) thermal inertia greyscale relief showing heat-retaining exposed bedrock vs. rapid-cooling fine dust traps.
  4. **`Elevation` (`4`):** MGS MOLA 32ppd hypsometric tinting (`-7,500 m` Hellas basin blue to `+21,229 m` Olympus Mons summit white).
  5. **`Elements` (`5`):** Mars Odyssey **Gamma Ray Spectrometer (GRS)** + MGS **TES Dust Cover Index (DCI)** geochemical globe (`data/GRS_DCI_Data.xlsx` · `Gamma_Maps_Modified`, `1,451` $5^\circ \times 5^\circ$ centroids across 29 columns). Switch live between **`Fe`**, **`H₂O`**, **`Si`**, **`S`**, **`Cl`**, **`K`**, **`Th`**, **`Al`**, **`Ca`**, and **`DCI`** (`-2.5σ` depleted to `+2.5σ` enriched).
- **Real Inclined 3D Orbits:** Renders live 3D orbital rings and moving spacecraft markers for **MRO** (`280 km`, `92.7°`, `112 min`), **ESA/NASA Trace Gas Orbiter (`TGO`)** (`400 km`, `74.0°`, `120 min`), and **2001 Mars Odyssey** (`380 km`, `93.1°`, `118 min`).
- **`Ride 3D →` Spacecraft Camera:** Click `Ride 3D →` next to any orbiter in the left dock to ride alongside the spacecraft in orbit above Mars.
- **3D UHF Comm-Link Uplink Beam & MRO Sensor Swath:** Projects a live 3D nadir sensor cone and ground footprint ring beneath MRO plus a glowing 3D cyan UHF relay beam connecting the surface EVA crew or Habitat Base to the nearest relay orbiter.
- **Time Rate Scrubber (`1×` · `60×` · `300×`):** Speed up orbital motion and watch the Mars24 day/night terminator sweep across the planet in real time.
- **Martian Amber Limb Atmosphere:** Physically tuned `SkyAtmosphere` butterscotch-amber limb scattering and solar glow on the 3D Mars ellipsoid (`3,396.19 km` equatorial / `3,376.20 km` polar radii).

### 2. Multi-Route EVA Planner (`Direct` · `Safest` · `High Science`)
- **3 Simultaneous Routes over MGS MOLA 32ppd DEM:**
  - **Direct** (white dashed great-circle path)
  - **Safest** (green 8-connected A* path that blocks slopes $>20^\circ$ and minimizes steep terrain)
  - **High Science** (gold A* path that detours across exposed $8^\circ\text{–}14^\circ$ bedrock benches and places numbered Apollo-style science stations **`S1`–`S3`**)
- **3D Terrain Elevation Curtain & Interactive SVG Profile:** Renders a translucent 3D elevation wall beneath the active route and syncs hover distance/elevation between the 2D SVG chart and the 3D globe.
- **Crew & Suit Configurations:** Switch between `8h PLSS` (2-Crew Foot EVA), `10h xEMU` (Extended Foot EVA), and `Buddy Rovers` (4-Crew Dual Pressurized Rovers) to evaluate the **Apollo 4-hour emergency walk-back rule** (`6 km` foot ring / `12 km` rover ring), **VHF Habitat Line-of-Sight**, and **MSL RAD Radiation Dose (`mSv`)**.

### 3. Dynamic Space Weather & Dust Storm Survival Simulator
- **`Nominal` · `Dust τ=3.8` · `Solar Flare S3`:**
  - **Regional Dust Storm (`τ = 3.8`):** Cuts surface visibility to `0.6 km`, drops solar array output to `22%`, penalizes rover speed (`-45%`), and intensifies atmospheric dust haze.
  - **Solar Particle Event (`S3 Flare`):** Simulates a `18.5×` solar proton radiation spike (`~388 μSv/h`), computes the nearest high-relief bedrock escarpment/alcove (`[SHELTER]`) along the EVA path (`68–88%` rock hemisphere shielding), renders a 3D amber shelter beacon and dash line, and provides a 1-click **`Fly to Shelter →`** abort action.

### 4. Habitat Base Builder & Multi-Node Microgrid Planner
- Switch the top-left planner toggle to **`Base Builder`** to drop chained Martian outpost modules anywhere on Mars (or click **`Deploy Jezero 5-Node Outpost`**):
  - **`HAB-1`** (`6-Crew Pressurized Surface Habitat`, `-12 kW`)
  - **`KRUSTY`** (`40 kW Kilopower Fission Surface Power Array`, `+40 kW`)
  - **`ISRU-1`** (`Subsurface Ice Drill & Sabatier Plant`, `-18 kW`, `+45 L/sol H2O`, `+12 kg/sol O2/CH4`)
  - **`COMM-1`** (`High-Gain X-Band / UHF Relay Mast`, `-3 kW`)
  - **`LAB-1`** (`Pressurized Astrobiology & Core Sample Lab`, `-6 kW`)
- Each module queries real MOLA elevation and slope at its landing coordinates and links into a 3D surface microgrid with live net power (`kW`), water (`L/sol`), and propellant/oxygen (`kg/sol`) accounting.

### 5. Three Crew Interface Formats (`Console` · `Wrist Cuff` · `Visor HUD`)
- **`Console`:** Full orbital mission planning workstation with shareable URL hash permalinks (`Copy Link ⎘`) and downloadable `.txt` EVA Mission Briefs.
- **`Wrist Cuff`:** Compact astronaut forearm checklist with checkable timeline steps (`EVA-A` $\rightarrow$ `S1..S3` $\rightarrow$ `OBJ-B` $\rightarrow$ `RTB-A`), live `O2` countdown, and 1-click NASA Mastcam-Z ground photo inspection.
- **`Visor HUD`:** First-person spacesuit helmet view (`1.8 km` altitude, `-14°` pitch, forward azimuth bearing, compass heading tape, live `O2 RESERVE` bar, GCR radiation counter, and waypoint stepper).

---

## NASA & ESA Open Datasets & Algorithms Used

| Layer / System | Dataset / Algorithm | Resolution / Source |
|---|---|---|
| **Global Topography & Slope** | NASA MGS MOLA MEGDR (`mola_32ppd.img`) | `32 px/deg` (~`1.85 km/px`), PDS Geosciences Node |
| **High-Res Thermal & Surface Detail** | NASA Mars Odyssey THEMIS IR Day Global Mosaic v12 (`THEMIS`, `MOLA_THEMIS_blend`) | `100 m/px`, NASA / JPL / ASU / USGS Astrogeology WMS |
| **Color & Shaded Relief Base Maps** | Viking MDIM 2.1 Color Mosaic + MOLA/HRSC Blended Hillshade | `232 m/px` – `463 m/px`, NASA Mars Trek WMTS & USGS |
| **Orbital Relay Ephemeris** | NASA `MRO` (`280 km`, `92.7°`), ESA/NASA `TGO` (`400 km`, `74.0°`), NASA `Mars Odyssey` (`380 km`, `93.1°`) | Keplerian inclined orbital propagation inspired by NASA Eyes |
| **Rover Traverse Tracks** | NASA Mars 2020 **Perseverance** (`46.1 km`, Sol 2022) & MSL **Curiosity** (`38.2 km`) | Real GeoJSON coordinates from NASA JPL MMGIS |
| **Surface Camera Imagery** | NASA Mastcam-Z, Navcam & Mastcam (`PIA24486`, `PIA24542`, `PIA24924`, `PIA25287`, `PIA16101`, `PIA19803`, `PIA19920`, `PIA21719`) | NASA Image and Video Library (`images-assets.nasa.gov`) |
| **Water Ice & ISRU Resources** | NASA SWIM, MRO SHARAD, Odyssey MONS, and MRO CRISM hydrated mineral catalog | Curated planetary resource zones + proximity assessment |
| **Radiation & Space Weather** | MSL Curiosity **RAD** surface dosimetry model (`21 μSv/h` GCR baseline, elevation scaling, `S3 SPE` proton spike & rock shelter shielding) | Hassler et al. (2014) *Science* / MSL RAD |
| **Mars Time & Solar Geometry** | NASA GISS **Mars24** algorithm (Allison & McEwen 2000) | Live & future UTC $\rightarrow$ MSD, MTC, MY, Sol, $L_s$, LTST, sunrise/sunset, dust season ($L_s \in [180^\circ, 330^\circ]$) |
| **EVA Route & Energy Modeling** | Tobler's hiking function scaled for suited Martian EVA (`3 km/h` flat walk, `10 km/h` rover) + 8-connected A* over MOLA slope/outcrop grids | Blocks slopes $>20^\circ$; enforces Apollo emergency walk-back limits |

---

## Running the Automated Test Suite

```bash
cd backend
for f in test_*.py; do ../.venv/bin/python "$f" || exit 1; done

cd ../frontend
npm run lint && npm run build
```
