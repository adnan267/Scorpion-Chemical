-- Scorpion Chemical v2.4 (16 Nov 2026)
--  * Admin can delete a customer (party) with all its orders, payments, ledger and logins.
--  * Office expenses (electricity, rent, salaries, kitchen...) next to order taker tour expenses.
--  * Dashboard: today's recovery and today's expenses; recovery of a day; printable recovery sheet.
--  * Customers cannot submit cash payments (cash goes through the order taker).

-- ---------------------------------------------------------------- ledger: allow a full purge only
create or replace function app.ledger_immutable() returns trigger language plpgsql as $$
begin
  if current_setting('scorpion.purge', true) = 'on' and tg_op = 'DELETE' then return old; end if;
  raise exception 'Ledger entries cannot be changed or deleted. Add an adjustment entry instead.';
end $$;

-- Deletes a customer and everything that belongs to it. Stock of orders not delivered yet goes
-- back to the store; delivered goods stay sold. The admin must type the customer's name.
create or replace function public.customer_delete(p_id uuid, p_confirm_name text) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  me public.profiles := app.require('admin');
  c public.customers; o public.orders; logins uuid[]; n_orders int; n_payments int; v_bal numeric;
begin
  select * into c from public.customers where id = p_id for update;
  if not found then raise exception 'Customer not found'; end if;
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(c.name)) then
    raise exception 'Type the customer''s name exactly to delete it';
  end if;
  select coalesce(array_agg(id), '{}') into logins from public.profiles where customer_id = c.id;
  select count(*) into n_orders from public.orders where customer_id = c.id;
  select count(*) into n_payments from public.payments where customer_id = c.id;
  v_bal := app.balance(c.id);

  for o in select * from public.orders where customer_id = c.id and status in ('pending', 'confirmed', 'dispatched') loop
    perform app.restore_stock(o, me.id);
  end loop;

  perform set_config('scorpion.purge', 'on', true);
  delete from public.ledger_entries where customer_id = c.id;
  perform set_config('scorpion.purge', 'off', true);
  delete from public.payments where customer_id = c.id;
  delete from public.order_returns where customer_id = c.id;
  delete from public.orders where customer_id = c.id;

  update public.activity_log set actor_id = null where actor_id = any(logins);
  update public.stock_entries set created_by = null where created_by = any(logins);
  update public.customers set added_by = null where added_by = any(logins);
  delete from auth.users where id = any(logins);
  delete from public.profiles where id = any(logins);
  delete from public.customers where id = c.id;

  perform app.log(me.id, 'customer_deleted', 'customer', c.id,
                  jsonb_build_object('name', c.name, 'city', c.city, 'orders', n_orders, 'payments', n_payments,
                                     'balance', v_bal, 'logins', coalesce(array_length(logins, 1), 0)));
  return jsonb_build_object('orders', n_orders, 'payments', n_payments, 'logins', coalesce(array_length(logins, 1), 0));
end $$;

-- ---------------------------------------------------------------- customers cannot send cash
create or replace function app.payments_no_customer_cash() returns trigger language plpgsql as $$
begin
  if new.entered_by_role in ('store', 'distributor') and new.method = 'cash' then
    raise exception 'Cash is handed to the order taker. Choose bank transfer, JazzCash or Easypaisa.';
  end if;
  return new;
end $$;
create trigger payments_no_customer_cash before insert on public.payments
  for each row execute function app.payments_no_customer_cash();

-- ---------------------------------------------------------------- office expenses
alter table public.expenses alter column city drop not null;
alter table public.expenses add column kind text not null default 'tour' check (kind in ('tour', 'office'));
alter table public.expenses drop constraint expenses_category_check;
alter table public.expenses add constraint expenses_category_check check (category in (
  'van', 'bus', 'rickshaw', 'chingchi', 'bike_fuel', 'food', 'stock_carriage', 'other',
  'electricity', 'rent', 'salary', 'kitchen', 'utilities', 'office_other'));

create or replace function app.expense_label(c text) returns text language sql immutable as $$
  select case c when 'van' then 'Wagon / van' when 'bus' then 'Bus' when 'rickshaw' then 'Rickshaw'
    when 'chingchi' then 'Chingchi' when 'bike_fuel' then 'Bike petrol' when 'food' then 'Food'
    when 'stock_carriage' then 'Stock carriage' when 'electricity' then 'Electricity bill'
    when 'rent' then 'Rent' when 'salary' then 'Salary' when 'kitchen' then 'Kitchen, tea, water'
    when 'utilities' then 'Gas, phone, internet' when 'office_other' then 'Other office expense' else 'Other' end
$$;

