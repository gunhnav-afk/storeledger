-- =============================================================================
-- edit_purchase_batch — Admin sửa số lượng / giá vốn / ghi chú của một đợt nhập.
--   * Chỉ admin được gọi (SECURITY DEFINER + kiểm tra public.is_admin()).
--   * Tăng số lượng: cộng phần chênh vào tồn ở nhà (qty_home).
--   * Giảm số lượng: trừ phần chênh khỏi tồn ở nhà; không cho giảm dưới phần đã
--     chuyển khỏi nhà, đã bán hoặc đã huỷ (initial_qty - qty_home).
--   * Xoá một dòng (quantity = 0): chỉ cho khi chưa chuyển / bán / huỷ hũ nào
--     và đợt nhập vẫn còn ít nhất 1 dòng.
--   * Đổi giá vốn: đồng bộ lại unit_cost ở sale_item_cost_lines và
--     stock_disposal_lines của đúng lô đó để giá vốn / giá trị huỷ khớp thực tế.
--   * Nếu đợt nhập có dòng chi phí gắn purchase_id, đồng bộ số lượng / thành tiền.
-- =============================================================================

create or replace function public.update_purchase_batch(
  p_purchase_id  uuid,
  p_note         text,
  p_items        jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase      record;
  v_item          jsonb;
  v_batch_id      uuid;
  v_product_id    uuid;
  v_qty           integer;
  v_unit_cost     numeric;
  v_product       record;
  v_batch         record;
  v_delta         integer;
  v_committed     integer;
  v_seen          uuid[] := array[]::uuid[];
  v_kept_count    integer;
begin
  if not public.is_admin() then
    raise exception 'Chỉ admin được sửa đợt nhập' using errcode = '42501';
  end if;

  if p_purchase_id is null then
    raise exception 'Thiếu mã đợt nhập';
  end if;

  select p.id, p.store_id, p.purchase_date
  into v_purchase
  from public.purchases p
  where p.id = p_purchase_id
  for update;

  if not found then
    raise exception 'Không tìm thấy đợt nhập';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Đợt nhập phải có ít nhất một sản phẩm';
  end if;

  -- Khoá tất cả các lô hiện có của đợt theo thứ tự cố định để tránh deadlock
  perform 1
  from public.stock_batches b
  where b.purchase_id = p_purchase_id
  order by b.id
  for update;

  for v_item in select e.value from jsonb_array_elements(p_items) as e(value) loop
    v_batch_id   := nullif(v_item ->> 'batch_id', '')::uuid;
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_qty        := (v_item ->> 'quantity')::integer;
    v_unit_cost  := (v_item ->> 'unit_cost')::numeric;

    if v_product_id is null then
      raise exception 'Thiếu mã sản phẩm trong đợt nhập';
    end if;
    if v_product_id = any(v_seen) then
      raise exception 'Trùng sản phẩm trong đợt nhập';
    end if;
    v_seen := array_append(v_seen, v_product_id);

    if v_qty is null or v_qty < 0 then
      raise exception 'Số lượng nhập không hợp lệ';
    end if;
    if v_qty > 10000 then
      raise exception 'Số lượng nhập quá lớn (tối đa 10.000)';
    end if;
    if v_unit_cost is null or v_unit_cost < 0 or v_unit_cost > 1000000000 then
      raise exception 'Giá nhập không hợp lệ';
    end if;

    select pr.name, pr.tracks_stock
    into v_product
    from public.products pr
    where pr.id = v_product_id and pr.store_id = v_purchase.store_id;

    if not found then
      raise exception 'Sản phẩm % không thuộc cửa hàng này', v_product_id;
    end if;
    if not v_product.tracks_stock then
      raise exception 'Sản phẩm "%" không quản lý tồn kho, không thể nhập hàng', v_product.name;
    end if;

    -- Tìm lô hiện có (ưu tiên khớp batch_id, fallback theo product_id)
    v_batch := null;
    if v_batch_id is not null then
      select b.*
      into v_batch
      from public.stock_batches b
      where b.id = v_batch_id
        and b.purchase_id = p_purchase_id
        and b.product_id = v_product_id;
    else
      select b.*
      into v_batch
      from public.stock_batches b
      where b.purchase_id = p_purchase_id
        and b.product_id = v_product_id
      order by b.id
      limit 1;
    end if;

    if v_batch.id is not null then
      v_delta := v_qty - v_batch.initial_qty;
      v_committed := v_batch.initial_qty - v_batch.qty_home;

      if v_qty = 0 then
        if v_committed > 0
           or exists (select 1 from public.sale_item_cost_lines cl where cl.batch_id = v_batch.id)
           or exists (select 1 from public.stock_disposal_lines dl where dl.batch_id = v_batch.id) then
          raise exception 'Không thể xoá "%": đã có % hũ chuyển khỏi kho nhà hoặc bán/huỷ',
            v_product.name, greatest(v_committed, 1);
        end if;

        delete from public.stock_batches where id = v_batch.id;
      else
        if v_batch.qty_home + v_delta < 0 then
          raise exception 'Không thể giảm "%" xuống %: đã chuyển khỏi kho nhà hoặc bán/huỷ % hũ (chỉ còn % ở nhà)',
            v_product.name, v_qty, v_committed, v_batch.qty_home;
        end if;

        update public.stock_batches
        set initial_qty = v_qty,
            qty_home    = qty_home + v_delta,
            unit_cost   = v_unit_cost
        where id = v_batch.id;

        if v_unit_cost <> v_batch.unit_cost then
          update public.sale_item_cost_lines
          set unit_cost = v_unit_cost
          where batch_id = v_batch.id;

          update public.stock_disposal_lines
          set unit_cost = v_unit_cost
          where batch_id = v_batch.id;
        end if;
      end if;

      -- Đồng bộ khoản chi phí gắn với đợt nhập (nếu có)
      if v_qty = 0 or v_qty * v_unit_cost = 0 then
        delete from public.expenses
        where purchase_id = p_purchase_id
          and note = 'Nhập kho: ' || v_product.name;
      else
        update public.expenses
        set quantity   = v_qty,
            unit_price = v_unit_cost,
            amount     = v_qty * v_unit_cost
        where purchase_id = p_purchase_id
          and note = 'Nhập kho: ' || v_product.name;
      end if;
    elsif v_qty > 0 then
      -- Thêm món mới vào đợt nhập
      insert into public.stock_batches (
        purchase_id, store_id, product_id, received_date,
        initial_qty, unit_cost, qty_home, qty_shop, qty_company
      )
      values (
        p_purchase_id,
        v_purchase.store_id,
        v_product_id,
        v_purchase.purchase_date,
        v_qty,
        v_unit_cost,
        v_qty,
        0,
        0
      );
    end if;
  end loop;

  select count(*) into v_kept_count
  from public.stock_batches b
  where b.purchase_id = p_purchase_id;

  if v_kept_count = 0 then
    raise exception 'Đợt nhập phải có ít nhất một sản phẩm';
  end if;

  update public.purchases
  set note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_purchase_id;
end;
$$;

revoke execute on function public.update_purchase_batch(uuid, text, jsonb) from public, anon;
grant execute on function public.update_purchase_batch(uuid, text, jsonb) to authenticated;
