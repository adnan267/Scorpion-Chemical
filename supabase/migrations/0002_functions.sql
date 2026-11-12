-- Scorpion Chemical distribution app — v1 server logic
-- `app.*`    : internal helpers (not reachable from the API)
-- `public.*` : the API. Every function checks who is calling before doing anything.

-- =====================================================================
-- Internal helpers
-- =====================================================================

create function app.today() returns date language sql stable as $$
  select (now() at time zone 'Asia/Karachi')::date
$$;

create function app.money(n numeric) returns text language sql immutable as $$
  select case when n = trunc(n) then to_char(n, 'FM999,999,999,990')
              else to_char(n, 'FM999,999,999,990.00') end
$$;

create function app.method_label(m text) returns text language sql immutable as $$
  select case m when 'cash' then 'Cash' when 'bank_transfer' then 'Bank Transfer' when 'jazzcash' then 'JazzCash'
                when 'easypaisa' then 'EasyPaisa' else 'Other' end
$$;

create function app.fmt_date(d date) returns text language sql immutable as $$
  select to_char(d, 'DD Mon YYYY')
$$;

-- 0300-7334811, +92 300 7334811, 923007334811 -> 03007334811
create function app.norm_phone(p text) returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d like '0092%' then d := substr(d, 5);
  elsif d like '92%' and length(d) = 12 then d := substr(d, 3);
  end if;
  if length(d) = 10 and d like '3%' then d := '0' || d; end if;
  return d;
end $$;

create function app.me() returns public.profiles
language plpgsql stable security definer set search_path = public, app as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  if not found then raise exception 'Please sign in again'; end if;
  if not p.is_active then raise exception 'This account has been deactivated. Contact the admin.'; end if;
  return p;
end $$;

create function app.require(variadic p_roles text[]) returns public.profiles
language plpgsql stable security definer set search_path = public, app as $$
declare p public.profiles := app.me();
begin
  if not (p.role = any(p_roles)) then raise exception 'You are not allowed to do this'; end if;
  return p;
end $$;

