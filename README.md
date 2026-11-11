# MARS / ATLAS — Interplanetary Survival Guide: Martian Map

**2026 NASA Space Apps Challenge Submission** · [Challenge Brief](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/)

**In one line:** A multi-mission 3D Martian EVA (Marswalk) planning console, forearm wrist-cuff checklist, and first-person spacesuit helmet HUD built from real NASA orbital & rover datasets.

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

First-time setup on a new machine:
```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
cd frontend && npm install
```

---

## 60-Second Judge Walkthrough

1. **Launch & High-Res 3D Mars Globe (`Console` Mode)**
   - Use the **Quick-Start Hub** on the top-left to jump to **Jezero**, **Gale**, **Olympus Mons**, or **Valles Marineris**, or switch between **Imagery** (Viking Color + automatic 100 m/px THEMIS IR detail on zoom), **THEMIS 100m** (MOLA Topography + THEMIS IR Day 100m blend), and **Elevation** (MGS MOLA + ESA HRSC shaded relief).
2. **Plan a Multi-Route Marswalk (EVA)**
   - Click **Jezero Delta EVA** (or click any two points **A** and **B** anywhere on Mars).
   - Compare 3 computed routes on the 3D globe and in the right-hand dock:
     - **Direct** (white dashed great-circle path)
     - **Safest** (green A* path that blocks slopes $>20^\circ$ and minimizes steep terrain)
     - **High Science** (gold A* path that detours across exposed $8^\circ\text{–}14^\circ$ bedrock benches and places numbered Apollo-style science stations **`S1`–`S3`**)
   - Toggle **Crew & Suit Configuration** (`8h PLSS` · `10h xEMU` · `Buddy Rovers`) to see how suit oxygen capacity and the **Apollo 4-hour emergency walk-back rule** (`6 km` foot ring / `12 km` rover ring) govern mission feasibility.
3. **Inspect Surface Photos, Elevation Profile, & Timed Cuff Manifest**
   - Switch to the **Stops** tab to trace the interactive SVG elevation profile on the 3D globe and open real **NASA Perseverance / Curiosity Mastcam-Z ground photos** (`PIA25287`, `PIA24924`, `PIA19920`, etc.).
   - Switch to the **Checklist** tab to check off timed steps (`EVA-A` $\rightarrow$ `S1..S3` $\rightarrow$ `OBJ-B` $\rightarrow$ `RTB-A`) and click **Download EVA Mission Brief (`.txt`)**.
4. **Switch Crew Formats (`Console` · `Wrist Cuff` · `Visor HUD`)**
   - Click **Wrist Cuff** in the bottom-right bar for the astronaut's forearm checklist view.
   - Click **Visor HUD** for the first-person spacesuit helmet view (`1.8 km` altitude, `-14°` pitch, forward azimuth bearing, compass heading tape, live `O2 RESERVE` bar, and waypoint stepper).

---

## NASA Open Datasets & Algorithms Used

| Layer / System | Dataset / Algorithm | Resolution / Source |
|---|---|---|
| **Global Topography & Slope** | NASA MGS MOLA MEGDR (`mola_32ppd.img`) | `32 px/deg` (~`1.85 km/px`), PDS Geosciences Node |
| **High-Res Thermal & Surface Detail** | NASA Mars Odyssey THEMIS IR Day Global Mosaic v12 (`THEMIS`, `MOLA_THEMIS_blend`) | `100 m/px`, NASA / JPL / ASU / USGS Astrogeology WMS |
| **Color & Shaded Relief Base Maps** | Viking MDIM 2.1 Color Mosaic + MOLA/HRSC Blended Hillshade | `232 m/px` – `463 m/px`, NASA Mars Trek WMTS & USGS |
| **Rover Traverse Tracks** | NASA Mars 2020 **Perseverance** (`46.1 km`, Sol 2022) & MSL **Curiosity** (`38.2 km`) | Real GeoJSON coordinates from NASA JPL MMGIS |
| **Surface Camera Imagery** | NASA Mastcam-Z, Navcam & Mastcam (`PIA24486`, `PIA24542`, `PIA24924`, `PIA25287`, `PIA16101`, `PIA19803`, `PIA19920`, `PIA21719`) | NASA Image and Video Library (`images-assets.nasa.gov`) |
| **Water Ice & ISRU Resources** | NASA SWIM, MRO SHARAD, Odyssey MONS, and MRO CRISM hydrated mineral catalog | Curated planetary resource zones + proximity assessment |
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
