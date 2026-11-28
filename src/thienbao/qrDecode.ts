import jsQR from 'jsqr'

// Giải mã QR từ mảng điểm ảnh RGBA (hoạt động trên mọi trình duyệt PC, Android, iOS)
export function decodeQrFromRgba(data: Uint8ClampedArray, width: number, height: number): string | null {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) return null
  const result = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })
  const value = result?.data?.trim()
  return value ? value : null
}
