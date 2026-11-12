import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import gsap from 'gsap'

const MARS = Cesium.Ellipsoid.MARS
Cesium.Ellipsoid.default = MARS

const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ/'
const USGS_WMS = 'https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/mars/mars_simp_cyl.map'
const LAYERS = {
  Imagery: { id: 'Mars_Viking_MDIM21_ClrMosaic_global_232m', maxLevel: 7, detail: 'THEMIS' },
  'THEMIS 100m': { wms: 'MOLA_THEMIS_blend', maxLevel: 12, detail: 'THEMIS' },
  Elevation: { id: 'Mars_MGS_MOLA_ClrShade_merge_global_463m', maxLevel: 5, detail: 'HRSC_MOLA_Blend_Hillshade' },
}
const KIND_COLOR = { rover: '#7fd1c7', lander: '#7fd1c7', ice: '#f2f0ea', volcano: '#e2572b', crater: '#d9b26f', canyon: '#d9b26f', basin: '#d9b26f', plain: '#d9b26f' }
const EARTH_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone
const RISK_COLOR = { safe: '#5fd38d', caution: '#f2c14e', 'too steep': '#e5484d' }
const getJson = url => fetch(url).then(r => (r.ok ? r.json() : Promise.reject(r.status)))

function trekLayer({ id, maxLevel }) {
  return new Cesium.WebMapTileServiceImageryProvider({
    url: `${TREK}${id}/1.0.0/default/default028mm/{TileMatrix}/{TileRow}/{TileCol}.jpg`,
    layer: id, style: 'default', tileMatrixSetID: 'default028mm',
    tilingScheme: new Cesium.GeographicTilingScheme({ ellipsoid: MARS }),
    maximumLevel: maxLevel, credit: 'NASA / JPL-Caltech · Mars Trek',
  })
}

function usgsWmsLayer(layerName, maxLevel = 12, minLevel = 0) {
  return new Cesium.WebMapServiceImageryProvider({
    url: USGS_WMS,
    layers: layerName,
    parameters: { format: 'image/jpeg', version: '1.1.1', srs: 'EPSG:4326' },
    tilingScheme: new Cesium.GeographicTilingScheme({ ellipsoid: MARS }),
    minimumLevel: minLevel,
    maximumLevel: maxLevel,
    tileWidth: 512,
    tileHeight: 512,
    credit: 'NASA / JPL / ASU · USGS Astrogeology (THEMIS 100m)',
  })
}

