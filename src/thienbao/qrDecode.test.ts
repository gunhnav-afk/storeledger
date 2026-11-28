import { describe, expect, it } from 'vitest'
import QRCode from 'qrcode'
import { extractQrToken } from '../lib/garmentGps'
import { decodeQrFromRgba } from './qrDecode'

function renderQrModulesToRgba(text: string, scale = 6, margin = 4): { data: Uint8ClampedArray; size: number } {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const count = qr.modules.size
  const totalModules = count + margin * 2
  const size = totalModules * scale
  const data = new Uint8ClampedArray(size * size * 4)

  for (let y = 0; y < size; y++) {
    const my = Math.floor(y / scale) - margin
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / scale) - margin
      const isDark = my >= 0 && my < count && mx >= 0 && mx < count ? Boolean(qr.modules.get(my, mx)) : false
      const c = isDark ? 20 : 255
      const idx = (y * size + x) * 4
      data[idx] = c
      data[idx + 1] = c
      data[idx + 2] = c
      data[idx + 3] = 255
    }
  }

  return { data, size }
}

describe('decodeQrFromRgba', () => {
  it('decodes workshop check-in QR URL and extracts token', () => {
    const url = 'https://thienbaoclothes.vercel.app/checkin?k=9f8e7d6c5b4a3210'
    const { data, size } = renderQrModulesToRgba(url)
    const decoded = decodeQrFromRgba(data, size, size)
    expect(decoded).toBe(url)
    expect(extractQrToken(decoded ?? '')).toBe('9f8e7d6c5b4a3210')
  })

  it('returns null on blank image buffer', () => {
    const blank = new Uint8ClampedArray(64 * 64 * 4).fill(255)
    expect(decodeQrFromRgba(blank, 64, 64)).toBeNull()
  })
})
