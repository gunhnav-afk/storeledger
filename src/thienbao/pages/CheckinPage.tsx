import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useToast } from '../../lib/toast'
import { errorMessage, formatDate, monthEnd, monthStart, todayVN } from '../../lib/format'
import {
  extractQrToken,
  formatWorkedMinutes,
  haversineMeters,
} from '../../lib/garmentGps'
import { Icon } from '../../components/Icon'
import { tbSupabase } from '../supabase'
import { useTbAuth } from '../auth'
import { useWorkshop } from '../workshop'
import type { TbAttendanceLog } from '../types'
import { QrCameraScanner } from '../components/QrCameraScanner'

type PermState = 'unknown' | 'granted' | 'prompt' | 'denied'

type GpsErrorCode = 'denied' | 'timeout' | 'unavailable'

type GpsState =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'ready'; lat: number; lng: number; accuracy: number; updatedAt: number }
  | { status: 'error'; code: GpsErrorCode; message: string }

const GPS_FRESH_MS = 20_000

function formatTimeVN(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function currentTimestampMs(): number {
  return Date.now()
}

// Lấy toạ độ GPS 2 tầng (GNSS chính xác -> fallback Wi-Fi/trạm phát sóng) kèm hẹn giờ cứng chống treo WebView
function acquireBrowserGps(onDone: (next: GpsState) => void): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onDone({
      status: 'error',
      code: 'unavailable',
      message: 'Thiết bị hoặc trình duyệt này không hỗ trợ định vị GPS.',
    })
    return () => {}
  }

  let finished = false
  const finish = (next: GpsState) => {
    if (finished) return
    finished = true
    window.clearTimeout(watchdogId)
    onDone(next)
  }

  const watchdogId = window.setTimeout(() => {
    finish({
      status: 'error',
      code: 'timeout',
      message: 'Quá thời gian chờ tín hiệu GPS. Hãy kiểm tra đã bật Vị trí trên thiết bị rồi bấm Lấy lại GPS.',
    })
  }, 9500)

  const toReady = (pos: GeolocationPosition): GpsState => ({
    status: 'ready',
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: Math.max(1, Math.round(pos.coords.accuracy)),
    updatedAt: currentTimestampMs(),
  })

  navigator.geolocation.getCurrentPosition(
    (pos) => finish(toReady(pos)),
    (err) => {
      if (finished) return
      if (err.code === err.PERMISSION_DENIED) {
        finish({
          status: 'error',
          code: 'denied',
          message:
            'Bạn đã chặn quyền Vị trí. Hãy bấm biểu tượng ổ khoá trên thanh địa chỉ trình duyệt, bật quyền Vị trí rồi bấm Kiểm tra lại GPS.',
        })
        return
      }
      // Tầng 2: hạ sang định vị mạng/Wi-Fi để không bị kẹt trong nhà xưởng hoặc trên PC
      navigator.geolocation.getCurrentPosition(
        (pos2) => finish(toReady(pos2)),
        (err2) => {
          if (err2.code === err2.PERMISSION_DENIED) {
            finish({
              status: 'error',
              code: 'denied',
              message:
                'Bạn đã chặn quyền Vị trí. Hãy bấm biểu tượng ổ khoá trên thanh địa chỉ trình duyệt, bật quyền Vị trí rồi bấm Kiểm tra lại GPS.',
            })
          } else {
            finish({
              status: 'error',
              code: 'unavailable',
              message: 'Chưa lấy được tín hiệu định vị. Hãy bật GPS trên điện thoại rồi bấm Lấy lại GPS.',
            })
          }
        },
        { enableHighAccuracy: false, timeout: 3500, maximumAge: 30_000 },
      )
    },
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 15_000 },
  )

  return () => {
    finished = true
    window.clearTimeout(watchdogId)
  }
}

