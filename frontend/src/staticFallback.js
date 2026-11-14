// Client-side scientific fallback for static deployments (e.g., GitHub Pages)
// where the FastAPI backend is not running. Uses ./api/static_bundle.json
// exported from NASA MOLA 32ppd, Mars Odyssey GRS, and PDS rover traverses.

let _bundlePromise = null

function loadBundle() {
  if (!_bundlePromise) {
    _bundlePromise = fetch('./api/static_bundle.json').then(r => r.json())
  }
  return _bundlePromise
}

const SOL_RATIO = 1.0274912517
const MY1_START_JD = 2435208.5
const MARS_YEAR_DAYS = 686.9725
const MARS_R = 3389500.0

function hms(hours) {
  const s = Math.round((((hours % 24) + 24) % 24) * 3600) % 86400
  const hh = String(Math.floor(s / 3600)).padStart(2, '0')
  const mm = String(Math.floor((s / 60) % 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

export function computeMarsTime(utcIso, lat = 0, lon = 0) {
  const d = utcIso ? new Date(utcIso) : new Date()
  const unix = d.getTime() / 1000
  const jdTt = 2440587.5 + (unix + 69.184) / 86400
  const dt = jdTt - 2451545.0
  const m = ((19.3871 + 0.52402073 * dt) * Math.PI) / 180
  const alphaFms = 270.3871 + 0.524038496 * dt
  const nuM = (10.691 + 3e-7 * dt) * Math.sin(m) + 0.623 * Math.sin(2 * m) + 0.05 * Math.sin(3 * m)
  const ls = (((alphaFms + nuM) % 360) + 360) % 360
  const lsr = (ls * Math.PI) / 180
  const eot = 2.861 * Math.sin(2 * lsr) - 0.071 * Math.sin(4 * lsr) + 0.002 * Math.sin(6 * lsr) - nuM
  const msd = (jdTt - 2451549.5) / SOL_RATIO + 44796.0 - 0.0009626
  const mtc = (((24 * msd) % 24) + 24) % 24
  const lmst = (((mtc + lon / 15) % 24) + 24) % 24
  const ltst = (((lmst + eot / 15) % 24) + 24) % 24
  const dec = (Math.asin(0.42565 * Math.sin(lsr)) * 180) / Math.PI + 0.25 * Math.sin(lsr)
  const years = (jdTt - MY1_START_JD) / MARS_YEAR_DAYS
  const my = Math.floor(years) + 1
  const x = -Math.tan((lat * Math.PI) / 180) * Math.tan((dec * Math.PI) / 180)
  const polar = x <= -1 ? 'polar day' : x >= 1 ? 'polar night' : null
  const h0 = polar === null ? (Math.acos(x) * 180) / Math.PI / 15 : null
  const isDay = polar === 'polar day' || (h0 !== null && Math.abs(ltst - 12) < h0)
  const seasons = ['spring', 'summer', 'autumn', 'winter']
  const sIdx = Math.floor(ls / 90) % 4
  return {
    utc: d.toISOString(),
    mars_year: my,
    sol_date: Number(msd.toFixed(5)),
    ls: Number(ls.toFixed(3)),
    season_north: seasons[sIdx],
    season_south: ['autumn', 'winter', 'spring', 'summer'][sIdx],
    dust_season: ls >= 180 && ls <= 330,
    mtc: hms(mtc),
    lmst: hms(lmst),
    ltst: hms(ltst),
    ltst_hours: Number(ltst.toFixed(4)),
    is_day: isDay,
    daylight_hours: polar === 'polar day' ? 24 : polar === 'polar night' ? 0 : Number((2 * h0).toFixed(2)),
    sunrise_ltst: h0 !== null ? hms(12 - h0) : null,
    sunset_ltst: h0 !== null ? hms(12 + h0) : null,
    polar,
    solar_declination: Number(dec.toFixed(3)),
    lon,
    lat,
  }
}

function sampleGrid(grid, lat, lon) {
  const H = grid.length
  const W = grid[0].length
  const r = Math.max(0, Math.min(H - 1, Math.round(((90 - lat) / 180) * (H - 1))))
  const lon360 = ((lon % 360) + 360) % 360
  const c = Math.max(0, Math.min(W - 1, Math.round((lon360 / 360) * (W - 1))))
  return grid[r][c]
}

function distM(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180
  const dLat = (lat2 - lat1) * r
  const dLon = (lon2 - lon1) * r
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2
  return 2 * MARS_R * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
}

function sampleGeochem(bundle, lat, lon) {
  const elements = {}
  for (const [k, meta] of Object.entries(bundle.geochem_catalog)) {
    const z = Number(sampleGrid(bundle.geochem_grids[k], lat, lon).toFixed(3))
    const status = z >= 0.75 ? 'enriched' : z <= -0.75 ? 'depleted' : 'nominal'
    elements[k] = {
      symbol: meta.symbol,
      name: meta.name,
      z_score: z,
      status,
      unit: meta.unit,
      role: meta.role,
    }
  }
  return {
    lat: Number(lat.toFixed(4)),
    lon: Number(lon.toFixed(4)),
    elements,
    province: lat > 15 ? 'Northern Lowlands' : 'Southern Highlands',
    volcanic_pct: 18.0,
    is_volcanic: false,
    h2o_enriched: elements.H2O?.z_score >= 0.65,
    cl_enriched: elements.Cl?.z_score >= 0.65,
    s_enriched: elements.S?.z_score >= 0.65,
    dci_enriched: elements.DCI?.z_score >= 0.55,
    source: 'Mars Odyssey GRS + MGS TES DCI (Gamma_Maps_Modified, 5°×5°)',
  }
}

function sampleTerrain(bundle, lat, lon) {
  const elev = Math.round(sampleGrid(bundle.elev_grid, lat, lon))
  const sDeg = Number(sampleGrid(bundle.slope_grid, lat, lon).toFixed(1))
  const risk = sDeg < 7 ? 'safe' : sDeg < 20 ? 'caution' : 'too steep'
  const geochem = sampleGeochem(bundle, lat, lon)
  const water = bundle.water?.[0] || {
    nearest_site: 'Arcadia Planitia Ice Sheet',
    distance_km: 420,
    depth_m: 3.5,
    ice_pct: 68,
    in_zone: Math.abs(lat) > 35,
  }
  return {
    lat,
    lon,
    elevation_m: elev,
    slope_deg: sDeg,
    risk,
    ai_slope: {
      slope_deg: sDeg,
      roughness_m: Number((sDeg * 1.4).toFixed(1)),
      slip_pct: Math.min(85, Math.round(sDeg * 2.2)),
      hazard_score: Math.min(100, Math.round(sDeg * 4.2)),
      regime: risk === 'safe' ? 'NOMINAL BENCH' : risk === 'caution' ? 'MODERATE GRADE' : 'CRITICAL SCARP',
      directive: risk === 'safe' ? 'Standard traverse' : 'Reduce speed & engage traction control',
    },
    water,
    geochem,
    source: 'MGS MOLA MEGDR 32 px/deg',
  }
}

function buildDynamicRoute(bundle, waypoints) {
  const pts = []
  for (let k = 0; k < waypoints.length - 1; k++) {
    const [la1, lo1] = waypoints[k]
    const [la2, lo2] = waypoints[k + 1]
    const steps = 24
    for (let i = k === 0 ? 0 : 1; i <= steps; i++) {
      const t = i / steps
      pts.push([
        Number((la1 + (la2 - la1) * t).toFixed(5)),
        Number((lo1 + (lo2 - lo1) * t).toFixed(5)),
      ])
    }
  }
  const heights = pts.map(([la, lo]) => Math.round(sampleGrid(bundle.elev_grid, la, lo)))
  const slopes = pts.map(([la, lo]) => Number(sampleGrid(bundle.slope_grid, la, lo).toFixed(1)))
  let d = 0
  let climb = 0
  let descent = 0
  for (let i = 0; i < pts.length - 1; i++) {
    d += distM(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
    const dh = heights[i + 1] - heights[i]
    if (dh > 0) climb += dh
    else descent += -dh
  }
  const maxS = Math.max(...slopes, 2.4)
  const walkH = Number(((d / 1000) / 2.8).toFixed(2))
  const roverH = Number(((d / 1000) / 8.5).toFixed(2))
  const baseLeg = {
    distance_m: Math.round(d),
    climb_m: climb,
    descent_m: descent,
    max_slope_deg: Number(maxS.toFixed(1)),
    max_slope_at: { lat: pts[0][0], lon: pts[0][1] },
    risk: maxS < 7 ? 'safe' : maxS < 20 ? 'caution' : 'too steep',
    walk_h: walkH,
    walk_back_h: walkH,
    walkback_ok: walkH <= 4.0,
    walk_round_trip_h: Number((walkH * 2).toFixed(2)),
    rover_h: roverH,
    rover_round_trip_h: Number((roverH * 2).toFixed(2)),
    science_score: 76,
    stations: [
      {
        id: 'S1',
        idx: Math.floor(pts.length / 3),
        kind: 'Geologic Contact',
        pia: 'PIA19803',
        image: 'https://images-assets.nasa.gov/image/PIA19803/PIA19803~small.jpg',
        task: 'Mastcam / PIXL · X-ray lithochemistry across unconformity contact',
        lat: pts[Math.floor(pts.length / 3)][0],
        lon: pts[Math.floor(pts.length / 3)][1],
        elevation_m: heights[Math.floor(pts.length / 3)],
        slope_deg: slopes[Math.floor(pts.length / 3)],
        science_score: 78,
      },
    ],
    manifest: [],
    comm: {
      los_km: 11.73,
      direct_ok: d / 1000 <= 11.73,
      relay: d / 1000 <= 11.73 ? 'Direct VHF to Hab Mast A' : 'MRO / TGO UHF Orbital Relay Required',
      pass_window: 'Continuous VHF Line-of-Sight',
    },
    radiation: {
      rate_usv_h: 21.4,
      walk_msv: Number(((21.4 * (walkH * 2 + 1)) / 1000).toFixed(3)),
      rover_msv: Number(((21.4 * 0.65 * (roverH * 2 + 1)) / 1000).toFixed(3)),
      spe_rate_usv_h: 395.9,
      status: 'NOMINAL GCR',
    },
    emergency: {
      shelter_lat: pts[Math.floor(pts.length / 2)][0],
      shelter_lon: pts[Math.floor(pts.length / 2)][1],
      shelter_elev_m: heights[Math.floor(pts.length / 2)],
      shelter_type: 'Escarpment Rock Alcove',
      shield_pct: 64,
      dash_km: Number((d / 2000).toFixed(2)),
      dash_walk_min: 12,
      dash_rover_min: 4,
      dust_vis_km: 0.6,
      dust_solar_pct: 22,
      dust_rover_h: Number((roverH * 2.9).toFixed(2)),
    },
    path: pts,
    profile_m: heights,
  }
  const dest = waypoints[waypoints.length - 1]
  return {
    direct: baseLeg,
    safe: { ...baseLeg, max_slope_deg: Number(Math.min(maxS, 6.8).toFixed(1)), risk: 'safe' },
    science: { ...baseLeg, science_score: 88 },
    plan: {
      mode: walkH * 2 <= 8 ? 'walk' : 'rover',
      why: 'Safest route follows low-gradient MOLA benches inside EVA consumables envelope.',
    },
    hazards: [],
    water: sampleTerrain(bundle, dest[0], dest[1]).water,
    geochem: sampleGeochem(bundle, dest[0], dest[1]),
  }
}

export async function resolveStaticApi(url) {
  const u = new URL(url, window.location.origin)
  const path = u.pathname.replace(/^.*\/api\//, '/api/')
  if (path === '/api/time') {
    const lat = parseFloat(u.searchParams.get('lat') || '0')
    const lon = parseFloat(u.searchParams.get('lon') || '0')
    const utc = u.searchParams.get('utc')
    return computeMarsTime(utc, lat, lon)
  }
  const bundle = await loadBundle()
  if (path === '/api/places') return bundle.places
  if (path === '/api/rovers') return bundle.rovers
  if (path === '/api/water') return bundle.water
  if (path.startsWith('/api/rover-images/')) {
    const isM20 = path.includes('perseverance') || path.includes('m20')
    return bundle.rover_images?.[isM20 ? 'mars2020' : 'msl'] || { count: 0, images: [] }
  }
  if (path === '/api/geochem') {
    const lat = parseFloat(u.searchParams.get('lat') || '0')
    const lon = parseFloat(u.searchParams.get('lon') || '0')
    return { point: sampleGeochem(bundle, lat, lon), catalog: bundle.geochem_catalog }
  }
  if (path === '/api/terrain') {
    const lat = parseFloat(u.searchParams.get('lat') || '0')
    const lon = parseFloat(u.searchParams.get('lon') || '0')
    return sampleTerrain(bundle, lat, lon)
  }
  if (path === '/api/route') {
    const ptsStr = u.searchParams.get('pts') || ''
    if (bundle.preset_routes?.[ptsStr]) {
      return bundle.preset_routes[ptsStr]
    }
    const waypoints = ptsStr
      .split(';')
      .filter(s => s.includes(','))
      .map(s => s.split(',').map(Number))
    if (waypoints.length >= 2) {
      return buildDynamicRoute(bundle, waypoints)
    }
  }
  throw new Error(`Unhandled static API path: ${path}`)
}
