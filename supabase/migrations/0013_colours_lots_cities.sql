-- Scorpion Chemical v2.3 (16 Nov 2026)
--  * Product colours (e.g. face masks in Black, Blue, Green, White): each colour is its own
--    product row with its own stock, linked by group_id; rates and details stay in step.
--  * Lot number on order lines, taken from the latest stock received with a lot number.
--  * Photo of the customer's drug licence.
--  * City-wise customers for order takers: who owes what, and what was collected.

alter table public.products add column colour text, add column group_id uuid;
create index products_group_idx on public.products(group_id) where group_id is not null;
alter table public.order_items add column lot_no text;
alter table public.customers add column licence_photo text;

-- Bonus (free goods) schemes, e.g. 100+2: with every 100 pieces, 2 more free.
-- A product can have a scheme for everyone; a customer can have their own (0 free = no scheme).
alter table public.products add column bonus_per integer check (bonus_per > 0), add column bonus_free integer check (bonus_free >= 0);
create table public.customer_schemes (
  customer_id uuid not null references public.customers(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  bonus_per   integer not null check (bonus_per > 0),
  bonus_free  integer not null check (bonus_free >= 0),
  primary key (customer_id, product_id)
);
alter table public.customer_schemes enable row level security;
revoke all on public.customer_schemes from anon, authenticated;
alter table public.order_items add column bonus_qty integer not null default 0 check (bonus_qty >= 0);

create or replace function app.scheme_for(p_customer_id uuid, p_product_id uuid, out per integer, out free integer)
language sql stable security definer set search_path = public, app as $$
  select coalesce(s.bonus_per, case when p.bonus_free > 0 then p.bonus_per end),
         coalesce(s.bonus_free, case when p.bonus_per > 0 then p.bonus_free end)
    from public.products p
    left join public.customer_schemes s on s.customer_id = p_customer_id and s.product_id = p.id
   where p.id = p_product_id
$$;

create or replace function app.bonus_for(p_customer_id uuid, p_product_id uuid, p_qty integer) returns integer
language sql stable security definer set search_path = public, app as $$
  select coalesce(case when x.per > 0 and x.free > 0 then (p_qty / x.per) * x.free end, 0)
    from app.scheme_for(p_customer_id, p_product_id) x
$$;

-- Lot number for each line of an order: the latest lot received for that product.
create or replace function app.fill_lots(p_order_id uuid) returns void
language sql security definer set search_path = public, app as $$
  update public.order_items i
     set lot_no = (select se.batch_no from public.stock_entries se
                    where se.product_id = i.product_id and nullif(trim(se.batch_no), '') is not null and se.qty > 0
                    order by se.created_at desc limit 1)
   where i.order_id = p_order_id and i.lot_no is null
$$;

create or replace function app.write_order_items(p_order_id uuid, p_customer_id uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
declare n_in int; n_out int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product';
  end if;
  select count(distinct e->>'product_id') into n_in from jsonb_array_elements(p_items) e;

  delete from public.order_items where order_id = p_order_id;
  with req as (
    select (e->>'product_id')::uuid as product_id, sum((e->>'qty')::int)::int as qty
    from jsonb_array_elements(p_items) e
    group by 1
  ), ins as (
    insert into public.order_items(order_id, product_id, product_name, qty, unit_price, discount_pct, line_total, bonus_qty)
    select p_order_id, p.id,
           p.name || coalesce(' ' || nullif(p.pack_size, ''), '') || coalesce(' (' || nullif(p.colour, '') || ')', ''),
           r.qty, p.net_rate, d.pct,
           round(r.qty * p.net_rate * (1 - d.pct / 100), 2),
           app.bonus_for(p_customer_id, p.id, r.qty)
    from req r
    join public.products p on p.id = r.product_id
    cross join lateral (select app.discount_for(p_customer_id, p.id) as pct) d
    where p.is_active and r.qty > 0
    returning 1
  )
  select count(*) into n_out from ins;
  if n_out <> n_in then
    raise exception 'One or more products are unavailable or have an invalid quantity';
  end if;

  update public.orders o
     set subtotal = s.sub, total = s.tot, discount_total = s.sub - s.tot
    from (select sum(qty * unit_price) as sub, sum(line_total) as tot
            from public.order_items where order_id = p_order_id) s
   where o.id = p_order_id;
end $$;

create or replace function app.take_stock(p_order_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_no text; v_short text; r record;
begin
  select order_no into v_no from public.orders where id = p_order_id;
  perform 1 from public.products p
    where p.id in (select product_id from public.order_items where order_id = p_order_id)
    order by p.id for update;
  select string_agg(i.product_name || ' (ordered ' || (i.qty + i.bonus_qty) || ', in stock ' || p.stock_qty || ')', ', ')
    into v_short
    from public.order_items i join public.products p on p.id = i.product_id
   where i.order_id = p_order_id and p.stock_qty < i.qty + i.bonus_qty;
  if v_short is not null then raise exception 'Not enough stock: %', v_short; end if;

  update public.products p set stock_qty = p.stock_qty - i.qty - i.bonus_qty
    from public.order_items i where i.order_id = p_order_id and p.id = i.product_id;
  insert into public.stock_entries(product_id, qty, kind, order_id, created_by, note)
  select product_id, -(qty + bonus_qty), 'order', p_order_id, p_actor, v_no from public.order_items where order_id = p_order_id;
  update public.orders set stock_deducted = true where id = p_order_id;
  perform app.fill_lots(p_order_id);

  for r in
    select p.id, p.name, p.pack_size, p.stock_qty
      from public.products p join public.order_items i on i.product_id = p.id
     where i.order_id = p_order_id and p.stock_qty <= p.low_stock_level
  loop
    perform app.notify_admins('Low stock: ' || r.name || coalesce(' ' || r.pack_size, ''),
                              'Only ' || r.stock_qty || ' left', 'stock', 'product', r.id,
                              'lowstock:' || r.id || ':' || app.today());
  end loop;
end $$;

create or replace function public.product_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  me public.profiles := app.require('admin');
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_initial int := coalesce(nullif(p->>'initial_stock', '')::int, 0);
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Product name is required'; end if;
  if nullif(p->>'net_rate', '') is null or (p->>'net_rate')::numeric < 0 then
    raise exception 'Enter a valid net rate';
  end if;
  if (nullif(p->>'bonus_per', '') is null) <> (nullif(p->>'bonus_free', '') is null) then
    raise exception 'Fill both parts of the bonus scheme, e.g. 2 free with every 100';
  end if;
  if nullif(p->>'bonus_per', '')::int <= 0 or nullif(p->>'bonus_free', '')::int < 0 then
    raise exception 'Bonus scheme numbers must be whole numbers above 0';
  end if;

  if v_id is null then
    insert into public.products(name, pack_size, category, retail_price, net_rate, packing, image_path,
                                low_stock_level, is_active, sort_order, bonus_per, bonus_free)
    values (trim(p->>'name'), nullif(trim(p->>'pack_size'), ''), nullif(trim(p->>'category'), ''),
            nullif(p->>'retail_price', '')::numeric, (p->>'net_rate')::numeric,
            nullif(trim(p->>'packing'), ''), nullif(p->>'image_path', ''),
            coalesce(nullif(p->>'low_stock_level', '')::int, 0),
            coalesce((p->>'is_active')::boolean, true),
            coalesce(nullif(p->>'sort_order', '')::int, 0),
            nullif(p->>'bonus_per', '')::int, nullif(p->>'bonus_free', '')::int)
    returning id into v_id;
    if v_initial > 0 then
      update public.products set stock_qty = v_initial where id = v_id;
      insert into public.stock_entries(product_id, qty, kind, note, created_by)
      values (v_id, v_initial, 'in', 'Opening stock', me.id);
    end if;
    perform app.log(me.id, 'product_created', 'product', v_id, p - 'image_path');
  else
    update public.products set
      name = trim(p->>'name'),
      pack_size = nullif(trim(p->>'pack_size'), ''),
      category = nullif(trim(p->>'category'), ''),
      retail_price = nullif(p->>'retail_price', '')::numeric,
      net_rate = (p->>'net_rate')::numeric,
      packing = nullif(trim(p->>'packing'), ''),
      image_path = case when p ? 'image_path' then nullif(p->>'image_path', '') else image_path end,
      low_stock_level = coalesce(nullif(p->>'low_stock_level', '')::int, low_stock_level),
      is_active = coalesce((p->>'is_active')::boolean, is_active),
      sort_order = coalesce(nullif(p->>'sort_order', '')::int, sort_order),
      bonus_per = case when p ? 'bonus_per' then nullif(p->>'bonus_per', '')::int else bonus_per end,
      bonus_free = case when p ? 'bonus_free' then nullif(p->>'bonus_free', '')::int else bonus_free end
    where id = v_id;
    if not found then raise exception 'Product not found'; end if;
    -- the other colours of the same product get the same name, rates and picture
    update public.products s set
      name = x.name, pack_size = x.pack_size, category = x.category, retail_price = x.retail_price,
      net_rate = x.net_rate, packing = x.packing, image_path = x.image_path,
      low_stock_level = x.low_stock_level, sort_order = x.sort_order,
      bonus_per = x.bonus_per, bonus_free = x.bonus_free
      from public.products x
     where x.id = v_id and x.group_id is not null and s.group_id = x.group_id and s.id <> x.id;
    perform app.log(me.id, 'product_updated', 'product', v_id, p - 'image_path');
  end if;
  return v_id;
end $$;

create or replace function public.products_list(p_customer_id uuid default null, p_search text default null,
                                                p_include_inactive boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  me public.profiles := app.me();
  cid uuid;
  staff boolean := me.role in ('admin', 'order_taker', 'stock_keeper');
begin
  if me.role in ('store', 'distributor') then
    cid := me.customer_id;
  else
    cid := p_customer_id;
    if cid is not null then perform app.assert_customer(me, cid); end if;
  end if;

  return coalesce((
    select jsonb_agg(j order by sort_order, name, net_rate)
    from (
      select p.sort_order, p.name, p.net_rate,
        jsonb_build_object(
          'id', p.id, 'name', p.name, 'pack_size', p.pack_size, 'category', p.category,
          'retail_price', p.retail_price, 'net_rate', p.net_rate, 'packing', p.packing,
          'image_path', p.image_path, 'is_active', p.is_active,
          'colour', p.colour, 'group_id', p.group_id,
          'bonus_per', sc.per, 'bonus_free', sc.free,
          'in_stock', p.stock_qty > 0,
          'stock_qty', case when staff then p.stock_qty end,
          'low_stock_level', case when staff then p.low_stock_level end,
          'discount_pct', d.pct,
          'price', round(p.net_rate * (1 - d.pct / 100), 2)) as j
      from public.products p
      cross join lateral (select case when cid is null then 0 else app.discount_for(cid, p.id) end as pct) d
      cross join lateral app.scheme_for(cid, p.id) sc
      where (p.is_active or (p_include_inactive and me.role = 'admin'))
        and (coalesce(trim(p_search), '') = ''
             or p.name ilike '%' || trim(p_search) || '%'
             or coalesce(p.category, '') ilike '%' || trim(p_search) || '%'
             or coalesce(p.pack_size, '') ilike '%' || trim(p_search) || '%')
    ) s), '[]'::jsonb);
end $$;

create or replace function public.order_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  me public.profiles := app.me();
  o public.orders; c public.customers;
  staff boolean := me.role in ('admin', 'order_taker', 'stock_keeper');
  v_early boolean; v_return_note text; v_dues record;
begin
  select * into o from public.orders where id = p_id;
  if not found then raise exception 'Order not found'; end if;
  if not app.can_see_order(me, o) then raise exception 'You do not have access to this order'; end if;
  select * into c from public.customers where id = o.customer_id;
  select * into v_dues from app.order_dues(o.customer_id) x where x.order_id = o.id;
  select coalesce((value->>'before_due')::boolean, false) into v_early from public.app_settings where key = 'returns';

  v_return_note := case
    when me.role = 'stock_keeper' then 'Stock keepers do not enter returns'
    when o.status <> 'delivered' or o.is_opening then 'Only delivered goods can be returned'
    when not coalesce(v_early, false) and o.due_date is not null and app.today() < o.due_date
      then 'Returns open on the due date (' || app.fmt_date(o.due_date) || ')'
    else null end;

  return jsonb_build_object(
    'id', o.id, 'order_no', o.order_no, 'status', o.status, 'is_opening', o.is_opening,
    'subtotal', o.subtotal, 'discount_total', o.discount_total, 'total', o.total,
    'returned', coalesce((select sum(total) from public.order_returns where order_id = o.id), 0),
    'opening_paid', o.opening_paid,
    'due_date', o.due_date, 'notes', o.notes, 'cancel_reason', o.cancel_reason,
    'created_at', o.created_at, 'confirmed_at', o.confirmed_at,
    'delivered_at', o.delivered_at, 'cancelled_at', o.cancelled_at,
    'created_by', o.created_by,
    'created_by_name', (select full_name from public.profiles where id = o.created_by),
    'created_by_role', (select role from public.profiles where id = o.created_by),
    'customer', jsonb_build_object('id', c.id, 'name', c.name, 'type', c.type, 'phone', c.phone,
                                   'address', c.address, 'city', c.city, 'credit_days', c.credit_days,
                                   'licence_no', c.licence_no, 'licence_issued', c.licence_issued,
                                   'licence_expiry', c.licence_expiry,
                                   'balance', case when me.role = 'stock_keeper' then null else app.balance(c.id) end),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'product_id', i.product_id, 'product_name', i.product_name, 'qty', i.qty,
               'unit_price', i.unit_price, 'discount_pct', i.discount_pct, 'line_total', i.line_total, 'lot_no', i.lot_no, 'bonus_qty', i.bonus_qty,
               'returned_qty', coalesce((select sum(ri.qty) from public.order_return_items ri where ri.order_item_id = i.id), 0),
               'stock_qty', case when staff then p.stock_qty end)
             order by i.product_name)
      from public.order_items i join public.products p on p.id = i.product_id
      where i.order_id = o.id), '[]'::jsonb),
    'returns', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'return_no', r.return_no, 'total', r.total, 'note', r.note, 'created_at', r.created_at,
               'by', (select full_name from public.profiles where id = r.created_by),
               'items', (select jsonb_agg(jsonb_build_object('product_name', ri.product_name, 'qty', ri.qty, 'line_total', ri.line_total))
                           from public.order_return_items ri where ri.return_id = r.id))
             order by r.created_at)
      from public.order_returns r where r.order_id = o.id), '[]'::jsonb),
    'can_return', v_return_note is null and exists (
      select 1 from public.order_items i where i.order_id = o.id
         and i.qty > coalesce((select sum(ri.qty) from public.order_return_items ri where ri.order_item_id = i.id), 0)),
    'return_note', v_return_note,
    'can_deliver', o.status in ('pending', 'confirmed', 'dispatched')
                   and (me.role in ('admin', 'stock_keeper') or (me.role = 'order_taker' and app.can_see_order(me, o))),
    'paid', case when me.role = 'stock_keeper' then null else coalesce(v_dues.paid, 0) + o.opening_paid end,
    'remaining', case when me.role = 'stock_keeper' then null else v_dues.remaining end,
    'history', case when me.role = 'admin' then coalesce((
      select jsonb_agg(jsonb_build_object('action', a.action, 'at', a.created_at, 'by', u.full_name,
                                          'details', a.details) order by a.id)
      from public.activity_log a left join public.profiles u on u.id = a.actor_id
      where a.entity = 'order' and a.entity_id = o.id), '[]'::jsonb) end);
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
      'lat', c.lat, 'lng', c.lng, 'location_at', c.location_at, 'licence_photo', c.licence_photo,
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

