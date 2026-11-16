-- Order taker expenses (run after the other tests on the same database)
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
select id as admin  from profiles where phone='03007334811' \gset
select id as taker1 from profiles where phone='03011111111' \gset
select id as taker2 from profiles where phone='03022222222' \gset
select app.today() as today \gset

select t.login(:'taker1');
select t.raises('select public.expense_add(''{"category":"bus","amount":200}'')', 'city', 'city is required');
select t.raises('select public.expense_add(''{"category":"bus","city":"Khanewal","amount":0}'')', 'amount', 'amount is required');
select t.raises('select public.expense_add(''{"category":"other","city":"Khanewal","amount":50}'')', 'what the expense was for', 'other needs a note');
select public.expense_add('{"category":"van","city":"Khanewal","amount":"250"}') as e1 \gset
select public.expense_add('{"category":"chingchi","city":"Khanewal","amount":40}') is not null;
select public.expense_add('{"category":"stock_carriage","city":"Khanewal","amount":300,"note":"2 cartons on the wagon"}') is not null;
select t.eq((public.expenses_today()->>'total')::numeric::int, 590, 'today total for the booker');
select t.eq(public.expenses_today()->>'city', 'Khanewal', 'today''s city remembered');
-- an old entry (yesterday) is not shown to the booker
select t.sudo(format('insert into expenses(user_id, spent_on, city, category, amount) values (%L, %L::date - 1, ''Vehari'', ''bus'', 400) returning 1', :'taker1', :'today'));
select t.eq(jsonb_array_length(public.expenses_today()->'items'), 3, 'booker sees only today''s entries');
select t.raises(format('select public.expenses_report(%L::date - 30, %L::date)', :'today', :'today'), 'not allowed', 'booker cannot see the report');
select t.sudo(format('select id from expenses where spent_on < %L limit 1', :'today')) as old \gset
select t.raises(format('select public.expense_delete(%L)', :'old'), 'today', 'booker cannot remove an old entry');
select t.login(:'taker2');
select t.raises(format('select public.expense_delete(%L)', :'e1'), 'today', 'another booker cannot remove it');
select public.expense_add('{"category":"bike_fuel","city":"khanewal","amount":500}') is not null;
select t.login(:'taker1');
select public.expense_delete(:'e1');
select t.eq((public.expenses_today()->>'total')::numeric::int, 340, 'booker removes own entry today');

select t.login(:'admin');
select public.expenses_report(:'today'::date - 30, :'today'::date) as rep \gset
select t.eq((:'rep'::jsonb->>'total')::numeric::int, 1240, 'admin total incl. old entries');
select t.eq(jsonb_array_length(:'rep'::jsonb->'tours'), 3, 'three tours (two today, one yesterday)');
select t.eq((select (c->>'tours')::int from jsonb_array_elements(:'rep'::jsonb->'by_city') c where c->>'city' = 'Khanewal'), 2, 'Khanewal tours grouped ignoring case');
select t.eq((select (c->>'average')::numeric::int from jsonb_array_elements(:'rep'::jsonb->'by_city') c where c->>'city' = 'Khanewal'), 420, 'average cost of a Khanewal trip');
select t.eq((select count(*)::int from jsonb_array_elements(:'rep'::jsonb->'tours') x where x->>'name' like 'Bilal%' and (x->>'orders')::int >= 0), 2, 'tours carry orders taken that day');
select t.eq(jsonb_array_length(public.expenses_report(:'today'::date - 30, :'today'::date, :'taker2')->'tours'), 1, 'filter by order taker');
select 'EXPENSE TESTS PASSED';
