import { useEffect, useMemo, useState } from 'react'
import { Icon } from './Icon'
import { useI18n } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { bankName } from '../lib/banks'
import { buildPaymentQr, describePayload } from '../lib/emvQr'
import { copyInvoiceImage, downloadInvoice, printInvoice } from '../lib/invoiceImage'
import { formatDate, formatVND } from '../lib/format'
import {
  STATUS_LABEL,
  buildPreorderInvoiceData,
  canSwitchToTransfer,
  isUnpaidPreorder,
  type StorePaymentInfo,
} from '../lib/preorders'
import { transferNote, vietQrUrl } from '../lib/storefront'
import type { Preorder } from '../types/database'

interface PreorderInvoiceModalProps {
  order: Preorder
  store: StorePaymentInfo
  switching: boolean
  onSwitchToTransfer: (order: Preorder) => Promise<void>
  onClose: () => void
}

const formatTime = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Hộp thoại in lại hoá đơn & mã QR thanh toán cho đơn đặt trước (hỗ trợ cả đơn quên CK và đơn tiền mặt đổi sang CK)
export function PreorderInvoiceModal({ order, store, switching, onSwitchToTransfer, onClose }: PreorderInvoiceModalProps) {
  const { t } = useI18n()
  const toast = useToast()
  const canTransfer = Boolean(store.pay || store.bank)
  const [includeQr, setIncludeQr] = useState(() => canTransfer && isUnpaidPreorder(order))
  const [qrImage, setQrImage] = useState<{ text: string; url: string } | null>(null)
  const [working, setWorking] = useState<'print' | 'download' | 'copy' | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const total = Number(order.total)
  const memo = useMemo(() => transferNote(order.customer_domain, order.floor), [order.customer_domain, order.floor])

  const qrText = useMemo(() => {
    if (!includeQr || !store.pay) return null
    try {
      return buildPaymentQr(store.pay.payload, total, memo, order.code)
    } catch {
      return null
    }
  }, [includeQr, store.pay, total, memo, order.code])

  useEffect(() => {
    if (!qrText) return
    let cancelled = false
    import('qrcode')
      .then((QR) => QR.toDataURL(qrText, { errorCorrectionLevel: 'M', margin: 1, width: 520 }))
      .then((url) => {
        if (!cancelled) setQrImage({ text: qrText, url })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [qrText])

  const qrDataUrl = qrText && qrImage?.text === qrText ? qrImage.url : null
  const vietQr = includeQr && !store.pay && store.bank ? vietQrUrl(store.bank, total, memo) : null
  const displayQrUrl = store.pay ? qrDataUrl : vietQr
  const qrLoading = Boolean(includeQr && store.pay && qrText && !qrDataUrl)

  const payAccount = useMemo(() => {
    if (!store.pay) return null
    try {
      return describePayload(store.pay.payload).account
    } catch {
      return null
    }
  }, [store.pay])

  const invoiceData = useMemo(
    () =>
      buildPreorderInvoiceData(order, store, {
        includeQr: includeQr && canTransfer,
        qrDataUrl,
        payAccount,
      }),
    [order, store, includeQr, canTransfer, qrDataUrl, payAccount],
  )

  const handleDownload = async () => {
    setWorking('download')
    try {
      await downloadInvoice(invoiceData)
    } catch {
      toast.error(t('Không tạo được hoá đơn, vui lòng thử lại.'))
    } finally {
      setWorking(null)
    }
  }

  const handlePrint = async () => {
    setWorking('print')
    try {
      await printInvoice(invoiceData)
    } catch {
      toast.error(t('Không mở được hộp thoại in, vui lòng thử tải ảnh hoá đơn.'))
    } finally {
      setWorking(null)
    }
  }

  const handleCopyImage = async () => {
    setWorking('copy')
    try {
      await copyInvoiceImage(invoiceData)
      toast.success(t('Đã sao chép ảnh hoá đơn'))
    } catch (err) {
      if (err instanceof Error && err.message === 'UNSUPPORTED_CLIPBOARD_IMAGE') {
        toast.error(t('Trình duyệt không hỗ trợ sao chép ảnh, hãy dùng nút Tải ảnh hoá đơn.'))
      } else {
        toast.error(t('Không tạo được hoá đơn, vui lòng thử lại.'))
      }
    } finally {
      setWorking(null)
    }
  }

  const handleDownloadQr = () => {
    if (!qrDataUrl) return
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = `QR-${order.code}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const handleCopyMemo = async () => {
    try {
      await navigator.clipboard.writeText(memo)
      toast.success(t('Đã sao chép nội dung chuyển khoản'))
    } catch {
      toast.error(t('Không tạo được hoá đơn, vui lòng thử lại.'))
    }
  }

  const handleSwitch = async () => {
    await onSwitchToTransfer(order)
    if (canTransfer) setIncludeQr(true)
  }

  const canSwitch = canSwitchToTransfer(order)
  const deliveredCashUnpaid = order.payment === 'cash' && order.status === 'delivered'

  return (
    <div className="confirm-backdrop" onClick={onClose} role="presentation">
      <div
        className="confirm-modal invoice-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preorder-invoice-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="invoice-modal-head">
          <div>
            <h3 id="preorder-invoice-title" className="confirm-title">
              {t('Hoá đơn & mã QR')}
            </h3>
            <p className="muted invoice-modal-sub">
              <strong>{order.code}</strong> · {formatDate(order.created_at.slice(0, 10))} {formatTime(order.created_at)} ·{' '}
              <span className={`badge preorder-badge-${order.status}`}>{t(STATUS_LABEL[order.status])}</span>
            </p>
          </div>
          <button type="button" className="icon-btn" aria-label={t('Đóng')} onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="invoice-summary">
          <div className="invoice-summary-meta">
            <span>
              {order.customer_domain} · {t('Tầng {floor}', { floor: order.floor })}
            </span>
            <strong className="invoice-summary-total">{formatVND(total)}</strong>
          </div>
          <ul className="preorder-lines">
            {order.lines.map((l, i) => (
              <li key={i}>
                {l.qty} × {l.title}
                {l.kind === 'set' && <span className="muted"> ({l.detail})</span>}
                {order.lines.length > 1 && ` · ${formatVND(Number(l.unit_price) * l.qty)}`}
              </li>
            ))}
          </ul>
        </div>

        {canSwitch && (
          <div className="invoice-callout">
            <p>{t('Đơn đang chọn tiền mặt. Nếu khách muốn chuyển khoản, bấm đổi để cập nhật và gửi mã QR.')}</p>
            <button type="button" className="primary" disabled={switching} onClick={handleSwitch}>
              {switching ? t('Đang lưu…') : t('Đổi sang chuyển khoản')}
            </button>
          </div>
        )}

        {deliveredCashUnpaid && (
          <div className="invoice-callout">
            <p>{t('Đơn tiền mặt đã giao, đang chờ thanh toán. Gửi hoá đơn kèm mã QR bên dưới cho khách, xong bấm Đã thanh toán.')}</p>
          </div>
        )}

        {canTransfer ? (
          <>
            <label className="check invoice-qr-toggle">
              <input type="checkbox" checked={includeQr} onChange={(e) => setIncludeQr(e.target.checked)} />
              {t('Kèm mã QR thanh toán trên hoá đơn')}
            </label>

            {includeQr && (
              <div className="invoice-qr-card">
                <div className="invoice-qr-frame">
                  {displayQrUrl ? (
                    <img src={displayQrUrl} alt={`QR ${order.code}`} width={200} height={200} className="invoice-qr-img" />
                  ) : (
                    <div className="invoice-qr-wait">{t('Đang tạo mã QR…')}</div>
                  )}
                </div>
                <dl className="invoice-qr-details">
                  <dt>{t('Tên người nhận')}</dt>
                  <dd>{store.pay ? store.pay.holder : store.bank?.holder}</dd>
                  <dt>{t('Ví / ngân hàng')}</dt>
                  <dd>{store.pay ? store.pay.label || 'MoMo' : store.bank ? bankName(store.bank.code) : '—'}</dd>
                  {(store.pay ? payAccount : store.bank?.account) && (
                    <>
                      <dt>{t('Tài khoản')}</dt>
                      <dd>{store.pay ? payAccount : store.bank?.account}</dd>
                    </>
                  )}
                  <dt>{t('Số tiền')}</dt>
                  <dd className="invoice-qr-amount">{formatVND(total)}</dd>
                  <dt>{t('Nội dung')}</dt>
                  <dd className="invoice-qr-memo">
                    <span>{memo}</span>
                    <button type="button" className="link" onClick={handleCopyMemo}>
                      {t('Sao chép nội dung')}
                    </button>
                  </dd>
                </dl>
              </div>
            )}
          </>
        ) : (
          <p className="muted">{t('Chưa cấu hình mã QR hoặc tài khoản ngân hàng trong mục Trang khách.')}</p>
        )}

        <div className="invoice-modal-actions">
          <button type="button" className="primary" disabled={working !== null || qrLoading} onClick={handlePrint}>
            <Icon name="printer" size={16} />
            <span>{working === 'print' ? t('Đang chuẩn bị bản in…') : t('In hoá đơn')}</span>
          </button>
          <button type="button" disabled={working !== null || qrLoading} onClick={handleDownload}>
            <Icon name="download" size={16} />
            <span>{working === 'download' ? t('Đang tạo ảnh…') : t('Tải ảnh hoá đơn')}</span>
          </button>
          <button type="button" disabled={working !== null || qrLoading} onClick={handleCopyImage}>
            <Icon name="copy" size={16} />
            <span>{t('Sao chép ảnh')}</span>
          </button>
          {includeQr && qrDataUrl && (
            <button type="button" disabled={working !== null} onClick={handleDownloadQr}>
              <Icon name="qr" size={16} />
              <span>{t('Tải mã QR')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
