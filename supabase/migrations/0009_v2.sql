-- Scorpion Chemical v2 (16 Nov 2026)
--  * Orders: confirmed (and stock taken) as soon as they are placed; delivered by admin,
--    the order taker or the stock keeper. No pending/dispatched any more.
--  * Returns of delivered goods: stock comes back, the order's value goes down.
--  * Stock keeper login and daily loading sheet.
--  * Customer credit days (due date set on delivery), licence details, Dawakhana type.
--  * Invoice numbers start with INV-, invoice warranty text and signature.
--  * Order reports by booker and period, opening data (old balances, old bills, stock, Excel).

-- =====================================================================
-- Schema
-- =====================================================================
alter table public.customers drop constraint customers_type_check;
alter table public.customers add constraint customers_type_check
  check (type in ('store', 'distributor', 'wholesaler', 'retailer', 'clinic', 'hospital', 'dawakhana'));
alter table public.customers
  add column credit_days integer check (credit_days is null or credit_days between 0 and 365),
  add column licence_no text,
  add column licence_issued date,
  add column licence_expiry date;

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'order_taker', 'store', 'distributor', 'stock_keeper'));

-- new orders are numbered INV-xxxx (old ORD- numbers stay as they are)
alter table public.orders alter column order_no set default ('INV-' || nextval('public.order_no_seq'));
alter table public.orders
  add column is_opening boolean not null default false,
  add column opening_paid numeric(12,2) not null default 0;
-- any old pending/dispatched orders become confirmed
update public.orders set status = 'confirmed' where status in ('pending', 'dispatched') and stock_deducted;
alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending', 'confirmed', 'dispatched', 'delivered', 'cancelled'));

alter table public.stock_entries drop constraint stock_entries_kind_check;
alter table public.stock_entries add constraint stock_entries_kind_check
  check (kind in ('in', 'adjust', 'order', 'order_cancel', 'return', 'opening'));

create sequence public.return_no_seq start 1001;
create table public.order_returns (
  id           uuid primary key default gen_random_uuid(),
  return_no    text not null unique default ('RET-' || nextval('public.return_no_seq')),
  order_id     uuid not null references public.orders(id),
  customer_id  uuid not null references public.customers(id),
  total        numeric(12,2) not null,
  note         text,
  created_by   uuid not null references public.profiles(id),
  created_role text not null,
  created_at   timestamptz not null default now()
);
create index order_returns_order_idx on public.order_returns(order_id);
create table public.order_return_items (
  id             uuid primary key default gen_random_uuid(),
  return_id      uuid not null references public.order_returns(id) on delete cascade,
  order_item_id  uuid not null references public.order_items(id),
  product_id     uuid not null references public.products(id),
  product_name   text not null,
  qty            integer not null check (qty > 0),
  line_total     numeric(12,2) not null
);
create index order_return_items_item_idx on public.order_return_items(order_item_id);
alter table public.order_returns enable row level security;
alter table public.order_return_items enable row level security;
revoke all on public.order_returns, public.order_return_items from anon, authenticated;

alter table public.ledger_entries drop constraint ledger_entries_kind_check;
alter table public.ledger_entries add constraint ledger_entries_kind_check
  check (kind in ('opening', 'order', 'payment', 'adjustment', 'return'));
alter table public.ledger_entries add column ref_return_id uuid references public.order_returns(id);
create unique index ledger_one_per_return on public.ledger_entries(ref_return_id) where kind = 'return';

insert into public.app_settings(key, value) values
  ('invoice', jsonb_build_object(
     'warranty', 'I JULIUS YOUNAS Managing Director hereby give this warranty that describe items as sold by me in the above bill do not contravene in any way the provision of 23 of drug act 1976.',
     'signer', 'Julius Younas, Managing Director',
     'signature', null)),
  ('returns', jsonb_build_object('before_due', false))
on conflict (key) do nothing;

-- =====================================================================
-- Helpers
-- =====================================================================
create or replace function app.try_date(t text) returns date language plpgsql immutable as $$
begin
  if t is null or trim(t) = '' then return null; end if;
  return trim(t)::date;
exception when others then return null;
end $$;
alter function app.try_date(text) set search_path = pg_catalog;

create or replace function app.try_num(t text) returns numeric language plpgsql immutable as $$
begin
  if t is null or trim(t) = '' then return null; end if;
  return replace(trim(t), ',', '')::numeric;
exception when others then return null;
end $$;
alter function app.try_num(text) set search_path = pg_catalog;

-- 'Consumer', 'Medical store', 'store' -> 'store' etc.
create or replace function app.customer_type(t text) returns text language sql immutable as $$
  select case lower(trim(coalesce(t, '')))
    when 'store' then 'store' when 'consumer' then 'store' when 'medical store' then 'store'
    when 'distributor' then 'distributor' when 'distribution' then 'distributor'
    when 'wholesaler' then 'wholesaler' when 'retailer' then 'retailer'
    when 'clinic' then 'clinic' when 'hospital' then 'hospital'
    when 'dawakhana' then 'dawakhana' else null end
$$;
alter function app.customer_type(text) set search_path = pg_catalog;

-- Unpaid amount per delivered order. An order's value is what was delivered minus what came
-- back. Payments and credit adjustments settle the opening balance first, then orders from
-- the oldest delivery date to the newest.
create or replace function app.order_dues(p_customer_id uuid default null)
returns table(order_id uuid, customer_id uuid, total numeric, paid numeric, remaining numeric)
language sql stable security definer set search_path = public, app as $$
  with tot as (
    select l.customer_id,
           coalesce(sum(l.credit) filter (where l.kind <> 'return'), 0) as credits,
           coalesce(sum(l.debit) filter (where l.kind <> 'order'), 0) as other_debits
    from public.ledger_entries l
    where p_customer_id is null or l.customer_id = p_customer_id
    group by l.customer_id
  ), net as (
    select l.ref_order_id as order_id, l.customer_id, l.id,
           coalesce(o.delivered_at, l.created_at) as at,
           greatest(0, l.debit - coalesce((select sum(r.credit) from public.ledger_entries r
                                            where r.kind = 'return' and r.ref_order_id = l.ref_order_id), 0)) as total
    from public.ledger_entries l
    join public.orders o on o.id = l.ref_order_id
    where l.kind = 'order' and (p_customer_id is null or l.customer_id = p_customer_id)
  ), ord as (
    select n.*, coalesce(sum(n.total) over (partition by n.customer_id order by n.at, n.id
                         rows between unbounded preceding and 1 preceding), 0) as before
    from net n
  ), calc as (
    select o.order_id, o.customer_id, o.total,
           greatest(0, least(o.total, t.credits - t.other_debits - o.before)) as paid
    from ord o join tot t on t.customer_id = o.customer_id
  )
  select order_id, customer_id, total, paid, total - paid from calc
