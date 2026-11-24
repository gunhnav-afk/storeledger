import fs from 'fs';
import xlsx from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://azzhgwqtiiutuctqdtxv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_kOOnLGRcp-a_KOH_hOfKsQ_SF8Fb4XL';
const STORE_ID = 'cc9c6007-c4b6-46f8-afd8-e8a9364c4f45'; // Bún Đậu Em Thuỷ

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const norm = (v) =>
  String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();

function excelToLocal(serial) {
  if (typeof serial !== 'number' || !Number.isFinite(serial) || serial < 1) return null;
  const ms = Math.round(serial * 86400) * 1000;
  const d = new Date(Date.UTC(1899, 11, 30) + ms);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function excelDateToDate(excelDate) {
  if (typeof excelDate === 'number') {
    const d = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const m = String(excelDate).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return String(excelDate);
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0);
const text = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

// 1. Parse Invoices
function parseInvoicesFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const wb = xlsx.read(buf, { type: 'buffer' });
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });

  const headerAt = rows.findIndex((r) => Array.isArray(r) && r.some((c) => norm(c) === 'ma hoa don'));
  let c;
  let startIdx;
  if (headerAt >= 0) {
    const header = rows[headerAt].map(norm);
    const col = (prefix) => header.findIndex((h) => h.startsWith(prefix));
    c = {
      code: col('ma hoa don'),
      source: col('nguon don'),
      status: col('trang thai'),
      created: col('thoi gian tao'),
      paid: col('thoi gian thanh toan'),
      goods: col('tong tien hang'),
      discount: col('tong giam gia'),
      total: col('tong tien thanh toan'),
      method: col('phuong thuc'),
    };
    startIdx = headerAt + 1;
  } else {
    // POS direct raw export:
    // Col 1: Mã hóa đơn, 2: Nguồn đơn, 3: Trạng thái, 4: Thời gian tạo, 5: Thời gian thanh toán,
    // 7: Tiền hàng, 10: Giảm giá, 12: Tổng tiền thanh toán, 13: Phương thức
    c = {
      code: 1,
      source: 2,
      status: 3,
      created: 4,
      paid: 5,
      goods: 7,
      discount: 10,
      total: 12,
      method: 13,
    };
    startIdx = 0;
  }

  const invoices = [];
  const seen = new Set();
  let unsupported = 0;

  for (const r of rows.slice(startIdx)) {
    const code = text(r[c.code]);
    if (!code) continue;
    const status = text(r[c.status]);
    if (status !== 'Đã thanh toán' && status !== 'Đã hủy') {
      unsupported++;
      continue;
    }
    if (seen.has(code)) throw new Error(`Mã hóa đơn bị lặp trong file: ${code}`);
    seen.add(code);
    const created = excelToLocal(r[c.created]);
    const paid = c.paid >= 0 ? excelToLocal(r[c.paid]) : null;
    const date = (paid ?? created)?.slice(0, 10);
    if (!date) throw new Error(`Hóa đơn ${code} không có thời gian`);
    const source = c.source >= 0 ? text(r[c.source]) : null;
    invoices.push({
      store_id: STORE_ID,
      invoice_code: code,
      status,
      source,
      payment_method: c.method >= 0 ? text(r[c.method]) : null,
      channel: source === 'ShopeeFood' ? 'shopeefood' : 'in_store',
      revenue_date: date,
      created_time: created,
      paid_time: paid,
      goods_total: num(r[c.goods]),
      discount: num(r[c.discount]),
      total_paid: num(r[c.total]),
    });
  }

  return { invoices, unsupported };
}

// 2. Parse Monthly Item Sales
function parseItemsFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const wb = xlsx.read(buf, { type: 'buffer' });
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });

  const headerAt = rows.findIndex((r) => Array.isArray(r) && norm(r[0]) === 'stt' && r.some((c) => norm(c) === 'ma mat hang'));
  if (headerAt < 0) throw new Error('Không thấy cột Mã mặt hàng');

  const periodText = rows.slice(0, headerAt).map((r) => String(r[0] ?? '')).find((s) => /\d{2}\/\d{2}\/\d{4}.*\d{2}\/\d{2}\/\d{4}/.test(s));
  const p = periodText?.match(/(\d{2})\/(\d{2})\/(\d{4}).*?(\d{2})\/(\d{2})\/(\d{4})/);
  if (!p) throw new Error('Không đọc được khoảng ngày của báo cáo');
  const [fd, fm, fy] = p.slice(1).map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const month = `${fy}-${pad(fm)}-01`;
  const periodStart = `${fy}-${pad(fm)}-${pad(fd)}`;
  const periodEnd = '2026-11-23';

  const header = rows[headerAt].map(norm);
  const col = (name) => header.indexOf(name);
  const c = {
    cat: col('ten danh muc'),
    code: col('ma mat hang'),
    name: col('ten mat hang'),
    qty: col('so luong'),
    gross: col('tien hang'),
    discount: col('tong giam gia'),
    net: col('tien sau giam gia'),
  };

  const items = [];
  const seen = new Set();
  for (const r of rows.slice(headerAt + 1)) {
    if (!/^\d+$/.test(String(r[0] ?? '').trim().replace(/\.0$/, ''))) continue;
    const code = String(r[c.code] ?? '').trim();
    const name = String(r[c.name] ?? '').trim();
    if (!code || !name) continue;
    const category = String(r[c.cat] ?? '').trim();
    if (seen.has(code)) throw new Error(`Mã mặt hàng bị lặp: ${code}`);
    seen.add(code);
    items.push({
      store_id: STORE_ID,
      month,
      period_start: periodStart,
      period_end: periodEnd,
      category: category === '' || category === '-' ? null : category,
      item_code: code,
      item_name: name,
      qty: num(r[c.qty]),
      gross: num(r[c.gross]),
      discount: num(r[c.discount]),
      net: num(r[c.net]),
    });
  }

  return { month, periodStart, periodEnd, items };
}

