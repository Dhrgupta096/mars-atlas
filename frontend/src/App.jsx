import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import gsap from 'gsap'

const MARS = Cesium.Ellipsoid.MARS
Cesium.Ellipsoid.default = MARS

const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ/'
const LAYERS = {
  Imagery: 'Mars_Viking_MDIM21_ClrMosaic_global_232m',
  Elevation: 'Mars_MGS_MOLA_ClrShade_merge_global_463m',
}
const KIND_COLOR = { rover: '#7fd1c7', lander: '#7fd1c7', ice: '#f2f0ea', volcano: '#e2572b', crater: '#d9b26f', canyon: '#d9b26f', basin: '#d9b26f', plain: '#d9b26f' }
const EARTH_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone
const RISK_COLOR = { safe: '#5fd38d', caution: '#f2c14e', 'too steep': '#e5484d' }

function trekLayer(id) {
  return new Cesium.WebMapTileServiceImageryProvider({
    url: `${TREK}${id}/1.0.0/default/default028mm/{TileMatrix}/{TileRow}/{TileCol}.jpg`,
    layer: id, style: 'default', tileMatrixSetID: 'default028mm',
    tilingScheme: new Cesium.GeographicTilingScheme({ ellipsoid: MARS }),
    maximumLevel: 7, credit: 'NASA / JPL-Caltech · Mars Trek',
  })
}

const fmtDeg = (v, pos, neg) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? pos : neg}`
const fmtHours = h => h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`
const MODE_LABEL = { walk: '8h EVA · Walk OK', rover: '8h EVA · Rover Needed', expedition: 'Over 8h · Multi-Sol', none: 'Blocked (>20°)' }
const MODE_COLOR = { walk: '#5fd38d', rover: '#f2c14e', expedition: '#e2572b', none: '#e5484d' }
const ROUTE_COLOR = { direct: '#e8e0d6', safe: '#5fd38d', science: '#f2c14e' }
const HOME = Cesium.Cartesian3.fromDegrees(-60, 0, 1.4e7)
const glide = (camera, destination) => camera.flyTo({ destination, duration: 2.8, easingFunction: Cesium.EasingFunction.QUINTIC_IN_OUT })