create function app.can_access_customer(p public.profiles, p_customer_id uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select case
    when p.role = 'admin' then true
    when p.role = 'order_taker' then exists (
      select 1 from public.customers c where c.id = p_customer_id and c.order_taker_id = p.id)
    else p.customer_id is not null and p.customer_id = p_customer_id
  end
$$;

create function app.assert_customer(p public.profiles, p_customer_id uuid) returns void
language plpgsql stable security definer set search_path = public, app as $$
begin
  if p_customer_id is null or not app.can_access_customer(p, p_customer_id) then
    raise exception 'You do not have access to this customer';
  end if;
end $$;

create function app.balance(p_customer_id uuid) returns numeric
language sql stable security definer set search_path = public, app as $$
  select coalesce(sum(debit - credit), 0) from public.ledger_entries where customer_id = p_customer_id
$$;

-- product-level discount wins, otherwise the customer's default discount
create function app.discount_for(p_customer_id uuid, p_product_id uuid) returns numeric
language sql stable security definer set search_path = public, app as $$
  select coalesce(
    (select d.discount_pct from public.customer_discounts d
      where d.customer_id = p_customer_id and d.product_id = p_product_id),
    (select c.default_discount_pct from public.customers c where c.id = p_customer_id),
    0)
$$;

create function app.log(p_actor uuid, p_action text, p_entity text, p_entity_id uuid, p_details jsonb default null)
returns void language sql security definer set search_path = public, app as $$
  insert into public.activity_log(actor_id, action, entity, entity_id, details)
  values (p_actor, p_action, p_entity, p_entity_id, p_details)
$$;

-- ---------- notifications ----------
create function app.notify(p_user uuid, p_title text, p_body text, p_kind text,
                           p_ref_type text default null, p_ref_id uuid default null, p_dedupe text default null)
returns void language sql security definer set search_path = public, app as $$
  insert into public.notifications(user_id, title, body, kind, ref_type, ref_id, dedupe_key)
  values (p_user, p_title, p_body, p_kind, p_ref_type, p_ref_id, p_dedupe)
  on conflict do nothing
$$;

create function app.notify_admins(p_title text, p_body text, p_kind text, p_ref_type text default null,
                                  p_ref_id uuid default null, p_dedupe text default null, p_except uuid default null)
returns void language sql security definer set search_path = public, app as $$
  insert into public.notifications(user_id, title, body, kind, ref_type, ref_id, dedupe_key)
  select p.id, p_title, p_body, p_kind, p_ref_type, p_ref_id, p_dedupe
    from public.profiles p
   where p.role = 'admin' and p.is_active and p.id is distinct from p_except
  on conflict do nothing
$$;

-- everyone who logs in for this customer, plus (optionally) its assigned order taker and one
-- extra user (e.g. whoever created the order or entered the payment). Nobody is notified twice.
create function app.notify_customer(p_customer_id uuid, p_title text, p_body text, p_kind text,
                                    p_ref_type text default null, p_ref_id uuid default null, p_dedupe text default null,
                                    p_except uuid default null, p_include_taker boolean default false,
                                    p_also uuid default null)
returns void language sql security definer set search_path = public, app as $$
  insert into public.notifications(user_id, title, body, kind, ref_type, ref_id, dedupe_key)
  select u.id, p_title, p_body, p_kind, p_ref_type, p_ref_id, p_dedupe
  from (
    select p.id from public.profiles p where p.customer_id = p_customer_id and p.is_active
    union
    select c.order_taker_id from public.customers c
     where p_include_taker and c.id = p_customer_id and c.order_taker_id is not null
    union
    select p.id from public.profiles p where p.id = p_also and p.is_active and p.role <> 'admin'
  ) u
  where u.id is distinct from p_except
  on conflict do nothing
$$;

-- ---------- which delivered orders are still unpaid ----------
-- Approved payments (and credit adjustments) first cover the opening balance and debit
-- adjustments, then delivered orders from oldest to newest.
create function app.order_dues(p_customer_id uuid default null)
returns table(order_id uuid, customer_id uuid, total numeric, paid numeric, remaining numeric)
language sql stable security definer set search_path = public, app as $$
  with tot as (
    select l.customer_id,
           coalesce(sum(l.credit), 0) as credits,
           coalesce(sum(l.debit) filter (where l.kind <> 'order'), 0) as other_debits
    from public.ledger_entries l
    where p_customer_id is null or l.customer_id = p_customer_id
    group by l.customer_id
  ), ord as (
    select l.ref_order_id as order_id, l.customer_id, l.debit as total,
           coalesce(sum(l.debit) over (partition by l.customer_id order by l.id
                    rows between unbounded preceding and 1 preceding), 0) as before
    from public.ledger_entries l
    where l.kind = 'order' and (p_customer_id is null or l.customer_id = p_customer_id)
  ), calc as (
    select o.order_id, o.customer_id, o.total,
           greatest(0, least(o.total, t.credits - t.other_debits - o.before)) as paid
    from ord o join tot t on t.customer_id = o.customer_id
  )
  select order_id, customer_id, total, paid, total - paid from calc
$$;

-- ---------- order lines ----------
-- Rebuilds the lines of an order from [{product_id, qty}] using today's rate and the
-- customer's discount, then refreshes the order totals.
create function app.write_order_items(p_order_id uuid, p_customer_id uuid, p_items jsonb)
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
    insert into public.order_items(order_id, product_id, product_name, qty, unit_price, discount_pct, line_total)
    select p_order_id, p.id,
           p.name || coalesce(' ' || nullif(p.pack_size, ''), ''),
           r.qty, p.net_rate, d.pct,
           round(r.qty * p.net_rate * (1 - d.pct / 100), 2)
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

create function app.restore_stock(p_order public.orders, p_actor uuid)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not p_order.stock_deducted then return; end if;
  update public.products p set stock_qty = p.stock_qty + i.qty
    from public.order_items i where i.order_id = p_order.id and p.id = i.product_id;
  insert into public.stock_entries(product_id, qty, kind, order_id, created_by, note)
  select product_id, qty, 'order_cancel', p_order.id, p_actor, p_order.order_no || ' cancelled'
    from public.order_items where order_id = p_order.id;
end $$;

create function app.approve_payment(p_payment_id uuid, p_actor uuid, p_remarks text)
returns void language plpgsql security definer set search_path = public, app as $$
declare pay public.payments;
begin
  update public.payments
     set status = 'approved', reviewed_by = p_actor, reviewed_at = now(),
         admin_remarks = nullif(trim(coalesce(p_remarks, '')), '')
   where id = p_payment_id and status = 'pending'
   returning * into pay;
  if not found then raise exception 'This payment has already been reviewed'; end if;
  insert into public.ledger_entries(customer_id, kind, credit, ref_payment_id, note, created_by)
  values (pay.customer_id, 'payment', pay.amount, pay.id,
          pay.payment_no || ', ' || app.method_label(pay.method),
          p_actor);
end $$;

-- ---------- due-date reminders (run once a day) ----------
create function app.run_due_reminders() returns integer
language plpgsql security definer set search_path = public, app as $$
declare r record; d int; n int := 0; v_title text; v_body text; v_key text;
begin
  for r in
    select o.id, o.order_no, o.due_date, o.customer_id, c.name as customer_name, x.remaining
    from app.order_dues(null) x
    join public.orders o on o.id = x.order_id
    join public.customers c on c.id = o.customer_id
    where x.remaining > 0 and o.due_date is not null
  loop
    d := r.due_date - app.today();
    if d = 2 then
      v_title := 'Payment due in 2 days';
    elsif d = 0 then
      v_title := 'Payment due today';
    elsif d < 0 and (-d) % 3 = 0 then
      v_title := 'Payment overdue by ' || (-d) || ' days';
    else
      continue;
    end if;
    v_body := r.order_no || ', Rs. ' || app.money(r.remaining) || ' remaining, due ' || app.fmt_date(r.due_date);
    v_key := 'due:' || r.id || ':' || app.today();
    perform app.notify_customer(r.customer_id, v_title, v_body, 'due', 'order', r.id, v_key, null, true);
    perform app.notify_admins(v_title, r.customer_name || ', ' || v_body, 'due', 'order', r.id, v_key);
    n := n + 1;
  end loop;
  return n;
end $$;

-- =====================================================================
-- API: session
-- =====================================================================

create function public.my_profile() returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.me();
begin
  return jsonb_build_object(
    'id', me.id, 'role', me.role, 'full_name', me.full_name, 'phone', me.phone,
    'customer_id', me.customer_id,
    'customer', (select jsonb_build_object('id', c.id, 'name', c.name, 'type', c.type, 'city', c.city,
                                           'address', c.address, 'phone', c.phone)
                   from public.customers c where c.id = me.customer_id),
    'company', (select value from public.app_settings where key = 'company'));
end $$;

-- used by storage rules
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active)
$$;

create function public.can_view_proof(p_path text) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1
    from public.payments pay
    join public.profiles me on me.id = auth.uid() and me.is_active
    where pay.proof_path = p_path
      and (me.role = 'admin'
           or pay.entered_by = me.id
           or (me.customer_id is not null and me.customer_id = pay.customer_id)
           or (me.role = 'order_taker' and exists (
                 select 1 from public.customers c where c.id = pay.customer_id and c.order_taker_id = me.id))))
$$;