-- Adds colours to a product. The product itself takes the first colour if it has none;
-- every other colour becomes a copy (same rates, picture and customer discounts) with no stock.
create or replace function public.product_colours_add(p_id uuid, p_colours jsonb) returns integer
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin'); p public.products; c text; n int := 0; v_new uuid;
begin
  select * into p from public.products where id = p_id for update;
  if not found then raise exception 'Product not found'; end if;
  if p_colours is null or jsonb_typeof(p_colours) <> 'array' or jsonb_array_length(p_colours) = 0 then
    raise exception 'Write at least one colour';
  end if;
  if p.group_id is null then
    update public.products set group_id = id where id = p.id returning * into p;
  end if;
  for c in select distinct on (lower(trim(x))) initcap(trim(x)) from jsonb_array_elements_text(p_colours) x where trim(x) <> '' loop
    if p.colour is null then
      update public.products set colour = c where id = p.id returning * into p;
      n := n + 1;
      continue;
    end if;
    if exists (select 1 from public.products where group_id = p.group_id and lower(colour) = lower(c)) then continue; end if;
    insert into public.products(name, pack_size, category, retail_price, net_rate, packing, image_path,
                                low_stock_level, is_active, sort_order, colour, group_id, stock_qty, bonus_per, bonus_free)
    values (p.name, p.pack_size, p.category, p.retail_price, p.net_rate, p.packing, p.image_path,
            p.low_stock_level, p.is_active, p.sort_order, c, p.group_id, 0, p.bonus_per, p.bonus_free)
    returning id into v_new;
    insert into public.customer_schemes(customer_id, product_id, bonus_per, bonus_free)
    select customer_id, v_new, bonus_per, bonus_free from public.customer_schemes where product_id = p.id
    on conflict do nothing;
    insert into public.customer_discounts(customer_id, product_id, discount_pct)
    select customer_id, v_new, discount_pct from public.customer_discounts where product_id = p.id
    on conflict do nothing;
    n := n + 1;
  end loop;
  perform app.log(me.id, 'product_colours', 'product', p.id, jsonb_build_object('colours', p_colours));
  return n;
