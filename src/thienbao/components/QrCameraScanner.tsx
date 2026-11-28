import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { decodeQrFromRgba } from '../qrDecode'

type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap) => Promise<{ rawValue?: string }[]>
}

type BarcodeDetectorStatic = {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats?: () => Promise<string[]>
}

async function createNativeQrDetector(): Promise<BarcodeDetectorLike | null> {
  if (typeof window === 'undefined') return null
  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorStatic }).BarcodeDetector
  if (!Ctor) return null
  try {
    if (typeof Ctor.getSupportedFormats === 'function') {
      const formats = await Ctor.getSupportedFormats()
      if (!formats.includes('qr_code')) return null
    }
    return new Ctor({ formats: ['qr_code'] })
  } catch {
    return null
  }
}

async function openCameraStream(facingMode: 'environment' | 'user', deviceId: string | null): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = deviceId
    ? [
        { video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
        { video: { deviceId: { exact: deviceId } }, audio: false },
        { video: true, audio: false },
      ]
    : [
        { video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
        { video: { facingMode }, audio: false },
        { video: true, audio: false },
      ]

  let lastError: unknown = null
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (err) {
      lastError = err
      const name = (err as { name?: string } | null)?.name ?? ''
      // Nếu người dùng từ chối quyền Camera thì dừng ngay, không gọi lặp lại hộp thoại
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        throw err
      }
    }
  }
  throw lastError ?? new Error('Không mở được thiết bị camera')
}

function describeCameraError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'Trình duyệt đang chặn quyền Camera. Hãy bấm biểu tượng ổ khoá trên thanh địa chỉ để cho phép Camera rồi bấm Thử lại (hoặc chọn ảnh QR bên dưới).'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'Không tìm thấy camera trên thiết bị này. Bạn có thể bấm Chọn ảnh QR bên dưới để tải ảnh chụp mã QR.'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Camera đang bận bởi ứng dụng khác. Hãy đóng ứng dụng đang dùng camera rồi bấm Thử lại.'
  }
  return 'Không mở được camera trực tiếp trên trình duyệt này. Hãy bấm Thử lại hoặc chọn ảnh chụp mã QR bên dưới.'
}

function hasGetUserMedia(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
}

