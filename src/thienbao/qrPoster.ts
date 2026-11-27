import QRCode from 'qrcode'

// Sinh ảnh bảng QR tĩnh sắc nét để in dán tại cửa xưởng may
export async function renderQrPosterPng(opts: {
  checkinUrl: string
  address: string | null
  radiusMeters: number
}): Promise<string> {
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

  // Nền sáng có khung viền in rõ nét
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = '#1e3a5f'
  ctx.fillRect(0, 0, width, 168)

  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.font = font(36, 800)
  ctx.fillText('THIÊN BẢO CLOTHES', width / 2, 76)

  ctx.fillStyle = '#cfe0f2'
  ctx.font = font(21, 600)
  ctx.fillText('MÃ QR CHẤM CÔNG NHÂN VIÊN TẠI XƯỞNG', width / 2, 122)

  // Khung chứa QR
  const qrSize = 500
  const qrX = (width - qrSize) / 2
  const qrY = 224
  ctx.strokeStyle = '#d8ddd6'
  ctx.lineWidth = 3
  ctx.strokeRect(qrX - 18, qrY - 18, qrSize + 36, qrSize + 36)
  ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize)

  // Hướng dẫn 3 bước ngắn gọn cho công nhân
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