create function public.register_push_token(p_token text, p_platform text default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.me();
begin
  if coalesce(trim(p_token), '') = '' then return; end if;
  insert into public.push_tokens(token, user_id, platform) values (p_token, me.id, p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end $$;

create function public.remove_push_token(p_token text) returns void
language sql security definer set search_path = public, app as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid()
$$;

-- =====================================================================
-- API: dashboard
-- =====================================================================

create function public.dashboard() returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  me public.profiles := app.me();
  t date := app.today();
  day_start timestamptz := (t::timestamp at time zone 'Asia/Karachi');
  month_start timestamptz := (date_trunc('month', t::timestamp) at time zone 'Asia/Karachi');
begin
  if me.role = 'admin' then
    return jsonb_build_object(
      'today_orders',     (select count(*) from orders where created_at >= day_start and status <> 'cancelled'),
      'today_sales',      (select coalesce(sum(total), 0) from orders where created_at >= day_start and status <> 'cancelled'),
      'month_sales',      (select coalesce(sum(total), 0) from orders where created_at >= month_start and status <> 'cancelled'),
      'pending_orders',   (select count(*) from orders where status = 'pending'),
      'to_deliver',       (select count(*) from orders where status in ('confirmed', 'dispatched')),
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
      'stores',           (select count(*) from customers where type = 'store' and is_active),
      'distributors',     (select count(*) from customers where type = 'distributor' and is_active),
      'order_takers',     (select count(*) from profiles where role = 'order_taker' and is_active));
  elsif me.role = 'order_taker' then
    return jsonb_build_object(
      'today_orders',   (select count(*) from orders where created_by = me.id and created_at >= day_start and status <> 'cancelled'),
      'today_sales',    (select coalesce(sum(total), 0) from orders where created_by = me.id and created_at >= day_start and status <> 'cancelled'),
      'month_sales',    (select coalesce(sum(total), 0) from orders where created_by = me.id and created_at >= month_start and status <> 'cancelled'),
      'pending_orders', (select count(*) from orders o join customers c on c.id = o.customer_id
                          where o.status = 'pending' and (o.created_by = me.id or c.order_taker_id = me.id)),
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
      'next_due',         (select jsonb_build_object('order_id', o.id, 'order_no', o.order_no,
                                                     'due_date', o.due_date, 'remaining', x.remaining)
                             from app.order_dues(me.customer_id) x join orders o on o.id = x.order_id
                            where x.remaining > 0 and o.due_date is not null
                            order by o.due_date limit 1));
  end if;
end $$;

-- =====================================================================
-- API: products and stock
-- =====================================================================

create function public.products_list(p_customer_id uuid default null, p_search text default null,
                                     p_include_inactive boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  me public.profiles := app.me();
  cid uuid;
  staff boolean := me.role in ('admin', 'order_taker');
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

create function public.product_save(p jsonb) returns uuid
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

  if v_id is null then
    insert into public.products(name, pack_size, category, retail_price, net_rate, packing, image_path,
                                low_stock_level, is_active, sort_order)
    values (trim(p->>'name'), nullif(trim(p->>'pack_size'), ''), nullif(trim(p->>'category'), ''),
            nullif(p->>'retail_price', '')::numeric, (p->>'net_rate')::numeric,
            nullif(trim(p->>'packing'), ''), nullif(p->>'image_path', ''),
            coalesce(nullif(p->>'low_stock_level', '')::int, 0),
            coalesce((p->>'is_active')::boolean, true),
            coalesce(nullif(p->>'sort_order', '')::int, 0))
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
      sort_order = coalesce(nullif(p->>'sort_order', '')::int, sort_order)
    where id = v_id;
    if not found then raise exception 'Product not found'; end if;
    perform app.log(me.id, 'product_updated', 'product', v_id, p - 'image_path');
  end if;
  return v_id;
end $$;

create function public.stock_add(p_product_id uuid, p_qty integer, p_kind text default 'in',
                                 p_note text default null, p_batch_no text default null,
                                 p_expiry_date date default null) returns integer
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin'); v_new int;
begin
  if p_kind not in ('in', 'adjust') then raise exception 'Invalid stock entry type'; end if;
  if p_qty is null or p_qty = 0 then raise exception 'Enter a quantity'; end if;
  if p_kind = 'in' and p_qty < 0 then raise exception 'Stock received must be a positive quantity'; end if;

  update public.products set stock_qty = stock_qty + p_qty where id = p_product_id
  returning stock_qty into v_new;
  if not found then raise exception 'Product not found'; end if;
  if v_new < 0 then raise exception 'Stock cannot go below zero'; end if;

  insert into public.stock_entries(product_id, qty, kind, note, batch_no, expiry_date, created_by)
  values (p_product_id, p_qty, p_kind, nullif(trim(coalesce(p_note, '')), ''),
          nullif(trim(coalesce(p_batch_no, '')), ''), p_expiry_date, me.id);
  return v_new;
end $$;

create function public.stock_history(p_product_id uuid, p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin');
begin
  return jsonb_build_object(
    'product', (select jsonb_build_object('id', id, 'name', name, 'pack_size', pack_size,
                                          'stock_qty', stock_qty, 'low_stock_level', low_stock_level)
                  from public.products where id = p_product_id),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'qty', s.qty, 'kind', s.kind, 'note', s.note, 'batch_no', s.batch_no,
               'expiry_date', s.expiry_date, 'created_at', s.created_at, 'by', u.full_name)
             order by s.created_at desc)
      from (select * from public.stock_entries where product_id = p_product_id
             order by created_at desc limit p_limit) s
      left join public.profiles u on u.id = s.created_by), '[]'::jsonb));
end $$;

-- =====================================================================
-- API: customers and discounts
-- =====================================================================

create function public.customers_list(p_search text default null, p_type text default null) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin', 'order_taker');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'type', c.type, 'name', c.name, 'owner_name', c.owner_name, 'phone', c.phone,
             'address', c.address, 'city', c.city, 'is_active', c.is_active,
             'default_discount_pct', c.default_discount_pct,
             'order_taker_id', c.order_taker_id, 'order_taker_name', t.full_name,
             'balance', app.balance(c.id),
             'has_login', exists (select 1 from public.profiles u where u.customer_id = c.id))
           order by c.name)
    from public.customers c
    left join public.profiles t on t.id = c.order_taker_id
    where (me.role = 'admin' or (c.order_taker_id = me.id and c.is_active))
      and (p_type is null or c.type = p_type)
      and (coalesce(trim(p_search), '') = ''
           or c.name ilike '%' || trim(p_search) || '%'
           or coalesce(c.city, '') ilike '%' || trim(p_search) || '%'
           or coalesce(c.phone, '') ilike '%' || trim(p_search) || '%')), '[]'::jsonb);
end $$;

