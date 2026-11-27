import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useToast } from '../../lib/toast'
import { errorMessage, formatDate, monthEnd, monthStart, todayVN } from '../../lib/format'
import {
  extractQrToken,
  formatWorkedMinutes,
  googleMapsExternalUrl,
  haversineMeters,
} from '../../lib/garmentGps'
import { Icon } from '../../components/Icon'
import { tbSupabase } from '../supabase'
import { useTbAuth } from '../auth'
import { useWorkshop } from '../workshop'
import type { TbAttendanceLog } from '../types'
import { QrCameraScanner } from '../components/QrCameraScanner'

type GpsState =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'ready'; lat: number; lng: number; accuracy: number }
  | { status: 'error'; message: string }

function formatTimeVN(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function requestBrowserGps(onDone: (next: GpsState) => void): void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onDone({ status: 'error', message: 'Thiết bị hoặc trình duyệt không hỗ trợ định vị GPS.' })
    return
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      onDone({
        status: 'ready',
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy),
      })
    },
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        onDone({
          status: 'error',
          message: 'Bạn đã chặn quyền Vị trí. Hãy bật quyền Vị trí (Location) cho trình duyệt rồi bấm Lấy lại GPS.',
        })
      } else {
        onDone({
          status: 'error',
          message: 'Không lấy được tín hiệu GPS. Hãy kiểm tra đã bật định vị trên điện thoại chưa rồi thử lại.',
        })
      }
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
  )
}

