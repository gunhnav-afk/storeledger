// Đơn đặt trước (từ trang khách) phía app quản trị: trạng thái, tóm tắt, thông báo đơn mới.
// Đơn đặt trước nằm ở bảng riêng `preorders`, KHÔNG tính vào bán hàng / kho / báo cáo của app.
import { bankName } from './banks'
import type { InvoiceData } from './invoiceImage'
import { transferNote, vietQrUrl } from './storefront'
import type { Preorder, PreorderStatus, Store } from '../types/database'

export const PREORDER_STATUSES: PreorderStatus[] = ['new', 'confirmed', 'paid', 'delivered', 'cancelled']

export const STATUS_LABEL: Record<PreorderStatus, string> = {
  new: 'Mới',
  confirmed: 'Đã nhận đơn',
  paid: 'Đã thanh toán',
  delivered: 'Đã giao',
  cancelled: 'Đã huỷ',
}

// Bước tiếp theo (nút bấm nhanh) theo hình thức thanh toán:
// chuyển khoản: nhận đơn -> đã thanh toán (QR) -> đã giao; tiền mặt: nhận đơn -> đã giao -> thu tiền (đã thanh toán)
const TRANSFER_FLOW: Partial<Record<PreorderStatus, PreorderStatus>> = { new: 'confirmed', confirmed: 'paid', paid: 'delivered' }
const CASH_FLOW: Partial<Record<PreorderStatus, PreorderStatus>> = { new: 'confirmed', confirmed: 'delivered', delivered: 'paid' }

export const nextStatus = (o: Pick<Preorder, 'status' | 'payment'>): PreorderStatus | undefined =>
  (o.payment === 'transfer' ? TRANSFER_FLOW : CASH_FLOW)[o.status]

// Đơn đã xong: huỷ hoặc đi hết luồng (chuyển khoản kết thúc ở "đã giao", tiền mặt kết thúc ở "đã thanh toán")
export const isClosed = (o: Pick<Preorder, 'status' | 'payment'>) => o.status === 'cancelled' || !nextStatus(o)

// Đơn chưa thu tiền: chuyển khoản ở mới/đã nhận; tiền mặt ở mới/đã nhận/đã giao
export const isUnpaidPreorder = (o: Pick<Preorder, 'status' | 'payment'>): boolean => {
  if (o.status === 'cancelled' || o.status === 'paid') return false
  if (o.payment === 'transfer' && o.status === 'delivered') return false
  return true
}

// Chỉ đổi cột payment sang 'transfer' khi đơn chưa giao; đơn tiền mặt đã giao vẫn giữ luồng chờ thu tiền (nextStatus = 'paid')
export const canSwitchToTransfer = (o: Pick<Preorder, 'status' | 'payment'>): boolean =>
  o.payment === 'cash' && (o.status === 'new' || o.status === 'confirmed')

export type StorePaymentInfo = {
  name: string
  phone: string | null
  domain: string | null
  pay: { payload: string; label: string | null; holder: string } | null
  bank: { code: string; account: string; holder: string } | null
}

// Trích thông tin thanh toán từ bảng stores (khớp với logic get_public_menu)
export function storePaymentInfo(
  store: Pick<
    Store,
    'name' | 'public_phone' | 'public_contact_domain' | 'public_qr_payload' | 'public_qr_label' | 'public_bank_code' | 'public_bank_account' | 'public_bank_holder'
  >,
): StorePaymentInfo {
  const pay =
    store.public_qr_payload && store.public_bank_holder
      ? { payload: store.public_qr_payload, label: store.public_qr_label, holder: store.public_bank_holder }
      : null
  const bank =
    store.public_bank_code && store.public_bank_account && store.public_bank_holder
      ? { code: store.public_bank_code, account: store.public_bank_account, holder: store.public_bank_holder }
      : null
  return {
    name: store.name,
    phone: store.public_phone,
    domain: store.public_contact_domain ?? null,
    pay,
    bank,
  }
}

// Dựng dữ liệu hoá đơn PNG (kèm mã QR thanh toán nếu cần) từ một đơn đặt trước trong Sổ Xanh
export function buildPreorderInvoiceData(
  order: Preorder,
  store: StorePaymentInfo,
  opts: { includeQr: boolean; qrDataUrl?: string | null; payAccount?: string | null },
): InvoiceData {
  const total = Number(order.total)
  const memo = transferNote(order.customer_domain, order.floor)
  const qr =
    opts.includeQr && store.pay && opts.qrDataUrl
      ? { dataUrl: opts.qrDataUrl, holder: store.pay.holder, label: store.pay.label ?? '', account: opts.payAccount ?? '', memo }
      : opts.includeQr && !store.pay && store.bank
        ? { dataUrl: vietQrUrl(store.bank, total, memo), holder: store.bank.holder, label: bankName(store.bank.code), account: store.bank.account, memo }
        : null

  return {
    storeName: store.name,
    storePhone: store.phone,
    storeDomain: store.domain,
    code: order.code,
    issuedAt: new Date(order.created_at),
    customer: {
      name: order.customer_name,
      domain: order.customer_domain,
      floor: order.floor,
    },
    lines: order.lines.map((l) => ({
      title: l.title,
      detail: l.detail,
      qty: l.qty,
      unitPrice: Number(l.unit_price),
    })),
    total,
    paymentText: qr || order.payment === 'transfer' ? 'Chuyển khoản' : 'Tiền mặt khi nhận',
    qr,
  }
}

const vnd = (v: number) => `${new Intl.NumberFormat('vi-VN').format(v)}đ`

// Câu thông báo khi có đơn mới
export const preorderAlert = (p: Pick<Preorder, 'code' | 'customer_domain' | 'floor' | 'total'>) =>
  `Đơn đặt trước mới ${p.code}: ${p.customer_domain} (tầng ${p.floor}) · ${vnd(Number(p.total))}`

// Đếm theo trạng thái và tổng tiền các đơn chưa giao, chưa huỷ (để quán chuẩn bị hàng)
export function summarizePreorders(rows: Pick<Preorder, 'status' | 'payment' | 'total'>[]) {
  const counts = Object.fromEntries(PREORDER_STATUSES.map((s) => [s, 0])) as Record<PreorderStatus, number>
  let openTotal = 0
  for (const r of rows) {
    counts[r.status] += 1
    if (!isClosed(r)) openTotal += Number(r.total)
  }
  return { counts, openTotal }
}

// Cộng số hũ / món cần chuẩn bị của các đơn chưa giao, theo tên món (set tính theo mô tả vị)
export function itemsToPrepare(rows: Pick<Preorder, 'status' | 'payment' | 'lines'>[]): { title: string; qty: number }[] {
  const map = new Map<string, number>()
  for (const r of rows) {
    if (r.status === 'delivered' || r.status === 'cancelled' || (r.status === 'paid' && r.payment === 'cash')) continue
    for (const l of r.lines) {
      const key = l.kind === 'set' ? `${l.title} (${l.detail})` : l.title
      map.set(key, (map.get(key) ?? 0) + l.qty)
    }
  }
  return [...map].map(([title, qty]) => ({ title, qty })).sort((a, b) => b.qty - a.qty)
}