create function public.customer_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.me(); t date := app.today();
begin
  perform app.assert_customer(me, p_id);
  return (
    select jsonb_build_object(
      'id', c.id, 'type', c.type, 'name', c.name, 'owner_name', c.owner_name, 'phone', c.phone,
      'address', c.address, 'city', c.city, 'is_active', c.is_active,
      'default_discount_pct', c.default_discount_pct,
      'order_taker_id', c.order_taker_id,
      'order_taker_name', (select full_name from public.profiles where id = c.order_taker_id),
      'balance', app.balance(c.id),
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

create function public.customer_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  me public.profiles := app.require('admin');
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_taker uuid := nullif(p->>'order_taker_id', '')::uuid;
  v_opening numeric := coalesce(nullif(p->>'opening_balance', '')::numeric, 0);
  v_disc numeric := coalesce(nullif(p->>'default_discount_pct', '')::numeric, 0);
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Name is required'; end if;
  if (p->>'type') not in ('store', 'distributor') then raise exception 'Choose store or distributor'; end if;
  if v_disc < 0 or v_disc > 100 then raise exception 'Discount must be between 0 and 100'; end if;
  if v_taker is not null and not exists (
       select 1 from public.profiles where id = v_taker and role = 'order_taker') then
    raise exception 'Selected order taker was not found';
  end if;

  if v_id is null then
    insert into public.customers(type, name, owner_name, phone, address, city, order_taker_id,
                                 default_discount_pct, is_active)
    values (p->>'type', trim(p->>'name'), nullif(trim(p->>'owner_name'), ''),
            nullif(app.norm_phone(p->>'phone'), ''), nullif(trim(p->>'address'), ''),
            nullif(trim(p->>'city'), ''), v_taker, v_disc, coalesce((p->>'is_active')::boolean, true))
    returning id into v_id;
    if v_opening <> 0 then
      insert into public.ledger_entries(customer_id, kind, debit, credit, note, created_by)
      values (v_id, 'opening', greatest(v_opening, 0), greatest(-v_opening, 0), 'Opening balance', me.id);
    end if;
    perform app.log(me.id, 'customer_created', 'customer', v_id, p);
  else
    update public.customers set
      name = trim(p->>'name'),
      owner_name = nullif(trim(p->>'owner_name'), ''),
      phone = nullif(app.norm_phone(p->>'phone'), ''),
      address = nullif(trim(p->>'address'), ''),
      city = nullif(trim(p->>'city'), ''),
      order_taker_id = v_taker,
      default_discount_pct = v_disc,
      is_active = coalesce((p->>'is_active')::boolean, is_active)
    where id = v_id;
    if not found then raise exception 'Customer not found'; end if;
    perform app.log(me.id, 'customer_updated', 'customer', v_id, p);
  end if;
  return v_id;
end $$;

create function public.customer_discounts_get(p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin');
begin
  return (
    select jsonb_build_object(
      'customer', jsonb_build_object('id', c.id, 'name', c.name, 'type', c.type),
      'default_discount_pct', c.default_discount_pct,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'product_id', p.id, 'name', p.name, 'pack_size', p.pack_size,
                 'net_rate', p.net_rate, 'discount_pct', d.discount_pct)
               order by p.sort_order, p.name, p.net_rate)
        from public.products p
        left join public.customer_discounts d on d.product_id = p.id and d.customer_id = c.id
        where p.is_active), '[]'::jsonb))
    from public.customers c where c.id = p_customer_id);
end $$;

-- p_items: [{product_id, discount_pct}] — a null/blank discount_pct removes the product-level
-- discount so the default applies again.
create function public.customer_discounts_set(p_customer_id uuid, p_default numeric, p_items jsonb) returns void
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

  update public.customers set default_discount_pct = p_default where id = p_customer_id;
  if not found then raise exception 'Customer not found'; end if;

  delete from public.customer_discounts where customer_id = p_customer_id;
  insert into public.customer_discounts(customer_id, product_id, discount_pct)
  select p_customer_id, (e->>'product_id')::uuid, (e->>'discount_pct')::numeric
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
   where nullif(e->>'discount_pct', '') is not null;

  perform app.log(me.id, 'discounts_updated', 'customer', p_customer_id,
                  jsonb_build_object('default', p_default, 'items', p_items));
end $$;

-- =====================================================================
-- API: users (login accounts are created by the admin-users edge function)
-- =====================================================================

create function public.users_list(p_role text default null) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', u.id, 'role', u.role, 'full_name', u.full_name, 'phone', u.phone,
             'is_active', u.is_active, 'customer_id', u.customer_id, 'customer_name', c.name,
             'created_at', u.created_at,
             'customers_count', (select count(*) from public.customers x where x.order_taker_id = u.id))
           order by u.role, u.full_name)
    from public.profiles u
    left join public.customers c on c.id = u.customer_id
    where p_role is null or u.role = p_role), '[]'::jsonb);
end $$;

create function public.user_update(p_id uuid, p_full_name text, p_is_active boolean) returns void
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin');
begin
  if p_id = me.id and not coalesce(p_is_active, true) then
    raise exception 'You cannot deactivate your own account';
  end if;
  update public.profiles
     set full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
         is_active = coalesce(p_is_active, is_active)
   where id = p_id;
  if not found then raise exception 'User not found'; end if;
  perform app.log(me.id, 'user_updated', 'user', p_id,
                  jsonb_build_object('full_name', p_full_name, 'is_active', p_is_active));
end $$;

