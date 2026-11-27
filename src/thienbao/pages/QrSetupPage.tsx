import { useCallback, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { useToast } from '../../lib/toast'
import { useConfirm } from '../../lib/confirm'
import { Icon } from '../../components/Icon'
import { THIENBAO_ORIGIN } from '../../lib/hostScope'
import { errorMessage } from '../../lib/format'
import {
  currentIsoTimestamp,
  googleMapsExternalUrl,
  isValidLatLng,
  parseGoogleMapInput,
  type GeoPoint,
} from '../../lib/garmentGps'
import { tbSupabase } from '../supabase'
import { useWorkshop } from '../workshop'
import { printQrPoster, renderQrPosterPng } from '../qrPoster'
import { InteractiveMapPicker } from '../components/InteractiveMapPicker'
import type { TbWorkshopSettings } from '../types'

type SearchPlace = { display_name: string; lat: string; lon: string }

export function QrSetupPage() {
  const { reload } = useWorkshop()
  const toast = useToast()
  const confirm = useConfirm()

  const [settings, setSettings] = useState<TbWorkshopSettings | null>(null)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [address, setAddress] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchPlace[]>([])
  const [latStr, setLatStr] = useState('')
  const [lngStr, setLngStr] = useState('')
  const [radius, setRadius] = useState('100')
  const [maxAccuracy, setMaxAccuracy] = useState('200')
  const [shiftStart, setShiftStart] = useState('07:30')
  const [shiftEnd, setShiftEnd] = useState('17:00')
  const [breakStart, setBreakStart] = useState('11:30')
  const [breakEnd, setBreakEnd] = useState('12:30')

  const [qrImgUrl, setQrImgUrl] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [locating, setLocating] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const applyRow = useCallback((row: TbWorkshopSettings) => {
    setSettings(row)
    setAddress(row.workshop_address ?? '')
    setLatStr(row.latitude != null ? String(row.latitude) : '')
    setLngStr(row.longitude != null ? String(row.longitude) : '')
    setRadius(String(row.allowed_radius_m))
    setMaxAccuracy(String(row.max_gps_accuracy_m))
    setShiftStart(row.shift_start.slice(0, 5))
    setShiftEnd(row.shift_end.slice(0, 5))
    setBreakStart(row.break_start.slice(0, 5))
    setBreakEnd(row.break_end.slice(0, 5))
  }, [])

  useEffect(() => {
    let cancelled = false
    tbSupabase
      .from('workshop_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setLoadError(errorMessage(error))
        else if (data) applyRow(data)
        setLoadedOnce(true)
      })
    return () => {
      cancelled = true
    }
  }, [applyRow])

  const checkinUrl = useMemo(() => {
    const base =
      typeof window !== 'undefined' && /thienbao/i.test(window.location.hostname)
        ? window.location.origin
        : THIENBAO_ORIGIN
    return settings ? `${base}/checkin?k=${settings.qr_token}` : ''
  }, [settings])

  useEffect(() => {
    if (!checkinUrl) return
    let cancelled = false
    QRCode.toDataURL(checkinUrl, {
      width: 340,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#13293d', light: '#ffffff' },
    }).then((url) => {
      if (!cancelled) setQrImgUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [checkinUrl])

  const parsedPoint = useMemo<GeoPoint | null>(() => {
    if (latStr.trim() === '' || lngStr.trim() === '') return null
    const lat = Number(latStr)
    const lng = Number(lngStr)
    return isValidLatLng(lat, lng) ? { lat, lng } : null
  }, [latStr, lngStr])

  const setPoint = useCallback((pt: GeoPoint) => {
    setLatStr(String(pt.lat))
    setLngStr(String(pt.lng))
    setMsg(null)
  }, [])

  // Tìm địa chỉ đường phố Việt Nam hoặc đọc trực tiếp link Google Maps / toạ độ
  const handleSearchOrPaste = async () => {
    const q = searchQuery.trim()
    if (!q) return
    setMsg(null)
    setSearchResults([])

    // Nếu người dùng dán link Google Maps hoặc cặp số vĩ độ, kinh độ -> đọc ngay không cần gọi mạng
    const parsed = parseGoogleMapInput(q)
    if (parsed.ok) {
      setPoint(parsed.point)
      setSearchQuery('')
      toast.success(`Đã ghim toạ độ: ${parsed.point.lat}, ${parsed.point.lng}`)
      return
    }
    if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(q)) {
      setMsg({ ok: false, text: parsed.error })
      return
    }

    setSearching(true)
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=vn&limit=5&accept-language=vi&q=${encodeURIComponent(q)}`
      const resp = await fetch(url)
      const items = (await resp.json()) as SearchPlace[]
      if (!Array.isArray(items) || items.length === 0) {
        setMsg({
          ok: false,
          text: 'Không tìm thấy địa chỉ này. Hãy thử gõ tên đường + quận/huyện, hoặc bấm trực tiếp lên bản đồ bên dưới.',
        })
      } else if (items.length === 1) {
        const pt = { lat: Number(Number(items[0].lat).toFixed(6)), lng: Number(Number(items[0].lon).toFixed(6)) }
        setPoint(pt)
        if (!address.trim()) setAddress(items[0].display_name.split(',').slice(0, 3).join(',').trim())
      } else {
        setSearchResults(items)
      }
    } catch {
      setMsg({ ok: false, text: 'Không tra cứu được địa chỉ tự động. Bạn hãy kéo và bấm trực tiếp lên bản đồ bên dưới.' })
    } finally {
      setSearching(false)
    }
  }

  const useCurrentGps = () => {
    if (!navigator.geolocation) {
      setMsg({ ok: false, text: 'Trình duyệt không hỗ trợ lấy GPS.' })
      return
    }
    setMsg(null)
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        setPoint({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        })
        toast.success(`Đã ghim vị trí hiện tại (±${Math.round(pos.coords.accuracy)}m)`)
      },
      () => {
        setLocating(false)
        setMsg({ ok: false, text: 'Không lấy được GPS hiện tại. Bạn có thể bấm chọn điểm trực tiếp trên bản đồ bên dưới.' })
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  }

  const saveSettings = async () => {
    setMsg(null)
    const lat = latStr.trim() === '' ? null : Number(latStr)
    const lng = lngStr.trim() === '' ? null : Number(lngStr)
    if (lat === null || lng === null || !isValidLatLng(lat, lng)) {
      setMsg({ ok: false, text: 'Vui lòng bấm chọn vị trí xưởng trên bản đồ (hoặc bấm Lấy GPS chỗ tôi đang đứng) trước khi lưu.' })
      return
    }
    const r = Number(radius)
    const acc = Number(maxAccuracy)
    if (!Number.isFinite(r) || r < 20 || r > 2000) {
      setMsg({ ok: false, text: 'Bán kính hợp lệ phải từ 20m đến 2000m.' })
      return
    }
    if (!Number.isFinite(acc) || acc < 20 || acc > 1000) {
      setMsg({ ok: false, text: 'Sai số GPS cho phép phải từ 20m đến 1000m.' })
      return
    }

    setSaving(true)
    const { data, error } = await tbSupabase
      .from('workshop_settings')
      .upsert({
        id: 1,
        workshop_address: address.trim() || 'Xưởng may Thiên Bảo Clothes',
        latitude: lat,
        longitude: lng,
        allowed_radius_m: Math.round(r),
        max_gps_accuracy_m: Math.round(acc),
        shift_start: shiftStart,
        shift_end: shiftEnd,
        break_start: breakStart,
        break_end: breakEnd,
        updated_at: currentIsoTimestamp(),
      })
      .select('*')
      .single()
    setSaving(false)

    if (error) {
      setMsg({ ok: false, text: errorMessage(error) })
      return
    }
    applyRow(data)
    reload()
    setMsg({ ok: true, text: 'Đã lưu vị trí GPS xưởng và cấu hình giờ ca thành công.' })
    toast.success('Đã lưu vị trí GPS của xưởng')
  }

  const handlePrintNow = async () => {
    if (!checkinUrl) return
    setPrinting(true)
    try {
      await printQrPoster({
        checkinUrl,
        address: address || 'Xưởng may Thiên Bảo Clothes',
        radiusMeters: Number(radius) || 100,
      })
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setPrinting(false)
    }
  }

  const downloadPoster = async () => {
    if (!checkinUrl) return
    try {
      const pngUrl = await renderQrPosterPng({
        checkinUrl,
        address: address || 'Xưởng may Thiên Bảo Clothes',
        radiusMeters: Number(radius) || 100,
      })
      const a = document.createElement('a')
      a.href = pngUrl
      a.download = 'qr-cham-cong-thien-bao-clothes.png'
      a.click()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const copyLink = async () => {
    if (!checkinUrl) return
    await navigator.clipboard.writeText(checkinUrl)
    toast.success('Đã sao chép đường dẫn chấm công')
  }

  const rotateQr = async () => {
    const ok = await confirm({
      title: 'Đổi mã QR chấm công mới',
      message:
        'Sau khi đổi, tờ mã QR tĩnh đã in trước đó sẽ không còn dùng được nữa và bạn cần in lại mã mới dán ở xưởng. Tiếp tục?',
      confirmText: 'Đổi mã QR mới',
      cancelText: 'Giữ mã cũ',
      danger: true,
    })
    if (!ok) return
    const { data: newToken, error } = await tbSupabase.rpc('rotate_workshop_qr')
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    if (settings && newToken) {
      setSettings({ ...settings, qr_token: newToken })
      toast.success('Đã tạo mã QR tĩnh mới')
    }
  }

  if (!loadedOnce) return <p className="muted">Đang tải mã QR & bản đồ xưởng…</p>
  if (loadError) return <p className="error">{loadError}</p>

  return (
    <section>
      <h1>Mã QR chấm công & Vị trí GPS xưởng</h1>

      <div className="tb-split">
        {/* Khối 1: In & tải mã QR tĩnh */}
        <div className="card tb-qr-panel">
          <h2 style={{ margin: 0, fontSize: 18 }}>1. In Mã QR Tĩnh dán tại xưởng</h2>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            Mã QR cố định, dùng lâu dài. Nhân viên quét bằng Camera / Zalo và phải đứng trong vùng GPS đã chọn bên cạnh mới được tính công.
          </p>

          {qrImgUrl && <img src={qrImgUrl} alt="Mã QR chấm công Thiên Bảo Clothes" className="tb-qr-img" />}

          <button type="button" className="primary tb-big-btn" disabled={printing} onClick={handlePrintNow}>
            <Icon name="printer" />
            {printing ? 'Đang chuẩn bị bản in…' : 'In mã QR ngay (Máy in / PDF)'}
          </button>

          <button type="button" className="tb-big-btn" onClick={downloadPoster}>
            <Icon name="download" />
            Tải ảnh bảng QR (PNG)
          </button>

          <div className="tb-inline-actions" style={{ justifyContent: 'center' }}>
            <button type="button" onClick={copyLink}>
              <Icon name="copy" size={16} />
              Chép link QR
            </button>
            <button type="button" className="danger" onClick={rotateQr}>
              Tạo lại mã QR mới
            </button>
          </div>
        </div>

        {/* Khối 2: Bản đồ tương tác chọn điểm GPS + Bán kính + Giờ ca */}
        <div className="card form">
          <h2 style={{ margin: 0, fontSize: 18 }}>2. Chọn vị trí GPS xưởng trên Bản đồ Google</h2>

          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label style={{ flex: 1 }}>
              Tìm địa chỉ xưởng (hoặc dán link Google Maps / toạ độ)
              <input
                type="text"
                placeholder="Gõ địa chỉ (vd: 120 Tân Thới Nhất 1, Quận 12) hoặc dán link Google Maps…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSearchOrPaste()
                  }
                }}
              />
            </label>
            <button type="button" disabled={searching} onClick={handleSearchOrPaste}>
              {searching ? 'Đang tìm…' : 'Tìm trên bản đồ'}
            </button>
            <button type="button" onClick={useCurrentGps} disabled={locating}>
              {locating ? 'Đang lấy GPS…' : 'Lấy GPS chỗ tôi đứng'}
            </button>
          </div>

          {searchResults.length > 0 && (
            <div className="tb-search-list">
              {searchResults.map((item, idx) => (
                <button
                  key={`${item.lat}-${item.lon}-${idx}`}
                  type="button"
                  className="tb-search-item"
                  onClick={() => {
                    setPoint({ lat: Number(Number(item.lat).toFixed(6)), lng: Number(Number(item.lon).toFixed(6)) })
                    if (!address.trim()) setAddress(item.display_name.split(',').slice(0, 3).join(',').trim())
                    setSearchResults([])
                  }}
                >
                  {item.display_name}
                </button>
              ))}
            </div>
          )}

          {/* Bản đồ tương tác trực tiếp (Google Đường phố / Google Vệ tinh) */}
          <InteractiveMapPicker
            point={parsedPoint}
            radiusMeters={Number(radius) || 100}
            onPick={setPoint}
          />

          <div className="row">
            <label>
              Bán kính hợp lệ quanh xưởng (mét)
              <input
                type="number"
                min={20}
                max={2000}
                step={10}
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
              />
            </label>
            <label>
              Vĩ độ (Latitude)
              <input
                type="text"
                inputMode="decimal"
                placeholder="Bấm bản đồ để chọn"
                value={latStr}
                onChange={(e) => setLatStr(e.target.value)}
              />
            </label>
            <label>
              Kinh độ (Longitude)
              <input
                type="text"
                inputMode="decimal"
                placeholder="Bấm bản đồ để chọn"
                value={lngStr}
                onChange={(e) => setLngStr(e.target.value)}
              />
            </label>
            <label>
              Sai số GPS tối đa (m)
              <input
                type="number"
                min={20}
                max={1000}
                step={10}
                value={maxAccuracy}
                onChange={(e) => setMaxAccuracy(e.target.value)}
              />
            </label>
          </div>

          <label>
            Tên / Địa chỉ xưởng in trên tờ QR
            <input
              type="text"
              placeholder="Ví dụ: Xưởng may Thiên Bảo Clothes"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>

          <div className="row">
            <label>
              Giờ vào ca chuẩn
              <input type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} />
            </label>
            <label>
              Giờ tan ca chuẩn
              <input type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} />
            </label>
            <label>
              Bắt đầu nghỉ trưa (trừ giờ công)
              <input type="time" value={breakStart} onChange={(e) => setBreakStart(e.target.value)} />
            </label>
            <label>
              Kết thúc nghỉ trưa
              <input type="time" value={breakEnd} onChange={(e) => setBreakEnd(e.target.value)} />
            </label>
          </div>

          {parsedPoint && (
            <small className="muted">
              Đã chọn toạ độ: <strong>{parsedPoint.lat}, {parsedPoint.lng}</strong> ·{' '}
              <a href={googleMapsExternalUrl(parsedPoint)} target="_blank" rel="noreferrer">
                Mở xem điểm này trên Google Maps tab mới
              </a>
            </small>
          )}

          {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}

          <button type="button" className="primary tb-big-btn" disabled={saving} onClick={saveSettings}>
            <Icon name="check" />
            {saving ? 'Đang lưu…' : 'Lưu vị trí GPS & Cấu hình chấm công'}
          </button>
        </div>
      </div>
    </section>
  )
}
