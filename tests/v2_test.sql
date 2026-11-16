-- v2 features (run after flow_test, location_test, types_test on the same database)
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
select id as admin  from profiles where phone='03007334811' \gset
select id as taker1 from profiles where phone='03011111111' \gset
select id as taker2 from profiles where phone='03022222222' \gset
select id as ua     from profiles where phone='03033333333' \gset
select id as ca from customers where name='Al Shifa Medical Store' \gset
select id as cb from customers where name='City Pharmacy' \gset
select id as p1 from products where pack_size='30ml' \gset
select id as p2 from products where pack_size='60ml' \gset
select app.today() as today \gset

-- stock keeper login
insert into auth.users(email) values ('keeper') returning id as sk \gset
select public.service_create_profile(:'sk', 'stock_keeper', 'Kamran Store', '03099999990');
select t.eq((select role from profiles where id = :'sk'), 'stock_keeper', 'stock keeper login created');

-- credit days, licence, dawakhana
select t.login(:'admin');
select public.customer_save(jsonb_build_object('id', :'ca', 'type', 'store', 'name', 'Al Shifa Medical Store', 'order_taker_id', :'taker1',
  'default_discount_pct', 5, 'credit_days', 10, 'licence_no', 'DSL-1234', 'licence_issued', '2024-01-01', 'licence_expiry', (current_date - 1)::text));
select t.eq((public.customer_get(:'ca')->>'credit_days')::int, 10, 'credit days saved');
select t.eq((public.customer_get(:'ca')->>'licence_expired')::boolean, true, 'expired licence flagged');
select t.eq((public.dashboard()->>'licence_expired')::int, 1, 'dashboard counts expired licences');
select t.raises(format('select public.customer_save(%L::jsonb)', jsonb_build_object('type', 'store', 'name', 'Bad Lic', 'licence_issued', '2025-01-01', 'licence_expiry', '2024-01-01')), 'before the issue date', 'expiry before issue rejected');
select public.customer_save('{"type":"Dawakhana","name":"Hakeem Dawakhana"}') as cdw \gset
select t.eq(t.sudo(format('select type from customers where id = %L', :'cdw')), 'dawakhana', 'dawakhana type (label accepted)');

-- order taker books, stock keeper sees the sheet and delivers; due date from credit days
select t.login(:'taker1');
select public.order_place(:'ca', format('[{"product_id":"%s","qty":20},{"product_id":"%s","qty":8}]', :'p1', :'p2')::jsonb)->>'id' as o1 \gset
select t.eq(t.sudo(format('select status from orders where id = %L', :'o1')), 'confirmed', 'booked order is confirmed');
select t.login(:'sk');
select t.eq((public.stock_sheet()->>'orders_count')::int >= 1, true, 'stock keeper sees today''s orders');
select t.eq((select (j->>'qty')::int from jsonb_array_elements(public.stock_sheet()->'totals') j where j->>'product_id' = :'p1') >= 20, true, 'loading sheet totals per product');
select t.eq((select count(*)::int from jsonb_array_elements(public.stock_sheet()->'bookers') b where b->>'name' = 'Bilal Taker'), 1, 'loading sheet per booker');
select t.eq((public.order_get(:'o1')->'customer'->>'balance'), null, 'stock keeper does not see balances');
select t.eq((public.order_get(:'o1')->>'can_deliver')::boolean, true, 'stock keeper can deliver');
select t.raises('select public.customers_list()', 'not allowed', 'stock keeper cannot list customers');
select t.raises(format('select public.ledger_get(%L)', :'ca'), 'access', 'stock keeper cannot see ledgers');
select t.raises(format('select public.payment_submit(%L, 100, %L)', :'ca', 'cash'), 'access', 'stock keeper cannot enter payments');
select t.raises(format('select public.order_place(%L, %L::jsonb)', :'ca', format('[{"product_id":"%s","qty":1}]', :'p1')), 'not allowed', 'stock keeper cannot book orders');
select public.order_deliver(:'o1');
select t.eq(t.sudo(format('select due_date from orders where id = %L', :'o1'))::date, (:'today'::date) + 10, 'due date = delivery + credit days');

