-- Live location tests (run after flow_test.sql on the same database)
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
select id as admin  from profiles where phone='03007334811' \gset
select id as taker1 from profiles where phone='03011111111' \gset
select id as taker2 from profiles where phone='03022222222' \gset
select id as ua     from profiles where phone='03033333333' \gset

select t.login(:'taker1');
select t.eq((public.duty_status()->>'on_duty')::boolean, false, 'not on duty at first');
select t.eq(public.location_push('[{"lat":30.2,"lng":71.5,"t":"2026-01-01T00:00:00Z"}]'), 0, 'points ignored when off duty');
select public.duty_start()->>'session_id' as s1 \gset
select t.eq(public.duty_start()->>'session_id', :'s1', 'second start reuses the open session');
select t.eq(public.location_push(jsonb_build_array(
  jsonb_build_object('lat', 30.1960, 'lng', 71.4750, 'accuracy', 12, 'battery', 81, 't', (extract(epoch from now() - interval '20 seconds') * 1000)::bigint),
  jsonb_build_object('lat', 30.1990, 'lng', 71.4800, 'accuracy', 9, 't', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  jsonb_build_object('lat', 95, 'lng', 71, 't', (extract(epoch from now()) * 1000)::bigint),
  jsonb_build_object('lat', 30.1, 'lng', 71.1, 't', '2020-01-01T00:00:00Z'))), 2, 'valid points saved, bad and pre-duty points dropped');
select t.eq((public.duty_status()->>'on_duty')::boolean, true, 'on duty');
select t.raises('select public.team_locations()', 'not allowed', 'order taker cannot see the team map');
select t.raises(format('select public.taker_route(%L)', :'taker2'), 'not allowed', 'order taker cannot see routes');

select t.login(:'ua');
select t.raises('select public.duty_start()', 'not allowed', 'store cannot start duty');
select t.raises('select public.team_locations()', 'not allowed', 'store cannot see the team map');
select t.raises('select * from public.location_points', 'permission denied', 'no direct access to location table');

select t.login(:'admin');
select t.eq((select (j->>'on_duty')::boolean from jsonb_array_elements(public.team_locations()) j where j->>'user_id' = :'taker1'), true, 'admin sees taker on duty');
select t.eq((select (j->>'lat')::numeric from jsonb_array_elements(public.team_locations()) j where j->>'user_id' = :'taker1'), 30.199, 'admin sees latest position');
select t.eq((select j->>'lat' from jsonb_array_elements(public.team_locations()) j where j->>'user_id' = :'taker2'), null, 'taker who never started has no position');
select t.eq(jsonb_array_length(public.taker_route(:'taker1')->'points'), 2, 'route has 2 points today');
select t.eq(jsonb_array_length(public.taker_route(:'taker1')->'sessions'), 1, 'route shows the duty session');
select t.raises('select public.duty_start()', 'not allowed', 'admin cannot start duty');

select t.login(:'taker1');
select public.duty_end();
select t.eq((public.duty_status()->>'on_duty')::boolean, false, 'duty ended');
select t.eq(public.location_push('[{"lat":30.2,"lng":71.5,"t":0}]'), 0, 'late points after duty end are ignored');
select t.login(:'admin');
select t.eq((select (j->>'on_duty')::boolean from jsonb_array_elements(public.team_locations()) j where j->>'user_id' = :'taker1'), false, 'admin sees duty ended, last position kept');

reset role;
-- stale duty is closed
insert into duty_sessions(user_id, started_at) values (:'taker2', now() - interval '13 hours');
select app.close_stale_duty();
select t.eq((select end_reason from duty_sessions where user_id = :'taker2'), 'No location for 12 hours', 'stale duty closed');
select 'LOCATION TESTS PASSED';
