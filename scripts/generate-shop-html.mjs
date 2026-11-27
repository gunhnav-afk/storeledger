import fs from 'node:fs'
import path from 'node:path'

const distIndex = path.resolve('dist/index.html')
const distApp = path.resolve('dist/app.html')
const distShop = path.resolve('dist/shop.html')
const distThienBao = path.resolve('dist/thienbao.html')

if (!fs.existsSync(distIndex)) {
  console.error('dist/index.html not found, cannot generate domain html files')
  process.exit(1)
}

const rawHtml = fs.readFileSync(distIndex, 'utf8')

// Đổi index.html -> app.html để Vercel chạy rewrites theo host cho cả đường dẫn gốc "/"
fs.renameSync(distIndex, distApp)

// 1. Hogi Food (trang đặt hàng công khai)
const shopHtml = rawHtml
  .replace(
    /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg" \/>/,
    '<link rel="icon" type="image/png" href="/shop/hogi-logo.png" />',
  )
  .replace(
    /<link rel="apple-touch-icon" href="\/favicon\.svg" \/>/,
    '<link rel="apple-touch-icon" href="/shop/hogi-logo.png" />',
  )
  .replace(
    /<title>.*?<\/title>/,
    '<title>Hogi Food – Đặt trước sữa chua &amp; bánh flan</title>',
  )
  .replace(
    /<meta name="description" content=".*?" \/>/,
    '<meta name="description" content="Thực đơn sữa chua hũ tự mix vị, sữa chua Hy Lạp, bánh flan &amp; nước whey. Đặt trước giao tận nơi." />',
  )
  .replace(
    /<meta property="og:url" content=".*?" \/>/,
    '<meta property="og:url" content="https://hogifood.vercel.app" />',
  )
  .replace(
    /<meta property="og:title" content=".*?" \/>/,
    '<meta property="og:title" content="Hogi Food – Đặt trước sữa chua &amp; bánh flan" />',
  )
  .replace(
    /<meta property="og:description" content=".*?" \/>/,
    '<meta property="og:description" content="Thực đơn sữa chua hũ tự mix vị, sữa chua Hy Lạp, bánh flan &amp; nước whey. Đặt trước giao tận nơi." />',
  )
  .replace(
    /<meta property="og:image" content=".*?" \/>/,
    '<meta property="og:image" content="https://hogifood.vercel.app/shop/truyenthong.jpg" />',
  )
  .replace(
    /<meta property="og:image:width" content=".*?" \/>/,
    '<meta property="og:image:width" content="1536" />',
  )
  .replace(
    /<meta property="og:image:height" content=".*?" \/>/,
    '<meta property="og:image:height" content="2048" />',
  )
  .replace(
    /<meta property="og:image:type" content=".*?" \/>/,
    '<meta property="og:image:type" content="image/jpeg" />',
  )
  .replace(
    /<meta name="twitter:title" content=".*?" \/>/,
    '<meta name="twitter:title" content="Hogi Food – Đặt trước sữa chua &amp; bánh flan" />',
  )
  .replace(
    /<meta name="twitter:description" content=".*?" \/>/,
    '<meta name="twitter:description" content="Thực đơn sữa chua hũ tự mix vị, sữa chua Hy Lạp, bánh flan &amp; nước whey. Đặt trước giao tận nơi." />',
  )
  .replace(
    /<meta name="twitter:image" content=".*?" \/>/,
    '<meta name="twitter:image" content="https://hogifood.vercel.app/shop/truyenthong.jpg" />',
  )

fs.writeFileSync(distShop, shopHtml, 'utf8')

// 2. Thiên Bảo Clothes (thienbaoclothes.vercel.app - quản lý xưởng may & chấm công QR)
const thienBaoHtml = rawHtml
  .replace(
    /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg" \/>/,
    '<link rel="icon" type="image/svg+xml" href="/thienbao-logo.svg" />',
  )
  .replace(
    /<link rel="apple-touch-icon" href="\/favicon\.svg" \/>/,
    '<link rel="apple-touch-icon" href="/thienbao-logo.svg" />',
  )
  .replace(
    /<meta name="theme-color" content=".*?" \/>/,
    '<meta name="theme-color" content="#1e3a5f" />',
  )
  .replace(
    /<title>.*?<\/title>/,
    '<title>Thiên Bảo Clothes — Quản lý xưởng may &amp; Chấm công</title>',
  )
  .replace(
    /<meta name="description" content=".*?" \/>/,
    '<meta name="description" content="Hệ thống quản lý xưởng may và chấm công nhân viên bằng mã QR cho Thiên Bảo Clothes." />',
  )
  .replace(
    /<meta property="og:url" content=".*?" \/>/,
    '<meta property="og:url" content="https://thienbaoclothes.vercel.app" />',
  )
  .replace(
    /<meta property="og:title" content=".*?" \/>/,
    '<meta property="og:title" content="Thiên Bảo Clothes — Quản lý xưởng may &amp; Chấm công" />',
  )
  .replace(
    /<meta property="og:description" content=".*?" \/>/,
    '<meta property="og:description" content="Hệ thống quản lý xưởng may và chấm công nhân viên bằng mã QR cho Thiên Bảo Clothes." />',
  )
  .replace(
    /<meta name="twitter:title" content=".*?" \/>/,
    '<meta name="twitter:title" content="Thiên Bảo Clothes — Quản lý xưởng may &amp; Chấm công" />',
  )
  .replace(
    /<meta name="twitter:description" content=".*?" \/>/,
    '<meta name="twitter:description" content="Hệ thống quản lý xưởng may và chấm công nhân viên bằng mã QR cho Thiên Bảo Clothes." />',
  )

fs.writeFileSync(distThienBao, thienBaoHtml, 'utf8')
console.log('✓ Generated dist/shop.html and dist/thienbao.html')
