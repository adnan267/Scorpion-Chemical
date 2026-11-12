-- End-to-end test of the server logic on a local throw-away database.
-- Run: tests/reset_db.sh && psql ... -f tests/flow_test.sql
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned

create schema t;
create function t.eq(actual anyelement, expected anyelement, label text) returns text language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
  return 'ok   ' || label;
end $$;
create function t.raises(q text, fragment text, label text) returns text language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    if sqlerrm ilike '%' || fragment || '%' then return 'ok   ' || label; end if;
    raise exception 'FAIL %: wrong error: %', label, sqlerrm;
  end;
  raise exception 'FAIL %: expected an error containing "%"', label, fragment;
end $$;
create function t.login(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false);
  select set_config('role', 'authenticated', false);
$$;
-- lets a test peek at tables while "logged in" as an app user
create function t.sudo(q text) returns text language plpgsql security definer as $$
declare r text; begin execute q into r; return r; end $$;
grant usage on schema t to authenticated, anon;
grant execute on all functions in schema t to authenticated, anon;

-- ---------- accounts (what the admin-users edge function does with the service key) ----------
insert into auth.users(email) values ('admin'),('taker1'),('taker2'),('storea'),('storeb'),('dist') ;
select id as admin  from auth.users where email='admin'  \gset
select id as taker1 from auth.users where email='taker1' \gset
select id as taker2 from auth.users where email='taker2' \gset
select id as ua     from auth.users where email='storea' \gset
select id as ub     from auth.users where email='storeb' \gset
select id as ud     from auth.users where email='dist'   \gset

select public.service_create_profile(:'admin',  'admin', 'Adnan Admin', '0300-7334811');
select public.service_create_profile(:'taker1', 'order_taker', 'Bilal Taker', '+92 301 1111111');
select public.service_create_profile(:'taker2', 'order_taker', 'Usman Taker', '03022222222');
select t.eq((select phone from profiles where id = :'taker1'), '03011111111', 'phone is normalised');
select t.raises(format('select public.service_create_profile(%L, %L, %L, %L)', :'ua', 'store', 'X', '03033333333'),
                'must be linked', 'store login needs a customer');
select t.raises(format('select public.service_create_profile(%L, %L, %L, %L)', :'ua', 'admin', 'X', '12345'),
                'valid mobile', 'bad phone rejected');

-- ---------- admin sets up products and customers ----------
select t.login(:'admin');
select public.product_save('{"name":"Methylated Spirit","pack_size":"30ml","net_rate":60,"retail_price":90,"initial_stock":100,"low_stock_level":20}') as p1 \gset
select public.product_save('{"name":"Methylated Spirit","pack_size":"60ml","net_rate":75,"initial_stock":50}') as p2 \gset
select public.product_save('{"name":"Cyclone Toilet Cleaner","pack_size":"500ml","net_rate":250,"initial_stock":5,"low_stock_level":5}') as p3 \gset
select t.eq(t.sudo(format('select stock_qty from products where id = %L', :'p1'))::int, 100, 'opening stock recorded');
select t.eq(public.stock_add(:'p3', 10, 'in', 'new batch', 'B-01', current_date + 365), 15, 'stock in');
select t.raises(format('select public.stock_add(%L, -100, %L)', :'p3', 'adjust'), 'below zero', 'stock cannot go negative');

select public.customer_save(format('{"type":"store","name":"Al Shifa Medical Store","city":"Multan","order_taker_id":"%s","default_discount_pct":5,"opening_balance":1000}', :'taker1')::jsonb) as ca \gset
select public.customer_save(format('{"type":"store","name":"City Pharmacy","order_taker_id":"%s"}', :'taker2')::jsonb) as cb \gset
select public.customer_save('{"type":"distributor","name":"Khan Distributors","default_discount_pct":15}') as cd \gset
select public.customer_discounts_set(:'ca', 5, format('[{"product_id":"%s","discount_pct":10},{"product_id":"%s","discount_pct":null}]', :'p1', :'p2')::jsonb);
reset role;
select public.service_create_profile(:'ua', 'store', 'Shifa Owner', '03033333333', :'ca');
select public.service_create_profile(:'ub', 'store', 'City Owner', '03044444444', :'cb');
select public.service_create_profile(:'ud', 'distributor', 'Khan Sahib', '03055555555', :'cd');
insert into auth.users(email) values ('mismatch') returning id as mm \gset
select public.service_create_profile(:'mm', 'distributor', 'X', '03066666666', :'ca');
select t.eq((select role from profiles where id = :'mm'), 'store', 'login role follows the customer type');
delete from profiles where id = :'mm';

