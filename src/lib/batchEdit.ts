import { MAX_MONEY, MAX_QTY } from './format'
import type { BatchStat } from './analytics/batches'
import type { UpdatePurchaseBatchItemInput } from '../types/database'

export type BatchEditDraft = {
  batchId: string | null
  productId: string
  name: string
  originalQty: number
  originalUnitCost: number
  // Số hũ tối thiểu không thể giảm thấp hơn (đã chuyển khỏi nhà, đã bán hoặc đã huỷ)
  minQty: number
  qty: string
  unitCost: string
}

export type BatchEditChange = {
  productId: string
  name: string
  oldQty: number
  newQty: number
  oldUnitCost: number
  newUnitCost: number
}

export type BatchEditValidation =
  | {
      ok: true
      items: UpdatePurchaseBatchItemInput[]
      changes: BatchEditChange[]
      noteChanged: boolean
      newNote: string
      oldTotalQty: number
      newTotalQty: number
      oldTotalCost: number
      newTotalCost: number
    }
  | {
      ok: false
      error: string
      params?: Record<string, string | number>
    }

export function buildBatchEditDrafts(batch: BatchStat, names: Map<string, string>): BatchEditDraft[] {
  return batch.lines.map((line) => ({
    batchId: line.batchLineId,
    productId: line.productId,
    name: names.get(line.productId) ?? '',
    originalQty: line.qty,
    originalUnitCost: line.unitCost,
    minQty: Math.max(0, line.qty - line.qtyHome),
    qty: String(line.qty),
    unitCost: String(line.unitCost),
  }))
}

export function validateBatchEdit(
  drafts: BatchEditDraft[],
  originalNote: string | null,
  draftNote: string,
): BatchEditValidation {
  const items: UpdatePurchaseBatchItemInput[] = []
  const changes: BatchEditChange[] = []
  let oldTotalQty = 0
  let newTotalQty = 0
  let oldTotalCost = 0
  let newTotalCost = 0
  let keptLines = 0

  for (const d of drafts) {
    const qtyRaw = d.qty.trim()
    const qty = qtyRaw === '' ? 0 : Number(qtyRaw)
    if (!Number.isInteger(qty) || qty < 0) {
      return { ok: false, error: 'Số lượng của "{name}" phải là số nguyên ≥ 0', params: { name: d.name } }
    }
    if (qty > MAX_QTY) {
      return { ok: false, error: 'Số lượng của "{name}" quá lớn, kiểm tra lại', params: { name: d.name } }
    }
    if (qty < d.minQty) {
      return {
        ok: false,
        error: 'Không thể giảm "{name}" dưới {min} hũ (đã chuyển khỏi nhà hoặc bán/huỷ)',
        params: { name: d.name, min: d.minQty },
      }
    }

    const costRaw = d.unitCost.trim()
    const unitCost = costRaw === '' ? Number.NaN : Number(costRaw)
    if (qty > 0 && (!Number.isFinite(unitCost) || unitCost < 0)) {
      return { ok: false, error: 'Giá nhập của "{name}" không hợp lệ', params: { name: d.name } }
    }
    if (qty > 0 && unitCost > MAX_MONEY) {
      return { ok: false, error: 'Giá nhập của "{name}" quá lớn, kiểm tra lại', params: { name: d.name } }
    }
    const safeCost = qty === 0 ? d.originalUnitCost : unitCost

    oldTotalQty += d.originalQty
    oldTotalCost += d.originalQty * d.originalUnitCost
    newTotalQty += qty
    newTotalCost += qty * safeCost
    if (qty > 0) keptLines += 1

    // Chỉ gửi dòng vốn đã tồn tại hoặc dòng mới có số lượng > 0
    if (d.batchId !== null || qty > 0) {
      items.push({
        batch_id: d.batchId,
        product_id: d.productId,
        quantity: qty,
        unit_cost: safeCost,
      })
    }

    if (qty !== d.originalQty || (qty > 0 && safeCost !== d.originalUnitCost)) {
      changes.push({
        productId: d.productId,
        name: d.name,
        oldQty: d.originalQty,
        newQty: qty,
        oldUnitCost: d.originalUnitCost,
        newUnitCost: safeCost,
      })
    }
  }

  if (keptLines === 0) {
    return { ok: false, error: 'Đợt nhập phải có ít nhất một sản phẩm' }
  }

  const prevNote = (originalNote ?? '').trim()
  const newNote = draftNote.trim()
  const noteChanged = prevNote !== newNote

  return {
    ok: true,
    items,
    changes,
    noteChanged,
    newNote,
    oldTotalQty,
    newTotalQty,
    oldTotalCost,
    newTotalCost,
  }
}