$$;

-- Takes the order's stock, or raises "Not enough stock: ..." (which undoes everything).
create or replace function app.take_stock(p_order_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_no text; v_short text; r record;
begin
  select order_no into v_no from public.orders where id = p_order_id;
  perform 1 from public.products p
    where p.id in (select product_id from public.order_items where order_id = p_order_id)
    order by p.id for update;
  select string_agg(i.product_name || ' (ordered ' || i.qty || ', in stock ' || p.stock_qty || ')', ', ')
    into v_short
    from public.order_items i join public.products p on p.id = i.product_id
   where i.order_id = p_order_id and p.stock_qty < i.qty;
  if v_short is not null then raise exception 'Not enough stock: %', v_short; end if;

  update public.products p set stock_qty = p.stock_qty - i.qty
    from public.order_items i where i.order_id = p_order_id and p.id = i.product_id;
  insert into public.stock_entries(product_id, qty, kind, order_id, created_by, note)
  select product_id, -qty, 'order', p_order_id, p_actor, v_no from public.order_items where order_id = p_order_id;
  update public.orders set stock_deducted = true where id = p_order_id;

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

-- Can this user see / work on this order?
create or replace function app.can_see_order(me public.profiles, o public.orders) returns boolean
language sql stable security definer set search_path = public, app as $$
  select me.role in ('admin', 'stock_keeper')
      or o.created_by = me.id
      or app.can_access_customer(me, o.customer_id)
$$;

-- =====================================================================
-- Orders
-- =====================================================================
drop function if exists public.order_set_status(uuid, text, date);

create or replace function public.order_place(p_customer_id uuid, p_items jsonb, p_notes text default null) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  me public.profiles := app.require('admin', 'order_taker', 'store', 'distributor');
  cid uuid; c public.customers; v_id uuid; v_no text; v_total numeric;
begin
  cid := case when me.role in ('store', 'distributor') then me.customer_id else p_customer_id end;
  if cid is null then raise exception 'Select a customer first'; end if;
  perform app.assert_customer(me, cid);
  select * into c from public.customers where id = cid;
  if not c.is_active then raise exception 'This customer is inactive'; end if;

  insert into public.orders(customer_id, created_by, order_taker_id, notes, status, confirmed_at)
  values (cid, me.id, case when me.role = 'order_taker' then me.id end,
          nullif(trim(coalesce(p_notes, '')), ''), 'confirmed', now())
  returning id, order_no into v_id, v_no;
  perform app.write_order_items(v_id, cid, p_items);
  perform app.take_stock(v_id, me.id);
  select total into v_total from public.orders where id = v_id;

  perform app.log(me.id, 'order_placed', 'order', v_id, jsonb_build_object('total', v_total));
  perform app.notify_admins('New order ' || v_no, c.name || ', Rs. ' || app.money(v_total) || ', by ' || me.full_name,
                            'order', 'order', v_id, null, me.id);
  perform app.notify_customer(cid, 'New order ' || v_no,
                              'Rs. ' || app.money(v_total) || ', placed by ' || me.full_name,
                              'order', 'order', v_id, null, me.id, true);
  -- stock keepers prepare the goods
  insert into public.notifications(user_id, title, body, kind, ref_type, ref_id)
  select u.id, 'New order ' || v_no, c.name || ', by ' || me.full_name, 'order', 'order', v_id
    from public.profiles u where u.role = 'stock_keeper' and u.is_active and u.id <> me.id;
  return jsonb_build_object('id', v_id, 'order_no', v_no, 'total', v_total);
end $$;

-- Admin, the order taker of the customer (or who booked it) and stock keepers mark delivery.
-- The due date is the one given, otherwise delivery date + the customer's credit days.
create or replace function public.order_deliver(p_id uuid, p_due_date date default null) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  me public.profiles := app.require('admin', 'order_taker', 'stock_keeper');
  o public.orders; c public.customers; v_due date;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not app.can_see_order(me, o) then raise exception 'You do not have access to this order'; end if;
  if o.status = 'delivered' then raise exception 'This order is already delivered'; end if;
  if o.status = 'cancelled' then raise exception 'This order is cancelled'; end if;
  if not o.stock_deducted then perform app.take_stock(o.id, me.id); end if;

  select * into c from public.customers where id = o.customer_id;
  v_due := coalesce(p_due_date, case when c.credit_days is not null then app.today() + c.credit_days end);

  update public.orders
     set status = 'delivered', delivered_at = now(), dispatched_at = coalesce(dispatched_at, now()),
         confirmed_at = coalesce(confirmed_at, now()), due_date = v_due
   where id = o.id
   returning * into o;
  insert into public.ledger_entries(customer_id, kind, debit, ref_order_id, note, created_by)
  values (o.customer_id, 'order', o.total, o.id, o.order_no, me.id);

  perform app.log(me.id, 'order_delivered', 'order', o.id,
                  case when v_due is not null then jsonb_build_object('due_date', v_due) end);
  perform app.notify_customer(o.customer_id, 'Order ' || o.order_no || ' delivered',
    c.name || ', Rs. ' || app.money(o.total) || coalesce(', payment due ' || app.fmt_date(v_due), ''),
    'order', 'order', o.id, null, me.id, true, o.created_by);
  if me.role <> 'admin' then
    perform app.notify_admins('Order ' || o.order_no || ' delivered', c.name || ', by ' || me.full_name,
                              'order', 'order', o.id, null, me.id);
  end if;
  return jsonb_build_object('id', o.id, 'status', o.status, 'due_date', v_due);
end $$;

-- Admin: any order that is not delivered. Order taker / customer: their own, not delivered.
create or replace function public.order_cancel(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin', 'order_taker', 'store', 'distributor'); o public.orders;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status = 'cancelled' then return; end if;
  if o.status = 'delivered' then raise exception 'A delivered order cannot be cancelled. Use Return instead.'; end if;
  if me.role <> 'admin' and not (o.created_by = me.id or (me.customer_id is not null and me.customer_id = o.customer_id)
                                 or (me.role = 'order_taker' and app.can_access_customer(me, o.customer_id))) then
    raise exception 'You do not have access to this order';
  end if;

  perform app.restore_stock(o, me.id);
  update public.orders
     set status = 'cancelled', cancelled_at = now(), stock_deducted = false,
         cancel_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = o.id;

  perform app.log(me.id, 'order_cancelled', 'order', o.id, jsonb_build_object('reason', p_reason));
  perform app.notify_customer(o.customer_id, 'Order ' || o.order_no || ' cancelled',
                              coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Cancelled by ' || me.full_name),
                              'order', 'order', o.id, null, me.id, true, o.created_by);
  perform app.notify_admins('Order ' || o.order_no || ' cancelled', 'Cancelled by ' || me.full_name,
                            'order', 'order', o.id, null, me.id);
end $$;

-- Admin changes quantities before delivery (stock is put back and taken again).
create or replace function public.order_update_items(p_id uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin'); o public.orders;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status not in ('pending', 'confirmed') then raise exception 'Only an order that is not delivered yet can be changed'; end if;
  perform app.restore_stock(o, me.id);
  update public.orders set stock_deducted = false where id = o.id;
  perform app.write_order_items(o.id, o.customer_id, p_items);
  perform app.take_stock(o.id, me.id);
  select * into o from public.orders where id = p_id;
  perform app.log(me.id, 'order_edited', 'order', o.id, jsonb_build_object('total', o.total, 'items', p_items));
  perform app.notify_customer(o.customer_id, 'Order ' || o.order_no || ' updated',
                              'New total Rs. ' || app.money(o.total), 'order', 'order', o.id, null, me.id, true);
  return jsonb_build_object('id', o.id, 'total', o.total);
end $$;

-- Return delivered goods. p_items: [{order_item_id, qty}]
create or replace function public.order_return(p_order_id uuid, p_items jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  me public.profiles := app.require('admin', 'order_taker', 'store', 'distributor');
  o public.orders; v_id uuid; v_no text; v_total numeric; n_in int; n_ok int; v_early boolean;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not (me.role = 'admin' or o.created_by = me.id or app.can_access_customer(me, o.customer_id)) then
    raise exception 'You do not have access to this order';
  end if;
  if o.status <> 'delivered' or o.is_opening then raise exception 'Only delivered goods can be returned'; end if;
  select coalesce((value->>'before_due')::boolean, false) into v_early from public.app_settings where key = 'returns';
  if not coalesce(v_early, false) and o.due_date is not null and app.today() < o.due_date then
    raise exception 'Returns open on the due date (%)', app.fmt_date(o.due_date);
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Choose what is being returned'; end if;

  drop table if exists _ret;
  create temp table _ret on commit drop as
  select i.id as order_item_id, i.product_id, i.product_name, i.unit_price, i.discount_pct,
         sum((e->>'qty')::int)::int as qty,
         i.qty - coalesce((select sum(ri.qty) from public.order_return_items ri where ri.order_item_id = i.id), 0) as left_qty
    from jsonb_array_elements(p_items) e
    join public.order_items i on i.id = (e->>'order_item_id')::uuid and i.order_id = o.id
   where coalesce((e->>'qty')::int, 0) > 0
   group by i.id;
  select count(*) into n_ok from _ret;
  select count(*) into n_in from jsonb_array_elements(p_items) e where coalesce((e->>'qty')::int, 0) > 0;
  if n_ok = 0 then raise exception 'Enter how many of each product came back'; end if;
  if n_ok <> n_in then raise exception 'Some products are not in this order'; end if;
  if exists (select 1 from _ret where qty > left_qty) then
    raise exception 'You cannot return more than was delivered: %',
      (select string_agg(product_name || ' (can return ' || left_qty || ')', ', ') from _ret where qty > left_qty);
  end if;

  select sum(round(qty * unit_price * (1 - discount_pct / 100), 2)) into v_total from _ret;
  insert into public.order_returns(order_id, customer_id, total, note, created_by, created_role)
  values (o.id, o.customer_id, v_total, nullif(trim(coalesce(p_note, '')), ''), me.id, me.role)
  returning id, return_no into v_id, v_no;
  insert into public.order_return_items(return_id, order_item_id, product_id, product_name, qty, line_total)
  select v_id, order_item_id, product_id, product_name, qty, round(qty * unit_price * (1 - discount_pct / 100), 2) from _ret;

  update public.products p set stock_qty = p.stock_qty + r.qty from _ret r where p.id = r.product_id;
  insert into public.stock_entries(product_id, qty, kind, order_id, created_by, note)
  select product_id, qty, 'return', o.id, me.id, v_no || ' from ' || o.order_no from _ret;

  insert into public.ledger_entries(customer_id, kind, credit, ref_order_id, ref_return_id, note, created_by)
  values (o.customer_id, 'return', v_total, o.id, v_id, v_no || ', goods returned from ' || o.order_no, me.id);

  perform app.log(me.id, 'order_returned', 'order', o.id, jsonb_build_object('return_no', v_no, 'total', v_total));
  perform app.notify_admins('Goods returned, ' || o.order_no,
    (select name from public.customers where id = o.customer_id) || ', Rs. ' || app.money(v_total) || ', by ' || me.full_name,
    'order', 'order', o.id, null, me.id);
  perform app.notify_customer(o.customer_id, 'Goods returned, ' || o.order_no,
    'Rs. ' || app.money(v_total) || ' taken off your account, balance Rs. ' || app.money(app.balance(o.customer_id)),
    'order', 'order', o.id, null, me.id, true, o.created_by);
  return jsonb_build_object('id', v_id, 'return_no', v_no, 'total', v_total);
end $$;

create or replace function public.order_set_due_date(p_id uuid, p_due_date date) returns void
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin'); o public.orders;
begin
  update public.orders set due_date = p_due_date where id = p_id and status <> 'cancelled' returning * into o;
  if not found then raise exception 'Order not found'; end if;
  perform app.log(me.id, 'order_due_date', 'order', o.id, jsonb_build_object('due_date', p_due_date));
  if p_due_date is not null then
    perform app.notify_customer(o.customer_id, 'Payment due date set',
                                o.order_no || ', due ' || app.fmt_date(p_due_date),
                                'due', 'order', o.id, null, me.id, true);
  end if;
end $$;

drop function if exists public.orders_list(text, uuid, text, integer, integer);
create function public.orders_list(p_status text default null, p_customer_id uuid default null,
                                   p_search text default null, p_limit integer default 50,
                                   p_offset integer default 0, p_from date default null, p_to date default null,
                                   p_created_by uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  me public.profiles := app.me(); t date := app.today();
  d0 timestamptz := (p_from::timestamp at time zone 'Asia/Karachi');
  d1 timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Karachi');
begin
  return coalesce((
    select jsonb_agg(j order by created_at desc)
    from (
      select o.created_at,
        jsonb_build_object(
          'id', o.id, 'order_no', o.order_no, 'status', o.status, 'total', o.total,
          'returned', coalesce(rt.total, 0), 'is_opening', o.is_opening,
          'due_date', o.due_date, 'created_at', o.created_at, 'delivered_at', o.delivered_at,
          'customer_id', c.id, 'customer_name', c.name, 'customer_type', c.type, 'city', c.city,
          'created_by_name', u.full_name, 'created_by_role', u.role,
          'items_count', (select count(*) from public.order_items i where i.order_id = o.id),
          'paid', case when me.role = 'stock_keeper' then null else coalesce(x.paid, 0) + o.opening_paid end,
          'remaining', case when me.role = 'stock_keeper' then null else x.remaining end,
          'overdue', me.role <> 'stock_keeper' and coalesce(x.remaining > 0 and o.due_date < t, false)) as j
      from public.orders o
      join public.customers c on c.id = o.customer_id
      join public.profiles u on u.id = o.created_by
      left join app.order_dues(case when me.role in ('store', 'distributor') then me.customer_id else p_customer_id end) x
             on x.order_id = o.id
      left join lateral (select sum(r.total) as total from public.order_returns r where r.order_id = o.id) rt on true
      where (me.role in ('admin', 'stock_keeper')
             or (me.role = 'order_taker' and (o.created_by = me.id or c.order_taker_id = me.id))
             or (me.role in ('store', 'distributor') and o.customer_id = me.customer_id))
        and (p_customer_id is null or o.customer_id = p_customer_id)
        and (p_created_by is null or o.created_by = p_created_by)
        and (p_from is null or o.created_at >= d0)
        and (p_to is null or o.created_at < d1)
        and (p_status is null
             or (p_status = 'open' and o.status in ('pending', 'confirmed', 'dispatched'))
             or (p_status = 'unpaid' and x.remaining > 0)
             or (p_status = 'overdue' and x.remaining > 0 and o.due_date < t)
             or (p_status = 'returned' and rt.total > 0)
             or (p_status = 'confirmed' and o.status in ('pending', 'confirmed', 'dispatched'))
             or o.status = p_status)
        and (coalesce(trim(p_search), '') = ''
             or o.order_no ilike '%' || trim(p_search) || '%'
             or c.name ilike '%' || trim(p_search) || '%')
      order by o.created_at desc
      limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0)
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
               'unit_price', i.unit_price, 'discount_pct', i.discount_pct, 'line_total', i.line_total,
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

-- =====================================================================
-- Stock keeper: the day's orders, per booker, with product totals
-- =====================================================================
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
      select o.created_by, i.product_id, i.product_name, i.qty from public.order_items i join o on o.id = i.order_id
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

-- =====================================================================
-- Reports
-- =====================================================================
create or replace function public.orders_summary(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  me public.profiles := app.require('admin');
  d0 timestamptz := (p_from::timestamp at time zone 'Asia/Karachi');
  d1 timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Karachi');
begin
  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'orders', (select count(*) from public.orders where created_at >= d0 and created_at < d1 and status <> 'cancelled' and not is_opening),
    'amount', (select coalesce(sum(total), 0) from public.orders where created_at >= d0 and created_at < d1 and status <> 'cancelled' and not is_opening),
    'returned', (select coalesce(sum(r.total), 0) from public.order_returns r where r.created_at >= d0 and r.created_at < d1),
    'by_user', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', u.id, 'name', u.full_name, 'role', u.role,
                                          'customer_name', cu.name, 'orders', s.n, 'amount', s.amount)
                       order by s.amount desc)
        from (select created_by, count(*) as n, sum(total) as amount
                from public.orders
               where created_at >= d0 and created_at < d1 and status <> 'cancelled' and not is_opening
               group by created_by) s
        join public.profiles u on u.id = s.created_by
        left join public.customers cu on cu.id = u.customer_id), '[]'::jsonb));
end $$;

create or replace function public.dashboard() returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  me public.profiles := app.me();
  t date := app.today();
  day_start timestamptz := (t::timestamp at time zone 'Asia/Karachi');
  week_start timestamptz := ((t - (extract(isodow from t)::int - 1))::timestamp at time zone 'Asia/Karachi');
  month_start timestamptz := (date_trunc('month', t::timestamp) at time zone 'Asia/Karachi');
begin
  if me.role = 'admin' then
    return jsonb_build_object(
      'today_orders',     (select count(*) from orders where created_at >= day_start and status <> 'cancelled' and not is_opening),
      'today_sales',      (select coalesce(sum(total), 0) from orders where created_at >= day_start and status <> 'cancelled' and not is_opening),
      'week_orders',      (select count(*) from orders where created_at >= week_start and status <> 'cancelled' and not is_opening),
      'week_sales',       (select coalesce(sum(total), 0) from orders where created_at >= week_start and status <> 'cancelled' and not is_opening),
      'month_orders',     (select count(*) from orders where created_at >= month_start and status <> 'cancelled' and not is_opening),
      'month_sales',      (select coalesce(sum(total), 0) from orders where created_at >= month_start and status <> 'cancelled' and not is_opening),
      'to_deliver',       (select count(*) from orders where status in ('pending', 'confirmed', 'dispatched')),
      'pending_orders',   (select count(*) from orders where status in ('pending', 'confirmed', 'dispatched')),
      'pending_payments', (select count(*) from payments where status = 'pending'),
      'pending_payments_amount', (select coalesce(sum(amount), 0) from payments where status = 'pending'),
      'total_outstanding', (select coalesce(sum(debit - credit), 0) from ledger_entries),
      'overdue_orders',   (select count(*) from app.order_dues(null) x join orders o on o.id = x.order_id
                            where x.remaining > 0 and o.due_date < t),
      'overdue_amount',   (select coalesce(sum(x.remaining), 0) from app.order_dues(null) x join orders o on o.id = x.order_id
                            where x.remaining > 0 and o.due_date < t),
      'low_stock',        (select count(*) from products where is_active and stock_qty <= low_stock_level),
      'cash_with_takers', (select coalesce(sum(amount), 0) from payments
                            where status = 'pending' and method = 'cash' and entered_by_role = 'order_taker'),
      'licence_expired',  (select count(*) from customers where is_active and licence_expiry < t),
      'licence_expiring', (select count(*) from customers where is_active and licence_expiry between t and t + 30),
      'stores',           (select count(*) from customers where is_active),
      'distributors',     (select count(*) from customers where type = 'distributor' and is_active),
      'order_takers',     (select count(*) from profiles where role = 'order_taker' and is_active));
  elsif me.role = 'stock_keeper' then
    return jsonb_build_object(
      'today_orders', (select count(*) from orders where created_at >= day_start and status <> 'cancelled' and not is_opening),
      'to_deliver',   (select count(*) from orders where status in ('pending', 'confirmed', 'dispatched')));
  elsif me.role = 'order_taker' then
    return jsonb_build_object(
      'today_orders',   (select count(*) from orders where created_by = me.id and created_at >= day_start and status <> 'cancelled'),
      'today_sales',    (select coalesce(sum(total), 0) from orders where created_by = me.id and created_at >= day_start and status <> 'cancelled'),
      'month_sales',    (select coalesce(sum(total), 0) from orders where created_by = me.id and created_at >= month_start and status <> 'cancelled'),
      'pending_orders', (select count(*) from orders o join customers c on c.id = o.customer_id
                          where o.status in ('pending', 'confirmed', 'dispatched') and (o.created_by = me.id or c.order_taker_id = me.id)),
      'cash_in_hand',   (select coalesce(sum(amount), 0) from payments
                          where entered_by = me.id and status = 'pending' and method = 'cash'),
      'customers',      (select count(*) from customers where order_taker_id = me.id and is_active),
      'customers_outstanding', (select coalesce(sum(l.debit - l.credit), 0) from ledger_entries l
                                 join customers c on c.id = l.customer_id where c.order_taker_id = me.id));
  else
    return jsonb_build_object(
      'balance',          app.balance(me.customer_id),
      'open_orders',      (select count(*) from orders where customer_id = me.customer_id
                            and status in ('pending', 'confirmed', 'dispatched')),
      'pending_payments', (select count(*) from payments where customer_id = me.customer_id and status = 'pending'),
      'pending_payments_amount', (select coalesce(sum(amount), 0) from payments
                                   where customer_id = me.customer_id and status = 'pending'),
      'month_purchases',  (select coalesce(sum(total), 0) from orders where customer_id = me.customer_id
                            and created_at >= month_start and status <> 'cancelled'),
      'overdue_amount',   (select coalesce(sum(x.remaining), 0) from app.order_dues(me.customer_id) x
                            join orders o on o.id = x.order_id where x.remaining > 0 and o.due_date < t),
      'licence_expiry',   (select licence_expiry from customers where id = me.customer_id),
      'next_due',         (select jsonb_build_object('order_id', o.id, 'order_no', o.order_no,
                                                     'due_date', o.due_date, 'remaining', x.remaining)
                             from app.order_dues(me.customer_id) x join orders o on o.id = x.order_id
                            where x.remaining > 0 and o.due_date is not null
                            order by o.due_date limit 1));
  end if;
end $$;

-- =====================================================================
-- Products: stock keepers see stock numbers too
-- =====================================================================
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
          'in_stock', p.stock_qty > 0,
          'stock_qty', case when staff then p.stock_qty end,
          'low_stock_level', case when staff then p.low_stock_level end,
          'discount_pct', d.pct,
          'price', round(p.net_rate * (1 - d.pct / 100), 2)) as j
      from public.products p
      cross join lateral (select case when cid is null then 0 else app.discount_for(cid, p.id) end as pct) d
      where (p.is_active or (p_include_inactive and me.role = 'admin'))
        and (coalesce(trim(p_search), '') = ''
             or p.name ilike '%' || trim(p_search) || '%'
             or coalesce(p.category, '') ilike '%' || trim(p_search) || '%'
             or coalesce(p.pack_size, '') ilike '%' || trim(p_search) || '%')
    ) s), '[]'::jsonb);