create or replace function public.office_expense_add(p jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  me public.profiles := app.require('admin');
  v_amount numeric := app.try_num(p->>'amount');
  v_date date := coalesce(app.try_date(p->>'date'), app.today());
  v_cat text := coalesce(nullif(p->>'category', ''), 'office_other');
  v_id uuid;
begin
  if v_cat not in ('electricity', 'rent', 'salary', 'kitchen', 'utilities', 'office_other') then
    raise exception 'Choose what the expense was for';
  end if;
  if v_amount is null or v_amount <= 0 then raise exception 'Enter the amount'; end if;
  if v_amount > 10000000 then raise exception 'Amount looks too large'; end if;
  if v_date > app.today() then raise exception 'Date cannot be in the future'; end if;
  if v_cat in ('salary', 'office_other') and nullif(trim(coalesce(p->>'note', '')), '') is null then
    raise exception 'Write who or what it was for';
  end if;
  insert into public.expenses(user_id, spent_on, city, category, amount, note, kind)
  values (me.id, v_date, null, v_cat, round(v_amount, 2), nullif(trim(coalesce(p->>'note', '')), ''), 'office')
  returning id into v_id;
  perform app.log(me.id, 'office_expense', 'profile', me.id, jsonb_build_object('category', v_cat, 'amount', v_amount, 'date', v_date));
  return v_id;
end $$;

alter table public.expenses drop constraint expenses_amount_check;
alter table public.expenses add constraint expenses_amount_check check (amount > 0 and amount <= 10000000);

create or replace function public.expenses_report(p_from date, p_to date, p_user_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin');
begin
  return (
    with e as (
      select x.*, u.full_name from public.expenses x join public.profiles u on u.id = x.user_id
       where x.spent_on between p_from and p_to and x.kind = 'tour' and (p_user_id is null or x.user_id = p_user_id)
    ), off as (
      select x.* from public.expenses x
       where x.spent_on between p_from and p_to and x.kind = 'office' and p_user_id is null
    ), tours as (
      select user_id, full_name, spent_on, city, sum(amount) as total, count(*) as n from e group by 1, 2, 3, 4
    )
    select jsonb_build_object(
      'from', p_from, 'to', p_to,
      'tour_total', (select coalesce(sum(amount), 0) from e),
      'office_total', (select coalesce(sum(amount), 0) from off),
      'total', (select coalesce(sum(amount), 0) from e) + (select coalesce(sum(amount), 0) from off),
      'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'label', app.expense_label(category), 'amount', s) order by s desc)
                                 from (select category, sum(amount) s from e group by 1) c), '[]'::jsonb),
      'office_by_category', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'label', app.expense_label(category), 'amount', s) order by s desc)
                                 from (select category, sum(amount) s from off group by 1) c), '[]'::jsonb),
      'office', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'date', spent_on, 'category', category, 'label', app.expense_label(category),
                                                             'amount', amount, 'note', note, 'created_at', created_at) order by spent_on desc, created_at desc)
                            from off), '[]'::jsonb),
      'by_user', coalesce((select jsonb_agg(jsonb_build_object('user_id', user_id, 'name', full_name, 'amount', s, 'tours', n) order by s desc)
                             from (select user_id, full_name, sum(total) s, count(*) n from tours group by 1, 2) c), '[]'::jsonb),
      'by_city', coalesce((select jsonb_agg(jsonb_build_object('city', city, 'tours', n, 'amount', s, 'average', round(s / n, 0)) order by n desc, city)
                             from (select initcap(lower(city)) city, count(*) n, sum(total) s from tours group by 1) c), '[]'::jsonb),
      'tours', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'user_id', t.user_id, 'name', t.full_name, 'date', t.spent_on, 'city', t.city, 'total', t.total,
                 'orders', (select count(*) from public.orders o where o.created_by = t.user_id and not o.is_opening and o.status <> 'cancelled'
                              and o.created_at >= (t.spent_on::timestamp at time zone 'Asia/Karachi')
                              and o.created_at < ((t.spent_on + 1)::timestamp at time zone 'Asia/Karachi')),
                 'sales', (select coalesce(sum(o.total), 0) from public.orders o where o.created_by = t.user_id and not o.is_opening and o.status <> 'cancelled'
                              and o.created_at >= (t.spent_on::timestamp at time zone 'Asia/Karachi')
                              and o.created_at < ((t.spent_on + 1)::timestamp at time zone 'Asia/Karachi')),
                 'items', (select jsonb_agg(jsonb_build_object('id', x.id, 'category', x.category, 'label', app.expense_label(x.category),
                                                               'amount', x.amount, 'note', x.note, 'created_at', x.created_at) order by x.created_at)
                             from e x where x.user_id = t.user_id and x.spent_on = t.spent_on and x.city = t.city))
               order by t.spent_on desc, t.full_name)
          from tours t), '[]'::jsonb)));
end $$;