end $$;

-- Renames one colour (admin).
create or replace function public.product_colour_rename(p_id uuid, p_colour text) returns void
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin'); p public.products;
begin
  select * into p from public.products where id = p_id;
  if not found then raise exception 'Product not found'; end if;
  if p.group_id is null then raise exception 'This product has no colours'; end if;
  if coalesce(trim(p_colour), '') = '' then raise exception 'Write the colour'; end if;
  if exists (select 1 from public.products where group_id = p.group_id and id <> p.id and lower(colour) = lower(trim(p_colour))) then
    raise exception 'That colour is already there';
  end if;
  update public.products set colour = initcap(trim(p_colour)) where id = p_id;
end $$;

create or replace function public.customer_set_licence_photo(p_customer_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin', 'order_taker');
begin
  perform app.assert_customer(me, p_customer_id);
  if p_path is not null and split_part(p_path, '/', 1) <> p_customer_id::text then
    raise exception 'Photo is in the wrong folder';
  end if;
  update public.customers set licence_photo = p_path where id = p_customer_id;
  perform app.log(me.id, 'licence_photo', 'customer', p_customer_id, jsonb_build_object('path', p_path));
end $$;

-- For the storage rules: may the signed-in user see or upload this customer's licence photo?
-- Files are stored as <customer id>/<name>.
create or replace function public.can_access_customer_file(p_path text) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from public.profiles me
     where me.id = auth.uid() and me.is_active
       and split_part(p_path, '/', 1) ~ '^[0-9a-f-]{36}$'
       and app.can_access_customer(me, split_part(p_path, '/', 1)::uuid))