end $$;

-- =====================================================================
-- Customers: credit days, licence
-- =====================================================================
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
      'order_taker_id', c.order_taker_id,
      'order_taker_name', (select full_name from public.profiles where id = c.order_taker_id),
      'balance', app.balance(c.id),
      'opening_balance', (select coalesce(sum(debit - credit), 0) from public.ledger_entries
                           where customer_id = c.id and kind = 'opening'),
      'overdue_amount', (select coalesce(sum(x.remaining), 0) from app.order_dues(c.id) x
                          join public.orders o on o.id = x.order_id where x.remaining > 0 and o.due_date < t),
      'open_orders', (select count(*) from public.orders o where o.customer_id = c.id
                       and o.status in ('pending', 'confirmed', 'dispatched')),
      'logins', case when me.role = 'admin' then coalesce((
                  select jsonb_agg(jsonb_build_object('id', u.id, 'full_name', u.full_name,
                                                      'phone', u.phone, 'is_active', u.is_active))
                    from public.profiles u where u.customer_id = c.id), '[]'::jsonb) end)
    from public.customers c where c.id = p_id);
end $$;

create or replace function public.customer_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  me public.profiles := app.require('admin');
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_taker uuid := nullif(p->>'order_taker_id', '')::uuid;
  v_opening numeric := coalesce(nullif(p->>'opening_balance', '')::numeric, 0);
  v_disc numeric := coalesce(nullif(p->>'default_discount_pct', '')::numeric, 0);
  v_type text := app.customer_type(p->>'type');
  v_days int := nullif(p->>'credit_days', '')::int;
  v_issued date := app.try_date(p->>'licence_issued');
  v_expiry date := app.try_date(p->>'licence_expiry');
  v_old_type text;
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
  if v_taker is not null and not exists (
       select 1 from public.profiles where id = v_taker and role = 'order_taker') then
    raise exception 'Selected order taker was not found';
  end if;

  if v_id is null then
    insert into public.customers(type, name, owner_name, phone, address, city, order_taker_id,
                                 default_discount_pct, is_active, credit_days, licence_no, licence_issued, licence_expiry)
    values (v_type, trim(p->>'name'), nullif(trim(p->>'owner_name'), ''),
            nullif(app.norm_phone(p->>'phone'), ''), nullif(trim(p->>'address'), ''),
            nullif(trim(p->>'city'), ''), v_taker, v_disc, coalesce((p->>'is_active')::boolean, true),
            v_days, nullif(trim(p->>'licence_no'), ''), v_issued, v_expiry)
    returning id into v_id;
    if v_opening <> 0 then
      insert into public.ledger_entries(customer_id, kind, debit, credit, note, created_by)
      values (v_id, 'opening', greatest(v_opening, 0), greatest(-v_opening, 0), 'Opening balance', me.id);
    end if;
    perform app.log(me.id, 'customer_created', 'customer', v_id, p);
  else
    select type into v_old_type from public.customers where id = v_id;
    if not found then raise exception 'Customer not found'; end if;
    if (v_old_type = 'distributor') <> (v_type = 'distributor')
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
      is_active = coalesce((p->>'is_active')::boolean, is_active)
    where id = v_id;
    perform app.log(me.id, 'customer_updated', 'customer', v_id, p);
  end if;
  return v_id;
