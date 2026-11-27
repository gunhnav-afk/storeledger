-- =============================================================================
-- Cơ sở dữ liệu ĐỘC LẬP 100% của Thiên Bảo Clothes (Project: zfawfaqqvfqzydnhrhkq)
-- Không liên kết hay phụ thuộc bất kỳ bảng nào của hệ thống Sổ Xanh / Hogi Food.
-- Gồm đúng 4 bảng cốt lõi:
--   1. public.profiles          — Hồ sơ nhân sự & phân quyền xưởng may
--   2. public.workshop_settings — Cấu hình mã QR tĩnh, toạ độ Google Maps & giờ ca
--   3. public.attendance_logs   — Nhật ký chấm công QR + GPS & tính giờ công
--   4. public.production_orders — Sổ theo dõi mã hàng / lệnh sản xuất xưởng may
-- =============================================================================

-- Tự động bật RLS cho mọi bảng tạo mới trong schema public
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name = 'public' then
      execute format('alter table if exists %s enable row level security', cmd.object_identity);
    end if;
  end loop;
end;
$$;

drop event trigger if exists ensure_rls;
create event trigger ensure_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. Bảng hồ sơ nhân sự xưởng may (1-1 với auth.users)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  full_name    text,
  role         text not null default 'staff'
               check (role in ('super_admin', 'manager', 'staff')),
  status       text not null default 'pending'
               check (status in ('pending', 'approved', 'rejected')),
  worker_code  text,
  department   text not null default 'May'
               check (department in ('Cắt', 'May', 'Ủi', 'Đóng gói', 'Phụ xưởng', 'Quản lý')),
  phone        text,
  note         text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Các hàm kiểm tra quyền (SECURITY DEFINER + search_path = '')
create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    (select (p.role = 'super_admin' and p.status = 'approved')
     from public.profiles p
     where p.id = auth.uid()),
    false
  );
$$;

revoke execute on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

create or replace function public.is_manager()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    (select (p.role in ('super_admin', 'manager') and p.status = 'approved')
     from public.profiles p
     where p.id = auth.uid()),
    false
  );
$$;

revoke execute on function public.is_manager() from public, anon;
grant execute on function public.is_manager() to authenticated;

create or replace function public.is_approved_member()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    (select (p.status = 'approved')
     from public.profiles p
     where p.id = auth.uid()),
    false
  );
$$;

revoke execute on function public.is_approved_member() from public, anon;
grant execute on function public.is_approved_member() to authenticated;

-- Trigger tự tạo hồ sơ khi có tài khoản mới (hungng28900@gmail.com tự nhận quyền chủ xưởng super_admin)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email     text := lower(coalesce(new.email, ''));
  v_is_owner  boolean := false;
  v_full_name text;
