import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { GeoPoint } from '../../lib/garmentGps'

// Tâm mặc định tại TP.HCM khi xưởng chưa ghim toạ độ lần đầu
const DEFAULT_CENTER: GeoPoint = { lat: 10.776889, lng: 106.700806 }

type TileMode = 'google_street' | 'google_hybrid' | 'osm'

const TILES: Record<TileMode, { label: string; url: string; maxZoom: number; attribution: string }> = {
  google_street: {
    label: 'Bản đồ Google',
    url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=vi',
    maxZoom: 21,
    attribution: 'Google Maps',
  },
  google_hybrid: {
    label: 'Vệ tinh (Mái nhà)',
    url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=vi',
    maxZoom: 21,
    attribution: 'Google Satellite',
  },
  osm: {
    label: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  },
}

const PIN_ICON = L.divIcon({
  className: 'tb-leaflet-pin',
  html: `<svg width="34" height="44" viewBox="0 0 34 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M17 42C17 42 31 26.8 31 16.5C31 8.49 24.73 2 17 2C9.27 2 3 8.49 3 16.5C3 26.8 17 42 17 42Z" fill="#dc2626" stroke="#ffffff" stroke-width="2.5"/>
    <circle cx="17" cy="16.5" r="5.5" fill="#ffffff"/>
  </svg>`,
  iconSize: [34, 44],
  iconAnchor: [17, 42],
})

// Bản đồ tương tác: cho phép bấm chọn điểm bất kỳ, kéo thả ghim đỏ và xem vòng tròn bán kính hợp lệ
export function InteractiveMapPicker({
  point,
  radiusMeters,
  onPick,
}: {
  point: GeoPoint | null
  radiusMeters: number
  onPick: (next: GeoPoint) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tileRef = useRef<L.TileLayer | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const circleRef = useRef<L.Circle | null>(null)
  const onPickRef = useRef(onPick)

  const [tileMode, setTileMode] = useState<TileMode>('google_street')

  useEffect(() => {
    onPickRef.current = onPick
  }, [onPick])

  // Khởi tạo bản đồ Leaflet một lần
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const initial = point ?? DEFAULT_CENTER
    const map = L.map(el, {
      center: [initial.lat, initial.lng],
      zoom: point ? 18 : 13,
      zoomControl: true,
    })
    mapRef.current = map

    const cfg = TILES.google_street
    tileRef.current = L.tileLayer(cfg.url, {
      maxZoom: cfg.maxZoom,
      attribution: cfg.attribution,
    }).addTo(map)

    map.on('click', (ev: L.LeafletMouseEvent) => {
      onPickRef.current({
        lat: Number(ev.latlng.lat.toFixed(6)),
        lng: Number(ev.latlng.lng.toFixed(6)),
      })
    })

    return () => {
      map.remove()
      mapRef.current = null
      tileRef.current = null
      markerRef.current = null
      circleRef.current = null
    }
    // Chỉ khởi tạo lúc mount, cập nhật vị trí qua effect bên dưới
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Đổi lớp nền bản đồ (Google Đường phố / Google Vệ tinh / OSM)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (tileRef.current) tileRef.current.remove()
    const cfg = TILES[tileMode]
    tileRef.current = L.tileLayer(cfg.url, {
      maxZoom: cfg.maxZoom,
      attribution: cfg.attribution,
    }).addTo(map)
  }, [tileMode])

  // Đồng bộ ghim đỏ & vòng tròn bán kính khi toạ độ hoặc bán kính thay đổi
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (!point) {
      if (markerRef.current) {
        markerRef.current.remove()
        markerRef.current = null
      }
      if (circleRef.current) {
        circleRef.current.remove()
        circleRef.current = null
      }
      return
    }

    const latlng: L.LatLngExpression = [point.lat, point.lng]
    const safeRadius = Number.isFinite(radiusMeters) && radiusMeters >= 20 ? radiusMeters : 100

    if (!markerRef.current) {
      const m = L.marker(latlng, { draggable: true, icon: PIN_ICON }).addTo(map)
      m.on('dragend', () => {
        const pos = m.getLatLng()
        onPickRef.current({
          lat: Number(pos.lat.toFixed(6)),
          lng: Number(pos.lng.toFixed(6)),
        })
      })
      markerRef.current = m
    } else {
      markerRef.current.setLatLng(latlng)
    }

    if (!circleRef.current) {
      circleRef.current = L.circle(latlng, {
        radius: safeRadius,
        color: '#1e4268',
        weight: 2,
        fillColor: '#2a78d6',
        fillOpacity: 0.16,
      }).addTo(map)
    } else {
      circleRef.current.setLatLng(latlng)
      circleRef.current.setRadius(safeRadius)
    }

    map.setView(latlng, Math.max(map.getZoom(), 17), { animate: true })
  }, [point, radiusMeters])

  return (
    <div className="tb-map-picker">
      <div className="tb-map-bar">
        <span className="tb-map-hint">
          {point
            ? `Đã ghim xưởng (${point.lat}, ${point.lng}) · Bấm bản đồ hoặc kéo ghim đỏ để chỉnh`
            : 'Bấm trực tiếp vào vị trí xưởng trên bản đồ bên dưới để cắm ghim GPS'}
        </span>
        <div className="tb-map-modes" role="group" aria-label="Chế độ bản đồ">
          {(Object.keys(TILES) as TileMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={tileMode === mode ? 'tb-mode-btn active' : 'tb-mode-btn'}
              onClick={() => setTileMode(mode)}
            >
              {TILES[mode].label}
            </button>
          ))}
        </div>
      </div>
      <div ref={containerRef} className="tb-leaflet-canvas" />
    </div>
  )
}