end $$;

create or replace function public.service_create_profile(p_user_id uuid, p_role text, p_full_name text, p_phone text,
                                                         p_customer_id uuid default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_phone text := app.norm_phone(p_phone); v_type text;
begin
  if p_role not in ('admin', 'order_taker', 'store', 'distributor', 'stock_keeper') then raise exception 'Invalid role'; end if;
  if coalesce(trim(p_full_name), '') = '' then raise exception 'Name is required'; end if;
  if v_phone !~ '^03[0-9]{9}$' then raise exception 'Enter a valid mobile number, e.g. 03001234567'; end if;
  if p_role in ('store', 'distributor') then
    select type into v_type from public.customers where id = p_customer_id;
    if v_type is null then raise exception 'This login must be linked to a customer'; end if;
    p_role := case when v_type = 'distributor' then 'distributor' else 'store' end;
  else
    p_customer_id := null;
  end if;
  insert into public.profiles(id, role, full_name, phone, customer_id)
  values (p_user_id, p_role, trim(p_full_name), v_phone, p_customer_id);
end $$;

create or replace function public.announce(p_title text, p_body text, p_audience text default 'all') returns integer
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin'); n int;
begin
  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_body), '') = '' then
    raise exception 'Write a title and a message';
  end if;
  if p_audience not in ('all', 'store', 'distributor', 'order_taker', 'stock_keeper') then
    raise exception 'Choose who should receive this';
  end if;
  with ins as (
    insert into public.notifications(user_id, title, body, kind)
    select u.id, trim(p_title), trim(p_body), 'announcement'
      from public.profiles u
     where u.is_active and u.id <> me.id and u.role <> 'admin'
       and (p_audience = 'all' or u.role = p_audience)
    returning 1)
  select count(*) into n from ins;
  perform app.log(me.id, 'announcement', 'notification', null,
                  jsonb_build_object('title', p_title, 'audience', p_audience, 'sent', n));
  return n;
