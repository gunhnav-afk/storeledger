import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AnimatePresence, m } from 'motion/react'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import { Icon } from '../components/Icon'
import { ShopCartModal } from '../components/ShopCartModal'
import { PopNumber, ShopMotion } from '../components/ShopMotion'
import { SOFT_SPRING, SPRING } from '../lib/shopMotion'
import { frameStyle } from '../lib/productImage'
import {
  SET_SIZES,
  addSet,
  cartCount,
  cartSummary,
  cartTotal,
  changeMix,
  flavorColors,
  flavorEmoji,
  menuImage,
  flavorTitle,
  getCachedMenu,
  setCachedMenu,
  isSingle,
  isLineDisabled,
  isSoldOut,
  soldOutLast,
  flavorNote,
  lineOf,
  menuLines,
  mixCount,
  mixLabel,
  refreshCart,
  selectable,
  setLineQty,
  setPrice,
  setPriceHints,
  setSingleQty,
  singleQty,
  unitOf,
  GOOGLE_CHAT_URL,
  hangoutEmail,
  telLink,
  type Mix,
  type PublicMenu,
  type CartLine,
  type SetSize,
} from '../lib/storefront'

const vnd = (v: number) => `${new Intl.NumberFormat('vi-VN').format(v)}đ`
const REFRESH_MS = 60_000

