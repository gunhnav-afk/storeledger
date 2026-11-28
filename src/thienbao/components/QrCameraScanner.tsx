import { useEffect, useRef, useState } from 'react'

type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement | ImageBitmap) => Promise<{ rawValue?: string }[]>
}

type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike

function getDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }
  return w.BarcodeDetector ?? null
}

// Khung quét mã QR trực tiếp bằng camera sau trên trình duyệt hỗ trợ BarcodeDetector
export function QrCameraScanner({
  onDetected,
  onClose,
}: {
  onDetected: (value: string) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [camError, setCamError] = useState<string | null>(null)
  const supported = Boolean(getDetectorCtor())

  useEffect(() => {
    const Ctor = getDetectorCtor()
    if (!Ctor) return
    let cancelled = false
    let stream: MediaStream | null = null
    let timerId: number | undefined

    async function start() {
      try {
        const detector = new Ctor!({ formats: ['qr_code'] })
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()

        const tick = async () => {
          if (cancelled || !videoRef.current) return
          if (videoRef.current.readyState >= videoRef.current.HAVE_ENOUGH_DATA) {
            try {
              const codes = await detector.detect(videoRef.current)
              const found = codes[0]?.rawValue?.trim()
              if (found) {
                onDetected(found)
                return
              }
            } catch {
              // Bỏ qua khung hình chưa rõ nét
            }
          }
          timerId = window.setTimeout(tick, 220)
        }
        timerId = window.setTimeout(tick, 250)
      } catch {
        if (!cancelled) {
          setCamError('Không mở được camera. Hãy cấp quyền Camera hoặc dùng trực tiếp ứng dụng Camera / Zalo trên điện thoại.')
        }
      }
    }

    start()
    return () => {
      cancelled = true
      if (timerId !== undefined) window.clearTimeout(timerId)
      if (stream) stream.getTracks().forEach((t) => t.stop())
    }
  }, [onDetected])

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <div className="tb-toolbar" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 13.5 }}>Đưa mã QR tại xưởng vào khung hình</strong>
        <button type="button" className="tb-ghost" onClick={onClose}>
          Đóng
        </button>
      </div>
      {!supported ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Trình duyệt này chưa hỗ trợ quét trực tiếp trong trang. Bạn hãy mở ứng dụng <strong>Camera</strong> hoặc{' '}
          <strong>Zalo</strong> trên điện thoại và quét thẳng bảng QR dán ở xưởng.
        </p>
      ) : camError ? (
        <p className="error">{camError}</p>
      ) : (
        <div className="tb-scanner-box">
          <video
            ref={videoRef}
            muted
            playsInline
            poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='340' height='340'%3E%3Crect width='100%25' height='100%25' fill='%230e1014'/%3E%3C/svg%3E"
            className="tb-scanner-video"
          />
        </div>
      )}
    </div>
  )
}
