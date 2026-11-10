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
  const [routeData, setRouteData] = useState(null) // {direct, safe, plan} from /api/route

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
    let picked = []
    new Cesium.ScreenSpaceEventHandler(scene.canvas).setInputAction(e => {
      const c = camera.pickEllipsoid(e.position, MARS)
      if (!c) return
      const g = MARS.cartesianToCartographic(c)
      const lat = Cesium.Math.toDegrees(g.latitude), lon = Cesium.Math.toDegrees(g.longitude)
      if (picked.length === 2) { picked = []; pins[1].show = false }
      const pin = pins[picked.length]
      picked = [...picked, { lat, lon }]
      setRoute(picked)
      const where = `${pin.letter}\n${fmtDeg(lat, 'N', 'S')}  ${fmtDeg(lon, 'E', 'W')}`
      pin.position = c
      pin.label.text = where
      pin.point.color = Cesium.Color.fromCssColorString('#e2572b')
      pin.show = true
      fetch(`/api/terrain?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`).then(r => r.json())
        .then(t => {
          pin.label.text = `${where}\nHeight ${t.elevation_m.toLocaleString()} m\nSlope ${t.slope_deg}° · ${t.risk.toUpperCase()}`
          pin.point.color = Cesium.Color.fromCssColorString(RISK_COLOR[t.risk])
        })
        .catch(() => {})
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
    return () => viewer.destroy()
  }, [])

  // A + B set → ask Python for direct line, safest path, and EVA plan
  useEffect(() => {
    const ents = viewerRef.current.routeLayer.entities
    ents.removeAll()
    setRouteData(null)
    if (route.length < 2) return
    const [a, b] = route
    const positions = r => Cesium.Cartesian3.fromDegreesArray(r.path.flatMap(([la, lo]) => [lo, la]))
    let stale = false
    fetch(`/api/route?lat1=${a.lat}&lon1=${a.lon}&lat2=${b.lat}&lon2=${b.lon}`).then(r => r.json()).then(data => {
      if (stale) return
      setRouteData(data)
      const { direct, safe } = data
      ents.add({
        polyline: {
          positions: positions(direct), width: 2, arcType: Cesium.ArcType.NONE,
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
            positions: positions(safe), width: 5, arcType: Cesium.ArcType.NONE,
            material: new Cesium.PolylineGlowMaterialProperty({ color: Cesium.Color.fromCssColorString(RISK_COLOR.safe), glowPower: 0.25 }),
          },
        })
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
  }, [])
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

  const flyTo = p => {
    setQuery('')
    glide(viewerRef.current.camera, Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 350000))
  }
  const goHome = () => {
    setQuery('')
    glide(viewerRef.current.camera, HOME)
  }
  const results = query.trim() ? places.filter(p => p.name.toLowerCase().includes(query.trim().toLowerCase())) : []

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
        {['Click Mars to set start point A', 'Click to set destination B', 'Route A → B set · click to start over'][route.length]}
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
            <thead><tr><th></th><th>Direct</th><th className="safe">Safest</th></tr></thead>
            <tbody>
              {[
                ['Distance', r => r.distance_m >= 10000 ? `${(r.distance_m / 1000).toFixed(1)} km` : `${r.distance_m.toLocaleString()} m`],
                ['Climb', r => `↑ ${r.climb_m.toLocaleString()} m`],
                ['Descent', r => `↓ ${r.descent_m.toLocaleString()} m`],
                ['Steepest', r => <span style={{ color: RISK_COLOR[r.risk] }}>{r.max_slope_deg}° · {r.risk}</span>],
                ['Walk (A↔B)', r => fmtHours(r.walk_round_trip_h)],
                ['Rover (A↔B)', r => fmtHours(r.rover_round_trip_h)],
              ].map(([name, fmt]) => (
                <tr key={name}>
                  <th>{name}</th>
                  <td>{fmt(routeData.direct)}</td>
                  <td>{routeData.safe ? fmt(routeData.safe) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="why"><b>Why this route:</b> {routeData.plan.why}</p>
        </section>
      )}

      <nav className="ui panel layers" aria-label="Base layer">
        {Object.keys(LAYERS).map(k => (
          <button key={k} aria-pressed={layer === k} onClick={() => setLayer(k)}>{k}</button>
        ))}
      </nav>
    </>
  )
}
