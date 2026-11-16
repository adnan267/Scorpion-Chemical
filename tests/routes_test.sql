-- Route plans, booker-added customers, shop location, visits (run after the other tests on the same database)
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
select id as admin  from profiles where phone='03007334811' \gset
select id as taker1 from profiles where phone='03011111111' \gset
select id as taker2 from profiles where phone='03022222222' \gset
select id as ca from customers where name='Al Shifa Medical Store' \gset
select id as p1 from products where pack_size='30ml' \gset
select app.today() as today \gset

-- order taker adds a customer: theirs, no discount, admin told
select t.login(:'taker1');
select public.customer_save('{"type":"Consumer","name":"Madni Medical","city":"Multan","default_discount_pct":20,"opening_balance":9000,"credit_days":60,"lat":30.2,"lng":71.45}') as cm \gset
select t.eq(t.sudo(format('select order_taker_id::text from customers where id = %L', :'cm')), :'taker1', 'booker''s new customer is assigned to the booker');
select t.eq(t.sudo(format('select default_discount_pct::int || ''/'' || coalesce(credit_days::text, ''-'') || ''/'' || app.balance(id)::int from customers where id = %L', :'cm')), '0/-/0', 'booker cannot set discount, credit days or opening balance');
select t.eq(t.sudo(format('select count(*) from notifications where kind = ''customer'' and ref_id = %L', :'cm'))::int > 0, true, 'admin is told about the new customer');
select t.eq((public.customer_get(:'cm')->>'lat')::numeric, 30.2, 'shop location saved with the customer');
select t.raises('select public.customer_save(''{"type":"store","name":"madni medical","city":"Multan"}'')', 'already in the app', 'duplicate name in the same city refused');
select public.customer_save(jsonb_build_object('id', :'cm', 'type', 'store', 'name', 'Madni Medical Store', 'city', 'Multan', 'phone', '0300-1112223', 'default_discount_pct', 50));
select t.eq(t.sudo(format('select name || ''/'' || default_discount_pct::int from customers where id = %L', :'cm')), 'Madni Medical Store/0', 'booker edits details but not the discount');
select t.login(:'taker2');
select t.raises(format('select public.customer_save(%L::jsonb)', jsonb_build_object('id', :'cm', 'type', 'store', 'name', 'Hijack')), 'do not have access', 'another booker cannot edit it');
select t.raises(format('select public.customer_set_location(%L, 30.1, 71.4)', :'cm'), 'do not have access', 'another booker cannot set its location');
select t.login(:'taker1');
select public.customer_set_location(:'ca', 30.1575, 71.4440);
select t.eq((public.customer_get(:'ca')->>'lng')::numeric, 71.444, 'booker saves shop location of own customer');

-- admin makes a 30-day plan starting today with Sunday off
select t.login(:'taker1');
select t.raises(format('select public.route_plan_save(%L, current_date)', :'taker1'), 'not allowed', 'booker cannot change the plan');
select t.eq(public.route_plan_get()->'plan', 'null'::jsonb, 'no plan yet');
select t.login(:'admin');
select public.route_plan_save(:'taker1', :'today'::date, 30, null);
select t.eq(t.sudo(format('select app.route_day_no(%L, %L)', :'taker1', :'today'::date))::int, 1, 'today is day 1');
select t.eq(t.sudo(format('select app.route_day_no(%L, %L)', :'taker1', :'today'::date + 29))::int, 30, 'day 30');
select t.eq(t.sudo(format('select app.route_day_no(%L, %L)', :'taker1', :'today'::date + 30))::int, 1, 'after 30 days back to day 1');
select t.eq(t.sudo(format('select app.route_day_no(%L, %L)', :'taker1', :'today'::date - 1))::int, null::int, 'nothing before the start');
select public.route_plan_save(:'taker1', date '2026-11-02', 30, 0);  -- a Monday, Sundays off
select t.eq(t.sudo(format('select app.route_day_no(%L, %L)', :'taker1', date '2026-11-07'))::int, 6, 'Saturday is day 6');
select t.eq(t.sudo(format('select app.route_day_no(%L, %L)', :'taker1', date '2026-11-08'))::int, null::int, 'Sunday is off');
select t.eq(t.sudo(format('select app.route_day_no(%L, %L)', :'taker1', date '2026-11-09'))::int, 7, 'Monday continues with day 7');
select t.eq(t.sudo(format('select app.route_day_no(%L, %L)', :'taker1', date '2026-11-02' + 35))::int, 1, '30 working days later back to day 1');
select public.route_plan_save(:'taker1', :'today'::date, 30, null);