-- ---- service-role only (called by the edge function with the secret key) ----
create function public.service_create_profile(p_user_id uuid, p_role text, p_full_name text, p_phone text,
                                              p_customer_id uuid default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_phone text := app.norm_phone(p_phone);
begin
  if p_role not in ('admin', 'order_taker', 'store', 'distributor') then raise exception 'Invalid role'; end if;
  if coalesce(trim(p_full_name), '') = '' then raise exception 'Name is required'; end if;
  if v_phone !~ '^03[0-9]{9}$' then raise exception 'Enter a valid mobile number, e.g. 03001234567'; end if;
  if p_role in ('store', 'distributor') then
    if not exists (select 1 from public.customers where id = p_customer_id and type = p_role) then
      raise exception 'This login must be linked to a %', p_role;
    end if;
  else
    p_customer_id := null;
  end if;
  insert into public.profiles(id, role, full_name, phone, customer_id)
  values (p_user_id, p_role, trim(p_full_name), v_phone, p_customer_id);
end $$;

create function public.service_set_phone(p_user_id uuid, p_phone text) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_phone text := app.norm_phone(p_phone);
begin
  if v_phone !~ '^03[0-9]{9}$' then raise exception 'Enter a valid mobile number, e.g. 03001234567'; end if;
  update public.profiles set phone = v_phone where id = p_user_id;
  if not found then raise exception 'User not found'; end if;
end $$;

-- first-time setup: allowed only while no admin exists and the one-time code matches
create function public.service_bootstrap_allowed(p_code text) returns boolean
language sql stable security definer set search_path = public, app as $$
  select not exists (select 1 from public.profiles where role = 'admin')
     and exists (select 1 from public.app_settings
                  where key = 'setup_code' and value #>> '{}' = p_code and coalesce(p_code, '') <> '')
$$;

create function public.service_bootstrap_done() returns void
language sql security definer set search_path = public, app as $$
  delete from public.app_settings where key = 'setup_code'
$$;

-- for the push sender
create function public.service_push_targets(p_notification_id uuid) returns jsonb
language sql stable security definer set search_path = public, app as $$
  select jsonb_build_object(
    'title', n.title, 'body', n.body, 'kind', n.kind, 'ref_type', n.ref_type, 'ref_id', n.ref_id,
    'tokens', coalesce((select jsonb_agg(t.token) from public.push_tokens t where t.user_id = n.user_id), '[]'::jsonb))
  from public.notifications n where n.id = p_notification_id
$$;

create function public.service_drop_push_token(p_token text) returns void
language sql security definer set search_path = public, app as $$
  delete from public.push_tokens where token = p_token
$$;

-- =====================================================================
-- API: orders
-- =====================================================================

create function public.order_place(p_customer_id uuid, p_items jsonb, p_notes text default null) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  me public.profiles := app.me();
  cid uuid; c public.customers; v_id uuid; v_no text; v_total numeric;
begin
  cid := case when me.role in ('store', 'distributor') then me.customer_id else p_customer_id end;
  if cid is null then raise exception 'Select a customer first'; end if;
  perform app.assert_customer(me, cid);
  select * into c from public.customers where id = cid;
  if not c.is_active then raise exception 'This customer is inactive'; end if;

  insert into public.orders(customer_id, created_by, order_taker_id, notes)
  values (cid, me.id, case when me.role = 'order_taker' then me.id end, nullif(trim(coalesce(p_notes, '')), ''))
  returning id, order_no into v_id, v_no;
  perform app.write_order_items(v_id, cid, p_items);
  select total into v_total from public.orders where id = v_id;

  perform app.log(me.id, 'order_placed', 'order', v_id, jsonb_build_object('total', v_total));
  perform app.notify_admins('New order ' || v_no, c.name || ', Rs. ' || app.money(v_total) || ', by ' || me.full_name,
                            'order', 'order', v_id, null, me.id);
  -- tell the customer when someone ordered for them, and the order taker when the customer ordered directly
  perform app.notify_customer(cid, 'New order ' || v_no,
                              'Rs. ' || app.money(v_total) || ', placed by ' || me.full_name,
                              'order', 'order', v_id, null, me.id, true);
  return jsonb_build_object('id', v_id, 'order_no', v_no, 'total', v_total);
end $$;

create function public.orders_list(p_status text default null, p_customer_id uuid default null,
                                   p_search text default null, p_limit integer default 50,
                                   p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.me(); t date := app.today();
begin
  return coalesce((
    select jsonb_agg(j order by created_at desc)
    from (
      select o.created_at,
        jsonb_build_object(
          'id', o.id, 'order_no', o.order_no, 'status', o.status, 'total', o.total,
          'due_date', o.due_date, 'created_at', o.created_at, 'delivered_at', o.delivered_at,
          'customer_id', c.id, 'customer_name', c.name, 'customer_type', c.type, 'city', c.city,
          'created_by_name', u.full_name, 'created_by_role', u.role,
          'items_count', (select count(*) from public.order_items i where i.order_id = o.id),
          'paid', coalesce(x.paid, 0), 'remaining', x.remaining,
          'overdue', coalesce(x.remaining > 0 and o.due_date < t, false)) as j
      from public.orders o
      join public.customers c on c.id = o.customer_id
      join public.profiles u on u.id = o.created_by
      left join app.order_dues(case when me.role in ('store', 'distributor') then me.customer_id else p_customer_id end) x
             on x.order_id = o.id
      where (me.role = 'admin'
             or (me.role = 'order_taker' and (o.created_by = me.id or c.order_taker_id = me.id))
             or (me.role in ('store', 'distributor') and o.customer_id = me.customer_id))
        and (p_customer_id is null or o.customer_id = p_customer_id)
        and (p_status is null
             or (p_status = 'open' and o.status in ('pending', 'confirmed', 'dispatched'))
             or (p_status = 'unpaid' and x.remaining > 0)
             or (p_status = 'overdue' and x.remaining > 0 and o.due_date < t)
             or o.status = p_status)
        and (coalesce(trim(p_search), '') = ''
             or o.order_no ilike '%' || trim(p_search) || '%'
             or c.name ilike '%' || trim(p_search) || '%')
      order by o.created_at desc
      limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
    ) s), '[]'::jsonb);
end $$;

create function public.order_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  me public.profiles := app.me();
  o public.orders;
  staff boolean := me.role in ('admin', 'order_taker');
begin
  select * into o from public.orders where id = p_id;
  if not found then raise exception 'Order not found'; end if;
  if not (app.can_access_customer(me, o.customer_id) or o.created_by = me.id) then
    raise exception 'You do not have access to this order';
  end if;

  return jsonb_build_object(
    'id', o.id, 'order_no', o.order_no, 'status', o.status,
    'subtotal', o.subtotal, 'discount_total', o.discount_total, 'total', o.total,
    'due_date', o.due_date, 'notes', o.notes, 'cancel_reason', o.cancel_reason,
    'created_at', o.created_at, 'confirmed_at', o.confirmed_at, 'dispatched_at', o.dispatched_at,
    'delivered_at', o.delivered_at, 'cancelled_at', o.cancelled_at,
    'created_by', o.created_by,
    'created_by_name', (select full_name from public.profiles where id = o.created_by),
    'created_by_role', (select role from public.profiles where id = o.created_by),
    'customer', (select jsonb_build_object('id', c.id, 'name', c.name, 'type', c.type, 'phone', c.phone,
                                           'address', c.address, 'city', c.city, 'balance', app.balance(c.id))
                   from public.customers c where c.id = o.customer_id),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'product_id', i.product_id, 'product_name', i.product_name, 'qty', i.qty,
               'unit_price', i.unit_price, 'discount_pct', i.discount_pct, 'line_total', i.line_total,
               'stock_qty', case when staff then p.stock_qty end)
             order by i.product_name)
      from public.order_items i join public.products p on p.id = i.product_id
      where i.order_id = o.id), '[]'::jsonb),
    'paid', coalesce((select x.paid from app.order_dues(o.customer_id) x where x.order_id = o.id), 0),
    'remaining', (select x.remaining from app.order_dues(o.customer_id) x where x.order_id = o.id),
    'history', case when me.role = 'admin' then coalesce((
      select jsonb_agg(jsonb_build_object('action', a.action, 'at', a.created_at, 'by', u.full_name,
                                          'details', a.details) order by a.id)
      from public.activity_log a left join public.profiles u on u.id = a.actor_id
      where a.entity = 'order' and a.entity_id = o.id), '[]'::jsonb) end);
