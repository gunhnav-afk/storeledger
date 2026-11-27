// Xử lý toạ độ Google Maps, tính khoảng cách GPS Haversine và tính giờ công cho xưởng Thiên Bảo Clothes

export type GeoPoint = { lat: number; lng: number }

const EARTH_RADIUS_M = 6_371_000

const toRad = (deg: number) => (deg * Math.PI) / 180

export function isValidLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

// Khoảng cách đường chim bay (mét) khớp với hàm public.haversine_meters trong Postgres
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Đọc vĩ độ / kinh độ từ chuỗi dán vào:
//  - Toạ độ trực tiếp: "10.762622, 106.660172"
//  - Link Google Maps có pin thật: "...!3d10.762622!4d106.660172" (ưu tiên vì @lat,lng đôi khi chỉ là tâm khung nhìn)
//  - Link query / tâm map: "?q=10.762622,106.660172", "ll=10.762622,106.660172", "@10.762622,106.660172,18z"
export function parseGoogleMapInput(raw: string): { ok: true; point: GeoPoint } | { ok: false; error: string } {
  const text = raw.trim()
  if (!text) return { ok: false, error: 'Dán link Google Maps hoặc toạ độ vĩ độ, kinh độ' }
  if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(text)) {
    return {
      ok: false,
      error: 'Link rút gọn chưa chứa toạ độ. Hãy mở link trên trình duyệt rồi chép thanh địa chỉ đầy đủ hoặc bấm chuột phải chọn toạ độ.',
    }
  }

  let decoded = text
  try {
    decoded = decodeURIComponent(text)
  } catch {
    // Giữ nguyên nếu chuỗi không mã hoá URL
  }

  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|center)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
    /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/,
  ]

  for (const re of patterns) {
    const m = decoded.match(re)
    if (!m) continue
    const lat = Number(m[1])
    const lng = Number(m[2])
    if (isValidLatLng(lat, lng)) {
      return { ok: true, point: { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) } }
    }
  }

  return {
    ok: false,
    error: 'Không tìm thấy toạ độ hợp lệ. Ví dụ đúng: 10.762622, 106.660172 hoặc link Google Maps có @vĩ_độ,kinh_độ.',
  }
}

export function googleMapsEmbedUrl(point: GeoPoint, zoom = 18): string {
  return `https://maps.google.com/maps?q=${point.lat},${point.lng}&z=${zoom}&hl=vi&output=embed`
}

export function googleMapsExternalUrl(point?: GeoPoint | null): string {
  if (!point) return 'https://www.google.com/maps'
  return `https://www.google.com/maps/search/?api=1&query=${point.lat},${point.lng}`
}

// Đổi phút tổng sang chuỗi dễ đọc: 510 -> "8h30p", 480 -> "8h", 45 -> "45p"
export function formatWorkedMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes))
  const h = Math.floor(safe / 60)
  const m = safe % 60
  if (h === 0) return `${m}p`
  if (m === 0) return `${h}h`
  return `${h}h${String(m).padStart(2, '0')}p`
}

// Số giờ dạng thập phân 2 chữ số để tổng hợp / xuất Excel: 510 -> 8.5
export function minutesToHours(minutes: number): number {
  return Math.round((Math.max(0, minutes) / 60) * 100) / 100
}

// Bóc mã token từ nội dung quét QR (chấp nhận cả URL đầy đủ /checkin?k=... hoặc chuỗi token trần)
export function extractQrToken(scanned: string): string | null {
  const raw = scanned.trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    const k = u.searchParams.get('k')?.trim()
    if (k) return k
  } catch {
    // Không phải URL tuyệt đối thì thử đường dẫn tương đối hoặc token trần
  }
  const relMatch = raw.match(/[?&]k=([a-zA-Z0-9_-]+)/)
  if (relMatch?.[1]) return relMatch[1]
  if (/^[a-zA-Z0-9_-]{16,128}$/.test(raw)) return raw
  return null
}

export function currentIsoTimestamp(): string {
  return new Date().toISOString()
}
