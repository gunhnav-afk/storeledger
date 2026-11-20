import { describe, expect, it } from 'vitest'
import {
  buildPreorderInvoiceData,
  canSwitchToTransfer,
  isClosed,
  isUnpaidPreorder,
  itemsToPrepare,
  nextStatus,
  preorderAlert,
  storePaymentInfo,
  summarizePreorders,
} from './preorders'
import type { Preorder } from '../types/database'

describe('đơn đặt trước phía quản trị', () => {
  const rows = [
    { status: 'new' as const, payment: 'transfer' as const, total: 115000, lines: [{ kind: 'set' as const, title: 'Set 4 hũ', detail: '2 Phô mai + 2 Truyền thống', qty: 1, unit_price: 55000 }, { kind: 'single' as const, title: 'Hũ làm quen 110gr', detail: 'Bán lẻ', qty: 2, unit_price: 30000 }] },
    { status: 'paid' as const, payment: 'transfer' as const, total: 30000, lines: [{ kind: 'single' as const, title: 'Hũ làm quen 110gr', detail: 'Bán lẻ', qty: 1, unit_price: 30000 }] },
    { status: 'delivered' as const, payment: 'transfer' as const, total: 50000, lines: [{ kind: 'set' as const, title: 'Set 4 hũ', detail: '4 Truyền thống', qty: 1, unit_price: 50000 }] },
    { status: 'cancelled' as const, payment: 'transfer' as const, total: 999, lines: [] },
  ]
  it('đếm theo trạng thái, tổng tiền đơn đang mở (chưa giao, chưa huỷ)', () => {
    const s = summarizePreorders(rows)
    expect(s.counts).toEqual({ new: 1, confirmed: 0, paid: 1, delivered: 1, cancelled: 1 })
    expect(s.openTotal).toBe(145000)
  })
  it('món cần chuẩn bị chỉ tính đơn chưa giao', () => {
    expect(itemsToPrepare(rows)).toEqual([{ title: 'Hũ làm quen 110gr', qty: 3 }, { title: 'Set 4 hũ (2 Phô mai + 2 Truyền thống)', qty: 1 }])
  })
  it('luồng trạng thái theo hình thức thanh toán', () => {
    expect(nextStatus({ status: 'confirmed', payment: 'transfer' })).toBe('paid')
    expect(nextStatus({ status: 'paid', payment: 'transfer' })).toBe('delivered')
    expect(nextStatus({ status: 'confirmed', payment: 'cash' })).toBe('delivered')
    expect(nextStatus({ status: 'delivered', payment: 'cash' })).toBe('paid')
    expect(isClosed({ status: 'delivered', payment: 'cash' })).toBe(false)
    expect(isClosed({ status: 'paid', payment: 'cash' })).toBe(true)
    expect(isClosed({ status: 'delivered', payment: 'transfer' })).toBe(true)
  })
  it('câu thông báo đơn mới', () => {
    expect(preorderAlert({ code: 'HG26298ABCD', customer_domain: 'huong.vu3', floor: '6', total: 115000 })).toBe('Đơn đặt trước mới HG26298ABCD: huong.vu3 (tầng 6) · 115.000đ')
    expect(preorderAlert({ code: 'HG26298ZXA', customer_domain: 'hung.nguyen26', floor: '11', total: 80000 })).toBe('Đơn đặt trước mới HG26298ZXA: hung.nguyen26 (tầng 11) · 80.000đ')
  })
  it('nhận diện đơn chưa thanh toán và đơn tiền mặt đổi được sang chuyển khoản', () => {
    expect(isUnpaidPreorder({ status: 'new', payment: 'transfer' })).toBe(true)
    expect(isUnpaidPreorder({ status: 'confirmed', payment: 'transfer' })).toBe(true)
    expect(isUnpaidPreorder({ status: 'paid', payment: 'transfer' })).toBe(false)
    expect(isUnpaidPreorder({ status: 'delivered', payment: 'transfer' })).toBe(false)
    expect(isUnpaidPreorder({ status: 'new', payment: 'cash' })).toBe(true)
    expect(isUnpaidPreorder({ status: 'confirmed', payment: 'cash' })).toBe(true)
    expect(isUnpaidPreorder({ status: 'delivered', payment: 'cash' })).toBe(true)
    expect(isUnpaidPreorder({ status: 'paid', payment: 'cash' })).toBe(false)
    expect(isUnpaidPreorder({ status: 'cancelled', payment: 'cash' })).toBe(false)

    expect(canSwitchToTransfer({ status: 'new', payment: 'cash' })).toBe(true)
    expect(canSwitchToTransfer({ status: 'confirmed', payment: 'cash' })).toBe(true)
    expect(canSwitchToTransfer({ status: 'delivered', payment: 'cash' })).toBe(false)
    expect(canSwitchToTransfer({ status: 'paid', payment: 'cash' })).toBe(false)
    expect(canSwitchToTransfer({ status: 'confirmed', payment: 'transfer' })).toBe(false)
  })
  it('trích thông tin thanh toán của cửa hàng và dựng dữ liệu hoá đơn kèm QR', () => {
    const info = storePaymentInfo({
      name: 'Hogi Food',
      public_phone: '0901234567',
      public_contact_domain: 'huong.vu3',
      public_qr_payload: '000201010211',
      public_qr_label: 'MoMo',
      public_bank_code: 'TCB',
      public_bank_account: '1900123456',
      public_bank_holder: 'NGUYEN VAN A',
    })
    expect(info.pay).toEqual({ payload: '000201010211', label: 'MoMo', holder: 'NGUYEN VAN A' })
    expect(info.bank).toEqual({ code: 'TCB', account: '1900123456', holder: 'NGUYEN VAN A' })

    const order: Preorder = {
      id: 'o1',
      store_id: 's1',
      code: 'HG26298ABCD',
      customer_name: 'huong.vu3',
      customer_domain: 'huong.vu3',
      floor: '6',
      payment: 'cash',
      lines: [{ kind: 'set', title: 'Set 4 hũ', detail: '4 Truyền thống', qty: 2, unit_price: 50000 }],
      total: 100000,
      status: 'delivered',
      created_at: '2026-11-20T07:30:00Z',
      updated_at: '2026-11-20T07:35:00Z',
    }

    const withQr = buildPreorderInvoiceData(order, info, { includeQr: true, qrDataUrl: 'data:image/png;base64,AAA', payAccount: 'PSG001' })
    expect(withQr.paymentText).toBe('Chuyển khoản')
    expect(withQr.qr).toEqual({ dataUrl: 'data:image/png;base64,AAA', holder: 'NGUYEN VAN A', label: 'MoMo', account: 'PSG001', memo: 'huong.vu3 - F6' })

    const withoutQr = buildPreorderInvoiceData(order, info, { includeQr: false })
    expect(withoutQr.paymentText).toBe('Tiền mặt khi nhận')
    expect(withoutQr.qr).toBeNull()

    const bankOnly = { ...info, pay: null }
    const withVietQr = buildPreorderInvoiceData(order, bankOnly, { includeQr: true })
    expect(withVietQr.qr?.account).toBe('1900123456')
    expect(withVietQr.qr?.dataUrl).toContain('img.vietqr.io/image/TCB-1900123456-compact2.png')
  })
})
