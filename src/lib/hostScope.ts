// Nhận diện domain ứng dụng: Sổ Xanh (mặc định), Hogi Food (trang khách) và Thiên Bảo Clothes (xưởng may)
export const THIENBAO_ORIGIN = 'https://thienbaoclothes.vercel.app'
export const THIENBAO_BRAND = 'Thiên Bảo Clothes'
export const THIENBAO_SLOGAN = 'Quản lý xưởng may · Chấm công QR'

const DEV_SCOPE_KEY = 'web-nhap-lieu.dev-domain'
const RETURN_URL_KEY = 'web-nhap-lieu.return-to'

const isLocalHost = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost')

// Trên localhost có thể mở ?domain=thienbao để kiểm thử giao diện Thiên Bảo Clothes, ?domain=soxanh để quay lại Sổ Xanh
export function isThienBaoHost(
  hostname: string,
  search = typeof window !== 'undefined' ? window.location.search : '',
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null,
): boolean {
  if (/thienbao/i.test(hostname)) return true
  if (!isLocalHost(hostname)) return false
  const store = storage === undefined ? (typeof window !== 'undefined' ? window.sessionStorage : null) : storage
  try {
    const q = new URLSearchParams(search).get('domain')?.toLowerCase()
    if (q === 'thienbao') {
      store?.setItem(DEV_SCOPE_KEY, 'thienbao')
      return true
    }
    if (q === 'soxanh') {
      store?.removeItem(DEV_SCOPE_KEY)
      return false
    }
    return store?.getItem(DEV_SCOPE_KEY) === 'thienbao'
  } catch {
    return false
  }
}

// Giữ nguyên đường dẫn có query (vd: /checkin?k=...) qua bước đăng nhập Google OAuth hoặc Email
export function savePendingReturnUrl(pathWithSearch: string): void {
  if (!pathWithSearch || pathWithSearch === '/' || pathWithSearch.startsWith('/login')) return
  try {
    window.sessionStorage.setItem(RETURN_URL_KEY, pathWithSearch)
  } catch {
    // Bỏ qua khi trình duyệt khoá sessionStorage
  }
}

export function consumePendingReturnUrl(): string | null {
  try {
    const saved = window.sessionStorage.getItem(RETURN_URL_KEY)
    if (!saved) return null
    window.sessionStorage.removeItem(RETURN_URL_KEY)
    return saved.startsWith('/') && !saved.startsWith('//') ? saved : null
  } catch {
    return null
  }
}
