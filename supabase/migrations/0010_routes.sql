-- Scorpion Chemical v2.1 (16 Nov 2026)
--  * Order takers add their own customers (no approval; admin is told).
--  * Shop location on customers (saved from the phone at the shop).
--  * Route plan per order taker: a cycle of days (default 30) with customers for each day,
--    an optional weekly off day, today's route with visits (from live location) and orders,
--    and an evening notification with tomorrow's route.

-- =====================================================================
-- Schema
-- =====================================================================
alter table public.customers
  add column lat double precision check (lat between -90 and 90),
  add column lng double precision check (lng between -180 and 180),
  add column location_at timestamptz,
  add column added_by uuid references public.profiles(id);

create table public.route_plans (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  start_date  date not null,
  cycle_days  integer not null default 30 check (cycle_days between 1 and 60),
  off_day     integer check (off_day between 0 and 6),   -- 0 = Sunday ... 6 = Saturday, null = none
  updated_at  timestamptz not null default now()
);
create table public.route_days (
  user_id  uuid not null references public.profiles(id) on delete cascade,
  day_no   integer not null check (day_no between 1 and 60),
  label    text,
  primary key (user_id, day_no)
);
create table public.route_stops (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  day_no      integer not null check (day_no between 1 and 60),
  customer_id uuid not null references public.customers(id) on delete cascade,
  sort_order  integer not null default 0,
  primary key (user_id, day_no, customer_id)
);
create index route_stops_customer_idx on public.route_stops(customer_id);
alter table public.route_plans enable row level security;
alter table public.route_days enable row level security;
alter table public.route_stops enable row level security;
revoke all on public.route_plans, public.route_days, public.route_stops from anon, authenticated;

-- =====================================================================
-- Helpers
-- =====================================================================
-- Which day of the cycle a date is (1..cycle_days), or null: no plan, before the start, or the off day.
-- Off days are not counted, so the cycle continues on the next working day.
create or replace function app.route_day_no(p_user_id uuid, p_date date) returns integer
language plpgsql stable security definer set search_path = public, app as $$
declare r public.route_plans; n integer;
begin
  select * into r from public.route_plans where user_id = p_user_id;
  if not found or p_date < r.start_date then return null; end if;
  if r.off_day is not null and extract(dow from p_date)::int = r.off_day then return null; end if;
  select count(*) into n from generate_series(r.start_date, p_date - 1, interval '1 day') g
   where r.off_day is null or extract(dow from g)::int <> r.off_day;
  return (n % r.cycle_days) + 1;
end $$;

