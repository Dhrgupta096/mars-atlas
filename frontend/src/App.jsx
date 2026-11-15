import { useEffect, useMemo, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import gsap from 'gsap'
import { resolveStaticApi } from './staticFallback.js'

const IS_STATIC_HOST =
  typeof window !== 'undefined' && /\.github\.io$/i.test(window.location.hostname)

function EarthClock({ simMs }) {
  const [t, setT] = useState(() => Date.now())
  useEffect(() => {
    if (simMs !== null) return
    const id = setInterval(() => setT(Date.now()), 1000)
    return () => clearInterval(id)
  }, [simMs])
  const d = new Date(simMs ?? t)
  return simMs !== null
    ? d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    : d.toLocaleTimeString([], { hour12: false })
}

const MARS = Cesium.Ellipsoid.MARS
Cesium.Ellipsoid.default = MARS

const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ/'
const USGS_WMS = 'https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/mars/mars_simp_cyl.map'
const LAYERS = {
  Imagery: { id: 'Mars_Viking_MDIM21_ClrMosaic_global_232m', maxLevel: 7, detail: 'THEMIS' },
  'THEMIS 100m': { wms: 'MOLA_THEMIS_blend', maxLevel: 12, detail: 'THEMIS' },
  'Night-IR': { id: 'THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018', ext: 'png', maxLevel: 7, detail: 'Thermal Inertia' },
  Elevation: { id: 'Mars_MGS_MOLA_ClrShade_merge_global_463m', maxLevel: 5, detail: 'HRSC_MOLA_Blend_Hillshade' },
  Elements: { grs: true, maxLevel: 8, detail: 'Odyssey GRS + TES DCI' },
}
const GRS_ELEMENTS = [
  { key: 'Fe', label: 'Fe', name: 'Iron (Fe)', desc: 'Basaltic crust, hematite & ferric oxides' },
  { key: 'H2O', label: 'H₂O', name: 'Water / Hydrogen (H₂O)', desc: 'Subsurface ice, hydrated sulfates & clays' },
  { key: 'Si', label: 'Si', name: 'Silicon (Si)', desc: 'Silicate crust, silica sinter & andesites' },
  { key: 'S', label: 'S', name: 'Sulfur (S)', desc: 'Evaporite sulfate beds & volcanic outgassing' },
  { key: 'Cl', label: 'Cl', name: 'Chlorine (Cl)', desc: 'Perchlorate brines & halite evaporites' },
  { key: 'K', label: 'K', name: 'Potassium (K)', desc: 'K-feldspar, illite clays & crustal incompatibility' },
  { key: 'Th', label: 'Th', name: 'Thorium (Th)', desc: 'Radiogenic heat tracer & igneous provinces' },
  { key: 'Al', label: 'Al', name: 'Aluminum (Al)', desc: 'Plagioclase feldspar & Al-smectite clays' },
  { key: 'Ca', label: 'Ca', name: 'Calcium (Ca)', desc: 'Pyroxene basalt, gypsum & lake carbonates' },
  { key: 'DCI', label: 'DCI', name: 'Dust Cover Index', desc: 'MGS TES dust mantle vs. exposed bedrock' },
]
const RISK_COLOR = { safe: '#5fd38d', caution: '#f2c14e', 'too steep': '#e5484d' }
const getJson = url =>
  IS_STATIC_HOST
    ? resolveStaticApi(url)
    : fetch(url)
        .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
        .catch(() => resolveStaticApi(url))

function trekLayer({ id, maxLevel, ext = 'jpg' }) {
  return new Cesium.WebMapTileServiceImageryProvider({
    url: `${TREK}${id}/1.0.0/default/default028mm/{TileMatrix}/{TileRow}/{TileCol}.${ext}`,
    layer: id, style: 'default', tileMatrixSetID: 'default028mm',
    tilingScheme: new Cesium.GeographicTilingScheme({ ellipsoid: MARS }),
    maximumLevel: maxLevel, credit: 'NASA / JPL-Caltech · Mars Trek',
  })
}

const _hmapCache = new Map()
const _scaledHmapCache = new Map()
function createMolaTerrainProvider(scale = 2.0) {
  return new Cesium.CustomHeightmapTerrainProvider({
    width: 33,
    height: 33,
    tilingScheme: new Cesium.GeographicTilingScheme({ ellipsoid: MARS }),
    credit: 'NASA MGS MOLA 32ppd 3D Mesh',
    callback: (x, y, level) => {
      const z = Math.min(level, IS_STATIC_HOST ? 1 : 7)
      const sKey = `${scale}/${z}/${y}/${x}`
      const hit = _scaledHmapCache.get(sKey)
      if (hit) return hit
      const key = `${z}/${y}/${x}`
      const cached = _hmapCache.get(key)
      const scaleArr = base => {
        if (scale === 1.0) return base
        const scaled = new Float32Array(base.length)
        for (let i = 0; i < base.length; i++) scaled[i] = base[i] * scale
        _scaledHmapCache.set(sKey, scaled)
        return scaled
      }
      if (cached instanceof Float32Array) return scaleArr(cached)
      const p = cached ?? fetch(`./api/heightmap/${z}/${y}/${x}.bin`)
        .then(r => (r.ok ? r.arrayBuffer() : new ArrayBuffer(33 * 33 * 4)))
        .then(buf => {
          const arr = new Float32Array(buf)
          _hmapCache.set(key, arr)
          return arr
        })
        .catch(() => new Float32Array(33 * 33))
      if (!cached) _hmapCache.set(key, p)
      return p.then(scaleArr)
    },
  })
}

function localTileLayer(mode, maxLevel = 8) {
  return new Cesium.UrlTemplateImageryProvider({
    url: `./api/tiles/${mode}/{z}/{y}/{x}.png?v=4`,
    tilingScheme: new Cesium.GeographicTilingScheme({ ellipsoid: MARS }),
    maximumLevel: IS_STATIC_HOST ? 1 : maxLevel,
    tileWidth: 256,
    tileHeight: 256,
    credit: 'NASA MGS MOLA 32ppd DEM (Local Instant Renderer)',
  })
}

function usgsWmsLayer(layerName, maxLevel = 12, minLevel = 4) {
  return new Cesium.WebMapServiceImageryProvider({
    url: USGS_WMS,
    layers: layerName,
    parameters: { format: 'image/jpeg', version: '1.1.1', srs: 'EPSG:4326' },
    tilingScheme: new Cesium.GeographicTilingScheme({ ellipsoid: MARS }),
    minimumLevel: minLevel,
    maximumLevel: maxLevel,
    tileWidth: 256,
    tileHeight: 256,
    credit: 'NASA / JPL / ASU · USGS Astrogeology (THEMIS 100m)',
  })
}

let audioCtx = null
function playTick(enabled, freq = 1380, dur = 0.014, vol = 0.032) {
  if (!enabled || typeof window === 'undefined') return
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    audioCtx = audioCtx || new Ctx()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(freq * 0.52, audioCtx.currentTime + dur)
    gain.gain.setValueAtTime(vol, audioCtx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0008, audioCtx.currentTime + dur)
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.start()
    osc.stop(audioCtx.currentTime + dur)
  } catch {
    // Ignore browser autoplay restrictions
  }
}

function playQuindar(enabled, speechText = '') {
  if (!enabled || typeof window === 'undefined') return
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (Ctx) {
      audioCtx = audioCtx || new Ctx()
      if (audioCtx.state === 'suspended') audioCtx.resume()
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(2525, audioCtx.currentTime) // NASA Apollo Quindar intro tone (2,525 Hz)
      gain.gain.setValueAtTime(0.055, audioCtx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.16)
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.start()
      osc.stop(audioCtx.currentTime + 0.16)
    }
    if (speechText && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(speechText)
      u.rate = 1.06
      u.pitch = 0.94
      u.volume = 0.75
      window.speechSynthesis.speak(u)
    }
  } catch {
    // Ignore browser autoplay restrictions
  }
}

function parseHashRoute() {
  if (typeof window === 'undefined' || !window.location.hash) return null
  const params = new URLSearchParams(window.location.hash.slice(1))
  const suit = params.get('suit')
  const ptsStr = params.get('pts')
  if (ptsStr) {
    const pts = ptsStr.split(';').map(s => {
      const [la, lo] = s.split(',').map(Number)
      return Number.isNaN(la) || Number.isNaN(lo) ? null : { lat: la, lon: lo }
    }).filter(Boolean)
    if (pts.length >= 2) return { pts, suit }
  }
  const aStr = params.get('a'), bStr = params.get('b')
  if (!aStr || !bStr) return null
  const [lat1, lon1] = aStr.split(',').map(Number)
  const [lat2, lon2] = bStr.split(',').map(Number)
  if ([lat1, lon1, lat2, lon2].some(Number.isNaN)) return null
  return { pts: [{ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 }], suit }
}

const fmtDeg = (v, pos, neg) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? pos : neg}`
const fmtHours = h => h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`
const toLocalIso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
const SOL_MS = 88775244 // 1 Mars solar day (sol) = 24h 39m 35.244s in milliseconds
const EVA_SPECS = {
  plss8: { key: 'plss8', short: '8h PLSS', title: '2-Crew · 8h PLSS', o2: 8.0, wb: 4.0, buddy: false },
  xemu10: { key: 'xemu10', short: '10h xEMU', title: '2-Crew · 10h xEMU', o2: 10.0, wb: 5.0, buddy: false },
  buddy16: { key: 'buddy16', short: 'Buddy Rovers', title: '4-Crew · 2 Buddy Rovers', o2: 16.0, wb: 16.0, buddy: true },
}
const MODE_LABEL = { walk: 'EVA · Walk OK', rover: 'EVA · Rover Needed', expedition: 'Over Limit · Multi-Sol', none: 'Blocked (>20°)' }
const MODE_COLOR = { walk: '#5fd38d', rover: '#f2c14e', expedition: '#a78bfa', none: '#e5484d' }
const ROUTE_COLOR = { direct: '#e8e0d6', safe: '#5fd38d', science: '#f2c14e' }
const EYE_OFFSET = new Cesium.Cartesian3(0, 0, -3000) // 3 km toward camera: prevents local surface clipping while Mars (R=3396 km) hides far-side points
const surfPos = (lon, lat) => Cesium.Cartesian3.fromDegrees(lon, lat, 0)
const surfLine = pairs => Cesium.Cartesian3.fromDegreesArrayHeights(pairs.flatMap(([la, lo]) => [lo, la, 0]))
const CLAMP_GND = Cesium.HeightReference.CLAMP_TO_GROUND
const HOME = Cesium.Cartesian3.fromDegrees(77.4, 12.0, 9.8e6)
const glide = (camera, destination) => camera.flyTo({ destination, duration: 2.8, easingFunction: Cesium.EasingFunction.QUINTIC_IN_OUT })
const CARDINAL = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

const ORBITERS = [
  { id: 'MRO', name: 'Mars Reconnaissance Orbiter', inc: 92.7, raan: 77.5, altKm: 280, vizAlt: 420000, periodMin: 112.0, speedKms: 3.42, color: '#56b4e9', payload: 'HiRISE 0.3m · CTX 6m · SHARAD Radar · Electra UHF' },
  { id: 'TGO', name: 'ESA Trace Gas Orbiter', inc: 74.0, raan: 138.0, altKm: 400, vizAlt: 560000, periodMin: 120.0, speedKms: 3.36, color: '#5fd38d', payload: 'CaSSIS Stereo · NOMAD · FREND H2O · Electra UHF' },
  { id: 'ODY', name: '2001 Mars Odyssey', inc: 93.1, raan: 215.0, altKm: 380, vizAlt: 490000, periodMin: 118.0, speedKms: 3.37, color: '#f2c14e', payload: 'THEMIS IR/VIS · GRS H2O · HEND · CEU UHF Relay' },
]

const BASE_MODULES = [
  { code: 'HAB-1', name: 'Pressurized Habitat Core', kw: -12, h2o: 0, o2: 0, color: '#5fd38d', role: '4-Crew Living Quarters · Medical · Dual Airlock' },
  { code: 'KRUSTY', name: 'Kilopower Fission + Solar Array', kw: 40, h2o: 0, o2: 0, color: '#f2c14e', role: '40 kWe Continuous Nuclear + Deploying Solar Wings' },
  { code: 'ISRU-1', name: 'Subsurface Ice Drill & Sabatier', kw: -15, h2o: 24, o2: 16, color: '#56b4e9', role: 'Rodriguez Well Ice Extractor + CH4/O2 Liquefier' },
  { code: 'COMM-1', name: '15m VHF/UHF Relay Mast', kw: -2, h2o: 0, o2: 0, color: '#7fd1c7', role: '18 km Surface VHF Mesh + MRO/TGO Ka/UHF Transceiver' },
  { code: 'LAB-1', name: 'Astrobiology & Core Drill Lab', kw: -5, h2o: 4, o2: 2, color: '#a78bfa', role: '2m Regolith Core Assay + Biosignature Spectrometer' },
]

const JEZERO_BASE_PRESET = [
  { code: 'HAB-1', lat: 18.4446, lon: 77.4509, elevation_m: -2570, slope_deg: 2.1 },
  { code: 'KRUSTY', lat: 18.452, lon: 77.462, elevation_m: -2564, slope_deg: 1.8 },
  { code: 'ISRU-1', lat: 18.468, lon: 77.434, elevation_m: -2542, slope_deg: 3.4 },
  { code: 'COMM-1', lat: 18.489, lon: 77.405, elevation_m: -2485, slope_deg: 5.2 },
  { code: 'LAB-1', lat: 18.515, lon: 77.375, elevation_m: -2410, slope_deg: 6.1 },
]

function orbiterPoint(orb, phaseRad, rotDeg) {
  const inc = (orb.inc * Math.PI) / 180
  const lat = Math.asin(Math.max(-1, Math.min(1, Math.sin(inc) * Math.sin(phaseRad)))) * (180 / Math.PI)
  const lonInertial = orb.raan + Math.atan2(Math.cos(inc) * Math.sin(phaseRad), Math.cos(phaseRad)) * (180 / Math.PI)
  const lon = ((lonInertial - rotDeg) % 360 + 540) % 360 - 180
  return [lat, lon]
}

function orbiterState(orb, epochMs) {
  const sec = epochMs / 1000
  const periodSec = orb.periodMin * 60
  const phase = ((sec % periodSec) / periodSec) * Math.PI * 2
  const rotDeg = ((sec % 88642.66) / 88642.66) * 360
  const [lat, lon] = orbiterPoint(orb, phase, rotDeg)
  const [nLat, nLon] = orbiterPoint(orb, phase + 0.05, rotDeg)
  return { ...orb, lat, lon, nLat, nLon, hdg: bearingDeg(lat, lon, nLat, nLon), phase, rotDeg }
}

function surfaceDistKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180
  const dLat = (lat2 - lat1) * r
  const dLon = (lon2 - lon1) * r
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2
  return 2 * 3390 * Math.asin(Math.min(1, Math.sqrt(a)))
}

function orbiterCommWindow(lat, lon, epochMs) {
  const losKm = 1420 // ~24° Mars horizon cone for 320-400 km orbiters
  for (const orb of ORBITERS) {
    const s = orbiterState(orb, epochMs)
    if (surfaceDistKm(lat, lon, s.lat, s.lon) <= losKm) {
      return { live: true, id: orb.id, label: `IN PASS · ${orb.id}` }
    }
  }
  for (let m = 2; m <= 120; m += 2) {
    const t = epochMs + m * 60000
    for (const orb of ORBITERS) {
      const s = orbiterState(orb, t)
      if (surfaceDistKm(lat, lon, s.lat, s.lon) <= losKm) {
        return { live: false, id: orb.id, mins: m, label: `${orb.id} IN ${m}M` }
      }
    }
  }
  return { live: false, id: 'MRO', mins: 120, label: 'RELAY STANDBY' }
}

const LABEL_BG = new Cesium.Color(0.05, 0.04, 0.04, 0.88)
const LABEL_PAD = new Cesium.Cartesian2(6, 4)

const ORB_CLOCK = {
  baseSimMs: Date.now(),
  baseWallMs: Date.now(),
  rate: 1,
  show: true,
  anchor: null,
  rideId: null,
}
function getOrbEpoch() {
  return ORB_CLOCK.baseSimMs + (Date.now() - ORB_CLOCK.baseWallMs) * ORB_CLOCK.rate
}

function tuneAtmosphere(viewer) {
  if (!viewer) return
  const { scene } = viewer
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = false
  scene.globe.showGroundAtmosphere = false
  if (!scene.sun) scene.sun = new Cesium.Sun()
  scene.sun.show = true
  scene.sun.glowFactor = 1.4
}

function syncOrbiters(ref, show, simMs, timeRate, anchor, rideId) {
  ORB_CLOCK.baseSimMs = simMs ?? getOrbEpoch()
  ORB_CLOCK.baseWallMs = Date.now()
  ORB_CLOCK.rate = timeRate
  ORB_CLOCK.show = show
  ORB_CLOCK.anchor = anchor
  ORB_CLOCK.rideId = rideId

  const v = ref.current
  if (!v || !v.orbitLayer) return
  v.orbitLayer.show = show
  const ents = v.orbitLayer.entities
  if (!show) {
    ents.removeAll()
    v._orbKey = null
    return
  }
  const orbKey = `${rideId ?? 'none'}:${anchor ? `${anchor.lat.toFixed(2)},${anchor.lon.toFixed(2)}` : 'no-anchor'}`
  if (v._orbKey === orbKey) return
  v._orbKey = orbKey
  ents.removeAll()

  for (const orb of ORBITERS) {
    const col = Cesium.Color.fromCssColorString(orb.color)
    ents.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          const st = orbiterState(orb, getOrbEpoch())
          const pts = Array.from({ length: 73 }, (_, i) => {
            const [la, lo] = orbiterPoint(orb, (i / 72) * Math.PI * 2, st.rotDeg)
            return [lo, la, orb.vizAlt]
          }).flat()
          return Cesium.Cartesian3.fromDegreesArrayHeights(pts)
        }, false),
        width: rideId === orb.id ? 2.4 : 1.3,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineDashMaterialProperty({ color: col.withAlpha(rideId === orb.id ? 0.85 : 0.36), dashLength: 14 }),
      },
    })
    ents.add({
      position: new Cesium.CallbackProperty(() => {
        const st = orbiterState(orb, getOrbEpoch())
        return Cesium.Cartesian3.fromDegrees(st.lon, st.lat, orb.vizAlt)
      }, false),
      point: { pixelSize: rideId === orb.id ? 12 : 8, color: col, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
      label: {
        text: `${orb.id} · ${orb.altKm} km`,
        font: '600 10px "JetBrains Mono", ui-monospace, monospace',
        pixelOffset: new Cesium.Cartesian2(0, -14), verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        fillColor: col, showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
      },
    })
    // Show MRO nadir radar/camera swath cone when riding MRO
    if (orb.id === 'MRO' && rideId === 'MRO') {
      ents.add({
        polyline: {
          positions: new Cesium.CallbackProperty(() => {
            const st = orbiterState(orb, getOrbEpoch())
            return Cesium.Cartesian3.fromDegreesArrayHeights([st.lon, st.lat, orb.vizAlt, st.lon, st.lat, 400])
          }, false),
          width: 2.2,
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineGlowMaterialProperty({ color: col.withAlpha(0.8), glowPower: 0.25 }),
        },
      })
      ents.add({
        position: new Cesium.CallbackProperty(() => {
          const st = orbiterState(orb, getOrbEpoch())
          return surfPos(st.lon, st.lat)
        }, false),
        point: { pixelSize: 7, color: col, outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5 },
        label: {
          text: 'MRO SWATH · HiRISE / SHARAD',
          font: '600 9px "JetBrains Mono", ui-monospace, monospace',
          pixelOffset: new Cesium.Cartesian2(0, 14), verticalOrigin: Cesium.VerticalOrigin.TOP,
          fillColor: col, showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
          eyeOffset: EYE_OFFSET,
        },
      })
    }
  }

  if (anchor) {
    const uCol = Cesium.Color.fromCssColorString('#56b4e9')
    ents.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          const a = ORB_CLOCK.anchor
          if (!a) return []
          const states = ORBITERS.map(o => orbiterState(o, getOrbEpoch()))
          let nearest = states[0], bestD = 1e9
          for (const st of states) {
            const dLon = ((st.lon - a.lon + 540) % 360) - 180
            const d = Math.hypot(st.lat - a.lat, dLon)
            if (d < bestD) { bestD = d; nearest = st }
          }
          if (bestD > 68) return [] // orbiter below local horizon — prevent line cutting through Mars interior
          const dLon = ((nearest.lon - a.lon + 540) % 360) - 180
          const pts = Array.from({ length: 9 }, (_, i) => {
            const t = i / 8
            const la = a.lat + (nearest.lat - a.lat) * t
            const lo = a.lon + dLon * t
            const h = 600 + (nearest.vizAlt - 600) * Math.pow(t, 0.85) + Math.sin(t * Math.PI) * 85000
            return [lo, la, h]
          }).flat()
          return Cesium.Cartesian3.fromDegreesArrayHeights(pts)
        }, false),
        width: 2.8,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineGlowMaterialProperty({ color: uCol, glowPower: 0.28 }),
      },
    })
  }
}