$$;

-- Order taker's customers by city: what each owes, and what was collected this month and today.
create or replace function public.city_summary(p_user_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  me public.profiles := app.me();
  u public.profiles := app.route_user(me, p_user_id);
  t date := app.today();
  m0 date := date_trunc('month', t::timestamp)::date;
begin
  return (
    with c as (
      select c.id, c.name, initcap(lower(coalesce(nullif(trim(c.city), ''), 'No city'))) as city, c.address, c.phone,
             app.balance(c.id) as balance,
             (select coalesce(sum(x.remaining), 0) from app.order_dues(c.id) x join public.orders o on o.id = x.order_id
               where x.remaining > 0 and o.due_date < t) as overdue,
             (select coalesce(sum(amount), 0) from public.payments p where p.customer_id = c.id and p.status <> 'rejected' and p.paid_on >= m0) as paid_month,
             (select coalesce(sum(amount), 0) from public.payments p where p.customer_id = c.id and p.status <> 'rejected' and p.paid_on = t) as paid_today,
             (select max(paid_on) from public.payments p where p.customer_id = c.id and p.status <> 'rejected') as last_paid
        from public.customers c
       where c.order_taker_id = u.id and c.is_active
    )
    select jsonb_build_object(
      'user', jsonb_build_object('id', u.id, 'name', u.full_name),
      'cities', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'city', city, 'customers', n, 'balance', bal, 'overdue', od, 'paid_month', pm, 'paid_today', pt,
                 'list', list) order by bal desc, city)
          from (select city, count(*) n, sum(balance) bal, sum(overdue) od, sum(paid_month) pm, sum(paid_today) pt,
                       jsonb_agg(jsonb_build_object('id', id, 'name', name, 'address', address, 'phone', phone,
                                                    'balance', balance, 'overdue', overdue, 'paid_month', paid_month,
                                                    'paid_today', paid_today, 'last_paid', last_paid)
                                 order by balance desc, name) list
                  from c group by city) g), '[]'::jsonb)));
