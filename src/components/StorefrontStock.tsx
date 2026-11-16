import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { errorMessage } from '../lib/format'

type StockRow = { id: string; name: string; category: string | null; public_sold_out: boolean }

// Bật / tắt "Hết hàng" từng món trên trang khách: lưu ngay khi bấm (không cần nút Lưu), trang khách tự cập nhật trong vòng 1 phút.
// Khác "Ngừng bán" ở Sản phẩm: món hết hàng vẫn hiện cho khách xem (mờ, ghi Hết hàng) nhưng không đặt được.
export function StorefrontStock({ storeId, onChanged }: { storeId: string; onChanged?: () => void }) {
  const { t } = useI18n()
  const toast = useToast()
  const [rows, setRows] = useState<StockRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Món đang lưu: khoá công tắc để không bấm chồng
  const [busy, setBusy] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    let cancelled = false
    supabase
      .from('products')
      .select('id, name, category, public_sold_out')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .order('category', { nullsFirst: false })
      .order('name')
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) return setError(errorMessage(e))
        setRows(data ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [storeId])

  if (error && !rows) return <p className="error">{t(error)}</p>
  if (!rows) return null

  const save = async (ids: string[], soldOut: boolean) => {
    setBusy((b) => new Set([...b, ...ids]))
    const apply = (value: boolean) => setRows((rs) => rs?.map((r) => (ids.includes(r.id) ? { ...r, public_sold_out: value } : r)) ?? rs)
    apply(soldOut)
    const { error: e } = await supabase.from('products').update({ public_sold_out: soldOut }).in('id', ids)
    setBusy((b) => new Set([...b].filter((id) => !ids.includes(id))))
    if (e) {
      // Chỉ trả lại các món vừa bấm, không đụng món khác đang lưu song song
      apply(!soldOut)
      toast.error(t(errorMessage(e)))
      return
    }
    const name = ids.length === 1 ? (rows.find((r) => r.id === ids[0])?.name ?? '') : ''
    toast.success(
      ids.length > 1
        ? t('Đã mở bán lại tất cả món')
        : soldOut
          ? t('{name}: đã báo hết hàng', { name })
          : t('{name}: đã mở bán lại', { name })
    )
    onChanged?.()
  }

  const groups = new Map<string, StockRow[]>()
  for (const r of rows) {
    const key = r.category ?? ''
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const soldOutIds = rows.filter((r) => r.public_sold_out).map((r) => r.id)

  return (
    <div className="card stock-card">
      <div className="stock-head">
        <div>
          <h3 className="card-title">{t('Còn hàng hôm nay')}</h3>
          <small className="muted">{t('Tắt món đã hết: khách vẫn thấy món nhưng không đặt được. Lưu ngay khi bấm.')}</small>
        </div>
        {soldOutIds.length > 0 && (
          <button type="button" className="stock-reset" disabled={busy.size > 0} onClick={() => save(soldOutIds, false)}>
            {t('Mở bán lại tất cả')}
          </button>
        )}
      </div>
      {rows.length === 0 && <p className="muted">{t('Chưa có sản phẩm đang bán.')}</p>}
      {[...groups.entries()].map(([category, list]) => (
        <div key={category} className="stock-group">
          <h4>{category || t('Chưa phân loại')}</h4>
          <ul>
            {list.map((r) => {
              const available = !r.public_sold_out
              return (
                <li key={r.id} className={available ? undefined : 'is-soldout'}>
                  <span className="stock-name">{r.name}</span>
                  <span className={`badge ${available ? 'badge-ok' : 'badge-out'}`}>{available ? t('Còn hàng') : t('Hết hàng')}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={available}
                    aria-label={t('Còn hàng: {name}', { name: r.name })}
                    className="stock-switch"
                    disabled={busy.has(r.id)}
                    onClick={() => save([r.id], available)}
                  >
                    <span aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