export function CheckinPage() {
  const { session } = useTbAuth()
  const { config, isManager } = useWorkshop()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const qrToken = searchParams.get('k')?.trim() ?? ''

  const [scannerOpen, setScannerOpen] = useState(false)
  const [gps, setGps] = useState<GpsState>(() => ({ status: qrToken ? 'locating' : 'idle' }))
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [month, setMonth] = useState(() => todayVN().slice(0, 7))
  const [logs, setLogs] = useState<{ rows: TbAttendanceLog[]; error: string | null } | null>(null)
  const [version, setVersion] = useState(0)

  const locateNow = useCallback(() => {
    setGps({ status: 'locating' })
    requestBrowserGps(setGps)
  }, [])

  useEffect(() => {
    if (!qrToken) return
    let cancelled = false
    requestBrowserGps((next) => {
      if (!cancelled) setGps(next)
    })
    return () => {
      cancelled = true
    }
  }, [qrToken])

  const userId = session?.user.id ?? null

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const from = monthStart(`${month}-01`)
    const to = monthEnd(`${month}-01`)
    tbSupabase
      .from('attendance_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('work_date', from)
      .lte('work_date', to)
      .order('work_date', { ascending: false })
      .order('check_in_at', { ascending: false })
      .then(({ data, error }) => {
        if (!cancelled) setLogs({ rows: data ?? [], error: error ? errorMessage(error) : null })
      })
    return () => {
      cancelled = true
    }
  }, [userId, month, version])

  const workshopPoint = useMemo(() => {
    if (!config || config.latitude == null || config.longitude == null) return null
    return { lat: config.latitude, lng: config.longitude }
  }, [config])

  const distanceInfo = useMemo(() => {
    if (gps.status !== 'ready' || !workshopPoint || !config) return null
    const meters = Math.round(haversineMeters(workshopPoint, { lat: gps.lat, lng: gps.lng }))
    const withinRadius = meters <= config.allowed_radius_m
    const accuracyOk = gps.accuracy <= config.max_gps_accuracy_m
    return { meters, withinRadius, accuracyOk }
  }, [gps, workshopPoint, config])

  const today = todayVN()
  const openTodaySession = useMemo(
    () => (logs?.rows ?? []).find((r) => r.work_date === today && r.check_out_at === null) ?? null,
    [logs, today],
  )

  const monthStats = useMemo(() => {
    const rows = logs?.rows ?? []
    const days = new Set(rows.map((r) => r.work_date)).size
    const totalMinutes = rows.reduce((sum, r) => sum + (r.worked_minutes || 0), 0)
    return { days, totalMinutes }
  }, [logs])

  const onScannedCode = useCallback(
    (rawValue: string) => {
      const parsed = extractQrToken(rawValue)
      setScannerOpen(false)
      if (!parsed) {
        setFeedback({ ok: false, text: 'Mã QR vừa quét không phải mã chấm công của Thiên Bảo Clothes.' })
        return
      }
      setFeedback(null)
      setGps({ status: 'locating' })
      setSearchParams({ k: parsed }, { replace: true })
    },
    [setSearchParams],
  )

  const submitAttendance = async () => {
    setFeedback(null)
    if (!qrToken) {
      setFeedback({ ok: false, text: 'Bạn cần quét mã QR dán tại xưởng trước khi xác nhận chấm công.' })
      return
    }
    if (gps.status !== 'ready') {
      locateNow()
      setFeedback({ ok: false, text: 'Đang lấy vị trí GPS của bạn, vui lòng đợi vài giây rồi bấm lại.' })
      return
    }

    setSubmitting(true)
    const { data, error } = await tbSupabase.rpc('submit_qr_attendance', {
      p_qr_token: qrToken,
      p_lat: gps.lat,
      p_lng: gps.lng,
      p_accuracy_m: gps.accuracy,
    })
    setSubmitting(false)

    if (error) {
      setFeedback({ ok: false, text: errorMessage(error) })
      return
    }

    const timeText = formatTimeVN(data.timestamp)
    const msg =
      data.action === 'check_in'
        ? `Đã vào ca lúc ${timeText} (cách xưởng ${Math.round(data.distance_m)}m)`
        : `Đã tan ca lúc ${timeText} · Ghi nhận ${formatWorkedMinutes(data.worked_minutes)} giờ công`

    toast.success(msg)
    setFeedback({ ok: true, text: msg })
    setVersion((v) => v + 1)
  }

  return (
    <section>
      <div className="card tb-checkin-card">
        <h2>
          <Icon name="qr" size={22} />
          Chấm công tại xưởng
        </h2>

        {!workshopPoint ? (
          <div className="tb-gps-status warn">
            <span>Quản lý chưa cài đặt toạ độ Google Maps cho xưởng.</span>
            {isManager && (
              <Link to="/qr-setup" className="button primary">
                Chọn vị trí GPS & In mã QR ngay
              </Link>
            )}
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 0 }}>
            {config?.workshop_address || 'Xưởng Thiên Bảo Clothes'} · Ca chuẩn {config?.shift_start} – {config?.shift_end} ·
            Phạm vi GPS cho phép: <strong>{config?.allowed_radius_m}m</strong>
          </p>
        )}

        {!qrToken ? (
          <div style={{ margin: '14px 0' }}>
            <p style={{ marginTop: 0 }}>
              Quét tờ mã QR dán ở xưởng bằng ứng dụng <strong>Camera / Zalo</strong> của điện thoại, hoặc bấm nút dưới đây để mở máy quét:
            </p>
            <button type="button" className="primary tb-big-btn" onClick={() => setScannerOpen((o) => !o)}>
              <Icon name="qr" />
              {scannerOpen ? 'Ẩn máy quét QR' : 'Mở Camera quét mã QR'}
            </button>
            {scannerOpen && <QrCameraScanner onDetected={onScannedCode} onClose={() => setScannerOpen(false)} />}
          </div>
        ) : (
          <div className="tb-gps-status ok" style={{ marginBottom: 8 }}>
            <span>
              <Icon name="check" size={16} /> Đã nhận mã QR của xưởng
            </span>
            <button type="button" className="link" onClick={() => setScannerOpen((o) => !o)}>
              Quét lại mã khác
            </button>
          </div>
        )}

        {qrToken && scannerOpen && <QrCameraScanner onDetected={onScannedCode} onClose={() => setScannerOpen(false)} />}

        {qrToken && (
          <>
            {gps.status === 'locating' && (
              <div className="tb-gps-status">
                <span>Đang kiểm tra vị trí GPS trên điện thoại…</span>
              </div>
            )}

            {gps.status === 'error' && (
              <div className="tb-gps-status bad">
                <span>{gps.message}</span>
                <button type="button" onClick={locateNow}>
                  Lấy lại GPS
                </button>
              </div>
            )}

            {gps.status === 'ready' && distanceInfo && config && (
              <div
                className={`tb-gps-status ${
                  distanceInfo.withinRadius && distanceInfo.accuracyOk ? 'ok' : 'bad'
                }`}
              >
                <div>
                  <strong>
                    {distanceInfo.withinRadius && distanceInfo.accuracyOk
                      ? `Vị trí hợp lệ · Cách xưởng ${distanceInfo.meters}m`
                      : !distanceInfo.accuracyOk
                        ? `Tín hiệu GPS chưa rõ (±${gps.accuracy}m)`
                        : `Ngoài phạm vi xưởng · Cách ${distanceInfo.meters}m (tối đa ${config.allowed_radius_m}m)`}
                  </strong>
                  <br />
                  <small>
                    Sai số định vị: ±{gps.accuracy}m ·{' '}
                    <a
                      href={googleMapsExternalUrl({ lat: gps.lat, lng: gps.lng })}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Xem điểm đứng trên Google Maps
                    </a>
                  </small>
                </div>
                <button type="button" onClick={locateNow}>
                  Cập nhật GPS
                </button>
              </div>
            )}

            <button
              type="button"
              className="primary tb-big-btn"
              disabled={
                submitting ||
                !workshopPoint ||
                gps.status === 'locating' ||
                Boolean(distanceInfo && (!distanceInfo.withinRadius || !distanceInfo.accuracyOk))
              }
              onClick={submitAttendance}
            >
              <Icon name="check" />
              {submitting
                ? 'Đang ghi nhận…'
                : openTodaySession
                  ? `Xác nhận Tan ca (vào lúc ${formatTimeVN(openTodaySession.check_in_at)})`
                  : 'Xác nhận Vào ca'}
            </button>
          </>
        )}

        {feedback && (
          <p className={feedback.ok ? 'success' : 'error'} style={{ marginTop: 12, marginBottom: 0 }}>
            {feedback.text}
          </p>
        )}
      </div>

      <div className="tb-toolbar">
        <h2 style={{ margin: 0 }}>Giờ công của tôi</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="muted">Tháng</span>
          <input type="month" value={month} max={todayVN().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
        </label>
      </div>

      <div className="tb-stats">
        <div className="tb-stat">
          <span className="tb-stat-label">Số ngày có mặt</span>
          <span className="tb-stat-value">{monthStats.days} ngày</span>
        </div>
        <div className="tb-stat">
          <span className="tb-stat-label">Tổng giờ công đã chốt</span>
          <span className="tb-stat-value">{formatWorkedMinutes(monthStats.totalMinutes)}</span>
        </div>
      </div>

      {!logs ? (
        <p className="muted">Đang tải lịch sử chấm công…</p>
      ) : logs.error ? (
        <p className="error">{logs.error}</p>
      ) : logs.rows.length === 0 ? (
        <p className="muted">Chưa có lượt chấm công nào trong tháng này.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ngày</th>
                <th>Vào ca</th>
                <th>Tan ca</th>
                <th>Khoảng cách GPS</th>
                <th>Giờ công</th>
                <th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {logs.rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.work_date)}</td>
                  <td>{formatTimeVN(r.check_in_at)}</td>
                  <td>
                    {r.check_out_at ? (
                      formatTimeVN(r.check_out_at)
                    ) : (
                      <span className="badge badge-low">Đang làm</span>
                    )}
                  </td>
                  <td>
                    {r.check_in_distance_m != null ? `${Math.round(r.check_in_distance_m)}m` : 'Thủ công'}
                  </td>
                  <td>
                    <strong>{r.check_out_at ? formatWorkedMinutes(r.worked_minutes) : '—'}</strong>
                  </td>
                  <td className="muted">{r.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
