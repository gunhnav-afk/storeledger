import { describe, expect, it } from 'vitest'
import {
  extractQrToken,
  formatWorkedMinutes,
  haversineMeters,
  minutesToHours,
  parseGoogleMapInput,
} from './garmentGps'

describe('parseGoogleMapInput', () => {
  it('đọc toạ độ trực tiếp vĩ độ, kinh độ', () => {
    const res = parseGoogleMapInput('10.762622, 106.660172')
    expect(res).toEqual({ ok: true, point: { lat: 10.762622, lng: 106.660172 } })
  })

  it('ưu tiên toạ độ ghim thật !3d...!4d... trên URL Google Maps đầy đủ', () => {
    const url =
      'https://www.google.com/maps/place/Thien+Bao/@10.762000,106.659000,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d10.762622!4d106.660172'
    const res = parseGoogleMapInput(url)
    expect(res).toEqual({ ok: true, point: { lat: 10.762622, lng: 106.660172 } })
  })

  it('đọc link Google Maps dạng ?q=lat,lng và @lat,lng', () => {
    expect(parseGoogleMapInput('https://maps.google.com/?q=10.775844,106.701756')).toEqual({
      ok: true,
      point: { lat: 10.775844, lng: 106.701756 },
    })
    expect(parseGoogleMapInput('https://www.google.com/maps/@10.775844,106.701756,19z')).toEqual({
      ok: true,
      point: { lat: 10.775844, lng: 106.701756 },
    })
  })

  it('từ chối link rút gọn maps.app.goo.gl và chuỗi sai định dạng', () => {
    const shortRes = parseGoogleMapInput('https://maps.app.goo.gl/abcXYZ')
    expect(shortRes.ok).toBe(false)
    const badRes = parseGoogleMapInput('không phải toạ độ')
    expect(badRes.ok).toBe(false)
  })
})

describe('haversineMeters & giờ công', () => {
  it('tính khoảng cách 0m cho cùng điểm và ~111m cho lệch 0.001 độ vĩ', () => {
    const a = { lat: 10.762622, lng: 106.660172 }
    expect(haversineMeters(a, a)).toBeCloseTo(0, 3)
    const b = { lat: 10.763622, lng: 106.660172 }
    const dist = haversineMeters(a, b)
    expect(dist).toBeGreaterThan(108)
    expect(dist).toBeLessThan(115)
  })

  it('định dạng số phút làm việc và đổi sang giờ thập phân', () => {
    expect(formatWorkedMinutes(510)).toBe('8h30p')
    expect(formatWorkedMinutes(480)).toBe('8h')
    expect(formatWorkedMinutes(45)).toBe('45p')
    expect(minutesToHours(510)).toBe(8.5)
  })

  it('bóc token từ URL QR tĩnh hoặc chuỗi token', () => {
    expect(extractQrToken('https://thienbaoclothes.vercel.app/checkin?k=abc1234567890def1234')).toBe(
      'abc1234567890def1234',
    )
    expect(extractQrToken('/checkin?k=token_9876543210_xyz')).toBe('token_9876543210_xyz')
    expect(extractQrToken('rawtoken1234567890abcdef')).toBe('rawtoken1234567890abcdef')
    expect(extractQrToken('ngan')).toBeNull()
  })
})