-- distance in metres
create or replace function app.metres(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
         + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;
alter function app.metres(double precision, double precision, double precision, double precision) set search_path = pg_catalog;

create or replace function app.route_user(me public.profiles, p_user_id uuid) returns public.profiles
language plpgsql stable security definer set search_path = public, app as $$
declare u public.profiles;
begin
  if me.role = 'order_taker' then
    if p_user_id is not null and p_user_id <> me.id then raise exception 'You can only see your own route'; end if;
    return me;
  end if;
  if me.role <> 'admin' then raise exception 'You are not allowed to do this'; end if;
  select * into u from public.profiles where id = p_user_id and role = 'order_taker';
  if not found then raise exception 'Order taker not found'; end if;
  return u;
end $$;

-- =====================================================================
-- Customers: order takers add and edit their own; shop location
-- =====================================================================
create or replace function public.customer_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  me public.profiles := app.require('admin', 'order_taker');
  taker boolean := me.role = 'order_taker';
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_taker uuid := nullif(p->>'order_taker_id', '')::uuid;
  v_opening numeric := coalesce(nullif(p->>'opening_balance', '')::numeric, 0);
  v_disc numeric := coalesce(nullif(p->>'default_discount_pct', '')::numeric, 0);
  v_type text := app.customer_type(p->>'type');
  v_days int := nullif(p->>'credit_days', '')::int;
  v_issued date := app.try_date(p->>'licence_issued');
  v_expiry date := app.try_date(p->>'licence_expiry');
  v_lat double precision := nullif(p->>'lat', '')::double precision;
  v_lng double precision := nullif(p->>'lng', '')::double precision;
  c public.customers;
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Name is required'; end if;
  if v_type is null then raise exception 'Choose the customer type'; end if;
  if v_disc < 0 or v_disc > 100 then raise exception 'Discount must be between 0 and 100'; end if;
  if v_days is not null and (v_days < 0 or v_days > 365) then raise exception 'Credit days must be between 0 and 365'; end if;
  if nullif(p->>'licence_issued', '') is not null and v_issued is null then raise exception 'Licence issue date is not a valid date'; end if;
  if nullif(p->>'licence_expiry', '') is not null and v_expiry is null then raise exception 'Licence expiry date is not a valid date'; end if;
  if v_issued is not null and v_expiry is not null and v_expiry < v_issued then
    raise exception 'Licence expiry date is before the issue date';
  end if;
  if not taker and v_taker is not null and not exists (
       select 1 from public.profiles where id = v_taker and role = 'order_taker') then
    raise exception 'Selected order taker was not found';
  end if;
  if (v_lat is null) <> (v_lng is null) then raise exception 'Shop location is incomplete'; end if;

  if v_id is null then
    if taker then
      -- an order taker's new customer is theirs; money terms are set by the admin
      v_taker := me.id; v_disc := 0; v_days := null; v_opening := 0;
    end if;
    if exists (select 1 from public.customers where lower(name) = lower(trim(p->>'name'))
                 and lower(coalesce(city, '')) = lower(coalesce(trim(p->>'city'), ''))) then
      raise exception 'A customer called % is already in the app', trim(p->>'name');
    end if;
    insert into public.customers(type, name, owner_name, phone, address, city, order_taker_id,
                                 default_discount_pct, is_active, credit_days, licence_no, licence_issued, licence_expiry,
                                 lat, lng, location_at, added_by)
    values (v_type, trim(p->>'name'), nullif(trim(p->>'owner_name'), ''),
            nullif(app.norm_phone(p->>'phone'), ''), nullif(trim(p->>'address'), ''),
            nullif(trim(p->>'city'), ''), v_taker, v_disc,
            case when taker then true else coalesce((p->>'is_active')::boolean, true) end,
            v_days, nullif(trim(p->>'licence_no'), ''), v_issued, v_expiry,
            v_lat, v_lng, case when v_lat is not null then now() end, me.id)
    returning id into v_id;
    if v_opening <> 0 then
      insert into public.ledger_entries(customer_id, kind, debit, credit, note, created_by)
      values (v_id, 'opening', greatest(v_opening, 0), greatest(-v_opening, 0), 'Opening balance', me.id);
    end if;
    perform app.log(me.id, 'customer_created', 'customer', v_id, p);
    if taker then
      perform app.notify_admins('New customer: ' || trim(p->>'name'),
        'Added by ' || me.full_name || coalesce(', ' || nullif(trim(p->>'city'), ''), '') || '. Set discount and credit days if needed.',
        'customer', 'customer', v_id, null, me.id);
    end if;
  else
    select * into c from public.customers where id = v_id for update;
    if not found then raise exception 'Customer not found'; end if;
    if taker then
      if c.order_taker_id is distinct from me.id then raise exception 'You do not have access to this customer'; end if;
      v_taker := c.order_taker_id; v_disc := c.default_discount_pct; v_days := c.credit_days;
    end if;
    if (c.type = 'distributor') <> (v_type = 'distributor')
       and exists (select 1 from public.profiles where customer_id = v_id) then
      raise exception 'This customer already has an app login, so it cannot be changed to or from Distributor';
    end if;
    update public.customers set
      type = v_type,
      name = trim(p->>'name'),
      owner_name = nullif(trim(p->>'owner_name'), ''),
      phone = nullif(app.norm_phone(p->>'phone'), ''),
      address = nullif(trim(p->>'address'), ''),
      city = nullif(trim(p->>'city'), ''),
      order_taker_id = v_taker,
      default_discount_pct = v_disc,
      credit_days = v_days,
      licence_no = nullif(trim(p->>'licence_no'), ''),
      licence_issued = v_issued,
      licence_expiry = v_expiry,
      is_active = case when taker then is_active else coalesce((p->>'is_active')::boolean, is_active) end
    where id = v_id;
    perform app.log(me.id, 'customer_updated', 'customer', v_id, p);
  end if;
  return v_id;
end $$;

create or replace function public.customers_list(p_search text default null, p_type text default null) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin', 'order_taker'); t date := app.today();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'type', c.type, 'name', c.name, 'owner_name', c.owner_name, 'phone', c.phone,
             'address', c.address, 'city', c.city, 'is_active', c.is_active,
             'default_discount_pct', c.default_discount_pct, 'credit_days', c.credit_days,
             'licence_no', c.licence_no, 'licence_expiry', c.licence_expiry,
             'licence_expired', c.licence_expiry < t,
             'has_location', c.lat is not null,
             'order_taker_id', c.order_taker_id, 'order_taker_name', tk.full_name,
             'balance', app.balance(c.id),
             'has_login', exists (select 1 from public.profiles u where u.customer_id = c.id))
           order by c.name)
    from public.customers c
    left join public.profiles tk on tk.id = c.order_taker_id
    where (me.role = 'admin' or (c.order_taker_id = me.id and c.is_active))
      and (p_type is null or c.type = p_type)
      and (coalesce(trim(p_search), '') = ''
           or c.name ilike '%' || trim(p_search) || '%'
           or coalesce(c.city, '') ilike '%' || trim(p_search) || '%'
           or coalesce(c.phone, '') ilike '%' || trim(p_search) || '%')), '[]'::jsonb);