// Máy quét QR đa nền tảng (PC + Android + iOS): kết hợp BarcodeDetector phần cứng và jsQR trên Canvas
export function QrCameraScanner({
  onDetected,
  onClose,
}: {
  onDetected: (value: string) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const onDetectedRef = useRef(onDetected)

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [cameraIdx, setCameraIdx] = useState<number | null>(null)
  const [retryTick, setRetryTick] = useState(0)
  const [starting, setStarting] = useState(() => hasGetUserMedia())
  const [camError, setCamError] = useState<string | null>(() =>
    hasGetUserMedia()
      ? null
      : 'Trình duyệt hiện tại không cấp API Camera. Hãy bấm Chụp / Chọn ảnh QR bên dưới để quét từ ảnh chụp.',
  )
  const [photoError, setPhotoError] = useState<string | null>(null)

  useEffect(() => {
    onDetectedRef.current = onDetected
  }, [onDetected])

  const selectedDeviceId = cameraIdx !== null && cameras[cameraIdx] ? cameras[cameraIdx].deviceId : null

  useEffect(() => {
    if (!hasGetUserMedia()) return

    let cancelled = false
    let stream: MediaStream | null = null
    let timerId: number | undefined
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    async function start() {
      try {
        const [openedStream, nativeDetector] = await Promise.all([
          openCameraStream(facingMode, selectedDeviceId),
          createNativeQrDetector(),
        ])

        if (cancelled) {
          openedStream.getTracks().forEach((t) => t.stop())
          return
        }
        stream = openedStream

        if (navigator.mediaDevices.enumerateDevices) {
          navigator.mediaDevices
            .enumerateDevices()
            .then((devices) => {
              if (cancelled) return
              const videoInputs = devices.filter((d) => d.kind === 'videoinput' && d.deviceId)
              setCameras(videoInputs)
            })
            .catch(() => {})
        }

        const video = videoRef.current
        if (!video) return
        video.srcObject = stream

        if (video.readyState < 1) {
          await new Promise<void>((resolve) => {
            const done = () => {
              video.removeEventListener('loadedmetadata', done)
              resolve()
            }
            video.addEventListener('loadedmetadata', done, { once: true })
            window.setTimeout(done, 1200)
          })
        }

        if (cancelled) return
        try {
          await video.play()
        } catch {
          // autoPlay + muted + playsInline tự phát trên mobile; bỏ qua AbortError trung gian
        }
        if (cancelled) return
        setStarting(false)

        const scanFrame = async () => {
          if (cancelled || !videoRef.current) return
          const v = videoRef.current
          if (v.readyState >= v.HAVE_CURRENT_DATA && v.videoWidth > 0 && v.videoHeight > 0) {
            if (nativeDetector) {
              try {
                const codes = await nativeDetector.detect(v)
                const found = codes[0]?.rawValue?.trim()
                if (found) {
                  stream?.getTracks().forEach((t) => t.stop())
                  onDetectedRef.current(found)
                  return
                }
              } catch {
                // Chuyển tiếp sang giải mã jsQR trên canvas
              }
            }

            if (ctx) {
              const maxSide = 640
              const scale = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight))
              const w = Math.max(1, Math.round(v.videoWidth * scale))
              const h = Math.max(1, Math.round(v.videoHeight * scale))
              if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w
                canvas.height = h
              }
              ctx.drawImage(v, 0, 0, w, h)
              const imgData = ctx.getImageData(0, 0, w, h)
              const decoded = decodeQrFromRgba(imgData.data, w, h)
              if (decoded) {
                stream?.getTracks().forEach((t) => t.stop())
                onDetectedRef.current(decoded)
                return
              }
            }
          }
          timerId = window.setTimeout(scanFrame, 180)
        }

        timerId = window.setTimeout(scanFrame, 200)
      } catch (err) {
        if (stream) {
          stream.getTracks().forEach((t) => t.stop())
          stream = null
        }
        if (!cancelled) {
          setStarting(false)
          setCamError(describeCameraError(err))
        }
      }
    }

    start()

    return () => {
      cancelled = true
      if (timerId !== undefined) window.clearTimeout(timerId)
      if (stream) stream.getTracks().forEach((t) => t.stop())
    }
  }, [facingMode, selectedDeviceId, retryTick])

  const switchCamera = useCallback(() => {
    setPhotoError(null)
    setCamError(null)
    setStarting(true)
    if (cameras.length > 1) {
      setCameraIdx((prev) => ((prev ?? 0) + 1) % cameras.length)
    } else {
      setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
    }
  }, [cameras.length])

  const retryCamera = useCallback(() => {
    setPhotoError(null)
    setCamError(null)
    setStarting(true)
    setRetryTick((n) => n + 1)
  }, [])

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhotoError(null)

    try {
      const bitmap = await createImageBitmap(file)
      const maxSide = 1024
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
      const w = Math.max(1, Math.round(bitmap.width * scale))
      const h = Math.max(1, Math.round(bitmap.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('Không đọc được ảnh')
      ctx.drawImage(bitmap, 0, 0, w, h)
      bitmap.close()

      const imgData = ctx.getImageData(0, 0, w, h)
      const decoded = decodeQrFromRgba(imgData.data, w, h)
      if (decoded) {
        onDetectedRef.current(decoded)
        return
      }

      const detector = await createNativeQrDetector()
      if (detector) {
        const codes = await detector.detect(canvas)
        const found = codes[0]?.rawValue?.trim()
        if (found) {
          onDetectedRef.current(found)
          return
        }
      }

      setPhotoError('Không tìm thấy mã QR rõ nét trong ảnh vừa chọn. Hãy chụp gần và rõ hơn.')
    } catch {
      setPhotoError('Không đọc được tệp ảnh này. Vui lòng thử chụp lại.')
    }
  }

  return (
    <div className="tb-scanner-panel">
      <div className="tb-toolbar" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 13.5 }}>Đưa mã QR tại xưởng vào khung hình</strong>
        <button type="button" className="tb-ghost" onClick={onClose}>
          Đóng
        </button>
      </div>

      {camError ? (
        <p className="error" style={{ marginBottom: 12 }}>
          {camError}
        </p>
      ) : (
        <div className="tb-scanner-box">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='340' height='340'%3E%3Crect width='100%25' height='100%25' fill='%230e1014'/%3E%3C/svg%3E"
            className="tb-scanner-video"
          />
          <div className="tb-scanner-guide" aria-hidden="true" />
          {starting && <div className="tb-scanner-status">Đang kết nối camera…</div>}
        </div>
      )}

      {photoError && (
        <p className="error" style={{ marginTop: 8 }}>
          {photoError}
        </p>
      )}

      <div className="tb-scanner-actions">
        {camError ? (
          <button type="button" onClick={retryCamera}>
            <span>Thử mở lại camera</span>
          </button>
        ) : (
          <button type="button" onClick={switchCamera}>
            <span>Đổi camera</span>
          </button>
        )}
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          <Icon name="qr" size={16} />
          <span>Chọn ảnh QR</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onPickImage}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  )
}
