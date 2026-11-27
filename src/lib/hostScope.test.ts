import { describe, expect, it } from 'vitest'
import { isThienBaoHost } from './hostScope'

function memStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
  }
}

describe('isThienBaoHost', () => {
  it('nhận diện domain thienbaoclothes.vercel.app và tên miền chứa thienbao', () => {
    expect(isThienBaoHost('thienbaoclothes.vercel.app', '', null)).toBe(true)
    expect(isThienBaoHost('thienbaoclothes-git-main.vercel.app', '', null)).toBe(true)
    expect(isThienBaoHost('storeledger-one.vercel.app', '', null)).toBe(false)
    expect(isThienBaoHost('hogifood.vercel.app', '', null)).toBe(false)
  })

  it('hỗ trợ chuyển đổi chế độ dev ?domain=thienbao trên localhost', () => {
    const store = memStorage()
    expect(isThienBaoHost('localhost', '', store)).toBe(false)
    expect(isThienBaoHost('localhost', '?domain=thienbao', store)).toBe(true)
    // Giữ trạng thái ở các trang con tiếp theo trên localhost
    expect(isThienBaoHost('localhost', '?k=123', store)).toBe(true)
    expect(isThienBaoHost('localhost', '?domain=soxanh', store)).toBe(false)
  })
})