end $$;

create or replace function public.customer_set_location(p_customer_id uuid, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin', 'order_taker');
begin
  perform app.assert_customer(me, p_customer_id);
  if (p_lat is null) <> (p_lng is null) then raise exception 'Location is incomplete'; end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180) then
    raise exception 'Location is not valid';
  end if;
  update public.customers set lat = p_lat, lng = p_lng, location_at = case when p_lat is null then null else now() end
   where id = p_customer_id;
  perform app.log(me.id, 'customer_location', 'customer', p_customer_id,
                  jsonb_build_object('lat', p_lat, 'lng', p_lng));
end $$;

create or replace function public.customer_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.me(); t date := app.today();
begin
  perform app.assert_customer(me, p_id);
  return (
    select jsonb_build_object(
      'id', c.id, 'type', c.type, 'name', c.name, 'owner_name', c.owner_name, 'phone', c.phone,
      'address', c.address, 'city', c.city, 'is_active', c.is_active,
      'default_discount_pct', c.default_discount_pct, 'credit_days', c.credit_days,
      'licence_no', c.licence_no, 'licence_issued', c.licence_issued, 'licence_expiry', c.licence_expiry,
      'licence_expired', c.licence_expiry < t,
      'lat', c.lat, 'lng', c.lng, 'location_at', c.location_at,
      'added_by_name', (select full_name from public.profiles where id = c.added_by),
      'order_taker_id', c.order_taker_id,
      'order_taker_name', (select full_name from public.profiles where id = c.order_taker_id),
      'balance', app.balance(c.id),
      'opening_balance', (select coalesce(sum(debit - credit), 0) from public.ledger_entries
                           where customer_id = c.id and kind = 'opening'),
      'overdue_amount', (select coalesce(sum(x.remaining), 0) from app.order_dues(c.id) x
                          join public.orders o on o.id = x.order_id where x.remaining > 0 and o.due_date < t),
      'open_orders', (select count(*) from public.orders o where o.customer_id = c.id
                       and o.status in ('pending', 'confirmed', 'dispatched')),
      'route_days', (select coalesce(jsonb_agg(s.day_no order by s.day_no), '[]'::jsonb)
                       from public.route_stops s where s.customer_id = c.id and s.user_id = c.order_taker_id),
      'logins', case when me.role = 'admin' then coalesce((
                  select jsonb_agg(jsonb_build_object('id', u.id, 'full_name', u.full_name,
                                                      'phone', u.phone, 'is_active', u.is_active))
                    from public.profiles u where u.customer_id = c.id), '[]'::jsonb) end)
    from public.customers c where c.id = p_id);
end $$;

-- =====================================================================
-- Route plans
-- =====================================================================
create or replace function public.route_plan_get(p_user_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  me public.profiles := app.me();
  u public.profiles := app.route_user(me, p_user_id);
  r public.route_plans;
  t date := app.today();
  n integer;
begin
  select * into r from public.route_plans where user_id = u.id;
  n := coalesce(r.cycle_days, 30);
  return jsonb_build_object(
    'user', jsonb_build_object('id', u.id, 'name', u.full_name),
    'plan', case when r.user_id is null then null else
              jsonb_build_object('start_date', r.start_date, 'cycle_days', r.cycle_days, 'off_day', r.off_day) end,
    'today', jsonb_build_object('date', t, 'day_no', app.route_day_no(u.id, t)),
    'tomorrow', jsonb_build_object('date', t + 1, 'day_no', app.route_day_no(u.id, t + 1)),
    'days', (
      select jsonb_agg(jsonb_build_object(
               'day_no', g, 'label', d.label,
               'customers', coalesce((
                 select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city,
                                                     'has_location', c.lat is not null)
                                  order by s.sort_order, c.name)
                   from public.route_stops s join public.customers c on c.id = s.customer_id
                  where s.user_id = u.id and s.day_no = g), '[]'::jsonb))
             order by g)
        from generate_series(1, n) g
        left join public.route_days d on d.user_id = u.id and d.day_no = g),
    'unplanned', (
      select count(*) from public.customers c
       where c.order_taker_id = u.id and c.is_active
         and not exists (select 1 from public.route_stops s where s.user_id = u.id and s.customer_id = c.id
                           and s.day_no <= n)));
