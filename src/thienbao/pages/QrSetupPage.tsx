import { useCallback, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { useToast } from '../../lib/toast'
import { useConfirm } from '../../lib/confirm'
import { Icon } from '../../components/Icon'
import { THIENBAO_ORIGIN } from '../../lib/hostScope'
import { errorMessage } from '../../lib/format'
import {
  currentIsoTimestamp,
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

const RADIUS_PRESETS = ['50', '100', '150', '200', '300', '500']

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
  const [point, setPointState] = useState<GeoPoint | null>(null)
  const [radius, setRadius] = useState('100')
  const [maxAccuracy, setMaxAccuracy] = useState(200)
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
    if (row.latitude != null && row.longitude != null && isValidLatLng(row.latitude, row.longitude)) {
      setPointState({ lat: row.latitude, lng: row.longitude })
    } else {
      setPointState(null)
    }
    setRadius(String(row.allowed_radius_m || 100))
    setMaxAccuracy(row.max_gps_accuracy_m || 200)
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
      color: { dark: '#141518', light: '#ffffff' },
    }).then((url) => {
      if (!cancelled) setQrImgUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [checkinUrl])

  const setPoint = useCallback((pt: GeoPoint) => {
    setPointState(pt)
    setMsg(null)
  }, [])

  const radiusOptions = useMemo(
    () => (RADIUS_PRESETS.includes(radius) ? RADIUS_PRESETS : [...RADIUS_PRESETS, radius].sort((a, b) => Number(a) - Number(b))),
    [radius],
  )

  const handleSearchOrPaste = async () => {
    const q = searchQuery.trim()
    if (!q) return
    setMsg(null)
    setSearchResults([])

    const parsed = parseGoogleMapInput(q)
    if (parsed.ok) {
      setPoint(parsed.point)
      setSearchQuery('')
      toast.success('Đã ghim vị trí trên bản đồ')
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
          text: 'Không tìm thấy địa chỉ này. Hãy thử gõ tên đường kèm quận/huyện hoặc bấm trực tiếp lên bản đồ.',
        })
      } else if (items.length === 1) {
        const pt = { lat: Number(Number(items[0].lat).toFixed(6)), lng: Number(Number(items[0].lon).toFixed(6)) }
        setPoint(pt)
        if (!address.trim()) setAddress(items[0].display_name.split(',').slice(0, 3).join(',').trim())
      } else {
        setSearchResults(items)
      }
    } catch {
      setMsg({ ok: false, text: 'Không tra cứu được tự động. Bạn hãy kéo và bấm trực tiếp lên bản đồ bên dưới.' })
    } finally {
      setSearching(false)
    }
  }

  const useCurrentGps = () => {
    if (!navigator.geolocation) {
      setMsg({ ok: false, text: 'Trình duyệt không hỗ trợ định vị GPS' })
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
        toast.success('Đã ghim theo vị trí hiện tại')
      },
      () => {
        setLocating(false)
        setMsg({ ok: false, text: 'Không lấy được vị trí hiện tại. Bạn có thể bấm trực tiếp trên bản đồ để ghim.' })
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  }

  const saveSettings = async () => {
    setMsg(null)
    if (!point || !isValidLatLng(point.lat, point.lng)) {
      setMsg({ ok: false, text: 'Vui lòng bấm chọn vị trí xưởng trên bản đồ trước khi lưu' })
      return
    }
    const r = Number(radius) || 100

    setSaving(true)
    const { data, error } = await tbSupabase
      .from('workshop_settings')
      .upsert({
        id: 1,
        workshop_address: address.trim() || 'Xưởng may Thiên Bảo Clothes',
        latitude: point.lat,
        longitude: point.lng,
        allowed_radius_m: Math.round(r),
        max_gps_accuracy_m: Math.max(100, Math.round(maxAccuracy)),
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
    toast.success('Đã lưu vị trí xưởng và giờ làm việc')
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
    toast.success('Đã sao chép liên kết chấm công')
  }

  const rotateQr = async () => {
    const ok = await confirm({
      title: 'Tạo mã QR mới',
      message: 'Sau khi đổi, bản in mã QR cũ dán tại xưởng sẽ ngừng hiệu lực và bạn cần in lại bảng mới. Tiếp tục?',
      confirmText: 'Đổi mã mới',
      cancelText: 'Giữ mã hiện tại',
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
      toast.success('Đã tạo mã QR mới')
    }
  }

  if (!loadedOnce) return <div className="tb-empty">Đang tải cấu hình mã QR & bản đồ…</div>
  if (loadError) return <p className="error">{loadError}</p>

  return (
    <section>
      <div className="tb-page-head">
        <div className="tb-page-title-group">
          <h1>Mã QR & Vị trí xưởng</h1>
          <p className="tb-page-sub">Bảng mã QR cố định và phạm vi chấm công</p>
        </div>
      </div>

      <div className="tb-qr-grid">
        {/* Cột trái: Bảng mã QR cố định */}
        <div className="card tb-qr-card">
          <div className="tb-card-head">
            <div>
              <h2>Mã QR tại xưởng</h2>
              <p className="tb-card-desc">In khổ A4 dán tại cửa xưởng để nhân viên quét vào ca và tan ca</p>
            </div>
          </div>

          <div className="tb-qr-stage">
            {qrImgUrl && <img src={qrImgUrl} alt="Mã QR chấm công Thiên Bảo Clothes" className="tb-qr-img" />}
            <span className="tb-qr-caption">Quét bằng Camera điện thoại hoặc Zalo</span>
          </div>

          <div className="tb-btn-pair">
            <button type="button" className="primary" disabled={printing} onClick={handlePrintNow}>
              <Icon name="printer" size={16} />
              <span>{printing ? 'Đang chuẩn bị…' : 'In bảng QR'}</span>
            </button>
            <button type="button" onClick={downloadPoster}>
              <Icon name="download" size={16} />
              <span>Tải ảnh PNG</span>
            </button>
          </div>

          <div className="tb-card-foot">
            <button type="button" className="tb-ghost" onClick={copyLink}>
              <Icon name="copy" size={15} />
              <span>Sao chép link</span>
            </button>
            <button type="button" className="tb-quiet-danger" onClick={rotateQr}>
              Đổi mã mới
            </button>
          </div>
        </div>

        {/* Cột phải: Bản đồ chọn điểm ghim tối giản + Giờ ca */}
        <div className="card tb-qr-card">
          <div className="tb-card-head">
            <div>
              <h2>Vị trí xưởng & Giờ ca</h2>
              <p className="tb-card-desc">Nhân viên cần đứng trong vòng bán kính quanh điểm ghim mới chấm được công</p>
            </div>
          </div>

          <div className="form" style={{ flex: 1 }}>
            <div className="tb-map-search">
              <input
                type="text"
                aria-label="Tìm địa chỉ xưởng hoặc dán link Google Maps"
                placeholder="Tìm địa chỉ xưởng hoặc dán link Google Maps…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSearchOrPaste()
                  }
                }}
              />
              <button type="button" disabled={searching} onClick={handleSearchOrPaste}>
                {searching ? 'Đang tìm…' : 'Tìm'}
              </button>
              <button type="button" className="tb-gps-locate-btn" disabled={locating} onClick={useCurrentGps}>
                {locating ? 'Đang định vị…' : 'Vị trí hiện tại'}
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

            <InteractiveMapPicker point={point} radiusMeters={Number(radius) || 100} onPick={setPoint} />

            <div className="tb-grid-addr">
              <label>
                <span className="tb-field-label">Tên / Địa chỉ xưởng (in trên bảng QR)</span>
                <input
                  type="text"
                  placeholder="Xưởng may Thiên Bảo Clothes"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </label>
              <label>
                <span className="tb-field-label">Bán kính cho phép</span>
                <select value={radius} onChange={(e) => setRadius(e.target.value)}>
                  {radiusOptions.map((val) => (
                    <option key={val} value={val}>
                      {val} mét
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="tb-grid-4">
              <label>
                <span className="tb-field-label">Vào ca</span>
                <input type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} />
              </label>
              <label>
                <span className="tb-field-label">Tan ca</span>
                <input type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} />
              </label>
              <label>
                <span className="tb-field-label">Nghỉ trưa từ</span>
                <input type="time" value={breakStart} onChange={(e) => setBreakStart(e.target.value)} />
              </label>
              <label>
                <span className="tb-field-label">Nghỉ trưa đến</span>
                <input type="time" value={breakEnd} onChange={(e) => setBreakEnd(e.target.value)} />
              </label>
            </div>

            {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}
          </div>

          <div className="tb-card-foot">
            <span className="muted" style={{ fontSize: 13 }}>
              {point ? `Phạm vi hợp lệ ${radius}m quanh điểm ghim` : 'Chưa ghim vị trí xưởng'}
            </span>
            <button type="button" className="primary" disabled={saving} onClick={saveSettings}>
              <Icon name="check" size={16} />
              <span>{saving ? 'Đang lưu…' : 'Lưu cài đặt'}</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