-- ---------- nobody without a login, and no direct table access ----------
set role anon;
select t.raises('select public.my_profile()', 'permission denied', 'anon cannot call the API');
select t.raises('select * from public.orders', 'permission denied', 'anon cannot read tables');
reset role;
select t.login(:'ua');
select t.raises('select * from public.orders', 'permission denied', 'signed-in user cannot read tables directly');
select t.raises('select * from public.ledger_entries', 'permission denied', 'signed-in user cannot read ledger directly');
select t.raises('select app.balance(null)', 'permission denied', 'internal helpers are not reachable');
select t.raises(format('select public.service_create_profile(%L, %L, %L, %L)', gen_random_uuid(), 'admin', 'Hacker', '03099999999'),
                'permission denied', 'user cannot call service functions');

-- ---------- store A: prices and ordering ----------
select t.eq((public.my_profile()->>'role'), 'store', 'store profile');
select t.eq((select (j->>'price')::numeric from jsonb_array_elements(public.products_list()) j where j->>'id' = :'p1'), 54.00, 'product-level discount 10%');
select t.eq((select (j->>'price')::numeric from jsonb_array_elements(public.products_list()) j where j->>'id' = :'p2'), 71.25, 'default discount 5%');
select t.eq((select j->>'stock_qty' from jsonb_array_elements(public.products_list()) j where j->>'id' = :'p1'), null, 'customer does not see stock numbers');
-- a store cannot price-check as another customer
select t.eq((select (j->>'price')::numeric from jsonb_array_elements(public.products_list(:'cd')) j where j->>'id' = :'p3'), 237.50, 'store always gets its own price');

select public.order_place(null, format('[{"product_id":"%s","qty":10},{"product_id":"%s","qty":4}]', :'p1', :'p2')::jsonb, 'urgent')->>'id' as oa \gset
select t.eq(t.sudo(format('select total from orders where id = %L', :'oa'))::numeric, 825.00, 'order total 10*54 + 4*71.25');
select t.eq(t.sudo(format('select subtotal from orders where id = %L', :'oa'))::numeric, 900.00, 'order subtotal');
select t.eq(t.sudo(format('select discount_total from orders where id = %L', :'oa'))::numeric, 75.00, 'order discount total');
select t.eq(t.sudo(format('select stock_qty from products where id = %L', :'p1'))::int, 100, 'stock untouched while pending');
select t.raises(format('select public.order_place(null, %L::jsonb)', '[]'), 'at least one', 'empty order rejected');
select t.raises(format('select public.order_place(null, %L::jsonb)', format('[{"product_id":"%s","qty":0}]', :'p1')), 'invalid quantity', 'zero qty rejected');
select t.raises(format('select public.order_set_status(%L, %L)', :'oa', 'confirmed'), 'not allowed', 'store cannot confirm');
select t.raises(format('select public.customers_list()'), 'not allowed', 'store cannot list customers');
select t.raises(format('select public.ledger_adjust(%L, 500, %L, %L)', :'ca', 'credit', 'gift'), 'not allowed', 'store cannot adjust ledger');

-- ---------- isolation between customers and order takers ----------
select t.login(:'ub');
select t.raises(format('select public.order_get(%L)', :'oa'), 'access', 'store B cannot open store A order');
select t.eq(jsonb_array_length(public.orders_list()), 0, 'store B sees no orders');
select t.eq((public.ledger_get(:'ca')->'customer'->>'name'), 'City Pharmacy', 'store B asking for A ledger gets its own');
select t.login(:'taker2');
select t.raises(format('select public.order_get(%L)', :'oa'), 'access', 'other order taker cannot open order');
select t.raises(format('select public.ledger_get(%L)', :'ca'), 'access', 'other order taker cannot see ledger');
select t.raises(format('select public.order_place(%L, %L::jsonb)', :'ca', format('[{"product_id":"%s","qty":1}]', :'p1')), 'access', 'other order taker cannot order');
select t.eq(jsonb_array_length(public.customers_list()), 1, 'order taker sees only assigned customers');
select t.login(:'taker1');
select t.eq((public.order_get(:'oa')->>'order_no') is not null, true, 'assigned order taker can open order');
select t.eq((select j->>'stock_qty' from jsonb_array_elements(public.products_list(:'ca')) j where j->>'id' = :'p1'), '100', 'order taker sees stock');