end $$;

create or replace function app.restore_stock(p_order public.orders, p_actor uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not p_order.stock_deducted then return; end if;
  update public.products p set stock_qty = p.stock_qty + i.qty + i.bonus_qty
    from public.order_items i where i.order_id = p_order.id and p.id = i.product_id;
  insert into public.stock_entries(product_id, qty, kind, order_id, created_by, note)
  select product_id, qty + bonus_qty, 'order_cancel', p_order.id, p_actor, p_order.order_no || ' cancelled'
    from public.order_items where order_id = p_order.id;
end $$;

create or replace function public.stock_sheet(p_date date default null, p_include_delivered boolean default true) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  me public.profiles := app.require('admin', 'stock_keeper');
  d date := coalesce(p_date, app.today());
  d0 timestamptz := (d::timestamp at time zone 'Asia/Karachi');
  d1 timestamptz := ((d + 1)::timestamp at time zone 'Asia/Karachi');
begin
  return (
    with o as (
      select o.id, o.order_no, o.status, o.total, o.created_at, o.created_by, c.name as customer, c.city
        from public.orders o join public.customers c on c.id = o.customer_id
       where o.created_at >= d0 and o.created_at < d1 and not o.is_opening
         and o.status <> 'cancelled' and (p_include_delivered or o.status <> 'delivered')
    ), it as (
      select o.created_by, i.product_id, i.product_name, i.qty + i.bonus_qty as qty from public.order_items i join o on o.id = i.order_id
    )
    select jsonb_build_object(
      'date', d,
      'orders_count', (select count(*) from o),
      'to_deliver', (select count(*) from o where status <> 'delivered'),
      'totals', coalesce((
        select jsonb_agg(jsonb_build_object('product_id', product_id, 'product_name', product_name, 'qty', qty) order by product_name)
          from (select product_id, product_name, sum(qty)::int as qty from it group by 1, 2) s), '[]'::jsonb),
      'bookers', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'user_id', u.id, 'name', u.full_name, 'role', u.role,
                 'orders', (select jsonb_agg(jsonb_build_object('id', x.id, 'order_no', x.order_no, 'customer', x.customer,
                                                                'city', x.city, 'status', x.status, 'total', x.total,
                                                                'created_at', x.created_at,
                                                                'items', (select count(*) from public.order_items i where i.order_id = x.id))
                                             order by x.created_at)
                              from o x where x.created_by = u.id),
                 'totals', (select jsonb_agg(jsonb_build_object('product_name', product_name, 'qty', qty) order by product_name)
                              from (select product_name, sum(qty)::int as qty from it where it.created_by = u.id group by 1) s))
               order by u.full_name)
          from public.profiles u where u.id in (select created_by from o)), '[]'::jsonb)));