-- returns: closed before due date, open when the setting allows
select t.login(:'ua');
select (public.order_get(:'o1')->'items'->0->>'id') as item1, (public.order_get(:'o1')->'items'->0->>'product_name') as item1name \gset
select t.raises(format('select public.order_return(%L, %L::jsonb)', :'o1', jsonb_build_array(jsonb_build_object('order_item_id', :'item1', 'qty', 2))), 'Returns open on the due date', 'return blocked before due date');
select t.eq((public.order_get(:'o1')->>'can_return')::boolean, false, 'can_return is false before due date');
select t.login(:'taker1');
select t.raises(format('select public.invoice_settings_save(%L::jsonb)', '{"returns_before_due":true}'), 'not allowed', 'only admin changes the return setting');
select t.login(:'admin');
select public.invoice_settings_save('{"returns_before_due":true}');
select t.login(:'ua');
select (public.dashboard()->>'balance')::numeric as bal_before \gset
-- 30ml: 20 x 54 (10% product discount); return 5 -> Rs. 270
select (select j->>'id' from jsonb_array_elements(public.order_get(:'o1')->'items') j where j->>'product_id' = :'p1') as it30 \gset
select t.eq((public.order_return(:'o1', jsonb_build_array(jsonb_build_object('order_item_id', :'it30', 'qty', 5)), 'not sold')->>'total')::numeric, 270.00, 'customer returns 5 bottles = Rs. 270');
select t.eq((public.dashboard()->>'balance')::numeric, :'bal_before'::numeric - 270, 'balance reduced by the return');
select t.eq(t.sudo(format('select stock_qty from products where id = %L', :'p1'))::int, 75, 'returned goods back in stock (90 - 20 + 5)');
select t.raises(format('select public.order_return(%L, %L::jsonb)', :'o1', jsonb_build_array(jsonb_build_object('order_item_id', :'it30', 'qty', 16))), 'cannot return more', 'cannot return more than delivered');
select t.login(:'taker1');
select t.eq((public.order_return(:'o1', jsonb_build_array(jsonb_build_object('order_item_id', :'it30', 'qty', 15)))->>'total')::numeric, 810.00, 'order taker returns the rest (15 x 54)');
select t.eq((public.order_get(:'o1')->>'returned')::numeric, 1080.00, 'order shows total returned');
select t.eq((select (j->>'returned_qty')::int from jsonb_array_elements(public.order_get(:'o1')->'items') j where j->>'id' = :'it30'), 20, 'item returned qty');
select t.eq(jsonb_array_length(public.order_get(:'o1')->'returns'), 2, 'two returns listed');
select t.login(:'taker2');
select t.raises(format('select public.order_return(%L, %L::jsonb)', :'o1', jsonb_build_array(jsonb_build_object('order_item_id', :'it30', 'qty', 1))), 'access', 'other order taker cannot return');
select t.login(:'admin');
-- the order is now worth only the 60ml line: 8 x 71.25 = 570
select t.eq((public.order_get(:'o1')->>'remaining')::numeric + (public.order_get(:'o1')->>'paid')::numeric, 570.00, 'order value after returns');
reset role;
select t.eq((select sum(debit - credit) from ledger_entries where customer_id = :'ca'), (select app.balance(:'ca')), 'ledger still adds up');
select t.login(:'admin');
select public.invoice_settings_save('{"returns_before_due":false}');

-- reports
select t.eq((public.orders_summary((:'today'::date), (:'today'::date))->>'orders')::int >= 1, true, 'summary counts today''s orders');
select t.eq((select (b->>'orders')::int from jsonb_array_elements(public.orders_summary((:'today'::date), (:'today'::date))->'by_user') b where b->>'user_id' = :'taker1') >= 1, true, 'summary by booker');
select t.eq(jsonb_array_length(public.orders_list(null, null, null, 50, 0, (:'today'::date), (:'today'::date), :'taker1')) >= 1, true, 'orders list filtered by booker and date');
select t.eq(jsonb_array_length(public.orders_list('returned')) >= 1, true, 'returned filter');
select t.eq((public.dashboard() ? 'week_sales') and (public.dashboard() ? 'month_orders'), true, 'dashboard has week and month');
select t.login(:'taker1');
select t.raises(format('select public.orders_summary(%L, %L)', (:'today'::date), (:'today'::date)), 'not allowed', 'order taker cannot see the summary');

-- invoice settings and signature
select t.login(:'admin');
select t.raises(format('select public.invoice_settings_save(%L::jsonb)', '{"signature":"hello"}'), 'must be a photo', 'signature must be an image');
select public.invoice_settings_save('{"signature":"data:image/png;base64,iVBORw0KGgo="}');
select t.login(:'ua');
select t.eq((public.invoice_settings()->'invoice'->>'signature') like 'data:image/png%', true, 'everyone can read the invoice signature');
select t.eq((public.invoice_settings()->'invoice'->>'warranty') like 'I JULIUS YOUNAS%', true, 'warranty text');