end $$;

-- =====================================================================
-- Invoice and return settings
-- =====================================================================
create or replace function public.invoice_settings() returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.me();
begin
  return jsonb_build_object(
    'company', (select value from public.app_settings where key = 'company'),
    'invoice', (select value from public.app_settings where key = 'invoice'),
    'returns', (select value from public.app_settings where key = 'returns'));
end $$;

-- p: {warranty, signer, signature (data:image/...;base64,... or null to remove; omit to keep), returns_before_due}
create or replace function public.invoice_settings_save(p jsonb) returns void
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin'); cur jsonb;
begin
  select value into cur from public.app_settings where key = 'invoice';
  if p ? 'signature' and p->>'signature' is not null then
    if (p->>'signature') !~ '^data:image/(png|jpeg|webp);base64,' then raise exception 'Signature must be a photo'; end if;
    if length(p->>'signature') > 700000 then raise exception 'Signature photo is too large. Use a smaller photo.'; end if;
  end if;
  insert into public.app_settings(key, value) values ('invoice', jsonb_build_object(
      'warranty', coalesce(nullif(trim(p->>'warranty'), ''), cur->>'warranty'),
      'signer', case when p ? 'signer' then nullif(trim(p->>'signer'), '') else cur->>'signer' end,
      'signature', case when p ? 'signature' then p->'signature' else cur->'signature' end))
  on conflict (key) do update set value = excluded.value;
  if p ? 'returns_before_due' then
    insert into public.app_settings(key, value)
    values ('returns', jsonb_build_object('before_due', coalesce((p->>'returns_before_due')::boolean, false)))
    on conflict (key) do update set value = excluded.value;
  end if;
  perform app.log(me.id, 'invoice_settings', 'settings', null, p - 'signature');