function syncBaseLayer(ref, nodes) {
  const v = ref.current
  if (!v || !v.baseLayer) return
  const ents = v.baseLayer.entities
  ents.removeAll()
  if (!nodes || nodes.length === 0) return
  if (nodes.length > 1) {
    ents.add({
      polyline: {
        positions: surfLine(nodes.map(n => [n.lat, n.lon])),
        width: 3.5, arcType: Cesium.ArcType.GEODESIC, clampToGround: true,
        material: new Cesium.PolylineGlowMaterialProperty({ color: Cesium.Color.fromCssColorString('#7fd1c7'), glowPower: 0.25 }),
      },
    })
  }
  nodes.forEach((n, idx) => {
    const mod = BASE_MODULES.find(m => m.code === n.code) ?? BASE_MODULES[0]
    const col = Cesium.Color.fromCssColorString(mod.color)
    const isEven = idx % 2 === 0
    ents.add({
      position: surfPos(n.lon, n.lat),
      point: { pixelSize: 10, color: col, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, heightReference: CLAMP_GND },
      label: {
        text: `#${idx + 1} ${mod.code}${n.elevation_m !== undefined ? ` · ${n.elevation_m.toLocaleString()}m` : ''}`,
        font: '600 10px "JetBrains Mono", ui-monospace, monospace',
        pixelOffset: new Cesium.Cartesian2(isEven ? 12 : -12, -4),
        horizontalOrigin: isEven ? Cesium.HorizontalOrigin.LEFT : Cesium.HorizontalOrigin.RIGHT,
        fillColor: col, showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3.5e5),
        heightReference: CLAMP_GND,
        eyeOffset: EYE_OFFSET,
      },
    })
  })
}
function bearingDeg(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180, p1 = lat1 * r, p2 = lat2 * r, dl = (lon2 - lon1) * r
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return ((Math.atan2(y, x) / r) + 360) % 360
}
function setHoverMarker(ref, show, lon, lat, hex, text) {
  const hp = ref.current?.hoverPin
  if (!hp) return
  if (show) {
    hp.position = surfPos(lon, lat)
    hp.point.color = Cesium.Color.fromCssColorString(hex)
    hp.label.text = text
  }
  hp.show = show
}
function hideAllPins(ref) {
  for (const p of ref.current?.pins ?? []) p.show = false
  setHoverMarker(ref, false)
}
const PIN_NAMES = ['A · START', 'B · STOP 1', 'C · STOP 2', 'D · STOP 3', 'E · STOP 4', 'F · DEST']
function setPinChain(ref, pts) {
  const pins = ref.current?.pins
  if (!pins) return
  pins.forEach((pin, idx) => {
    const pt = pts[idx]
    if (!pt) {
      pin.show = false
      return
    }
    const tag = idx === 0 ? 'A · START' : idx === pts.length - 1 ? `${String.fromCharCode(65 + idx)} · DEST` : PIN_NAMES[idx]
    pin.position = surfPos(pt.lon, pt.lat)
    pin.label.text = `${tag}\n${fmtDeg(pt.lat, 'N', 'S')} ${fmtDeg(pt.lon, 'E', 'W')}`
    pin.point.color = Cesium.Color.fromCssColorString('#38bdf8')
    pin.show = true
    getJson(`/api/terrain?lat=${pt.lat.toFixed(4)}&lon=${pt.lon.toFixed(4)}`)
      .then(t => {
        pin.label.text = `${tag}\n${t.elevation_m.toLocaleString()} m · ${t.slope_deg}° ${t.risk.toUpperCase()}`
        pin.point.color = Cesium.Color.fromCssColorString(RISK_COLOR[t.risk])
      })
      .catch(() => {})
  })
}
const PRESET_EVAS = [
  {
    id: 'jezero',
    label: 'Jezero Delta EVA',
    pts: [
      { lat: 18.4446, lon: 77.4509 }, // Octavia E. Butler Landing
      { lat: 18.4680, lon: 77.4340 }, // Neretva Delta Front Scarp
      { lat: 18.4890, lon: 77.4050 }, // Enchanted Lake Mudstones
      { lat: 18.5150, lon: 77.3750 }, // Margin Carbonate Ridge
    ],
  },
  {
    id: 'gale',
    label: 'Gale → Mt. Sharp Ascent',
    pts: [
      { lat: -4.5895, lon: 137.4417 }, // Bradbury Landing
      { lat: -4.6540, lon: 137.3800 }, // Pahrump Hills (Murray Strata)
      { lat: -4.7300, lon: 137.3620 }, // Vera Rubin Hematite Ridge
      { lat: -4.8100, lon: 137.3600 }, // Gediz Vallis Ridge (Mt. Sharp)
    ],
  },
  {
    id: 'olympus',
    label: 'Olympus Mons Caldera Rim',
    pts: [
      { lat: 18.3500, lon: -133.2500 }, // East Caldera Bench
      { lat: 18.5200, lon: -133.5800 }, // Central Collapse Pit Rim
      { lat: 18.6800, lon: -133.9200 }, // 21.2 km Summit Escarpment
    ],
  },
]
function setMinZoom(ref, dist) {
  if (ref.current) ref.current.scene.screenSpaceCameraController.minimumZoomDistance = dist
}
function buildWhy(routeData, spec) {
  if (!routeData) return ''
  const { direct, safe, science } = routeData
  if (!safe) return 'Every path to B crosses slopes over 20°. Pick a different destination.'
  const extraKm = ((safe.distance_m - direct.distance_m) / 1000).toFixed(1)
  let base = direct.risk === 'too steep'
    ? `Safest route avoids a ${direct.max_slope_deg}° cliff on the direct line (+${extraKm} km).`
    : safe.max_slope_deg < direct.max_slope_deg - 2
      ? `Safest route cuts max slope from ${direct.max_slope_deg}° to ${safe.max_slope_deg}° (+${extraKm} km).`
      : 'Direct line is already gentle, so the safest route stays close to it.'
  if (science && science.science_score > safe.science_score) {
    const sciKm = Math.max((science.distance_m - direct.distance_m) / 1000, 0).toFixed(1)
    base += ` Science route boosts outcrop yield from ${safe.science_score} to ${science.science_score}/100 (+${sciKm} km vs direct, ${science.stations.length} stations).`
  }
  if (!spec.buddy && safe.walk_round_trip_h <= spec.o2) {
    return `${base} Walking there and back takes ${safe.walk_round_trip_h.toFixed(1)} h, inside one ${spec.o2} h (${spec.short}) EVA.`
  }
  if (safe.rover_round_trip_h <= spec.o2) {
    const wb = spec.buddy
      ? `covered by 2nd Buddy Rover backup (${safe.rover_round_trip_h.toFixed(1)} h round trip)`
      : safe.walk_back_h <= spec.wb
        ? `within the ${spec.wb} h walk-back limit (${safe.walk_back_h.toFixed(1)} h B→A)`
        : `past the ${spec.wb} h walk-back limit (${safe.walk_back_h.toFixed(1)} h B→A; switch to Buddy Rovers)`
    return `${base} Too far to walk (${safe.walk_round_trip_h.toFixed(1)} h); by rover it's ${safe.rover_round_trip_h.toFixed(1)} h inside ${spec.o2} h (${wb}).`
  }
  return `${base} Too far for one ${spec.o2} h (${spec.short}) EVA even by rover (${safe.rover_round_trip_h.toFixed(1)} h). Needs a multi-sol expedition.`
}
const FAQ_ITEMS = [
  {
    q: 'Why can’t astronauts or rovers climb slopes steeper than 15°–20° on Mars?',
    cat: 'Terrain & Physics',
    stats: ['0.38g Gravity', '>15° Wheel Slip', '<8° Safe Bench'],
    a: 'Under Martian gravity (3.72 m/s²), normal downforce on wheels and boots drops by 62%, while loose regolith causes Bekker sinkage. Above 15°, wheel slip exceeds 40% and crew metabolic O₂ burn doubles. Mars Atlas flags steep scarps and snaps waypoints to safer <8° benches.',
    actionLabel: 'Try on Globe · Gale → Mt. Sharp Climb',
    actionKey: 'gale',
  },
  {
    q: 'How do astronauts survive if a rover breaks down far from the Habitat?',
    cat: 'Survival & EVA',
    stats: ['6 km Foot Limit', '12 km Rover Limit', '16h Buddy Rovers'],
    a: 'Every EVA is governed by the NASA Walk-Back Safety Limit (drawn as the 6 km foot ring and 12 km rover walk-back ring around Pin A). Crew in 8h PLSS or 10h xEMU suits always keep enough O₂ reserve to walk back on foot if a rover fails, or pair two Buddy Rovers for deep exploration.',
    actionLabel: 'Try on Globe · Jezero Delta EVA',
    actionKey: 'jezero',
  },
  {
    q: 'Why does the Night-IR (Thermal Inertia) layer matter for survival?',
    cat: 'NASA Data & Layers',
    stats: ['100m Thermal IR', 'Bright = Bedrock', 'Dark = Dust Trap'],
    a: 'Daytime optical cameras cannot distinguish solid bedrock from a deep sand trap covered by a thin veneer of dust. Nighttime thermal infrared measures heat retention after sunset: loose fine dust cools rapidly and turns dark, whereas solid bedrock retains heat and glows bright.',
    actionLabel: 'Try on Globe · Switch to Night-IR Layer',
    actionKey: 'nightir',
  },
  {
    q: 'How do astronauts find underground water ice for drinking & rocket fuel (ISRU)?',
    cat: 'Survival & EVA',
    stats: ['6 mbar Triple Pt', 'SHARAD Radar Ice', 'CO₂ + 4H₂ → CH₄ + O₂'],
    a: 'Liquid water boils or freezes immediately at Mars’s 6 mbar surface pressure, so crews drill into subsurface glaciers mapped by MRO SHARAD radar. A Rodriguez Well melts buried ice and feeds a Sabatier reactor to produce breathable O₂ and methalox return propellant.',
    actionLabel: 'Try on Globe · Reveal Subsurface Water Ice',
    actionKey: 'water',
  },
  {
    q: 'What happens during a Solar Particle Event (S3 Flare) or Regional Dust Storm?',
    cat: 'Survival & EVA',
    stats: ['388 μSv/h Spike', '68%+ Rock Shield', 'τ = 3.8 Dust Storm'],
    a: 'With no global magnetosphere, an S3 Solar Flare spikes surface radiation 18.5× (>380 μSv/h). Mars Atlas scans surrounding MOLA topography to locate the nearest high-wall crater rim, alcove, or lava tube and computes your emergency rover dash time.',
    actionLabel: 'Try on Globe · Simulate S3 Solar Flare',
    actionKey: 'spe',
  },
  {
    q: 'How does the A* Pathfinding Engine compute Direct vs. Safest vs. Science routes?',
    cat: 'Terrain & Physics',
    stats: ['MOLA 32ppd Grid', 'Slope Cost Penalty', 'Outcrop Scoring'],
    a: 'When you place pins on Mars, the backend samples the NASA MGS MOLA 32ppd elevation grid across an A* lattice. Direct follows the geodesic chord; Safest routes around >10° cliffs; Science detours toward high-value carbonate and phyllosilicate outcrops.',
    actionLabel: 'Try on Globe · Compare Jezero A* Routes',
    actionKey: 'jezero',
  },
  {
    q: 'How do crew communications work when crater walls block radio line-of-sight?',
    cat: 'Survival & EVA',
    stats: ['18 km VHF Horizon', 'MRO 280 km Orbit', 'TGO & Odyssey UHF'],
    a: 'Because Mars’s radius (3,396 km) is half of Earth’s, a 15m Habitat VHF mast only reaches ~18 km over flat ground. Beyond the VHF horizon ring or inside canyons, Mars Atlas tracks live UHF relay passes from MRO, ESA Trace Gas Orbiter, and Mars Odyssey.',
    actionLabel: 'Try on Globe · Track 3D Relay Orbiters',
    actionKey: 'orbiters',
  },
  {
    q: 'How does Martian Time (Sol, MTC, LTST, and Ls) work?',
    cat: 'Terrain & Physics',
    stats: ['24h 39m 35s Sol', 'Airy-0 MTC Clock', 'Ls Solar Longitude'],
    a: 'One Martian solar day (Sol) is 39 minutes longer than Earth’s day. MTC is Coordinated Mars Time at the Airy-0 prime meridian, LTST is Local True Solar Time at your cursor, and Ls tracks Mars’s orbital seasons and perihelion dust storm window (Ls 180°–360°).',
    actionLabel: 'Try on Globe · Toggle Solar Terminator',
    actionKey: 'sunlight',
  },
  {
    q: 'Where do all the maps, elevations, and live rover photos come from?',
    cat: 'NASA Data & Layers',
    stats: ['NASA Mars Trek', 'USGS THEMIS 100m', 'Mars 2020 Raw API'],
    a: 'Mars Atlas integrates 5 authentic NASA/USGS sources: Mars Trek WMTS (Viking 232m, MOLA Color), USGS Astrogeology WMS (THEMIS 100m), local MGS MOLA 32ppd 3D elevation meshes, and live Perseverance & Curiosity raw camera downlinks.',
    actionLabel: 'Try on Globe · View Elevation Hypsometry',
    actionKey: 'elevation',
  },
  {
    q: 'How does the Elements (GRS + DCI) geochemical globe map surface minerals and volatiles?',
    cat: 'NASA Data & Layers',
    stats: ['1,451 5°×5° Cells', '9 GRS Elements', 'TES Dust Cover Index'],
    a: 'Powered by the Mars Odyssey Gamma Ray Spectrometer (GRS) and MGS TES Dust Cover Index dataset (DOI 10.1029/2008JE003303), the Elements layer maps normalized σ concentrations of Fe, H₂O, Si, S, Cl, K, Th, Al, Ca, and Dust Cover across Mars.',
    actionLabel: 'Try on Globe · Open Elements (GRS) Map',
    actionKey: 'grs',
  },
  {
    q: 'What keyboard shortcuts and instrument hotkeys are available?',
    cat: 'Controls & Hotkeys',
    stats: ['1–5 Map Layers', 'N North · B Comms', 'V Visor · C Cuff'],
    a: 'Use single-key shortcuts anywhere on the map: [1–5] Switch Map Layers · [N] Reset True North · [B] Bandwidth & Comms Console · [L] Solar Terminator · [V] Spacesuit Visor HUD · [C] Forearm Wrist Cuff · [H] Clean Globe · [M] Tactile Audio · [R] Reset Camera · [WASD] Free-Drive Rover · [?] Field Manual.',
  },
  {
    q: 'How does Interplanetary Bandwidth & Deep Space Communications work?',
    cat: 'Survival & EVA',
    stats: ['2.05 Mbps Ka-Band', '3.1m–22.3m OWLT', 'Electra UHF Relay'],
    a: 'Earth and Mars are separated by 55M to 400M km, causing speed-of-light delays from 3.1 to 22.3 minutes. The NASA Deep Space Network (DSN) provides 2.05 Mbps high-rate downlink over Ka-Band (32 GHz), with 32 kbps command uplinks and 2.0 Mbps UHF proximity relay via orbiters (MRO/TGO). Mars Atlas computes live One-Way Light Time (OWLT) and link margins in real time.',
    actionLabel: 'Open DSN Bandwidth Console [B]',
    actionKey: 'comms',
  },
  {
    q: 'How do you orient and navigate on a planet without a global magnetic field?',
    cat: 'Terrain & Physics',
    stats: ['No Magnetic Dynamo', 'Areocentric True North', 'Press N to Align'],
    a: 'Unlike Earth, Mars lost its core dynamo ~4 billion years ago, so standard magnetic compasses spin uselessly in local remanent crustal fields. Martian explorers use celestial star trackers, Sun sensors, and inertial navigation referenced to Areocentric True North (the rotational spin axis). Mars Atlas provides a live True North compass with instant 1-click alignment.',
    actionLabel: 'Align to True North [N]',
    actionKey: 'compass',
  },
]

function syncSunlight(ref, enabled, mars, center) {
  const v = ref.current
  if (!v) return
  const { scene } = v
  scene.globe.enableLighting = enabled
  scene.globe.dynamicAtmosphereLighting = false
  const ents = v.sunLayer?.entities
  if (!ents) return
  if (!enabled || !mars) {
    if (v._sunKey !== 'off') {
      v._sunKey = 'off'
      ents.removeAll()
    }
    return
  }
  const subLat = mars.solar_declination ?? 0
  const subLon = ((center.lon + (12 - (mars.ltst_hours ?? 12)) * 15 + 540) % 360) - 180
  const sunKey = `${Math.round(subLat * 4)}:${Math.round(subLon * 4)}:${mars.dust_season ? 1 : 0}`
  if (v._sunKey === sunKey) return
  v._sunKey = sunKey
  ents.removeAll()
  const sunPos = Cesium.Cartesian3.fromDegrees(subLon, subLat, 1e7)
  const dir = Cesium.Cartesian3.negate(Cesium.Cartesian3.normalize(sunPos, new Cesium.Cartesian3()), new Cesium.Cartesian3())
  scene.light = new Cesium.DirectionalLight({
    direction: dir,
    color: Cesium.Color.fromCssColorString(mars.dust_season ? '#ffdcb8' : '#fff5ea'),
    intensity: mars.dust_season ? 1.95 : 2.25,
  })
  // Draw solar terminator great circle (90° from subsolar point)
  const r = Math.PI / 180, phi0 = subLat * r, lam0 = subLon * r
  const term = Array.from({ length: 73 }, (_, i) => {
    const az = (i / 72) * Math.PI * 2
    const sinPhi = Math.cos(phi0) * Math.cos(az)
    const lat = Math.asin(Math.max(-1, Math.min(1, sinPhi))) / r
    const lon = (lam0 + Math.atan2(Math.sin(az), -Math.sin(phi0) * Math.cos(az))) / r
    return [lat, ((lon + 540) % 360) - 180]
  })
  const col = Cesium.Color.fromCssColorString('#fbbf24')
  ents.add({
    polyline: {
      positions: surfLine(term), width: 3.2, arcType: Cesium.ArcType.GEODESIC, clampToGround: true,
      material: new Cesium.PolylineGlowMaterialProperty({ color: col.withAlpha(0.75), glowPower: 0.25 }),
    },
  })
  ents.add({
    position: surfPos(subLon, subLat),
    point: { pixelSize: 9, color: col, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, heightReference: CLAMP_GND },
    label: {
      text: `☀ SUBSOLAR ZENITH · 12:00 LTST (Ls ${mars.ls.toFixed(1)}°)`,
      font: '600 10px "IBM Plex Mono", ui-monospace, monospace',
      pixelOffset: new Cesium.Cartesian2(0, -14), verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      fillColor: col, showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
      heightReference: CLAMP_GND, eyeOffset: EYE_OFFSET,
    },
  })
  const dawnLon = ((subLon - 90 + 540) % 360) - 180
  const duskLon = ((subLon + 90 + 540) % 360) - 180
  ents.add({
    position: surfPos(dawnLon, 0),
    label: {
      text: '☀ DAWN TERMINATOR · 06:00 LTST',
      font: '500 9px "IBM Plex Mono", ui-monospace, monospace',
      fillColor: col, showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
      heightReference: CLAMP_GND, eyeOffset: EYE_OFFSET,
    },
  })
  ents.add({
    position: surfPos(duskLon, 0),
    label: {
      text: '☾ DUSK TERMINATOR · 18:00 LTST',
      font: '500 9px "IBM Plex Mono", ui-monospace, monospace',
      fillColor: col, showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
      heightReference: CLAMP_GND, eyeOffset: EYE_OFFSET,
    },
  })
}