select t.raises(format('select public.route_day_save(%L, 1, ''x'', jsonb_build_array(%L))', :'taker2', :'ca'), 'belong to another order taker', 'cannot put another booker''s customer on a route');
select public.customer_save('{"type":"store","name":"Free Pharmacy","city":"Multan"}') as cf \gset
select public.route_day_save(:'taker1', 1, 'Nishtar Road', jsonb_build_array(:'ca', :'cm', :'cf'));
select t.eq(t.sudo(format('select order_taker_id::text from customers where id = %L', :'cf')), :'taker1', 'unassigned customer on a route goes to that booker');
select public.route_day_save(:'taker1', 2, 'Bosan Road', jsonb_build_array(:'cm'));
select t.eq(jsonb_array_length(public.route_plan_get(:'taker1')->'days'), 30, 'plan has 30 days');
select t.eq(public.route_plan_get(:'taker1')->'days'->0->>'label', 'Nishtar Road', 'day label');
select t.eq(jsonb_array_length(public.route_plan_get(:'taker1')->'days'->0->'customers'), 3, 'day 1 customers');
select public.route_day_save(:'taker1', 1, 'Nishtar Road', jsonb_build_array(:'cm', :'ca'));
select t.eq(public.route_plan_get(:'taker1')->'days'->0->'customers'->0->>'id', :'cm', 'day order kept and list replaced');

-- visits: a location point at Al Shifa, an order for Madni
select t.login(:'taker1');
select t.eq((public.route_visits()->>'day_no')::int, 1, 'booker sees today''s route');
select t.eq((public.route_visits()->'stops'->1->>'visited')::boolean, false, 'not visited yet');
select public.duty_start();
select public.location_push(jsonb_build_array(jsonb_build_object('lat', 30.15790, 'lng', 71.44420, 'accuracy', 15, 't', now())));
select public.order_place(:'cm', format('[{"product_id":"%s","qty":1}]', :'p1')::jsonb) is not null;
select t.eq((public.route_visits()->'stops'->1->>'visited')::boolean, true, 'visit found from live location (within ~60 m)');
select t.eq((public.route_visits()->'stops'->0->>'visited')::boolean, false, 'an order alone does not count as a visit');
select t.eq((public.route_visits()->'stops'->0->>'ordered')::boolean, true, 'order on the route is shown');
select t.eq((public.route_visits()->>'ordered')::int, 2, 'ordered count (Al Shifa also ordered earlier today)');
select t.raises(format('select public.route_visits(%L)', :'taker2'), 'own route', 'booker cannot see another booker''s route');
select public.duty_end(null);

-- evening reminder for tomorrow
select t.eq(t.sudo('select app.route_reminders()')::int >= 1, true, 'reminders sent');
select t.eq(t.sudo(format('select title from notifications where user_id = %L and kind = ''route''', :'taker1')), 'Tomorrow''s route: Day 2, Bosan Road', 'tomorrow''s route notification');
select t.sudo('select app.route_reminders()');
select t.eq(t.sudo(format('select count(*) from notifications where user_id = %L and kind = ''route''', :'taker1'))::int, 1, 'reminder sent once per day');
select 'ROUTE TESTS PASSED';