export function CheckinPage() {
  const { session } = useTbAuth()
  const { config, isManager } = useWorkshop()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const qrToken = searchParams.get('k')?.trim() ?? ''

  const [permState, setPermState] = useState<PermState>('unknown')
  const [gps, setGps] = useState<GpsState>({ status: 'idle' })
  const [scannerOpen, setScannerOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [month, setMonth] = useState(() => todayVN().slice(0, 7))
  const [logs, setLogs] = useState<{ rows: TbAttendanceLog[]; error: string | null } | null>(null)
  const [version, setVersion] = useState(0)

  const cancelLocateRef = useRef<(() => void) | null>(null)
  const gpsRef = useRef<GpsState>(gps)

  useEffect(() => {
    gpsRef.current = gps
  }, [gps])

  useEffect(() => {
    return () => {
      cancelLocateRef.current?.()
    }
  }, [])

  const locateNow = useCallback((opts?: { silentIfFresh?: boolean }) => {
    const current = gpsRef.current
    const hasFreshFix =
      opts?.silentIfFresh &&
      current.status === 'ready' &&
      currentTimestampMs() - current.updatedAt < GPS_FRESH_MS

    cancelLocateRef.current?.()
    if (!hasFreshFix) {
      setGps({ status: 'locating' })
    }

    cancelLocateRef.current = acquireBrowserGps((next) => {
      cancelLocateRef.current = null
      if (next.status === 'ready') {
        setPermState('granted')
        setGps(next)
      } else if (next.status === 'error' && (!hasFreshFix || next.code === 'denied')) {
        if (next.code === 'denied') setPermState('denied')
        setGps(next)
      }
    })
  }, [])

  // Theo dõi trạng thái quyền Vị trí của trình duyệt; nếu đã cấp quyền sẵn thì tự bắt sóng ngầm ngay
  useEffect(() => {
    if (typeof navigator === 'undefined') return
    let cancelled = false
    let watchId: number | null = null
    let permStatus: PermissionStatus | null = null

    const startLiveWatch = () => {
      if (!navigator.geolocation || watchId !== null) return
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (cancelled) return
          setPermState('granted')
          setGps({
            status: 'ready',
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: Math.max(1, Math.round(pos.coords.accuracy)),
            updatedAt: currentTimestampMs(),
          })
        },
        (err) => {
          if (!cancelled && err.code === err.PERMISSION_DENIED) {
            setPermState('denied')
          }
        },
        { enableHighAccuracy: true, maximumAge: 15_000, timeout: 10_000 },
      )
    }

    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((status) => {
          if (cancelled) return
          permStatus = status
          setPermState(status.state)
          if (status.state === 'granted') {
            locateNow({ silentIfFresh: true })
            startLiveWatch()
          }
          status.onchange = () => {
            if (cancelled) return
            setPermState(status.state)
            if (status.state === 'granted') {
              locateNow({ silentIfFresh: true })
              startLiveWatch()
            } else if (status.state === 'denied') {
              setGps({
                status: 'error',
                code: 'denied',
                message:
                  'Bạn đã chặn quyền Vị trí. Hãy bấm biểu tượng ổ khoá trên thanh địa chỉ trình duyệt, bật quyền Vị trí rồi bấm Kiểm tra lại GPS.',
              })
            }
          }
        })
        .catch(() => {
          if (!cancelled) setPermState('prompt')
        })
    }

    return () => {
      cancelled = true
      if (permStatus) permStatus.onchange = null
      if (watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId)
      }
    }
  }, [locateNow])

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

  const handleEnableGpsClick = () => {
    setFeedback(null)
    locateNow({ silentIfFresh: false })
  }

  const handleRescanClick = () => {
    setFeedback(null)
    setScannerOpen((prev) => {
      const next = !prev
      if (next && permState === 'granted') {
        locateNow({ silentIfFresh: true })
      }
      return next
    })
  }

  const onScannedCode = useCallback(
    (rawValue: string) => {
      const parsed = extractQrToken(rawValue)
      setScannerOpen(false)
      if (!parsed) {
        setFeedback({ ok: false, text: 'Mã QR vừa quét không thuộc xưởng Thiên Bảo Clothes' })
        return
      }
      setFeedback(null)
      setSearchParams({ k: parsed }, { replace: true })
      // Luôn gọi trực tiếp không phụ thuộc sự thay đổi của qrToken để bấm "Quét lại" không bao giờ bị treo
      locateNow({ silentIfFresh: true })
    },
    [locateNow, setSearchParams],
  )

  const submitAttendance = async () => {
    setFeedback(null)
    if (!qrToken) {
      setFeedback({ ok: false, text: 'Vui lòng quét bảng mã QR tại xưởng trước khi xác nhận' })
      return
    }
    if (gps.status !== 'ready') {
      locateNow({ silentIfFresh: false })
      setFeedback({ ok: false, text: 'Bắt buộc bật và cho phép Vị trí GPS hiện tại mới được chấm công' })
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
        : `Đã tan ca lúc ${timeText} · Ghi nhận ${formatWorkedMinutes(data.worked_minutes)}`

    toast.success(msg)
    setFeedback({ ok: true, text: msg })
    setVersion((v) => v + 1)
  }

  const isGpsBlocked = permState === 'denied' || (gps.status === 'error' && gps.code === 'denied')
  const isGpsReady = gps.status === 'ready'

  return (
    <section>
      <div className="tb-page-head">
        <div className="tb-page-title-group">
          <h1>Quét QR chấm công</h1>
          <p className="tb-page-sub">
            {config?.workshop_address || 'Xưởng may Thiên Bảo'} · Ca {config?.shift_start?.slice(0, 5)} đến{' '}
            {config?.shift_end?.slice(0, 5)} ({config?.allowed_radius_m ?? 100}m)
          </p>
        </div>
      </div>

      <div className="tb-checkin-grid">
        {/* Cột trái: Bắt buộc định vị GPS -> Quét mã QR -> Xác nhận ca */}
        <div className="card tb-qr-card">
          <div className="tb-card-head">
            <div>
              <h2>Xác nhận ca làm</h2>
              <p className="tb-card-desc">
                Nhân viên bắt buộc bật Vị trí GPS tại xưởng và quét bảng mã QR để vào ca / tan ca
              </p>
            </div>
          </div>

          <div className="form" style={{ flex: 1 }}>
            {!workshopPoint && (
              <div className="tb-gps-status warn">
                <span>Quản lý chưa ghim vị trí bản đồ cho xưởng</span>
                {isManager && (
                  <Link to="/qr-setup" className="tb-btn">
                    Cài đặt vị trí
                  </Link>
                )}
              </div>
            )}

            {/* Bước 1 bắt buộc: Trạng thái & Cổng kiểm soát quyền Vị trí GPS */}
            {isGpsBlocked ? (
              <div className="tb-gps-status bad">
                <div>
                  <strong style={{ display: 'block' }}>Bắt buộc cho phép Vị trí GPS để chấm công</strong>
                  <span style={{ fontSize: 12.5 }}>
                    Bấm biểu tượng ổ khoá trên thanh địa chỉ trình duyệt → cho phép <strong>Vị trí</strong> và bật định
                    vị trên điện thoại, sau đó bấm Kiểm tra lại.
                  </span>
                </div>
                <button type="button" onClick={handleEnableGpsClick}>
                  Kiểm tra lại GPS
                </button>
              </div>
            ) : gps.status === 'locating' ? (
              <div className="tb-gps-status">
                <span>Đang lấy vị trí GPS hiện tại…</span>
                <button type="button" onClick={handleEnableGpsClick}>
                  Lấy lại GPS
                </button>
              </div>
            ) : gps.status === 'error' ? (
              <div className="tb-gps-status bad">
                <span>{gps.message}</span>
                <button type="button" onClick={handleEnableGpsClick}>
                  Lấy lại GPS
                </button>
              </div>
            ) : gps.status === 'ready' ? (
              <div
                className={`tb-gps-status ${
                  !distanceInfo || (distanceInfo.withinRadius && distanceInfo.accuracyOk) ? 'ok' : 'bad'
                }`}
              >
                <div>
                  <strong style={{ display: 'block' }}>
                    {!distanceInfo
                      ? `Đã bật GPS (±${gps.accuracy}m)`
                      : distanceInfo.withinRadius && distanceInfo.accuracyOk
                        ? `Đang trong vùng xưởng · Cách ${distanceInfo.meters}m`
                        : !distanceInfo.accuracyOk
                          ? `Độ chính xác GPS thấp (±${gps.accuracy}m, tối đa ±${config?.max_gps_accuracy_m ?? 200}m)`
                          : `Ngoài phạm vi xưởng · Cách ${distanceInfo.meters}m (cho phép ${config?.allowed_radius_m ?? 100}m)`}
                  </strong>
                  <span style={{ fontSize: 12 }}>Sai số định vị hiện tại ±{gps.accuracy}m</span>
                </div>
                <button type="button" onClick={handleEnableGpsClick}>
                  Làm mới GPS
                </button>
              </div>
            ) : (
              <div className="tb-gps-status warn">
                <div>
                  <strong style={{ display: 'block' }}>Bước 1: Cho phép lấy vị trí GPS hiện tại</strong>
                  <span style={{ fontSize: 12.5 }}>
                    Hệ thống yêu cầu xác thực bạn đang đứng tại xưởng trước khi quét mã QR
                  </span>
                </div>
              </div>
            )}

            {/* Nếu chưa cấp GPS thì bắt buộc bấm nút Cho phép GPS trước; có GPS rồi mới mở quét / xác nhận */}
            {!isGpsReady && !isGpsBlocked && gps.status !== 'locating' && (
              <button type="button" className="primary tb-big-btn" onClick={handleEnableGpsClick}>
                <Icon name="check" size={16} />
                <span>Cho phép Vị trí GPS hiện tại</span>
              </button>
            )}

            {/* Bước 2: Nhận mã QR hoặc mở Camera quét mã QR (chỉ mở khi không bị chặn GPS) */}
            {isGpsReady && (
              <>
                {!qrToken ? (
                  <button type="button" className="primary tb-big-btn" onClick={handleRescanClick}>
                    <Icon name="qr" size={16} />
                    <span>{scannerOpen ? 'Đóng máy quét' : 'Mở camera quét mã QR'}</span>
                  </button>
                ) : (
                  <div className="tb-gps-status ok">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <Icon name="check" size={16} />
                      Đã nhận mã QR của xưởng
                    </span>
                    <button type="button" className="link" onClick={handleRescanClick}>
                      {scannerOpen ? 'Đóng máy quét' : 'Quét lại'}
                    </button>
                  </div>
                )}

                {scannerOpen && <QrCameraScanner onDetected={onScannedCode} onClose={() => setScannerOpen(false)} />}

                {qrToken && !scannerOpen && (
                  <button
                    type="button"
                    className="primary tb-big-btn"
                    disabled={
                      submitting ||
                      !workshopPoint ||
                      Boolean(distanceInfo && (!distanceInfo.withinRadius || !distanceInfo.accuracyOk))
                    }
                    onClick={submitAttendance}
                  >
                    <Icon name="check" size={16} />
                    <span>
                      {submitting
                        ? 'Đang ghi nhận…'
                        : openTodaySession
                          ? `Xác nhận Tan ca (vào lúc ${formatTimeVN(openTodaySession.check_in_at)})`
                          : 'Xác nhận Vào ca'}
                    </span>
                  </button>
                )}
              </>
            )}

            {feedback && <p className={feedback.ok ? 'success' : 'error'}>{feedback.text}</p>}
          </div>
        </div>

        {/* Cột phải: Bảng giờ công cá nhân trong tháng */}
        <div className="card tb-qr-card">
          <div className="tb-card-head">
            <div>
              <h2>Giờ công của tôi</h2>
              <p className="tb-card-desc">Tổng hợp ngày đi làm và thời lượng ca đã chốt</p>
            </div>
            <label className="tb-inline-field">
              <span>Tháng</span>
              <input type="month" value={month} max={todayVN().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
            </label>
          </div>

          <div className="tb-stats-2">
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
            <div className="tb-empty">Đang tải lịch sử chấm công…</div>
          ) : logs.error ? (
            <p className="error">{logs.error}</p>
          ) : logs.rows.length === 0 ? (
            <div className="tb-empty">Chưa có lượt chấm công nào trong tháng {month}</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Vào ca</th>
                    <th>Tan ca</th>
                    <th>Định vị</th>
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
                      <td>{r.check_in_distance_m != null ? `${Math.round(r.check_in_distance_m)}m` : 'Thủ công'}</td>
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
        </div>
      </div>
    </section>
  )
}