end $$;

-- admin moves an order forward: pending -> confirmed -> dispatched -> delivered
create function public.order_set_status(p_id uuid, p_status text, p_due_date date default null) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  me public.profiles := app.require('admin');
  o public.orders; v_short text; r record;
  ranks constant jsonb := '{"pending":0,"confirmed":1,"dispatched":2,"delivered":3}';
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if p_status not in ('confirmed', 'dispatched', 'delivered') then raise exception 'Invalid status'; end if;
  if o.status in ('delivered', 'cancelled') then raise exception 'This order is already %', o.status; end if;
  if (ranks->>p_status)::int <= (ranks->>o.status)::int then
    raise exception 'This order is already %', o.status;
  end if;

  if not o.stock_deducted then
    perform 1 from public.products p
      where p.id in (select product_id from public.order_items where order_id = o.id)
      order by p.id for update;
    select string_agg(i.product_name || ' (need ' || i.qty || ', have ' || p.stock_qty || ')', ', ')
      into v_short
      from public.order_items i join public.products p on p.id = i.product_id
     where i.order_id = o.id and p.stock_qty < i.qty;
    if v_short is not null then raise exception 'Not enough stock: %', v_short; end if;

    update public.products p set stock_qty = p.stock_qty - i.qty
      from public.order_items i where i.order_id = o.id and p.id = i.product_id;
    insert into public.stock_entries(product_id, qty, kind, order_id, created_by, note)
    select product_id, -qty, 'order', o.id, me.id, o.order_no from public.order_items where order_id = o.id;

    for r in
      select p.id, p.name, p.pack_size, p.stock_qty
        from public.products p join public.order_items i on i.product_id = p.id
       where i.order_id = o.id and p.stock_qty <= p.low_stock_level
    loop
      perform app.notify_admins('Low stock: ' || r.name || coalesce(' ' || r.pack_size, ''),
                                'Only ' || r.stock_qty || ' left', 'stock', 'product', r.id,
                                'lowstock:' || r.id || ':' || app.today());
    end loop;
  end if;

  update public.orders set
    status = p_status,
    stock_deducted = true,
    confirmed_at = coalesce(confirmed_at, now()),
    dispatched_at = case when p_status in ('dispatched', 'delivered') then coalesce(dispatched_at, now()) end,
    delivered_at = case when p_status = 'delivered' then now() end,
    due_date = coalesce(p_due_date, due_date)
  where id = o.id
  returning * into o;

  if p_status = 'delivered' then
    insert into public.ledger_entries(customer_id, kind, debit, ref_order_id, note, created_by)
    values (o.customer_id, 'order', o.total, o.id, o.order_no, me.id);
  end if;

  perform app.log(me.id, 'order_' || p_status, 'order', o.id,
                  case when p_due_date is not null then jsonb_build_object('due_date', p_due_date) end);
  perform app.notify_customer(o.customer_id, 'Order ' || o.order_no || ' ' || p_status,
    (select name from public.customers where id = o.customer_id) || ', ' ||
    case p_status
      when 'confirmed' then 'Rs. ' || app.money(o.total) || ' confirmed'
      when 'dispatched' then 'on its way'
      else 'delivered, Rs. ' || app.money(o.total) || coalesce(', payment due ' || app.fmt_date(o.due_date), '')
    end, 'order', 'order', o.id, null, me.id, true, o.created_by);
  return jsonb_build_object('id', o.id, 'status', o.status);
end $$;

