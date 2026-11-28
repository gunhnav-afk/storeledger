import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Route, Routes, Navigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { useToast } from '../../lib/toast'
import { useConfirm } from '../../lib/confirm'
import { DatePicker } from '../../components/DatePicker'
import { Icon } from '../../components/Icon'
import { errorMessage, formatDate, monthEnd, monthStart, todayVN } from '../../lib/format'
import { formatWorkedMinutes, minutesToHours } from '../../lib/garmentGps'
import { tbSupabase } from '../supabase'
import { useWorkshop } from '../workshop'
import type { TbAttendanceLog, TbStaffRow } from '../types'

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

function DailyAttendanceTab({ staff }: { staff: TbStaffRow[] }) {
  const toast = useToast()
  const confirm = useConfirm()
  const { config } = useWorkshop()
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

    toast.success(editingId ? 'Đã cập nhật giờ chấm công' : 'Đã thêm chấm công bù')
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

  const hasGps = config?.latitude != null && config?.longitude != null

  return (
    <div>
      {!hasGps && (
        <div className="tb-gps-status warn" style={{ marginBottom: 16 }}>
          <span>Chưa ghim vị trí GPS của xưởng để mở quét QR chấm công</span>
          <Link to="/qr-setup" className="tb-btn">
            <Icon name="qr" size={16} />
            <span>Cài đặt vị trí & Mã QR</span>
          </Link>
        </div>
      )}

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

      <div className="tb-toolbar">
        <div className="tb-inline-actions">
          <div style={{ width: 210 }}>
            <DatePicker label="Ngày chấm công" value={date} max={todayVN()} onChange={setDate} />
          </div>
          <button type="button" onClick={() => setVersion((v) => v + 1)}>
            Làm mới
          </button>
        </div>
        <div className="tb-inline-actions">
          <Link to="/qr-setup" className="tb-btn">
            <Icon name="printer" size={16} />
            <span>In bảng QR</span>
          </Link>
          <button type="button" className="primary" onClick={startNewManual}>
            <span>Chấm công bù</span>
          </button>
        </div>
      </div>

      {showManual && (
        <div className="card form" style={{ marginBottom: 16 }}>
          <div className="tb-toolbar" style={{ marginBottom: 0 }}>
            <h2>
              {editingId ? 'Sửa giờ chấm công' : 'Chấm công bù'} · {formatDate(date)}
            </h2>
            <button type="button" className="tb-ghost" onClick={() => setShowManual(false)}>
              Đóng
            </button>
          </div>
          <div className="tb-grid-3">
            <label>
              <span className="tb-field-label">Nhân viên</span>
              <select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
                <option value="">Chọn nhân viên</option>
                {approvedStaff.map((s) => (
                  <option key={s.user_id} value={s.user_id}>
                    {s.full_name || s.email} ({s.department})
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="tb-field-label">Giờ vào ca</span>
              <input type="time" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} />
            </label>
            <label>
              <span className="tb-field-label">Giờ tan ca (để trống nếu đang làm)</span>
              <input type="time" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} />
            </label>
          </div>
          <label>
            <span className="tb-field-label">Ghi chú điều chỉnh</span>
            <input
              type="text"
              placeholder="Quên quét lúc về, điện thoại hết pin…"
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
        <div className="tb-empty">Đang tải danh sách chấm công…</div>
      ) : rows.error ? (
        <p className="error">{rows.error}</p>
      ) : rows.list.length === 0 ? (
        <div className="tb-empty">Chưa có lượt chấm công nào trong ngày {formatDate(date)}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th>Tổ</th>
                <th>Vào ca</th>
                <th>Tan ca</th>
                <th>Định vị</th>
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
                      {info?.worker_code && <span className="muted"> · {info.worker_code}</span>}
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
                        Sửa
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
        <label className="tb-inline-field">
          <span>Tháng chấm công</span>
          <input type="month" value={month} max={todayVN().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <button type="button" className="primary" disabled={summary.length === 0} onClick={exportExcel}>
          <Icon name="download" size={16} />
          <span>Xuất Excel (.xlsx)</span>
        </button>
      </div>

      {!data ? (
        <div className="tb-empty">Đang tổng hợp bảng giờ công…</div>
      ) : data.error ? (
        <p className="error">{data.error}</p>
      ) : summary.length === 0 ? (
        <div className="tb-empty">Chưa có dữ liệu chấm công trong tháng {month}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th>Tổ</th>
                <th>Số ngày làm</th>
                <th>Trạng thái ca</th>
                <th>Tổng giờ công</th>
                <th>Quy đổi giờ</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => {
                const s = staffMap.get(row.userId)
                return (
                  <tr key={row.userId}>
                    <td>
                      <strong>{s?.full_name || s?.email || row.userId.slice(0, 8)}</strong>
                      {s?.worker_code && <span className="muted"> · {s.worker_code}</span>}
                    </td>
                    <td>{s?.department ?? '—'}</td>
                    <td>{row.days.size} ngày</td>
                    <td>
                      {row.openSessions > 0 ? (
                        <span className="badge badge-low">{row.openSessions} ca thiếu giờ ra</span>
                      ) : (
                        <span className="badge badge-ok">Đầy đủ</span>
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

export function AttendanceAdminPage() {
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
    <section>
      <div className="tb-page-head">
        <div className="tb-page-title-group">
          <h1>Bảng chấm công</h1>
          <p className="tb-page-sub">Ca làm trong ngày và tổng hợp giờ công tháng</p>
        </div>
        <nav className="tb-segmented" aria-label="Chế độ xem chấm công">
          <NavLink to="/attendance/today">
            <Icon name="calendar" size={15} />
            <span>Theo ngày</span>
          </NavLink>
          <NavLink to="/attendance/timesheet">
            <Icon name="report" size={15} />
            <span>Tổng hợp tháng</span>
          </NavLink>
        </nav>
      </div>

      <Routes>
        <Route index element={<Navigate to="today" replace />} />
        <Route path="today" element={<DailyAttendanceTab staff={staff} />} />
        <Route path="timesheet" element={<TimesheetSummaryTab staff={staff} />} />
        <Route path="qr-map" element={<Navigate to="/qr-setup" replace />} />
      </Routes>
    </section>
  )
}