let audioCtx = null
function playQuindar(enabled, speechText = '') {
  if (!enabled || typeof window === 'undefined') return
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (Ctx) {
      audioCtx = audioCtx || new Ctx()
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(2525, audioCtx.currentTime) // NASA Apollo Quindar intro tone (2,525 Hz)
      gain.gain.setValueAtTime(0.06, audioCtx.currentTime)
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
  const aStr = params.get('a'), bStr = params.get('b'), suit = params.get('suit')
  if (!aStr || !bStr) return null
  const [lat1, lon1] = aStr.split(',').map(Number)
  const [lat2, lon2] = bStr.split(',').map(Number)
  if ([lat1, lon1, lat2, lon2].some(Number.isNaN)) return null
  return { a: { lat: lat1, lon: lon1 }, b: { lat: lat2, lon: lon2 }, suit }
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
const MODE_COLOR = { walk: '#5fd38d', rover: '#f2c14e', expedition: '#e2572b', none: '#e5484d' }
const ROUTE_COLOR = { direct: '#e8e0d6', safe: '#5fd38d', science: '#f2c14e' }
const EYE_OFFSET = new Cesium.Cartesian3(0, 0, -3000) // 3 km toward camera: prevents local surface clipping while Mars (R=3396 km) hides far-side points
const surfPos = (lon, lat) => Cesium.Cartesian3.fromDegrees(lon, lat, 400)
const surfLine = pairs => Cesium.Cartesian3.fromDegreesArrayHeights(pairs.flatMap(([la, lo]) => [lo, la, 400]))
const HOME = Cesium.Cartesian3.fromDegrees(-60, 0, 1.4e7)
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
  { code: 'LAB-1', name: 'Astrobiology & Core Drill Lab', kw: -5, h2o: 4, o2: 2, color: '#e2572b', role: '2m Regolith Core Assay + Biosignature Spectrometer' },
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
        width: 3.5, arcType: Cesium.ArcType.GEODESIC,
        material: new Cesium.PolylineGlowMaterialProperty({ color: Cesium.Color.fromCssColorString('#7fd1c7'), glowPower: 0.25 }),
      },
    })
  }
  nodes.forEach((n, idx) => {
    const mod = BASE_MODULES.find(m => m.code === n.code) ?? BASE_MODULES[0]
    const col = Cesium.Color.fromCssColorString(mod.color)
    const isEven = idx % 2 === 0
    ents.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights([n.lon, n.lat, 400, n.lon, n.lat, 1800]),
        width: 2.2, arcType: Cesium.ArcType.NONE, material: col.withAlpha(0.88),
      },
    })
    ents.add({
      position: Cesium.Cartesian3.fromDegrees(n.lon, n.lat, 1800),
      point: { pixelSize: 10, color: col, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
      label: {
        text: `#${idx + 1} ${mod.code}${n.elevation_m !== undefined ? ` · ${n.elevation_m.toLocaleString()}m` : ''}`,
        font: '600 10px "JetBrains Mono", ui-monospace, monospace',
        pixelOffset: new Cesium.Cartesian2(isEven ? 12 : -12, -4),
        horizontalOrigin: isEven ? Cesium.HorizontalOrigin.LEFT : Cesium.HorizontalOrigin.RIGHT,
        fillColor: col, showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3.5e5),
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
function setPinAB(ref, a, b) {
  const pins = ref.current?.pins
  if (!pins) return
  ;[a, b].forEach((pt, idx) => {
    const pin = pins[idx]
    pin.position = surfPos(pt.lon, pt.lat)
    pin.label.text = `${pin.letter}\n${fmtDeg(pt.lat, 'N', 'S')} ${fmtDeg(pt.lon, 'E', 'W')}`
    pin.point.color = Cesium.Color.fromCssColorString('#e2572b')
    pin.show = true
    getJson(`/api/terrain?lat=${pt.lat.toFixed(4)}&lon=${pt.lon.toFixed(4)}`)
      .then(t => {
        pin.label.text = `${pin.letter}\n${t.elevation_m.toLocaleString()} m · ${t.slope_deg}° ${t.risk.toUpperCase()}`
        pin.point.color = Cesium.Color.fromCssColorString(RISK_COLOR[t.risk])
      })
      .catch(() => {})
  })
}
const PRESET_EVAS = [
  { id: 'jezero', label: 'Jezero Delta EVA', a: { lat: 18.4446, lon: 77.4509 }, b: { lat: 18.515, lon: 77.375 } },
  { id: 'gale', label: 'Gale → Mt. Sharp EVA', a: { lat: -4.5895, lon: 137.4417 }, b: { lat: -4.67, lon: 137.385 } },
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
    intensity: mars.dust_season ? 1.9 : 2.15,
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
  const col = Cesium.Color.fromCssColorString(mars.dust_season ? '#f2c14e' : '#e2572b')
  ents.add({
    polyline: {
      positions: surfLine(term), width: 1.8, arcType: Cesium.ArcType.GEODESIC,
      material: new Cesium.PolylineDashMaterialProperty({ color: col.withAlpha(0.55), dashLength: 14 }),
    },
  })
}

export default function App() {
  const globeRef = useRef(null)
  const viewerRef = useRef(null)
  const audioRef = useRef(false)
  const [layer, setLayer] = useState('Imagery')
  const [places, setPlaces] = useState([])
  const [query, setQuery] = useState('')
  const [center, setCenter] = useState({ lat: 0, lon: -60 })
  const [mars, setMars] = useState(null)
  const [now, setNow] = useState(() => new Date())
  const [simMs, setSimMs] = useState(null) // null = LIVE real-time; number = planned EVA epoch ms
  const [route, setRoute] = useState(() => {
    const h = parseHashRoute()
    return h ? [h.a, h.b] : []
  }) // [{lat, lon}] — A, then B
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
  const [intro, setIntro] = useState(false)
  const [sunlight, setSunlight] = useState(false)
  const [showHazards, setShowHazards] = useState(false)
  const [replaying, setReplaying] = useState(false)
  const [audioOn, setAudioOn] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showOrbiters, setShowOrbiters] = useState(false)
  const [rideOrb, setRideOrb] = useState(null) // null | 'MRO' | 'TGO' | 'ODY'
  const [timeRate, setTimeRate] = useState(1) // 1 | 60 | 300
  const [envMode, setEnvMode] = useState('nominal') // 'nominal' | 'dust' | 'spe'
  const [plannerMode, setPlannerMode] = useState('eva') // 'eva' | 'base'
  const [leftTab, setLeftTab] = useState('explore') // 'explore' | 'sim' | 'base'
  const [overlaysOpen, setOverlaysOpen] = useState(false)
  const [cleanUi, setCleanUi] = useState(false)
  const [baseNodes, setBaseNodes] = useState([])
  const [nextMod, setNextMod] = useState('HAB-1')
  const plannerModeRef = useRef('eva')
  const nextModRef = useRef('HAB-1')

  // Globe
  useEffect(() => {
    const viewer = new Cesium.Viewer(globeRef.current, {
      globe: new Cesium.Globe(MARS), baseLayer: false, baseLayerPicker: false, geocoder: false,
      homeButton: false, sceneModePicker: false, navigationHelpButton: false, timeline: false,
      animation: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
      skyAtmosphere: false,
    })
    const { scene, camera } = viewer
    viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2)
    scene.postProcessStages.fxaa.enabled = true
    scene.moon = undefined
    tuneAtmosphere(viewer)
    scene.globe.depthTestAgainstTerrain = true
    scene.globe.tileCacheSize = 1200
    scene.globe.preloadAncestors = true
    scene.globe.preloadSiblings = true
    scene.globe.maximumScreenSpaceError = 1.0
    scene.globe.baseColor = Cesium.Color.fromCssColorString('#2a1a12')
    scene.screenSpaceCameraController.minimumZoomDistance = 600
    viewerRef.current = viewer
    viewer.placesLayer = new Cesium.CustomDataSource('places')
    viewer.dataSources.add(viewer.placesLayer)
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
    const introTimer = setTimeout(() => setIntro(false), 4200)

    const onMove = () => {
      const c = camera.pickEllipsoid(new Cesium.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2), MARS)
      const g = c ? MARS.cartesianToCartographic(c) : MARS.cartesianToCartographic(camera.position)
      if (g) setCenter({ lat: Cesium.Math.toDegrees(g.latitude), lon: Cesium.Math.toDegrees(g.longitude) })
      setVisorHeading(Math.round((Cesium.Math.toDegrees(camera.heading) + 360) % 360))
    }
    camera.moveEnd.addEventListener(onMove)

    // Click 1 → start pin A, click 2 → destination pin B, click 3 → start over (or drop Base Module in 'base' mode)
    const makePin = (letter, below = false) => Object.assign(viewer.entities.add({
      show: false,
      point: { pixelSize: 11, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
      label: {
        font: '600 11px "JetBrains Mono", ui-monospace, monospace',
        pixelOffset: new Cesium.Cartesian2(0, below ? 16 : -16),
        verticalOrigin: below ? Cesium.VerticalOrigin.TOP : Cesium.VerticalOrigin.BOTTOM,
        fillColor: Cesium.Color.WHITE,
        showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
        eyeOffset: EYE_OFFSET,
      },
    }), { letter })
    const pins = [makePin('A · START', false), makePin('B · DEST', true)]
    viewer.pins = pins
    viewer.hoverPin = makePin('', false)
    if (initialHash) {
      setPinAB(viewerRef, initialHash.a, initialHash.b)
      glide(camera, Cesium.Cartesian3.fromDegrees((initialHash.a.lon + initialHash.b.lon) / 2, (initialHash.a.lat + initialHash.b.lat) / 2, 52000))
    }
    let downPos = null
    const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas)
    handler.setInputAction(e => { downPos = Cesium.Cartesian2.clone(e.position) }, Cesium.ScreenSpaceEventType.LEFT_DOWN)
    handler.setInputAction(e => {
      if (downPos && Cesium.Cartesian2.distance(downPos, e.position) > 5) return // ignore drags
      setIntro(false)
      setReplaying(false)
      setRideOrb(null)
      const c = camera.pickEllipsoid(e.position, MARS)
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
        const next = prev.length === 2 ? [{ lat, lon }] : [...prev, { lat, lon }]
        setLoadingRoute(next.length === 2)
        playQuindar(audioRef.current, next.length === 1 ? 'Start pin Alpha locked' : 'Destination Bravo locked, computing MOLA route')
        if (prev.length === 2) pins[1].show = false
        const pin = pins[next.length - 1]
        pin.position = surfPos(lon, lat)
        pin.label.text = `${pin.letter}\n${fmtDeg(lat, 'N', 'S')} ${fmtDeg(lon, 'E', 'W')}`
        pin.point.color = Cesium.Color.fromCssColorString('#e2572b')
        pin.show = true
        getJson(`/api/terrain?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`)
          .then(t => {
            pin.label.text = `${pin.letter}\n${t.elevation_m.toLocaleString()} m · ${t.slope_deg}° ${t.risk.toUpperCase()}`
            pin.point.color = Cesium.Color.fromCssColorString(RISK_COLOR[t.risk])
          })
          .catch(() => {})
        return next
      })
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
    return () => { clearTimeout(introTimer); scene.preRender.removeEventListener(onPreRender); handler.destroy(); viewer.destroy() }
  }, [])

  // A + B set → fetch routes
  useEffect(() => {
    if (route.length < 2) return
    const [a, b] = route
    let stale = false
    getJson(`/api/route?lat1=${a.lat}&lon1=${a.lon}&lat2=${b.lat}&lon2=${b.lon}`).then(data => {
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
    if (v?.placesLayer) v.placesLayer.show = route.length === 0 && baseNodes.length === 0
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
          positions: surfLine(ring), width: 1.8, arcType: Cesium.ArcType.GEODESIC,
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
          minimumHeights: act.profile_m.map(() => 400),
          maximumHeights: act.profile_m.map(h => 480 + ((h - pMin) / pSpan) * 1800),
          material: wCol.withAlpha(0.2),
          outline: true,
          outlineColor: wCol.withAlpha(0.6),
        },
      })
    }
    ents.add({
      polyline: {
        positions: surfLine(direct.path), width: profKey === 'direct' ? 4 : 2, arcType: Cesium.ArcType.GEODESIC,
        material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.fromCssColorString('#e8e0d6').withAlpha(profKey === 'direct' ? 0.95 : 0.55), dashLength: 12 }),
      },
    })
    const stCol = Cesium.Color.fromCssColorString(RISK_COLOR[direct.risk])
    ents.add({
      position: surfPos(direct.max_slope_at.lon, direct.max_slope_at.lat),
      point: { pixelSize: 7, color: stCol, outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5 },
      label: {
        show: profKey === 'direct',
        text: `▲ ${direct.max_slope_deg}° MAX`, font: '600 10px "JetBrains Mono", ui-monospace, monospace',
        pixelOffset: new Cesium.Cartesian2(12, 0), horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        fillColor: stCol, showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, maxLabelDist),
        eyeOffset: EYE_OFFSET,
      },
    })
    if (safe) {
      ents.add({
        polyline: {
          positions: surfLine(safe.path), width: profKey === 'safe' ? 6.5 : 4, arcType: Cesium.ArcType.GEODESIC,
          material: new Cesium.PolylineGlowMaterialProperty({ color: Cesium.Color.fromCssColorString(RISK_COLOR.safe), glowPower: profKey === 'safe' ? 0.32 : 0.18 }),
        },
      })
    }
    if (science) {
      const gold = Cesium.Color.fromCssColorString('#f2c14e')
      ents.add({
        polyline: {
          positions: surfLine(science.path), width: profKey === 'science' ? 6.5 : 4, arcType: Cesium.ArcType.GEODESIC,
          material: new Cesium.PolylineGlowMaterialProperty({ color: gold, glowPower: profKey === 'science' ? 0.32 : 0.18 }),
        },
      })
      science.stations.forEach((st, idx) => {
        const isEven = idx % 2 === 0
        ents.add({
          position: surfPos(st.lon, st.lat),
          point: { pixelSize: 9, color: gold, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
          label: {
            show: profKey === 'science',
            text: `${st.id} · ${st.kind.toUpperCase()}`, font: '600 10px "JetBrains Mono", ui-monospace, monospace',
            pixelOffset: new Cesium.Cartesian2(isEven ? 14 : -14, 0),
            horizontalOrigin: isEven ? Cesium.HorizontalOrigin.LEFT : Cesium.HorizontalOrigin.RIGHT,
            fillColor: gold, showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, maxLabelDist),
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
        point: { pixelSize: 11, color: shCol, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
        label: {
          text: `[SHELTER · ${em.shield_pct}% SHIELD]`,
          font: '600 10px "JetBrains Mono", ui-monospace, monospace',
          pixelOffset: new Cesium.Cartesian2(0, -16), verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          fillColor: shCol, showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
          eyeOffset: EYE_OFFSET,
        },
      })
    }
    if (showHazards && hazards) {
      for (const hz of hazards) {
        const hCol = Cesium.Color.fromCssColorString(hz.slope_deg >= 20 ? '#e5484d' : hz.slope_deg >= 10 ? '#f2c14e' : '#e2572b')
        const hDegLat = (hz.radius_km * 1000) * degPerM
        const hDegLon = hDegLat / Math.max(Math.cos(hz.lat * Math.PI / 180), 0.05)
        const hRing = Array.from({ length: 37 }, (_, i) => {
          const ang = (i / 36) * Math.PI * 2
          return [hz.lat + hDegLat * Math.sin(ang), hz.lon + hDegLon * Math.cos(ang)]
        })
        ents.add({
          polyline: {
            positions: surfLine(hRing), width: 1.6, arcType: Cesium.ArcType.GEODESIC,
            material: new Cesium.PolylineDashMaterialProperty({ color: hCol.withAlpha(0.75), dashLength: 8 }),
          },
        })
        ents.add({
          position: surfPos(hz.lon, hz.lat),
          point: { pixelSize: 6, color: hCol, outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5 },
          label: {
            text: `HAZARD ${hz.slope_deg}°`, font: '500 9px "JetBrains Mono", ui-monospace, monospace',
            pixelOffset: new Cesium.Cartesian2(0, -10), verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            fillColor: hCol, showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2.2e5),
            eyeOffset: EYE_OFFSET,
          },
        })
      }
    }
  }, [route, routeData, profKey, showHazards, envMode, baseNodes.length])

  // Base layer + high-resolution 100m THEMIS / HRSC detail overlay on zoom (exact crisp a800586 stack)
  useEffect(() => {
    const layers = viewerRef.current.imageryLayers
    layers.removeAll()
    const cfg = LAYERS[layer]
    const base = layers.addImageryProvider(cfg.wms ? usgsWmsLayer(cfg.wms, cfg.maxLevel) : trekLayer(cfg))
    base.contrast = 1.16
    base.brightness = 1.03
    base.saturation = 1.12
    base.gamma = 0.96
    if (cfg.detail) {
      const hiRes = layers.addImageryProvider(usgsWmsLayer(cfg.detail, 12, 5))
      hiRes.alpha = cfg.wms ? 0.55 : 0.38
      hiRes.contrast = 1.35
    }
  }, [layer])

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
          positions: surfLine(ring), width: 2, arcType: Cesium.ArcType.GEODESIC,
          material: new Cesium.PolylineDashMaterialProperty({ color: col.withAlpha(0.75), dashLength: 12 }),
        },
      })
      ents.add({
        position: surfPos(w.lon, w.lat),
        point: { pixelSize: 7, color: col, outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5 },
        label: {
          text: `[H2O] ${w.name.toUpperCase()} · ${w.yield.toUpperCase()}`,
          font: '500 10px "JetBrains Mono", ui-monospace, monospace',
          pixelOffset: new Cesium.Cartesian2(0, -14), verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          fillColor: col, showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 7e6),
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
          positions: surfLine(rv.path), width: 3, arcType: Cesium.ArcType.GEODESIC,
          material: new Cesium.PolylineGlowMaterialProperty({ color: col, glowPower: 0.2 }),
        },
      })
      for (const wp of rv.waypoints) {
        ents.add({
          position: surfPos(wp.lon, wp.lat),
          point: { pixelSize: 7, color: col, outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5 },
          label: {
            text: `${rv.name.toUpperCase()} · ${wp.label.toUpperCase()}`,
            font: '500 10px "JetBrains Mono", ui-monospace, monospace',
            pixelOffset: new Cesium.Cartesian2(8, 0), horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
            fillColor: col, showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1.6e5),
            eyeOffset: EYE_OFFSET,
          },
        })
      }
    }
  }, [rovers, showRovers])
  useEffect(() => {
    const ents = viewerRef.current.placesLayer.entities
    ents.removeAll()
    for (const p of places) {
      ents.add({
        position: surfPos(p.lon, p.lat),
        point: { pixelSize: 6, color: Cesium.Color.fromCssColorString(KIND_COLOR[p.kind]), outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
        label: {
          text: p.name.toUpperCase(), font: '500 10px "JetBrains Mono", ui-monospace, monospace',
          pixelOffset: new Cesium.Cartesian2(10, 0), horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          fillColor: Cesium.Color.fromCssColorString('#e8e0d6'),
          showBackground: true, backgroundColor: LABEL_BG, backgroundPadding: LABEL_PAD,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(3e5, 8.5e6),
          eyeOffset: EYE_OFFSET,
        },
      })
    }
  }, [places])

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
      setNow(new Date())
      getJson(base).then(setMars).catch(() => setMars(null))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [center, simMs])

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

  // UI entrance
  useEffect(() => {
    const ctx = gsap.context(() => gsap.from('.ui', { opacity: 0, y: 10, duration: 0.9, stagger: 0.08, delay: 1.6, ease: 'power3.out' }))
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
  const copyLink = () => {
    if (route.length < 2) return
    const [a, b] = route
    const hash = `#a=${a.lat.toFixed(4)},${a.lon.toFixed(4)}&b=${b.lat.toFixed(4)},${b.lon.toFixed(4)}&suit=${evaSpec}`
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
    playQuindar(audioRef.current, `Loading ${p.label}`)
    setPinAB(viewerRef, p.a, p.b)
    setRoute([p.a, p.b])
    glide(viewerRef.current.camera, Cesium.Cartesian3.fromDegrees((p.a.lon + p.b.lon) / 2, (p.a.lat + p.b.lat) / 2, 52000))
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
  const flyTo = p => {
    setQuery('')
    setVisor(false)
    glide(viewerRef.current.camera, Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 350000))
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
      setHoverIdx(idx)
      setHoverMarker(viewerRef, true, lon, lat, ROUTE_COLOR[profKey], `FLYOVER · ${km} km · ${prof[idx]?.toLocaleString()} m`)
      viewerRef.current?.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 14000),
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
  }, [replaying, activeRoute, profKey, visor])
  const vIdx = Math.min(visorIdx, Math.max(pathLen - 1, 0))
  const [vLat, vLon] = activeRoute ? activeRoute.path[vIdx] : (route.length ? [route[0].lat, route[0].lon] : [visorAnchor.lat, visorAnchor.lon])
  const vFrac = activeRoute ? vIdx / Math.max(pathLen - 1, 1) : 0
  const vElev = activeRoute ? activeRoute.profile_m[vIdx] : null
  const vElapsedH = activeRoute ? ((planMode === 'walk' ? activeRoute.walk_round_trip_h : activeRoute.rover_round_trip_h) * 0.5) * vFrac : 0
  const vO2RemH = Math.max(spec.o2 - vElapsedH, 0)
  const vWalkBackH = activeRoute ? (spec.buddy ? activeRoute.rover_round_trip_h * 0.5 : activeRoute.walk_back_h) * vFrac : 0
  const vRemKm = activeRoute ? ((activeRoute.distance_m * (1 - vFrac)) / 1000).toFixed(2) : '0.00'
  const cardinal = CARDINAL[Math.round(visorHeading / 45) % 8]
  const enterVisor = () => {
    setCuff(false)
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
    setMinZoom(viewerRef, 150)
    const path = activeRoute?.path
    const nextPt = path ? path[Math.min(vIdx + 1, path.length - 1)] : null
    const prevPt = path ? path[Math.max(vIdx - 1, 0)] : null
    const hdg = path && vIdx < path.length - 1 ? bearingDeg(vLat, vLon, nextPt[0], nextPt[1])
      : (path && path.length > 1 ? bearingDeg(prevPt[0], prevPt[1], vLat, vLon) : 65)
    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(vLon, vLat, 1800),
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
  }, [visor, vIdx, vLat, vLon, activeRoute, profKey])

  useEffect(() => {
    const onKey = e => {
      if (e.target?.tagName === 'INPUT') return
      if (e.key === 'h' || e.key === 'H') {
        setCleanUi(u => !u)
      } else if (visor && e.key === 'Escape') {
        setVisor(false)
        viewerRef.current?.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(vLon, vLat, 140000), duration: 1.6 })
      } else if (visor && (e.key === 'ArrowRight' || e.key === 'ArrowUp')) {
        setVisorIdx(i => Math.min(i + 1, Math.max(pathLen - 1, 0)))
      } else if (visor && (e.key === 'ArrowLeft' || e.key === 'ArrowDown')) {
        setVisorIdx(i => Math.max(i - 1, 0))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visor, vLat, vLon, pathLen])

  const exitVisor = () => {
    setVisor(false)
    setHoverMarker(viewerRef, false)
    viewerRef.current?.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(vLon, vLat, 140000), duration: 1.6 })
  }
  const allHeights = routeData ? ['direct', 'safe', 'science'].flatMap(k => routeData[k]?.profile_m ?? []) : []
  const hMin = allHeights.length ? Math.min(...allHeights) : 0
  const hMax = allHeights.length ? Math.max(...allHeights) : 1
  const hSpan = Math.max(hMax - hMin, 1)
  const svgPts = (prof, W = 360, H = 56) => prof.map((h, i) => `${(i / Math.max(prof.length - 1, 1) * W).toFixed(1)},${(H - 4 - ((h - hMin) / hSpan) * (H - 8)).toFixed(1)}`).join(' ')

  const onProfileHover = e => {
    if (!activeRoute) return
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
    const idx = Math.round(frac * (activeRoute.profile_m.length - 1))
    setHoverIdx(idx)
    const [lat, lon] = activeRoute.path[idx]
    const km = (activeRoute.distance_m * (idx / Math.max(activeRoute.profile_m.length - 1, 1)) / 1000).toFixed(1)
    setHoverMarker(viewerRef, true, lon, lat, ROUTE_COLOR[profKey], `${km} km · ${activeRoute.profile_m[idx].toLocaleString()} m`)
  }
  const onProfileLeave = () => {
    setHoverIdx(null)
    setHoverMarker(viewerRef, false)
  }
  const activeDate = simMs !== null ? new Date(simMs) : now
  const shiftSim = deltaMs => setSimMs(prev => (prev ?? now.getTime()) + deltaMs)

  const baseTotals = baseNodes.reduce((acc, n) => {
    const mod = BASE_MODULES.find(m => m.code === n.code) ?? BASE_MODULES[0]
    const kw = mod.kw > 0 && envMode === 'dust' ? Math.round(mod.kw * 0.55) : mod.kw
    return { kw: acc.kw + kw, h2o: acc.h2o + mod.h2o, o2: acc.o2 + mod.o2 }
  }, { kw: 0, h2o: 0, o2: 0 })

  return (
    <>
      <div ref={globeRef} className={`globe${envMode === 'dust' ? ' dust-haze' : ''}${envMode === 'spe' ? ' spe-haze' : ''}`} />

      {intro && !visor && (
        <div className="intro-card" role="dialog" aria-label="Mission Briefing">
          <div className="intro-kicker">ORBITAL TELEMETRY LOCK · MRO + MGS MOLA 32PPD</div>
          <h1>MARS<span>/</span>ATLAS</h1>
          <p>Interplanetary Survival Guide &amp; Martian EVA Route Planner</p>
          <div className="intro-actions">
            <button className="intro-primary" onClick={() => setIntro(false)}>Enter Mission Console →</button>
            <button onClick={() => loadPreset(PRESET_EVAS[0])}>Launch Jezero EVA →</button>
          </div>
        </div>
      )}

      {!visor && (envMode !== 'nominal' || rideOrb) && (
        <div className={`ui alertbar ${envMode}`} role="status" aria-live="polite">
          {rideOrb && (
            <span>
              <b>ORBITAL TELEMETRY LOCK · {rideOrb}:</b> Riding {ORBITERS.find(o => o.id === rideOrb)?.name} ({ORBITERS.find(o => o.id === rideOrb)?.payload})
              <button onClick={() => { setRideOrb(null); glide(viewerRef.current.camera, HOME) }}>Exit Orbit View ×</button>
            </span>
          )}
          {envMode === 'dust' && (
            <span>
              <b>REGIONAL DUST STORM (τ = 3.8):</b> Visibility 0.6 km · Solar Output 22% · Rover Speed -45%
              <button onClick={() => setEnvMode('nominal')}>Clear Storm ×</button>
            </span>
          )}
          {envMode === 'spe' && (
            <span>
              <b>SOLAR PARTICLE EVENT (S3 FLARE):</b> Dose Rate {activeRoute?.radiation?.spe_rate_usv_h ?? 388.5} μSv/h (18.5× Spike) ·{' '}
              {activeRoute?.emergency ? `Abort to ${activeRoute.emergency.shelter_type} (${activeRoute.emergency.shield_pct}% Rock Shield · ${activeRoute.emergency.dash_rover_min}m Rover Dash)` : 'Seek Subsurface / Escarpment Shelter Immediately'}
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

      <header className="ui bar">
        <div className="brand">
          <button className="mark" onClick={goHome} aria-label="Back to full Mars view">MARS<span>/</span>ATLAS</button>
          <span className="missiontag">ORBITAL EVA PLANNER · MOLA 32PPD + THEMIS 100M</span>
          <button className="cleanbtn" aria-pressed={cleanUi} onClick={() => setCleanUi(u => !u)} title="Hide side panels for full-screen Mars globe (Shortcut: H)">
            {cleanUi ? 'Show UI [H]' : 'Clean Globe [H]'}
          </button>
        </div>
        <dl className="clocks">
          <div>
            <dt>{simMs !== null ? 'Planned EVA · Earth' : `Earth · ${EARTH_TZ}`}</dt>
            <dd>{simMs !== null ? activeDate.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : activeDate.toLocaleTimeString([], { hour12: false })}</dd>
          </div>
          <div><dt>Mars · MTC</dt><dd>{mars?.mtc ?? '--:--:--'}</dd></div>
          <div><dt>Mars Year</dt><dd>{mars?.mars_year ?? '--'}</dd></div>
          <div><dt>Sol</dt><dd>{mars ? Math.floor(mars.sol_date) : '--'}</dd></div>
          <div><dt>Ls</dt><dd>{mars ? `${mars.ls.toFixed(1)}°` : '--'}</dd></div>
        </dl>
      </header>

      {!cleanUi && (
      <div className="dock-left">
        {!visor && !cuff && (
          <section className="ui panel search">
            <div className="modeswitch" role="tablist" aria-label="Left Console Section">
              <button role="tab" aria-pressed={leftTab === 'explore'} onClick={() => switchLeftTab('explore')}>Explore</button>
              <button role="tab" aria-pressed={leftTab === 'sim'} onClick={() => switchLeftTab('sim')}>Orbit &amp; Sim</button>
              <button role="tab" aria-pressed={leftTab === 'base'} onClick={() => switchLeftTab('base')}>Base ({baseNodes.length})</button>
            </div>

            {leftTab === 'explore' && (
              <>
                <input id="q" aria-label="Search Mars" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search Mars (Jezero, Olympus…)" autoComplete="off" />
                {results.length > 0 ? (
                  <ul role="listbox" aria-label="Places">
                    {results.map(p => (
                      <li key={p.name}><button onClick={() => flyTo(p)}><span>{p.name}</span><em>{p.kind}</em></button></li>
                    ))}
                  </ul>
                ) : (
                  <div className="quickhub">
                    <label>Featured Landmarks</label>
                    <div className="chipgrid">
                      {places.filter(p => ['Jezero (Perseverance)', 'Gale (Curiosity)', 'Olympus Mons', 'Valles Marineris'].includes(p.name)).map(p => (
                        <button key={p.name} onClick={() => flyTo(p)}>{p.name.replace(/ \(.*\)/, '')}</button>
                      ))}
                    </div>
                    <label>1-Click EVA Missions</label>
                    <div className="evacards">
                      {PRESET_EVAS.map(p => (
                        <button key={p.id} onClick={() => loadPreset(p)}>
                          <span>{p.label}</span>
                          <em>A → B</em>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {rovers.length > 0 && (
                  <div className="rovers">
                    <div className="rovhead">
                      <button className="sectoggle" aria-expanded={roversOpen} onClick={() => setRoversOpen(o => !o)}>
                        Rover Traverses ({rovers.length}) {roversOpen ? '▴' : '▾'}
                      </button>
                      <button className="toggle" aria-pressed={showRovers} onClick={() => setShowRovers(s => !s)}>
                        {showRovers ? 'Shown' : 'Hidden'}
                      </button>
                    </div>
                    {roversOpen && rovers.map(rv => (
                      <div key={rv.name} className="rovcard">
                        <button className="rovmain" onClick={() => glide(viewerRef.current.camera, Cesium.Cartesian3.fromDegrees(rv.current[1], rv.current[0], 32000))}>
                          <span style={{ color: rv.color }}>● {rv.name}</span>
                          <em>{rv.distance_km} km{rv.latest_sol ? ` · Sol ${rv.latest_sol}` : ''}</em>
                        </button>
                        <div className="rovjumps">
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
                <label>Space Weather &amp; Dust Storm Sim</label>
                <div className="envbtns" role="group" aria-label="Space Weather and Dust Storm Simulation">
                  <button aria-pressed={envMode === 'nominal'} onClick={() => setEnvMode('nominal')}>Nominal</button>
                  <button className="dustbtn" aria-pressed={envMode === 'dust'} onClick={() => { setEnvMode('dust'); playQuindar(audioRef.current, 'Warning: Regional dust storm tau 3.8') }}>Dust τ=3.8</button>
                  <button className="spebtn" aria-pressed={envMode === 'spe'} onClick={() => { setEnvMode('spe'); playQuindar(audioRef.current, 'Red Alert: S3 Solar Particle Event, abort to rock shelter') }}>Solar Flare S3</button>
                </div>
                <div className="rovers" style={{ marginTop: 6 }}>
                  <div className="rovhead">
                    <span className="sectoggle">NASA Eyes Orbiters (3)</span>
                    <button className="toggle" aria-pressed={showOrbiters} onClick={() => { setShowOrbiters(s => !s); if (rideOrb) setRideOrb(null) }}>
                      {showOrbiters ? '3D Live' : 'Hidden'}
                    </button>
                  </div>
                  {ORBITERS.map(orb => (
                    <div key={orb.id} className="rovcard">
                      <div className="rovmain">
                        <span style={{ color: orb.color }}>● {orb.id} · {orb.altKm} km</span>
                        <button className="ridebtn" aria-pressed={rideOrb === orb.id} onClick={() => { setShowOrbiters(true); setRideOrb(r => r === orb.id ? null : orb.id) }}>
                          {rideOrb === orb.id ? 'Riding ×' : 'Ride 3D →'}
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
                <label>Click Mars to Drop Module (Next: {nextMod})</label>
                <div className="chipgrid">
                  {BASE_MODULES.map(m => (
                    <button key={m.code} aria-pressed={nextMod === m.code} onClick={() => selectBaseMod(m.code)} style={{ borderColor: nextMod === m.code ? m.color : undefined }}>
                      {m.code} · {m.kw > 0 ? `+${m.kw}kW` : `${m.kw}kW`}
                    </button>
                  ))}
                </div>
                <div className="evacards" style={{ marginTop: 4 }}>
                  <button onClick={loadJezeroBase}>
                    <span>Deploy Jezero 5-Node Outpost</span>
                    <em>1-Click Base</em>
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        <section className="ui panel local" aria-live="polite">
          <div className="localhead">
            <div className="coord">{fmtDeg(center.lat, 'N', 'S')} &nbsp; {fmtDeg(center.lon, 'E', 'W')}</div>
            <div className="localbtns">
              {[1, 60, 300].map(r => (
                <button key={r} className="ratebtn" aria-pressed={timeRate === r} onClick={() => setTimeRate(r)} title={`Orbit & Time Speed ${r}x`}>
                  {r}×
                </button>
              ))}
              <button className="livebtn" aria-pressed={simMs === null && timeRate === 1} onClick={() => { setTimeRate(1); setSimMs(null) }}>
                {simMs === null && timeRate === 1 ? '● LIVE' : '↺ LIVE'}
              </button>
              <button className="toggle" aria-expanded={dateOpen} onClick={() => setDateOpen(o => !o)}>
                {dateOpen ? 'Date ▴' : 'Date ▾'}
              </button>
            </div>
          </div>
          <div className="big">{mars?.ltst ?? '--:--:--'}</div>
          <div className="sub">
            Solar time ·{' '}
            <span style={{ color: mars?.is_day ? '#5fd38d' : '#f2c14e' }}>
              {mars ? (mars.is_day ? 'DAYLIGHT · GO' : 'NIGHT · HOLD') : '—'}
            </span>
            {mars && <span style={{ color: mars.dust_season ? '#f2c14e' : 'var(--muted)' }}> · {mars.dust_season ? 'Dust Season' : `${mars.season_north} (N)`}</span>}
          </div>
          <div className="row">
            <span>Rise <b>{mars?.sunrise_ltst?.slice(0, 5) ?? mars?.polar ?? '--'}</b></span>
            <span>Set <b>{mars?.sunset_ltst?.slice(0, 5) ?? mars?.polar ?? '--'}</b></span>
            <span>Day <b>{mars ? `${mars.daylight_hours}h` : '--'}</b></span>
          </div>
          {dateOpen && (
            <div className="evadate">
              <label htmlFor="evadt">Plan Future Walk Date ({EARTH_TZ})</label>
              <div className="dtcontrols">
                <input
                  id="evadt"
                  type="datetime-local"
                  className="dtinput"
                  value={toLocalIso(activeDate)}
                  onChange={e => e.target.value && setSimMs(new Date(e.target.value).getTime())}
                />
                <button onClick={() => shiftSim(-7200e3)} title="Rewind 2 hours">-2h</button>
                <button onClick={() => shiftSim(7200e3)} title="Advance 2 hours">+2h</button>
                <button onClick={() => shiftSim(SOL_MS)} title="Advance 1 Martian Sol">+1 Sol</button>
              </div>
            </div>
          )}
        </section>
      </div>
      )}

      {!visor && !cuff && !cleanUi && (
        <p className="ui hint" aria-live="polite">
          <span className="hintdot" />
          {plannerMode === 'base'
            ? `Base Builder · Click Mars to drop ${nextMod} (${baseNodes.length} modules placed)`
            : loadingRoute
              ? 'Computing safest & science routes across MOLA terrain…'
              : ['Step 1/2 · Click Mars to set start pin A', 'Step 2/2 · Click destination pin B', 'EVA Route A → B active · click Mars for new A'][route.length]}
          {plannerMode === 'base' && baseNodes.length > 0 && <button className="clearbtn" onClick={clearBase}>× Clear Base</button>}
          {plannerMode === 'eva' && route.length > 0 && <button className="clearbtn" onClick={clearRoute}>× Clear</button>}
        </p>
      )}

      {!visor && !cleanUi && (preview || cuff || routeData || baseNodes.length > 0) && (
        <div className="dock-right">
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
              Route A → B {routeOpen ? '▾' : '▸'}
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
                        ['Comm Link', r => r.comm ? <span style={{ color: r.comm.direct_ok ? '#5fd38d' : '#56b4e9' }}>{r.comm.direct_ok ? `VHF LOS (${r.comm.los_km}km)` : 'MRO/TGO Relay'}</span> : '—'],
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
                  <p className="why"><b>Why this route ({spec.short}):</b> {whyText}</p>
                </>
              )}
              {routeTab === 'terrain' && (
                <>
                  {activeRoute && (
                    <div className="profile">
                      <div className="profhead">
                        <label>Elevation ({hMin.toLocaleString()}m → {hMax.toLocaleString()}m)</label>
                        <div className="proftabs">
                          {[['safe', 'Safest'], ['science', 'Science'], ['direct', 'Direct']].map(([k, lbl]) => routeData[k] && (
                            <button key={k} aria-pressed={profKey === k} style={{ '--c': ROUTE_COLOR[k] }} onClick={() => { setProfKey(k); onProfileLeave() }}>{lbl}</button>
                          ))}
                        </div>
                      </div>
                      <svg viewBox="0 0 360 56" className="profsvg" onMouseMove={onProfileHover} onMouseLeave={onProfileLeave}>
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
                              <line x1={x} y1="0" x2={x} y2="56" stroke="#e8e0d6" strokeOpacity="0.5" strokeDasharray="2 2" />
                              <circle cx={x} cy={y} r="3.5" fill={ROUTE_COLOR[profKey]} stroke="#0d0a09" strokeWidth="1.5" />
                            </g>
                          )
                        })()}
                      </svg>
                      <div className="profmeta">
                        <span>A · {activeRoute.profile_m[0]?.toLocaleString()}m</span>
                        <span>{hoverIdx !== null ? `${((activeRoute.distance_m * hoverIdx / Math.max(activeRoute.profile_m.length - 1, 1)) / 1000).toFixed(1)} km · ${activeRoute.profile_m[hoverIdx].toLocaleString()} m` : 'Hover to trace on globe'}</span>
                        <span>B · {activeRoute.profile_m.at(-1)?.toLocaleString()}m</span>
                      </div>
                    </div>
                  )}
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
                <b style={{ color: activeRoute.comm.direct_ok ? '#5fd38d' : '#56b4e9' }}>{activeRoute.comm.direct_ok ? 'VHF HAB LOS' : 'UHF RELAY'}</b>
              </div>
            )}
            {activeRoute?.radiation && (
              <div className="suit-row">
                <span>GCR RAD DOSE</span>
                <b>{((planMode === 'walk' ? activeRoute.radiation.walk_msv : activeRoute.radiation.rover_msv) * Math.max(vFrac, 0.08)).toFixed(3)} mSv ({activeRoute.radiation.rate_usv_h} μSv/h)</b>
              </div>
            )}
            {vElev !== null && <div className="suit-row"><span>ELEVATION</span><b>{vElev.toLocaleString()} m</b></div>}
            {activeRoute && <div className="suit-row"><span>DIST TO B</span><b>{vRemKm} km</b></div>}
          </aside>

          <div className="visor-reticle" aria-hidden="true">
            <span className="ret-line" />
            <span className="ret-box" />
            <span className="ret-line" />
          </div>

          <div className="visor-controls">
            <button onClick={() => setVisorIdx(i => Math.max(i - 1, 0))} disabled={vIdx <= 0}>◀ Prev</button>
            <div className="visor-scrub">
              <span>WAYPOINT {vIdx + 1} / {pathLen} ({profKey.toUpperCase()})</span>
              <input type="range" min="0" max={Math.max(pathLen - 1, 0)} value={vIdx} onChange={e => setVisorIdx(Number(e.target.value))} />
            </div>
            <button onClick={() => setVisorIdx(i => Math.min(i + 1, Math.max(pathLen - 1, 0)))} disabled={vIdx >= pathLen - 1}>Next ▶</button>
            <button className="visor-exit" onClick={exitVisor}>Exit Visor [ESC]</button>
          </div>
        </div>
      )}

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
          </div>
        )}
        {Object.keys(LAYERS).map(k => (
          <button key={k} aria-pressed={layer === k} onClick={() => setLayer(k)}>{k}</button>
        ))}
        <span className="navsep" aria-hidden="true" />
        <button aria-expanded={overlaysOpen} aria-pressed={overlaysOpen} onClick={() => setOverlaysOpen(o => !o)}>
          Overlays {overlaysOpen ? '▾' : '▴'}
        </button>
        <span className="navsep" aria-hidden="true" />
        <button aria-pressed={!visor && !cuff} onClick={() => { setCuff(false); if (visor) exitVisor() }}>
          Console
        </button>
        <button className="cuffbtn" aria-pressed={!visor && cuff} onClick={() => { if (visor) exitVisor(); setCuff(c => !c) }}>
          Wrist Cuff
        </button>
        <button className="visorbtn" aria-pressed={visor} onClick={() => visor ? exitVisor() : enterVisor()}>
          Visor HUD
        </button>
      </nav>
    </>
  )
}
