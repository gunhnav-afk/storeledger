import { describe, expect, it } from 'vitest'
import { buildBatchEditDrafts, validateBatchEdit } from './batchEdit'
import type { BatchStat } from './analytics/batches'

function sampleBatch(): BatchStat {
  return {
    purchaseId: 'p7',
    date: '2026-11-20',
    note: null,
    paidOn: null,
    lines: [
      { batchLineId: 'b1', productId: 'cc', qty: 17, unitCost: 11000, qtyHome: 17, cost: 187000, sold: 0, disposed: 0, remaining: 17, soldOutDate: null },
      { batchLineId: 'b2', productId: 'tt', qty: 29, unitCost: 9000, qtyHome: 19, cost: 261000, sold: 6, disposed: 0, remaining: 23, soldOutDate: null },
    ],
    totalQty: 46,
    cost: 448000,
    sold: 6,
    soldPct: 6 / 46,
    revenue: 72000,
    cogs: 54000,
    grossProfit: 18000,
    disposed: 0,
    disposedValue: 0,
    remaining: 40,
    remainingValue: 394000,
    recoveryPct: 72000 / 448000,
    recovered: false,
    breakEvenDate: null,
    projectedProfit: 100000,
    soldOutDate: null,
    daysToSellOut: null,
    sellingDay: 1,
    firstOutProductId: null,
    lastOutProductId: null,
  }
}

const names = new Map([
  ['cc', 'Ca cao'],
  ['tt', 'Truyền thống'],
  ['mc', 'Matcha'],
])

describe('batchEdit', () => {
  it('tính minQty từ phần đã bán hoặc chuyển khỏi nhà', () => {
    const drafts = buildBatchEditDrafts(sampleBatch(), names)
    expect(drafts[0].minQty).toBe(0)
    expect(drafts[1].minQty).toBe(10) // 29 - 19
  })

  it('cho giảm Truyền thống từ 29 xuống 20 và tính đúng chênh lệch tổng', () => {
    const drafts = buildBatchEditDrafts(sampleBatch(), names)
    drafts[1].qty = '20'
    const res = validateBatchEdit(drafts, null, '')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.changes).toHaveLength(1)
    expect(res.changes[0]).toMatchObject({ name: 'Truyền thống', oldQty: 29, newQty: 20 })
    expect(res.oldTotalQty).toBe(46)
    expect(res.newTotalQty).toBe(37)
    expect(res.oldTotalCost).toBe(448000)
    expect(res.newTotalCost).toBe(448000 - 9 * 9000)
    expect(res.items.find((i) => i.product_id === 'tt')?.quantity).toBe(20)
  })

  it('chặn giảm thấp hơn phần đã bán hoặc chuyển khỏi nhà', () => {
    const drafts = buildBatchEditDrafts(sampleBatch(), names)
    drafts[1].qty = '9'
    const res = validateBatchEdit(drafts, null, '')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.params).toEqual({ name: 'Truyền thống', min: 10 })
  })

  it('chặn khi toàn bộ dòng đều về 0', () => {
    const drafts = buildBatchEditDrafts(sampleBatch(), names).slice(0, 1)
    drafts[0].qty = '0'
    const res = validateBatchEdit(drafts, null, '')
    expect(res.ok).toBe(false)
  })

  it('cho thêm món mới vào đợt nhập và ghi nhận thay đổi ghi chú', () => {
    const drafts = buildBatchEditDrafts(sampleBatch(), names)
    drafts.push({
      batchId: null,
      productId: 'mc',
      name: 'Matcha',
      originalQty: 0,
      originalUnitCost: 11000,
      minQty: 0,
      qty: '5',
      unitCost: '11000',
    })
    const res = validateBatchEdit(drafts, null, 'Sửa nhầm số lượng')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.noteChanged).toBe(true)
    expect(res.changes).toHaveLength(1)
    expect(res.changes[0]).toMatchObject({ name: 'Matcha', oldQty: 0, newQty: 5 })
    expect(res.newTotalQty).toBe(51)
  })
})