end $$;

-- =====================================================================
-- Opening data (what was owed and in stock before the app)
-- =====================================================================
-- Sets a customer's opening balance to p_amount (the difference is added as a new entry).
create or replace function public.customer_set_opening(p_customer_id uuid, p_amount numeric) returns numeric
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin'); cur numeric; diff numeric;
begin
  if p_amount is null then raise exception 'Enter the amount'; end if;
  if not exists (select 1 from public.customers where id = p_customer_id) then raise exception 'Customer not found'; end if;
  select coalesce(sum(debit - credit), 0) into cur from public.ledger_entries
   where customer_id = p_customer_id and kind = 'opening' and ref_order_id is null;
  diff := round(p_amount, 2) - cur;
  if diff <> 0 then
    insert into public.ledger_entries(customer_id, kind, debit, credit, note, created_by)
    values (p_customer_id, 'opening', greatest(diff, 0), greatest(-diff, 0),
            'Opening balance set to Rs. ' || app.money(p_amount), me.id);
    perform app.log(me.id, 'opening_balance', 'customer', p_customer_id, jsonb_build_object('amount', p_amount));
  end if;
  return app.balance(p_customer_id);
end $$;

-- An unpaid bill from before the app. Goes into the account and gets due-date reminders.
create or replace function app.add_opening_bill(p_actor uuid, p_customer_id uuid, p_bill_no text, p_date date,
                                                p_amount numeric, p_paid numeric, p_due date) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare v_id uuid; v_no text; v_at timestamptz := (p_date::timestamp at time zone 'Asia/Karachi') + interval '12 hours';
begin
  v_no := coalesce(nullif(trim(coalesce(p_bill_no, '')), ''), 'OB-' || nextval('public.order_no_seq'));
  if exists (select 1 from public.orders where order_no = v_no) then
    raise exception 'Bill number % already exists', v_no;
  end if;
  insert into public.orders(order_no, customer_id, created_by, status, subtotal, total, discount_total, due_date,
                            notes, stock_deducted, created_at, confirmed_at, delivered_at, is_opening, opening_paid)
  values (v_no, p_customer_id, p_actor, 'delivered', p_amount, p_amount, 0, p_due,
          'Bill from before the app', false, v_at, v_at, v_at, true, coalesce(p_paid, 0))
  returning id into v_id;
  insert into public.ledger_entries(customer_id, kind, debit, ref_order_id, note, created_by)
  values (p_customer_id, 'order', p_amount - coalesce(p_paid, 0), v_id,
          v_no || ' (old bill' || case when coalesce(p_paid, 0) > 0 then ', Rs. ' || app.money(p_paid) || ' paid before' else '' end || ')',
          p_actor);
  return v_id;
end $$;