-- admin: any order not yet delivered. Others: their own order while it is still pending.
create function public.order_cancel(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.me(); o public.orders;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status = 'cancelled' then return; end if;
  if o.status = 'delivered' then
    raise exception 'A delivered order cannot be cancelled';
  end if;
  if me.role <> 'admin' then
    if not (o.created_by = me.id or (me.customer_id is not null and me.customer_id = o.customer_id)) then
      raise exception 'You do not have access to this order';
    end if;
    if o.status <> 'pending' then
      raise exception 'This order is already confirmed. Ask the admin to cancel it.';
    end if;
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

create function public.order_set_due_date(p_id uuid, p_due_date date) returns void
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin'); o public.orders;
begin
  update public.orders set due_date = p_due_date where id = p_id and status <> 'cancelled' returning * into o;
  if not found then raise exception 'Order not found'; end if;
  perform app.log(me.id, 'order_due_date', 'order', o.id, jsonb_build_object('due_date', p_due_date));
  if p_due_date is not null then
    perform app.notify_customer(o.customer_id, 'Payment due date set',
                                o.order_no || ', Rs. ' || app.money(o.total) || ', due ' || app.fmt_date(p_due_date),
                                'due', 'order', o.id, null, me.id, true);
  end if;
end $$;

create function public.order_update_items(p_id uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin'); o public.orders;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status <> 'pending' then raise exception 'Only a pending order can be edited'; end if;
  perform app.write_order_items(o.id, o.customer_id, p_items);
  select * into o from public.orders where id = p_id;
  perform app.log(me.id, 'order_edited', 'order', o.id, jsonb_build_object('total', o.total, 'items', p_items));
  perform app.notify_customer(o.customer_id, 'Order ' || o.order_no || ' updated',
                              'New total Rs. ' || app.money(o.total), 'order', 'order', o.id, null, me.id, true);
  return jsonb_build_object('id', o.id, 'total', o.total);
end $$;

-- =====================================================================
-- API: payments
-- =====================================================================

create function public.payment_submit(p_customer_id uuid, p_amount numeric, p_method text,
                                      p_reference_no text default null, p_proof_path text default null,
                                      p_note text default null, p_order_id uuid default null,
                                      p_paid_on date default null) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  me public.profiles := app.me();
  cid uuid; c public.customers; v_id uuid; v_no text;
  v_proof text := nullif(trim(coalesce(p_proof_path, '')), '');
  v_status text := 'pending';
begin
  cid := case when me.role in ('store', 'distributor') then me.customer_id else p_customer_id end;
  if cid is null then raise exception 'Select a customer first'; end if;
  perform app.assert_customer(me, cid);
  select * into c from public.customers where id = cid;

  if p_amount is null or p_amount <= 0 then raise exception 'Enter a valid amount'; end if;
  if p_method not in ('cash', 'bank_transfer', 'jazzcash', 'easypaisa', 'other') then
    raise exception 'Choose a payment method';
  end if;
  if v_proof is not null and v_proof not like me.id::text || '/%' then
    raise exception 'Invalid receipt file';
  end if;
  if me.role in ('store', 'distributor') and v_proof is null then
    raise exception 'Attach a photo of the payment receipt';
  end if;
  if me.role = 'order_taker' and p_method <> 'cash' and v_proof is null then
    raise exception 'Attach the receipt (only cash payments can be entered without one)';
  end if;
  if p_order_id is not null and not exists (
       select 1 from public.orders where id = p_order_id and customer_id = cid) then
    raise exception 'That order does not belong to this customer';
  end if;
  if p_paid_on is not null and p_paid_on > app.today() then
    raise exception 'Payment date cannot be in the future';
  end if;

  insert into public.payments(customer_id, order_id, amount, method, reference_no, proof_path, note,
                              paid_on, entered_by, entered_by_role)
  values (cid, p_order_id, round(p_amount, 2), p_method, nullif(trim(coalesce(p_reference_no, '')), ''),
          v_proof, nullif(trim(coalesce(p_note, '')), ''), coalesce(p_paid_on, app.today()), me.id, me.role)
  returning id, payment_no into v_id, v_no;
  perform app.log(me.id, 'payment_submitted', 'payment', v_id,
                  jsonb_build_object('amount', p_amount, 'method', p_method));

  if me.role = 'admin' then
    perform app.approve_payment(v_id, me.id, null);
    v_status := 'approved';
    perform app.log(me.id, 'payment_approved', 'payment', v_id, null);
    perform app.notify_customer(cid, 'Payment recorded', 'Rs. ' || app.money(p_amount) || ', ' || v_no ||
                                ', balance Rs. ' || app.money(app.balance(cid)),
                                'payment', 'payment', v_id, null, me.id, true);
  else
    perform app.notify_admins('Payment awaiting approval',
                              c.name || ', Rs. ' || app.money(p_amount) || ', entered by ' || me.full_name,
                              'payment', 'payment', v_id, null, me.id);
    if me.role = 'order_taker' then
      perform app.notify_customer(cid, 'Payment received by ' || me.full_name,
                                  'Rs. ' || app.money(p_amount) || ', ' || v_no || ', waiting for admin approval',
                                  'payment', 'payment', v_id, null, me.id, false);
    end if;
  end if;
  return jsonb_build_object('id', v_id, 'payment_no', v_no, 'status', v_status);
end $$;

create function public.payment_review(p_id uuid, p_approve boolean, p_remarks text default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin'); pay public.payments;
begin
  select * into pay from public.payments where id = p_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if pay.status <> 'pending' then raise exception 'This payment has already been %', pay.status; end if;

  if p_approve then
    perform app.approve_payment(pay.id, me.id, p_remarks);
    perform app.log(me.id, 'payment_approved', 'payment', pay.id, jsonb_build_object('remarks', p_remarks));
    perform app.notify_customer(pay.customer_id, 'Payment approved',
                                'Rs. ' || app.money(pay.amount) || ', ' || pay.payment_no ||
                                ', balance Rs. ' || app.money(app.balance(pay.customer_id)),
                                'payment', 'payment', pay.id, null, me.id, false, pay.entered_by);
  else
    if coalesce(trim(p_remarks), '') = '' then raise exception 'Write the reason for rejecting'; end if;
    update public.payments
       set status = 'rejected', reviewed_by = me.id, reviewed_at = now(), admin_remarks = trim(p_remarks)
     where id = pay.id;
    perform app.log(me.id, 'payment_rejected', 'payment', pay.id, jsonb_build_object('remarks', p_remarks));
    perform app.notify_customer(pay.customer_id, 'Payment rejected',
                                'Rs. ' || app.money(pay.amount) || ', ' || pay.payment_no || ', ' || trim(p_remarks),
                                'payment', 'payment', pay.id, null, me.id, false, pay.entered_by);
  end if;
end $$;

create function public.payments_list(p_status text default null, p_customer_id uuid default null,
                                     p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.me();
begin
  return coalesce((
    select jsonb_agg(j order by created_at desc)
    from (
      select pay.created_at,
        jsonb_build_object(
          'id', pay.id, 'payment_no', pay.payment_no, 'amount', pay.amount, 'method', pay.method,
          'status', pay.status, 'paid_on', pay.paid_on, 'created_at', pay.created_at,
          'has_proof', pay.proof_path is not null,
          'customer_id', c.id, 'customer_name', c.name, 'customer_type', c.type,
          'entered_by_name', u.full_name, 'entered_by_role', pay.entered_by_role) as j
      from public.payments pay
      join public.customers c on c.id = pay.customer_id
      join public.profiles u on u.id = pay.entered_by
      where (me.role = 'admin'
             or (me.role = 'order_taker' and (pay.entered_by = me.id or c.order_taker_id = me.id))
             or (me.role in ('store', 'distributor') and pay.customer_id = me.customer_id))
        and (p_customer_id is null or pay.customer_id = p_customer_id)
        and (p_status is null
             or (p_status = 'cash_in_hand' and pay.status = 'pending' and pay.method = 'cash'
                 and pay.entered_by_role = 'order_taker')
             or pay.status = p_status)
      order by pay.created_at desc
      limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
    ) s), '[]'::jsonb);
end $$;

create function public.payment_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.me(); pay public.payments;
begin
  select * into pay from public.payments where id = p_id;
  if not found then raise exception 'Payment not found'; end if;
  if not (app.can_access_customer(me, pay.customer_id) or pay.entered_by = me.id) then
    raise exception 'You do not have access to this payment';
  end if;
  return jsonb_build_object(
    'id', pay.id, 'payment_no', pay.payment_no, 'amount', pay.amount, 'method', pay.method,
    'reference_no', pay.reference_no, 'proof_path', pay.proof_path, 'note', pay.note,
    'paid_on', pay.paid_on, 'status', pay.status, 'admin_remarks', pay.admin_remarks,
    'created_at', pay.created_at, 'reviewed_at', pay.reviewed_at,
    'reviewed_by_name', (select full_name from public.profiles where id = pay.reviewed_by),
    'entered_by_name', (select full_name from public.profiles where id = pay.entered_by),
    'entered_by_role', pay.entered_by_role,
    'order', (select jsonb_build_object('id', o.id, 'order_no', o.order_no, 'total', o.total)
                from public.orders o where o.id = pay.order_id),
    'customer', (select jsonb_build_object('id', c.id, 'name', c.name, 'type', c.type, 'city', c.city,
                                           'balance', app.balance(c.id))
                   from public.customers c where c.id = pay.customer_id));
end $$;

-- cash collected by order takers that the admin has not approved (received) yet
create function public.cash_in_hand() returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin', 'order_taker');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('order_taker_id', u.id, 'name', u.full_name, 'phone', u.phone,
                                        'amount', s.amount, 'count', s.cnt) order by s.amount desc)
    from (
      select entered_by, sum(amount) as amount, count(*) as cnt
        from public.payments
       where status = 'pending' and method = 'cash' and entered_by_role = 'order_taker'
         and (me.role = 'admin' or entered_by = me.id)
       group by entered_by) s
    join public.profiles u on u.id = s.entered_by), '[]'::jsonb);