-- ---------------------------------------------------------------- recovery of a day
create or replace function public.recovery_day(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin'); d date := coalesce(p_date, app.today());
begin
  return (
    with p as (
      select x.*, c.name as customer, c.city, u.full_name as entered_by_name
        from public.payments x join public.customers c on c.id = x.customer_id
        join public.profiles u on u.id = x.entered_by
       where x.paid_on = d and x.status <> 'rejected'
    )
    select jsonb_build_object(
      'date', d,
      'total', (select coalesce(sum(amount), 0) from p),
      'approved', (select coalesce(sum(amount), 0) from p where status = 'approved'),
      'pending', (select coalesce(sum(amount), 0) from p where status = 'pending'),
      'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'amount', s, 'count', n) order by s desc)
                               from (select method, sum(amount) s, count(*) n from p group by 1) m), '[]'::jsonb),
      'by_user', coalesce((select jsonb_agg(jsonb_build_object('name', entered_by_name, 'role', entered_by_role, 'amount', s, 'count', n) order by s desc)
                             from (select entered_by_name, entered_by_role, sum(amount) s, count(*) n from p group by 1, 2) m), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', id, 'payment_no', payment_no, 'customer_id', customer_id, 'customer', customer, 'city', city,
                    'amount', amount, 'method', method, 'status', status, 'entered_by_name', entered_by_name,
                    'entered_by_role', entered_by_role, 'created_at', created_at) order by created_at)
                    from p), '[]'::jsonb)));
end $$;

-- ---------------------------------------------------------------- recovery sheet
-- Customers of a city and/or an order taker with what each owes, to print and fill in by hand.
create or replace function public.recovery_sheet(p_city text default null, p_user_id uuid default null,
                                                 p_only_owing boolean default true) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  me public.profiles := app.require('admin', 'order_taker');
  v_user uuid := case when me.role = 'order_taker' then me.id else p_user_id end;
  t date := app.today();
begin
  return (
    with base as (
      select c.* from public.customers c
       where c.is_active and (me.role = 'admin' or c.order_taker_id = me.id)
    ), r as (
      select c.id, c.name, c.address, c.phone, initcap(lower(coalesce(nullif(trim(c.city), ''), 'No city'))) as city,
             tk.full_name as order_taker, app.balance(c.id) as balance,
             (select coalesce(sum(x.remaining), 0) from app.order_dues(c.id) x join public.orders o on o.id = x.order_id
               where x.remaining > 0 and o.due_date < t) as overdue,
             (select max(paid_on) from public.payments p where p.customer_id = c.id and p.status <> 'rejected') as last_paid
        from base c left join public.profiles tk on tk.id = c.order_taker_id
       where (coalesce(trim(p_city), '') = '' or lower(trim(c.city)) = lower(trim(p_city)))
         and (v_user is null or c.order_taker_id = v_user)
    )
    select jsonb_build_object(
      'date', t,
      'city', nullif(trim(coalesce(p_city, '')), ''),
      'order_taker', (select full_name from public.profiles where id = v_user),
      'cities', coalesce((select jsonb_agg(jsonb_build_object('city', city, 'customers', n) order by city)
                            from (select initcap(lower(coalesce(nullif(trim(city), ''), 'No city'))) city, count(*) n from base group by 1) g), '[]'::jsonb),
      'order_takers', case when me.role = 'admin' then coalesce((
                        select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.full_name) order by u.full_name)
                          from public.profiles u where u.role = 'order_taker' and u.is_active), '[]'::jsonb) end,
      'total', (select coalesce(sum(balance), 0) from r where not p_only_owing or balance > 0),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', id, 'name', name, 'address', address, 'phone', phone, 'city', city, 'order_taker', order_taker,
                 'balance', balance, 'overdue', overdue, 'last_paid', last_paid) order by city, address nulls last, name)
                 from r where not p_only_owing or balance > 0), '[]'::jsonb)));
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
      'today_recovery',   (select coalesce(sum(amount), 0) from payments where paid_on = t and status <> 'rejected'),
      'today_recovery_pending', (select coalesce(sum(amount), 0) from payments where paid_on = t and status = 'pending'),
      'today_recovery_count', (select count(*) from payments where paid_on = t and status <> 'rejected'),
      'today_expenses',   (select coalesce(sum(amount), 0) from expenses where spent_on = t),
      'today_expenses_office', (select coalesce(sum(amount), 0) from expenses where spent_on = t and kind = 'office'),
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

revoke execute on function public.customer_delete(uuid, text), public.office_expense_add(jsonb), public.recovery_day(date),
  public.recovery_sheet(text, uuid, boolean) from public, anon;
grant execute on function public.customer_delete(uuid, text), public.office_expense_add(jsonb), public.recovery_day(date),
  public.recovery_sheet(text, uuid, boolean) to authenticated;