-- ---------- admin: confirm, stock, deliver, ledger ----------
select t.login(:'admin');
select t.eq((public.order_set_status(:'oa', 'confirmed')->>'status'), 'confirmed', 'admin confirms');
select t.eq(t.sudo(format('select stock_qty from products where id = %L', :'p1'))::int, 90, 'stock reduced on confirm');
select t.eq((public.customer_get(:'ca')->>'balance')::numeric, 1000.00, 'not charged before delivery');
select t.raises(format('select public.order_update_items(%L, %L::jsonb)', :'oa', format('[{"product_id":"%s","qty":1}]', :'p1')), 'pending', 'confirmed order cannot be edited');
select t.eq((public.order_set_status(:'oa', 'delivered', current_date + 2)->>'status'), 'delivered', 'admin delivers (skipping dispatched)');
select t.eq((public.customer_get(:'ca')->>'balance')::numeric, 1825.00, 'balance = opening 1000 + order 825');
select t.raises(format('select public.order_set_status(%L, %L)', :'oa', 'confirmed'), 'already delivered', 'cannot move back');
select t.raises(format('select public.order_cancel(%L)', :'oa'), 'delivered order cannot', 'delivered cannot be cancelled');

-- not enough stock
select t.login(:'ua');
select public.order_place(null, format('[{"product_id":"%s","qty":40}]', :'p3')::jsonb)->>'id' as ob \gset
select t.login(:'admin');
select t.raises(format('select public.order_set_status(%L, %L)', :'ob', 'confirmed'), 'Not enough stock', 'confirm blocked when stock is short');
select t.eq((public.order_update_items(:'ob', format('[{"product_id":"%s","qty":12}]', :'p3')::jsonb)->>'total')::numeric, 2850.00, 'admin edits pending order (12 x 237.50)');
select public.order_set_status(:'ob', 'confirmed');
select t.eq(t.sudo(format('select stock_qty from products where id = %L', :'p3'))::int, 3, 'stock after second order');
select t.eq(t.sudo(format('select count(*) from notifications where user_id = %L and kind = %L', :'admin', 'stock'))::int, 1, 'low stock alert');
select public.order_cancel(:'ob', 'customer changed mind');
select t.eq(t.sudo(format('select stock_qty from products where id = %L', :'p3'))::int, 15, 'stock restored on cancel');

-- ---------- payments ----------
select t.login(:'ua');
select t.raises(format('select public.payment_submit(null, 500, %L)', 'bank_transfer'), 'receipt', 'store must attach receipt');
select t.raises(format('select public.payment_submit(null, 500, %L, null, %L)', 'bank_transfer', 'someone-else/r.jpg'), 'Invalid receipt', 'receipt path must be own');
select public.payment_submit(null, 1200, 'bank_transfer', 'TRX-1', :'ua' || '/r1.jpg')->>'id' as pay1 \gset
select t.eq((public.dashboard()->>'balance')::numeric, 1825.00, 'pending payment does not change balance');
select t.raises(format('select public.payment_review(%L, true)', :'pay1'), 'not allowed', 'store cannot approve own payment');

select t.login(:'taker1');
select public.payment_submit(:'ca', 300, 'cash')->>'id' as pay2 \gset
select t.raises(format('select public.payment_submit(%L, 300, %L)', :'ca', 'jazzcash'), 'receipt', 'order taker non-cash needs receipt');
select t.raises(format('select public.payment_submit(%L, 300, %L)', :'cb', 'cash'), 'access', 'order taker cannot collect for unassigned store');
select t.eq((public.dashboard()->>'cash_in_hand')::numeric, 300.00, 'order taker cash in hand');
select t.eq(public.can_view_proof(:'ua' || '/r1.jpg'), true, 'assigned order taker may view receipt');
select t.login(:'ub');
select t.eq(public.can_view_proof(:'ua' || '/r1.jpg'), false, 'other store may not view receipt');
select t.raises(format('select public.payment_get(%L)', :'pay1'), 'access', 'other store cannot open payment');

