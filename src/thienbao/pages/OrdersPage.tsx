import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../../lib/toast'
import { useConfirm } from '../../lib/confirm'
import { DatePicker } from '../../components/DatePicker'
import { errorMessage, formatAmount, formatDate, todayVN } from '../../lib/format'
import { currentIsoTimestamp } from '../../lib/garmentGps'
import { tbSupabase } from '../supabase'
import { useWorkshop } from '../workshop'
import type { TbOrderStatus, TbProductionOrder } from '../types'

const STATUS_META: Record<TbOrderStatus, { label: string; badge: string }> = {
  pending: { label: 'Chờ vải / Chuẩn bị', badge: 'badge-low' },
  cutting: { label: 'Đang cắt', badge: 'badge-low' },
  sewing: { label: 'Đang may', badge: 'badge-ok' },
  finishing: { label: 'Ủi & Đóng gói', badge: 'badge-ok' },
  completed: { label: 'Hoàn thành', badge: 'badge-ok' },
  cancelled: { label: 'Đã huỷ', badge: 'badge-out' },
}

const STATUS_KEYS: TbOrderStatus[] = ['pending', 'cutting', 'sewing', 'finishing', 'completed', 'cancelled']

type OrderDraft = {
  orderCode: string
  styleName: string
  customerName: string
  plannedQty: string
  completedQty: string
  status: TbOrderStatus
  receivedDate: string
  dueDate: string
  note: string
}

const emptyDraft = (): OrderDraft => ({
  orderCode: '',
  styleName: '',
  customerName: '',
  plannedQty: '',
  completedQty: '0',
  status: 'cutting',
  receivedDate: todayVN(),
  dueDate: '',
  note: '',
})

