import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// Load password from gitignored .env.secret
let password = process.env.ADMIN_PASSWORD || process.env.DB_PASSWORD;
if (!password && fs.existsSync('.env.secret')) {
  const content = fs.readFileSync('.env.secret', 'utf8');
  for (const line of content.split('\n')) {
    const [k, ...v] = line.split('=');
    if (k?.trim() === 'ADMIN_PASSWORD' || k?.trim() === 'DB_PASSWORD') {
      password = v.join('=').trim();
      break;
    }
  }
}

const SUPABASE_URL = 'https://azzhgwqtiiutuctqdtxv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_kOOnLGRcp-a_KOH_hOfKsQ_SF8Fb4XL';
const BUNDAU_STORE_ID = 'cc9c6007-c4b6-46f8-afd8-e8a9364c4f45';
const HOGI_STORE_ID = 'de3045ae-dac6-49fe-98a8-5f4abedcb137';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
  console.log('=== KIỂM TRA TOÀN DIỆN DỮ LIỆU THÁNG 10 TRÊN SUPABASE MỚI ===');

  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: 'hungng28900@gmail.com',
    password,
  });
  if (authErr) throw new Error('Đăng nhập thất bại: ' + authErr.message);

  // 1. Chi phí Tháng 10
  const { data: octExpenses, count: expCount } = await supabase
    .from('expenses')
    .select('store_id, expense_date, category, note, amount', { count: 'exact' })
    .gte('expense_date', '2026-10-01')
    .lte('expense_date', '2026-10-31')
    .order('expense_date');

  let totalExpBundau = 0;
  let totalExpHogi = 0;
  const expByCat = {};

  for (const e of octExpenses || []) {
    const amt = Number(e.amount);
    if (e.store_id === BUNDAU_STORE_ID) {
      totalExpBundau += amt;
      expByCat[e.category] = (expByCat[e.category] || 0) + amt;
    } else {
      totalExpHogi += amt;
    }
  }

  console.log('\n--- 1. CHI PHÍ THÁNG 10/2026 ---');
  console.log(`Tổng số dòng chi phí T10: ${expCount} dòng`);
  console.log(`- Bún Đậu Em Thuỷ:        ${totalExpBundau.toLocaleString('vi-VN')} đ (${octExpenses.filter(e => e.store_id === BUNDAU_STORE_ID).length} dòng)`);
  console.log(`- Hogi Food:              ${totalExpHogi.toLocaleString('vi-VN')} đ (${octExpenses.filter(e => e.store_id === HOGI_STORE_ID).length} dòng)`);
  console.log('Chi tiết theo nhóm chi phí Bún Đậu:');
  for (const [cat, amt] of Object.entries(expByCat).sort((a, b) => b[1] - a[1])) {
    console.log(`  + ${cat.padEnd(20)}: ${amt.toLocaleString('vi-VN').padStart(15)} đ`);
  }

  // 2. Doanh thu theo ngày Tháng 10
  const { data: octDaily, count: dailyCount } = await supabase
    .from('daily_revenue')
    .select('revenue_date, channel, amount, note', { count: 'exact' })
    .gte('revenue_date', '2026-10-01')
    .lte('revenue_date', '2026-10-31')
    .order('revenue_date');

  const dailyByChannel = {};
  let totalDailyGross = 0;
  const uniqueDates = new Set();

  for (const d of octDaily || []) {
    const amt = Number(d.amount);
    totalDailyGross += amt;
    uniqueDates.add(d.revenue_date);
    dailyByChannel[d.channel] = (dailyByChannel[d.channel] || 0) + amt;
  }

  console.log('\n--- 2. DOANH THU THÁNG 10/2026 (daily_revenue) ---');
  console.log(`Tổng số bản ghi: ${dailyCount} dòng trên ${uniqueDates.size} ngày có doanh thu`);
  console.log(`Tổng doanh thu T10:       ${totalDailyGross.toLocaleString('vi-VN')} đ`);
  console.log('Chi tiết theo kênh:');
  for (const [ch, amt] of Object.entries(dailyByChannel)) {
    const label = ch === 'in_store' ? 'Quán (POS)' : ch === 'nem_cuon' ? 'Chả giò' : ch === 'shopeefood' ? 'ShopeeFood' : ch;
    console.log(`  + ${label.padEnd(20)}: ${amt.toLocaleString('vi-VN').padStart(15)} đ`);
  }

  // 3. Hoá đơn POS Tháng 10
  const { data: octInvoices, count: invCount } = await supabase
    .from('revenue_invoices')
    .select('revenue_date, total_paid, status, channel', { count: 'exact' })
    .gte('revenue_date', '2026-10-01')
    .lte('revenue_date', '2026-10-31');

  let totalInvPaid = 0;
  let paidInvCount = 0;
  const invDates = [];

  for (const inv of octInvoices || []) {
    if (inv.status === 'Đã thanh toán') {
      paidInvCount++;
      totalInvPaid += Number(inv.total_paid);
      invDates.push(inv.revenue_date);
    }
  }
  invDates.sort();

  console.log('\n--- 3. HOÁ ĐƠN MÁY POS THÁNG 10 (revenue_invoices) ---');
  console.log(`Tổng số hoá đơn đã lưu:   ${invCount} hoá đơn (${paidInvCount} hoá đơn đã thanh toán)`);
  console.log(`Thời gian hoá đơn:        từ ${invDates[0]} đến ${invDates[invDates.length - 1]}`);
  console.log(`Tổng tiền thanh toán:     ${totalInvPaid.toLocaleString('vi-VN')} đ`);

  // 4. Báo cáo mặt hàng Tháng 10
  const { data: octItems, count: itemCount } = await supabase
    .from('monthly_item_sales')
    .select('item_code, item_name, category, qty, gross, net', { count: 'exact' })
    .eq('month', '2026-10-01');

  let totalItemQty = 0;
  let totalItemNet = 0;
  for (const it of octItems || []) {
    totalItemQty += Number(it.qty);
    totalItemNet += Number(it.net);
  }

  console.log('\n--- 4. BÁO CÁO MẶT HÀNG THÁNG 10 (monthly_item_sales) ---');
  console.log(`Tổng số món danh mục:    ${itemCount} mặt hàng`);
  console.log(`Tổng số phần bán ra:      ${totalItemQty.toLocaleString('vi-VN')} phần`);
  console.log(`Tổng doanh thu mặt hàng:  ${totalItemNet.toLocaleString('vi-VN')} đ`);

  // 5. Dữ liệu Hogi Food
  const { count: salesCount } = await supabase.from('sales').select('*', { count: 'exact', head: true }).eq('store_id', HOGI_STORE_ID);
  const { count: saleItemsCount } = await supabase.from('sale_items').select('*', { count: 'exact', head: true });
  const { count: transferCount } = await supabase.from('stock_transfers').select('*', { count: 'exact', head: true }).eq('store_id', HOGI_STORE_ID);
  const { count: batchesCount } = await supabase.from('stock_batches').select('*', { count: 'exact', head: true }).eq('store_id', HOGI_STORE_ID);
  // company_sets bị revoke quyền đọc trực tiếp, phải đếm qua RPC
  const { data: companySets } = await supabase.rpc('get_company_sets_history', { p_store_id: HOGI_STORE_ID, p_from: null, p_to: null });
  const companySetsCount = companySets?.length ?? 0;
  const { count: preordersCount } = await supabase.from('preorders').select('*', { count: 'exact', head: true }).eq('store_id', HOGI_STORE_ID);

  console.log('\n--- 5. DỮ LIỆU HOGI FOOD (Bán hàng, Đơn đặt, Tồn kho) ---');
  console.log(`- Đơn bán hàng (sales):         ${salesCount} đơn`);
  console.log(`- Chi tiết món bán (sale_items): ${saleItemsCount} dòng`);
  console.log(`- Luân chuyển kho (transfers):  ${transferCount} lượt`);
  console.log(`- Lô hàng tồn kho (batches):    ${batchesCount} lô`);
  console.log(`- Set công ty (company_sets):   ${companySetsCount} set`);
  console.log(`- Đơn đặt trước (preorders):    ${preordersCount} đơn`);

  console.log('\nĐối chiếu các số trên với DB cũ / Google Sheet trước khi kết luận.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
