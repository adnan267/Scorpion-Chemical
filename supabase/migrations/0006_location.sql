-- Live location of order takers while on duty.
-- An order taker starts duty in the app; while on duty the phone sends its location every
-- couple of minutes. Nothing is recorded outside duty. Only admins can see locations.

create table public.duty_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  end_reason  text
);
create index duty_sessions_user_idx on public.duty_sessions(user_id, started_at desc);
create unique index duty_one_open_per_user on public.duty_sessions(user_id) where ended_at is null;

create table public.location_points (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  session_id   uuid references public.duty_sessions(id) on delete set null,
  lat          double precision not null check (lat between -90 and 90),
  lng          double precision not null check (lng between -180 and 180),
  accuracy     real,
  speed        real,
  battery      smallint,
  recorded_at  timestamptz not null,
  received_at  timestamptz not null default now()
);
create index location_points_user_time_idx on public.location_points(user_id, recorded_at desc);
create index location_points_session_idx on public.location_points(session_id);

alter table public.duty_sessions   enable row level security;
alter table public.location_points enable row level security;
revoke all on public.duty_sessions, public.location_points from anon, authenticated;

-- ---------------------------------------------------------------- order taker side
create function public.duty_status() returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.require('order_taker'); s public.duty_sessions;
begin
  select * into s from public.duty_sessions where user_id = me.id and ended_at is null;
  return jsonb_build_object(
    'on_duty', s.id is not null,
    'session_id', s.id,
    'started_at', s.started_at,
    'last_point_at', (select max(recorded_at) from public.location_points
                       where user_id = me.id and s.id is not null and session_id = s.id));
end $$;

create function public.duty_start() returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('order_taker'); s public.duty_sessions;
begin
  select * into s from public.duty_sessions where user_id = me.id and ended_at is null;
  if s.id is null then
    insert into public.duty_sessions(user_id) values (me.id) returning * into s;
    perform app.log(me.id, 'duty_started', 'user', me.id, null);
  end if;
  return jsonb_build_object('session_id', s.id, 'started_at', s.started_at);
end $$;

create function public.duty_end(p_reason text default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('order_taker');
begin
  update public.duty_sessions
     set ended_at = now(), end_reason = nullif(trim(coalesce(p_reason, '')), '')
   where user_id = me.id and ended_at is null;
  if found then perform app.log(me.id, 'duty_ended', 'user', me.id, null); end if;
end $$;

-- p_points: [{lat, lng, accuracy, speed, battery, t (ISO time or epoch ms)}]
-- Points are accepted only while a duty session is open; others are ignored, not an error,
-- so a late upload after "Duty end" never breaks the app.
create function public.location_push(p_points jsonb) returns integer
language plpgsql security definer set search_path = public, app as $$
declare me public.profiles := app.require('order_taker'); s public.duty_sessions; n int;
begin
  if p_points is null or jsonb_typeof(p_points) <> 'array' then return 0; end if;
  select * into s from public.duty_sessions where user_id = me.id and ended_at is null;
  if s.id is null then return 0; end if;

  with pts as (
    select (e->>'lat')::double precision as lat,
           (e->>'lng')::double precision as lng,
           nullif(e->>'accuracy', '')::real as accuracy,
           nullif(e->>'speed', '')::real as speed,
           nullif(e->>'battery', '')::smallint as battery,
           case when (e->>'t') ~ '^[0-9]+(\.[0-9]+)?$' then to_timestamp((e->>'t')::double precision / 1000)
                else (e->>'t')::timestamptz end as t
      from (select e from jsonb_array_elements(p_points) e limit 500) x
  ), ins as (
    insert into public.location_points(user_id, session_id, lat, lng, accuracy, speed, battery, recorded_at)
    select me.id, s.id, lat, lng, accuracy, speed, battery, least(t, now())
      from pts
     where lat between -90 and 90 and lng between -180 and 180
       and t is not null and t >= s.started_at - interval '2 minutes'
    returning 1)
  select count(*) into n from ins;
  return n;
end $$;

-- ---------------------------------------------------------------- admin side
-- Every active order taker with their last known position.
create function public.team_locations() returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare me public.profiles := app.require('admin'); t date := app.today();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', u.id, 'name', u.full_name, 'phone', u.phone,
             'on_duty', s.id is not null, 'duty_started_at', s.started_at,
             'lat', lp.lat, 'lng', lp.lng, 'accuracy', lp.accuracy, 'battery', lp.battery,
             'last_seen_at', lp.recorded_at,
             'orders_today', (select count(*) from public.orders o
                               where o.created_by = u.id and o.status <> 'cancelled'
                                 and o.created_at >= (t::timestamp at time zone 'Asia/Karachi')))
           order by (s.id is null), u.full_name)
    from public.profiles u
    left join public.duty_sessions s on s.user_id = u.id and s.ended_at is null
    left join lateral (select * from public.location_points p where p.user_id = u.id
                        order by p.recorded_at desc limit 1) lp on true
    where u.role = 'order_taker' and u.is_active), '[]'::jsonb);
end $$;

-- One order taker's path for one day (Pakistan time), plus duty start/end times.
create function public.taker_route(p_user_id uuid, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app as $$
declare
  me public.profiles := app.require('admin');
  d date := coalesce(p_date, app.today());
  d0 timestamptz := (d::timestamp at time zone 'Asia/Karachi');
  d1 timestamptz := ((d + 1)::timestamp at time zone 'Asia/Karachi');
begin
  return jsonb_build_object(
    'user', (select jsonb_build_object('id', id, 'name', full_name, 'phone', phone)
               from public.profiles where id = p_user_id and role = 'order_taker'),
    'date', d,
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('started_at', started_at, 'ended_at', ended_at) order by started_at)
        from public.duty_sessions
       where user_id = p_user_id and started_at < d1 and coalesce(ended_at, now()) >= d0), '[]'::jsonb),
    'points', coalesce((
      select jsonb_agg(jsonb_build_array(round(lat::numeric, 6), round(lng::numeric, 6),
                                         extract(epoch from recorded_at)::bigint, accuracy)
                       order by recorded_at)
        from (select * from public.location_points
               where user_id = p_user_id and recorded_at >= d0 and recorded_at < d1
               order by recorded_at limit 5000) p), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'order_no', o.order_no, 'customer', c.name,
                                          'total', o.total, 'at', o.created_at) order by o.created_at)
        from public.orders o join public.customers c on c.id = o.customer_id
       where o.created_by = p_user_id and o.created_at >= d0 and o.created_at < d1), '[]'::jsonb));
end $$;

-- Keep 90 days of location history.
create function app.prune_locations() returns void
language sql security definer set search_path = public, app as $$
  delete from public.location_points where recorded_at < now() - interval '90 days'
$$;

-- If a phone stops sending for 12 hours (switched off, app removed), close its duty.
create function app.close_stale_duty() returns void
language sql security definer set search_path = public, app as $$
  update public.duty_sessions s
     set ended_at = coalesce((select max(recorded_at) from public.location_points p where p.session_id = s.id), s.started_at),
         end_reason = 'No location for 12 hours'
   where s.ended_at is null
     and coalesce((select max(recorded_at) from public.location_points p where p.session_id = s.id), s.started_at)
         < now() - interval '12 hours'
$$;

grant execute on function public.duty_status(), public.duty_start(), public.duty_end(text),
  public.location_push(jsonb), public.team_locations(), public.taker_route(uuid, date) to authenticated;
