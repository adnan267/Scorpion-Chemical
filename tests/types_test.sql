\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
select id as admin from profiles where phone='03007334811' \gset
select t.login(:'admin');
select public.customer_save('{"type":"clinic","name":"Nishtar Clinic","default_discount_pct":3}') as cl \gset
select public.customer_save('{"type":"hospital","name":"City Hospital"}') as ho \gset
select t.raises('select public.customer_save(''{"type":"pharmacy","name":"X"}'')', 'customer type', 'unknown type rejected');
reset role;
insert into auth.users(email) values ('clinic') returning id as cu \gset
select public.service_create_profile(:'cu', 'store', 'Dr Amir', '03077777777', :'cl');
select t.eq((select role from profiles where id = :'cu'), 'store', 'clinic login is a customer login');
select id as p60 from products where pack_size = '60ml' \gset
select t.login(:'cu');
select t.eq((public.my_profile()->'customer'->>'type'), 'clinic', 'clinic sees its type');
select t.eq(public.order_place(null, jsonb_build_array(jsonb_build_object('product_id', :'p60', 'qty', 2)))->>'total', '145.50', 'clinic orders with its 3% discount (2 x 72.75)');
select t.login(:'admin');
select t.raises(format('select public.customer_save(%L::jsonb)', jsonb_build_object('id', :'cl', 'type', 'distributor', 'name', 'Nishtar Clinic')), 'cannot be changed', 'type with login cannot switch to distributor');
select t.eq(public.customer_save(jsonb_build_object('id', :'ho', 'type', 'wholesaler', 'name', 'City Hospital'))::text, :'ho'::text, 'type without login can change');
reset role;
select t.eq((select type from customers where id = :'ho'), 'wholesaler', 'type changed');
select 'TYPE TESTS PASSED';