function setRenderMode(ref, continuous, depthTest = false) {
  const scene = ref.current?.scene
  if (!scene) return
  scene.globe.depthTestAgainstTerrain = depthTest
  scene.requestRenderMode = !continuous
  scene.requestRender()
}

export default function App() {
  const globeRef = useRef(null)
  const viewerRef = useRef(null)
  const compassRoseRef = useRef(null)
  const compassDegRef = useRef(null)
  const compassCardRef = useRef(null)
  const compassTiltRef = useRef(null)
  const visorOpenRef = useRef(false)
  const audioRef = useRef(false)
  const [layer, setLayer] = useState('Imagery')
  const [places, setPlaces] = useState([])
  const [query, setQuery] = useState('')
  const [center, setCenter] = useState({ lat: 0, lon: -60 })
  const [mars, setMars] = useState(null)
  const [initEpoch] = useState(() => Date.now())
  const [simMs, setSimMs] = useState(null) // null = LIVE real-time; number = planned EVA epoch ms
  const [route, setRoute] = useState(() => {
    const h = parseHashRoute()
    return h ? h.pts : []
  }) // [{lat, lon}] — A, B, C... (up to 6 stops)
  const [routeData, setRouteData] = useState(null) // {direct, safe, science, plan} from /api/route
  const [profKey, setProfKey] = useState('safe')
  const [hoverIdx, setHoverIdx] = useState(null)
  const [rovers, setRovers] = useState([])
  const [showRovers, setShowRovers] = useState(true)
  const [waterSites, setWaterSites] = useState([])
  const [showWater, setShowWater] = useState(false)
  const [loadingRoute, setLoadingRoute] = useState(() => !!parseHashRoute())
  const [visor, setVisor] = useState(false)
  const [cuff, setCuff] = useState(false)
  const [visorIdx, setVisorIdx] = useState(0)
  const [visorHeading, setVisorHeading] = useState(65)
  const [compassHdg, setCompassHdg] = useState(0)
  const [compassPitch, setCompassPitch] = useState(-90)
  const [commsOpen, setCommsOpen] = useState(false)
  const [visorAnchor, setVisorAnchor] = useState({ lat: 0, lon: -60 })
  const [roversOpen, setRoversOpen] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const [routeOpen, setRouteOpen] = useState(true)
  const [routeTab, setRouteTab] = useState('overview') // 'overview' | 'terrain' | 'checklist'
  const [evaSpec, setEvaSpec] = useState(() => {
    const h = parseHashRoute()
    return h?.suit && EVA_SPECS[h.suit] ? h.suit : 'plss8'
  })
  const [preview, setPreview] = useState(null) // {title, sub, image, pia, text, lat, lon}
  const [checkedSteps, setCheckedSteps] = useState({})
  const [intro, setIntro] = useState(() => !parseHashRoute())
  const [sunlight, setSunlight] = useState(false)
  const [showHazards, setShowHazards] = useState(false)
  const [replaying, setReplaying] = useState(false)
  const [audioOn, setAudioOn] = useState(false)
  const [sfxOn, setSfxOn] = useState(true)
  const sfxRef = useRef(true)
  const [faqOpen, setFaqOpen] = useState(false)
  const [faqCat, setFaqCat] = useState('All')
  const [faqQuery, setFaqQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const [showOrbiters, setShowOrbiters] = useState(false)
  const [rideOrb, setRideOrb] = useState(null) // null | 'MRO' | 'TGO' | 'ODY'
  const [timeRate, setTimeRate] = useState(1) // 1 | 60 | 300
  const [envMode, setEnvMode] = useState('nominal') // 'nominal' | 'dust' | 'spe'
  const [plannerMode, setPlannerMode] = useState('eva') // 'eva' | 'base'
  const [leftTab, setLeftTab] = useState('explore') // 'explore' | 'sim' | 'base'
  const [overlaysOpen, setOverlaysOpen] = useState(false)
  const [cleanUi, setCleanUi] = useState(false)
  const [terrain3d, setTerrain3d] = useState(2) // 0 = Flat, 1 = 1x MOLA 3D, 2 = 2x MOLA 3D, 3 = 3x MOLA 3D
  const [chainNext, setChainNext] = useState(false)
  const [freeDrive, setFreeDrive] = useState(null) // null | { lat, lon, hdg, pitch, elev, slope, risk }
  const [leakSec, setLeakSec] = useState(null) // null | countdown seconds for O2 leak drill
  const [layerOpacity, setLayerOpacity] = useState(1.0)
  const [grsElem, setGrsElem] = useState('Fe')
  const [centerGeochem, setCenterGeochem] = useState(null)
  const [baseNodes, setBaseNodes] = useState([])
  const [nextMod, setNextMod] = useState('HAB-1')
  const plannerModeRef = useRef('eva')
  const nextModRef = useRef('HAB-1')
  const chainNextRef = useRef(false)

  // Globe
  useEffect(() => {
    const viewer = new Cesium.Viewer(globeRef.current, {
      globe: new Cesium.Globe(MARS), baseLayer: false, baseLayerPicker: false, geocoder: false,
      homeButton: false, sceneModePicker: false, navigationHelpButton: false, timeline: false,
      animation: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
      skyAtmosphere: false, requestRenderMode: true, maximumRenderTimeChange: Infinity,
    })
    const { scene, camera } = viewer
    viewer.resolutionScale = 1
    scene.postProcessStages.fxaa.enabled = false
    scene.moon = undefined
    tuneAtmosphere(viewer)
    scene.globe.depthTestAgainstTerrain = false
    scene.globe.tileCacheSize = 600
    scene.globe.loadingDescendantLimit = 6
    scene.globe.preloadAncestors = false
    scene.globe.preloadSiblings = false
    scene.globe.maximumScreenSpaceError = 3.2
    scene.globe.dynamicScreenSpaceError = true
    scene.globe.dynamicScreenSpaceErrorDensity = 0.00278
    scene.globe.dynamicScreenSpaceErrorFactor = 4.0
    scene.globe.baseColor = Cesium.Color.fromCssColorString('#6c311b')
    scene.screenSpaceCameraController.minimumZoomDistance = 600
    viewerRef.current = viewer
    viewer.routeLayer = new Cesium.CustomDataSource('route')
    viewer.dataSources.add(viewer.routeLayer)
    viewer.roversLayer = new Cesium.CustomDataSource('rovers')
    viewer.dataSources.add(viewer.roversLayer)
    viewer.waterLayer = new Cesium.CustomDataSource('water')
    viewer.dataSources.add(viewer.waterLayer)
    viewer.sunLayer = new Cesium.CustomDataSource('sun')
    viewer.dataSources.add(viewer.sunLayer)
    viewer.orbitLayer = new Cesium.CustomDataSource('orbiters')
    viewer.dataSources.add(viewer.orbitLayer)
    viewer.baseLayer = new Cesium.CustomDataSource('base')
    viewer.dataSources.add(viewer.baseLayer)

    const onPreRender = () => {
      if (!ORB_CLOCK.rideId || !ORB_CLOCK.show) return
      const orb = ORBITERS.find(o => o.id === ORB_CLOCK.rideId)
      if (!orb) return
      const st = orbiterState(orb, getOrbEpoch())
      camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(st.lon, st.lat, st.vizAlt + 520000),
        orientation: { heading: Cesium.Math.toRadians(st.hdg), pitch: Cesium.Math.toRadians(-52), roll: 0 },
      })
    }
    scene.preRender.addEventListener(onPreRender)

    camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-135, 18, 5.2e7) })
    const initialHash = parseHashRoute()
    if (!initialHash) {
      glide(camera, HOME)
    }

    const updateCompassDom = (hdg, pch) => {
      if (compassRoseRef.current) compassRoseRef.current.style.transform = `rotate(${-hdg}deg)`
      if (compassDegRef.current) compassDegRef.current.textContent = `${String(hdg).padStart(3, '0')}°`
      if (compassCardRef.current) compassCardRef.current.textContent = CARDINAL[Math.round(hdg / 45) % 8]
      if (compassTiltRef.current) compassTiltRef.current.textContent = pch <= -70 ? '2D Top' : `3D ${Math.abs(pch)}°`
    }
    const onMove = () => {
      const hdg = Math.round((Cesium.Math.toDegrees(camera.heading) + 360) % 360)
      const pch = Math.round(Cesium.Math.toDegrees(camera.pitch))
      updateCompassDom(hdg, pch)
      if (visorOpenRef.current) setVisorHeading(hdg)
    }
    const onMoveEnd = () => {
      const c = camera.pickEllipsoid(new Cesium.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2), MARS)
      const g = c ? MARS.cartesianToCartographic(c) : MARS.cartesianToCartographic(camera.position)
      if (g) {
        const nLat = Cesium.Math.toDegrees(g.latitude)
        const nLon = Cesium.Math.toDegrees(g.longitude)
        setCenter(prev => (Math.abs(prev.lat - nLat) > 2 || Math.abs(prev.lon - nLon) > 2 ? { lat: nLat, lon: nLon } : prev))
      }
      const hdg = Math.round((Cesium.Math.toDegrees(camera.heading) + 360) % 360)
      const pch = Math.round(Cesium.Math.toDegrees(camera.pitch))
      updateCompassDom(hdg, pch)
      setCompassHdg(hdg)
      setCompassPitch(pch)
      if (visorOpenRef.current) setVisorHeading(hdg)
    }
    camera.percentageChanged = 0.025
    camera.changed.addEventListener(onMove)
    camera.moveEnd.addEventListener(onMoveEnd)

    // Click 1 → start pin A, click 2 → destination pin B, click 3 → start over (or drop Base Module in 'base' mode)
    const makePin = (letter, below = false) => Object.assign(viewer.entities.add({
      show: false,
      point: { pixelSize: 11, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, heightReference: CLAMP_GND },
      label: {
        font: '600 11px "JetBrains Mono", ui-monospace, monospace',
        pixelOffset: new Cesium.Cartesian2(0, below ? 16 : -16),
        verticalOrigin: below ? Cesium.VerticalOrigin.TOP : Cesium.VerticalOrigin.BOTTOM,
        fillColor: Cesium.Color.WHITE,
        showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
        heightReference: CLAMP_GND,
        eyeOffset: EYE_OFFSET,
      },
    }), { letter })
    const pins = PIN_NAMES.map((nm, i) => makePin(nm, i % 2 === 1))
    viewer.pins = pins
    viewer.hoverPin = makePin('', false)
    if (initialHash) {
      setPinChain(viewerRef, initialHash.pts)
      const [p0, p1] = [initialHash.pts[0], initialHash.pts[initialHash.pts.length - 1]]
      glide(camera, Cesium.Cartesian3.fromDegrees((p0.lon + p1.lon) / 2, (p0.lat + p1.lat) / 2, 52000))
    }
    let downPos = null
    const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas)
    handler.setInputAction(e => { downPos = Cesium.Cartesian2.clone(e.position) }, Cesium.ScreenSpaceEventType.LEFT_DOWN)
    const onSurfaceClick = (e, forceChain = false) => {
      if (downPos && Cesium.Cartesian2.distance(downPos, e.position) > 5) return // ignore drags
      setIntro(false)
      setReplaying(false)
      setRideOrb(null)
      const ray = camera.getPickRay(e.position)
      const c = (ray && scene.globe.pick(ray, scene)) || camera.pickEllipsoid(e.position, MARS)
      if (!c) return
      const g = MARS.cartesianToCartographic(c)
      const lat = Cesium.Math.toDegrees(g.latitude), lon = Cesium.Math.toDegrees(g.longitude)
      if (plannerModeRef.current === 'base') {
        const code = nextModRef.current
        const idxMod = BASE_MODULES.findIndex(m => m.code === code)
        const nextCode = BASE_MODULES[(idxMod + 1) % BASE_MODULES.length].code
        nextModRef.current = nextCode
        setNextMod(nextCode)
        playQuindar(audioRef.current, `Deploying ${code} module`)
        const nodeId = `${code}-${Date.now()}`
        setBaseNodes(prev => [...prev, { id: nodeId, code, lat, lon }])
        getJson(`/api/terrain?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`)
          .then(t => {
            setBaseNodes(prev => prev.map(n => n.id === nodeId ? { ...n, elevation_m: t.elevation_m, slope_deg: t.slope_deg, risk: t.risk, water: t.water } : n))
          })
          .catch(() => {})
        return
      }
      setRouteData(null)
      setHoverIdx(null)
      setRoute(prev => {
        const shouldAppend = (forceChain || chainNextRef.current) && prev.length >= 2 && prev.length < 6
        chainNextRef.current = false
        setChainNext(false)
        const next = shouldAppend ? [...prev, { lat, lon }] : prev.length >= 2 ? [{ lat, lon }] : [...prev, { lat, lon }]
        setLoadingRoute(next.length >= 2)
        playQuindar(audioRef.current, next.length === 1 ? 'Start pin Alpha locked' : `Waypoint ${String.fromCharCode(64 + next.length)} locked, computing MOLA route`)
        setPinChain(viewerRef, next)
        return next
      })
    }
    handler.setInputAction(e => onSurfaceClick(e, false), Cesium.ScreenSpaceEventType.LEFT_CLICK)
    handler.setInputAction(e => onSurfaceClick(e, true), Cesium.ScreenSpaceEventType.LEFT_CLICK, Cesium.KeyboardEventModifier.SHIFT)
    return () => { scene.preRender.removeEventListener(onPreRender); handler.destroy(); viewer.destroy() }
  }, [])

  // 2+ stops set → fetch single-leg or multi-leg chained routes
  useEffect(() => {
    if (route.length < 2) return
    let stale = false
    const ptsParam = route.map(p => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join(';')
    getJson(`/api/route?pts=${encodeURIComponent(ptsParam)}`).then(data => {
      if (stale) return
      setLoadingRoute(false)
      setRouteData(data)
      playQuindar(audioRef.current, `Route locked. Safest path ${((data.safe ?? data.direct).distance_m / 1000).toFixed(1)} kilometers.`)
    }).catch(() => { if (!stale) setLoadingRoute(false) })
    return () => { stale = true }
  }, [route])

  // Render walk-back rings, VHF comm horizon, 3D route lines, 3D terrain curtain wall, 3D vertical station beacons, and MOLA slope hazard zones
  useEffect(() => {
    const v = viewerRef.current
    const ents = v.routeLayer.entities
    ents.removeAll()
    setHoverMarker(viewerRef, false)
    if (route.length < 1) return
    const [a] = route
    const degPerM = 1 / 59158 // 1° latitude on Mars ≈ 59.16 km
    const cosLat = Math.max(Math.cos(a.lat * Math.PI / 180), 0.05)
    const act = routeData && (routeData[profKey] ?? routeData.direct)
    const rings = [[6000, '#5fd38d', '6 KM FOOT EVA LIMIT'], [12000, '#f2c14e', '12 KM ROVER WALK-BACK LIMIT']]
    if (act?.comm?.los_km) {
      rings.push([act.comm.los_km * 1000, '#56b4e9', `HAB VHF LOS (${act.comm.los_km} KM)`])
    }
    for (const [radM, hex, tag] of rings) {
      const col = Cesium.Color.fromCssColorString(hex)
      const ring = Array.from({ length: 65 }, (_, i) => {
        const ang = (i / 64) * Math.PI * 2
        return [a.lat + (radM * degPerM) * Math.sin(ang), a.lon + (radM * degPerM / cosLat) * Math.cos(ang)]
      })
      ents.add({
        polyline: {
          positions: surfLine(ring), width: 1.8, arcType: Cesium.ArcType.GEODESIC, clampToGround: true,
          material: new Cesium.PolylineDashMaterialProperty({ color: col.withAlpha(0.8), dashLength: 10 }),
        },
      })
      ents.add({
        position: surfPos(a.lon, a.lat + radM * degPerM),
        label: {
          text: tag, font: '500 9px "JetBrains Mono", ui-monospace, monospace',
          pixelOffset: new Cesium.Cartesian2(0, -6), verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          fillColor: col, showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1.8e5),
          heightReference: CLAMP_GND,
          eyeOffset: EYE_OFFSET,
        },
      })
    }
    if (!routeData) return
    const { direct, safe, science, hazards } = routeData
    const maxLabelDist = Math.min(Math.max(direct.distance_m * 3.0, 160000), 1200000)

    if (act && act.path.length > 1 && act.distance_m <= 250000) {
      const pMin = Math.min(...act.profile_m)
      const pSpan = Math.max(Math.max(...act.profile_m) - pMin, 1)
      const wCol = Cesium.Color.fromCssColorString(ROUTE_COLOR[profKey])
      ents.add({
        wall: {
          positions: Cesium.Cartesian3.fromDegreesArray(act.path.flatMap(([la, lo]) => [lo, la])),
          minimumHeights: act.profile_m.map(h => h * terrain3d),
          maximumHeights: act.profile_m.map(h => h * terrain3d + 160 + ((h - pMin) / pSpan) * 1400),
          material: wCol.withAlpha(0.2),
          outline: true,
          outlineColor: wCol.withAlpha(0.6),
        },
      })
    }
    ents.add({
      polyline: {
        positions: surfLine(direct.path), width: profKey === 'direct' ? 4 : 2, arcType: Cesium.ArcType.GEODESIC, clampToGround: true,
        material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.fromCssColorString('#e8e0d6').withAlpha(profKey === 'direct' ? 0.95 : 0.55), dashLength: 12 }),
      },
    })
    const stCol = Cesium.Color.fromCssColorString(RISK_COLOR[direct.risk])
    ents.add({
      position: surfPos(direct.max_slope_at.lon, direct.max_slope_at.lat),
      point: { pixelSize: 7, color: stCol, outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5, heightReference: CLAMP_GND },
      label: {
        show: profKey === 'direct',
        text: `▲ ${direct.max_slope_deg}° MAX`, font: '600 10px "JetBrains Mono", ui-monospace, monospace',
        pixelOffset: new Cesium.Cartesian2(12, 0), horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        fillColor: stCol, showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, maxLabelDist),
        heightReference: CLAMP_GND,
        eyeOffset: EYE_OFFSET,
      },
    })
    if (safe) {
      ents.add({
        polyline: {
          positions: surfLine(safe.path), width: profKey === 'safe' ? 6.5 : 4, arcType: Cesium.ArcType.GEODESIC, clampToGround: true,
          material: new Cesium.PolylineGlowMaterialProperty({ color: Cesium.Color.fromCssColorString(RISK_COLOR.safe), glowPower: profKey === 'safe' ? 0.32 : 0.18 }),
        },
      })
    }
    if (science) {
      const gold = Cesium.Color.fromCssColorString('#f2c14e')
      ents.add({
        polyline: {
          positions: surfLine(science.path), width: profKey === 'science' ? 6.5 : 4, arcType: Cesium.ArcType.GEODESIC, clampToGround: true,
          material: new Cesium.PolylineGlowMaterialProperty({ color: gold, glowPower: profKey === 'science' ? 0.32 : 0.18 }),
        },
      })
      science.stations.forEach((st, idx) => {
        const isEven = idx % 2 === 0
        ents.add({
          position: surfPos(st.lon, st.lat),
          point: { pixelSize: 9, color: gold, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, heightReference: CLAMP_GND },
          label: {
            show: profKey === 'science',
            text: `${st.id} · ${st.kind.toUpperCase()}`, font: '600 10px "JetBrains Mono", ui-monospace, monospace',
            pixelOffset: new Cesium.Cartesian2(isEven ? 14 : -14, 0),
            horizontalOrigin: isEven ? Cesium.HorizontalOrigin.LEFT : Cesium.HorizontalOrigin.RIGHT,
            fillColor: gold, showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, maxLabelDist),
            heightReference: CLAMP_GND,
            eyeOffset: EYE_OFFSET,
          },
        })
      })
    }
    if (act?.emergency && envMode !== 'nominal') {
      const em = act.emergency
      const shCol = Cesium.Color.fromCssColorString(envMode === 'spe' ? '#e5484d' : '#f2c14e')
      ents.add({
        position: surfPos(em.shelter_lon, em.shelter_lat),
        point: { pixelSize: 11, color: shCol, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, heightReference: CLAMP_GND },
        label: {
          text: `[SHELTER · ${em.shield_pct}% SHIELD]`,
          font: '600 10px "JetBrains Mono", ui-monospace, monospace',
          pixelOffset: new Cesium.Cartesian2(0, -16), verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          fillColor: shCol, showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
          heightReference: CLAMP_GND,
          eyeOffset: EYE_OFFSET,
        },
      })
    }
    if (showHazards && hazards) {
      for (const hz of hazards) {
        const hCol = Cesium.Color.fromCssColorString(hz.slope_deg >= 20 ? '#e5484d' : hz.slope_deg >= 10 ? '#f2c14e' : '#38bdf8')
        const hDegLat = (hz.radius_km * 1000) * degPerM
        const hDegLon = hDegLat / Math.max(Math.cos(hz.lat * Math.PI / 180), 0.05)
        const hRing = Array.from({ length: 37 }, (_, i) => {
          const ang = (i / 36) * Math.PI * 2
          return [hz.lat + hDegLat * Math.sin(ang), hz.lon + hDegLon * Math.cos(ang)]
        })
        ents.add({
          polyline: {
            positions: surfLine(hRing), width: 1.6, arcType: Cesium.ArcType.GEODESIC, clampToGround: true,
            material: new Cesium.PolylineDashMaterialProperty({ color: hCol.withAlpha(0.75), dashLength: 8 }),
          },
        })
        ents.add({
          position: surfPos(hz.lon, hz.lat),
          point: { pixelSize: 6, color: hCol, outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5, heightReference: CLAMP_GND },
          label: {
            text: `HAZARD ${hz.slope_deg}°`, font: '500 9px "JetBrains Mono", ui-monospace, monospace',
            pixelOffset: new Cesium.Cartesian2(0, -10), verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            fillColor: hCol, showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2.2e5),
            heightReference: CLAMP_GND,
            eyeOffset: EYE_OFFSET,
          },
        })
      }
    }
  }, [route, routeData, profKey, showHazards, envMode, baseNodes.length, terrain3d])

  // Persistent zero-lag imagery stack (never calls removeAll(); local MOLA tiles render in <2ms so Mars never shows blank quadrants)
  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    const layers = v.imageryLayers
    if (!v._marsLayers) {
      const localRust = layers.addImageryProvider(localTileLayer('themis', 8))
      localRust.contrast = 1.12
      localRust.brightness = 1.02

      // Full-globe (-90°..+90°) monochrome thermal-inertia relief base so Night-IR polar caps (>60°N and <-60°S) have zero seam or hole
      const localNightIr = layers.addImageryProvider(localTileLayer('night_ir', 8))
      localNightIr.saturation = 0.0
      localNightIr.brightness = 1.04
      localNightIr.contrast = 1.24

      const viking = layers.addImageryProvider(trekLayer(LAYERS.Imagery))
      viking.contrast = 1.16
      viking.brightness = 1.03
      viking.saturation = 1.12
      viking.gamma = 0.96

      const localElev = layers.addImageryProvider(localTileLayer('elevation', 8))
      localElev.contrast = 1.12
      localElev.brightness = 1.02
      localElev.saturation = 1.14

      // Pole-to-pole (-90°..+90°) 100m THEMIS IR + MOLA thermal blend in monochrome (avoids the ±60° sawtooth polar hole in Trek's controlled mosaic)
      const nightIr = layers.addImageryProvider(usgsWmsLayer('MOLA_THEMIS_blend', 12, 3))
      nightIr.saturation = 0.0
      nightIr.contrast = 1.38
      nightIr.brightness = 1.02
      nightIr.alpha = 0.72

      const themisBlend = layers.addImageryProvider(usgsWmsLayer('MOLA_THEMIS_blend', 12, 3))
      themisBlend.alpha = 0.86
      themisBlend.contrast = 1.18

      const themisHiRes = layers.addImageryProvider(usgsWmsLayer('THEMIS', 12, 6))
      themisHiRes.alpha = 0.42
      themisHiRes.contrast = 1.32

      v._marsLayers = { localRust, localNightIr, viking, localElev, nightIr, themisBlend, themisHiRes }
      v._grsLayers = {}
    }
    if (!v._grsLayers[grsElem]) {
      const grsLayer = layers.addImageryProvider(localTileLayer(`grs_${grsElem}`, 8), 3)
      grsLayer.contrast = 1.12
      grsLayer.brightness = 1.02
      grsLayer.saturation = 1.15
      grsLayer.alpha = layerOpacity
      v._grsLayers[grsElem] = grsLayer
    }
    const { localRust, localNightIr, viking, localElev, nightIr, themisBlend, themisHiRes } = v._marsLayers
    v.scene.globe.baseColor = Cesium.Color.fromCssColorString(layer === 'Night-IR' ? '#88888e' : '#6c311b')
    localRust.show = layer !== 'Night-IR' || layerOpacity < 0.99
    localNightIr.show = layer === 'Night-IR'
    viking.show = layer === 'Imagery'
    localElev.show = layer === 'Elevation'
    nightIr.show = layer === 'Night-IR'
    themisBlend.show = layer === 'THEMIS 100m'
    Object.entries(v._grsLayers).forEach(([k, lyr]) => {
      lyr.show = layer === 'Elements' && k === grsElem
      lyr.alpha = layerOpacity
    })
    themisHiRes.show = layer !== 'Elevation' && layer !== 'Night-IR' && layer !== 'Elements'
    visorOpenRef.current = visor
    setRenderMode(viewerRef, false, visor)
  }, [layer, grsElem, layerOpacity, visor])

  useEffect(() => {
    const v = viewerRef.current
    if (!v || !v._marsLayers) return
    const { localNightIr, localElev, nightIr, themisBlend } = v._marsLayers
    if (localNightIr) localNightIr.alpha = layerOpacity
    if (nightIr) nightIr.alpha = 0.72 * layerOpacity
    if (localElev) localElev.alpha = layerOpacity
    if (themisBlend) themisBlend.alpha = 0.86 * layerOpacity
    if (v._grsLayers) Object.values(v._grsLayers).forEach(lyr => { lyr.alpha = layerOpacity })
    setRenderMode(viewerRef, false, visor)
  }, [layerOpacity, visor])

  // 3D MOLA Terrain Mesh toggle (0 = Flat Ellipsoid, 1..3 = 1x..3x Real MOLA 3D Elevation Mesh)
  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    v.terrainProvider = terrain3d > 0
      ? createMolaTerrainProvider(terrain3d)
      : new Cesium.EllipsoidTerrainProvider({ ellipsoid: MARS })
  }, [terrain3d])

  // Places → markers
  useEffect(() => {
    getJson('/api/places').then(setPlaces).catch(() => {})
    getJson('/api/rovers').then(setRovers).catch(() => {})
    getJson('/api/water').then(setWaterSites).catch(() => {})
  }, [])
  useEffect(() => {
    const layer = viewerRef.current.waterLayer
    layer.show = showWater
    const ents = layer.entities
    ents.removeAll()
    for (const w of waterSites) {
      const col = Cesium.Color.fromCssColorString(w.kind === 'ice' ? '#56b4e9' : '#7fd1c7')
      const degLat = w.radius_km / 59.158
      const degLon = degLat / Math.max(Math.cos(w.lat * Math.PI / 180), 0.15)
      const ring = Array.from({ length: 49 }, (_, i) => {
        const ang = (i / 48) * Math.PI * 2
        return [Math.max(-89.5, Math.min(89.5, w.lat + degLat * Math.sin(ang))), w.lon + degLon * Math.cos(ang)]
      })
      ents.add({
        polyline: {
          positions: surfLine(ring), width: 2, arcType: Cesium.ArcType.GEODESIC, clampToGround: true,
          material: new Cesium.PolylineDashMaterialProperty({ color: col.withAlpha(0.75), dashLength: 12 }),
        },
      })
      ents.add({
        position: surfPos(w.lon, w.lat),
        point: { pixelSize: 7, color: col, outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5, heightReference: CLAMP_GND },
        label: {
          text: `[H2O] ${w.name.toUpperCase()} · ${w.yield.toUpperCase()}`,
          font: '500 10px "JetBrains Mono", ui-monospace, monospace',
          pixelOffset: new Cesium.Cartesian2(0, -14), verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          fillColor: col, showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 7e6),
          heightReference: CLAMP_GND,
          eyeOffset: EYE_OFFSET,
        },
      })
    }
  }, [waterSites, showWater])
  useEffect(() => {
    const layer = viewerRef.current.roversLayer
    layer.show = showRovers
    const ents = layer.entities
    ents.removeAll()
    for (const rv of rovers) {
      const col = Cesium.Color.fromCssColorString(rv.color)
      ents.add({
        polyline: {
          positions: surfLine(rv.path), width: 3, arcType: Cesium.ArcType.GEODESIC, clampToGround: true,
          material: new Cesium.PolylineGlowMaterialProperty({ color: col, glowPower: 0.2 }),
        },
      })
      for (const wp of rv.waypoints) {
        ents.add({
          position: surfPos(wp.lon, wp.lat),
          point: { pixelSize: 7, color: col, outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5, heightReference: CLAMP_GND },
          label: {
            text: `${rv.name.toUpperCase()} · ${wp.label.toUpperCase()}`,
            font: '500 10px "JetBrains Mono", ui-monospace, monospace',
            pixelOffset: new Cesium.Cartesian2(8, 0), horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
            fillColor: col, showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1.6e5),
            heightReference: CLAMP_GND,
            eyeOffset: EYE_OFFSET,
          },
        })
      }
    }
  }, [rovers, showRovers])

  // Live or simulated clocks: Earth ticks locally (or holds planned EVA date), Mars comes from Python backend
  // ponytail: polls once a second when LIVE; switch to a websocket if we add many live feeds
  useEffect(() => {
    const base = `/api/time?lat=${center.lat.toFixed(4)}&lon=${center.lon.toFixed(4)}`
    if (simMs !== null) {
      getJson(`${base}&utc=${encodeURIComponent(new Date(simMs).toISOString())}`)
        .then(setMars).catch(() => setMars(null))
      return
    }
    const tick = () => {
      getJson(base).then(setMars).catch(() => setMars(null))
    }
    tick()
    const id = setInterval(tick, 15000)
    return () => clearInterval(id)
  }, [center, simMs])

  useEffect(() => {
    if (layer !== 'Elements') return
    getJson(`/api/geochem?lat=${center.lat.toFixed(2)}&lon=${center.lon.toFixed(2)}`)
      .then(d => setCenterGeochem(d.point))
      .catch(() => {})
  }, [center, layer])

  // Live solar terminator & directional sunlight on the globe
  useEffect(() => {
    syncSunlight(viewerRef, sunlight, mars, center)
  }, [sunlight, mars, center])

  // Base Builder 3D nodes & microgrid
  useEffect(() => {
    syncBaseLayer(viewerRef, baseNodes)
  }, [baseNodes])

  // When timeRate > 1 (60x / 300x), advance Mars clock every 1.5s without re-rendering 4x/sec
  useEffect(() => {
    if (timeRate <= 1) return
    const id = setInterval(() => {
      setSimMs(prev => (prev ?? Date.now()) + 1500 * timeRate)
    }, 1500)
    return () => clearInterval(id)
  }, [timeRate])

  const surfAnchor = route[0] ?? baseNodes[0] ?? null
  useEffect(() => {
    syncOrbiters(viewerRef, showOrbiters, simMs, timeRate, surfAnchor, rideOrb)
  }, [showOrbiters, simMs, timeRate, surfAnchor, rideOrb])

  // Smooth orbital drift while on the Landing Page
  useEffect(() => {
    const v = viewerRef.current
    if (!v || !intro || visor) return
    let rafId = 0
    const spin = () => {
      v.camera.rotateRight(0.00055)
      v.scene.requestRender()
      rafId = requestAnimationFrame(spin)
    }
    rafId = requestAnimationFrame(spin)
    return () => cancelAnimationFrame(rafId)
  }, [intro, visor])

  // UI entrance
  useEffect(() => {
    const ctx = gsap.context(() => gsap.from('.ui', { opacity: 0, y: 10, duration: 0.9, stagger: 0.08, delay: 0.4, ease: 'power3.out' }))
    return () => ctx.revert()
  }, [])

  const switchLeftTab = tab => {
    setLeftTab(tab)
    const mode = tab === 'base' ? 'base' : 'eva'
    plannerModeRef.current = mode
    setPlannerMode(mode)
    if (tab === 'sim') {
      setShowOrbiters(true)
    } else {
      setShowOrbiters(false)
      setRideOrb(null)
    }
  }
  const selectBaseMod = code => {
    nextModRef.current = code
    setNextMod(code)
  }
  const loadJezeroBase = () => {
    setIntro(false)
    setReplaying(false)
    setRideOrb(null)
    setLeftTab('base')
    plannerModeRef.current = 'base'
    setPlannerMode('base')
    setBaseNodes(JEZERO_BASE_PRESET.map((n, i) => ({ ...n, id: `${n.code}-${i}` })))
    playQuindar(audioRef.current, 'Deploying five-module Jezero Crater surface outpost')
    glide(viewerRef.current.camera, Cesium.Cartesian3.fromDegrees(77.425, 18.475, 28000))
  }
  const clearBase = () => {
    setBaseNodes([])
    syncBaseLayer(viewerRef, [])
  }
  const toggleAudio = () => {
    const next = !audioOn
    audioRef.current = next
    setAudioOn(next)
    if (next) playQuindar(true, 'Mission Control Quindar audio online')
  }
  const toggleSfx = () => {
    const next = !sfxOn
    sfxRef.current = next
    setSfxOn(next)
    if (next) playTick(true, 1650, 0.018, 0.045)
  }
  const runFaqAction = key => {
    playTick(sfxRef.current, 1480, 0.016)
    setFaqOpen(false)
    setIntro(false)
    if (key === 'gale') loadPreset(PRESET_EVAS[1])
    else if (key === 'jezero') loadPreset(PRESET_EVAS[0])
    else if (key === 'nightir') setLayer('Night-IR')
    else if (key === 'elevation') setLayer('Elevation')
    else if (key === 'grs') setLayer('Elements')
    else if (key === 'water') {
      setShowWater(true)
      glide(viewerRef.current.camera, Cesium.Cartesian3.fromDegrees(77.45, 18.45, 4200000))
    } else if (key === 'spe') {
      setEnvMode('spe')
      if (route.length < 2) loadPreset(PRESET_EVAS[0])
    } else if (key === 'orbiters') {
      switchLeftTab('sim')
    } else if (key === 'sunlight') {
      setSunlight(true)
      glide(viewerRef.current.camera, HOME)
    } else if (key === 'comms') {
      setCommsOpen(true)
    } else if (key === 'compass') {
      resetNorth()
    }
  }

  const resetNorth = () => {
    playTick(sfxRef.current, 1500, 0.016)
    const cam = viewerRef.current?.camera
    if (!cam) return
    cam.flyTo({
      destination: cam.position,
      orientation: {
        heading: 0,
        pitch: cam.pitch,
        roll: 0,
      },
      duration: 0.8,
      easingFunction: Cesium.EasingFunction.QUADRATIC_OUT,
    })
  }

  const toggleTilt = () => {
    playTick(sfxRef.current, 1420, 0.015)
    const cam = viewerRef.current?.camera
    if (!cam) return
    const isSteep = cam.pitch < Cesium.Math.toRadians(-70)
    cam.flyTo({
      destination: cam.position,
      orientation: {
        heading: cam.heading,
        pitch: isSteep ? Cesium.Math.toRadians(-45) : Cesium.Math.toRadians(-90),
        roll: 0,
      },
      duration: 0.8,
      easingFunction: Cesium.EasingFunction.QUADRATIC_OUT,
    })
  }

  const { distAu, distKm, owltSec, owltStr } = useMemo(() => {
    const lsDeg = mars?.ls ?? 22.2
    const rad = ((lsDeg - 68) * Math.PI) / 180
    const au = Number((1.52 + 0.62 * Math.sin(rad)).toFixed(3))
    const km = Math.round(au * 149597870.7)
    const sec = Math.round(km / 299792.458)
    const min = Math.floor(sec / 60)
    const rem = sec % 60
    return {
      distAu: au,
      distKm: km,
      owltSec: sec,
      owltStr: `${min}m ${String(rem).padStart(2, '0')}s`,
    }
  }, [mars?.ls])
  const copyLink = () => {
    if (route.length < 2) return
    const ptsStr = route.map(p => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join(';')
    const hash = route.length === 2
      ? `#a=${route[0].lat.toFixed(4)},${route[0].lon.toFixed(4)}&b=${route[1].lat.toFixed(4)},${route[1].lon.toFixed(4)}&suit=${evaSpec}`
      : `#pts=${ptsStr}&suit=${evaSpec}`
    window.history.replaceState(null, '', hash)
    navigator.clipboard?.writeText(window.location.href).catch(() => {})
    setCopied(true)
    playQuindar(audioRef.current, 'Mission link copied to clipboard')
    setTimeout(() => setCopied(false), 2000)
  }
  const clearRoute = () => {
    setRoute([])
    setRouteData(null)
    setHoverIdx(null)
    setLoadingRoute(false)
    setReplaying(false)
    setVisorIdx(0)
    setPreview(null)
    setCheckedSteps({})
    chainNextRef.current = false
    setChainNext(false)
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname)
    hideAllPins(viewerRef)
  }
  const loadPreset = p => {
    setIntro(false)
    setReplaying(false)
    setRouteData(null)
    setHoverIdx(null)
    setLoadingRoute(true)
    setCheckedSteps({})
    chainNextRef.current = false
    setChainNext(false)
    playQuindar(audioRef.current, `Loading ${p.label}`)
    const pts = p.pts ?? [p.a, p.b]
    setPinChain(viewerRef, pts)
    setRoute(pts)
    const midLat = pts.reduce((s, pt) => s + pt.lat, 0) / pts.length
    const midLon = pts.reduce((s, pt) => s + pt.lon, 0) / pts.length
    glide(viewerRef.current.camera, Cesium.Cartesian3.fromDegrees(midLon, midLat, 54000))
  }
  const exportBrief = () => {
    if (!routeData || !activeRoute) return
    const useRover = planMode !== 'walk'
    const rad = activeRoute.radiation
    const comm = activeRoute.comm
    const lines = [
      'MARS ATLAS · APOLLO-STYLE EVA MISSION MANIFEST',
      '==============================================',
      `Planned UTC : ${activeDate.toISOString()}`,
      `Mars Time   : MY ${mars?.mars_year ?? '--'} · Sol ${mars ? Math.floor(mars.sol_date) : '--'} · MTC ${mars?.mtc ?? '--'} · LTST ${mars?.ltst ?? '--'} (${mars?.is_day ? 'DAYLIGHT' : 'NIGHT'})`,
      `Crew & Suit : ${spec.title} (${spec.o2}h O2 budget · ${spec.buddy ? 'Buddy Rover Backup' : `${spec.wb}h Walk-Back Limit`})`,
      `Selected    : ${profKey.toUpperCase()} ROUTE (${spec.o2}h ${MODE_LABEL[planMode]})`,
      `Distance    : ${(activeRoute.distance_m / 1000).toFixed(2)} km one-way · Climb +${activeRoute.climb_m} m / Descent -${activeRoute.descent_m} m`,
      `Max Slope   : ${activeRoute.max_slope_deg}° (${activeRoute.risk.toUpperCase()}) · Science Score ${activeRoute.science_score}/100`,
      `Walk-Back   : ${fmtHours(activeRoute.walk_back_h)} B->A emergency walk-back (${spec.buddy || activeRoute.walk_back_h <= spec.wb ? 'SAFE' : 'EXCEEDS LIMIT'})`,
      comm ? `Comm Link   : ${comm.relay} (Hab Mast VHF Horizon ${comm.los_km} km · ${comm.pass_window})` : '',
      rad ? `RAD Telemetry: ${(useRover ? rad.rover_msv : rad.walk_msv).toFixed(3)} mSv EVA dose (${rad.rate_usv_h} uSv/h · ${rad.status})` : '',
      routeData.water ? `ISRU Water  : ${routeData.water.status} — ${routeData.water.detail} (${routeData.water.source})` : '',
      `Rationale   : ${whyText}`,
      '',
      `TIMED EVA CUFF CHECKLIST (${useRover ? 'ROVER' : 'FOOT'} TIMING):`,
      ...(activeRoute.manifest ?? []).map(m =>
        `[${checkedSteps[m.code] ? 'X' : ' '}] ${useRover ? m.rover_t : m.walk_t} | ${m.code.padEnd(5)} | ${m.km.toFixed(2)} km | O2 ${Math.max(spec.o2 - (8.0 - (useRover ? m.o2_rover_h : m.o2_walk_h)), 0).toFixed(1)}h rem | ${m.title} (${m.elevation_m}m)\n    -> ${m.action}`
      ),
    ].filter(Boolean).join('\n')
    const url = URL.createObjectURL(new Blob([lines], { type: 'text/plain' }))
    Object.assign(document.createElement('a'), { href: url, download: `mars-eva-sol-${mars ? Math.floor(mars.sol_date) : 'plan'}.txt` }).click()
    URL.revokeObjectURL(url)
  }
  const inspectStop = (item, height = 22000) => {
    setPreview(item)
    playQuindar(audioRef.current, item.title)
    glide(viewerRef.current.camera, Cesium.Cartesian3.fromDegrees(item.lon, item.lat, height))
  }
  const openLiveCam = rv => {
    playQuindar(audioRef.current, `Connecting to ${rv.name} live surface camera feed`)
    getJson(`/api/rover-images/${rv.name.toLowerCase()}`)
      .then(res => {
        if (res.images && res.images.length > 0) {
          const imgs = res.images
          setPreview({
            title: `${rv.name} · NASA JPL Raw Surface Feed`,
            sub: `SOL ${res.sol} · ${imgs[0].instrument}`,
            image: imgs[0].image,
            pia: `Sol ${res.sol} Raw`,
            text: imgs[0].caption,
            lat: rv.current[0],
            lon: rv.current[1],
            liveList: imgs,
            liveIdx: 0,
          })
          glide(viewerRef.current.camera, Cesium.Cartesian3.fromDegrees(rv.current[1], rv.current[0], 28000))
        } else {
          const lastWp = rv.waypoints[rv.waypoints.length - 1]
          inspectStop({
            title: `${rv.name} · ${lastWp.label}`,
            sub: `${lastWp.elevation_m.toLocaleString()} m · ${rv.site}`,
            image: lastWp.image,
            pia: lastWp.pia,
            text: lastWp.caption,
            lat: lastWp.lat,
            lon: lastWp.lon,
          }, 28000)
        }
      })
      .catch(() => {
        const lastWp = rv.waypoints[rv.waypoints.length - 1]
        inspectStop({
          title: `${rv.name} · ${lastWp.label}`,
          sub: `${lastWp.elevation_m.toLocaleString()} m · ${rv.site}`,
          image: lastWp.image,
          pia: lastWp.pia,
          text: lastWp.caption,
          lat: lastWp.lat,
          lon: lastWp.lon,
        }, 28000)
      })
  }
  const flyTo = p => {
    setQuery('')
    setVisor(false)
    const cam = viewerRef.current?.camera
    if (!cam) return
    if (terrain3d > 0 && ['volcano', 'canyon', 'crater', 'basin'].includes(p.kind)) {
      cam.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(p.lon, p.lat - 2.2, 165000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-38), roll: 0 },
        duration: 2.6,
        easingFunction: Cesium.EasingFunction.QUINTIC_IN_OUT,
      })
    } else {
      glide(cam, Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 350000))
    }
  }
  const goHome = () => {
    setQuery('')
    setVisor(false)
    clearRoute()
    glide(viewerRef.current.camera, HOME)
  }
  const allSearchable = [...places, ...waterSites.filter(w => !places.some(p => p.name === w.name))]
  const results = query.trim() ? allSearchable.filter(p => (p.name + ' ' + p.kind).toLowerCase().includes(query.trim().toLowerCase())) : []
  const spec = EVA_SPECS[evaSpec]
  const whyText = buildWhy(routeData, spec)
  const activeRoute = routeData && (routeData[profKey] ?? routeData.direct)
  const refRoute = routeData && (routeData.safe ?? routeData.direct)
  const planMode = !routeData ? 'none' : !routeData.safe ? 'none'
    : (!spec.buddy && refRoute.walk_round_trip_h <= spec.o2) ? 'walk'
    : (refRoute.rover_round_trip_h <= spec.o2) ? 'rover' : 'expedition'
  const pathLen = activeRoute ? activeRoute.path.length : 1

  // Mission Replay: automated drone camera flyover along the selected route from A -> S1..S3 -> B
  useEffect(() => {
    if (!replaying || !activeRoute || visor) return
    const pts = activeRoute.path
    const prof = activeRoute.profile_m
    const total = pts.length
    if (total < 2) return
    const steps = Math.min(total, 14)
    let k = 0
    let timer = null
    const stepFly = () => {
      const idx = Math.min(Math.round((k / (steps - 1)) * (total - 1)), total - 1)
      const [lat, lon] = pts[idx]
      const [nLat, nLon] = pts[Math.min(idx + 1, total - 1)]
      const [pLat, pLon] = pts[Math.max(idx - 1, 0)]
      const hdg = idx < total - 1 ? bearingDeg(lat, lon, nLat, nLon) : bearingDeg(pLat, pLon, lat, lon)
      const km = ((activeRoute.distance_m * (idx / (total - 1))) / 1000).toFixed(1)
      const surfH = (prof[idx] ?? 0) * terrain3d
      setHoverIdx(idx)
      setHoverMarker(viewerRef, true, lon, lat, ROUTE_COLOR[profKey], `FLYOVER · ${km} km · ${prof[idx]?.toLocaleString()} m`)
      viewerRef.current?.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(surfH + 14000, 2500)),
        orientation: { heading: Cesium.Math.toRadians(hdg), pitch: Cesium.Math.toRadians(-32), roll: 0 },
        duration: 1.15,
        easingFunction: Cesium.EasingFunction.LINEAR_NONE,
      })
      k += 1
      if (k < steps) {
        timer = setTimeout(stepFly, 1200)
      } else {
        timer = setTimeout(() => { setReplaying(false); setHoverIdx(null); setHoverMarker(viewerRef, false) }, 1400)
      }
    }
    stepFly()
    return () => { if (timer) clearTimeout(timer) }
  }, [replaying, activeRoute, profKey, visor, terrain3d])
  const vIdx = Math.min(visorIdx, Math.max(pathLen - 1, 0))
  const [baseVLat, baseVLon] = activeRoute ? activeRoute.path[vIdx] : (route.length ? [route[0].lat, route[0].lon] : [visorAnchor.lat, visorAnchor.lon])
  const vLat = freeDrive ? freeDrive.lat : baseVLat
  const vLon = freeDrive ? freeDrive.lon : baseVLon
  const vFrac = activeRoute ? vIdx / Math.max(pathLen - 1, 1) : 0
  const vElev = freeDrive?.elev !== undefined ? freeDrive.elev : (activeRoute ? activeRoute.profile_m[vIdx] : null)
  const vSlope = freeDrive?.slope !== undefined ? freeDrive.slope : (activeRoute ? activeRoute.max_slope_deg : 0)
  const vRisk = freeDrive?.risk ?? (vSlope < 10 ? 'safe' : vSlope < 20 ? 'caution' : 'too steep')
  const vElapsedH = activeRoute ? ((planMode === 'walk' ? activeRoute.walk_round_trip_h : activeRoute.rover_round_trip_h) * 0.5) * vFrac : 0
  const vO2RemH = Math.max(spec.o2 - vElapsedH, 0)
  const vWalkBackH = activeRoute ? (spec.buddy ? activeRoute.rover_round_trip_h * 0.5 : activeRoute.walk_back_h) * vFrac : 0
  const vRemKm = activeRoute ? ((activeRoute.distance_m * (1 - vFrac)) / 1000).toFixed(2) : '0.00'
  const cardinal = CARDINAL[Math.round(visorHeading / 45) % 8]
  const enterVisor = () => {
    setCuff(false)
    setFreeDrive(null)
    setVisorAnchor(center)
    setVisorIdx(0)
    setVisor(true)
  }

  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    if (!visor) {
      setMinZoom(viewerRef, 2000)
      return
    }
    setMinZoom(viewerRef, 120)
    if (freeDrive) {
      const surfH = (freeDrive.elev ?? 0) * terrain3d
      v.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(freeDrive.lon, freeDrive.lat, surfH + 1650),
        orientation: { heading: Cesium.Math.toRadians(freeDrive.hdg), pitch: Cesium.Math.toRadians(freeDrive.pitch ?? -13), roll: 0 },
      })
      return
    }
    const path = activeRoute?.path
    const nextPt = path ? path[Math.min(vIdx + 1, path.length - 1)] : null
    const prevPt = path ? path[Math.max(vIdx - 1, 0)] : null
    const hdg = path && vIdx < path.length - 1 ? bearingDeg(baseVLat, baseVLon, nextPt[0], nextPt[1])
      : (path && path.length > 1 ? bearingDeg(prevPt[0], prevPt[1], baseVLat, baseVLon) : 65)
    const surfH = ((activeRoute ? activeRoute.profile_m[vIdx] : 0) ?? 0) * terrain3d
    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(baseVLon, baseVLat, surfH + 1800),
      orientation: { heading: Cesium.Math.toRadians(hdg), pitch: Cesium.Math.toRadians(-14), roll: 0 },
      duration: 1.1,
    })
    if (activeRoute && path && vIdx + 1 < path.length) {
      const tIdx = Math.min(vIdx + 3, path.length - 1)
      const [tLat, tLon] = path[tIdx]
      setHoverMarker(viewerRef, true, tLon, tLat, ROUTE_COLOR[profKey], `WP ${tIdx + 1}/${path.length} · ${activeRoute.profile_m[tIdx]?.toLocaleString()} m`)
    } else {
      setHoverMarker(viewerRef, false)
    }
  }, [visor, vIdx, baseVLat, baseVLon, freeDrive, activeRoute, profKey, terrain3d])

  const stepDrive = (fwdSign = 0, turnDeg = 0) => {
    const curLat = freeDrive ? freeDrive.lat : baseVLat
    const curLon = freeDrive ? freeDrive.lon : baseVLon
    const curHdg = ((freeDrive ? freeDrive.hdg : visorHeading) + turnDeg + 360) % 360
    const curElev = freeDrive?.elev ?? (activeRoute ? activeRoute.profile_m[vIdx] : 0)
    const stepDeg = fwdSign * 0.0085 // ~500m per drive pulse
    const rad = (curHdg * Math.PI) / 180
    const nLat = Math.max(-89.0, Math.min(89.0, curLat + stepDeg * Math.cos(rad)))
    const nLon = ((curLon + (stepDeg * Math.sin(rad)) / Math.max(Math.cos((curLat * Math.PI) / 180), 0.1) + 540) % 360) - 180
    setVisorHeading(Math.round(curHdg))
    setFreeDrive(prev => ({ lat: nLat, lon: nLon, hdg: curHdg, pitch: prev?.pitch ?? -13, elev: curElev, slope: prev?.slope ?? 0, risk: prev?.risk ?? 'safe' }))
    getJson(`/api/terrain?lat=${nLat.toFixed(4)}&lon=${nLon.toFixed(4)}`)
      .then(t => {
        setFreeDrive(prev => prev ? { ...prev, elev: t.elevation_m, slope: t.slope_deg, risk: t.risk, ai: t.ai_slope } : prev)
      })
      .catch(() => {})
  }
  const stepDriveRef = useRef(stepDrive)
  useEffect(() => {
    stepDriveRef.current = stepDrive
  })

  useEffect(() => {
    const layerKeys = Object.keys(LAYERS)
    const onKey = e => {
      if (e.target?.tagName === 'INPUT') return
      if (e.key === '?' || e.key === '/') {
        e.preventDefault()
        playTick(sfxRef.current, 1520, 0.015)
        setFaqOpen(o => !o)
      } else if (e.key === 'Escape') {
        if (faqOpen) {
          setFaqOpen(false)
        } else if (commsOpen) {
          setCommsOpen(false)
        } else if (visor) {
          setVisor(false)
          setFreeDrive(null)
          viewerRef.current?.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(vLon, vLat, 140000), duration: 1.6 })
        } else if (preview) {
          setPreview(null)
        }
      } else if (e.key === 'h' || e.key === 'H') {
        playTick(sfxRef.current, 1320, 0.014)
        setCleanUi(u => !u)
      } else if (e.key === 'l' || e.key === 'L') {
        playTick(sfxRef.current, 1420, 0.014)
        setSunlight(s => !s)
      } else if (!visor && (e.key === 'n' || e.key === 'N')) {
        resetNorth()
      } else if (!visor && (e.key === 'b' || e.key === 'B')) {
        playTick(sfxRef.current, 1420, 0.014)
        setCommsOpen(o => !o)
      } else if (e.key === 'm' || e.key === 'M') {
        const next = !sfxRef.current
        sfxRef.current = next
        setSfxOn(next)
        if (next) playTick(true, 1650, 0.018, 0.045)
      } else if (e.key === 'v' || e.key === 'V') {
        playTick(sfxRef.current, 1580, 0.016)
        if (visor) {
          setVisor(false)
          setFreeDrive(null)
          viewerRef.current?.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(vLon, vLat, 140000), duration: 1.6 })
        } else {
          setCuff(false)
          setFreeDrive(null)
          setVisorAnchor(center)
          setVisorIdx(0)
          setVisor(true)
        }
      } else if (!visor && (e.key === 'c' || e.key === 'C')) {
        playTick(sfxRef.current, 1360, 0.014)
        setCuff(c => !c)
      } else if (!visor && (e.key === 'r' || e.key === 'R')) {
        playTick(sfxRef.current, 1240, 0.015)
        glide(viewerRef.current?.camera, HOME)
      } else if (!visor && ['1', '2', '3', '4', '5'].includes(e.key)) {
        const lk = layerKeys[Number(e.key) - 1]
        if (lk) {
          playTick(sfxRef.current, 1180 + Number(e.key) * 90, 0.014)
          setLayer(lk)
        }
      } else if (visor && (e.key === 'w' || e.key === 'W')) {
        stepDriveRef.current(1, 0)
      } else if (visor && (e.key === 's' || e.key === 'S')) {
        stepDriveRef.current(-1, 0)
      } else if (visor && (e.key === 'a' || e.key === 'A')) {
        stepDriveRef.current(0, -12)
      } else if (visor && (e.key === 'd' || e.key === 'D')) {
        stepDriveRef.current(0, 12)
      } else if (visor && (e.key === 'ArrowRight' || e.key === 'ArrowUp')) {
        setFreeDrive(null)
        setVisorIdx(i => Math.min(i + 1, Math.max(pathLen - 1, 0)))
      } else if (visor && (e.key === 'ArrowLeft' || e.key === 'ArrowDown')) {
        setFreeDrive(null)
        setVisorIdx(i => Math.max(i - 1, 0))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visor, vLat, vLon, pathLen, faqOpen, commsOpen, preview, center])

  const exitVisor = () => {
    setVisor(false)
    setFreeDrive(null)
    setHoverMarker(viewerRef, false)
    viewerRef.current?.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(vLon, vLat, 140000), duration: 1.6 })
  }
  const allHeights = routeData ? ['direct', 'safe', 'science'].flatMap(k => routeData[k]?.profile_m ?? []) : []
  const hMin = allHeights.length ? Math.min(...allHeights) : 0
  const hMax = allHeights.length ? Math.max(...allHeights) : 1
  const hSpan = Math.max(hMax - hMin, 1)
  const svgPts = (prof, W = 360, H = 56) => prof.map((h, i) => `${(i / Math.max(prof.length - 1, 1) * W).toFixed(1)},${(H - 4 - ((h - hMin) / hSpan) * (H - 8)).toFixed(1)}`).join(' ')

  const sampleProfilePoint = idx => {
    if (!activeRoute) return null
    const n = Math.max(activeRoute.profile_m.length - 1, 1)
    const frac = idx / n
    const [lat, lon] = activeRoute.path[idx]
    const elev = activeRoute.profile_m[idx]
    const km = (activeRoute.distance_m * frac) / 1000
    const prevIdx = Math.max(0, idx - 1)
    const nextIdx = Math.min(n, idx + 1)
    const dElev = Math.abs((activeRoute.profile_m[nextIdx] ?? elev) - (activeRoute.profile_m[prevIdx] ?? elev))
    const segM = Math.max((activeRoute.distance_m / n) * Math.max(nextIdx - prevIdx, 1), 1)
    const rawSlope = Math.atan(dElev / segM) * (180 / Math.PI)
    const slopeDeg = Math.min(activeRoute.max_slope_deg, Number(Math.max(rawSlope, 0.8).toFixed(1)))
    const totH = (planMode === 'walk' ? activeRoute.walk_round_trip_h : activeRoute.rover_round_trip_h) * 0.5
    const o2Rem = Math.max(spec.o2 - totH * frac, 0)
    return { lat, lon, elev, km, slopeDeg, o2Rem }
  }

  const onProfileHover = e => {
    if (!activeRoute) return
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
    const idx = Math.round(frac * (activeRoute.profile_m.length - 1))
    if (idx !== hoverIdx) {
      const pitch = 980 + ((activeRoute.profile_m[idx] - hMin) / hSpan) * 520
      playTick(sfxRef.current, pitch, 0.008, 0.02)
      setHoverIdx(idx)
    }
    const pt = sampleProfilePoint(idx)
    if (pt) {
      setHoverMarker(
        viewerRef,
        true,
        pt.lon,
        pt.lat,
        ROUTE_COLOR[profKey],
        `▲ ${pt.km.toFixed(1)} km · ${pt.elev.toLocaleString()} m · ${pt.slopeDeg}° · O2 ${pt.o2Rem.toFixed(1)}h`,
      )
    }
  }
  const onProfileClick = () => {
    if (hoverIdx === null || !activeRoute) return
    const pt = sampleProfilePoint(hoverIdx)
    if (!pt) return
    playTick(sfxRef.current, 1620, 0.016)
    glide(viewerRef.current?.camera, Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, 26000))
  }
  const onProfileLeave = () => {
    setHoverIdx(null)
    setHoverMarker(viewerRef, false)
  }
  const refEpoch = simMs ?? (mars?.utc ? Date.parse(mars.utc) : initEpoch)
  const activeDate = new Date(refEpoch)
  const shiftSim = deltaMs => setSimMs(prev => (prev ?? Date.now()) + deltaMs)
  const safeAnchor = route[0] ?? baseNodes[0] ?? visorAnchor
  const distToSafeKm = surfaceDistKm(vLat, vLon, safeAnchor.lat, safeAnchor.lon)
  const commBucket = Math.floor(refEpoch / 30000)
  const commLatBucket = Math.round(vLat * 10)
  const commLonBucket = Math.round(vLon * 10)
  const liveComm = useMemo(
    () => orbiterCommWindow(commLatBucket / 10, commLonBucket / 10, commBucket * 30000),
    [commLatBucket, commLonBucket, commBucket],
  )
  const leakResult = leakSec === null ? null : distToSafeKm <= 0.85 ? 'survived' : leakSec <= 0 ? 'depleted' : null

  useEffect(() => {
    setRenderMode(viewerRef, !!(showOrbiters || replaying || rideOrb), visor)
  }, [showOrbiters, replaying, rideOrb, layer, terrain3d, sunlight, showWater, showHazards, routeData, baseNodes, visor, freeDrive, visorIdx])

  useEffect(() => {
    if (!visor || leakSec === null || leakResult || leakSec <= 0) return
    const id = setTimeout(() => setLeakSec(s => (s !== null && s > 0 ? s - 1 : 0)), 1000)
    return () => clearTimeout(id)
  }, [visor, leakSec, leakResult])

  const startLeakDrill = () => setLeakSec(180)
  const stopLeakDrill = () => setLeakSec(null)

  const baseTotals = baseNodes.reduce((acc, n) => {
    const mod = BASE_MODULES.find(m => m.code === n.code) ?? BASE_MODULES[0]
    const kw = mod.kw > 0 && envMode === 'dust' ? Math.round(mod.kw * 0.55) : mod.kw
    return { kw: acc.kw + kw, h2o: acc.h2o + mod.h2o, o2: acc.o2 + mod.o2 }
  }, { kw: 0, h2o: 0, o2: 0 })

  const faqCategories = ['All', 'Survival & EVA', 'Terrain & Physics', 'NASA Data & Layers', 'Controls & Hotkeys']
  const filteredFaqs = FAQ_ITEMS.filter(item => {
    const matchCat = faqCat === 'All' || item.cat === faqCat
    const q = faqQuery.trim().toLowerCase()
    const matchQ = !q || item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q) || item.cat.toLowerCase().includes(q)
    return matchCat && matchQ
  })
  const hoverPt = hoverIdx !== null ? sampleProfilePoint(hoverIdx) : null
  const renderProfileScrubber = () => activeRoute && (
    <div className="profile">
      <div className="profhead">
        <label>Elevation &amp; Slope Scrubber ({hMin.toLocaleString()}m → {hMax.toLocaleString()}m)</label>
        <div className="proftabs">
          {[['safe', 'Safest'], ['science', 'Science'], ['direct', 'Direct']].map(([k, lbl]) => routeData[k] && (
            <button key={k} aria-pressed={profKey === k} style={{ '--c': ROUTE_COLOR[k] }} onClick={() => { playTick(sfxRef.current, 1420, 0.014); setProfKey(k); onProfileLeave() }}>{lbl}</button>
          ))}
        </div>
      </div>
      <svg
        viewBox="0 0 360 56"
        className="profsvg"
        onMouseMove={onProfileHover}
        onMouseLeave={onProfileLeave}
        onClick={onProfileClick}
      >
        {['direct', 'safe', 'science'].map(k => routeData[k] && k !== profKey && (
          <polyline key={k} fill="none" stroke={ROUTE_COLOR[k]} strokeOpacity="0.25" strokeWidth="1.2" points={svgPts(routeData[k].profile_m)} />
        ))}
        <polygon fill={ROUTE_COLOR[profKey]} fillOpacity="0.14" points={`0,56 ${svgPts(activeRoute.profile_m)} 360,56`} />
        <polyline fill="none" stroke={ROUTE_COLOR[profKey]} strokeWidth="2" points={svgPts(activeRoute.profile_m)} />
        {hoverIdx !== null && activeRoute.profile_m[hoverIdx] !== undefined && (() => {
          const x = (hoverIdx / Math.max(activeRoute.profile_m.length - 1, 1)) * 360
          const y = 52 - ((activeRoute.profile_m[hoverIdx] - hMin) / hSpan) * 48
          return (
            <g>
              <line x1={x} y1="0" x2={x} y2="56" stroke="#f4f4f0" strokeOpacity="0.65" strokeDasharray="2 2" />
              <circle cx={x} cy={y} r="4" fill={ROUTE_COLOR[profKey]} stroke="#09090b" strokeWidth="1.5" />
            </g>
          )
        })()}
      </svg>
      <div className="profmeta">
        <span>A · {activeRoute.profile_m[0]?.toLocaleString()}m</span>
        <span style={{ color: hoverPt ? 'var(--dust)' : undefined }}>
          {hoverPt
            ? `${hoverPt.km.toFixed(1)} km · ${hoverPt.elev.toLocaleString()}m · ${hoverPt.slopeDeg}° · O2 ${hoverPt.o2Rem.toFixed(1)}h (Click → Fly)`
            : 'Scrub to trace 3D beacon · Click to fly'}
        </span>
        <span>B · {activeRoute.profile_m.at(-1)?.toLocaleString()}m</span>
      </div>
    </div>
  )

  return (
    <>
      <div ref={globeRef} className={`globe${intro ? ' globe-landing' : ''}${envMode === 'dust' ? ' dust-haze' : ''}${envMode === 'spe' ? ' spe-haze' : ''}`} />

      {intro && !visor && (
        <div className="landing-wrap">
          <header className="landing-nav">
            <div className="landing-nav-inner">
              <button className="mark" onClick={goHome}>
                <img src="/logo.svg" alt="" className="brand-logo" />
                Mars Atlas
              </button>
              <div className="landing-links">
                <button onClick={() => { playTick(sfxRef.current, 1480, 0.016); loadPreset(PRESET_EVAS[0]) }}>Expeditions</button>
                <button onClick={() => { playTick(sfxRef.current, 1520, 0.016); setFaqOpen(true) }}>Field Manual</button>
                <span className="landing-sol">Sol {mars ? Math.floor(mars.sol_date).toLocaleString() : '54,342'} · {mars?.mtc ?? '17:34'} MTC</span>
              </div>
              <button className="island-cta" onClick={() => { playTick(sfxRef.current, 1560, 0.016); setIntro(false) }}>
                <span>Open 3D Map</span>
                <span className="cta-circle">↗</span>
              </button>
            </div>
          </header>

          <main className="landing-hero">
            <div className="eyebrow-pill">
              <span className="eyebrow-dot" />
              NASA MOLA 32PPD &amp; THEMIS 100M ORBITAL ATLAS
            </div>
            <h1 className="landing-title">
              Chart your path across the <em>Red Planet.</em>
            </h1>
            <p className="landing-lead">
              An interactive 3D terrain and survival atlas of Mars. Simulate autonomous rover and foot traverses, inspect live NASA surface cameras, and design self-sustaining habitats.
            </p>
            <div className="landing-actions">
              <button className="primary-pill-cta" onClick={() => { playTick(sfxRef.current, 1580, 0.018); setIntro(false) }}>
                <span>Explore 3D Atlas</span>
                <span className="cta-circle">↗</span>
              </button>
              <button className="secondary-pill-cta" onClick={() => { playTick(sfxRef.current, 1520, 0.016); setFaqOpen(true) }}>
                Survival Field Manual
              </button>
            </div>

            <div className="landing-bento">
              <div className="bento-shell">
                <button className="bento-card" onClick={() => { playTick(sfxRef.current, 1480, 0.016); loadPreset(PRESET_EVAS[0]) }}>
                  <div className="bento-top">
                    <span className="bento-tag">Perseverance · 18.4°N 77.5°E</span>
                    <span className="bento-icon">↗</span>
                  </div>
                  <strong>Jezero Crater Delta</strong>
                  <p>4-waypoint carbonate margin traverse with live Mastcam-Z imagery</p>
                </button>
              </div>
              <div className="bento-shell">
                <button className="bento-card" onClick={() => { playTick(sfxRef.current, 1440, 0.016); loadPreset(PRESET_EVAS[1]) }}>
                  <div className="bento-top">
                    <span className="bento-tag">Curiosity · 5.4°S 137.8°E</span>
                    <span className="bento-icon">↗</span>
                  </div>
                  <strong>Mount Sharp Ascent</strong>
                  <p>Bradbury Landing to Gediz Vallis sulfate ridge climb</p>
                </button>
              </div>
              <div className="bento-shell">
                <button className="bento-card" onClick={() => { playTick(sfxRef.current, 1400, 0.016); loadPreset(PRESET_EVAS[2]) }}>
                  <div className="bento-top">
                    <span className="bento-tag">21.2 km Shield Volcano</span>
                    <span className="bento-icon">↗</span>
                  </div>
                  <strong>Olympus Mons Summit</strong>
                  <p>Caldera rim expedition across the tallest peak in the solar system</p>
                </button>
              </div>
            </div>
          </main>
        </div>
      )}

      {faqOpen && (
        <div className="faq-backdrop" role="dialog" aria-modal="true" aria-label="Martian Survival FAQ and Field Manual" onClick={e => { if (e.target === e.currentTarget) setFaqOpen(false) }}>
          <div className="faq-shell">
            <div className="faq-modal">
              <div className="faq-head">
                <div>
                  <div className="intro-kicker">INTERPLANETARY SURVIVAL GUIDE · FIELD MANUAL</div>
                  <h2>Martian Survival &amp; Mission Reference</h2>
                  <p className="faq-sub">Core engineering constraints, NASA orbital datasets, and crew safety rules used across Mars Atlas.</p>
                </div>
                <button className="closebtn" onClick={() => setFaqOpen(false)} aria-label="Close Field Manual">✕</button>
              </div>
              <div className="faq-toolbar">
                <div className="faq-cats" role="tablist" aria-label="FAQ Categories">
                  {faqCategories.map(cat => (
                    <button
                      key={cat}
                      role="tab"
                      aria-pressed={faqCat === cat}
                      onClick={() => { playTick(sfxRef.current, 1340, 0.012); setFaqCat(cat) }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                <input
                  type="search"
                  className="faq-search"
                  placeholder="Search slope, water, Night-IR, O2…"
                  value={faqQuery}
                  onChange={e => setFaqQuery(e.target.value)}
                  aria-label="Filter FAQ questions"
                />
              </div>
              <div className="faq-grid">
                {filteredFaqs.map((item, idx) => (
                  <article key={idx} className="faq-card">
                    <div className="faq-card-top">
                      <span className="faq-badge">{item.cat}</span>
                      <span className="faq-idx">0{idx + 1}</span>
                    </div>
                    <h3>{item.q}</h3>
                    {item.stats && (
                      <div className="faq-stats">
                        {item.stats.map(st => (
                          <span key={st} className="faq-stat-chip">{st}</span>
                        ))}
                      </div>
                    )}
                    <p>{item.a}</p>
                    {item.actionKey && (
                      <button className="faq-act" onClick={() => runFaqAction(item.actionKey)}>
                        <span>{item.actionLabel}</span>
                        <span aria-hidden="true">↗</span>
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {!intro && !visor && (envMode !== 'nominal' || rideOrb) && (
        <div className={`ui alertbar ${envMode}`} role="status" aria-live="polite">
          {rideOrb && (
            <span>
              <b>Orbital View · {rideOrb}:</b> Riding {ORBITERS.find(o => o.id === rideOrb)?.name} ({ORBITERS.find(o => o.id === rideOrb)?.payload})
              <button onClick={() => { setRideOrb(null); glide(viewerRef.current.camera, HOME) }}>Exit Orbit ×</button>
            </span>
          )}
          {envMode === 'dust' && (
            <span>
              <b>Regional Dust Storm (τ = 3.8):</b> Visibility 0.6 km · Solar Output 22% · Rover Speed -45%
              <button onClick={() => setEnvMode('nominal')}>Clear Storm ×</button>
            </span>
          )}
          {envMode === 'spe' && (
            <span>
              <b>Solar Particle Event (S3 Flare):</b> Dose Rate {activeRoute?.radiation?.spe_rate_usv_h ?? 388.5} μSv/h ·{' '}
              {activeRoute?.emergency ? `Abort to ${activeRoute.emergency.shelter_type} (${activeRoute.emergency.shield_pct}% Shield)` : 'Seek Subsurface Shelter Immediately'}
              {activeRoute?.emergency && (
                <button onClick={() => glide(viewerRef.current.camera, Cesium.Cartesian3.fromDegrees(activeRoute.emergency.shelter_lon, activeRoute.emergency.shelter_lat, 18000))}>
                  Fly to Shelter →
                </button>
              )}
              <button onClick={() => setEnvMode('nominal')}>Clear Alert ×</button>
            </span>
          )}
        </div>
      )}

      {!intro && (
        <header className="ui bar">
          <div className="island-pill brand-island">
            <button className="mark" onClick={goHome} aria-label="Back to full Mars view">
              <img src="/logo.svg" alt="" className="brand-logo" />
              Mars Atlas
            </button>
            <span className="island-sep" />
            <button className="cleanbtn" onClick={() => { playTick(sfxRef.current, 1480, 0.014); setIntro(true) }} title="Return to Landing Overview">
              Overview
            </button>
            <button className="cleanbtn" aria-pressed={sunlight} onClick={() => { playTick(sfxRef.current, 1420, 0.014); setSunlight(s => !s) }} title="Toggle Live Solar Terminator (Shortcut: L)">
              ☀ Sunlight
            </button>
            <button className="cleanbtn" aria-pressed={cleanUi} onClick={() => { playTick(sfxRef.current, 1320, 0.014); setCleanUi(u => !u) }} title="Hide side panels for clean globe (Shortcut: H)">
              {cleanUi ? 'Show Panels' : 'Clean View'}
            </button>
            <button className="cleanbtn faqbtn" aria-pressed={faqOpen} onClick={() => { playTick(sfxRef.current, 1520, 0.016); setFaqOpen(o => !o) }} title="Open Martian Survival FAQ & Field Manual (Shortcut: ?)">
              Field Manual
            </button>
          </div>

          <div className="island-pill telemetry-island">
            <span className="tele-item"><b>Sol {mars ? Math.floor(mars.sol_date).toLocaleString() : '54,342'}</b></span>
            <span className="island-sep" />
            <span className="tele-item">MTC <b>{mars?.mtc ?? '--:--:--'}</b></span>
            <span className="island-sep" />
            <span className="tele-item">Ls <b>{mars ? `${mars.ls.toFixed(1)}°` : '--'}</b></span>
            <span className="island-sep" />
            <span className="tele-item">{simMs !== null ? 'Sim' : 'UTC'} <b><EarthClock simMs={simMs} /></b></span>
            <span className="island-sep" />
            <button
              className="cleanbtn comms-pill-btn"
              onClick={() => { playTick(sfxRef.current, 1420, 0.014); setCommsOpen(o => !o) }}
              title="Deep Space Network (DSN) Bandwidth & Interplanetary Comms (Shortcut: B)"
              aria-expanded={commsOpen}
            >
              <span className={`signal-dot signal-${envMode}`} />
              <span className="comms-pill-text">
                DSN <b>{envMode === 'spe' ? '8 kbps' : envMode === 'dust' ? '128 kbps' : '2.05 Mbps'}</b>
              </span>
              <span className="bw-owlt">· {owltStr}</span>
            </button>
          </div>
        </header>
      )}

      {!cleanUi && !intro && !visor && !cuff && (
        <div className="dock-left">
          <div className="bezel-shell">
            <section className="ui panel search">
              <div className="modeswitch" role="tablist" aria-label="Left Console Section">
                <button role="tab" aria-pressed={leftTab === 'explore'} onClick={() => switchLeftTab('explore')}>Explore</button>
                <button role="tab" aria-pressed={leftTab === 'sim'} onClick={() => switchLeftTab('sim')}>Orbit &amp; Sim</button>
                <button role="tab" aria-pressed={leftTab === 'base'} onClick={() => switchLeftTab('base')}>Habitat ({baseNodes.length})</button>
              </div>

              {leftTab === 'explore' && (
                <>
                  <input id="q" aria-label="Search Mars" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search crater, volcano, lander…" autoComplete="off" />
                  {results.length > 0 ? (
                    <ul role="listbox" aria-label="Places">
                      {results.map(p => (
                        <li key={p.name}><button onClick={() => flyTo(p)}><span>{p.name}</span><em>{p.kind}</em></button></li>
                      ))}
                    </ul>
                  ) : (
                    <div className="quickhub">
                      <label>Featured Expeditions</label>
                      <div className="evacards">
                        {PRESET_EVAS.map(p => (
                          <button key={p.id} onClick={() => loadPreset(p)}>
                            <span>{p.label}</span>
                            <em className="card-arrow">↗</em>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {rovers.length > 0 && (
                    <div className="rovers">
                      <div className="rovhead">
                        <button className="sectoggle" aria-expanded={roversOpen} onClick={() => setRoversOpen(o => !o)}>
                          Active Rovers ({rovers.length}) {roversOpen ? '▴' : '▾'}
                        </button>
                        <button className="toggle" aria-pressed={showRovers} onClick={() => setShowRovers(s => !s)}>
                          {showRovers ? 'Visible' : 'Hidden'}
                        </button>
                      </div>
                      {roversOpen && rovers.map(rv => (
                        <div key={rv.name} className="rovcard">
                          <button className="rovmain" onClick={() => glide(viewerRef.current.camera, Cesium.Cartesian3.fromDegrees(rv.current[1], rv.current[0], 32000))}>
                            <span style={{ color: rv.color }}>● {rv.name}</span>
                            <em>{rv.distance_km} km{rv.latest_sol ? ` · Sol ${rv.latest_sol}` : ''}</em>
                          </button>
                          <div className="rovjumps">
                            <button
                              className="livecambtn"
                              onClick={() => openLiveCam(rv)}
                              title={`NASA Live Surface Raw Photos from ${rv.name}`}
                            >
                              Live Cam
                            </button>
                            {rv.waypoints.map(wp => (
                              <button
                                key={wp.label}
                                onClick={() => inspectStop({
                                  title: `${rv.name} · ${wp.label}`,
                                  sub: `${wp.elevation_m.toLocaleString()} m · ${rv.site}`,
                                  image: wp.image,
                                  pia: wp.pia,
                                  text: wp.caption,
                                  lat: wp.lat,
                                  lon: wp.lon,
                                }, 18000)}
                              >
                                {wp.label === 'Quarter Traverse' ? '25%' : wp.label === 'Current Position' ? 'Now →' : wp.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {leftTab === 'sim' && (
                <div className="quickhub">
                  <label>Atmospheric &amp; Solar Simulation</label>
                  <div className="envbtns" role="group" aria-label="Space Weather and Dust Storm Simulation">
                    <button aria-pressed={envMode === 'nominal'} onClick={() => setEnvMode('nominal')}>Clear Sky</button>
                    <button className="dustbtn" aria-pressed={envMode === 'dust'} onClick={() => { setEnvMode('dust'); playQuindar(audioRef.current, 'Warning: Regional dust storm tau 3.8') }}>Dust Storm</button>
                    <button className="spebtn" aria-pressed={envMode === 'spe'} onClick={() => { setEnvMode('spe'); playQuindar(audioRef.current, 'Red Alert: S3 Solar Particle Event, abort to rock shelter') }}>Solar Flare</button>
                  </div>
                  <div className="rovers" style={{ marginTop: 8 }}>
                    <div className="rovhead">
                      <span className="sectoggle">Relay Orbiters (3)</span>
                      <button className="toggle" aria-pressed={showOrbiters} onClick={() => { setShowOrbiters(s => !s); if (rideOrb) setRideOrb(null) }}>
                        {showOrbiters ? '3D Live' : 'Hidden'}
                      </button>
                    </div>
                    {ORBITERS.map(orb => (
                      <div key={orb.id} className="rovcard">
                        <div className="rovmain">
                          <span style={{ color: orb.color }}>● {orb.id} · {orb.altKm} km</span>
                          <button className="ridebtn" aria-pressed={rideOrb === orb.id} onClick={() => { setShowOrbiters(true); setRideOrb(r => r === orb.id ? null : orb.id) }}>
                            {rideOrb === orb.id ? 'Riding ×' : 'Board 3D →'}
                          </button>
                        </div>
                        <div className="orbmeta">{orb.payload}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {leftTab === 'base' && (
                <div className="quickhub">
                  <label>Click Mars to Place Module ({nextMod})</label>
                  <div className="chipgrid">
                    {BASE_MODULES.map(m => (
                      <button key={m.code} aria-pressed={nextMod === m.code} onClick={() => selectBaseMod(m.code)} style={{ borderColor: nextMod === m.code ? m.color : undefined }}>
                        {m.code} · {m.kw > 0 ? `+${m.kw}kW` : `${m.kw}kW`}
                      </button>
                    ))}
                  </div>
                  <div className="evacards" style={{ marginTop: 6 }}>
                    <button onClick={loadJezeroBase}>
                      <span>Deploy Jezero 5-Node Habitat</span>
                      <em className="card-arrow">↗</em>
                    </button>
                  </div>
                </div>
              )}

              <div className="local-footer" aria-live="polite">
                <div className="local-top">
                  <div>
                    <span className="local-label">Local Solar Time · {fmtDeg(center.lat, 'N', 'S')} {fmtDeg(center.lon, 'E', 'W')}</span>
                    <div className="local-clock-row">
                      <strong className="big">{mars?.ltst ?? '--:--:--'}</strong>
                      <span className="day-badge" style={{ color: mars?.is_day ? '#4ade80' : '#fbbf24' }}>
                        {mars ? (mars.is_day ? '● Daylight' : '◐ Night') : '—'}
                      </span>
                    </div>
                  </div>
                  <button className="livebtn" aria-pressed={simMs === null && timeRate === 1} onClick={() => { setTimeRate(1); setSimMs(null) }}>
                    {simMs === null && timeRate === 1 ? 'Live' : 'Reset'}
                  </button>
                </div>
                <div className="local-meta-row">
                  <span>Sunrise <b>{mars?.sunrise_ltst?.slice(0, 5) ?? '--'}</b></span>
                  <span>Sunset <b>{mars?.sunset_ltst?.slice(0, 5) ?? '--'}</b></span>
                  <div className="rate-group">
                    {[1, 60, 300].map(r => (
                      <button key={r} className="ratebtn" aria-pressed={timeRate === r} onClick={() => setTimeRate(r)}>
                        {r}×
                      </button>
                    ))}
                    <button className="ratebtn" aria-expanded={dateOpen} onClick={() => setDateOpen(o => !o)}>
                      {dateOpen ? 'Date ▴' : 'Date ▾'}
                    </button>
                  </div>
                </div>
                {dateOpen && (
                  <div className="evadate">
                    <div className="dtcontrols">
                      <input
                        id="evadt"
                        type="datetime-local"
                        className="dtinput"
                        value={toLocalIso(activeDate)}
                        onChange={e => e.target.value && setSimMs(new Date(e.target.value).getTime())}
                      />
                      <button onClick={() => shiftSim(-7200e3)}>-2h</button>
                      <button onClick={() => shiftSim(7200e3)}>+2h</button>
                      <button onClick={() => shiftSim(SOL_MS)}>+1 Sol</button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {!visor && !cuff && !cleanUi && !intro && (
        <p className="ui hint" aria-live="polite">
          <span className="hintdot" />
          {plannerMode === 'base'
            ? `Base Builder · Click Mars to drop ${nextMod} (${baseNodes.length} modules placed)`
            : loadingRoute
              ? 'Computing safest & science routes across MOLA terrain…'
              : chainNext
                ? `Click Mars to append Stop ${String.fromCharCode(65 + route.length)}`
                : route.length === 0
                  ? 'Step 1/2 · Click Mars to set start pin A'
                  : route.length === 1
                    ? 'Step 2/2 · Click destination pin B'
                    : `EVA ${route.map((_, i) => String.fromCharCode(65 + i)).join(' → ')} · Shift+Click to add stop`}
          {plannerMode === 'eva' && route.length >= 2 && route.length < 6 && (
            <button className="clearbtn" aria-pressed={chainNext} onClick={() => { chainNextRef.current = !chainNext; setChainNext(c => !c) }}>
              {chainNext ? 'Cancel Stop' : `+ Stop ${String.fromCharCode(65 + route.length)}`}
            </button>
          )}
          {plannerMode === 'base' && baseNodes.length > 0 && <button className="clearbtn" onClick={clearBase}>× Clear Base</button>}
          {plannerMode === 'eva' && route.length > 0 && <button className="clearbtn" onClick={clearRoute}>× Clear</button>}
        </p>
      )}

      {!intro && !visor && !cleanUi && (
        <aside
          className={`ui-compass${(preview || cuff || routeData || baseNodes.length > 0 || layer === 'Elements') ? ' ui-compass--shifted' : ''}`}
          role="region"
          aria-label="Martian 3D Compass & Heading"
        >
          <button
            className="compass-btn"
            onClick={resetNorth}
            title={`Bearing: ${String(compassHdg).padStart(3, '0')}° ${CARDINAL[Math.round(compassHdg / 45) % 8]} · Click to Align True North [N]`}
            aria-label="Reset orientation to True North"
          >
            <div ref={compassRoseRef} className="compass-rose" style={{ transform: `rotate(${-compassHdg}deg)` }}>
              <svg viewBox="0 0 52 52" className="compass-svg" aria-hidden="true">
                <circle cx="26" cy="26" r="23" className="compass-dial-ring" />
                <line x1="26" y1="3" x2="26" y2="7" className="tick-n" />
                <line x1="49" y1="26" x2="45" y2="26" className="tick" />
                <line x1="26" y1="49" x2="26" y2="45" className="tick" />
                <line x1="3" y1="26" x2="7" y2="26" className="tick" />
                <polygon points="26,6 30.5,26 26,23 21.5,26" className="needle-n" />
                <polygon points="26,46 30.5,26 26,29 21.5,26" className="needle-s" />
                <circle cx="26" cy="26" r="3" className="needle-pivot" />
                <text x="26" y="15" className="compass-n-text">N</text>
              </svg>
            </div>
            <div className="compass-readout">
              <span ref={compassDegRef} className="compass-deg">{String(compassHdg).padStart(3, '0')}°</span>
              <span ref={compassCardRef} className="compass-card">{CARDINAL[Math.round(compassHdg / 45) % 8]}</span>
            </div>
          </button>
          <button
            ref={compassTiltRef}
            className="compass-tilt"
            onClick={toggleTilt}
            title="Toggle Top-Down 2D Nadir vs 3D Oblique Tilt"
          >
            {compassPitch <= -70 ? '2D Top' : `3D ${Math.abs(compassPitch)}°`}
          </button>
        </aside>
      )}

      {!intro && !visor && !cleanUi && (preview || cuff || routeData || baseNodes.length > 0 || layer === 'Elements') && (
        <div className="dock-right">
          {layer === 'Elements' && (
            <aside className="ui panel grs-panel" role="region" aria-label="Mars Odyssey GRS Element Selector">
              <div className="routehead">
                <label>Odyssey GRS · Surface Elements</label>
                <span className="grs-chip">1,451 Cells · 5°×5°</span>
              </div>
              <div className="grs-pills" role="tablist" aria-label="Chemical Elements and Dust Index">
                {GRS_ELEMENTS.map(el => (
                  <button
                    key={el.key}
                    role="tab"
                    aria-pressed={grsElem === el.key}
                    onClick={() => { playTick(sfxRef.current, 1320, 0.014); setGrsElem(el.key) }}
                    title={`${el.name}: ${el.desc}`}
                  >
                    {el.label}
                  </button>
                ))}
              </div>
              <div className="grs-scale" title="Normalized GRS concentration z-score (σ)">
                <span>-2.5σ Depleted</span>
                <i className="grs-ramp" />
                <span>+2.5σ Enriched</span>
              </div>
              <div className="grs-meta">
                <div>
                  <b>{GRS_ELEMENTS.find(e => e.key === grsElem)?.name}:</b>{' '}
                  {GRS_ELEMENTS.find(e => e.key === grsElem)?.desc}
                </div>
                {centerGeochem && (
                  <div className="grs-readout">
                    {fmtDeg(centerGeochem.centroid_lat, 'N', 'S')} {fmtDeg(centerGeochem.centroid_lon, 'E', 'W')} ·{' '}
                    <b>{grsElem} {centerGeochem.elements[grsElem] >= 0 ? `+${centerGeochem.elements[grsElem]}` : centerGeochem.elements[grsElem]}σ</b> ·{' '}
                    {centerGeochem.dichotomy} · Volcanic {centerGeochem.volcanic_pct}%
                  </div>
                )}
              </div>
            </aside>
          )}
          {preview && (
            <aside className="ui panel preview" aria-live="polite">
              <div className="prevhead">
                <div>
                  <label>NASA Surface Camera · {preview.pia}</label>
                  <div className="prevtitle">{preview.title}</div>
                </div>
                <button className="closebtn" onClick={() => setPreview(null)} aria-label="Close surface preview">×</button>
              </div>
              <img src={preview.image} alt={preview.title} className="previmg" loading="lazy" />
              <div className="prevmeta">{preview.sub} · {fmtDeg(preview.lat, 'N', 'S')} {fmtDeg(preview.lon, 'E', 'W')}</div>
              <p className="prevtext">{preview.text}</p>
              {preview.liveList && (
                <div className="livenav">
                  <button
                    onClick={() => {
                      const nIdx = (preview.liveIdx - 1 + preview.liveList.length) % preview.liveList.length
                      const item = preview.liveList[nIdx]
                      setPreview(p => ({
                        ...p,
                        liveIdx: nIdx,
                        image: item.image,
                        sub: `SOL ${item.sol} · ${item.instrument}`,
                        text: item.caption,
                      }))
                    }}
                  >
                    ◀ Prev
                  </button>
                  <span>RAW {preview.liveIdx + 1} / {preview.liveList.length}</span>
                  <button
                    onClick={() => {
                      const nIdx = (preview.liveIdx + 1) % preview.liveList.length
                      const item = preview.liveList[nIdx]
                      setPreview(p => ({
                        ...p,
                        liveIdx: nIdx,
                        image: item.image,
                        sub: `SOL ${item.sol} · ${item.instrument}`,
                        text: item.caption,
                      }))
                    }}
                  >
                    Next ▶
                  </button>
                </div>
              )}
              <button className="prevvisor" onClick={() => { setVisorAnchor({ lat: preview.lat, lon: preview.lon }); setVisor(true) }}>
                Open Ground View in Visor HUD →
              </button>
            </aside>
          )}

          {!cuff && baseNodes.length > 0 && (
            <aside className="ui panel basepanel" aria-live="polite">
              <div className="routehead">
                <span className="sectoggle">Martian Outpost Microgrid ({baseNodes.length})</span>
                <span className="badge" style={{ color: baseTotals.kw >= 0 ? '#5fd38d' : '#e5484d', borderColor: baseTotals.kw >= 0 ? '#5fd38d' : '#e5484d' }}>
                  {baseTotals.kw >= 0 ? `GRID +${baseTotals.kw} KW` : `DEFICIT ${baseTotals.kw} KW`}
                </span>
              </div>
              <div className="cuffstats">
                <span><b style={{ color: baseTotals.kw >= 0 ? '#5fd38d' : '#e5484d' }}>{baseTotals.kw >= 0 ? `+${baseTotals.kw}` : baseTotals.kw} kW</b> POWER</span>
                <span><b style={{ color: '#56b4e9' }}>+{baseTotals.h2o} L/sol</b> ISRU H2O</span>
                <span><b style={{ color: '#7fd1c7' }}>+{baseTotals.o2} kg/sol</b> O2/CH4</span>
                <span><b>{baseNodes.length}</b> NODES</span>
              </div>
              <div className="microbar" title="Outpost Power Margin">
                <div style={{ width: `${Math.min(100, Math.max(12, 50 + baseTotals.kw * 1.2))}%`, background: baseTotals.kw >= 0 ? '#5fd38d' : '#e5484d' }} />
              </div>
              <ul className="manifestlist baselist">
                {baseNodes.map((n, i) => {
                  const mod = BASE_MODULES.find(m => m.code === n.code) ?? BASE_MODULES[0]
                  return (
                    <li key={n.id}>
                      <div className="manrow">
                        <button className="manjump" onClick={() => glide(viewerRef.current.camera, Cesium.Cartesian3.fromDegrees(n.lon, n.lat, 24000))}>
                          <b style={{ color: mod.color }}>#{i + 1} {mod.code}</b> <span>{mod.name}</span> <em>{mod.kw > 0 ? `+${mod.kw}kW` : `${mod.kw}kW`}</em>
                        </button>
                      </div>
                      <div className="manact">
                        {fmtDeg(n.lat, 'N', 'S')} {fmtDeg(n.lon, 'E', 'W')}
                        {n.elevation_m !== undefined ? ` · ${n.elevation_m.toLocaleString()} m · Slope ${n.slope_deg}°` : ''} — {mod.role}
                      </div>
                    </li>
                  )
                })}
              </ul>
              <div className="routeactions">
                <button className="replaybtn" onClick={loadJezeroBase}>Reset 5-Node</button>
                <button className="sharebtn" onClick={clearBase}>× Clear Base</button>
                <button className="visorlaunch" onClick={() => { setVisorAnchor({ lat: baseNodes[0].lat, lon: baseNodes[0].lon }); enterVisor() }}>Visor HUD →</button>
              </div>
            </aside>
          )}

          {cuff && (
            <aside className="ui panel cuff" aria-label="Astronaut Forearm Wrist Cuff Display">
          <div className="cuffhead">
            <div>
              <div className="cufftag">WRIST CUFF · EVA-1 · {mars ? `SOL ${Math.floor(mars.sol_date)}` : 'SOL --'}</div>
              <div className="cufftitle">Forearm Field Checklist</div>
            </div>
            <span className="cuffo2">O2 {spec.o2.toFixed(1)}H</span>
          </div>
          {!routeData ? (
            <div className="cuffempty">
              <p>{loadingRoute ? 'Computing MOLA terrain route…' : 'Click Start A & Destination B on Mars, or load a preset mission:'}</p>
              <div className="cuffpresets">
                {PRESET_EVAS.map(p => (
                  <button key={p.id} onClick={() => loadPreset(p)}>Load {p.label} →</button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="cuffbar">
                <div className="proftabs">
                  {[['science', 'Science'], ['safe', 'Safest'], ['direct', 'Direct']].map(([k, lbl]) => routeData[k] && (
                    <button key={k} aria-pressed={profKey === k} style={{ '--c': ROUTE_COLOR[k] }} onClick={() => setProfKey(k)}>{lbl}</button>
                  ))}
                </div>
                <span className="badge" style={{ color: MODE_COLOR[planMode], borderColor: MODE_COLOR[planMode] }}>
                  {planMode === 'walk' ? 'FOOT EVA' : 'ROVER EVA'}
                </span>
              </div>
              {activeRoute && (
                <>
                  <div className="cuffstats">
                    <span><b>{(activeRoute.distance_m / 1000).toFixed(1)} km</b> DIST</span>
                    <span><b>+{activeRoute.climb_m} m</b> CLIMB</span>
                    <span><b style={{ color: RISK_COLOR[activeRoute.risk] }}>{activeRoute.max_slope_deg}°</b> MAX</span>
                    <span><b style={{ color: spec.buddy || activeRoute.walk_back_h <= spec.wb ? '#5fd38d' : '#e5484d' }}>{spec.buddy ? 'BUDDY' : fmtHours(activeRoute.walk_back_h)}</b> RTB</span>
                  </div>
                  <ul className="manifestlist cufflist">
                    {(activeRoute.manifest ?? []).map(m => {
                      const useRov = planMode !== 'walk'
                      const t = useRov ? m.rover_t : m.walk_t
                      const o2 = Math.max(spec.o2 - (8.0 - (useRov ? m.o2_rover_h : m.o2_walk_h)), 0).toFixed(1)
                      const done = !!checkedSteps[m.code]
                      const st = (activeRoute.stations ?? []).find(s => s.id === m.code)
                      return (
                        <li key={m.code} className={done ? 'done' : ''}>
                          <div className="manrow">
                            <input
                              type="checkbox"
                              checked={done}
                              onChange={() => setCheckedSteps(p => ({ ...p, [m.code]: !p[m.code] }))}
                              aria-label={`Mark ${m.title} complete`}
                            />
                            <button className="manjump" onClick={() => glide(viewerRef.current.camera, Cesium.Cartesian3.fromDegrees(m.lon, m.lat, 38000))}>
                              <b>{t}</b> <span>{m.title}</span> <em>O2 {o2}h</em>
                            </button>
                            {st && (
                              <button className="cuffimgbtn" onClick={() => inspectStop({
                                title: `Station ${st.id} · ${st.kind}`,
                                sub: `Elev ${st.elevation_m.toLocaleString()} m · Slope ${st.slope_deg}° · Score ${st.science_score}/100`,
                                image: st.image,
                                pia: st.pia,
                                text: st.task,
                                lat: st.lat,
                                lon: st.lon,
                              }, 38000)}>IMG</button>
                            )}
                          </div>
                          <div className="manact">{m.km} km · {m.elevation_m.toLocaleString()} m — {m.action}</div>
                        </li>
                      )
                    })}
                  </ul>
                  <div className="cuffactions">
                    <button onClick={() => setReplaying(r => !r)}>{replaying ? '■ Stop' : '▶ Fly'}</button>
                    <button onClick={exportBrief}>Brief ↓</button>
                    <button className="cuffvisor" onClick={enterVisor}>Visor →</button>
                    <button onClick={clearRoute}>×</button>
                  </div>
                </>
              )}
            </>
          )}
        </aside>
      )}

          {!cuff && routeData && (
            <section className="ui panel routeinfo" aria-live="polite">
          <div className="routehead">
            <button className="sectoggle" aria-expanded={routeOpen} onClick={() => setRouteOpen(o => !o)}>
              Route {route.map((_, i) => String.fromCharCode(65 + i)).join(' → ')} {routeOpen ? '▾' : '▸'}
            </button>
            <span className="badge" style={{ color: MODE_COLOR[planMode], borderColor: MODE_COLOR[planMode] }}>
              {spec.o2}h {MODE_LABEL[planMode]}
            </span>
          </div>
          {routeOpen && (
            <>
              <div className="crewbar" role="group" aria-label="Crew and Suit Configuration">
                {Object.values(EVA_SPECS).map(s => (
                  <button key={s.key} aria-pressed={evaSpec === s.key} onClick={() => setEvaSpec(s.key)} title={s.title}>
                    {s.short}
                  </button>
                ))}
              </div>
              <div className="routetabs" role="tablist">
                <button role="tab" aria-selected={routeTab === 'overview'} onClick={() => setRouteTab('overview')}>Compare</button>
                <button role="tab" aria-selected={routeTab === 'terrain'} onClick={() => setRouteTab('terrain')}>
                  Stops ({routeData.science?.stations?.length ?? 0})
                </button>
                <button role="tab" aria-selected={routeTab === 'checklist'} onClick={() => setRouteTab('checklist')}>
                  Checklist
                </button>
              </div>

              {routeTab === 'overview' && (
                <>
                  <table>
                    <thead><tr><th></th><th>Direct</th><th className="safe">Safest</th><th className="sci">Science</th></tr></thead>
                    <tbody>
                      {[
                        ['Distance', r => r.distance_m >= 10000 ? `${(r.distance_m / 1000).toFixed(1)} km` : `${r.distance_m.toLocaleString()} m`],
                        ['Climb / Drop', r => `↑${r.climb_m.toLocaleString()} ↓${r.descent_m.toLocaleString()}m`],
                        ['Steepest', r => <span style={{ color: RISK_COLOR[r.risk] }}>{r.max_slope_deg}° · {r.risk}</span>],
                        ['Science', r => `${r.science_score}/100`],
                        ['Walk (A↔B)', r => fmtHours(r.walk_round_trip_h)],
                        ['Rover (A↔B)', r => fmtHours(r.rover_round_trip_h)],
                        ['Walk-Back', r => {
                          const ok = spec.buddy || r.walk_back_h <= spec.wb
                          return <span style={{ color: ok ? '#5fd38d' : '#e5484d' }}>{spec.buddy ? 'Buddy Rover' : `${fmtHours(r.walk_back_h)} · ${ok ? 'OK' : `>${spec.wb}H`}`}</span>
                        }],
                        ['Comm Link', r => r.comm ? <span style={{ color: r.comm.direct_ok || liveComm.live ? '#5fd38d' : '#56b4e9' }}>{r.comm.direct_ok ? `VHF LOS (${r.comm.los_km}km)` : liveComm.label}</span> : '—'],
                        ['AI Traction', r => r.ai_slope ? <span style={{ color: r.ai_slope.traction_pct >= 75 ? '#5fd38d' : r.ai_slope.traction_pct >= 50 ? '#f2c14e' : '#e5484d' }}>{r.ai_slope.traction_pct}% · {r.ai_slope.hazard_type.split(' ')[0]}</span> : '—'],
                        ['RAD Dose', r => r.radiation ? `${(planMode === 'walk' ? r.radiation.walk_msv : r.radiation.rover_msv).toFixed(2)} mSv (${r.radiation.rate_usv_h} μSv/h)` : '—'],
                      ].map(([name, fmt]) => (
                        <tr key={name}>
                          <th>{name}</th>
                          <td>{fmt(routeData.direct)}</td>
                          <td>{routeData.safe ? fmt(routeData.safe) : '—'}</td>
                          <td>{routeData.science ? fmt(routeData.science) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {routeData.water && (
                    <p className="why">
                      <b>ISRU Water at B ({routeData.water.source}):</b> {routeData.water.status} — {routeData.water.detail}
                    </p>
                  )}
                  {routeData.geochem && (
                    <p className="why">
                      <b>GRS Geochemistry ({routeData.geochem.dichotomy}):</b>{' '}
                      Fe {routeData.geochem.elements.Fe >= 0 ? `+${routeData.geochem.elements.Fe}` : routeData.geochem.elements.Fe}σ ·{' '}
                      H₂O {routeData.geochem.elements.H2O >= 0 ? `+${routeData.geochem.elements.H2O}` : routeData.geochem.elements.H2O}σ ·{' '}
                      Si {routeData.geochem.elements.Si >= 0 ? `+${routeData.geochem.elements.Si}` : routeData.geochem.elements.Si}σ ·{' '}
                      S {routeData.geochem.elements.S >= 0 ? `+${routeData.geochem.elements.S}` : routeData.geochem.elements.S}σ ·{' '}
                      Cl {routeData.geochem.elements.Cl >= 0 ? `+${routeData.geochem.elements.Cl}` : routeData.geochem.elements.Cl}σ ·{' '}
                      DCI {routeData.geochem.elements.DCI >= 0 ? `+${routeData.geochem.elements.DCI}` : routeData.geochem.elements.DCI}σ
                    </p>
                  )}
                  <p className="why"><b>Why this route ({spec.short}):</b> {whyText}</p>
                  {activeRoute?.ai_slope && (
                    <p className="why"><b>AI Slope Verdict:</b> {activeRoute.ai_slope.verdict}</p>
                  )}
                  {activeRoute && (
                    <div className="microbar" title={`Walk-Back Margin (${fmtHours(activeRoute.walk_back_h)} / ${spec.wb}h limit)`}>
                      <div style={{
                        width: `${Math.min(100, Math.max(10, (activeRoute.walk_back_h / Math.max(spec.wb, 1)) * 100))}%`,
                        background: spec.buddy || activeRoute.walk_back_h <= spec.wb ? '#5fd38d' : '#e5484d',
                      }} />
                    </div>
                  )}
                  {renderProfileScrubber()}
                </>
              )}
              {routeTab === 'terrain' && (
                <>
                  {renderProfileScrubber()}
                  {routeData.science?.stations?.length > 0 && (
                    <div className="stations">
                      <label>Apollo Science Stops (click for NASA ground photo)</label>
                      <ul>
                        {routeData.science.stations.map(st => (
                          <li key={st.id}>
                            <button onClick={() => inspectStop({
                              title: `Station ${st.id} · ${st.kind}`,
                              sub: `Elev ${st.elevation_m.toLocaleString()} m · Slope ${st.slope_deg}° · Score ${st.science_score}/100`,
                              image: st.image,
                              pia: st.pia,
                              text: st.task,
                              lat: st.lat,
                              lon: st.lon,
                            }, 55000)}>
                              <b>{st.id}</b> <span>{st.kind}</span> <em>[IMG] {st.elevation_m.toLocaleString()}m · {st.slope_deg}°</em>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
              {routeTab === 'checklist' && activeRoute && (
                <div className="checklist">
                  <div className="profhead">
                    <label>Timed Cuff Checklist ({planMode === 'walk' ? 'Foot EVA' : 'Rover EVA'})</label>
                    <div className="proftabs">
                      {[['science', 'Science'], ['safe', 'Safest'], ['direct', 'Direct']].map(([k, lbl]) => routeData[k] && (
                        <button key={k} aria-pressed={profKey === k} style={{ '--c': ROUTE_COLOR[k] }} onClick={() => setProfKey(k)}>{lbl}</button>
                      ))}
                    </div>
                  </div>
                  <ul className="manifestlist">
                    {(activeRoute.manifest ?? []).map(m => {
                      const useRov = planMode !== 'walk'
                      const t = useRov ? m.rover_t : m.walk_t
                      const o2 = Math.max(spec.o2 - (8.0 - (useRov ? m.o2_rover_h : m.o2_walk_h)), 0).toFixed(1)
                      const done = !!checkedSteps[m.code]
                      return (
                        <li key={m.code} className={done ? 'done' : ''}>
                          <div className="manrow">
                            <input
                              type="checkbox"
                              checked={done}
                              onChange={() => setCheckedSteps(p => ({ ...p, [m.code]: !p[m.code] }))}
                              aria-label={`Mark ${m.title} complete`}
                            />
                            <button className="manjump" onClick={() => glide(viewerRef.current.camera, Cesium.Cartesian3.fromDegrees(m.lon, m.lat, 45000))}>
                              <b>{t}</b> <span>{m.title}</span> <em>O2 {o2}h</em>
                            </button>
                          </div>
                          <div className="manact">{m.km} km · {m.elevation_m.toLocaleString()} m — {m.action}</div>
                        </li>
                      )
                    })}
                  </ul>
                  <button className="exportbtn" onClick={exportBrief}>
                    Download EVA Mission Brief (.txt) ↓
                  </button>
                </div>
              )}
              <div className="routeactions">
                <button className="replaybtn" aria-pressed={replaying} onClick={() => setReplaying(r => !r)}>
                  {replaying ? '■ Stop' : `▶ Fly ${profKey.toUpperCase()}`}
                </button>
                <button className="sharebtn" onClick={copyLink} title="Copy shareable mission permalink">
                  {copied ? 'Copied ✓' : 'Copy Link ⎘'}
                </button>
                <button className="visorlaunch" onClick={enterVisor}>
                  Visor HUD →
                </button>
              </div>
            </>
          )}
            </section>
          )}
        </div>
      )}

      {visor && (
        <div className="visor" role="region" aria-label="Spacesuit Helmet Visor HUD">
          <div className="visor-compass">
            <div className="compass-tape">
              {[-60, -45, -30, -15, 0, 15, 30, 45, 60].map(off => {
                const deg = (visorHeading + off + 360) % 360
                const card = deg % 45 === 0 ? CARDINAL[(deg / 45) % 8] : null
                return <span key={off} className={off === 0 ? 'center-tick' : ''}>{card ?? `${String(deg).padStart(3, '0')}°`}</span>
              })}
            </div>
            <div className="compass-readout">HDG {String(visorHeading).padStart(3, '0')}° {cardinal} · {fmtDeg(vLat, 'N', 'S')} {fmtDeg(vLon, 'E', 'W')}</div>
          </div>

          <aside className="visor-suit">
            <div className="suit-title">{spec.title.toUpperCase()}</div>
            <div className="suit-row"><span>O2 RESERVE</span><b style={{ color: vO2RemH > 2 ? '#5fd38d' : '#e5484d' }}>{vO2RemH.toFixed(1)} h / {spec.o2.toFixed(1)} h</b></div>
            <div className="suit-bar"><div style={{ width: `${(vO2RemH / spec.o2) * 100}%`, background: vO2RemH > 2 ? '#5fd38d' : '#e5484d' }} /></div>
            <div className="suit-row"><span>SUIT PRESS</span><b>4.3 PSI · NOMINAL</b></div>
            <div className="suit-row"><span>EVA ELAPSED</span><b>{fmtHours(vElapsedH)}</b></div>
            <div className="suit-row">
              <span>WALK-BACK A</span>
              <b style={{ color: vWalkBackH <= spec.wb ? '#5fd38d' : '#e5484d' }}>{fmtHours(vWalkBackH)} · {spec.buddy ? 'BUDDY ROVER' : vWalkBackH <= spec.wb ? 'SAFE' : `>${spec.wb}H LIMIT`}</b>
            </div>
            {activeRoute?.comm && (
              <div className="suit-row">
                <span>COMM LINK</span>
                <b style={{ color: activeRoute.comm.direct_ok || liveComm.live ? '#5fd38d' : '#56b4e9' }}>
                  {activeRoute.comm.direct_ok ? 'VHF HAB LOS' : liveComm.label}
                </b>
              </div>
            )}
            {leakSec !== null && (
              <>
                <div className="suit-row">
                  <span>⚠ O2 LEAK DRILL</span>
                  <b style={{ color: leakResult === 'survived' ? '#5fd38d' : '#e5484d' }}>
                    {leakResult === 'survived'
                      ? 'SAFE AT HAB ✓'
                      : leakResult === 'depleted'
                        ? 'O2 DEPLETED!'
                        : `${Math.floor(leakSec / 60)}:${String(leakSec % 60).padStart(2, '0')} · RETURN TO A`}
                  </b>
                </div>
                <div className="suit-row">
                  <span>DIST TO SAFE A</span>
                  <b style={{ color: distToSafeKm <= 0.85 ? '#5fd38d' : '#f2c14e' }}>{distToSafeKm.toFixed(2)} km</b>
                </div>
              </>
            )}
            {activeRoute?.radiation && (
              <div className="suit-row">
                <span>GCR RAD DOSE</span>
                <b>{((planMode === 'walk' ? activeRoute.radiation.walk_msv : activeRoute.radiation.rover_msv) * Math.max(vFrac, 0.08)).toFixed(3)} mSv ({activeRoute.radiation.rate_usv_h} μSv/h)</b>
              </div>
            )}
            {vElev !== null && <div className="suit-row"><span>ELEVATION</span><b>{vElev.toLocaleString()} m</b></div>}
            <div className="suit-row">
              <span>SURFACE TILT</span>
              <b style={{ color: RISK_COLOR[vRisk] }}>{vSlope.toFixed(1)}° · {vRisk.toUpperCase()}</b>
            </div>
            {(freeDrive?.ai ?? activeRoute?.ai_slope) && (() => {
              const ai = freeDrive?.ai ?? activeRoute.ai_slope
              return (
                <div className="suit-row">
                  <span>AI TRACTION</span>
                  <b style={{ color: ai.traction_pct >= 75 ? '#5fd38d' : ai.traction_pct >= 50 ? '#f2c14e' : '#e5484d' }}>
                    {ai.traction_pct}% · {ai.hazard_type.toUpperCase()}
                  </b>
                </div>
              )
            })()}
            {freeDrive?.ai?.safer_spot && (
              <button
                className="clearbtn"
                style={{ marginTop: 6, width: '100%' }}
                onClick={() => {
                  const sp = freeDrive.ai.safer_spot
                  setFreeDrive(prev => prev ? { ...prev, lat: sp.lat, lon: sp.lon, slope: sp.slope_deg, risk: 'safe', ai: undefined } : prev)
                  getJson(`/api/terrain?lat=${sp.lat.toFixed(4)}&lon=${sp.lon.toFixed(4)}`)
                    .then(t => setFreeDrive(prev => prev ? { ...prev, elev: t.elevation_m, slope: t.slope_deg, risk: t.risk, ai: t.ai_slope } : prev))
                    .catch(() => {})
                }}
              >
                AI Snap → Safer {freeDrive.ai.safer_spot.slope_deg}° Bench
              </button>
            )}
            {activeRoute && !freeDrive && <div className="suit-row"><span>DIST TO END</span><b>{vRemKm} km</b></div>}
          </aside>

          <div className="visor-reticle" aria-hidden="true">
            <span className="ret-line" />
            <span className="ret-box" />
            <span className="ret-line" />
          </div>

          <div className="visor-controls">
            <button onClick={() => stepDrive(0, -18)} title="Turn Left [A]">⟲ A</button>
            <button onClick={() => stepDrive(1, 0)} title="Drive Forward [W]">▲ W Drive</button>
            <button onClick={() => stepDrive(-1, 0)} title="Reverse [S]">▼ S</button>
            <button onClick={() => stepDrive(0, 18)} title="Turn Right [D]">D ⟳</button>
            <button onClick={leakSec !== null ? stopLeakDrill : startLeakDrill} style={leakSec !== null ? { borderColor: '#e5484d', color: '#e5484d' } : undefined}>
              {leakSec !== null ? '■ End Drill' : '⚠ O2 Leak'}
            </button>
            {pathLen > 1 && (
              <>
                <button onClick={() => { setFreeDrive(null); setVisorIdx(i => Math.max(i - 1, 0)) }} disabled={vIdx <= 0}>◀ Prev</button>
                <div className="visor-scrub">
                  <span>{freeDrive ? 'FREE DRIVE (WASD)' : `WAYPOINT ${vIdx + 1} / ${pathLen} (${profKey.toUpperCase()})`}</span>
                  <input type="range" min="0" max={Math.max(pathLen - 1, 0)} value={vIdx} onChange={e => { setFreeDrive(null); setVisorIdx(Number(e.target.value)) }} />
                </div>
                <button onClick={() => { setFreeDrive(null); setVisorIdx(i => Math.min(i + 1, Math.max(pathLen - 1, 0))) }} disabled={vIdx >= pathLen - 1}>Next ▶</button>
              </>
            )}
            <button className="visor-exit" onClick={exitVisor}>Exit Visor [ESC]</button>
          </div>
        </div>
      )}

      {!intro && (
        <div className="layers-shell">
          <nav className="ui panel layers" aria-label="Base layer and crew interface format">
            {overlaysOpen && (
              <div className="overlays-menu" role="group" aria-label="Globe Overlays">
                <button className="sunbtn" aria-pressed={sunlight} onClick={() => setSunlight(s => !s)}>
                  Sunlight Terminator
                </button>
                <button className="orbbtn" aria-pressed={showOrbiters} onClick={() => { setShowOrbiters(s => !s); if (rideOrb) setRideOrb(null) }}>
                  3D Orbiters (MRO/TGO)
                </button>
                <button className="waterbtn" aria-pressed={showWater} onClick={() => setShowWater(w => !w)}>
                  Water Ice Zones
                </button>
                <button className="hazbtn" aria-pressed={showHazards} onClick={() => setShowHazards(h => !h)}>
                  MOLA Slope Hazards
                </button>
                <button className="audiobtn" aria-pressed={audioOn} onClick={toggleAudio}>
                  Quindar Audio
                </button>
                <button className="audiobtn" aria-pressed={sfxOn} onClick={toggleSfx}>
                  Tactile Clicks
                </button>
              </div>
            )}
            {Object.keys(LAYERS).map((k, idx) => (
              <button
                key={k}
                className="layerbtn"
                aria-pressed={layer === k}
                onClick={() => { playTick(sfxRef.current, 1180 + (idx + 1) * 90, 0.014); setLayer(k) }}
                title={`Switch to ${k} layer (Shortcut: ${idx + 1})`}
              >
                {k}
              </button>
            ))}
            {layer !== 'Imagery' && (
              <div className="layer-blend" title="NASA Worldview Style Layer Opacity Blend">
                <span>{Math.round(layerOpacity * 100)}%</span>
                <input
                  type="range" min="0.2" max="1" step="0.05"
                  value={layerOpacity}
                  onChange={e => { playTick(sfxRef.current, 1020 + Number(e.target.value) * 450, 0.008, 0.018); setLayerOpacity(Number(e.target.value)) }}
                  aria-label="Layer opacity blend"
                />
              </div>
            )}
            <span className="navsep" aria-hidden="true" />
            <button
              className="meshbtn"
              aria-pressed={terrain3d > 0}
              onClick={() => { playTick(sfxRef.current, 1460, 0.014); setTerrain3d(t => (t + 1) % 4) }}
              title="Cycle real 3D MOLA terrain mesh exaggeration (2x -> 3x -> Off -> 1x)"
            >
              {terrain3d > 0 ? `3D ${terrain3d}×` : '3D Off'}
            </button>
            <button className="meshbtn" aria-expanded={overlaysOpen} aria-pressed={overlaysOpen} onClick={() => { playTick(sfxRef.current, 1380, 0.014); setOverlaysOpen(o => !o) }}>
              Overlays {overlaysOpen ? '▾' : '▴'}
            </button>
            <span className="navsep" aria-hidden="true" />
            <button className="modebtn" aria-pressed={!visor && !cuff} onClick={() => { playTick(sfxRef.current, 1300, 0.014); setCuff(false); if (visor) exitVisor() }}>
              Console
            </button>
            <button className="cuffbtn" aria-pressed={!visor && cuff} onClick={() => { playTick(sfxRef.current, 1360, 0.014); if (visor) exitVisor(); setCuff(c => !c) }} title="Toggle Forearm Wrist Cuff (Shortcut: C)">
              Wrist Cuff
            </button>
            <button className="visorbtn" aria-pressed={visor} onClick={() => { playTick(sfxRef.current, 1580, 0.016); if (visor) exitVisor(); else enterVisor() }} title="Enter/Exit Spacesuit Visor HUD (Shortcut: V)">
              Visor HUD
            </button>
          </nav>
        </div>
      )}

      {commsOpen && (
        <div className="faq-backdrop" role="dialog" aria-modal="true" aria-label="Interplanetary Communications and Bandwidth Monitor" onClick={e => { if (e.target === e.currentTarget) setCommsOpen(false) }}>
          <div className="faq-shell comms-shell">
            <div className="faq-modal comms-modal">
              <div className="faq-head">
                <div>
                  <div className="intro-kicker">NASA DEEP SPACE NETWORK · DTE &amp; RELAY TELEMETRY</div>
                  <h2>Interplanetary Comms &amp; Bandwidth</h2>
                  <p className="faq-sub">Real-time Direct-to-Earth (DTE) radio links, speed-of-light delays, and orbiter proximity-1 relays.</p>
                </div>
                <button className="closebtn" onClick={() => setCommsOpen(false)} aria-label="Close Comms Console">✕</button>
              </div>

              <div className="comms-grid">
                <div className="comms-card">
                  <div className="comms-card-top">
                    <span className="comms-tag">DTE High-Gain Downlink</span>
                    <span className={`signal-dot signal-${envMode}`} />
                  </div>
                  <div className="comms-val" style={{ color: envMode === 'spe' ? '#e5484d' : envMode === 'dust' ? '#f2c14e' : '#38bdf8' }}>
                    {envMode === 'spe' ? '8.0 kbps' : envMode === 'dust' ? '128 kbps' : '2,048 kbps (2.05 Mbps)'}
                  </div>
                  <p className="comms-sub">Ka-Band (32.05 GHz) via 70m Goldstone DSS-14 · SNR +4.8 dB</p>
                </div>

                <div className="comms-card">
                  <div className="comms-card-top">
                    <span className="comms-tag">DTE Command Uplink</span>
                    <span className="signal-dot signal-nominal" />
                  </div>
                  <div className="comms-val">32.0 kbps</div>
                  <p className="comms-sub">X-Band (7.18 GHz) · 20 kW Transmitter · LDPC Encoded</p>
                </div>

                <div className="comms-card">
                  <div className="comms-card-top">
                    <span className="comms-tag">Orbital Relay (Electra UHF)</span>
                    <span className="signal-dot signal-nominal" />
                  </div>
                  <div className="comms-val" style={{ color: '#5fd38d' }}>2,048 kbps</div>
                  <p className="comms-sub">MRO &amp; TGO Proximity-1 (400 MHz) · 14m Pass Window</p>
                </div>

                <div className="comms-card">
                  <div className="comms-card-top">
                    <span className="comms-tag">Local Surface EVA Mesh</span>
                    <span className="signal-dot signal-nominal" />
                  </div>
                  <div className="comms-val" style={{ color: '#56b4e9' }}>10.0 Mbps</div>
                  <p className="comms-sub">Hab-to-Suit VHF Mesh · 11.7 km Topographic Radio Horizon</p>
                </div>
              </div>

              <div className="comms-telemetry-box">
                <div className="tele-row">
                  <span>Earth–Mars Orbital Separation</span>
                  <b>{distKm.toLocaleString()} km ({distAu} AU)</b>
                </div>
                <div className="tele-row">
                  <span>One-Way Light Time (OWLT)</span>
                  <b>{owltStr} ({owltSec}s)</b>
                </div>
                <div className="tele-row">
                  <span>Round-Trip Light Time (RTLT)</span>
                  <b>{Math.floor((owltSec * 2) / 60)}m {String((owltSec * 2) % 60).padStart(2, '0')}s</b>
                </div>
                <div className="tele-row">
                  <span>Active DSN Ground Complex</span>
                  <b>DSS-14 Goldstone (70-meter dish, California)</b>
                </div>
                <div className="tele-row">
                  <span>Daily Science Bandwidth Allocation</span>
                  <b>1.45 GB / sol (1.18 GB Downlinked · 81% Complete)</b>
                </div>
              </div>

              <div className="comms-sim-bar">
                <label>Simulate Environmental Bandwidth Impact:</label>
                <div className="comms-sim-btns">
                  <button
                    className="cleanbtn comms-chip"
                    aria-pressed={envMode === 'nominal'}
                    onClick={() => { playTick(sfxRef.current, 1380, 0.014); setEnvMode('nominal') }}
                  >
                    Nominal (2.05 Mbps)
                  </button>
                  <button
                    className="cleanbtn comms-chip"
                    aria-pressed={envMode === 'dust'}
                    onClick={() => { playTick(sfxRef.current, 1340, 0.014); setEnvMode('dust') }}
                  >
                    Dust Storm (128 kbps)
                  </button>
                  <button
                    className="cleanbtn comms-chip"
                    aria-pressed={envMode === 'spe'}
                    onClick={() => { playTick(sfxRef.current, 1260, 0.014); setEnvMode('spe') }}
                  >
                    Solar Particle Event (8 kbps)
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
