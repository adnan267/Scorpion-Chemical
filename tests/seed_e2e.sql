-- LOCAL TESTING ONLY: demo accounts and activity for clicking through the app.
\set ON_ERROR_STOP 1
\i /home/claude/scorpion/supabase/seed_products.sql
update products set stock_qty = 500 where is_active;
update products set stock_qty = 12, low_stock_level = 20 where name = 'Gloves';
update products set stock_qty = 0, low_stock_level = 10 where name = 'Surgical Cap';
insert into stock_entries(product_id, qty, kind, note) select id, stock_qty, 'in', 'Opening stock' from products where stock_qty > 0;

create function pg_temp.mk(p_phone text, p_pw text) returns uuid language sql as $$
  insert into auth.users(email, encrypted_password)
  values (p_phone || '@login.scorpionchemical.app', crypt(p_pw, gen_salt('bf'))) returning id
$$;
create function pg_temp.login(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false);
$$;

select pg_temp.mk('03007334811', 'admin123') as admin \gset
select pg_temp.mk('03011111111', 'taker123') as taker \gset
select pg_temp.mk('03033333333', 'store123') as ua \gset
select pg_temp.mk('03055555555', 'dist123') as ud \gset
select public.service_create_profile(:'admin', 'admin', 'Muhammad Adnan', '03007334811');
select public.service_create_profile(:'taker', 'order_taker', 'Bilal Ahmed', '03011111111');

select pg_temp.login(:'admin');
select public.customer_save(format('{"type":"store","name":"Al Shifa Medical Store","owner_name":"Rashid Mehmood","phone":"03033333333","address":"Nishtar Road","city":"Multan","order_taker_id":"%s","default_discount_pct":5,"opening_balance":4500}', :'taker')::jsonb) as ca \gset
select public.customer_save(format('{"type":"store","name":"City Pharmacy","owner_name":"Imran Ali","address":"Gulgasht Colony","city":"Multan","order_taker_id":"%s","default_discount_pct":0}', :'taker')::jsonb) as cb \gset
select public.customer_save('{"type":"store","name":"Rehman Medicos","address":"Chowk Kumharanwala","city":"Multan"}') as cc \gset
select public.customer_save('{"type":"distributor","name":"Khan Distributors","owner_name":"Aslam Khan","phone":"03055555555","address":"Main Bazaar","city":"Khanewal","default_discount_pct":15}') as cd \gset
select public.service_create_profile(:'ua', 'store', 'Rashid Mehmood', '03033333333', :'ca');
select public.service_create_profile(:'ud', 'distributor', 'Aslam Khan', '03055555555', :'cd');
select id as spirit30 from products where pack_size = '30ml' \gset
select id as spirit120 from products where pack_size = '120ml' \gset
select id as cyc500 from products where name = 'Cyclone Toilet Cleaner' and pack_size = '500ml' \gset
select id as maskbox from products where name = 'Blue Guard Face Mask (Adult)' \gset
select id as gloves from products where name = 'Gloves' \gset
select public.customer_discounts_set(:'ca', 5, format('[{"product_id":"%s","discount_pct":10}]', :'spirit30')::jsonb);

-- store A: one delivered & partly paid (overdue), one delivered, one confirmed, one pending
select pg_temp.login(:'ua');
select public.order_place(null, format('[{"product_id":"%s","qty":100},{"product_id":"%s","qty":24}]', :'spirit30', :'cyc500')::jsonb)->>'id' as o1 \gset
select public.order_place(null, format('[{"product_id":"%s","qty":50}]', :'spirit120')::jsonb)->>'id' as o2 \gset
select pg_temp.login(:'taker');
select public.order_place(:'ca', format('[{"product_id":"%s","qty":20},{"product_id":"%s","qty":30}]', :'maskbox', :'gloves')::jsonb, 'Deliver before Friday')->>'id' as o3 \gset
select public.order_place(:'cb', format('[{"product_id":"%s","qty":40}]', :'spirit30')::jsonb)->>'id' as o4 \gset
select pg_temp.login(:'ud');
select public.order_place(null, format('[{"product_id":"%s","qty":200},{"product_id":"%s","qty":60}]', :'spirit120', :'cyc500')::jsonb)->>'id' as o5 \gset

select pg_temp.login(:'admin');
select public.order_set_status(:'o1', 'delivered', app.today() - 4);
select public.order_set_status(:'o2', 'delivered', app.today() + 2);
select public.order_set_status(:'o5', 'dispatched');
select public.order_set_status(:'o4', 'confirmed');
update orders set created_at = created_at - interval '12 days', delivered_at = now() - interval '10 days' where id = :'o1';
update orders set created_at = created_at - interval '3 days', delivered_at = now() - interval '2 days' where id = :'o2';

select pg_temp.login(:'ua');
select public.payment_submit(null, 6000, 'bank_transfer', 'HBL-778812', :'ua' || '/receipt1.jpg')->>'id' as p1 \gset
select public.payment_submit(null, 3000, 'jazzcash', 'JC-552109', :'ua' || '/receipt2.jpg')->>'id' as p2 \gset
select pg_temp.login(:'taker');
select public.payment_submit(:'ca', 2000, 'cash', null, null, 'Collected at shop')->>'id' as p3 \gset
select public.payment_submit(:'cb', 1500, 'cash')->>'id' as p4 \gset
select pg_temp.login(:'admin');
select public.payment_review(:'p1', true, 'Received in HBL account');
select app.run_due_reminders();
select 'seeded';