export default function App() {
  const globeRef = useRef(null)
  const viewerRef = useRef(null)
  const [layer, setLayer] = useState('Imagery')
  const [places, setPlaces] = useState([])
  const [query, setQuery] = useState('')
  const [center, setCenter] = useState({ lat: 0, lon: -60 })
  const [mars, setMars] = useState(null)
  const [now, setNow] = useState(new Date())
  const [route, setRoute] = useState([]) // [{lat, lon}] — A, then B
  const [routeData, setRouteData] = useState(null) // {direct, safe, science, plan} from /api/route
  const [profKey, setProfKey] = useState('safe')
  const [hoverIdx, setHoverIdx] = useState(null)
  const [rovers, setRovers] = useState([])
  const [showRovers, setShowRovers] = useState(true)
  const [waterSites, setWaterSites] = useState([])
  const [showWater, setShowWater] = useState(true)
  const [loadingRoute, setLoadingRoute] = useState(false)

  // Globe
  useEffect(() => {
    const viewer = new Cesium.Viewer(globeRef.current, {
      globe: new Cesium.Globe(MARS), baseLayer: false, baseLayerPicker: false, geocoder: false,
      homeButton: false, sceneModePicker: false, navigationHelpButton: false, timeline: false,
      animation: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
      skyAtmosphere: false,
    })
    const { scene, camera } = viewer
    scene.moon = undefined
    scene.globe.showGroundAtmosphere = false
    scene.globe.baseColor = Cesium.Color.fromCssColorString('#2a1a12')
    scene.screenSpaceCameraController.minimumZoomDistance = 2000
    viewerRef.current = viewer
    viewer.placesLayer = new Cesium.CustomDataSource('places')
    viewer.dataSources.add(viewer.placesLayer)
    viewer.routeLayer = new Cesium.CustomDataSource('route')
    viewer.dataSources.add(viewer.routeLayer)
    viewer.roversLayer = new Cesium.CustomDataSource('rovers')
    viewer.dataSources.add(viewer.roversLayer)
    viewer.waterLayer = new Cesium.CustomDataSource('water')
    viewer.dataSources.add(viewer.waterLayer)

    camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-60, 0, 6e7) })
    glide(camera, HOME)

    const onMove = () => {
      const c = camera.pickEllipsoid(new Cesium.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2), MARS)
      if (!c) return
      const g = MARS.cartesianToCartographic(c)
      setCenter({ lat: Cesium.Math.toDegrees(g.latitude), lon: Cesium.Math.toDegrees(g.longitude) })
    }
    camera.moveEnd.addEventListener(onMove)

    // Click 1 → start pin A, click 2 → destination pin B, click 3 → start over
    const makePin = letter => Object.assign(viewer.entities.add({
      show: false,
      point: { pixelSize: 12, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: {
        font: '500 12px "JetBrains Mono", ui-monospace, monospace', pixelOffset: new Cesium.Cartesian2(0, -22),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM, fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE, disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    }), { letter })
    const pins = [makePin('A · START'), makePin('B · DESTINATION')]
    viewer.pins = pins
    viewer.hoverPin = makePin('')
    let downPos = null
    const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas)
    handler.setInputAction(e => { downPos = Cesium.Cartesian2.clone(e.position) }, Cesium.ScreenSpaceEventType.LEFT_DOWN)
    handler.setInputAction(e => {
      if (downPos && Cesium.Cartesian2.distance(downPos, e.position) > 5) return // ignore drags
      const c = camera.pickEllipsoid(e.position, MARS)
      if (!c) return
      const g = MARS.cartesianToCartographic(c)
      const lat = Cesium.Math.toDegrees(g.latitude), lon = Cesium.Math.toDegrees(g.longitude)
      setRoute(prev => {
        const next = prev.length === 2 ? [{ lat, lon }] : [...prev, { lat, lon }]
        if (prev.length === 2) pins[1].show = false
        const pin = pins[next.length - 1]
        const where = `${pin.letter}\n${fmtDeg(lat, 'N', 'S')}  ${fmtDeg(lon, 'E', 'W')}`
        pin.position = c
        pin.label.text = where
        pin.point.color = Cesium.Color.fromCssColorString('#e2572b')
        pin.show = true
        fetch(`/api/terrain?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`).then(r => r.json())
          .then(t => {
            const w = t.water ? `\nWater: ${t.water.status} (${t.water.detail})` : ''
            pin.label.text = `${where}\nHeight ${t.elevation_m.toLocaleString()} m\nSlope ${t.slope_deg}° · ${t.risk.toUpperCase()}${w}`
            pin.point.color = Cesium.Color.fromCssColorString(RISK_COLOR[t.risk])
          })
          .catch(() => {})
        return next
      })
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
    return () => { handler.destroy(); viewer.destroy() }
  }, [])

  // A set → draw 6 km Foot-EVA ring & 12 km Apollo Walk-Back Safety Limit ring; A + B set → fetch routes
  useEffect(() => {
    const ents = viewerRef.current.routeLayer.entities
    ents.removeAll()
    viewerRef.current.hoverPin.show = false
    setRouteData(null)
    setHoverIdx(null)
    if (route.length < 1) return
    const [a, b] = route
    const degPerM = 1 / 59158 // 1° latitude on Mars ≈ 59.16 km
    const cosLat = Math.max(Math.cos(a.lat * Math.PI / 180), 0.05)
    for (const [radM, hex, tag] of [[6000, '#5fd38d', '6 KM FOOT EVA LIMIT'], [12000, '#f2c14e', '12 KM ROVER WALK-BACK LIMIT']]) {
      const col = Cesium.Color.fromCssColorString(hex)
      const ring = Array.from({ length: 65 }, (_, i) => {
        const ang = (i / 64) * Math.PI * 2
        return [a.lon + (radM * degPerM / cosLat) * Math.cos(ang), a.lat + (radM * degPerM) * Math.sin(ang)]
      }).flat()
      ents.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(ring), width: 1.8, arcType: Cesium.ArcType.GEODESIC,
          material: new Cesium.PolylineDashMaterialProperty({ color: col.withAlpha(0.8), dashLength: 10 }),
        },
      })
      ents.add({
        position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat + radM * degPerM),
        label: {
          text: tag, font: '500 10px "JetBrains Mono", ui-monospace, monospace',
          pixelOffset: new Cesium.Cartesian2(0, -6), verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          fillColor: col, outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 6e5),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
    }
    if (route.length < 2) { setLoadingRoute(false); return }
    const positions = r => Cesium.Cartesian3.fromDegreesArray(r.path.flatMap(([la, lo]) => [lo, la]))
    let stale = false
    setLoadingRoute(true)
    fetch(`/api/route?lat1=${a.lat}&lon1=${a.lon}&lat2=${b.lat}&lon2=${b.lon}`).then(r => r.json()).then(data => {
      if (stale) return
      setLoadingRoute(false)
      setRouteData(data)
      const { direct, safe, science } = data
      ents.add({
        polyline: {
          positions: positions(direct), width: 2, arcType: Cesium.ArcType.GEODESIC,
          material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.fromCssColorString('#e8e0d6').withAlpha(0.6), dashLength: 12 }),
        },
      })
      ents.add({
        position: Cesium.Cartesian3.fromDegrees(direct.max_slope_at.lon, direct.max_slope_at.lat),
        point: { pixelSize: 8, color: Cesium.Color.fromCssColorString(RISK_COLOR[direct.risk]), disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: {
          text: `STEEPEST ${direct.max_slope_deg}°`, font: '500 11px "JetBrains Mono", ui-monospace, monospace',
          pixelOffset: new Cesium.Cartesian2(10, 0), horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          fillColor: Cesium.Color.fromCssColorString(RISK_COLOR[direct.risk]), outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE, disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
      if (safe) {
        ents.add({
          polyline: {
            positions: positions(safe), width: 5, arcType: Cesium.ArcType.GEODESIC,
            material: new Cesium.PolylineGlowMaterialProperty({ color: Cesium.Color.fromCssColorString(RISK_COLOR.safe), glowPower: 0.25 }),
          },
        })
      }
      if (science) {
        const gold = Cesium.Color.fromCssColorString('#f2c14e')
        ents.add({
          polyline: {
            positions: positions(science), width: 4, arcType: Cesium.ArcType.GEODESIC,
            material: new Cesium.PolylineGlowMaterialProperty({ color: gold, glowPower: 0.2 }),
          },
        })
        for (const st of science.stations) {
          ents.add({
            position: Cesium.Cartesian3.fromDegrees(st.lon, st.lat),
            point: { pixelSize: 9, color: gold, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
            label: {
              text: `${st.id} · ${st.kind.toUpperCase()}`, font: '500 10px "JetBrains Mono", ui-monospace, monospace',
              pixelOffset: new Cesium.Cartesian2(0, -16), verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              fillColor: gold, outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE, disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          })
        }
      }
    }).catch(() => {})
    return () => { stale = true }
  }, [route])

  // Base layer
  useEffect(() => {
    const layers = viewerRef.current.imageryLayers
    layers.removeAll()
    layers.addImageryProvider(trekLayer(LAYERS[layer]))
  }, [layer])

  // Places → markers
  useEffect(() => {
    fetch('/api/places').then(r => r.json()).then(setPlaces).catch(() => {})
    fetch('/api/rovers').then(r => r.json()).then(setRovers).catch(() => {})
    fetch('/api/water').then(r => r.json()).then(setWaterSites).catch(() => {})
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
        return [w.lon + degLon * Math.cos(ang), Math.max(-89.5, Math.min(89.5, w.lat + degLat * Math.sin(ang)))]
      }).flat()
      ents.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(ring), width: 2, arcType: Cesium.ArcType.GEODESIC,
          material: new Cesium.PolylineDashMaterialProperty({ color: col.withAlpha(0.75), dashLength: 12 }),
        },
      })
      ents.add({
        position: Cesium.Cartesian3.fromDegrees(w.lon, w.lat),
        point: { pixelSize: 7, color: col, outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: {
          text: `[H2O] ${w.name.toUpperCase()} · ${w.yield.toUpperCase()}`,
          font: '500 10px "JetBrains Mono", ui-monospace, monospace',
          pixelOffset: new Cesium.Cartesian2(0, -14), verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          fillColor: col, outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 7e6),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
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
          positions: Cesium.Cartesian3.fromDegreesArray(rv.path.flatMap(([la, lo]) => [lo, la])),
          width: 3, arcType: Cesium.ArcType.GEODESIC,
          material: new Cesium.PolylineGlowMaterialProperty({ color: col, glowPower: 0.2 }),
        },
      })
      for (const wp of rv.waypoints) {
        ents.add({
          position: Cesium.Cartesian3.fromDegrees(wp.lon, wp.lat),
          point: { pixelSize: 7, color: col, outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5, disableDepthTestDistance: Number.POSITIVE_INFINITY },
          label: {
            text: `${rv.name.toUpperCase()} · ${wp.label.toUpperCase()}`,
            font: '500 10px "JetBrains Mono", ui-monospace, monospace',
            pixelOffset: new Cesium.Cartesian2(8, 0), horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
            fillColor: col, outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2.5e5),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
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
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
        point: { pixelSize: 6, color: Cesium.Color.fromCssColorString(KIND_COLOR[p.kind]), outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
        label: {
          text: p.name.toUpperCase(), font: '500 11px "JetBrains Mono", ui-monospace, monospace',
          pixelOffset: new Cesium.Cartesian2(10, 0), horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          fillColor: Cesium.Color.fromCssColorString('#e8e0d6'), outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 9e6),
        },
      })
    }
  }, [places])

  // Live clocks: Earth ticks locally, Mars comes from the Python backend at the view centre
  // ponytail: polls once a second; switch to a websocket if we add many live feeds
  useEffect(() => {
    const tick = () => {
      setNow(new Date())
      fetch(`/api/time?lat=${center.lat.toFixed(4)}&lon=${center.lon.toFixed(4)}`)
        .then(r => r.json()).then(setMars).catch(() => setMars(null))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [center])

  // UI entrance
  useEffect(() => {
    const ctx = gsap.context(() => gsap.from('.ui', { opacity: 0, y: 10, duration: 0.9, stagger: 0.08, delay: 1.6, ease: 'power3.out' }))
    return () => ctx.revert()
  }, [])

  const clearRoute = () => {
    setRoute([])
    setRouteData(null)
    setHoverIdx(null)
    setLoadingRoute(false)
    if (viewerRef.current?.pins) for (const p of viewerRef.current.pins) p.show = false
    if (viewerRef.current?.hoverPin) viewerRef.current.hoverPin.show = false
  }
  const flyTo = p => {
    setQuery('')
    glide(viewerRef.current.camera, Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 350000))
  }
  const goHome = () => {
    setQuery('')
    clearRoute()
    glide(viewerRef.current.camera, HOME)
  }
  const allSearchable = [...places, ...waterSites.filter(w => !places.some(p => p.name === w.name))]
  const results = query.trim() ? allSearchable.filter(p => (p.name + ' ' + p.kind).toLowerCase().includes(query.trim().toLowerCase())) : []
  const activeRoute = routeData && (routeData[profKey] ?? routeData.direct)
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
    const hp = viewerRef.current.hoverPin
    hp.position = Cesium.Cartesian3.fromDegrees(lon, lat)
    hp.point.color = Cesium.Color.fromCssColorString(ROUTE_COLOR[profKey])
    hp.label.text = `${km} km · ${activeRoute.profile_m[idx].toLocaleString()} m`
    hp.show = true
  }
  const onProfileLeave = () => {
    setHoverIdx(null)
    if (viewerRef.current?.hoverPin) viewerRef.current.hoverPin.show = false
  }

  return (
    <>
      <div ref={globeRef} className="globe" />

      <header className="ui bar">
        <button className="mark" onClick={goHome} aria-label="Back to full Mars view">MARS<span>/</span>ATLAS</button>
        <dl className="clocks">
          <div><dt>Earth · {EARTH_TZ}</dt><dd>{now.toLocaleTimeString([], { hour12: false })}</dd></div>
          <div><dt>Mars · MTC</dt><dd>{mars?.mtc ?? '--:--:--'}</dd></div>
          <div><dt>Mars Year</dt><dd>{mars?.mars_year ?? '--'}</dd></div>
          <div><dt>Sol</dt><dd>{mars ? Math.floor(mars.sol_date) : '--'}</dd></div>
          <div><dt>Ls</dt><dd>{mars ? `${mars.ls.toFixed(1)}°` : '--'}</dd></div>
        </dl>
      </header>

      <section className="ui panel search">
        <label htmlFor="q">Search Mars</label>
        <input id="q" value={query} onChange={e => setQuery(e.target.value)} placeholder="Jezero, Olympus Mons, Curiosity…" autoComplete="off" />
        {results.length > 0 && (
          <ul role="listbox" aria-label="Places">
            {results.map(p => (
              <li key={p.name}><button onClick={() => flyTo(p)}><span>{p.name}</span><em>{p.kind}</em></button></li>
            ))}
          </ul>
        )}
        {rovers.length > 0 && (
          <div className="rovers">
            <div className="rovhead">
              <label>NASA Rover Traverses</label>
              <button className="toggle" aria-pressed={showRovers} onClick={() => setShowRovers(s => !s)}>
                {showRovers ? 'Tracks On' : 'Tracks Off'}
              </button>
            </div>
            {rovers.map(rv => (
              <div key={rv.name} className="rovcard">
                <button className="rovmain" onClick={() => glide(viewerRef.current.camera, Cesium.Cartesian3.fromDegrees(rv.current[1], rv.current[0], 32000))}>
                  <span style={{ color: rv.color }}>● {rv.name}</span>
                  <em>{rv.distance_km} km{rv.latest_sol ? ` · Sol ${rv.latest_sol}` : ''}</em>
                </button>
                <div className="rovjumps">
                  <button onClick={() => glide(viewerRef.current.camera, Cesium.Cartesian3.fromDegrees(rv.start[1], rv.start[0], 18000))}>{rv.landing}</button>
                  <button onClick={() => glide(viewerRef.current.camera, Cesium.Cartesian3.fromDegrees(rv.current[1], rv.current[0], 18000))}>Current Pos →</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="ui panel local" aria-live="polite">
        <div className="coord">{fmtDeg(center.lat, 'N', 'S')} &nbsp; {fmtDeg(center.lon, 'E', 'W')}</div>
        <div className="big">{mars?.ltst ?? '--:--:--'}</div>
        <div className="sub">Local true solar time · {mars ? (mars.is_day ? 'Daylight' : 'Night') : '—'}</div>
        <div className="row">
          <span>Sunrise <b>{mars?.sunrise_ltst ?? mars?.polar ?? '--'}</b></span>
          <span>Sunset <b>{mars?.sunset_ltst ?? mars?.polar ?? '--'}</b></span>
          <span>{mars ? `${mars.season_north[0].toUpperCase()}${mars.season_north.slice(1)} (N)` : ''}</span>
        </div>
      </section>

      <p className="ui hint" aria-live="polite">
        {loadingRoute
          ? 'Computing safest & science routes across MOLA terrain…'
          : ['Click Mars to set start point A', 'Click to set destination B', 'Route A → B active · click Mars for new A'][route.length]}
        {route.length > 0 && <button className="clearbtn" onClick={clearRoute}>× Clear</button>}
      </p>

      {routeData && (
        <section className="ui panel routeinfo" aria-live="polite">
          <div className="routehead">
            <label>Route A → B · Standard detail</label>
            <span className="badge" style={{ color: MODE_COLOR[routeData.plan.mode], borderColor: MODE_COLOR[routeData.plan.mode] }}>
              {MODE_LABEL[routeData.plan.mode]}
            </span>
          </div>
          <table>
            <thead><tr><th></th><th>Direct</th><th className="safe">Safest</th><th className="sci">Science</th></tr></thead>
            <tbody>
              {[
                ['Distance', r => r.distance_m >= 10000 ? `${(r.distance_m / 1000).toFixed(1)} km` : `${r.distance_m.toLocaleString()} m`],
                ['Climb', r => `↑ ${r.climb_m.toLocaleString()} m`],
                ['Descent', r => `↓ ${r.descent_m.toLocaleString()} m`],
                ['Steepest', r => <span style={{ color: RISK_COLOR[r.risk] }}>{r.max_slope_deg}° · {r.risk}</span>],
                ['Science', r => `${r.science_score}/100`],
                ['Walk (A↔B)', r => fmtHours(r.walk_round_trip_h)],
                ['Rover (A↔B)', r => fmtHours(r.rover_round_trip_h)],
                ['Walk-Back', r => <span style={{ color: r.walkback_ok ? '#5fd38d' : '#e5484d' }}>{fmtHours(r.walk_back_h)} · {r.walkback_ok ? 'OK' : '>4H'}</span>],
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
          {activeRoute && (
            <div className="profile">
              <div className="profhead">
                <label>Elevation Profile ({hMin.toLocaleString()} m → {hMax.toLocaleString()} m)</label>
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
                <span>A · {activeRoute.profile_m[0]?.toLocaleString()} m</span>
                <span>{hoverIdx !== null ? `${((activeRoute.distance_m * hoverIdx / Math.max(activeRoute.profile_m.length - 1, 1)) / 1000).toFixed(1)} km · ${activeRoute.profile_m[hoverIdx].toLocaleString()} m` : 'Hover chart to trace on globe'}</span>
                <span>B · {activeRoute.profile_m.at(-1)?.toLocaleString()} m</span>
              </div>
            </div>
          )}
          {routeData.science?.stations?.length > 0 && (
            <div className="stations">
              <label>Apollo Science Stations (click to inspect)</label>
              <ul>
                {routeData.science.stations.map(st => (
                  <li key={st.id}>
                    <button onClick={() => glide(viewerRef.current.camera, Cesium.Cartesian3.fromDegrees(st.lon, st.lat, 80000))}>
                      <b>{st.id}</b> <span>{st.kind}</span> <em>{st.elevation_m.toLocaleString()} m · {st.slope_deg}°</em>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {routeData.water && (
            <p className="why">
              <b>ISRU Water at B ({routeData.water.source}):</b> {routeData.water.status} — {routeData.water.detail}
            </p>
          )}
          <p className="why"><b>Why this route:</b> {routeData.plan.why}</p>
        </section>
      )}

      <nav className="ui panel layers" aria-label="Base layer and overlays">
        {Object.keys(LAYERS).map(k => (
          <button key={k} aria-pressed={layer === k} onClick={() => setLayer(k)}>{k}</button>
        ))}
        <button className="waterbtn" aria-pressed={showWater} onClick={() => setShowWater(w => !w)}>
          Water & ISRU
        </button>
      </nav>
    </>
  )
}