create or replace function public.opening_bill_add(p jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  me public.profiles := app.require('admin');
  v_cust uuid := nullif(p->>'customer_id', '')::uuid;
  v_date date := app.try_date(p->>'date');
  v_amount numeric := app.try_num(p->>'amount');
  v_paid numeric := coalesce(app.try_num(p->>'paid'), 0);
  v_due date := app.try_date(p->>'due_date');
  v_id uuid;
begin
  if not exists (select 1 from public.customers where id = v_cust) then raise exception 'Choose the customer'; end if;
  if v_date is null then raise exception 'Enter the bill date'; end if;
  if v_date > app.today() then raise exception 'Bill date cannot be in the future'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'Enter the bill amount'; end if;
  if v_paid < 0 or v_paid > v_amount then raise exception 'Amount already paid must be between 0 and the bill amount'; end if;
  if nullif(p->>'due_date', '') is not null and v_due is null then raise exception 'Due date is not a valid date'; end if;
  v_id := app.add_opening_bill(me.id, v_cust, p->>'bill_no', v_date, v_amount, v_paid, v_due);
  perform app.log(me.id, 'opening_bill', 'order', v_id, p);
  return v_id;
end $$;

-- Sets stock of many products at once. p_items: [{product_id, qty}]
create or replace function public.stock_set_bulk(p_items jsonb, p_note text default null) returns integer
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin'); r record; n int := 0;
begin
  if exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
              where app.try_num(e->>'qty') is null or app.try_num(e->>'qty') < 0
                 or app.try_num(e->>'qty') <> trunc(app.try_num(e->>'qty'))) then
    raise exception 'Every stock must be a whole number, 0 or more';
  end if;
  for r in
    select p.id, p.stock_qty, (e->>'qty')::int as qty
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
      join public.products p on p.id = (e->>'product_id')::uuid
      for update of p
  loop
    if r.qty <> r.stock_qty then
      update public.products set stock_qty = r.qty where id = r.id;
      insert into public.stock_entries(product_id, qty, kind, note, created_by)
      values (r.id, r.qty - r.stock_qty, 'opening', coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Stock count'), me.id);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Excel import. p: {customers: [...], bills: [...], stock: [...]}, each row with "row" (sheet row number).
-- Checks everything first; saves only when p_commit is true and nothing is wrong.
create or replace function public.import_opening(p jsonb, p_commit boolean default false) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  me public.profiles := app.require('admin');
  errs jsonb := '[]'::jsonb;
  r jsonb; v_row text; v_name text; v_type text; v_taker uuid; v_n numeric; v_d date; v_d2 date;
  v_cust uuid; v_prod uuid; v_cnt int; v_id uuid;
  new_names text[] := '{}';
  n_c int := 0; n_b int := 0; n_s int := 0;
begin
  -- ---------- check customers ----------
  for r in select * from jsonb_array_elements(coalesce(p->'customers', '[]'::jsonb)) loop
    v_row := coalesce(r->>'row', '?');
    v_name := trim(coalesce(r->>'name', ''));
    if v_name = '' then errs := errs || jsonb_build_object('sheet', 'Customers', 'row', v_row, 'message', 'Name is missing'); continue; end if;
    if lower(v_name) = any(new_names) then
      errs := errs || jsonb_build_object('sheet', 'Customers', 'row', v_row, 'message', v_name || ' is listed twice');
    end if;
    new_names := new_names || lower(v_name);
    if exists (select 1 from public.customers where lower(name) = lower(v_name)) then
      errs := errs || jsonb_build_object('sheet', 'Customers', 'row', v_row, 'message', v_name || ' already exists in the app');
    end if;
    if app.customer_type(coalesce(nullif(r->>'type', ''), 'Consumer')) is null then
      errs := errs || jsonb_build_object('sheet', 'Customers', 'row', v_row, 'message', 'Unknown type "' || (r->>'type') || '"');
    end if;
    if nullif(trim(coalesce(r->>'order_taker', '')), '') is not null then
      select count(*) into v_cnt from public.profiles u
       where u.role = 'order_taker' and (lower(u.full_name) = lower(trim(r->>'order_taker')) or u.phone = app.norm_phone(r->>'order_taker'));
      if v_cnt <> 1 then
        errs := errs || jsonb_build_object('sheet', 'Customers', 'row', v_row, 'message',
                 case when v_cnt = 0 then 'Order taker "' || (r->>'order_taker') || '" not found' else 'More than one order taker is called "' || (r->>'order_taker') || '"; use the mobile number' end);
      end if;
    end if;
    v_n := app.try_num(r->>'discount');
    if nullif(r->>'discount', '') is not null and (v_n is null or v_n < 0 or v_n > 100) then
      errs := errs || jsonb_build_object('sheet', 'Customers', 'row', v_row, 'message', 'Discount must be 0 to 100');
    end if;
    v_n := app.try_num(r->>'credit_days');
    if nullif(r->>'credit_days', '') is not null and (v_n is null or v_n < 0 or v_n > 365 or v_n <> trunc(v_n)) then
      errs := errs || jsonb_build_object('sheet', 'Customers', 'row', v_row, 'message', 'Credit days must be a whole number, 0 to 365');
    end if;
    if nullif(r->>'opening_balance', '') is not null and app.try_num(r->>'opening_balance') is null then
      errs := errs || jsonb_build_object('sheet', 'Customers', 'row', v_row, 'message', 'Opening balance is not a number');
    end if;
    if nullif(r->>'licence_issued', '') is not null and app.try_date(r->>'licence_issued') is null then
      errs := errs || jsonb_build_object('sheet', 'Customers', 'row', v_row, 'message', 'Licence issue date is not a date');
    end if;
    if nullif(r->>'licence_expiry', '') is not null and app.try_date(r->>'licence_expiry') is null then
      errs := errs || jsonb_build_object('sheet', 'Customers', 'row', v_row, 'message', 'Licence expiry date is not a date');
    end if;
  end loop;

  -- ---------- check old bills ----------
  for r in select * from jsonb_array_elements(coalesce(p->'bills', '[]'::jsonb)) loop
    v_row := coalesce(r->>'row', '?');
    v_name := trim(coalesce(r->>'customer', ''));
    if v_name = '' then errs := errs || jsonb_build_object('sheet', 'Old bills', 'row', v_row, 'message', 'Customer is missing'); continue; end if;
    select count(*) into v_cnt from public.customers where lower(name) = lower(v_name);
    if v_cnt = 0 and not (lower(v_name) = any(new_names)) then
      errs := errs || jsonb_build_object('sheet', 'Old bills', 'row', v_row, 'message', 'Customer "' || v_name || '" not found');
    elsif v_cnt > 1 then
      errs := errs || jsonb_build_object('sheet', 'Old bills', 'row', v_row, 'message', 'More than one customer is called "' || v_name || '"');
    end if;
    v_d := app.try_date(r->>'date');
    if v_d is null then errs := errs || jsonb_build_object('sheet', 'Old bills', 'row', v_row, 'message', 'Bill date is missing or not a date');
    elsif v_d > app.today() then errs := errs || jsonb_build_object('sheet', 'Old bills', 'row', v_row, 'message', 'Bill date is in the future'); end if;
    v_n := app.try_num(r->>'amount');
    if v_n is null or v_n <= 0 then errs := errs || jsonb_build_object('sheet', 'Old bills', 'row', v_row, 'message', 'Amount is missing'); end if;
    if nullif(r->>'paid', '') is not null and (app.try_num(r->>'paid') is null or app.try_num(r->>'paid') < 0 or app.try_num(r->>'paid') > coalesce(v_n, 0)) then
      errs := errs || jsonb_build_object('sheet', 'Old bills', 'row', v_row, 'message', 'Paid must be between 0 and the amount');
    end if;
    if nullif(r->>'due_date', '') is not null and app.try_date(r->>'due_date') is null then
      errs := errs || jsonb_build_object('sheet', 'Old bills', 'row', v_row, 'message', 'Due date is not a date');
    end if;
    if nullif(trim(coalesce(r->>'bill_no', '')), '') is not null then
      if exists (select 1 from public.orders where order_no = trim(r->>'bill_no')) then
        errs := errs || jsonb_build_object('sheet', 'Old bills', 'row', v_row, 'message', 'Bill number ' || trim(r->>'bill_no') || ' already exists');
      end if;
      if (select count(*) from jsonb_array_elements(p->'bills') b where trim(b->>'bill_no') = trim(r->>'bill_no')) > 1 then
        errs := errs || jsonb_build_object('sheet', 'Old bills', 'row', v_row, 'message', 'Bill number ' || trim(r->>'bill_no') || ' is listed twice');
      end if;
    end if;
  end loop;

  -- ---------- check stock ----------
  for r in select * from jsonb_array_elements(coalesce(p->'stock', '[]'::jsonb)) loop
    v_row := coalesce(r->>'row', '?');
    if nullif(r->>'qty', '') is null then continue; end if;  -- blank stock = leave as it is
    select count(*) into v_cnt from public.products pr
     where (nullif(r->>'product_id', '') is not null and pr.id::text = r->>'product_id')
        or (nullif(r->>'product_id', '') is null and lower(pr.name) = lower(trim(coalesce(r->>'product', '')))
            and lower(coalesce(pr.pack_size, '')) = lower(trim(coalesce(r->>'pack_size', ''))));
    if v_cnt <> 1 then
      errs := errs || jsonb_build_object('sheet', 'Stock', 'row', v_row, 'message',
        'Product "' || coalesce(r->>'product', '') || ' ' || coalesce(r->>'pack_size', '') || '" not found');
    end if;
    v_n := app.try_num(r->>'qty');
    if v_n is null or v_n < 0 or v_n <> trunc(v_n) then
      errs := errs || jsonb_build_object('sheet', 'Stock', 'row', v_row, 'message', 'Stock must be a whole number, 0 or more');
    end if;
  end loop;

  n_c := jsonb_array_length(coalesce(p->'customers', '[]'::jsonb));
  n_b := jsonb_array_length(coalesce(p->'bills', '[]'::jsonb));
  n_s := (select count(*) from jsonb_array_elements(coalesce(p->'stock', '[]'::jsonb)) e where nullif(e->>'qty', '') is not null);

  if jsonb_array_length(errs) > 0 or not p_commit then
    return jsonb_build_object('errors', errs, 'committed', false,
                              'counts', jsonb_build_object('customers', n_c, 'bills', n_b, 'stock', n_s));
  end if;

  -- ---------- save ----------
  for r in select * from jsonb_array_elements(coalesce(p->'customers', '[]'::jsonb)) loop
    v_taker := null;
    if nullif(trim(coalesce(r->>'order_taker', '')), '') is not null then
      select id into v_taker from public.profiles u
       where u.role = 'order_taker' and (lower(u.full_name) = lower(trim(r->>'order_taker')) or u.phone = app.norm_phone(r->>'order_taker'));
    end if;
    insert into public.customers(type, name, owner_name, phone, address, city, order_taker_id, default_discount_pct,
                                 credit_days, licence_no, licence_issued, licence_expiry)
    values (app.customer_type(coalesce(nullif(r->>'type', ''), 'Consumer')), trim(r->>'name'),
            nullif(trim(coalesce(r->>'owner_name', '')), ''), nullif(app.norm_phone(r->>'phone'), ''),
            nullif(trim(coalesce(r->>'address', '')), ''), nullif(trim(coalesce(r->>'city', '')), ''), v_taker,
            coalesce(app.try_num(r->>'discount'), 0), app.try_num(r->>'credit_days')::int,
            nullif(trim(coalesce(r->>'licence_no', '')), ''), app.try_date(r->>'licence_issued'), app.try_date(r->>'licence_expiry'))
    returning id into v_id;
    v_n := coalesce(app.try_num(r->>'opening_balance'), 0);
    if v_n <> 0 then
      insert into public.ledger_entries(customer_id, kind, debit, credit, note, created_by)
      values (v_id, 'opening', greatest(v_n, 0), greatest(-v_n, 0), 'Opening balance (Excel import)', me.id);
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p->'bills', '[]'::jsonb)) loop
    select id into v_cust from public.customers where lower(name) = lower(trim(r->>'customer'));
    perform app.add_opening_bill(me.id, v_cust, r->>'bill_no', app.try_date(r->>'date'), app.try_num(r->>'amount'),
                                 coalesce(app.try_num(r->>'paid'), 0), app.try_date(r->>'due_date'));
  end loop;

  perform public.stock_set_bulk(coalesce((
    select jsonb_agg(jsonb_build_object('product_id', pr.id, 'qty', app.try_num(e->>'qty')::int))
      from jsonb_array_elements(coalesce(p->'stock', '[]'::jsonb)) e
      join public.products pr
        on (nullif(e->>'product_id', '') is not null and pr.id::text = e->>'product_id')
        or (nullif(e->>'product_id', '') is null and lower(pr.name) = lower(trim(coalesce(e->>'product', '')))
            and lower(coalesce(pr.pack_size, '')) = lower(trim(coalesce(e->>'pack_size', ''))))
     where nullif(e->>'qty', '') is not null), '[]'::jsonb), 'Opening stock (Excel import)');

  perform app.log(me.id, 'excel_import', 'settings', null, jsonb_build_object('customers', n_c, 'bills', n_b, 'stock', n_s));
  return jsonb_build_object('errors', '[]'::jsonb, 'committed', true,
                            'counts', jsonb_build_object('customers', n_c, 'bills', n_b, 'stock', n_s));
end $$;

-- =====================================================================
-- Permissions for new and changed functions
-- =====================================================================
revoke execute on function
  public.order_deliver(uuid, date), public.order_return(uuid, jsonb, text),
  public.orders_list(text, uuid, text, integer, integer, date, date, uuid),
  public.stock_sheet(date, boolean), public.orders_summary(date, date),
  public.invoice_settings(), public.invoice_settings_save(jsonb),
  public.customer_set_opening(uuid, numeric), public.opening_bill_add(jsonb),
  public.stock_set_bulk(jsonb, text), public.import_opening(jsonb, boolean)
  from public, anon;
grant execute on function
  public.order_deliver(uuid, date), public.order_return(uuid, jsonb, text),
  public.orders_list(text, uuid, text, integer, integer, date, date, uuid),
  public.stock_sheet(date, boolean), public.orders_summary(date, date),
  public.invoice_settings(), public.invoice_settings_save(jsonb),
  public.customer_set_opening(uuid, numeric), public.opening_bill_add(jsonb),
  public.stock_set_bulk(jsonb, text), public.import_opening(jsonb, boolean)
  to authenticated;
revoke execute on function public.service_create_profile(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.service_create_profile(uuid, text, text, text, uuid) to service_role;