end $$;

create or replace function public.customer_discounts_get(p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin');
begin
  return (
    select jsonb_build_object(
      'customer', jsonb_build_object('id', c.id, 'name', c.name, 'type', c.type),
      'default_discount_pct', c.default_discount_pct,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'product_id', p.id, 'name', p.name, 'pack_size', p.pack_size, 'colour', p.colour,
                 'net_rate', p.net_rate, 'discount_pct', d.discount_pct,
                 'bonus_per', s.bonus_per, 'bonus_free', s.bonus_free,
                 'product_bonus_per', p.bonus_per, 'product_bonus_free', p.bonus_free)
               order by p.sort_order, p.name, p.net_rate, p.colour)
        from public.products p
        left join public.customer_discounts d on d.product_id = p.id and d.customer_id = c.id
        left join public.customer_schemes s on s.product_id = p.id and s.customer_id = c.id
        where p.is_active), '[]'::jsonb))
    from public.customers c where c.id = p_customer_id);
end $$;

-- p_items: [{product_id, discount_pct, bonus_per, bonus_free}]. Blank discount = the default discount;
-- blank bonus = the product's own scheme; bonus_free 0 = no scheme for this customer.
create or replace function public.customer_discounts_set(p_customer_id uuid, p_default numeric, p_items jsonb) returns void
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin');
begin
  if p_default is null or p_default < 0 or p_default > 100 then
    raise exception 'Default discount must be between 0 and 100';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
              where nullif(e->>'discount_pct', '') is not null
                and ((e->>'discount_pct')::numeric < 0 or (e->>'discount_pct')::numeric > 100)) then
    raise exception 'Every discount must be between 0 and 100';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
              where (nullif(e->>'bonus_per', '') is null) <> (nullif(e->>'bonus_free', '') is null)
                 or app.try_num(e->>'bonus_per') <= 0 or app.try_num(e->>'bonus_free') < 0) then
    raise exception 'Fill both parts of each bonus scheme, e.g. 2 free with every 100';
  end if;

  update public.customers set default_discount_pct = p_default where id = p_customer_id;
  if not found then raise exception 'Customer not found'; end if;

  delete from public.customer_discounts where customer_id = p_customer_id;
  insert into public.customer_discounts(customer_id, product_id, discount_pct)
  select p_customer_id, (e->>'product_id')::uuid, (e->>'discount_pct')::numeric
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
   where nullif(e->>'discount_pct', '') is not null;
  delete from public.customer_schemes where customer_id = p_customer_id;
  insert into public.customer_schemes(customer_id, product_id, bonus_per, bonus_free)
  select p_customer_id, (e->>'product_id')::uuid, (e->>'bonus_per')::int, (e->>'bonus_free')::int
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
   where nullif(e->>'bonus_per', '') is not null;

  perform app.log(me.id, 'discounts_updated', 'customer', p_customer_id,
                  jsonb_build_object('default', p_default, 'items', p_items));
end $$;

revoke execute on function public.product_colours_add(uuid, jsonb), public.product_colour_rename(uuid, text),
  public.customer_set_licence_photo(uuid, text), public.city_summary(uuid) from public, anon;
grant execute on function public.product_colours_add(uuid, jsonb), public.product_colour_rename(uuid, text),
  public.customer_set_licence_photo(uuid, text), public.city_summary(uuid), public.can_access_customer_file(text) to authenticated;

-- lots for orders already in the app
select app.fill_lots(id) from public.orders where stock_deducted;
