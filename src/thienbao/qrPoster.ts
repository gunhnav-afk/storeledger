import QRCode from 'qrcode'

export type QrPosterOptions = {
  checkinUrl: string
  address: string | null
  radiusMeters: number
}

// Sinh ảnh bảng QR tĩnh sắc nét để in dán tại cửa xưởng may
export async function renderQrPosterPng(opts: QrPosterOptions): Promise<string> {
  const qrDataUrl = await QRCode.toDataURL(opts.checkinUrl, {
    width: 520,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#13293d', light: '#ffffff' },
  })

  const qrImg = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Không tạo được ảnh mã QR'))
    img.src = qrDataUrl
  })

  const width = 840
  const height = 1120
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const font = (size: number, weight = 500) => `${weight} ${size}px "Be Vietnam Pro", system-ui, sans-serif`

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = '#1d4ed8'
  ctx.fillRect(0, 0, width, 168)

  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.font = font(34, 600)
  ctx.fillText('THIÊN BẢO CLOTHES', width / 2, 76)

  ctx.fillStyle = '#dbeafe'
  ctx.font = font(20, 500)
  ctx.fillText('MÃ QR CHẤM CÔNG TẠI XƯỞNG MAY', width / 2, 122)

  const qrSize = 500
  const qrX = (width - qrSize) / 2
  const qrY = 224
  ctx.strokeStyle = '#d8ddd6'
  ctx.lineWidth = 3
  ctx.strokeRect(qrX - 18, qrY - 18, qrSize + 36, qrSize + 36)
  ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize)

  let y = qrY + qrSize + 76
  ctx.fillStyle = '#13293d'
  ctx.font = font(24, 700)
  ctx.fillText('Hướng dẫn chấm công (Vào ca & Tan ca)', width / 2, y)

  const steps = [
    '1. Bật Vị trí (GPS) trên điện thoại khi đứng tại xưởng.',
    '2. Mở Camera điện thoại hoặc Zalo quét mã QR phía trên.',
    '3. Bấm nút xác nhận Vào ca (lúc đến) hoặc Tan ca (lúc về).',
  ]
  ctx.textAlign = 'left'
  ctx.font = font(20, 500)
  ctx.fillStyle = '#334155'
  for (const line of steps) {
    y += 44
    ctx.fillText(line, 96, y)
  }

  y += 66
  ctx.textAlign = 'center'
  ctx.fillStyle = '#5c675f'
  ctx.font = font(18, 500)
  const place = opts.address?.trim() ? `${opts.address.trim()} · ` : ''
  ctx.fillText(`${place}Bán kính GPS hợp lệ: ${opts.radiusMeters}m`, width / 2, y)

  return canvas.toDataURL('image/png')
}

// Mở hộp thoại máy in trực tiếp qua iframe ẩn (không bị trình duyệt chặn popup)
export async function printQrPoster(opts: QrPosterOptions): Promise<void> {
  const pngDataUrl = await renderQrPosterPng(opts)
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document
  if (!doc) {
    iframe.remove()
    throw new Error('Không mở được trình in của trình duyệt')
  }

  doc.open()
  doc.write(`<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>In mã QR chấm công — Thiên Bảo Clothes</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    html, body { margin: 0; padding: 0; background: #fff; display: flex; justify-content: center; align-items: center; min-height: 100%; }
    img { max-width: 100%; max-height: 265mm; width: auto; height: auto; display: block; border: 1px solid #d8ddd6; }
  </style>
</head>
<body>
  <img id="poster" src="${pngDataUrl}" alt="Mã QR Chấm công Thiên Bảo Clothes" />
</body>
</html>`)
  doc.close()

  const img = doc.getElementById('poster') as HTMLImageElement | null
  await new Promise<void>((resolve) => {
    if (!img || img.complete) resolve()
    else {
      img.onload = () => resolve()
      img.onerror = () => resolve()
    }
  })

  iframe.contentWindow?.focus()
  iframe.contentWindow?.print()
  window.setTimeout(() => iframe.remove(), 60_000)
}