begin
  if v_email = 'hungng28900@gmail.com' then
    v_is_owner := true;
  elsif not exists (
    select 1 from public.profiles where role in ('super_admin', 'manager') and status = 'approved'
  ) then
    v_is_owner := true;
  end if;

  v_full_name := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    split_part(v_email, '@', 1)
  );

  insert into public.profiles (id, email, full_name, role, status, department)
  values (
    new.id,
    new.email,
    v_full_name,
    case when v_is_owner then 'super_admin' else 'staff' end,
    case when v_is_owner then 'approved' else 'pending' end,
    case when v_is_owner then 'Quản lý' else 'May' end
  )
  on conflict (id) do update set
    email     = coalesce(excluded.email, public.profiles.email),
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    role      = case when v_is_owner then 'super_admin' else public.profiles.role end,
    status    = case when v_is_owner then 'approved' else public.profiles.status end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id or (select public.is_manager()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

revoke all on public.profiles from anon;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Bảng cấu hình xưởng may, mã QR tĩnh & toạ độ Google Maps (1 dòng duy nhất id = 1)
-- -----------------------------------------------------------------------------
create table if not exists public.workshop_settings (
  id                  integer primary key default 1 check (id = 1),
  qr_token            text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  workshop_address    text default 'Xưởng may Thiên Bảo Clothes',
  latitude            double precision check (latitude is null or (latitude >= -90 and latitude <= 90)),
  longitude           double precision check (longitude is null or (longitude >= -180 and longitude <= 180)),
  allowed_radius_m    integer not null default 100 check (allowed_radius_m between 20 and 2000),
  max_gps_accuracy_m  integer not null default 200 check (max_gps_accuracy_m between 20 and 1000),
  shift_start         time not null default '07:30',
  shift_end           time not null default '17:00',
  break_start         time not null default '11:30',
  break_end           time not null default '12:30',
  updated_at          timestamptz not null default now()
);

alter table public.workshop_settings enable row level security;

insert into public.workshop_settings (id, workshop_address)
values (1, 'Xưởng may Thiên Bảo Clothes')
on conflict (id) do nothing;

-- Chỉ quản lý đọc/sửa trực tiếp bảng này (nhân viên đọc cấu hình qua RPC không chứa qr_token)
drop policy if exists workshop_settings_select_manager on public.workshop_settings;
create policy workshop_settings_select_manager on public.workshop_settings
  for select to authenticated
  using ((select public.is_manager()));

drop policy if exists workshop_settings_update_manager on public.workshop_settings;
create policy workshop_settings_update_manager on public.workshop_settings
  for update to authenticated
  using ((select public.is_manager()))
  with check ((select public.is_manager()));

drop policy if exists workshop_settings_insert_manager on public.workshop_settings;
create policy workshop_settings_insert_manager on public.workshop_settings
  for insert to authenticated
  with check ((select public.is_manager()));

revoke all on public.workshop_settings from anon;
grant select, insert, update on public.workshop_settings to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Bảng nhật ký chấm công & giờ công
-- -----------------------------------------------------------------------------
create table if not exists public.attendance_logs (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles (id) on delete cascade,
  work_date            date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  check_in_at          timestamptz not null default now(),
  check_out_at         timestamptz,
  check_in_lat         double precision,
  check_in_lng         double precision,
  check_in_distance_m  numeric(8,1),
  check_out_lat        double precision,
  check_out_lng        double precision,
  check_out_distance_m numeric(8,1),
  worked_minutes       integer not null default 0 check (worked_minutes >= 0),
  source               text not null default 'qr_gps' check (source in ('qr_gps', 'manual')),
  note                 text,
  adjusted_by          uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  check (check_out_at is null or check_out_at >= check_in_at)
);

create index if not exists attendance_logs_date_idx on public.attendance_logs (work_date desc, check_in_at desc);
create index if not exists attendance_logs_user_date_idx on public.attendance_logs (user_id, work_date desc);
create index if not exists attendance_logs_adjusted_by_idx on public.attendance_logs (adjusted_by);

alter table public.attendance_logs enable row level security;

drop policy if exists attendance_logs_select on public.attendance_logs;
create policy attendance_logs_select on public.attendance_logs
  for select to authenticated
  using ((select public.is_manager()) or (select auth.uid()) = user_id);

revoke all on public.attendance_logs from anon;
grant select on public.attendance_logs to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Bảng sổ quản lý mã hàng / lệnh sản xuất xưởng may
-- -----------------------------------------------------------------------------
create table if not exists public.production_orders (
  id             uuid primary key default gen_random_uuid(),
  order_code     text not null unique check (char_length(btrim(order_code)) between 1 and 50),
  style_name     text not null check (char_length(btrim(style_name)) between 1 and 200),
  customer_name  text,
  planned_qty    integer not null check (planned_qty > 0 and planned_qty <= 1000000),
  completed_qty  integer not null default 0 check (completed_qty >= 0 and completed_qty <= 1000000),
  status         text not null default 'cutting'
                 check (status in ('pending', 'cutting', 'sewing', 'finishing', 'completed', 'cancelled')),
  received_date  date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  due_date       date,
  note           text,
  created_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists production_orders_status_due_idx on public.production_orders (status, due_date);
create index if not exists production_orders_created_by_idx on public.production_orders (created_by);

alter table public.production_orders enable row level security;

drop policy if exists production_orders_select on public.production_orders;
create policy production_orders_select on public.production_orders
  for select to authenticated
  using ((select public.is_approved_member()));

drop policy if exists production_orders_insert_manager on public.production_orders;
create policy production_orders_insert_manager on public.production_orders
  for insert to authenticated
  with check ((select public.is_manager()));

drop policy if exists production_orders_update_manager on public.production_orders;
create policy production_orders_update_manager on public.production_orders
  for update to authenticated
  using ((select public.is_manager()))
  with check ((select public.is_manager()));

drop policy if exists production_orders_delete_manager on public.production_orders;
create policy production_orders_delete_manager on public.production_orders
  for delete to authenticated
  using ((select public.is_manager()));

revoke all on public.production_orders from anon;
grant select, insert, update, delete on public.production_orders to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Các hàm RPC tính khoảng cách GPS Haversine, tính giờ công & quản lý nhân sự
-- -----------------------------------------------------------------------------

create or replace function public.haversine_meters(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 6371000.0 * 2.0 * asin(
    least(
      1.0,
      sqrt(
        power(sin(radians(p_lat2 - p_lat1) / 2.0), 2) +
        cos(radians(p_lat1)) * cos(radians(p_lat2)) *
        power(sin(radians(p_lng2 - p_lng1) / 2.0), 2)
      )
    )
  );
$$;

revoke execute on function public.haversine_meters(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.haversine_meters(double precision, double precision, double precision, double precision) to authenticated;

create or replace function public.calc_worked_minutes(
  p_check_in    timestamptz,
  p_check_out   timestamptz,
  p_break_start time,
  p_break_end   time
)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total_min   integer;
  v_in_vn       timestamp;
  v_out_vn      timestamp;
  v_b_start     timestamp;
  v_b_end       timestamp;
  v_overlap_min integer := 0;
begin
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in then
    return 0;
  end if;

  v_total_min := greatest(0, floor(extract(epoch from (p_check_out - p_check_in)) / 60.0)::integer);

  if p_break_start is not null and p_break_end is not null and p_break_end > p_break_start then
    v_in_vn   := p_check_in at time zone 'Asia/Ho_Chi_Minh';
    v_out_vn  := p_check_out at time zone 'Asia/Ho_Chi_Minh';
    v_b_start := date_trunc('day', v_in_vn) + p_break_start;
    v_b_end   := date_trunc('day', v_in_vn) + p_break_end;

    if v_out_vn > v_b_start and v_in_vn < v_b_end then
      v_overlap_min := greatest(
        0,
        floor(extract(epoch from (least(v_out_vn, v_b_end) - greatest(v_in_vn, v_b_start))) / 60.0)::integer
      );
    end if;
  end if;

  return greatest(0, v_total_min - v_overlap_min);
end;
$$;

revoke execute on function public.calc_worked_minutes(timestamptz, timestamptz, time, time) from public, anon;
grant execute on function public.calc_worked_minutes(timestamptz, timestamptz, time, time) to authenticated;

create or replace function public.get_workshop_public_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.workshop_settings%rowtype;
begin
  if not public.is_approved_member() then
    raise exception 'Tài khoản của bạn chưa được duyệt vào xưởng Thiên Bảo Clothes' using errcode = '42501';
  end if;

  select * into v_row from public.workshop_settings where id = 1;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'workshop_address', v_row.workshop_address,
    'latitude', v_row.latitude,
    'longitude', v_row.longitude,
    'allowed_radius_m', v_row.allowed_radius_m,
    'max_gps_accuracy_m', v_row.max_gps_accuracy_m,
    'shift_start', to_char(v_row.shift_start, 'HH24:MI'),
    'shift_end', to_char(v_row.shift_end, 'HH24:MI'),
    'break_start', to_char(v_row.break_start, 'HH24:MI'),
    'break_end', to_char(v_row.break_end, 'HH24:MI'),
    'is_manager', public.is_manager()
  );
end;
$$;

revoke execute on function public.get_workshop_public_config() from public, anon;
grant execute on function public.get_workshop_public_config() to authenticated;

create or replace function public.rotate_workshop_qr()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_manager() then
    raise exception 'Chỉ quản lý xưởng được đổi mã QR' using errcode = '42501';
  end if;

  insert into public.workshop_settings (id, qr_token, updated_at)
  values (1, v_new_token, now())
  on conflict (id) do update
    set qr_token   = v_new_token,
        updated_at = now();

  return v_new_token;
end;
$$;

revoke execute on function public.rotate_workshop_qr() from public, anon;
grant execute on function public.rotate_workshop_qr() to authenticated;

create or replace function public.submit_qr_attendance(
  p_qr_token   text,
  p_lat        double precision,
  p_lng        double precision,
  p_accuracy_m double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_settings   public.workshop_settings%rowtype;
  v_now        timestamptz := now();
  v_today      date := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
  v_distance   double precision;
  v_open_row   public.attendance_logs%rowtype;
  v_last_touch timestamptz;
  v_worked_min integer;
  v_record_id  uuid;
begin
  if v_uid is null or not public.is_approved_member() then
    raise exception 'Tài khoản chưa đăng nhập hoặc chưa được duyệt vào xưởng' using errcode = '42501';
  end if;

  if coalesce(btrim(p_qr_token), '') = '' then
    raise exception 'Thiếu mã QR chấm công';
  end if;

  select * into v_settings
  from public.workshop_settings
  where id = 1 and qr_token = btrim(p_qr_token);

  if not found then
    raise exception 'Mã QR không hợp lệ hoặc đã được quản lý đổi mới';
  end if;

  if v_settings.latitude is null or v_settings.longitude is null then
    raise exception 'Quản lý chưa cài đặt vị trí bản đồ của xưởng may';
  end if;

  if p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'Không đọc được toạ độ GPS hợp lệ từ thiết bị';
  end if;

  if p_accuracy_m is not null and p_accuracy_m > v_settings.max_gps_accuracy_m then
    raise exception 'Tín hiệu định vị đang sai số quá lớn (±%m, cho phép tối đa ±%m). Hãy bật Vị trí chính xác trên điện thoại và đứng gần cửa thoáng hơn',
      round(p_accuracy_m::numeric, 0), v_settings.max_gps_accuracy_m;
  end if;

  v_distance := public.haversine_meters(v_settings.latitude, v_settings.longitude, p_lat, p_lng);

  if v_distance > v_settings.allowed_radius_m then
    raise exception 'Vị trí không hợp lệ: bạn đang cách xưởng %m (phạm vi cho phép tối đa %m)',
      round(v_distance::numeric, 0), v_settings.allowed_radius_m;
  end if;

  select greatest(a.check_in_at, coalesce(a.check_out_at, a.check_in_at))
  into v_last_touch
  from public.attendance_logs a
  where a.user_id = v_uid
  order by greatest(a.check_in_at, coalesce(a.check_out_at, a.check_in_at)) desc
  limit 1;

  if v_last_touch is not null and extract(epoch from (v_now - v_last_touch)) < 90 then
    raise exception 'Bạn vừa chấm công xong, vui lòng đợi ít nhất 2 phút trước khi quét tiếp';
  end if;

  select * into v_open_row
  from public.attendance_logs a
  where a.user_id = v_uid
    and a.work_date = v_today
    and a.check_out_at is null
  order by a.check_in_at desc
  limit 1
  for update;

  if not found then
    insert into public.attendance_logs (
      user_id, work_date, check_in_at,
      check_in_lat, check_in_lng, check_in_distance_m, source
    )
    values (
      v_uid, v_today, v_now,
      p_lat, p_lng, round(v_distance::numeric, 1), 'qr_gps'
    )
    returning id into v_record_id;

    return jsonb_build_object(
      'id', v_record_id,
      'action', 'check_in',
      'timestamp', v_now,
      'distance_m', round(v_distance::numeric, 1),
      'worked_minutes', 0
    );
  else
    v_worked_min := public.calc_worked_minutes(
      v_open_row.check_in_at,
      v_now,
      v_settings.break_start,
      v_settings.break_end
    );

    update public.attendance_logs
    set check_out_at         = v_now,
        check_out_lat        = p_lat,
        check_out_lng        = p_lng,
        check_out_distance_m = round(v_distance::numeric, 1),
        worked_minutes       = v_worked_min
    where id = v_open_row.id
    returning id into v_record_id;

    return jsonb_build_object(
      'id', v_record_id,
      'action', 'check_out',
      'timestamp', v_now,
      'distance_m', round(v_distance::numeric, 1),
      'worked_minutes', v_worked_min
    );
  end if;
end;
$$;

revoke execute on function public.submit_qr_attendance(text, double precision, double precision, double precision) from public, anon;
grant execute on function public.submit_qr_attendance(text, double precision, double precision, double precision) to authenticated;

create or replace function public.admin_upsert_attendance(
  p_attendance_id uuid,
  p_user_id       uuid,
  p_work_date     date,
  p_check_in_at   timestamptz,
  p_check_out_at  timestamptz,
  p_note          text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings   public.workshop_settings%rowtype;
  v_worked_min integer := 0;
  v_id         uuid;
begin
  if not public.is_manager() then
    raise exception 'Chỉ quản lý xưởng được chỉnh sửa bảng chấm công' using errcode = '42501';
  end if;

  if p_work_date is null or p_work_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'Không được chấm công cho ngày trong tương lai';
  end if;

  if p_check_in_at is null then
    raise exception 'Vui lòng nhập giờ vào ca';
  end if;

  if p_check_out_at is not null and p_check_out_at <= p_check_in_at then
    raise exception 'Giờ tan ca phải sau giờ vào ca';
  end if;

  select * into v_settings from public.workshop_settings where id = 1;

  if p_check_out_at is not null then
    v_worked_min := public.calc_worked_minutes(
      p_check_in_at,
      p_check_out_at,
      coalesce(v_settings.break_start, '11:30'::time),
      coalesce(v_settings.break_end, '12:30'::time)
    );
  end if;

  if p_attendance_id is null then
    insert into public.attendance_logs (
      user_id, work_date, check_in_at, check_out_at,
      worked_minutes, source, note, adjusted_by
    )
    values (
      p_user_id, p_work_date, p_check_in_at, p_check_out_at,
      v_worked_min, 'manual', nullif(btrim(coalesce(p_note, '')), ''), auth.uid()
    )
    returning id into v_id;
  else
    update public.attendance_logs
    set user_id        = p_user_id,
        work_date      = p_work_date,
        check_in_at    = p_check_in_at,
        check_out_at   = p_check_out_at,
        worked_minutes = v_worked_min,
        note           = nullif(btrim(coalesce(p_note, '')), ''),
        adjusted_by    = auth.uid()
    where id = p_attendance_id
    returning id into v_id;

    if not found then
      raise exception 'Không tìm thấy dòng chấm công cần sửa';
    end if;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.admin_upsert_attendance(uuid, uuid, date, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.admin_upsert_attendance(uuid, uuid, date, timestamptz, timestamptz, text) to authenticated;

create or replace function public.admin_delete_attendance(p_attendance_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'Chỉ quản lý xưởng được xoá dòng chấm công' using errcode = '42501';
  end if;

  delete from public.attendance_logs where id = p_attendance_id;
end;
$$;

revoke execute on function public.admin_delete_attendance(uuid) from public, anon;
grant execute on function public.admin_delete_attendance(uuid) to authenticated;

create or replace function public.workshop_list_staff()
returns table (
  user_id         uuid,
  email           text,
  full_name       text,
  role            text,
  status          text,
  worker_code     text,
  department      text,
  phone           text,
  note            text,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'Chỉ quản lý xưởng được xem danh sách nhân sự' using errcode = '42501';
  end if;

  return query
  select
    p.id as user_id,
    coalesce(u.email::text, p.email, '') as email,
    p.full_name,
    p.role,
    p.status,
    p.worker_code,
    p.department,
    p.phone,
    p.note,
    u.last_sign_in_at
  from public.profiles p
  left join auth.users u on u.id = p.id
  order by
    case when p.status = 'pending' then 0 when p.status = 'approved' then 1 else 2 end,
    case p.role when 'super_admin' then 0 when 'manager' then 1 else 2 end,
    p.full_name nulls last,
    u.email;
end;
$$;

revoke execute on function public.workshop_list_staff() from public, anon;
grant execute on function public.workshop_list_staff() to authenticated;

create or replace function public.workshop_approve_user(
  p_user_id     uuid,
  p_role        text default 'staff',
  p_department  text default 'May',
  p_worker_code text default null,
  p_phone       text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'Chỉ quản lý xưởng được duyệt tài khoản' using errcode = '42501';
  end if;

  if p_role not in ('super_admin', 'manager', 'staff') then
    raise exception 'Vai trò không hợp lệ';
  end if;

  if p_role = 'super_admin' and not public.is_super_admin() then
    raise exception 'Chỉ Chủ xưởng mới được cấp quyền Chủ xưởng';
  end if;

  if p_department not in ('Cắt', 'May', 'Ủi', 'Đóng gói', 'Phụ xưởng', 'Quản lý') then
    raise exception 'Tổ chuyên môn không hợp lệ';
  end if;

  update public.profiles
  set status      = 'approved',
      role        = p_role,
      department  = p_department,
      worker_code = coalesce(nullif(btrim(coalesce(p_worker_code, '')), ''), worker_code),
      phone       = coalesce(nullif(btrim(coalesce(p_phone, '')), ''), phone)
  where id = p_user_id;

  if not found then
    raise exception 'Không tìm thấy tài khoản';
  end if;
end;
$$;

revoke execute on function public.workshop_approve_user(uuid, text, text, text, text) from public, anon;
grant execute on function public.workshop_approve_user(uuid, text, text, text, text) to authenticated;

create or replace function public.workshop_reject_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_role  text;
begin
  if not public.is_manager() then
    raise exception 'Chỉ quản lý xưởng được khoá/từ chối tài khoản' using errcode = '42501';
  end if;

  select lower(coalesce(email, '')), role into v_email, v_role
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'Không tìm thấy tài khoản';
  end if;

  if v_email = 'hungng28900@gmail.com' or (v_role = 'super_admin' and not public.is_super_admin()) then
    raise exception 'Không thể khoá tài khoản Chủ xưởng';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Không thể tự khoá tài khoản của chính mình';
  end if;

  update public.profiles
  set status = 'rejected'
  where id = p_user_id;
end;
$$;

revoke execute on function public.workshop_reject_user(uuid) from public, anon;
grant execute on function public.workshop_reject_user(uuid) to authenticated;

create or replace function public.workshop_update_worker(
  p_user_id     uuid,
  p_full_name   text,
  p_role        text,
  p_worker_code text,
  p_department  text,
  p_phone       text,
  p_note        text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_role  text;
  v_target_email text;
begin
  if not public.is_manager() then
    raise exception 'Chỉ quản lý xưởng được sửa hồ sơ nhân sự' using errcode = '42501';
  end if;

  if p_role not in ('super_admin', 'manager', 'staff') then
    raise exception 'Vai trò không hợp lệ';
  end if;

  if p_department not in ('Cắt', 'May', 'Ủi', 'Đóng gói', 'Phụ xưởng', 'Quản lý') then
    raise exception 'Bộ phận chuyên môn không hợp lệ';
  end if;

  select role, lower(coalesce(email, '')) into v_target_role, v_target_email
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'Không tìm thấy nhân viên';
  end if;

  if (v_target_role = 'super_admin' or p_role = 'super_admin') and not public.is_super_admin() then
    raise exception 'Chỉ Chủ xưởng mới được thay đổi quyền Chủ xưởng';
  end if;

  if v_target_email = 'hungng28900@gmail.com' and p_role <> 'super_admin' then
    raise exception 'Không thể hạ quyền tài khoản Chủ xưởng gốc';
  end if;

  update public.profiles
  set full_name   = coalesce(nullif(btrim(coalesce(p_full_name, '')), ''), full_name),
      role        = p_role,
      worker_code = nullif(btrim(coalesce(p_worker_code, '')), ''),
      department  = p_department,
      phone       = nullif(btrim(coalesce(p_phone, '')), ''),
      note        = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_user_id;
end;
$$;

revoke execute on function public.workshop_update_worker(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.workshop_update_worker(uuid, text, text, text, text, text, text) to authenticated;
