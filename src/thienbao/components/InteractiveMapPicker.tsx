import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { googleMapsExternalUrl, type GeoPoint } from '../../lib/garmentGps'

// Tâm mặc định tại TP.HCM khi xưởng chưa ghim toạ độ lần đầu
const DEFAULT_CENTER: GeoPoint = { lat: 10.776889, lng: 106.700806 }

type TileMode = 'road' | 'satellite'

const TILES: Record<TileMode, { url: string; maxZoom: number; attribution: string }> = {
  road: {
    url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=vi',
    maxZoom: 21,
    attribution: 'Google Maps',
  },
  satellite: {
    url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=vi',
    maxZoom: 21,
    attribution: 'Google Maps',
  },
}

const PIN_ICON = L.divIcon({
  className: 'tb-leaflet-pin',
  html: `<svg width="32" height="42" viewBox="0 0 34 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M17 42C17 42 31 26.8 31 16.5C31 8.49 24.73 2 17 2C9.27 2 3 8.49 3 16.5C3 26.8 17 42 17 42Z" fill="#dc2626" stroke="#ffffff" stroke-width="2.5"/>
    <circle cx="17" cy="16.5" r="5.5" fill="#ffffff"/>
  </svg>`,
  iconSize: [32, 42],
  iconAnchor: [16, 40],
})

// Bản đồ Google tối giản: bấm chọn điểm hoặc kéo thả ghim đỏ, tự vẽ vòng tròn bán kính hợp lệ
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

  const [tileMode, setTileMode] = useState<TileMode>('road')

  useEffect(() => {
    onPickRef.current = onPick
  }, [onPick])

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

    const cfg = TILES.road
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

    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            map.invalidateSize()
          })
        : null
    ro?.observe(el)

    return () => {
      ro?.disconnect()
      map.remove()
      mapRef.current = null
      tileRef.current = null
      markerRef.current = null
      circleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        color: '#2563eb',
        weight: 2,
        fillColor: '#3b82f6',
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
      <button
        type="button"
        className="tb-map-layer-btn"
        onClick={() => setTileMode((prev) => (prev === 'road' ? 'satellite' : 'road'))}
      >
        {tileMode === 'road' ? 'Xem vệ tinh' : 'Xem bản đồ'}
      </button>
      <div ref={containerRef} className="tb-leaflet-canvas" />
      <div className="tb-map-caption">
        <span>
          {point
            ? 'Đã ghim vị trí xưởng · Kéo ghim đỏ hoặc bấm điểm khác để chỉnh'
            : 'Bấm trực tiếp vào vị trí xưởng trên bản đồ để cắm ghim'}
        </span>
        {point && (
          <a href={googleMapsExternalUrl(point)} target="_blank" rel="noreferrer">
            Mở Google Maps ↗
          </a>
        )}
      </div>
    </div>
  )
}