end $$;

-- =====================================================================
-- API: ledger
-- =====================================================================

create function public.ledger_get(p_customer_id uuid default null, p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.me(); cid uuid;
begin
  cid := case when me.role in ('store', 'distributor') then me.customer_id else p_customer_id end;
  perform app.assert_customer(me, cid);
  return jsonb_build_object(
    'customer', (select jsonb_build_object('id', c.id, 'name', c.name, 'type', c.type, 'city', c.city,
                                           'phone', c.phone, 'address', c.address)
                   from public.customers c where c.id = cid),
    'balance', app.balance(cid),
    'total_debit', (select coalesce(sum(debit), 0) from public.ledger_entries where customer_id = cid),
    'total_credit', (select coalesce(sum(credit), 0) from public.ledger_entries where customer_id = cid),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'kind', s.kind, 'debit', s.debit, 'credit', s.credit, 'note', s.note,
               'created_at', s.created_at, 'balance', s.running,
               'order_id', s.ref_order_id, 'payment_id', s.ref_payment_id) order by s.id desc)
      from (
        select l.*, sum(l.debit - l.credit) over (order by l.id) as running
          from public.ledger_entries l where l.customer_id = cid
         order by l.id desc limit least(greatest(p_limit, 1), 1000)) s), '[]'::jsonb));
end $$;

create function public.ledger_adjust(p_customer_id uuid, p_amount numeric, p_direction text, p_note text) returns void
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin'); v_id bigint;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a valid amount'; end if;
  if p_direction not in ('debit', 'credit') then raise exception 'Choose increase or decrease'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Write the reason for this adjustment'; end if;
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'Customer not found';
  end if;
  insert into public.ledger_entries(customer_id, kind, debit, credit, note, created_by)
  values (p_customer_id, 'adjustment',
          case when p_direction = 'debit' then round(p_amount, 2) else 0 end,
          case when p_direction = 'credit' then round(p_amount, 2) else 0 end,
          trim(p_note), me.id);
  perform app.log(me.id, 'ledger_adjusted', 'customer', p_customer_id,
                  jsonb_build_object('amount', p_amount, 'direction', p_direction, 'note', p_note));
  perform app.notify_customer(p_customer_id, 'Account adjusted',
                              (case when p_direction = 'debit' then 'Added Rs. ' else 'Reduced Rs. ' end) ||
                              app.money(p_amount) || ', ' || trim(p_note) ||
                              ', balance Rs. ' || app.money(app.balance(p_customer_id)),
                              'payment', 'ledger', p_customer_id, null, me.id, false);
end $$;

-- =====================================================================
-- API: notifications
-- =====================================================================

create function public.notifications_list(p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.me();
begin
  return jsonb_build_object(
    'unread', (select count(*) from public.notifications where user_id = me.id and not is_read),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'kind', n.kind,
                                          'ref_type', n.ref_type, 'ref_id', n.ref_id,
                                          'is_read', n.is_read, 'created_at', n.created_at)
                       order by n.created_at desc)
      from (select * from public.notifications where user_id = me.id
             order by created_at desc limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) n),
      '[]'::jsonb));
end $$;

create function public.notifications_unread() returns integer
language sql stable security definer set search_path = public, app as $$
  select count(*)::int from public.notifications where user_id = auth.uid() and not is_read
$$;

create function public.notifications_mark_read(p_id uuid default null) returns void
language sql security definer set search_path = public, app as $$
  update public.notifications set is_read = true
   where user_id = auth.uid() and not is_read and (p_id is null or id = p_id)
$$;

create function public.announce(p_title text, p_body text, p_audience text default 'all') returns integer
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin'); n int;
begin
  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_body), '') = '' then
    raise exception 'Write a title and a message';
  end if;
  if p_audience not in ('all', 'store', 'distributor', 'order_taker') then
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

create function public.reminders_run_now() returns integer
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin');
begin
  return app.run_due_reminders();
end $$;

-- =====================================================================
-- API: settings
-- =====================================================================

create function public.settings_save(p_company jsonb) returns void
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin');
begin
  if coalesce(trim(p_company->>'name'), '') = '' then raise exception 'Company name is required'; end if;
  insert into public.app_settings(key, value)
  values ('company', jsonb_build_object('name', trim(p_company->>'name'), 'address', p_company->>'address',
                                        'phone', p_company->>'phone', 'email', p_company->>'email'))
  on conflict (key) do update set value = excluded.value;
end $$;

-- =====================================================================
-- Permissions: signed-in users may call the API; nobody else may.
-- =====================================================================
revoke all on schema app from public;
revoke execute on all functions in schema public from public, anon, authenticated;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    if f.proname like 'service\_%' then
      execute format('grant execute on function %s to service_role', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

-- New functions created later in public should not be callable by default.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