-- opening data
select t.login(:'admin');
select public.customer_set_opening(:'cb', 3000);
select t.eq((public.customer_get(:'cb')->>'opening_balance')::numeric, 3000.00, 'opening balance set');
select public.customer_set_opening(:'cb', 2500);
select t.eq((public.customer_get(:'cb')->>'opening_balance')::numeric, 2500.00, 'opening balance changed (difference added)');
select public.opening_bill_add(jsonb_build_object('customer_id', :'cb', 'bill_no', '7781', 'date', ((:'today'::date) - 40)::text, 'amount', 5000, 'paid', 1500, 'due_date', ((:'today'::date) - 10)::text)) as ob1 \gset
select t.eq((public.order_get(:'ob1')->>'remaining')::numeric, 3500.00, 'old bill remaining = amount - paid before');
select t.eq((public.order_get(:'ob1')->>'paid')::numeric, 1500.00, 'old bill shows paid before');
select t.eq((public.order_get(:'ob1')->>'is_opening')::boolean, true, 'old bill marked');
select t.raises(format('select public.opening_bill_add(%L::jsonb)', jsonb_build_object('customer_id', :'cb', 'bill_no', '7781', 'date', (:'today'::date)::text, 'amount', 10)), 'already exists', 'duplicate bill number rejected');
select t.eq((select count(*)::int from jsonb_array_elements(public.orders_list('overdue', :'cb')) j where j->>'order_no' = '7781'), 1, 'old bill shows as overdue');
select t.eq((public.order_get(:'ob1')->>'can_return')::boolean, false, 'old bills cannot be returned');
select t.eq(public.stock_set_bulk(jsonb_build_array(jsonb_build_object('product_id', :'p2', 'qty', 300))), 1, 'bulk stock set');
select t.eq(t.sudo(format('select stock_qty from products where id = %L', :'p2'))::int, 300, 'stock is now 300');

-- Excel import: dry run with mistakes, then a clean import
select public.import_opening(jsonb_build_object(
  'customers', jsonb_build_array(
     jsonb_build_object('row', 2, 'name', 'Noor Medical', 'type', 'Consumer', 'order_taker', 'Bilal Taker', 'discount', '5', 'credit_days', '15', 'opening_balance', '1200'),
     jsonb_build_object('row', 3, 'name', 'Al Shifa Medical Store', 'type', 'Pharmacy'),
     jsonb_build_object('row', 4, 'name', 'Zam Zam', 'type', 'Hospital', 'order_taker', 'Nobody')),
  'bills', jsonb_build_array(
     jsonb_build_object('row', 2, 'customer', 'Noor Medical', 'bill_no', 'A-1', 'date', ((:'today'::date) - 5)::text, 'amount', '2000', 'paid', '500', 'due_date', ((:'today'::date) + 5)::text),
     jsonb_build_object('row', 3, 'customer', 'Unknown Shop', 'date', 'yesterday', 'amount', '0')),
  'stock', jsonb_build_array(
     jsonb_build_object('row', 2, 'product', 'Methylated Spirit', 'pack_size', '30ml', 'qty', '150'),
     jsonb_build_object('row', 3, 'product', 'Nothing', 'pack_size', '', 'qty', '1.5'))), false) as dry \gset
select t.eq(jsonb_array_length(:'dry'::jsonb->'errors') >= 7, true, 'dry run lists the mistakes');
select t.eq((:'dry'::jsonb->>'committed')::boolean, false, 'nothing saved on dry run');
select t.eq(t.sudo('select count(*) from customers where name = ''Noor Medical'''), '0', 'Noor not saved yet');
select public.import_opening(jsonb_build_object(
  'customers', jsonb_build_array(
     jsonb_build_object('row', 2, 'name', 'Noor Medical', 'type', 'Consumer', 'order_taker', '0301-1111111', 'discount', '5', 'credit_days', '15', 'opening_balance', '1200', 'licence_no', 'L-9', 'licence_expiry', '2027-06-30')),
  'bills', jsonb_build_array(
     jsonb_build_object('row', 2, 'customer', 'noor medical', 'bill_no', 'A-1', 'date', ((:'today'::date) - 5)::text, 'amount', '2000', 'paid', '500', 'due_date', ((:'today'::date) + 5)::text)),
  'stock', jsonb_build_array(
     jsonb_build_object('row', 2, 'product', 'methylated spirit', 'pack_size', '30ML', 'qty', '150'),
     jsonb_build_object('row', 3, 'product', 'Methylated Spirit', 'pack_size', '60ml', 'qty', ''))), true) as res \gset
select t.eq((:'res'::jsonb->>'committed')::boolean, true, 'clean import saved');
reset role;
select id as cn from customers where name = 'Noor Medical' \gset
select t.login(:'admin');
select t.eq((public.customer_get(:'cn')->>'balance')::numeric, 2700.00, 'imported balance = opening 1200 + bill 2000 - paid 500');
select t.eq((public.customer_get(:'cn')->>'order_taker_id'), :'taker1'::text, 'order taker matched by phone');
select t.eq(t.sudo(format('select stock_qty from products where id = %L', :'p1'))::int, 150, 'imported stock set');
select t.eq(t.sudo(format('select stock_qty from products where id = %L', :'p2'))::int, 300, 'blank stock left unchanged');

-- deliver permissions
select t.login(:'taker2');
select public.order_place(:'cb', format('[{"product_id":"%s","qty":2}]', :'p2')::jsonb)->>'id' as o2 \gset
select t.login(:'taker1');
select t.raises(format('select public.order_deliver(%L)', :'o2'), 'access', 'another order taker cannot deliver it');
select t.login(:'taker2');
select t.eq(public.order_deliver(:'o2', (:'today'::date) + 7)->>'due_date', ((:'today'::date) + 7)::text, 'order taker delivers with a typed due date');
select 'V2 TESTS PASSED';