function ShopLoading() {
  const [percent, setPercent] = useState(24)
  const [phase, setPhase] = useState('Đang kết nối tới Hogi Food…')

  useEffect(() => {
    const t1 = setTimeout(() => {
      setPercent(52)
      setPhase('Đang tải danh sách sữa chua & bánh flan…')
    }, 180)
    const t2 = setTimeout(() => {
      setPercent(78)
      setPhase('Đang chuẩn bị bảng giá & ưu đãi set…')
    }, 450)
    const t3 = setTimeout(() => {
      setPercent(92)
      setPhase('Sắp hoàn tất rồi…')
    }, 850)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [])

  return (
    <div className="shop shop-loading-screen" role="status" aria-live="polite">
      <div className="shop-loading-card">
        <div className="shop-loading-mascot-wrap">
          <img src="/shop/hogi-logo.png" alt="" width={92} height={92} className="shop-loading-mascot" />
          <div className="shop-loading-shadow" aria-hidden="true" />
        </div>
        <h2>Đang chuẩn bị thực đơn Hogi</h2>
        <p>Sữa chua tươi ngon và bánh flan sắp sẵn sàng rồi 🥣✨</p>

        <div className="shop-progress-box">
          <div className="shop-progress-track">
            <div className="shop-progress-fill" style={{ width: `${percent}%` }}>
              <span className="shop-progress-shimmer" aria-hidden="true" />
            </div>
          </div>
          <div className="shop-progress-info">
            <span className="shop-progress-status">{phase}</span>
            <span className="shop-progress-pct">{percent}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Trang đặt trước của một quán (/hogi, /shop/<mã quán>): khách không cần đăng nhập.
// Bán theo SET 4 hoặc 6 hũ, khách tự chọn vị cho từng set (giống kênh Công ty). Không lấy tồn kho: ai đặt gì nhận đó.
// Hành động chính của trang: cùng một chữ ở thanh trên và hero
const MAIN_ACTION = 'Đặt sữa chua'
// Hero hiện ra một lần khi mở trang (nhẹ, không lặp lại khi cuộn)
const ENTER = { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const }

// Tiếng Việt cố định vì dành cho khách của quán (không đi qua bộ dịch của app).
export function ShopPage({ code: fixedCode }: { code?: string }) {
  const params = useParams()
  const code = (fixedCode ?? params.code ?? '').toLowerCase()
  const cached = useMemo(() => (code ? getCachedMenu(code) : null), [code])
  const [menu, setMenu] = useState<PublicMenu | null | undefined>(cached ?? undefined)
  const [loading, setLoading] = useState(() => !cached)
  const [error, setError] = useState(false)
  const [cart, setCart] = useState<CartLine[]>([])
  // Set đang soạn: cỡ, số hũ từng vị, và số set giống hệt muốn đặt
  const [line, setLine] = useState('')
  const [size, setSize] = useState<SetSize>(4)
  const [mix, setMix] = useState<Mix>({})
  const [copies, setCopies] = useState(1)
  const [open, setOpen] = useState(false)
  const [copiedContact, setCopiedContact] = useState(false)
  // Thông báo nổi dạng chồng (Lucian #070), dùng chung với Sổ Xanh
  const toast = useToast()
  // Giỏ hiện tại cho load(): so trước/sau khi làm mới thực đơn để báo khách món vừa hết hàng
  const cartRef = useRef<CartLine[]>([])
  useEffect(() => {
    cartRef.current = cart
  }, [cart])

  const load = useCallback(async () => {
    try {
      const { data, error: e } = await supabase.rpc('get_public_menu', { p_store_code: code })
      if (e) {
        setError(true)
        return
      }
      setError(false)
      const next: PublicMenu | null = data ?? null
      setMenu(next)
      // Cập nhật giá mới, bỏ vị đã gỡ khỏi thực đơn hoặc quán vừa bấm hết hàng
      if (next) {
        setCachedMenu(code, next)
        const before = cartRef.current
        if (refreshCart(before, next.items, next.store).length < before.length) {
          toast.error('Có món vừa hết hàng hoặc tạm ngưng nhận đơn nên đã được bỏ khỏi đơn của bạn')
        }
        setCart((c) => refreshCart(c, next.items, next.store))
        const firstLine = menuLines(next.items).find((l) => !isLineDisabled(l, next.store)) ?? ''
        const firstList = firstLine ? next.items.filter((i) => lineOf(i) === firstLine) : []
        if (firstList.length === 1 && !isSingle(firstList[0])) {
          setMix(isSoldOut(firstList[0]) ? {} : { [firstList[0].id]: 4 })
        } else {
          setMix((m) =>
            Object.fromEntries(
              Object.entries(m).filter(([id]) => {
                const found = next.items.find((i) => i.id === id)
                return Boolean(found && !isLineDisabled(lineOf(found), next.store) && !isSoldOut(found))
              })
            )
          )
        }
      }
    } finally {
      setLoading(false)
    }
  }, [code, toast])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        load()
      }
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => {
    document.title = `${menu?.store.name ?? 'Hogi Food'} – Sữa chua dẻo & bánh flan`
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (icon) {
      icon.type = 'image/png'
      icon.href = '/shop/hogi-logo.png'
    }
  }, [menu])

  const items = useMemo(() => menu?.items ?? [], [menu])
  const store = menu?.store

  const lines = useMemo(() => menuLines(items), [items])
  const defaultLine = useMemo(() => lines.find((l) => !isLineDisabled(l, store)) ?? lines[0] ?? '', [lines, store])
  const activeLine = lines.includes(line) ? line : defaultLine
  const lineItems = useMemo(() => (activeLine ? soldOutLast(items.filter((i) => lineOf(i) === activeLine)) : []), [items, activeLine])
  const isLineGom = useMemo(() => Boolean(store && isLineDisabled(activeLine, store)), [activeLine, store])
  // Cả dòng món đang tạm hết (vd: hôm nay hết flan)
  const lineSoldOut = lineItems.length > 0 && lineItems.every(isSoldOut)

  const picked = mixCount(mix)
  const unitPrice = useMemo(() => (picked === size && store ? setPrice(size, mix, items, store) : null), [picked, size, store, mix, items])

  // Giá tính sẵn cho các cỡ set: tránh gọi hàm lặp lại nhiều lần trong JSX
  const sizeHints = useMemo(() => {
    if (!store) return {} as Record<SetSize, { label: string | null; price: number }[]>
    const map = {} as Record<SetSize, { label: string | null; price: number }[]>
    for (const s of SET_SIZES) {
      map[s] = setPriceHints(s, lineItems, store)
    }
    return map
  }, [lineItems, store])

  // Giá thấp nhất của từng cỡ set ở dòng món mặc định: con số cụ thể cho màn hình đầu
  const heroPrices = useMemo(() => {
    if (!store || !defaultLine) return null
    const list = items.filter((i) => lineOf(i) === defaultLine && !isSingle(i))
    const out = SET_SIZES.flatMap((s) => {
      const hints = setPriceHints(s, list, store)
      return hints.length ? [{ size: s, price: Math.min(...hints.map((h) => h.price)) }] : []
    })
    return out.length ? out : null
  }, [items, store, defaultLine])

  const currentHints = sizeHints[size] ?? []
  const perJar = currentHints.length === 1 && currentHints[0].label === null

  const total = useMemo(() => cartTotal(cart), [cart])
  const count = useMemo(() => cartCount(cart), [cart])
  const summary = useMemo(() => cartSummary(cart), [cart])
  // Dòng món bán lẻ (vd: sữa chua Hy Lạp): không chọn set, mỗi món thêm thẳng vào đơn
  const singleLine = lineItems.length > 0 && lineItems.every(isSingle)

  // Khi dòng món chỉ có đúng 1 món bán theo set (vd: Bánh flan), tự động điền đủ số hũ cho set
  const autoMixFor = useCallback(
    (targetLine: string, targetSize: SetSize): Mix => {
      const list = items.filter((i) => lineOf(i) === targetLine)
      if (list.length === 1 && !isSingle(list[0]) && !isSoldOut(list[0])) {
        return { [list[0].id]: targetSize }
      }
      return {}
    },
    [items]
  )

  if (loading && !menu) return <ShopLoading />
  if (error && !menu) {
    return (
      <div className="shop shop-loading-screen" role="alert">
        <div className="shop-loading-card">
          <span className="shop-loading-err-icon" aria-hidden="true"><Icon name="store" size={28} /></span>
          <h2>Chưa tải được thực đơn</h2>
          <p>Kết nối mạng hơi chậm hoặc gián đoạn, bạn bấm thử lại nhé.</p>
          <button
            type="button"
            className="shop-cta"
            onClick={() => {
              setError(false)
              setLoading(true)
              void load()
            }}
          >
            Tải lại thực đơn
          </button>
        </div>
      </div>
    )
  }
  if (!menu || !store) {
    if (loading) return <ShopLoading />
    return (
      <div className="shop shop-loading-screen">
        <div className="shop-loading-card">
          <span className="shop-loading-err-icon" aria-hidden="true"><Icon name="eye" size={28} /></span>
          <h2>Không tìm thấy cửa hàng</h2>
          <p>Đường dẫn có thể chưa đúng hoặc cửa hàng tạm ngưng.</p>
        </div>
      </div>
    )
  }

  const onContactHangout = () => {
    if (!store?.domain) return
    navigator.clipboard?.writeText(hangoutEmail(store.domain)).catch(() => undefined)
    toast.success(`Đã chép ${hangoutEmail(store.domain)}, dán vào Google Chat để nhắn quán`)
    setCopiedContact(true)
    setTimeout(() => setCopiedContact(false), 2500)
  }

  const chooseSize = (s: SetSize) => {
    setSize(s)
    if (!isLineGom) setMix(autoMixFor(activeLine, s))
    setCopies(1)
  }
  const chooseLine = (l: string) => {
    setLine(l)
    if (isLineDisabled(l, store)) {
      setMix({})
    } else {
      setMix(autoMixFor(l, size))
    }
    setCopies(1)
  }
  const addToCart = () => {
    setCart((c) => addSet(c, size, mix, copies, items, store))
    setMix(autoMixFor(activeLine, size))
    setCopies(1)
  }

  const cartIcon = (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2 3h3l2.6 12.2a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6" />
    </svg>
  )

  return (
    <ShopMotion>
    <div className={`shop${count > 0 && !open ? ' has-cart' : ''}`} id="top">
      <header className="shop-header">
        <div className="shop-header-in wrap">
          <a className="shop-brand" href="#top">
            <img className="shop-logo" src="/shop/hogi-logo.png" alt={store.name} width={40} height={40} />
            <strong>{store.name}</strong>
          </a>
          <nav className="shop-nav" aria-label="Điều hướng">
            <a href="#chon-set">Thực đơn</a>
            <a href="#cach-dat">Giao hàng</a>
            <a href="#lien-he">Liên hệ</a>
          </nav>
          <div className="shop-header-actions">
            <a className="shop-cta shop-cta-sm shop-header-cta" href="#chon-set">
              {MAIN_ACTION}
            </a>
            <button type="button" className="shop-cart-btn" aria-label={`Đơn hàng, ${count} món`} onClick={() => setOpen(true)}>
              {cartIcon}
              {count > 0 && (
                <m.span key={count} className="shop-cart-count" initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={SPRING}>
                  {count}
                </m.span>
              )}
            </button>
          </div>
        </div>
      </header>

      <main>
      <section className="shop-hero" data-enter>
        <div className="shop-hero-in wrap">
          <m.div className="shop-hero-copy hero-text" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={ENTER}>
            <h1>Sữa chua hũ làm tay, giao tận tầng văn phòng</h1>
            <p className="shop-hero-sub">
              {store.tagline || 'Tự phối set 4 hoặc 6 hũ theo vị bạn thích, chuyển khoản bằng mã QR trên trang, quán mang lên đúng tầng của bạn.'}
            </p>
            <div className="shop-hero-cta">
              <a className="shop-cta" href="#chon-set">
                {MAIN_ACTION}
              </a>
              <a className="shop-cta shop-cta-ghost" href="#cach-dat">
                Xem cách giao hàng
              </a>
            </div>
            {heroPrices && (
              <dl className="shop-hero-facts">
                {heroPrices.map((p) => (
                  <div key={p.size}>
                    <dt>Set {p.size} hũ</dt>
                    <dd>từ {vnd(p.price)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </m.div>
          <m.div className="shop-hero-photo" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...ENTER, delay: 0.08 }}>
            <img
              src="/shop/hilaplon.jpeg"
              alt="Hộp sữa chua Hy Lạp và chai nước whey dán nhãn Hogi Food"
              width={600}
              height={800}
              fetchPriority="high"
            />
          </m.div>
        </div>
      </section>

      <section id="chon-set" className="shop-menu">
        <div className="shop-menu-in wrap">
        <div className="shop-menu-head">
          <h2>Thực đơn và giá set</h2>
          <p className="shop-sub">Chọn cỡ set, bấm + ở từng vị cho đủ số hũ, rồi thêm set vào đơn.</p>
        </div>

        {items.length === 0 ? (
          <p className="shop-state">Thực đơn đang được cập nhật.</p>
        ) : (
          <>
            {lines.length > 1 && (
              <div className="shop-tabs" role="tablist" aria-label="Loại món">
                {lines.map((l) => {
                  const disabled = isLineDisabled(l, store)
                  const out = items.every((i) => lineOf(i) !== l || isSoldOut(i))
                  const selected = activeLine === l
                  return (
                    <m.button
                      key={l}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      className={`${selected ? 'active' : ''}${disabled ? ' is-disabled' : ''}`.trim() || undefined}
                      whileTap={{ scale: 0.96 }}
                      transition={SPRING}
                      onClick={() => chooseLine(l)}
                    >
                      <span>{l}</span>
                      {disabled ? <span className="shop-tab-tag">Chờ mở gom</span> : out && <span className="shop-tab-tag is-soldout">Hết hàng</span>}
                    </m.button>
                  )
                })}
              </div>
            )}

            {isLineGom && (
              <div className="shop-disabled-banner" role="status">
                <span className="shop-disabled-icon" aria-hidden="true"><Icon name="store" size={24} /></span>
                <div>
                  <strong>Danh mục đang chờ mở gom</strong>
                  <p>Quán tạm thời chưa nhận đặt trước cho danh mục này. Bạn có thể xem thực đơn và theo dõi đợt mở gom tiếp theo nhé!</p>
                </div>
              </div>
            )}

            {!isLineGom && lineSoldOut && (
              <p className="shop-soldout-banner" role="status">
                {activeLine} hôm nay đã hết hàng. Bạn chọn món khác hoặc quay lại sau nhé.
              </p>
            )}

            {singleLine && !isLineGom && !lineSoldOut && <p className="shop-sub">Bán lẻ theo từng phần, không cần chọn set. Bấm + để thêm vào đơn.</p>}

            {!singleLine && !isLineGom && !lineSoldOut && (
            <div className="shop-sizes" role="radiogroup" aria-label="Cỡ set">
              {SET_SIZES.map((s) => {
                const h = sizeHints[s] ?? []
                return (
                  <m.button key={s} type="button" role="radio" aria-checked={size === s} className={`shop-size${size === s ? ' active' : ''}`} whileTap={{ scale: 0.97 }} transition={SPRING} onClick={() => chooseSize(s)}>
                    <strong>Set {s} hũ</strong>
                    {h.length === 0 ? (
                      <span>Giá cộng theo từng hũ</span>
                    ) : (
                      h.map((hint) => (
                        <span key={hint.label ?? 'all'}>
                          {hint.label ? `${hint.label}: ` : ''}
                          <b>{vnd(hint.price)}</b>
                        </span>
                      ))
                    )}
                  </m.button>
                )
              })}
            </div>
            )}

            <div className="shop-grid">
              {lineItems.map((item) => {
                const [c1, c2] = flavorColors(item.name)
                const image = menuImage(item)
                const note = flavorNote(item.name)
                const single = isSingle(item)
                const soldOut = isSoldOut(item)
                const n = soldOut ? 0 : single ? singleQty(cart, item.id) : (mix[item.id] ?? 0)
                const ok = !soldOut && (single ? item.price !== null : selectable(item, size, store))
                return (
                  <div key={item.id} className="shop-card-wrap">
                  <article className={`shop-card${n > 0 ? ' is-picked' : ''}${soldOut ? ' is-soldout' : ok && !isLineGom ? '' : ' is-out'}`}>
                    <div className="shop-art" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                      {isLineGom && <span className="shop-badge-gom">Chờ mở gom</span>}
                      {image ? <img src={image.src} alt={flavorTitle(item.name)} loading="lazy" width={520} height={430} style={frameStyle(image.frame)} /> : <span aria-hidden="true">{flavorEmoji(item.name)}</span>}
                      {soldOut && !isLineGom && <span className="shop-soldout-tag">Hết hàng</span>}
                      <AnimatePresence>
                        {n > 0 && !isLineGom && (
                          <m.span key="picked" className="shop-picked" aria-hidden="true" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={SPRING}>
                            {n}
                          </m.span>
                        )}
                      </AnimatePresence>
                    </div>
                    <div className="shop-body">
                      <div className="shop-title">
                        <h3>{flavorTitle(item.name)}</h3>
                        {note && <p className="shop-note">{note}</p>}
                      </div>
                      {(single || perJar) && item.price !== null && (
                        <p className="shop-price">
                          {vnd(item.price)}
                          <small> / {unitOf(item.name)}</small>
                        </p>
                      )}
                      {isLineGom ? (
                        <div className="shop-btn-disabled">
                          <span className="shop-dot-amber" aria-hidden="true" />
                          Chờ mở gom
                        </div>
                      ) : ok && single ? (
                        <div className="shop-qty" role="group" aria-label={`Số lượng ${item.name}`}>
                          <m.button type="button" aria-label={`Bớt ${item.name}`} disabled={n === 0} whileTap={{ scale: 0.85 }} transition={SPRING} onClick={() => setCart((c) => setSingleQty(c, item, n - 1))}>
                            −
                          </m.button>
                          <PopNumber value={n} />
                          <m.button type="button" aria-label={`Thêm ${item.name}`} whileTap={{ scale: 0.85 }} transition={SPRING} onClick={() => setCart((c) => setSingleQty(c, item, n + 1))}>
                            +
                          </m.button>
                        </div>
                      ) : ok ? (
                        <div className="shop-qty" role="group" aria-label={`Số hũ ${item.name}`}>
                          <m.button type="button" aria-label={`Bớt ${item.name}`} disabled={n === 0} whileTap={{ scale: 0.85 }} transition={SPRING} onClick={() => setMix((mx) => changeMix(mx, item.id, -1, size))}>
                            −
                          </m.button>
                          <PopNumber value={n} />
                          <m.button type="button" aria-label={`Thêm ${item.name}`} disabled={picked >= size} whileTap={{ scale: 0.85 }} transition={SPRING} onClick={() => setMix((mx) => changeMix(mx, item.id, 1, size))}>
                            +
                          </m.button>
                        </div>
                      ) : soldOut ? (
                        <p className="shop-soldout-note">Tạm hết hôm nay</p>
                      ) : (
                        <p className="shop-note">Chưa có giá</p>
                      )}
                    </div>
                  </article>
                  </div>
                )
              })}
            </div>

            {!singleLine && !isLineGom && !lineSoldOut && (
            <div className={`shop-builder${count > 0 ? ' has-cartbar' : ''}`} aria-live="polite">
              <div className="shop-builder-info">
                <div className={`shop-dots shop-dots-${size}`} aria-hidden="true">
                  {Array.from({ length: size }, (_, i) => (
                    <m.span key={i} className={i < picked ? 'on' : undefined} animate={{ scale: i < picked ? 1 : 0.85 }} transition={SPRING} />
                  ))}
                </div>
                <div>
                  <strong>
                    Set {size} hũ: đã chọn {picked}/{size}
                  </strong>
                  <p>{picked > 0 ? mixLabel(mix, items) : 'Bấm + ở các vị bên trên để chọn.'}</p>
                </div>
              </div>
              <div className="shop-builder-actions">
                <div className="shop-qty" role="group" aria-label="Số set giống nhau">
                  <m.button type="button" aria-label="Giảm số set" disabled={copies <= 1} whileTap={{ scale: 0.85 }} transition={SPRING} onClick={() => setCopies((c) => Math.max(1, c - 1))}>
                    −
                  </m.button>
                  <PopNumber value={copies} />
                  <m.button type="button" aria-label="Tăng số set" whileTap={{ scale: 0.85 }} transition={SPRING} onClick={() => setCopies((c) => Math.min(99, c + 1))}>
                    +
                  </m.button>
                </div>
                <m.button type="button" className="shop-add" disabled={unitPrice === null} whileTap={unitPrice === null ? undefined : { scale: 0.97 }} transition={SPRING} onClick={addToCart}>
                  {unitPrice === null ? `Chọn đủ ${size} hũ` : `Thêm ${copies} set · ${vnd(unitPrice * copies)}`}
                </m.button>
              </div>
            </div>
            )}
          </>
        )}
        </div>
      </section>

      <section id="cach-dat" className="shop-deliver">
        <div className="shop-deliver-in wrap">
          <div className="shop-deliver-copy">
            <h2>Giao hàng và thanh toán</h2>
            <p className="shop-sub">Đặt trên trang này, không cần tài khoản. Quán nhận đơn ngay khi bạn chuyển khoản.</p>
            <dl className="shop-deliver-rows">
              <div>
                <dt>Giao tới</dt>
                <dd>Tầng văn phòng của bạn. Điền domain nội bộ và số tầng khi đặt.</dd>
              </div>
              <div>
                <dt>Thanh toán</dt>
                <dd>Mã VietQR hiện ngay sau khi đặt, đã có sẵn số tiền.</dd>
              </div>
              <div>
                <dt>Nội dung</dt>
                <dd>
                  <code className="shop-syntax">domain - F6</code>
                </dd>
              </div>
            </dl>
            {store.domain && (
              <a className="shop-cta shop-cta-ghost" href={store.chat_url || GOOGLE_CHAT_URL} target="_blank" rel="noopener noreferrer" onClick={onContactHangout} title={hangoutEmail(store.domain)}>
                {copiedContact ? 'Đã chép ' + hangoutEmail(store.domain) : 'Nhắn quán qua Hangout'}
              </a>
            )}
          </div>
          <div className="shop-deliver-photo">
            <img src="/shop/flan-matcha-phomai.jpg" alt="Khay bánh flan matcha và bánh flan phô mai" width={600} height={800} loading="lazy" />
          </div>
        </div>
      </section>

      </main>

      <footer id="lien-he" className="shop-footer">
        <div className="shop-footer-in wrap">
          <div className="shop-footer-brand">
            <img className="shop-logo" src="/shop/hogi-logo.png" alt="" width={44} height={44} />
            <div>
              <strong>{store.name}</strong>
              <p>Sữa chua hũ, sữa chua Hy Lạp và bánh flan làm tay.</p>
            </div>
          </div>
          {(store.phone || store.domain) && (
            <div className="shop-footer-links">
              {store.phone && (
                <a className="shop-footer-btn" href={telLink(store.phone)}>
                  Gọi {store.phone}
                </a>
              )}
              {store.domain && (
                <a
                  className="shop-footer-btn"
                  href={store.chat_url || GOOGLE_CHAT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onContactHangout}
                >
                  {copiedContact ? 'Đã chép ' + hangoutEmail(store.domain) + ' ✓' : `Nhắn Hangout ${hangoutEmail(store.domain)}`}
                </a>
              )}
            </div>
          )}
        </div>
      </footer>

      <AnimatePresence>
        {count > 0 && !open && (
          <m.button
            key="cartbar"
            type="button"
            className="shop-cartbar"
            initial={{ y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 90, opacity: 0 }}
            whileTap={{ scale: 0.98 }}
            transition={SOFT_SPRING}
            onClick={() => setOpen(true)}
          >
            <span>
              Đơn đặt trước · {summary}
            </span>
            <strong>{vnd(total)} · Xem đơn</strong>
          </m.button>
        )}
      </AnimatePresence>

      <ShopCartModal
        open={open}
        onClose={() => setOpen(false)}
        cart={cart}
        items={items}
        store={store}
        onSetLineQty={(k, q) => setCart((c) => setLineQty(c, k, q))}
        storeCode={code}
        onPlaced={() => setCart([])}
      />
    </div>
    </ShopMotion>
  )
}
