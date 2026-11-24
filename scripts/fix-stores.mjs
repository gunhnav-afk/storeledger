import pg from 'pg';

const client = new pg.Client({
  host: 'db.azzhgwqtiiutuctqdtxv.supabase.co',
  port: 5432,
  user: 'postgres',
  password: process.env.DB_PASSWORD,
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  console.log('Connected to Postgres.');

  await client.query('SET session_replication_role = replica;');

  const bundauOld = '66e24178-f35f-4e71-802c-4c1492af89fd';
  const bundauCanonical = 'cc9c6007-c4b6-46f8-afd8-e8a9364c4f45';

  const hogiOld = 'dc8f5170-92f9-4370-b716-a0c6e0430047';
  const hogiCanonical = 'de3045ae-dac6-49fe-98a8-5f4abedcb137';

  // 1. Merge duplicate products
  const pairs = [
    { oldId: bundauOld, canonId: bundauCanonical },
    { oldId: hogiOld, canonId: hogiCanonical }
  ];

  for (const { oldId, canonId } of pairs) {
    const dupes = await client.query(`
      SELECT p1.name, p1.id as id_new, p2.id as id_canonical 
      FROM public.products p1
      JOIN public.products p2 ON p1.name = p2.name AND p2.store_id = $1
      WHERE p1.store_id = $2;
    `, [canonId, oldId]);

    console.log(`Found ${dupes.rows.length} duplicate products for ${oldId} -> ${canonId}.`);

    for (const { id_new, id_canonical } of dupes.rows) {
      await client.query(`
        UPDATE public.product_prices 
        SET product_id = '${id_canonical}' 
        WHERE product_id = '${id_new}' 
          AND NOT EXISTS (
            SELECT 1 FROM public.product_prices pp 
            WHERE pp.product_id = '${id_canonical}' 
              AND pp.effective_from = product_prices.effective_from
          );
      `);
      await client.query(`DELETE FROM public.product_prices WHERE product_id = '${id_new}';`);

      await client.query(`UPDATE public.stock_batches SET product_id = '${id_canonical}' WHERE product_id = '${id_new}';`);
      await client.query(`UPDATE public.stock_transfers SET product_id = '${id_canonical}' WHERE product_id = '${id_new}';`);
      await client.query(`UPDATE public.sale_items SET product_id = '${id_canonical}' WHERE product_id = '${id_new}';`);
      await client.query(`UPDATE public.recipes SET product_id = '${id_canonical}' WHERE product_id = '${id_new}';`);
      await client.query(`UPDATE public.storefront_set_prices SET product_id = '${id_canonical}' WHERE product_id = '${id_new}';`);
      await client.query(`UPDATE public.stock_disposals SET product_id = '${id_canonical}' WHERE product_id = '${id_new}';`);

      await client.query(`DELETE FROM public.products WHERE id = '${id_new}';`);
    }

    // Move remaining products
    await client.query(`UPDATE public.products SET store_id = $1 WHERE store_id = $2;`, [canonId, oldId]);

    // Handle daily_revenue duplicates
    await client.query(`
      DELETE FROM public.daily_revenue 
      WHERE store_id = $2 
        AND (revenue_date, channel) IN (
          SELECT revenue_date, channel FROM public.daily_revenue WHERE store_id = $1
        );
    `, [canonId, oldId]);
    await client.query(`UPDATE public.daily_revenue SET store_id = $1 WHERE store_id = $2;`, [canonId, oldId]);

    // Handle revenue_invoices duplicates
    await client.query(`
      DELETE FROM public.revenue_invoices 
      WHERE store_id = $2 
        AND invoice_code IN (
          SELECT invoice_code FROM public.revenue_invoices WHERE store_id = $1
        );
    `, [canonId, oldId]);
    await client.query(`UPDATE public.revenue_invoices SET store_id = $1 WHERE store_id = $2;`, [canonId, oldId]);

    // Handle store_members duplicates
    await client.query(`
      DELETE FROM public.store_members 
      WHERE store_id = $2 
        AND user_id IN (
          SELECT user_id FROM public.store_members WHERE store_id = $1
        );
    `, [canonId, oldId]);
    await client.query(`UPDATE public.store_members SET store_id = $1 WHERE store_id = $2;`, [canonId, oldId]);

    // Expenses
    await client.query(`UPDATE public.expenses SET store_id = $1 WHERE store_id = $2;`, [canonId, oldId]);
  }

  // Check any other tables with store_id
  const tablesWithStoreId = await client.query(`
    SELECT table_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND column_name = 'store_id' AND table_name != 'stores';
  `);

  for (const { table_name } of tablesWithStoreId.rows) {
    if (['products', 'daily_revenue', 'revenue_invoices', 'store_members', 'expenses'].includes(table_name)) continue;
    for (const { oldId, canonId } of pairs) {
      try {
        await client.query(`UPDATE public."${table_name}" SET store_id = $1 WHERE store_id = $2;`, [canonId, oldId]);
      } catch (err) {
        console.warn(`Could not bulk update ${table_name} store_id:`, err.message);
      }
    }
  }

  // Clean and insert canonical stores
  await client.query('DELETE FROM public.stores;');

  await client.query(`
    INSERT INTO public.stores (
      id, code, name, default_commission_rate, created_at, is_public,
      public_phone, public_tagline, public_bank_code, public_bank_account,
      public_bank_holder, public_qr_payload, public_qr_label, public_contact_domain,
      public_floors, public_chat_url, public_contact_email, public_hidden_categories
    ) VALUES
    (
      'cc9c6007-c4b6-46f8-afd8-e8a9364c4f45',
      'bundau',
      'Bún Đậu Em Thuỷ',
      0.25,
      '2026-10-17T17:12:29.823151+00:00',
      false,
      null, null, null, null, null, null, null, null,
      null, null, null, ARRAY[]::text[]
    ),
    (
      'de3045ae-dac6-49fe-98a8-5f4abedcb137',
      'hogi',
      'Hogi Food',
      0.25,
      '2026-10-17T17:12:29.823151+00:00',
      true,
      '0984932183',
      null, null, null,
      'VU THI THU HUONG',
      '00020101021138630010A000000727013300069710250119PSG26298169000000010208QRIBFTTA53037045802VN62560334mp_42063538_6fxbdws4qi40xzv9cbmb9c0514MM_fund_detail630452E7',
      'MoMo',
      'huong.vu3',
      ARRAY['6', '7', '8', '9', '11', '12']::text[],
      'https://chat.google.com/app/chat/xWmxo8AAAAE',
      null,
      ARRAY[]::text[]
    );
  `);

  await client.query('SET session_replication_role = DEFAULT;');

  console.log('Stores and store_ids fixed successfully!');
  const storesRes = await client.query('SELECT id, code, name, is_public, public_bank_holder, public_qr_label FROM public.stores;');
  console.table(storesRes.rows);

  const checkRefRes = await client.query(`
    SELECT 'revenue_invoices' as tbl, store_id, count(*) FROM public.revenue_invoices GROUP BY store_id
    UNION ALL
    SELECT 'expenses', store_id, count(*) FROM public.expenses GROUP BY store_id
    UNION ALL
    SELECT 'daily_revenue', store_id, count(*) FROM public.daily_revenue GROUP BY store_id
    UNION ALL
    SELECT 'products', store_id, count(*) FROM public.products GROUP BY store_id
    UNION ALL
    SELECT 'sales', store_id, count(*) FROM public.sales GROUP BY store_id;
  `);
  console.table(checkRefRes.rows);

  await client.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
