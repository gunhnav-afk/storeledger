import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, Route, Routes, Navigate } from 'react-router-dom'
import QRCode from 'qrcode'
import * as XLSX from 'xlsx'
import { useToast } from '../../lib/toast'
import { useConfirm } from '../../lib/confirm'
import { DatePicker } from '../../components/DatePicker'
import { Icon } from '../../components/Icon'
import { THIENBAO_ORIGIN } from '../../lib/hostScope'
import { errorMessage, formatDate, monthEnd, monthStart, todayVN } from '../../lib/format'
import {
  currentIsoTimestamp,
  formatWorkedMinutes,
  googleMapsEmbedUrl,
  googleMapsExternalUrl,
  isValidLatLng,
  minutesToHours,
  parseGoogleMapInput,
} from '../../lib/garmentGps'
import { tbSupabase } from '../supabase'
import { useWorkshop } from '../workshop'
import { renderQrPosterPng } from '../qrPoster'
import type { TbAttendanceLog, TbStaffRow, TbWorkshopSettings } from '../types'

function formatTimeInputVN(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function buildVnIso(dateStr: string, hhmm: string): string {
  return `${dateStr}T${hhmm}:00+07:00`
}

// ---------------------------------------------------------------------------
// Tab 1: Theo dõi chấm công trong ngày & Chấm bù / Sửa giờ
// ---------------------------------------------------------------------------
function DailyAttendanceTab({ staff }: { staff: TbStaffRow[] }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [date, setDate] = useState(todayVN())
  const [rows, setRows] = useState<{ list: TbAttendanceLog[]; error: string | null } | null>(null)
  const [version, setVersion] = useState(0)
  const [showManual, setShowManual] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    userId: '',
    checkIn: '07:30',
    checkOut: '17:00',
    note: '',
  })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const staffMap = useMemo(() => new Map(staff.map((s) => [s.user_id, s])), [staff])
  const approvedStaff = useMemo(() => staff.filter((s) => s.status === 'approved'), [staff])

  useEffect(() => {
    let cancelled = false
    tbSupabase
      .from('attendance_logs')
      .select('*')
      .eq('work_date', date)
      .order('check_in_at', { ascending: false })
      .then(({ data, error }) => {
        if (!cancelled) setRows({ list: data ?? [], error: error ? errorMessage(error) : null })
      })
    return () => {
      cancelled = true
    }
  }, [date, version])

  const stats = useMemo(() => {
    const list = rows?.list ?? []
    const working = list.filter((r) => !r.check_out_at).length
    const done = list.filter((r) => Boolean(r.check_out_at)).length
    const totalMinutes = list.reduce((sum, r) => sum + (r.worked_minutes || 0), 0)
    return { working, done, totalMinutes }
  }, [rows])

  const startNewManual = () => {
    setEditingId(null)
    setFormError(null)
    setForm({
      userId: approvedStaff[0]?.user_id ?? '',
      checkIn: '07:30',
      checkOut: '17:00',
      note: '',
    })
    setShowManual(true)
  }

  const startEditRow = (r: TbAttendanceLog) => {
    setEditingId(r.id)
    setFormError(null)
    setForm({
      userId: r.user_id,
      checkIn: formatTimeInputVN(r.check_in_at) || '07:30',
      checkOut: formatTimeInputVN(r.check_out_at),
      note: r.note ?? '',
    })
    setShowManual(true)
  }

  const saveManual = async () => {
    setFormError(null)
    if (!form.userId) return setFormError('Chọn nhân viên cần ghi công')
    if (!form.checkIn) return setFormError('Nhập giờ vào ca')

    const checkInIso = buildVnIso(date, form.checkIn)
    const checkOutIso = form.checkOut ? buildVnIso(date, form.checkOut) : null
    if (checkOutIso && checkOutIso <= checkInIso) {
      return setFormError('Giờ tan ca phải sau giờ vào ca')
    }

    setSaving(true)
    const { error } = await tbSupabase.rpc('admin_upsert_attendance', {
      p_attendance_id: editingId,
      p_user_id: form.userId,
      p_work_date: date,
      p_check_in_at: checkInIso,
      p_check_out_at: checkOutIso,
      p_note: form.note.trim() || null,
    })
    setSaving(false)
    if (error) return setFormError(errorMessage(error))

    toast.success(editingId ? 'Đã cập nhật giờ chấm công' : 'Đã thêm chấm công thủ công')
    setShowManual(false)
    setEditingId(null)
    setVersion((v) => v + 1)
  }

  const removeRow = async (r: TbAttendanceLog) => {
    const person = staffMap.get(r.user_id)?.full_name || staffMap.get(r.user_id)?.email || 'nhân viên'
    const ok = await confirm({
      title: 'Xoá lượt chấm công',
      message: `Xoá lượt chấm công ngày ${formatDate(r.work_date)} của ${person}?`,
      confirmText: 'Xoá',
      cancelText: 'Đóng',
      danger: true,
    })
    if (!ok) return
    const { error } = await tbSupabase.rpc('admin_delete_attendance', { p_attendance_id: r.id })
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success('Đã xoá lượt chấm công')
    setVersion((v) => v + 1)
  }

  return (
    <div>
      <div className="tb-toolbar">
        <div className="tb-inline-actions">
          <DatePicker label="Ngày chấm công" value={date} max={todayVN()} onChange={setDate} />
          <button type="button" onClick={() => setVersion((v) => v + 1)}>
            Làm mới
          </button>
        </div>
        <button type="button" className="primary" onClick={startNewManual}>
          + Chấm công bù / Bổ sung
        </button>
      </div>

      <div className="tb-stats">
        <div className="tb-stat">
          <span className="tb-stat-label">Đang trong ca</span>
          <span className="tb-stat-value">{stats.working} người</span>
        </div>
        <div className="tb-stat">
          <span className="tb-stat-label">Đã tan ca</span>
          <span className="tb-stat-value">{stats.done} lượt</span>
        </div>
        <div className="tb-stat">
          <span className="tb-stat-label">Tổng giờ công đã chốt</span>
          <span className="tb-stat-value">{formatWorkedMinutes(stats.totalMinutes)}</span>
        </div>
      </div>

      {showManual && (
        <div className="card form" style={{ marginBottom: 16 }}>
          <div className="tb-toolbar" style={{ marginBottom: 6 }}>
            <strong>
              {editingId ? 'Sửa giờ chấm công' : 'Chấm công thủ công'} ({formatDate(date)})
            </strong>
            <button type="button" className="link" onClick={() => setShowManual(false)}>
              Đóng
            </button>
          </div>
          <div className="row">
            <label>
              Nhân viên
              <select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
                <option value="">-- Chọn nhân viên --</option>
                {approvedStaff.map((s) => (
                  <option key={s.user_id} value={s.user_id}>
                    {s.full_name || s.email} ({s.department})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Giờ vào ca
              <input type="time" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} />
            </label>
            <label>
              Giờ tan ca (để trống nếu đang làm)
              <input type="time" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} />
            </label>
          </div>
          <label>
            Ghi chú / Lý do điều chỉnh
            <input
              type="text"
              placeholder="Ví dụ: Quên quét lúc về, điện thoại hết pin…"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
          {formError && <p className="error">{formError}</p>}
          <div className="tb-inline-actions">
            <button type="button" className="primary" disabled={saving} onClick={saveManual}>
              {saving ? 'Đang lưu…' : 'Lưu giờ công'}
            </button>
            <button type="button" onClick={() => setShowManual(false)}>
              Huỷ
            </button>
          </div>
        </div>
      )}

      {!rows ? (
        <p className="muted">Đang tải danh sách chấm công…</p>
      ) : rows.error ? (
        <p className="error">{rows.error}</p>
      ) : rows.list.length === 0 ? (
        <p className="muted">Chưa có ai chấm công trong ngày {formatDate(date)}.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th>Tổ</th>
                <th>Vào ca</th>
                <th>Tan ca</th>
                <th>GPS</th>
                <th>Giờ công</th>
                <th>Ghi chú</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.list.map((r) => {
                const info = staffMap.get(r.user_id)
                return (
                  <tr key={r.id}>
                    <td>
                      <strong>{info?.full_name || info?.email || r.user_id.slice(0, 8)}</strong>
                      {info?.worker_code && <small className="muted"> · {info.worker_code}</small>}
                    </td>
                    <td>{info?.department ?? '—'}</td>
                    <td>{formatTimeInputVN(r.check_in_at)}</td>
                    <td>
                      {r.check_out_at ? (
                        formatTimeInputVN(r.check_out_at)
                      ) : (
                        <span className="badge badge-low">Đang làm</span>
                      )}
                    </td>
                    <td>
                      {r.source === 'manual'
                        ? 'Thủ công'
                        : r.check_in_distance_m != null
                          ? `${Math.round(r.check_in_distance_m)}m`
                          : 'QR'}
                    </td>
                    <td>
                      <strong>{r.check_out_at ? formatWorkedMinutes(r.worked_minutes) : '—'}</strong>
                    </td>
                    <td className="muted">{r.note ?? ''}</td>
                    <td className="actions">
                      <button type="button" className="link" onClick={() => startEditRow(r)}>
                        Sửa giờ
                      </button>
                      <button type="button" className="link danger" onClick={() => removeRow(r)}>
                        Xoá
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 2: Tổng hợp bảng giờ công theo tháng & Xuất Excel
// ---------------------------------------------------------------------------
function TimesheetSummaryTab({ staff }: { staff: TbStaffRow[] }) {
  const [month, setMonth] = useState(() => todayVN().slice(0, 7))
  const [data, setData] = useState<{ list: TbAttendanceLog[]; error: string | null } | null>(null)

  const from = monthStart(`${month}-01`)
  const to = monthEnd(`${month}-01`)
  const staffMap = useMemo(() => new Map(staff.map((s) => [s.user_id, s])), [staff])

  useEffect(() => {
    let cancelled = false
    tbSupabase
      .from('attendance_logs')
      .select('*')
      .gte('work_date', from)
      .lte('work_date', to)
      .order('work_date', { ascending: true })
      .order('check_in_at', { ascending: true })
      .then(({ data: rows, error }) => {
        if (!cancelled) setData({ list: rows ?? [], error: error ? errorMessage(error) : null })
      })
    return () => {
      cancelled = true
    }
  }, [from, to])

  const summary = useMemo(() => {
    const byUser = new Map<
      string,
      { userId: string; days: Set<string>; sessions: number; openSessions: number; totalMinutes: number }
    >()
    for (const r of data?.list ?? []) {
      let entry = byUser.get(r.user_id)
      if (!entry) {
        entry = { userId: r.user_id, days: new Set(), sessions: 0, openSessions: 0, totalMinutes: 0 }
        byUser.set(r.user_id, entry)
      }
      entry.days.add(r.work_date)
      entry.sessions += 1
      if (!r.check_out_at) entry.openSessions += 1
      entry.totalMinutes += r.worked_minutes || 0
    }
    return [...byUser.values()].sort((a, b) => b.totalMinutes - a.totalMinutes)
  }, [data])

  const exportExcel = () => {
    const summarySheet = summary.map((row) => {
      const s = staffMap.get(row.userId)
      return {
        'Mã NV': s?.worker_code ?? '',
        'Họ tên': s?.full_name || s?.email || row.userId,
        'Tổ / Bộ phận': s?.department ?? '',
        'Số ngày đi làm': row.days.size,
        'Số ca chưa tan': row.openSessions,
        'Tổng giờ công (giờ)': minutesToHours(row.totalMinutes),
        'Hiển thị giờ phút': formatWorkedMinutes(row.totalMinutes),
      }
    })

    const detailSheet = (data?.list ?? []).map((r) => {
      const s = staffMap.get(r.user_id)
      return {
        Ngày: formatDate(r.work_date),
        'Mã NV': s?.worker_code ?? '',
        'Họ tên': s?.full_name || s?.email || r.user_id,
        Tổ: s?.department ?? '',
        'Vào ca': formatTimeInputVN(r.check_in_at),
        'Tan ca': formatTimeInputVN(r.check_out_at),
        'Số giờ công': minutesToHours(r.worked_minutes),
        'Khoảng cách GPS (m)': r.check_in_distance_m ?? '',
        Nguồn: r.source === 'manual' ? 'Thủ công' : 'QR + GPS',
        'Ghi chú': r.note ?? '',
      }
    })

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summarySheet), 'Tong_hop_gio_cong')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailSheet), 'Chi_tiet_ngay')
    XLSX.writeFile(wb, `bang-gio-cong-thien-bao-${month}.xlsx`)
  }

  return (
    <div>
      <div className="tb-toolbar">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Tháng chấm công</span>
          <input type="month" value={month} max={todayVN().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <button type="button" className="primary" disabled={summary.length === 0} onClick={exportExcel}>
          <Icon name="download" />
          Xuất Excel bảng giờ công (.xlsx)
        </button>
      </div>

      {!data ? (
        <p className="muted">Đang tổng hợp bảng giờ công…</p>
      ) : data.error ? (
        <p className="error">{data.error}</p>
      ) : summary.length === 0 ? (
        <p className="muted">Chưa có dữ liệu chấm công trong tháng {month}.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th>Tổ</th>
                <th>Số ngày làm</th>
                <th>Ca chưa chấm ra</th>
                <th>Tổng giờ công</th>
                <th>Quy đổi thập phân</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => {
                const s = staffMap.get(row.userId)
                return (
                  <tr key={row.userId}>
                    <td>
                      <strong>{s?.full_name || s?.email || row.userId.slice(0, 8)}</strong>
                      {s?.worker_code && <small className="muted"> · {s.worker_code}</small>}
                    </td>
                    <td>{s?.department ?? '—'}</td>
                    <td>{row.days.size} ngày</td>
                    <td>
                      {row.openSessions > 0 ? (
                        <span className="badge badge-low">{row.openSessions} ca thiếu giờ ra</span>
                      ) : (
                        <span className="badge badge-ok">Đủ</span>
                      )}
                    </td>
                    <td>
                      <strong>{formatWorkedMinutes(row.totalMinutes)}</strong>
                    </td>
                    <td>{minutesToHours(row.totalMinutes)} giờ</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 3: Mã QR Tĩnh & Chọn vị trí Google Maps của Xưởng
// ---------------------------------------------------------------------------
function QrAndGpsSettingsTab({ onSaved }: { onSaved: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [settings, setSettings] = useState<TbWorkshopSettings | null>(null)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [address, setAddress] = useState('')
  const [mapInput, setMapInput] = useState('')
  const [latStr, setLatStr] = useState('')
  const [lngStr, setLngStr] = useState('')
  const [radius, setRadius] = useState('100')
  const [maxAccuracy, setMaxAccuracy] = useState('200')
  const [shiftStart, setShiftStart] = useState('07:30')
  const [shiftEnd, setShiftEnd] = useState('17:00')
  const [breakStart, setBreakStart] = useState('11:30')
  const [breakEnd, setBreakEnd] = useState('12:30')

  const [qrImgUrl, setQrImgUrl] = useState<string | null>(null)
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
      width: 320,
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

  const parsedPoint = useMemo(() => {
    if (latStr.trim() === '' || lngStr.trim() === '') return null
    const lat = Number(latStr)
    const lng = Number(lngStr)
    return isValidLatLng(lat, lng) ? { lat, lng } : null
  }, [latStr, lngStr])

  const onParseMapLink = () => {
    setMsg(null)
    const res = parseGoogleMapInput(mapInput)
    if (!res.ok) {
      setMsg({ ok: false, text: res.error })
      return
    }
    setLatStr(String(res.point.lat))
    setLngStr(String(res.point.lng))
    setMapInput('')
    toast.success(`Đã lấy toạ độ từ Google Maps: ${res.point.lat}, ${res.point.lng}`)
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
        const lat = Number(pos.coords.latitude.toFixed(6))
        const lng = Number(pos.coords.longitude.toFixed(6))
        setLatStr(String(lat))
        setLngStr(String(lng))
        toast.success(`Đã lấy vị trí hiện tại (±${Math.round(pos.coords.accuracy)}m)`)
      },
      () => {
        setLocating(false)
        setMsg({ ok: false, text: 'Không lấy được vị trí hiện tại. Hãy cho phép quyền Vị trí trên trình duyệt.' })
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  }

  const saveSettings = async () => {
    setMsg(null)
    const lat = latStr.trim() === '' ? null : Number(latStr)
    const lng = lngStr.trim() === '' ? null : Number(lngStr)
    if ((lat === null) !== (lng === null) || (lat !== null && lng !== null && !isValidLatLng(lat, lng))) {
      setMsg({ ok: false, text: 'Vĩ độ và kinh độ chưa hợp lệ. Hãy dán link Google Maps hoặc bấm Lấy vị trí hiện tại.' })
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
        workshop_address: address.trim() || null,
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
    onSaved()
    toast.success('Đã lưu vị trí Google Maps và cấu hình chấm công của xưởng')
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

  if (!loadedOnce) return <p className="muted">Đang tải cấu hình mã QR & bản đồ…</p>
  if (loadError) return <p className="error">{loadError}</p>

  return (
    <div className="tb-split">
      <div className="card tb-qr-panel">
        <h3 style={{ margin: 0 }}>Mã QR Tĩnh của Xưởng</h3>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          In mã này dán cố định tại cửa xưởng. Nhân viên chỉ chấm công được khi đứng trong bán kính GPS hợp lệ.
        </p>
        {qrImgUrl && <img src={qrImgUrl} alt="Mã QR chấm công Thiên Bảo Clothes" className="tb-qr-img" />}
        <button type="button" className="primary tb-big-btn" onClick={downloadPoster}>
          <Icon name="download" />
          Tải bảng QR để in (PNG)
        </button>
        <div className="tb-inline-actions" style={{ justifyContent: 'center' }}>
          <button type="button" onClick={copyLink}>
            <Icon name="copy" size={16} />
            Chép link QR
          </button>
          <button type="button" className="danger" onClick={rotateQr}>
            Đổi mã QR mới
          </button>
        </div>
      </div>

      <div className="card form">
        <h3 style={{ margin: 0 }}>Vị trí Xưởng trên Google Maps & Giờ ca</h3>

        <label>
          Tên / Địa chỉ xưởng hiển thị trên bảng in QR
          <input
            type="text"
            placeholder="Ví dụ: Xưởng may Thiên Bảo Clothes - Quận 12"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </label>

        <div>
          <span className="field-label">Cách nhanh: Mở Google Maps chọn điểm xưởng rồi dán link hoặc toạ độ vào đây</span>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label style={{ flex: 1 }}>
              Link Google Maps hoặc toạ độ (Vĩ độ, Kinh độ)
              <input
                type="text"
                placeholder="Dán link https://www.google.com/maps/... hoặc 10.762622, 106.660172"
                value={mapInput}
                onChange={(e) => setMapInput(e.target.value)}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData('text')
                  const res = parseGoogleMapInput(pasted)
                  if (res.ok) {
                    e.preventDefault()
                    setLatStr(String(res.point.lat))
                    setLngStr(String(res.point.lng))
                    setMapInput('')
                    toast.success(`Đã nhận toạ độ Google Maps: ${res.point.lat}, ${res.point.lng}`)
                  }
                }}
              />
            </label>
            <button type="button" onClick={onParseMapLink}>
              Lấy toạ độ
            </button>
          </div>
          <div className="tb-inline-actions" style={{ marginTop: 8 }}>
            <button type="button" onClick={useCurrentGps} disabled={locating}>
              {locating ? 'Đang định vị…' : 'Lấy GPS ngay chỗ tôi đang đứng'}
            </button>
            <a href={googleMapsExternalUrl(parsedPoint)} target="_blank" rel="noreferrer" className="button">
              Mở Google Maps để chọn điểm
            </a>
          </div>
          <small className="muted" style={{ display: 'block', marginTop: 6 }}>
            Mẹo trên Google Maps: bấm chuột phải (hoặc chạm giữ trên điện thoại) vào đúng mái xưởng → bấm dòng số đầu tiên (vd{' '}
            <code>10.82310, 106.62970</code>) để sao chép rồi dán vào ô trên.
          </small>
        </div>

        <div className="row">
          <label>
            Vĩ độ (Latitude)
            <input type="text" inputMode="decimal" placeholder="10.823100" value={latStr} onChange={(e) => setLatStr(e.target.value)} />
          </label>
          <label>
            Kinh độ (Longitude)
            <input type="text" inputMode="decimal" placeholder="106.629700" value={lngStr} onChange={(e) => setLngStr(e.target.value)} />
          </label>
          <label>
            Bán kính hợp lệ (mét)
            <input type="number" min={20} max={2000} step={10} value={radius} onChange={(e) => setRadius(e.target.value)} />
          </label>
          <label>
            Sai số GPS tối đa (mét)
            <input type="number" min={20} max={1000} step={10} value={maxAccuracy} onChange={(e) => setMaxAccuracy(e.target.value)} />
          </label>
        </div>

        {parsedPoint ? (
          <div className="tb-map-wrap">
            <iframe
              title="Vị trí xưởng trên Google Maps"
              src={googleMapsEmbedUrl(parsedPoint)}
              className="tb-map-frame"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        ) : (
          <div className="tb-gps-status warn">
            <span>Chưa có toạ độ xưởng. Hãy dán toạ độ từ Google Maps hoặc bấm “Lấy GPS ngay chỗ tôi đang đứng”.</span>
          </div>
        )}

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

        {msg && <p className={msg.ok ? 'success' : 'error'}>{msg.text}</p>}

        <button type="button" className="primary" disabled={saving} onClick={saveSettings}>
          {saving ? 'Đang lưu…' : 'Lưu vị trí Google Maps & Cài đặt chấm công'}
        </button>
      </div>
    </div>
  )
}

export function AttendanceAdminPage() {
  const { reload } = useWorkshop()
  const [staff, setStaff] = useState<TbStaffRow[]>([])

  useEffect(() => {
    let cancelled = false
    tbSupabase.rpc('workshop_list_staff').then(({ data }) => {
      if (!cancelled && data) setStaff(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="tabs-page">
      <div className="tabs-head">
        <h1>Quản lý chấm công</h1>
        <nav className="tabs" aria-label="Quản lý chấm công">
          <NavLink to="/attendance/today" className="tab">
            <Icon name="calendar" size={17} />
            <span>Chấm công ngày</span>
          </NavLink>
          <NavLink to="/attendance/timesheet" className="tab">
            <Icon name="report" size={17} />
            <span>Bảng giờ công</span>
          </NavLink>
          <NavLink to="/attendance/qr-map" className="tab">
            <Icon name="qr" size={17} />
            <span>Mã QR & Bản đồ GPS</span>
          </NavLink>
        </nav>
      </div>
      <div className="workspace-body">
        <Routes>
          <Route index element={<Navigate to="today" replace />} />
          <Route path="today" element={<DailyAttendanceTab staff={staff} />} />
          <Route path="timesheet" element={<TimesheetSummaryTab staff={staff} />} />
          <Route path="qr-map" element={<QrAndGpsSettingsTab onSaved={reload} />} />
        </Routes>
      </div>
    </div>
  )
}
