-- Scorpion Chemical v2.2 (16 Nov 2026): order taker travel and tour expenses.
-- An order taker enters each expense of the day (fare, fuel, food, stock carriage) with the
-- city of that day's tour. They see only today's entries; the admin sees every tour and
-- the usual cost of a trip to each city.

create table public.expenses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  spent_on    date not null,
  city        text not null,
  category    text not null check (category in ('van', 'bus', 'rickshaw', 'chingchi', 'bike_fuel', 'food', 'stock_carriage', 'other')),
  amount      numeric(12,2) not null check (amount > 0 and amount <= 100000),
  note        text,
  created_at  timestamptz not null default now()
);
create index expenses_user_day_idx on public.expenses(user_id, spent_on);
create index expenses_day_idx on public.expenses(spent_on);
alter table public.expenses enable row level security;
revoke all on public.expenses from anon, authenticated;

create or replace function app.expense_label(c text) returns text language sql immutable as $$
  select case c when 'van' then 'Wagon / van' when 'bus' then 'Bus' when 'rickshaw' then 'Rickshaw'
    when 'chingchi' then 'Chingchi' when 'bike_fuel' then 'Bike petrol' when 'food' then 'Food'
    when 'stock_carriage' then 'Stock carriage' else 'Other' end
$$;
alter function app.expense_label(text) set search_path = pg_catalog;

-- Order taker adds an expense for today.
create or replace function public.expense_add(p jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  me public.profiles := app.require('order_taker');
  v_amount numeric := app.try_num(p->>'amount');
  v_city text := nullif(trim(coalesce(p->>'city', '')), '');
  v_cat text := coalesce(nullif(p->>'category', ''), 'other');
  v_id uuid;
begin
  if v_city is null then raise exception 'Write the city of today''s tour'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'Enter the amount'; end if;
  if v_amount > 100000 then raise exception 'Amount looks too large'; end if;
  if v_cat not in ('van', 'bus', 'rickshaw', 'chingchi', 'bike_fuel', 'food', 'stock_carriage', 'other') then
    raise exception 'Choose what the expense was for';
  end if;
  if v_cat = 'other' and nullif(trim(coalesce(p->>'note', '')), '') is null then
    raise exception 'Write what the expense was for';
  end if;
  insert into public.expenses(user_id, spent_on, city, category, amount, note)
  values (me.id, app.today(), v_city, v_cat, round(v_amount, 2), nullif(trim(coalesce(p->>'note', '')), ''))
  returning id into v_id;
  return v_id;
end $$;

-- An order taker can remove their own entry on the same day; the admin any entry.
create or replace function public.expense_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin', 'order_taker'); e public.expenses;
begin
  select * into e from public.expenses where id = p_id;
  if not found then raise exception 'Expense not found'; end if;
  if me.role = 'order_taker' and (e.user_id <> me.id or e.spent_on <> app.today()) then
    raise exception 'Only today''s own expenses can be removed';
  end if;
  delete from public.expenses where id = p_id;
  if me.role = 'admin' then
    perform app.log(me.id, 'expense_deleted', 'profile', e.user_id,
                    jsonb_build_object('date', e.spent_on, 'city', e.city, 'category', e.category, 'amount', e.amount));
  end if;
end $$;

-- What the order taker sees: today's entries only.
create or replace function public.expenses_today() returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.require('order_taker'); t date := app.today();
begin
  return jsonb_build_object(
    'date', t,
    'city', (select city from public.expenses where user_id = me.id and spent_on = t order by created_at desc limit 1),
    'total', (select coalesce(sum(amount), 0) from public.expenses where user_id = me.id and spent_on = t),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'city', city, 'category', category, 'label', app.expense_label(category),
                                          'amount', amount, 'note', note, 'created_at', created_at) order by created_at)
        from public.expenses where user_id = me.id and spent_on = t), '[]'::jsonb));
end $$;

-- Admin report. A tour is one order taker on one day in one city.
create or replace function public.expenses_report(p_from date, p_to date, p_user_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin');
begin
  return (
    with e as (
      select x.*, u.full_name from public.expenses x join public.profiles u on u.id = x.user_id
       where x.spent_on between p_from and p_to and (p_user_id is null or x.user_id = p_user_id)
    ), tours as (
      select user_id, full_name, spent_on, city, sum(amount) as total, count(*) as n from e group by 1, 2, 3, 4
    )
    select jsonb_build_object(
      'from', p_from, 'to', p_to,
      'total', (select coalesce(sum(amount), 0) from e),
      'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'label', app.expense_label(category), 'amount', s) order by s desc)
                                 from (select category, sum(amount) s from e group by 1) c), '[]'::jsonb),
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

revoke execute on function public.expense_add(jsonb), public.expense_delete(uuid), public.expenses_today(),
  public.expenses_report(date, date, uuid) from public, anon;
grant execute on function public.expense_add(jsonb), public.expense_delete(uuid), public.expenses_today(),
  public.expenses_report(date, date, uuid) to authenticated;