// 3. Parse Daily Revenue
function parseDailyRevenueFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const wb = xlsx.read(buf, { type: 'buffer' });
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });

  const headerIdx = rows.findIndex((r) => Array.isArray(r) && r[1] === 'Ngày');
  const colGross = rows[headerIdx].indexOf('Doanh thu thực');
  const days = [];

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row[1]) continue;
    const dateStr = excelDateToDate(row[1]);
    if (!dateStr.startsWith('2026-11')) continue;
    const gross = Number(row[colGross] || 0);
    days.push({
      store_id: STORE_ID,
      revenue_date: dateStr,
      channel: 'in_store',
      amount: gross,
      note: `Doanh thu quán ngày ${dateStr}`,
    });
  }

  return days;
}

async function main() {
  console.log('=== BẮT ĐẦU NHẬP DỮ LIỆU THÁNG 11 VÀO SUPABASE ===');

  // Authenticate as super_admin
  const adminPassword = process.env.ADMIN_PASSWORD || process.env.DB_PASSWORD;
  if (!adminPassword) {
    throw new Error('Vui lòng truyền ADMIN_PASSWORD hoặc DB_PASSWORD khi chạy script.');
  }
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: 'hungng28900@gmail.com',
    password: adminPassword,
  });
  if (authErr) throw new Error('Đăng nhập thất bại: ' + authErr.message);
  console.log('Đã đăng nhập thành công quyền super_admin.');

  // File paths
  const invoicesPath = '/home/hung-nguyen26/Downloads/danh_sach_hoa_don_1795455212_57053a2b-4b96-4522-8f59-e101db1d199c.xlsx';
  const itemsPath = '/home/hung-nguyen26/Downloads/danh-muc-2026-11-01T00_00_00-2026-11-25T00_00_00.xls';
  const dailyPath = '/home/hung-nguyen26/Downloads/doanh-thu-tong-quan-2026-11-01T00_00_00-2026-11-25T00_00_00.xls';

  // 1. Process Monthly Item Sales
  console.log('\n--- 1. Nhập Báo cáo mặt hàng (danh-muc) ---');
  const parsedItems = parseItemsFile(itemsPath);
  console.log(`Đã đọc ${parsedItems.items.length} mặt hàng trong kỳ ${parsedItems.periodStart} -> ${parsedItems.periodEnd}.`);

  // Delete old Nov items if any to avoid duplicates
  await supabase.from('monthly_item_sales').delete().eq('store_id', STORE_ID).eq('month', parsedItems.month);

  // Insert in batches of 50
  for (let i = 0; i < parsedItems.items.length; i += 50) {
    const chunk = parsedItems.items.slice(i, i + 50);
    const { error } = await supabase.from('monthly_item_sales').insert(chunk);
    if (error) throw new Error(`Lỗi chèn monthly_item_sales: ${error.message}`);
  }
  console.log(`✅ Đã nhập thành công ${parsedItems.items.length} dòng mặt hàng vào monthly_item_sales!`);

  // 2. Process Invoices
  console.log('\n--- 2. Nhập Danh sách hóa đơn (danh_sach_hoa_don) ---');
  const parsedInv = parseInvoicesFile(invoicesPath);
  console.log(`Đã đọc ${parsedInv.invoices.length} hóa đơn hợp lệ (bỏ qua ${parsedInv.unsupported} hóa đơn chưa xong).`);

  // Upsert in batches of 100
  let insertedInvoices = 0;
  for (let i = 0; i < parsedInv.invoices.length; i += 100) {
    const chunk = parsedInv.invoices.slice(i, i + 100);
    const { error } = await supabase.from('revenue_invoices').upsert(chunk, {
      onConflict: 'store_id,invoice_code',
    });
    if (error) throw new Error(`Lỗi chèn revenue_invoices: ${error.message}`);
    insertedInvoices += chunk.length;
  }
  console.log(`✅ Đã nhập/cập nhật thành công ${insertedInvoices} hóa đơn vào revenue_invoices!`);

  // 3. Process Daily Revenue
  console.log('\n--- 3. Nhập/Cập nhật Doanh thu theo ngày (doanh-thu-tong-quan) ---');
  const dailyRows = parseDailyRevenueFile(dailyPath);
  console.log(`Đã đọc ${dailyRows.length} ngày doanh thu POS (01/11 -> 23/11).`);

  let updatedDays = 0;
  for (const row of dailyRows) {
    const { error } = await supabase.from('daily_revenue').upsert(row, {
      onConflict: 'store_id,revenue_date,channel',
    });
    if (error) throw new Error(`Lỗi chèn daily_revenue: ${error.message}`);
    updatedDays++;
  }
  console.log(`✅ Đã cập nhật thành công ${updatedDays} ngày doanh thu quán vào daily_revenue!`);

  // 4. Verify & Cross-check
  console.log('\n--- 4. Kiểm tra đối soát số liệu sau khi nhập ---');

  const { data: allNovInv } = await supabase
    .from('revenue_invoices')
    .select('revenue_date, total_paid, status')
    .eq('store_id', STORE_ID)
    .gte('revenue_date', '2026-11-01')
    .lte('revenue_date', '2026-11-30');

  const invByDay = {};
  for (const inv of allNovInv || []) {
    if (inv.status !== 'Đã thanh toán') continue;
    invByDay[inv.revenue_date] = (invByDay[inv.revenue_date] || 0) + Number(inv.total_paid);
  }

  const { data: allNovDaily } = await supabase
    .from('daily_revenue')
    .select('revenue_date, channel, amount')
    .eq('store_id', STORE_ID)
    .gte('revenue_date', '2026-11-01')
    .lte('revenue_date', '2026-11-30')
    .order('revenue_date');

  const dailyByDay = {};
  for (const d of allNovDaily || []) {
    if (!dailyByDay[d.revenue_date]) dailyByDay[d.revenue_date] = {};
    dailyByDay[d.revenue_date][d.channel] = Number(d.amount);
  }

  console.log('Ngày'.padEnd(12) + 'Hóa đơn POS (Sum)'.padStart(20) + 'daily_revenue quán'.padStart(22) + 'Lệch (POS - DT)'.padStart(18) + 'Kênh Chả giò'.padStart(16));
  let totalInvSum = 0;
  let totalDailyInStore = 0;
  let totalDailyChaGio = 0;

  for (const d of Object.keys(dailyByDay).sort()) {
    const invAmt = invByDay[d] || 0;
    const inStore = dailyByDay[d]?.in_store || 0;
    const chaGio = dailyByDay[d]?.nem_cuon || 0;
    const diff = invAmt - inStore;
    totalInvSum += invAmt;
    totalDailyInStore += inStore;
    totalDailyChaGio += chaGio;

    console.log(
      d.padEnd(12) +
      invAmt.toLocaleString('vi-VN').padStart(20) +
      inStore.toLocaleString('vi-VN').padStart(22) +
      diff.toLocaleString('vi-VN').padStart(18) +
      chaGio.toLocaleString('vi-VN').padStart(16)
    );
  }

  console.log('--------------------------------------------------------------------------------------------------');
  console.log(
    'TỔNG CỘNG'.padEnd(12) +
    totalInvSum.toLocaleString('vi-VN').padStart(20) +
    totalDailyInStore.toLocaleString('vi-VN').padStart(22) +
    (totalInvSum - totalDailyInStore).toLocaleString('vi-VN').padStart(18) +
    totalDailyChaGio.toLocaleString('vi-VN').padStart(16)
  );

  // Total Item Sales Net Sum
  const { data: itemSalesData } = await supabase
    .from('monthly_item_sales')
    .select('qty, gross, net')
    .eq('store_id', STORE_ID)
    .eq('month', '2026-11-01');

  const totalItemNet = itemSalesData?.reduce((s, r) => s + Number(r.net), 0) || 0;
  const totalItemQty = itemSalesData?.reduce((s, r) => s + Number(r.qty), 0) || 0;
  console.log(`\nTổng doanh số báo cáo mặt hàng: ${totalItemNet.toLocaleString('vi-VN')} đ (${totalItemQty} phần).`);
  console.log(`Tổng doanh thu quán (POS):      ${totalDailyInStore.toLocaleString('vi-VN')} đ.`);

  console.log('\n=== HOÀN TẤT NHẬP DỮ LIỆU THÁNG 11 THÀNH CÔNG 100% ===');
}

main().catch(err => {
  console.error('\n❌ Lỗi:', err);
  process.exit(1);
});