select t.login(:'admin');
select t.eq((public.cash_in_hand()->0->>'amount')::numeric, 300.00, 'admin sees cash with order taker');
select t.eq((public.dashboard()->>'pending_payments')::int, 2, 'two payments await approval');
select public.payment_review(:'pay1', true, 'received in HBL');
select t.eq((public.customer_get(:'ca')->>'balance')::numeric, 625.00, 'balance after 1200 approved');
select t.raises(format('select public.payment_review(%L, true)', :'pay1'), 'already been approved', 'no double approval');
select t.raises(format('select public.payment_review(%L, false)', :'pay2'), 'reason', 'reject needs a reason');
-- 1200 covers opening 1000 first, then 200 of the 825 order
select t.eq((public.order_get(:'oa')->>'paid')::numeric, 200.00, 'payments cover oldest dues first');
select t.eq((public.order_get(:'oa')->>'remaining')::numeric, 625.00, 'order remaining');
select public.payment_review(:'pay2', true);
select t.eq((public.customer_get(:'ca')->>'balance')::numeric, 325.00, 'balance after cash approved');
select t.eq((public.cash_in_hand()), '[]'::jsonb, 'cash in hand cleared after approval');
select public.payment_submit(:'ca', 25, 'cash', null, null, 'paid at office')->>'status' as st \gset
select t.eq(:'st'::text, 'approved', 'admin payment is approved immediately');
select t.eq((public.customer_get(:'ca')->>'balance')::numeric, 300.00, 'balance after admin payment');
select public.ledger_adjust(:'ca', 50, 'credit', 'damaged bottle');
select t.eq((public.ledger_get(:'ca')->>'balance')::numeric, 250.00, 'adjustment applied');
select t.eq(jsonb_array_length(public.ledger_get(:'ca')->'entries'), 6, 'ledger has 6 entries');
select t.eq((public.ledger_get(:'ca')->'entries'->0->>'balance')::numeric, 250.00, 'running balance on latest entry');
reset role;
select t.raises('update public.ledger_entries set credit = 1', 'cannot be changed', 'ledger rows are immutable');
select t.raises('delete from public.ledger_entries', 'cannot be changed', 'ledger rows cannot be deleted');
select t.eq((select sum(debit - credit) from ledger_entries where customer_id = :'ca'), 250.00, 'ledger sums match');

-- ---------- due-date reminders ----------
select t.eq(app.run_due_reminders(), 1, 'reminder sent 2 days before due');
select t.eq(app.run_due_reminders(), 1, 'second run finds the same order');
select t.eq((select count(*)::int from notifications where kind = 'due' and title = 'Payment due in 2 days'), 3,
            'reminder went once each to store, order taker and admin (no duplicates)');
update orders set due_date = app.today() - 3 where id = :'oa';
select app.run_due_reminders();
select t.eq((select count(*)::int from notifications where title = 'Payment overdue by 3 days'), 0,
            'same-day dedupe also covers a changed due date');
update orders set due_date = app.today() - 4 where id = :'oa';
delete from notifications where kind = 'due';
select t.eq(app.run_due_reminders(), 0, 'no reminder on off days');
select t.login(:'admin');
select t.eq((public.dashboard()->>'overdue_orders')::int, 1, 'dashboard counts overdue order');
select t.eq((public.dashboard()->>'overdue_amount')::numeric, 250.00, 'dashboard overdue amount');
select t.eq(jsonb_array_length(public.orders_list('overdue')), 1, 'overdue filter');

-- ---------- distributor behaves as a customer with its own ledger ----------
select t.login(:'ud');
select public.order_place(null, format('[{"product_id":"%s","qty":20}]', :'p2')::jsonb)->>'id' as od \gset
select t.eq(t.sudo(format('select total from orders where id = %L', :'od'))::numeric, 1275.00, 'distributor price 15% off (20 x 63.75)');
select public.order_cancel(:'od', 'wrong qty');
select t.eq(t.sudo(format('select status from orders where id = %L', :'od')), 'cancelled', 'customer cancels own pending order');
select public.order_place(null, format('[{"product_id":"%s","qty":10}]', :'p2')::jsonb)->>'id' as od2 \gset
select t.login(:'admin');
select public.order_set_status(:'od2', 'confirmed');
select t.login(:'ud');
select t.raises(format('select public.order_cancel(%L)', :'od2'), 'already confirmed', 'customer cannot cancel confirmed order');
select t.login(:'admin');
select public.order_set_status(:'od2', 'dispatched');
select public.order_set_status(:'od2', 'delivered');
select t.login(:'ud');
select t.eq((public.ledger_get()->>'balance')::numeric, 637.50, 'distributor ledger');
select t.eq((public.dashboard()->>'balance')::numeric, 637.50, 'distributor dashboard balance');

-- ---------- notifications ----------
select t.eq(public.notifications_unread() > 0, true, 'distributor has notifications');
select public.notifications_mark_read();
select t.eq(public.notifications_unread(), 0, 'mark all read');
select t.login(:'admin');
select t.eq(public.announce('Eid holidays', 'Office closed 3 days', 'store'), 2, 'announcement to stores');
select t.eq(public.announce('New rates', 'From Monday', 'all'), 5, 'announcement to everyone except admin');

-- ---------- deactivated account ----------
select public.user_update(:'ub', null, false);
select t.raises(format('select public.user_update(%L, null, false)', :'admin'), 'your own account', 'admin cannot deactivate self');
select t.login(:'ub');
select t.raises('select public.my_profile()', 'deactivated', 'deactivated user is locked out');
select t.raises('select public.products_list()', 'deactivated', 'deactivated user cannot use API');

-- ---------- first-time setup guard ----------
reset role;
select t.eq(public.service_bootstrap_allowed('abc'), false, 'setup not allowed once an admin exists');

select 'ALL TESTS PASSED';
