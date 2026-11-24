import { useEffect, useState } from 'react'
import { Calendar } from '../components/DatePicker'
import { QtyStepper } from '../components/ProductPicker'
import { useStore } from '../lib/store'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { useConfirm } from '../lib/confirm'
import { supabase } from '../lib/supabase'
import { errorMessage, formatDate, formatVND, todayVN } from '../lib/format'
import { batchStats, type BatchStat } from '../lib/analytics/batches'
import { buildBatchEditDrafts, validateBatchEdit, type BatchEditDraft } from '../lib/batchEdit'
import { useAnalyticsData } from '../lib/useAnalyticsData'

const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1).replace('.', ',')}%`)

export function BatchStatsPage() {
  const { current } = useStore()
  return current ? <BatchStats key={current.id} storeId={current.id} /> : null
}

// Chỉ admin: thống kê theo đợt nhập (mỗi purchase là một đợt), chỉ món đếm tồn
function BatchStats({ storeId }: { storeId: string }) {
  const { t } = useI18n()
  const { loading, error, data, reload } = useAnalyticsData(storeId)
  // Ngày thanh toán vừa sửa trên trang (ghi đè dữ liệu đã tải, khỏi tải lại cả báo cáo)
  const [paidOverride, setPaidOverride] = useState<Record<string, string | null>>({})
  // Đợt đang mở hộp thoại thanh toán (index để hiện "Đợt n")
  const [paying, setPaying] = useState<{ batch: BatchStat; index: number } | null>(null)
  // Đợt đang mở hộp thoại chỉnh sửa số lượng / giá vốn / ghi chú
  const [editing, setEditing] = useState<{ batch: BatchStat; index: number } | null>(null)

  if (loading) return <p className="muted">{t('Đang tải…')}</p>
  if (error) return <p className="error">{t(error)}</p>
  if (!data) return null

  const stats = batchStats(data.input, data.allocations, data.currentPrice, data.today)
  const { totals } = stats
  const batches = stats.batches.map((b) => (b.purchaseId in paidOverride ? { ...b, paidOn: paidOverride[b.purchaseId] } : b))
  if (batches.length === 0) {
    return <p className="pos-empty muted">{t('Chưa có đợt nhập nào. Nhập hàng ở Kho hàng → Nhập hàng.')}</p>
  }

  const names = new Map(data.input.products.map((p) => [p.id, p.name]))
  const stockedProducts = data.input.products.filter((p) => p.tracksStock)
  // Giá vốn gần nhất từng món (gợi ý sẵn nếu admin thêm món mới vào đợt đang sửa)
  const latestUnitCost = new Map<string, number>()
  for (const line of data.input.batchLines) {
    latestUnitCost.set(line.productId, line.unitCost)
  }
  // Cột "ngày hết" cho mỗi loại có xuất hiện trong ít nhất một đợt
  const productIds = data.input.products
    .filter((p) => batches.some((b) => b.lines.some((l) => l.productId === p.id)))
    .map((p) => p.id)

  const unpaidCost = batches.filter((b) => !b.paidOn).reduce((sum, b) => sum + b.cost, 0)
  const money = (v: number) => <span className={v < 0 ? 'negative' : undefined}>{formatVND(v)}</span>
  const status = (b: BatchStat) =>
    b.recovered ? (
      <span className="badge badge-ok">{t('Đã hoàn vốn')}</span>
    ) : (
      <span className="badge badge-low">{t('Chưa hoàn vốn')}</span>
    )
  const payment = (b: BatchStat, index: number) => (
    <div className="payment-cell">
      {b.paidOn ? (
        <span className="badge badge-ok">{t('Đã thanh toán')}</span>
      ) : (
        <span className="badge badge-low">{t('Chưa thanh toán')}</span>
      )}
      <button
        type="button"
        className={b.paidOn ? 'payment-btn' : 'payment-btn primary'}
        onClick={() => setPaying({ batch: b, index })}
      >
        {b.paidOn ? t('Sửa') : t('Thanh toán')}
      </button>
    </div>
  )
  const soldOut = (b: BatchStat) =>
    b.soldOutDate ? formatDate(b.soldOutDate) : t('Đang bán – ngày thứ {n}', { n: b.sellingDay ?? 0 })
  const notOut = (b: BatchStat) =>
    b.lines
      .filter((l) => l.remaining > 0)
      .map((l) => t('{name}: còn {count}', { name: names.get(l.productId) ?? '', count: l.remaining }))

  return (
    <section>
      <p className="muted section-note">
        {t('Mỗi đợt nhập là một dòng. Hũ bán được gán cho đợt cũ trước (FIFO); doanh thu là doanh thu thuần theo giá lúc bán.')}
      </p>
      {paying && (
        <PaymentDialog
          batch={paying.batch}
          index={paying.index}
          onClose={() => setPaying(null)}
          onSaved={(id, paidOn) => {
            setPaidOverride((m) => ({ ...m, [id]: paidOn }))
            setPaying(null)
          }}
        />
      )}
      {editing && (
        <EditBatchDialog
          batch={editing.batch}
          index={editing.index}
          names={names}
          stockedProducts={stockedProducts}
          latestUnitCost={latestUnitCost}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
      <div className="stats">
        <div className="stat">
          <div className="stat-label">{t('Lãi gộp')}</div>
          <div className="stat-value">{money(totals.grossProfit)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{t('Trừ chi phí')}</div>
          <div className="stat-value">{money(-totals.expenses)}</div>
        </div>
        {totals.disposedValue > 0 && (
          <div className="stat">
            <div className="stat-label">{t('Trừ hàng huỷ')}</div>
            <div className="stat-value">{money(-totals.disposedValue)}</div>
          </div>
        )}
        <div className="stat">
          <div className="stat-label">{t('Lợi nhuận ròng tất cả các đợt')}</div>
          <div className="stat-value">{money(totals.netProfit)}</div>
          {unpaidCost > 0 && <div className="stat-sub">{t('Chưa trả: {value}', { value: formatVND(unpaidCost) })}</div>}
        </div>
      </div>
      <div className="table-wrap batch-wrap">
        <table className="batch-table">
          <thead>
            <tr>
              <th className="sticky-col">{t('Đợt nhập')}</th>
              <th className="num">{t('Tổng hũ')}</th>
              {productIds.map((id) => (
                <th key={id} className="num">
                  {t('Nhập: {name}', { name: names.get(id) ?? '' })}
                </th>
              ))}
              <th className="num">{t('Vốn nhập')}</th>
              <th>{t('Thanh toán')}</th>
              <th>{t('Ngày thanh toán')}</th>
              <th className="num">{t('Đã bán')}</th>
              <th className="num">{t('% đã bán')}</th>
              <th className="num">{t('Doanh thu')}</th>
              <th className="num">{t('Giá vốn hàng bán')}</th>
              <th className="num">{t('Lãi gộp')}</th>
              <th className="num">{t('Đã huỷ')}</th>
              <th className="num">{t('Giá trị huỷ')}</th>
              <th className="num">{t('Còn tồn')}</th>
              <th className="num">{t('Giá trị tồn')}</th>
              <th className="num">{t('% vốn thu hồi')}</th>
              <th>{t('Trạng thái')}</th>
              <th>{t('Ngày hoà vốn')}</th>
              <th className="num">{t('Lãi/lỗ nếu bán hết')}</th>
              <th>{t('Ngày hết cả đợt')}</th>
              <th className="num">{t('Số ngày bán hết')}</th>
              <th>{t('Loại hết trước')}</th>
              <th>{t('Loại hết sau cùng')}</th>
              <th>{t('Loại còn chưa hết')}</th>
              {productIds.map((id) => (
                <th key={id}>{t('Hết: {name}', { name: names.get(id) ?? '' })}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batches.map((b, i) => (
              <tr key={b.purchaseId}>
                <td className="sticky-col">
                  <div className="batch-col-head">
                    <strong>{t('Đợt {n}', { n: i + 1 })}</strong>
                    <button
                      type="button"
                      className="batch-edit-btn"
                      onClick={() => setEditing({ batch: b, index: i })}
                      aria-label={t('Sửa đợt {n}', { n: i + 1 })}
                    >
                      {t('Sửa')}
                    </button>
                  </div>
                  <small className="batch-date">{formatDate(b.date)}</small>
                  {b.note && <small className="muted batch-date">{b.note}</small>}
                </td>
                <td className="num">{b.totalQty}</td>
                {productIds.map((id) => (
                  <td key={id} className="num">
                    {b.lines.find((l) => l.productId === id)?.qty ?? '—'}
                  </td>
                ))}
                <td className="num">{formatVND(b.cost)}</td>
                <td>{payment(b, i)}</td>
                <td>{b.paidOn ? formatDate(b.paidOn) : '—'}</td>
                <td className="num">{b.sold}</td>
                <td className="num">{pct(b.soldPct)}</td>
                <td className="num">{formatVND(b.revenue)}</td>
                <td className="num">{formatVND(b.cogs)}</td>
                <td className="num">{money(b.grossProfit)}</td>
                <td className="num">{b.disposed || '—'}</td>
                <td className="num">{b.disposedValue ? money(-b.disposedValue) : '—'}</td>
                <td className="num">{b.remaining}</td>
                <td className="num">{formatVND(b.remainingValue)}</td>
                <td className="num">{pct(b.recoveryPct)}</td>
                <td>{status(b)}</td>
                <td>{b.breakEvenDate ? formatDate(b.breakEvenDate) : '—'}</td>
                <td className="num">{money(b.projectedProfit)}</td>
                <td>{soldOut(b)}</td>
                <td className="num">{b.daysToSellOut ?? '—'}</td>
                <td>{b.firstOutProductId ? names.get(b.firstOutProductId) : '—'}</td>
                <td>{b.lastOutProductId ? names.get(b.lastOutProductId) : '—'}</td>
                <td className="wrap-cell">
                  {notOut(b).length > 0 ? notOut(b).map((text) => <div key={text}>{text}</div>) : '—'}
                </td>
                {productIds.map((id) => {
                  const line = b.lines.find((l) => l.productId === id)
                  return (
                    <td key={id}>
                      {!line ? '' : line.soldOutDate ? formatDate(line.soldOutDate) : t('Còn {count} hũ', { count: line.remaining })}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="total-row">
              <td className="sticky-col">{t('Tổng cộng')}</td>
              <td className="num">{totals.totalQty}</td>
              {productIds.map((id) => (
                <td key={id} className="num">
                  {batches.reduce((sum, b) => sum + (b.lines.find((l) => l.productId === id)?.qty ?? 0), 0)}
                </td>
              ))}
              <td className="num">{formatVND(totals.cost)}</td>
              <td colSpan={2} className="muted">
                {unpaidCost > 0 ? t('Chưa trả: {value}', { value: formatVND(unpaidCost) }) : ''}
              </td>
              <td className="num">{totals.sold}</td>
              <td className="num">{pct(totals.totalQty > 0 ? totals.sold / totals.totalQty : null)}</td>
              <td className="num">{formatVND(totals.revenue)}</td>
              <td className="num">{formatVND(totals.cogs)}</td>
              <td className="num">{money(totals.grossProfit)}</td>
              <td className="num">{totals.disposed}</td>
              <td className="num">{money(-totals.disposedValue)}</td>
              <td className="num">{totals.remaining}</td>
              <td className="num">{formatVND(totals.remainingValue)}</td>
              <td className="num">{pct(totals.cost > 0 ? totals.revenue / totals.cost : null)}</td>
              <td colSpan={8 + productIds.length} />
            </tr>
            <tr>
              <td className="sticky-col">{t('Trừ chi phí')}</td>
              <td colSpan={8 + productIds.length} />
              <td className="num">{money(-totals.expenses)}</td>
              <td colSpan={13 + productIds.length} />
            </tr>
            {totals.disposedValue > 0 && (
              <tr>
                <td className="sticky-col">{t('Trừ hàng huỷ')}</td>
                <td colSpan={8 + productIds.length} />
                <td className="num">{money(-totals.disposedValue)}</td>
                <td colSpan={13 + productIds.length} />
              </tr>
            )}
            <tr className="net-row">
              <td className="sticky-col">{t('Lợi nhuận ròng tất cả các đợt')}</td>
              <td colSpan={8 + productIds.length} />
              <td className="num">{money(totals.netProfit)}</td>
              <td colSpan={13 + productIds.length} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

// Hộp thoại sửa số lượng / giá vốn / ghi chú của một đợt nhập. Bắt buộc xác nhận trước khi lưu.
function EditBatchDialog({
  batch,
  index,
  names,
  stockedProducts,
  latestUnitCost,
  onClose,
  onSaved,
}: {
  batch: BatchStat
  index: number
  names: Map<string, string>
  stockedProducts: { id: string; name: string }[]
  latestUnitCost: Map<string, number>
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const toast = useToast()
  const confirm = useConfirm()
  const [drafts, setDrafts] = useState<BatchEditDraft[]>(() => buildBatchEditDrafts(batch, names))
  const [note, setNote] = useState(batch.note ?? '')
  const [addProductId, setAddProductId] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving && !confirming) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving, confirming])

  const existingIds = new Set(drafts.map((d) => d.productId))
  const addable = stockedProducts.filter((p) => !existingIds.has(p.id))

  const updateDraft = (productId: string, patch: Partial<Pick<BatchEditDraft, 'qty' | 'unitCost'>>) => {
    setFormError(null)
    setDrafts((list) => list.map((d) => (d.productId === productId ? { ...d, ...patch } : d)))
  }

  const handleAddProduct = () => {
    if (!addProductId) return
    const prod = stockedProducts.find((p) => p.id === addProductId)
    if (!prod) return
    const suggested = latestUnitCost.get(prod.id)
    setFormError(null)
    setDrafts((list) => [
      ...list,
      {
        batchId: null,
        productId: prod.id,
        name: prod.name,
        originalQty: 0,
        originalUnitCost: suggested ?? 0,
        minQty: 0,
        qty: '1',
        unitCost: suggested !== undefined ? String(suggested) : '',
      },
    ])
    setAddProductId('')
  }

  const check = validateBatchEdit(drafts, batch.note, note)
  const hasChanges = check.ok ? check.changes.length > 0 || check.noteChanged : true
  const previewQty = drafts.reduce((sum, d) => sum + Math.max(0, Number(d.qty) || 0), 0)
  const previewCost = drafts.reduce((sum, d) => {
    const q = Math.max(0, Number(d.qty) || 0)
    const c = Number(d.unitCost)
    return sum + q * (Number.isFinite(c) && c >= 0 ? c : 0)
  }, 0)

  const handleSave = async () => {
    const result = validateBatchEdit(drafts, batch.note, note)
    if (!result.ok) {
      setFormError(t(result.error, result.params))
      return
    }
    if (result.changes.length === 0 && !result.noteChanged) {
      onClose()
      return
    }

    const summaryLines = result.changes.map((c) => {
      const qtyPart = c.oldQty !== c.newQty ? `${c.oldQty} → ${c.newQty}` : String(c.newQty)
      const costPart =
        c.newQty > 0 && c.oldUnitCost !== c.newUnitCost
          ? ` (${formatVND(c.oldUnitCost)} → ${formatVND(c.newUnitCost)})`
          : ''
      return `• ${c.name}: ${qtyPart}${costPart}`
    })
    if (result.noteChanged) {
      summaryLines.push(`• ${t('Ghi chú')}: ${result.newNote || '—'}`)
    }
    summaryLines.push(
      t('Tổng hũ: {oldQty} → {newQty} · Vốn nhập: {oldCost} → {newCost}', {
        oldQty: result.oldTotalQty,
        newQty: result.newTotalQty,
        oldCost: formatVND(result.oldTotalCost),
        newCost: formatVND(result.newTotalCost),
      }),
    )
    summaryLines.push(t('Tồn kho ở nhà sẽ tự động điều chỉnh theo số lượng mới.'))

    setConfirming(true)
    const ok = await confirm({
      title: t('Xác nhận sửa đợt {n}', { n: index + 1 }),
      message: `${t('Đợt {n}', { n: index + 1 })} (${formatDate(batch.date)})\n${summaryLines.join('\n')}`,
      confirmText: 'Xác nhận lưu',
      cancelText: 'Huỷ',
    })
    setConfirming(false)
    if (!ok) return

    setSaving(true)
    const { error } = await supabase.rpc('update_purchase_batch', {
      p_purchase_id: batch.purchaseId,
      p_note: result.newNote || null,
      p_items: result.items,
    })
    setSaving(false)
    if (error) {
      setFormError(t(errorMessage(error)))
      return
    }
    toast.success(t('Đã cập nhật đợt {n} ({date})', { n: index + 1, date: formatDate(batch.date) }))
    onSaved()
  }

  return (
    <div className="confirm-backdrop" onClick={saving ? undefined : onClose} role="presentation">
      <div
        className="confirm-modal batch-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-batch-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="batch-edit-head">
          <h3 id="edit-batch-title" className="confirm-title">
            {t('Sửa đợt {n}', { n: index + 1 })}
          </h3>
          <p className="confirm-message">{formatDate(batch.date)}</p>
        </div>

        <div className="batch-edit-list">
          {drafts.map((d) => {
            const qtyNum = Number(d.qty) || 0
            const costNum = Number(d.unitCost)
            const validCost = Number.isFinite(costNum) && costNum >= 0 ? costNum : 0
            const qtyDiff = qtyNum - d.originalQty
            return (
              <div key={d.productId} className="batch-edit-row">
                <div className="batch-edit-info">
                  <div className="batch-edit-name">
                    <strong>{d.name}</strong>
                    {qtyDiff !== 0 && (
                      <span className={qtyDiff < 0 ? 'batch-edit-diff neg' : 'batch-edit-diff pos'}>
                        {d.originalQty} → {qtyNum}
                      </span>
                    )}
                  </div>
                  {d.minQty > 0 && (
                    <small className="muted">
                      {t('Tối thiểu {min} (đã bán/chuyển {min})', { min: d.minQty })}
                    </small>
                  )}
                </div>
                <div className="batch-edit-controls">
                  <QtyStepper
                    value={d.qty}
                    onChange={(v) => updateDraft(d.productId, { qty: v })}
                    min={d.minQty}
                    label={t('Số lượng {name}', { name: d.name })}
                  />
                  <span className="times">×</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="price-input"
                    aria-label={t('Giá vốn {name}', { name: d.name })}
                    value={d.unitCost}
                    disabled={saving || qtyNum === 0}
                    onChange={(e) => updateDraft(d.productId, { unitCost: e.target.value.replace(/[^0-9.]/g, '') })}
                  />
                  <strong className="batch-edit-subtotal">{formatVND(qtyNum * validCost)}</strong>
                </div>
              </div>
            )
          })}
        </div>

        {addable.length > 0 && (
          <div className="batch-edit-add">
            <select
              aria-label={t('Thêm món vào đợt')}
              value={addProductId}
              disabled={saving}
              onChange={(e) => setAddProductId(e.target.value)}
            >
              <option value="">{t('Thêm món vào đợt…')}</option>
              {addable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="button" disabled={saving || !addProductId} onClick={handleAddProduct}>
              {t('Thêm')}
            </button>
          </div>
        )}

        <label className="field">
          {t('Ghi chú')}
          <input
            type="text"
            placeholder={t('Không bắt buộc')}
            value={note}
            disabled={saving}
            onChange={(e) => {
              setFormError(null)
              setNote(e.target.value)
            }}
          />
        </label>

        <div className="batch-edit-summary">
          <div>
            <span className="muted">{t('Tổng hũ')}</span>
            <strong>
              {previewQty !== batch.totalQty ? `${batch.totalQty} → ${previewQty}` : previewQty}
            </strong>
          </div>
          <div>
            <span className="muted">{t('Vốn nhập')}</span>
            <strong>
              {previewCost !== batch.cost
                ? `${formatVND(batch.cost)} → ${formatVND(previewCost)}`
                : formatVND(previewCost)}
            </strong>
          </div>
        </div>

        {formError && <p className="error">{formError}</p>}

        <div className="confirm-actions">
          <button type="button" className="confirm-btn-cancel" disabled={saving} onClick={onClose}>
            {t('Huỷ')}
          </button>
          <button
            type="button"
            className="primary"
            disabled={saving || !hasChanges}
            onClick={handleSave}
          >
            {saving ? t('Đang lưu…') : t('Lưu thay đổi')}
          </button>
        </div>
      </div>
    </div>
  )
}

// Hộp thoại thanh toán một đợt nhập: chọn ngày trả tiền hàng trên lịch rồi xác nhận, hoặc bỏ đánh dấu.
// Hiện dạng modal vì bảng cuộn ngang sẽ cắt mất lịch nếu đặt trong ô.
function PaymentDialog({
  batch,
  index,
  onClose,
  onSaved,
}: {
  batch: BatchStat
  index: number
  onClose: () => void
  onSaved: (purchaseId: string, paidOn: string | null) => void
}) {
  const { t } = useI18n()
  const toast = useToast()
  const [draft, setDraft] = useState(batch.paidOn ?? todayVN())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async (paidOn: string | null) => {
    setSaving(true)
    const { error } = await supabase.rpc('set_purchase_payment', { p_purchase_id: batch.purchaseId, p_paid_on: paidOn })
    setSaving(false)
    if (error) return toast.error(t(errorMessage(error)))
    onSaved(batch.purchaseId, paidOn)
    toast.success(
      paidOn
        ? t('Đợt {n}: đã thanh toán ngày {date}', { n: index + 1, date: formatDate(paidOn) })
        : t('Đợt {n}: chuyển về chưa thanh toán', { n: index + 1 }),
    )
  }

  return (
    <div className="confirm-backdrop" onClick={onClose} role="presentation">
      <div
        className="confirm-modal payment-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 id="payment-dialog-title" className="confirm-title">
            {t('Thanh toán đợt {n}', { n: index + 1 })}
          </h3>
          <p className="confirm-message">
            {formatDate(batch.date)} · {formatVND(batch.cost)}
          </p>
        </div>
        <Calendar value={draft} onChange={setDraft} max={todayVN()} />
        <div className="confirm-actions">
          {batch.paidOn && (
            <button type="button" className="payment-unmark" disabled={saving} onClick={() => save(null)}>
              {t('Bỏ đánh dấu')}
            </button>
          )}
          <button type="button" className="confirm-btn-cancel" disabled={saving} onClick={onClose}>
            {t('Huỷ')}
          </button>
          <button
            type="button"
            className="primary"
            disabled={saving || !draft || draft === batch.paidOn}
            onClick={() => save(draft)}
          >
            {batch.paidOn ? t('Lưu ngày') : t('Xác nhận')}
          </button>
        </div>
      </div>
    </div>
  )
}