end $$;

create or replace function public.route_plan_save(p_user_id uuid, p_start_date date, p_cycle_days integer default 30,
                                                  p_off_day integer default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin'); u public.profiles := app.route_user(me, p_user_id);
begin
  if p_start_date is null then raise exception 'Choose the date of Day 1'; end if;
  if p_cycle_days is null or p_cycle_days not between 1 and 60 then raise exception 'Days in the plan must be 1 to 60'; end if;
  if p_off_day is not null and p_off_day not between 0 and 6 then raise exception 'Choose a valid off day'; end if;
  insert into public.route_plans(user_id, start_date, cycle_days, off_day)
  values (u.id, p_start_date, p_cycle_days, p_off_day)
  on conflict (user_id) do update set start_date = excluded.start_date, cycle_days = excluded.cycle_days,
                                      off_day = excluded.off_day, updated_at = now();
  perform app.log(me.id, 'route_plan', 'profile', u.id,
                  jsonb_build_object('start_date', p_start_date, 'cycle_days', p_cycle_days, 'off_day', p_off_day));
end $$;

-- Sets one day of the plan. Customers with no order taker are given to this order taker.
create or replace function public.route_day_save(p_user_id uuid, p_day_no integer, p_label text, p_customers jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
declare
  me public.profiles := app.require('admin'); u public.profiles := app.route_user(me, p_user_id); v_other text;
  p_customer_ids uuid[];
begin
  if p_customers is not null and jsonb_typeof(p_customers) <> 'array' then raise exception 'Customers must be a list'; end if;
  select coalesce(array_agg(x::uuid order by n), '{}') into p_customer_ids
    from jsonb_array_elements_text(coalesce(p_customers, '[]'::jsonb)) with ordinality e(x, n);
  if p_day_no is null or p_day_no not between 1 and 60 then raise exception 'Day must be 1 to 60'; end if;
  select string_agg(c.name || ' (' || o.full_name || ')', ', ') into v_other
    from public.customers c join public.profiles o on o.id = c.order_taker_id
   where c.id = any(coalesce(p_customer_ids, '{}')) and c.order_taker_id <> u.id;
  if v_other is not null then
    raise exception 'These customers belong to another order taker: %. Change their order taker first.', v_other;
  end if;
  if exists (select 1 from unnest(coalesce(p_customer_ids, '{}')) x where not exists (select 1 from public.customers c where c.id = x)) then
    raise exception 'A customer was not found';
  end if;
  update public.customers set order_taker_id = u.id
   where id = any(coalesce(p_customer_ids, '{}')) and order_taker_id is null;

  insert into public.route_days(user_id, day_no, label) values (u.id, p_day_no, nullif(trim(coalesce(p_label, '')), ''))
  on conflict (user_id, day_no) do update set label = excluded.label;
  delete from public.route_stops where user_id = u.id and day_no = p_day_no;
  insert into public.route_stops(user_id, day_no, customer_id, sort_order)
  select u.id, p_day_no, x.id, x.n from unnest(coalesce(p_customer_ids, '{}')) with ordinality x(id, n)
  on conflict do nothing;
  perform app.log(me.id, 'route_day', 'profile', u.id,
                  jsonb_build_object('day', p_day_no, 'label', p_label, 'customers', coalesce(array_length(p_customer_ids, 1), 0)));
end $$;

-- A day's route with what happened: visited (live location came within ~120 m of the shop)
-- and orders taken for each customer on the plan, plus orders off the plan.
create or replace function public.route_visits(p_user_id uuid default null, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  me public.profiles := app.me();
  u public.profiles := app.route_user(me, p_user_id);
  d date := coalesce(p_date, app.today());
  d0 timestamptz := (d::timestamp at time zone 'Asia/Karachi');
  d1 timestamptz := ((d + 1)::timestamp at time zone 'Asia/Karachi');
  v_day integer := app.route_day_no(u.id, d);
  r public.route_plans;
begin
  select * into r from public.route_plans where user_id = u.id;
  return (
    with st as (
      select c.id, c.name, c.city, c.address, c.phone, c.lat, c.lng, s.sort_order
        from public.route_stops s join public.customers c on c.id = s.customer_id
       where s.user_id = u.id and s.day_no = v_day
    ), vis as (
      select st.id, min(p.recorded_at) as at
        from st join public.location_points p
          on p.user_id = u.id and p.recorded_at >= d0 and p.recorded_at < d1
         and st.lat is not null
         and abs(p.lat - st.lat) < 0.003 and abs(p.lng - st.lng) < 0.004
         and app.metres(p.lat, p.lng, st.lat, st.lng) <= 120 + least(coalesce(p.accuracy, 0), 80)
       group by st.id
    ), ord as (
      select o.customer_id, min(o.id::text)::uuid as order_id, sum(o.total) as total
        from public.orders o
       where o.created_at >= d0 and o.created_at < d1 and o.status <> 'cancelled' and not o.is_opening
         and (o.created_by = u.id or o.customer_id in (select id from st))
       group by o.customer_id
    )
    select jsonb_build_object(
      'user', jsonb_build_object('id', u.id, 'name', u.full_name),
      'date', d,
      'has_plan', r.user_id is not null,
      'day_no', v_day,
      'off_day', r.user_id is not null and d >= r.start_date and v_day is null,
      'label', (select label from public.route_days where user_id = u.id and day_no = v_day),
      'stops', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'customer_id', st.id, 'name', st.name, 'city', st.city, 'address', st.address, 'phone', st.phone,
                 'lat', st.lat, 'lng', st.lng, 'has_location', st.lat is not null,
                 'visited', vis.at is not null, 'visited_at', vis.at,
                 'ordered', ord.order_id is not null, 'order_id', ord.order_id, 'order_total', ord.total)
               order by st.sort_order, st.name)
          from st left join vis on vis.id = st.id left join ord on ord.customer_id = st.id), '[]'::jsonb),
      'visited', (select count(*) from vis),
      'ordered', (select count(*) from ord where customer_id in (select id from st)),
      'off_route_orders', coalesce((
        select jsonb_agg(jsonb_build_object('customer_id', c.id, 'name', c.name, 'order_id', ord.order_id, 'total', ord.total))
          from ord join public.customers c on c.id = ord.customer_id
         where ord.customer_id not in (select id from st)), '[]'::jsonb)));
