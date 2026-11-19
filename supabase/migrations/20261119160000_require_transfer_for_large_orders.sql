-- =============================================================================
-- Yêu cầu chuyển khoản trước cho đơn đặt trước từ 500.000đ trở lên.
-- Đơn từ 500k không áp dụng thanh toán tiền mặt khi nhận hàng (COD).
-- Cập nhật submit_preorder: từ chối đơn có tổng tiền >= 500.000đ nhưng chọn payment = 'cash'.
-- =============================================================================

create or replace function public.submit_preorder(p_store_code text, p_order jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store     record;
  v_today     date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_name      text := btrim(coalesce(p_order ->> 'name', ''));
  v_domain    text := lower(regexp_replace(btrim(coalesce(p_order ->> 'domain', '')), '@.*$', ''));
  v_floor     text := upper(btrim(regexp_replace(btrim(coalesce(p_order ->> 'floor', '')), '^(f|tầng|tang|lầu|lau)\s*', '', 'i')));
  v_payment   text := coalesce(p_order ->> 'payment', 'transfer');
  v_line      jsonb;
  v_out       jsonb := '[]'::jsonb;
  v_total     numeric := 0;
  v_qty       integer;
  v_size      integer;
  v_unit      numeric;
  v_pid       uuid;
  v_prod      record;
  v_entry     record;
  v_count     integer;
  v_jars      integer;
  v_category  text;
  v_line_size integer;
  v_sum       numeric;
  v_detail    text;
  v_code      text;
  v_alphabet  text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_try       integer := 0;
begin
  select s.id, s.code, s.public_floors, s.public_hidden_categories into v_store from public.stores s
  where s.code = lower(btrim(coalesce(p_store_code, ''))) and s.is_public;
  if not found then
    raise exception 'Không tìm thấy cửa hàng';
  end if;

  if char_length(v_name) not between 1 and 60 then raise exception 'Nhập tên của bạn'; end if;
  if v_domain !~ '^[a-z0-9._-]{2,40}$' then raise exception 'Domain chưa đúng (vd: huong.vu3)'; end if;
  if v_floor !~ '^[A-Z0-9]{1,4}$' or (v_store.public_floors is not null and not (v_floor = any (v_store.public_floors))) then
    raise exception 'Tầng chưa đúng, chỉ giao tầng %', array_to_string(coalesce(v_store.public_floors, '{}'), ', ');
  end if;
  if v_payment not in ('transfer', 'cash') then raise exception 'Hình thức thanh toán không hợp lệ'; end if;
  if jsonb_typeof(p_order -> 'lines') <> 'array' or jsonb_array_length(p_order -> 'lines') not between 1 and 30 then
    raise exception 'Đơn chưa có món nào';
  end if;

  select count(*) into v_count from public.preorders p
  where p.store_id = v_store.id and p.customer_domain = v_domain and p.created_at > now() - interval '10 minutes';
  if v_count >= 5 then raise exception 'Bạn vừa đặt nhiều đơn liên tiếp, thử lại sau ít phút nhé'; end if;

  for v_line in select e.value from jsonb_array_elements(p_order -> 'lines') as e(value) loop
    v_qty := (v_line ->> 'qty')::integer;
    if v_qty is null or v_qty not between 1 and 99 then raise exception 'Số lượng không hợp lệ'; end if;

    if v_line ->> 'kind' = 'single' then
      v_pid := (v_line ->> 'product_id')::uuid;
      select p.id, p.name, p.public_sold_out as sold_out, (select pp.sale_price from public.product_prices pp
                             where pp.product_id = p.id and pp.effective_from <= v_today and pp.sale_price is not null
                             order by pp.effective_from desc limit 1) as price
      into v_prod from public.products p
      where p.id = v_pid
        and p.store_id = v_store.id
        and p.is_active
        and p.public_sale_mode = 'single'
        and not (coalesce(p.category, '') = any (coalesce(v_store.public_hidden_categories, '{}')));
      if not found or v_prod.price is null then raise exception 'Món không còn bán lẻ'; end if;
      if v_prod.sold_out then raise exception '% vừa hết hàng, bạn bỏ món này khỏi đơn nhé', v_prod.name; end if;
      v_unit := v_prod.price;
      v_out := v_out || jsonb_build_object('kind', 'single', 'product_id', v_prod.id, 'title', v_prod.name, 'detail', 'Bán lẻ', 'qty', v_qty, 'unit_price', v_unit);

    elsif v_line ->> 'kind' = 'set' then
      v_size := (v_line ->> 'size')::integer;
      if v_size not in (4, 6) or jsonb_typeof(v_line -> 'mix') <> 'object' then raise exception 'Set không hợp lệ'; end if;
      v_jars := 0; v_sum := 0; v_count := 0; v_category := null; v_detail := '';
      for v_entry in
        select (e.key)::uuid as pid, (e.value)::integer as n, p.name, p.category, p.public_sold_out as sold_out,
               (select pp.sale_price from public.product_prices pp
                 where pp.product_id = p.id and pp.effective_from <= v_today and pp.sale_price is not null
                 order by pp.effective_from desc limit 1) as price
        from jsonb_each_text(v_line -> 'mix') as e
        left join public.products p
          on p.id = (e.key)::uuid
         and p.store_id = v_store.id
         and p.is_active
         and p.public_sale_mode = 'set'
         and not (coalesce(p.category, '') = any (coalesce(v_store.public_hidden_categories, '{}')));
        where (e.value)::integer > 0
        order by p.name
      loop
        if v_entry.name is null then raise exception 'Vị trong set không còn bán'; end if;
        if v_entry.sold_out then raise exception 'Vị % vừa hết hàng, bạn đổi vị khác trong set nhé', v_entry.name; end if;
        if v_category is not null and v_entry.category is distinct from v_category then raise exception 'Một set chỉ gồm các vị cùng loại'; end if;
        v_category := v_entry.category;
        v_jars := v_jars + v_entry.n;
        v_count := v_count + 1;
        v_pid := v_entry.pid;
        v_sum := case when v_sum is null or v_entry.price is null then null else v_sum + v_entry.n * v_entry.price end;
        v_detail := v_detail || case when v_detail = '' then '' else ' + ' end || v_entry.n || ' ' || v_entry.name;
      end loop;
      if v_jars <> v_size then raise exception 'Set % hũ phải chọn đủ % hũ', v_size, v_size; end if;

      v_unit := null;
      if v_count = 1 then
        select r.price into v_unit from public.storefront_set_prices r where r.store_id = v_store.id and r.set_size = v_size and r.product_id = v_pid;
      end if;
      if v_unit is null then
        select count(*) into v_line_size from public.products p
        where p.store_id = v_store.id
          and p.is_active
          and p.public_sale_mode = 'set'
          and p.category is not distinct from v_category
          and not (coalesce(p.category, '') = any (coalesce(v_store.public_hidden_categories, '{}')));
        if v_line_size >= 2 then
          select r.price into v_unit
          from public.storefront_set_prices r
          where r.store_id = v_store.id
            and r.set_size = v_size
            and r.product_id is null
            and (r.category = v_category or r.category is null)
          order by (r.category is null) asc
          limit 1;
        end if;
      end if;
      v_unit := coalesce(v_unit, v_sum);
      if v_unit is null then raise exception 'Set chưa có giá'; end if;
      v_out := v_out || jsonb_build_object('kind', 'set', 'size', v_size, 'mix', v_line -> 'mix', 'title', 'Set ' || v_size || ' hũ', 'detail', v_detail, 'qty', v_qty, 'unit_price', v_unit);
    else
      raise exception 'Loại món không hợp lệ';
    end if;
    v_total := v_total + v_unit * v_qty;
  end loop;

  if v_total >= 500000 and v_payment = 'cash' then
    raise exception 'Đơn từ 500.000đ bạn chuyển khoản trước giúp Hogi nhé';
  end if;

  loop
    v_try := v_try + 1;
    v_code := case when v_store.code = 'hogi' then 'HG' else upper(left(v_store.code, 2)) end
              || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YY')
              || lpad(extract(doy from (now() at time zone 'Asia/Ho_Chi_Minh'))::text, 3, '0')
              || (select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1), '') from generate_series(1, 4));
    exit when not exists (select 1 from public.preorders p where p.store_id = v_store.id and p.code = v_code) or v_try >= 8;
  end loop;

  insert into public.preorders (store_id, code, customer_name, customer_domain, floor, payment, lines, total)
  values (v_store.id, v_code, v_name, v_domain, v_floor, v_payment, v_out, v_total);

  return jsonb_build_object('code', v_code, 'total', v_total, 'lines', v_out);
end;
$$;
revoke execute on function public.submit_preorder(text, jsonb) from public;
grant execute on function public.submit_preorder(text, jsonb) to anon, authenticated;
