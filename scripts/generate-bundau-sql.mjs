import fs from 'node:fs'
import xlsx from 'xlsx'

const wbPath = '/home/hung-nguyen26/.gemini/antigravity-cli/brain/8725a620-9452-42ac-ba7d-6bd88ba9f365/scratch/sheet.xlsx'
if (!fs.existsSync(wbPath)) {
  console.error('Không tìm thấy tệp sheet.xlsx')
  process.exit(1)
}

const buffer = fs.readFileSync(wbPath)
const wb = xlsx.read(buffer, { type: 'buffer' })

function excelDateToDate(excelDate) {
  const d = new Date(Math.round((excelDate - 25569) * 86400 * 1000))
  return d.toISOString().slice(0, 10)
}

function categorizeExpense(name) {
  const n = name.toLowerCase().trim()
  if (n.includes('tiền nhà') || n.includes('mặt bằng')) return 'Tiền nhà'
  if (n.includes('điện') || (n.includes('nước') && !n.includes('nước mắm') && !n.includes('nước rửa chén') && !n.includes('nước ngọt'))) return 'Điện nước'
  if (n.includes('lương')) return 'Lương nhân viên'
  if (n.includes('quảng cáo') || n.includes('in ấn') || n.includes('biển hiệu')) return 'Quảng cáo'
  if (
    n.includes('đũa') ||
    n.includes('ly') ||
    n.includes('túi') ||
    n.includes('bịch') ||
    n.includes('hộp') ||
    n.includes('rửa chén') ||
    n.includes('que hàn') ||
    n.includes('bill') ||
    n.includes('lau bàn') ||
    n.includes('ca nhựa') ||
    n.includes('ốc vít') ||
    n.includes('băng keo') ||
    n.includes('chổi') ||
    n.includes('khăn')
  ) {
    return 'Dụng cụ'
  }
  if (n.includes('pepsi') || n.includes('coca') || n.includes('nước ngọt') || n.includes('sting') || n.includes('bia') || n.includes('đá')) {
    return 'Đồ uống'
  }
  if (n.includes('kẹo')) return 'Khác'
  return 'Nguyên liệu'
}

function escapeSql(str) {
  return String(str || '').replace(/'/g, "''").trim()
}

let sql = `-- =============================================================================
-- DỮ LIỆU BÚN ĐẬU EM THUỶ (Nhập từ Google Sheets)
-- Bao gồm: Doanh thu (Quán & Chả giò), Chi phí chi tiết T10-T11/2026, Thực đơn món
-- Idempotent: chạy nhiều lần an toàn, không trùng lặp
-- =============================================================================

do $$
declare
  v_store_id uuid;
  v_pid      uuid;
begin
  select id into v_store_id from public.stores where code = 'bundau' limit 1;
  if v_store_id is null then
    insert into public.stores (code, name) values ('bundau', 'Bún Đậu Em Thuỷ') returning id into v_store_id;
  end if;

  -- 1. THỰC ĐƠN SẢN PHẨM & GIÁ BÁN (Thực đơn app)
`

const menuSheet = wb.Sheets['Thuc don app']
if (menuSheet) {
  const menuRows = xlsx.utils.sheet_to_json(menuSheet)
  for (const item of menuRows) {
    const name = escapeSql(item['Tên món trên app'])
    const category = escapeSql(item['Danh mục'] ? item['Danh mục'].replace(/^\d+\.\s*/, '') : 'Khác')
    const priceInStore = Number(item['Giá tại quán (đ)'] || 0)
    const priceApp = Number(item['GIÁ APP CUỐI (đ)'] || item['Giá app đề xuất (đ)'] || priceInStore)

    if (name) {
      sql += `  select id into v_pid from public.products where store_id = v_store_id and name = '${name}' limit 1;\n`
      sql += `  if v_pid is null then\n`
      sql += `    insert into public.products (store_id, name, category, tracks_stock, low_stock_threshold, is_active, public_sale_mode, public_sold_out)\n`
      sql += `    values (v_store_id, '${name}', '${category}', false, 0, true, 'single', false) returning id into v_pid;\n`
      sql += `  else\n`
      sql += `    update public.products set category = '${category}', is_active = true where id = v_pid;\n`
      sql += `  end if;\n`
      sql += `  insert into public.product_prices (product_id, effective_from, sale_price, app_price)\n`
      sql += `  values (v_pid, '2026-10-01', ${priceInStore}, ${priceApp})\n`
      sql += `  on conflict (product_id, effective_from) do update set sale_price = excluded.sale_price, app_price = excluded.app_price;\n\n`
    }
  }
}

// 2. Doanh thu & Chi phí
const monthSheets = ['Doanh thu T102026', 'Doanh thu T112026']
for (const sheetName of monthSheets) {
  const sheet = wb.Sheets[sheetName]
  if (!sheet) continue
  const data = xlsx.utils.sheet_to_json(sheet, { header: 1 })
  const datesRow = data[0]

  sql += `  -- 2. ${sheetName}\n`

  for (let c = 1; c < datesRow.length; c += 2) {
    if (!datesRow[c]) continue
    const dateStr = excelDateToDate(datesRow[c])
    const inStore = Number(data[4]?.[c] || 0)
    const chaGio = Number(data[5]?.[c] || 0)

    if (inStore > 0) {
      sql += `  insert into public.daily_revenue (store_id, revenue_date, channel, amount, note)\n`
      sql += `  values (v_store_id, '${dateStr}', 'in_store', ${inStore}, 'Doanh thu quán ngày ${dateStr}')\n`
      sql += `  on conflict (store_id, revenue_date, channel) do update set amount = excluded.amount, note = excluded.note, updated_at = now();\n`
    }

    if (chaGio > 0) {
      sql += `  insert into public.daily_revenue (store_id, revenue_date, channel, amount, note)\n`
      sql += `  values (v_store_id, '${dateStr}', 'nem_cuon', ${chaGio}, 'Bán chả giò ngày ${dateStr}')\n`
      sql += `  on conflict (store_id, revenue_date, channel) do update set amount = excluded.amount, note = excluded.note, updated_at = now();\n`
    }

    for (let r = 7; r < data.length; r++) {
      const rawName = data[r]?.[c]
      const rawAmt = data[r]?.[c + 1]
      if (!rawName && !rawAmt) continue
      const name = String(rawName || '').trim()
      const amount = Number(rawAmt || 0)
      if (amount > 0) {
        const cat = categorizeExpense(name)
        const note = escapeSql(name)
        sql += `  insert into public.expenses (store_id, expense_date, category, note, amount, quantity, unit_price)\n`
        sql += `  select v_store_id, '${dateStr}', '${cat}', '${note}', ${amount}, 1, ${amount}\n`
        sql += `  where not exists (select 1 from public.expenses where store_id = v_store_id and expense_date = '${dateStr}' and note = '${note}' and amount = ${amount});\n`
      }
    }
  }
}

sql += `end $$;\n`

fs.writeFileSync('/home/hung-nguyen26/Desktop/storeledger/supabase/import_bundau_data.sql', sql, 'utf8')
console.log('Successfully generated /home/hung-nguyen26/Desktop/storeledger/supabase/import_bundau_data.sql')