export function OrdersPage() {
  const { isManager } = useWorkshop()
  const toast = useToast()
  const confirm = useConfirm()

  const [orders, setOrders] = useState<{ rows: TbProductionOrder[]; error: string | null } | null>(null)
  const [version, setVersion] = useState(0)
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | TbOrderStatus>('active')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<TbProductionOrder | null>(null)
  const [draft, setDraft] = useState<OrderDraft>(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    tbSupabase
      .from('production_orders')
      .select('*')
      .order('received_date', { ascending: false })
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!cancelled) setOrders({ rows: data ?? [], error: error ? errorMessage(error) : null })
      })
    return () => {
      cancelled = true
    }
  }, [version])

  const filtered = useMemo(() => {
    const all = orders?.rows ?? []
    if (statusFilter === 'all') return all
    if (statusFilter === 'active') return all.filter((o) => o.status !== 'completed' && o.status !== 'cancelled')
    return all.filter((o) => o.status === statusFilter)
  }, [orders, statusFilter])

  const stats = useMemo(() => {
    const all = orders?.rows ?? []
    const active = all.filter((o) => o.status !== 'completed' && o.status !== 'cancelled')
    const completed = all.filter((o) => o.status === 'completed').length
    const totalPlanned = active.reduce((s, o) => s + o.planned_qty, 0)
    const totalDone = active.reduce((s, o) => s + o.completed_qty, 0)
    return { activeCount: active.length, completed, totalPlanned, totalDone }
  }, [orders])

  const openCreate = () => {
    setEditing(null)
    setFormError(null)
    setDraft(emptyDraft())
    setFormOpen(true)
  }

  const openEdit = (row: TbProductionOrder) => {
    setEditing(row)
    setFormError(null)
    setDraft({
      orderCode: row.order_code,
      styleName: row.style_name,
      customerName: row.customer_name ?? '',
      plannedQty: String(row.planned_qty),
      completedQty: String(row.completed_qty),
      status: row.status,
      receivedDate: row.received_date,
      dueDate: row.due_date ?? '',
      note: row.note ?? '',
    })
    setFormOpen(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const saveOrder = async () => {
    setFormError(null)
    const code = draft.orderCode.trim().toUpperCase()
    const style = draft.styleName.trim()
    const planned = Number(draft.plannedQty)
    const completed = Number(draft.completedQty || '0')

    if (!code) return setFormError('Nhập mã hàng (ví dụ: TB-01)')
    if (!style) return setFormError('Nhập tên mẫu quần áo')
    if (!Number.isInteger(planned) || planned <= 0 || planned > 1_000_000) {
      return setFormError('Số lượng cần may phải là số nguyên lớn hơn 0')
    }
    if (!Number.isInteger(completed) || completed < 0 || completed > 1_000_000) {
      return setFormError('Số lượng đã hoàn thành không hợp lệ')
    }

    setSaving(true)
    const payload = {
      order_code: code,
      style_name: style,
      customer_name: draft.customerName.trim() || null,
      planned_qty: planned,
      completed_qty: completed,
      status: draft.status,
      received_date: draft.receivedDate,
      due_date: draft.dueDate || null,
      note: draft.note.trim() || null,
    }

    const { error } = editing
      ? await tbSupabase
          .from('production_orders')
          .update({ ...payload, updated_at: currentIsoTimestamp() })
          .eq('id', editing.id)
      : await tbSupabase.from('production_orders').insert(payload)

    setSaving(false)
    if (error) {
      setFormError(/duplicate|unique/i.test(error.message) ? `Mã hàng "${code}" đã tồn tại` : errorMessage(error))
      return
    }

    toast.success(editing ? `Đã cập nhật mã hàng ${code}` : `Đã thêm mã hàng ${code}`)
    setFormOpen(false)
    setEditing(null)
    setVersion((v) => v + 1)
  }

  const quickStatusChange = async (row: TbProductionOrder, nextStatus: TbOrderStatus) => {
    const patch: { status: TbOrderStatus; completed_qty?: number; updated_at: string } = {
      status: nextStatus,
      updated_at: currentIsoTimestamp(),
    }
    if (nextStatus === 'completed' && row.completed_qty < row.planned_qty) {
      patch.completed_qty = row.planned_qty
    }
    const { error } = await tbSupabase.from('production_orders').update(patch).eq('id', row.id)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success(`Đã chuyển ${row.order_code} sang "${STATUS_META[nextStatus].label}"`)
    setVersion((v) => v + 1)
  }

  const removeOrder = async (row: TbProductionOrder) => {
    const ok = await confirm({
      title: 'Xoá mã hàng',
      message: `Xoá mã hàng ${row.order_code} (${row.style_name})?`,
      confirmText: 'Xoá',
      cancelText: 'Đóng',
      danger: true,
    })
    if (!ok) return
    const { error } = await tbSupabase.from('production_orders').delete().eq('id', row.id)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success(`Đã xoá mã hàng ${row.order_code}`)
    setVersion((v) => v + 1)
  }

  return (
    <section>
      <div className="tb-toolbar">
        <h1 style={{ margin: 0 }}>Mã hàng xưởng may</h1>
        {isManager && (
          <button type="button" className="primary" onClick={openCreate}>
            + Thêm mã hàng mới
          </button>
        )}
      </div>

      <div className="tb-stats">
        <div className="tb-stat">
          <span className="tb-stat-label">Mã hàng đang chạy</span>
          <span className="tb-stat-value">{stats.activeCount} mã</span>
        </div>
        <div className="tb-stat">
          <span className="tb-stat-label">Sản lượng đang gia công</span>
          <span className="tb-stat-value">
            {formatAmount(stats.totalDone)} / {formatAmount(stats.totalPlanned)} sp
          </span>
        </div>
        <div className="tb-stat">
          <span className="tb-stat-label">Mã hàng đã hoàn thành</span>
          <span className="tb-stat-value">{stats.completed} mã</span>
        </div>
      </div>

      {isManager && formOpen && (
        <div className="card form" style={{ marginBottom: 16 }}>
          <div className="tb-toolbar" style={{ marginBottom: 6 }}>
            <strong>{editing ? `Sửa mã hàng ${editing.order_code}` : 'Tạo lệnh sản xuất / Mã hàng mới'}</strong>
            <button type="button" className="link" onClick={() => setFormOpen(false)}>
              Đóng
            </button>
          </div>

          <div className="row">
            <label>
              Mã hàng
              <input
                type="text"
                placeholder="VD: TB-2611-01"
                value={draft.orderCode}
                onChange={(e) => setDraft({ ...draft, orderCode: e.target.value })}
              />
            </label>
            <label style={{ flex: 2 }}>
              Tên mẫu quần áo
              <input
                type="text"
                placeholder="VD: Áo sơ mi form rộng tay dài"
                value={draft.styleName}
                onChange={(e) => setDraft({ ...draft, styleName: e.target.value })}
              />
            </label>
            <label>
              Khách đặt / Nhãn hàng
              <input
                type="text"
                placeholder="VD: Hàng shop nội bộ / Khách sỉ"
                value={draft.customerName}
                onChange={(e) => setDraft({ ...draft, customerName: e.target.value })}
              />
            </label>
          </div>

          <div className="row">
            <label>
              Số lượng đặt (chiếc)
              <input
                type="number"
                min={1}
                value={draft.plannedQty}
                onChange={(e) => setDraft({ ...draft, plannedQty: e.target.value })}
              />
            </label>
            <label>
              Đã xong (chiếc)
              <input
                type="number"
                min={0}
                value={draft.completedQty}
                onChange={(e) => setDraft({ ...draft, completedQty: e.target.value })}
              />
            </label>
            <label>
              Khâu hiện tại
              <select
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value as TbOrderStatus })}
              >
                {STATUS_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {STATUS_META[k].label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="row">
            <DatePicker label="Ngày nhận lệnh" value={draft.receivedDate} onChange={(v) => setDraft({ ...draft, receivedDate: v })} />
            <label>
              Hạn giao hàng (tuỳ chọn)
              <input type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} />
            </label>
          </div>

          <label>
            Quy cách màu / size / ghi chú may
            <input
              type="text"
              placeholder="VD: Trắng 100 (S:30, M:40, L:30) · Đen 100 · Vải kate lụa"
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>

          {formError && <p className="error">{formError}</p>}
          <div className="tb-inline-actions">
            <button type="button" className="primary" disabled={saving} onClick={saveOrder}>
              {saving ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Tạo mã hàng'}
            </button>
            <button type="button" onClick={() => setFormOpen(false)}>
              Huỷ
            </button>
          </div>
        </div>
      )}

      <div className="tb-toolbar">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="muted">Lọc trạng thái</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="active">Đang làm tại xưởng</option>
            <option value="all">Tất cả mã hàng</option>
            {STATUS_KEYS.map((k) => (
              <option key={k} value={k}>
                {STATUS_META[k].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!orders ? (
        <p className="muted">Đang tải danh sách mã hàng…</p>
      ) : orders.error ? (
        <p className="error">{orders.error}</p>
      ) : filtered.length === 0 ? (
        <p className="muted">Chưa có mã hàng nào trong bộ lọc này.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mã & Mẫu hàng</th>
                <th>Khách / Lô</th>
                <th>Tiến độ SL</th>
                <th>Khâu hiện tại</th>
                <th>Hạn giao</th>
                {isManager && <th />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const ratio = Math.min(1, row.planned_qty > 0 ? row.completed_qty / row.planned_qty : 0)
                return (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.order_code}</strong> · {row.style_name}
                      {row.note && (
                        <>
                          <br />
                          <small className="muted">{row.note}</small>
                        </>
                      )}
                    </td>
                    <td>{row.customer_name || '—'}</td>
                    <td>
                      <div>
                        <strong>{formatAmount(row.completed_qty)}</strong> / {formatAmount(row.planned_qty)}
                      </div>
                      <div className="tb-progress" style={{ marginTop: 4 }}>
                        <div className="tb-progress-fill" style={{ transform: `scaleX(${ratio})` }} />
                      </div>
                    </td>
                    <td>
                      {isManager ? (
                        <select
                          aria-label={`Khâu của ${row.order_code}`}
                          value={row.status}
                          onChange={(e) => quickStatusChange(row, e.target.value as TbOrderStatus)}
                        >
                          {STATUS_KEYS.map((k) => (
                            <option key={k} value={k}>
                              {STATUS_META[k].label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className={`badge ${STATUS_META[row.status].badge}`}>{STATUS_META[row.status].label}</span>
                      )}
                    </td>
                    <td>{row.due_date ? formatDate(row.due_date) : '—'}</td>
                    {isManager && (
                      <td className="actions">
                        <button type="button" className="link" onClick={() => openEdit(row)}>
                          Sửa
                        </button>
                        <button type="button" className="link danger" onClick={() => removeOrder(row)}>
                          Xoá
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