end $$;

-- Every evening: tomorrow's route for each order taker (in the app's notification list).
create or replace function app.route_reminders() returns integer
language plpgsql security definer set search_path = public, app as $$
declare t date := app.today() + 1; n integer := 0; r record;
begin
  for r in
    select u.id, app.route_day_no(u.id, t) as day_no
      from public.profiles u join public.route_plans p on p.user_id = u.id
     where u.role = 'order_taker' and u.is_active
  loop
    if r.day_no is null then continue; end if;
    insert into public.notifications(user_id, title, body, kind, dedupe_key)
    select r.id,
           'Tomorrow''s route: Day ' || r.day_no || coalesce(', ' || d.label, ''),
           (select count(*) from public.route_stops s where s.user_id = r.id and s.day_no = r.day_no) || ' customers to visit on '
             || to_char(t, 'Dy DD Mon') || '. Open the app to see the list.',
           'route', 'route:' || t
      from (select 1) x left join public.route_days d on d.user_id = r.id and d.day_no = r.day_no
    on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

-- =====================================================================
-- Permissions
-- =====================================================================
revoke execute on function
  public.customer_set_location(uuid, double precision, double precision),
  public.route_plan_get(uuid), public.route_plan_save(uuid, date, integer, integer),
  public.route_day_save(uuid, integer, text, jsonb), public.route_visits(uuid, date)
  from public, anon;
grant execute on function
  public.customer_set_location(uuid, double precision, double precision),
  public.route_plan_get(uuid), public.route_plan_save(uuid, date, integer, integer),
  public.route_day_save(uuid, integer, text, jsonb), public.route_visits(uuid, date)
  to authenticated;
