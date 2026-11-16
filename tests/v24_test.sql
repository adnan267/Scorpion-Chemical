-- v2.4: delete customer, customer cash blocked, office expenses, recovery (run after the other tests)
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
select id as admin  from profiles where phone='03007334811' \gset
select id as taker1 from profiles where phone='03011111111' \gset
select id as ua from profiles where phone='03033333333' \gset
select id as ca from customers where name='Al Shifa Medical Store' \gset
select id as p1 from products where pack_size='30ml' order by created_at limit 1 \gset
select app.today() as today \gset

-- customers cannot submit cash
select t.login(:'ua');
select t.raises(format('select public.payment_submit(null, 100, %L, null, %L)', 'cash', :'ua' || '/c.jpg'), 'order taker', 'customer cannot send cash');

-- office expenses and reports
select t.login(:'taker1');
select public.expense_add('{"category":"bus","city":"Khanewal","amount":300}') is not null;
select t.raises('select public.office_expense_add(''{"category":"rent","amount":1}'')', 'not allowed', 'booker cannot add office expenses');
select t.login(:'admin');
select public.office_expense_add('{"category":"electricity","amount":"12,500"}') is not null;
select t.raises('select public.office_expense_add(''{"category":"salary","amount":20000}'')', 'who or what', 'salary needs a name');
select public.office_expense_add('{"category":"salary","amount":20000,"note":"Rashid, November"}') is not null;
select public.office_expense_add(jsonb_build_object('category', 'rent', 'amount', 30000, 'date', (:'today'::date - 3)::text)) is not null;
select t.raises(format('select public.office_expense_add(%L::jsonb)', jsonb_build_object('category', 'rent', 'amount', 1, 'date', (:'today'::date + 1)::text)), 'future', 'no future dates');
select public.expenses_report(:'today'::date, :'today'::date) as rep \gset
select t.eq((:'rep'::jsonb->>'office_total')::numeric::int, 32500, 'office total today');
select t.eq((:'rep'::jsonb->>'total')::numeric::int, (:'rep'::jsonb->>'office_total')::numeric::int + (:'rep'::jsonb->>'tour_total')::numeric::int, 'total = office + tours');
select t.eq((select count(*)::int from jsonb_array_elements(:'rep'::jsonb->'tours') x where x->>'city' is null), 0, 'office expenses are not tours');
select t.eq((public.dashboard()->>'today_expenses')::numeric::int, (:'rep'::jsonb->>'total')::numeric::int, 'dashboard today expenses = report');
select t.eq((public.dashboard()->>'today_expenses_office')::numeric::int, 32500, 'dashboard office part');

-- recovery of the day
select t.login(:'taker1');
select public.payment_submit(:'ca', 700, 'cash', null, null, null, null, :'today'::date)->>'id' as pc \gset
select t.login(:'admin');
select public.recovery_day() as rd \gset
select t.eq((:'rd'::jsonb->>'total')::numeric::int, (public.dashboard()->>'today_recovery')::numeric::int, 'dashboard recovery = day total');
select t.eq((select (m->>'amount')::numeric::int >= 700 from jsonb_array_elements(:'rd'::jsonb->'by_method') m where m->>'method' = 'cash'), true, 'cash shows in recovery by method');
select t.eq((select count(*)::int from jsonb_array_elements(:'rd'::jsonb->'payments') x where x->>'id' = :'pc'), 1, 'payment listed');

-- recovery sheet
select public.recovery_sheet('multan', null, false) as rs \gset
select t.eq((select bool_and(r->>'city' = 'Multan') from jsonb_array_elements(:'rs'::jsonb->'rows') r), true, 'sheet filtered by city');
select t.eq(jsonb_array_length(public.recovery_sheet(null, :'taker1', false)->'rows') > 0, true, 'sheet by order taker');
select t.eq((select bool_and((r->>'balance')::numeric > 0) from jsonb_array_elements(public.recovery_sheet(null, null, true)->'rows') r), true, 'only customers who owe');
select t.login(:'taker1');
select t.eq((select bool_and(r->>'order_taker' = 'Bilal Taker') from jsonb_array_elements(public.recovery_sheet(null, null, false)->'rows') r), true, 'booker gets only own customers');

-- delete a customer with orders, payments, ledger and a login
select t.login(:'admin');
select t.raises('delete from ledger_entries', 'permission denied', 'no direct ledger delete');
select t.sudo('select count(*) from ledger_entries where false');
select t.raises(format('select t.sudo(%L)', 'delete from ledger_entries where id = (select min(id) from ledger_entries) returning 1'), 'cannot be changed', 'ledger still append-only');
select t.eq(t.sudo(format('select stock_qty from products where id = %L', :'p1'))::int >= 0, true, 'stock before');
select t.sudo(format('select stock_qty from products where id = %L', :'p1')) as stock_before \gset
select public.order_place(:'ca', format('[{"product_id":"%s","qty":3}]', :'p1')::jsonb) is not null;
select t.sudo(format('select p.stock_qty + coalesce((select sum(i.qty + i.bonus_qty) from order_items i join orders o on o.id = i.order_id where o.customer_id = %L and o.status in (''pending'',''confirmed'',''dispatched'') and i.product_id = p.id and o.stock_deducted), 0) from products p where p.id = %L', :'ca', :'p1')) as stock_expected \gset
select t.raises(format('select public.customer_delete(%L, ''wrong name'')', :'ca'), 'exactly', 'name must match');
select t.login(:'taker1');
select t.raises(format('select public.customer_delete(%L, ''Al Shifa Medical Store'')', :'ca'), 'not allowed', 'booker cannot delete');
select t.login(:'admin');
select public.customer_delete(:'ca', '  al shifa medical store ') as del \gset
select t.eq((:'del'::jsonb->>'logins')::int, 1, 'login removed with the customer');
select t.eq(t.sudo(format('select count(*) from customers where id = %L', :'ca'))::int, 0, 'customer gone');
select t.eq(t.sudo(format('select (select count(*) from orders where customer_id = %L) + (select count(*) from payments where customer_id = %L) + (select count(*) from ledger_entries where customer_id = %L)', :'ca', :'ca', :'ca'))::int, 0, 'orders, payments and ledger gone');
select t.eq(t.sudo(format('select count(*) from profiles where id = %L', :'ua'))::int + t.sudo(format('select count(*) from auth.users where id = %L', :'ua'))::int, 0, 'login and auth user gone');
select t.eq(t.sudo(format('select stock_qty from products where id = %L', :'p1')), :'stock_expected', 'stock of undelivered orders went back');
select t.eq(t.sudo('select count(*) from activity_log where action = ''customer_deleted''')::int, 1, 'deletion is logged');
select 'V24 TESTS PASSED';
