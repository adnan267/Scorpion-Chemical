-- Colours, lot numbers, licence photo, city summary (run after the other tests)
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
select id as admin  from profiles where phone='03007334811' \gset
select id as taker1 from profiles where phone='03011111111' \gset
select id as taker2 from profiles where phone='03022222222' \gset
select id as ca from customers where name='Al Shifa Medical Store' \gset
select id as p1 from products where pack_size='30ml' \gset

select t.login(:'admin');
-- lot number
select public.stock_add(:'p1', 50, 'in', 'new lot', 'LOT-7781', null);
select public.order_place(:'ca', format('[{"product_id":"%s","qty":2}]', :'p1')::jsonb)->>'id' as o1 \gset
select t.eq(public.order_get(:'o1')->'items'->0->>'lot_no', 'LOT-7781', 'order line gets the latest lot number');
select public.stock_add(:'p1', 10, 'in', null, 'LOT-9000', null);
select t.eq(public.order_get(:'o1')->'items'->0->>'lot_no', 'LOT-7781', 'lot stays as it was when the order was placed');

-- colours
select public.product_save('{"name":"Face Mask Test","pack_size":"Box of 50","net_rate":200,"initial_stock":100}') as fm \gset
select t.sudo(format('insert into customer_discounts values (%L, %L, 12) returning 1', :'ca', :'fm'));
select t.eq(public.product_colours_add(:'fm', '["black"," Blue ","Green","White","blue"]'), 4, 'four colours added');
select t.eq(t.sudo(format('select string_agg(colour || '':'' || stock_qty, '','' order by colour) from products where group_id = %L', :'fm')), 'Black:100,Blue:0,Green:0,White:0', 'first colour keeps the stock, others start at 0');
select t.eq(t.sudo(format('select count(*) from customer_discounts where customer_id = %L and product_id in (select id from products where group_id = %L)', :'ca', :'fm'))::int, 4, 'customer discount copied to every colour');
select t.sudo(format('select id from products where group_id = %L and colour = ''Blue''', :'fm')) as blue \gset
select public.stock_add(:'blue', 30, 'in', null, 'B-1', null);
select public.product_save(jsonb_build_object('id', :'blue', 'name', 'Face Mask Test', 'pack_size', 'Box of 50', 'net_rate', 220));
select t.eq(t.sudo(format('select count(distinct net_rate) || ''/'' || max(net_rate)::int from products where group_id = %L', :'fm')), '1/220', 'rate change applies to all colours');
select t.eq((select count(*)::int from jsonb_array_elements(public.products_list()) j where j->>'group_id' = :'fm'), 4, 'products list carries colour groups');
select public.order_place(:'ca', format('[{"product_id":"%s","qty":5},{"product_id":"%s","qty":3}]', :'fm', :'blue')::jsonb)->>'id' as o2 \gset
select t.eq(t.sudo(format('select stock_qty from products where id = %L', :'blue'))::int, 27, 'blue stock taken separately');
select t.eq((select string_agg(j->>'product_name', ' | ' order by j->>'product_name') from jsonb_array_elements(public.order_get(:'o2')->'items') j), 'Face Mask Test Box of 50 (Black) | Face Mask Test Box of 50 (Blue)', 'invoice line shows the colour');
select t.raises(format('select public.order_place(%L, %L::jsonb)', :'ca', format('[{"product_id":"%s","qty":5}]', t.sudo(format('select id from products where group_id = %L and colour = ''Green''', :'fm')))), 'Not enough stock', 'green has no stock');
select public.product_colour_rename(:'blue', 'navy blue');
select t.eq(t.sudo(format('select colour from products where id = %L', :'blue')), 'Navy Blue', 'colour renamed');
select t.raises(format('select public.product_colour_rename(%L, ''black'')', :'blue'), 'already there', 'duplicate colour refused');

-- licence photo
select public.customer_set_licence_photo(:'ca', :'ca' || '/lic.jpg');
select t.eq(public.customer_get(:'ca')->>'licence_photo', :'ca' || '/lic.jpg', 'licence photo saved');
select t.raises(format('select public.customer_set_licence_photo(%L, ''other/x.jpg'')', :'ca'), 'wrong folder', 'photo must be in the customer folder');
select t.login(:'taker2');
select t.raises(format('select public.customer_set_licence_photo(%L, %L)', :'ca', :'ca' || '/x.jpg'), 'do not have access', 'another booker cannot change it');

-- city summary
select t.login(:'taker1');
select public.city_summary() as cs \gset
select t.eq((select count(*)::int from jsonb_array_elements(:'cs'::jsonb->'cities') c where c->>'city' = 'Multan') , 1, 'customers grouped by city');
select t.eq((select jsonb_typeof(c->'balance') from jsonb_array_elements(:'cs'::jsonb->'cities') c where c->>'city' = 'Multan'), 'number', 'city balance');
select t.raises(format('select public.city_summary(%L)', :'taker2'), 'own route', 'booker sees only own cities');
select t.login(:'admin');
select t.eq(jsonb_typeof(public.city_summary(:'taker1')->'cities'), 'array', 'admin sees a booker''s cities');
-- bonus schemes (100+2)
select t.login(:'admin');
select public.product_save('{"name":"Bonus Spirit","pack_size":"30ml","net_rate":10,"initial_stock":500,"bonus_per":100,"bonus_free":2}') as bs \gset
select public.order_place(:'ca', format('[{"product_id":"%s","qty":250}]', :'bs')::jsonb)->>'id' as ob \gset
select t.eq((public.order_get(:'ob')->'items'->0->>'bonus_qty')::int, 4, '250 pieces at 100+2 gives 4 free');
select t.eq(t.sudo(format('select stock_qty from products where id = %L', :'bs'))::int, 246, 'stock includes the free pieces');
select t.eq(t.sudo(format('select total::int from orders where id = %L', :'ob'))::int, 2375, 'free pieces are not charged (250 x 10 less 5%)');
select t.eq((select (j->>'bonus_free')::int from jsonb_array_elements(public.products_list(:'ca')) j where j->>'id' = :'bs'), 2, 'catalog shows the scheme');
select public.customer_discounts_set(:'ca', 5, jsonb_build_array(jsonb_build_object('product_id', :'bs', 'discount_pct', '', 'bonus_per', 50, 'bonus_free', 1)));
select public.order_update_items(:'ob', format('[{"product_id":"%s","qty":120}]', :'bs')::jsonb);
select t.eq((public.order_get(:'ob')->'items'->0->>'bonus_qty')::int, 2, 'customer''s own scheme (50+1) wins');
select t.eq(t.sudo(format('select stock_qty from products where id = %L', :'bs'))::int, 378, 'stock put back and taken again with bonus');
select public.customer_discounts_set(:'ca', 5, jsonb_build_array(jsonb_build_object('product_id', :'bs', 'bonus_per', 50, 'bonus_free', 0)));
select public.order_update_items(:'ob', format('[{"product_id":"%s","qty":120}]', :'bs')::jsonb);
select t.eq((public.order_get(:'ob')->'items'->0->>'bonus_qty')::int, 0, 'scheme switched off for this customer');
select public.order_cancel(:'ob', 'test');
select t.eq(t.sudo(format('select stock_qty from products where id = %L', :'bs'))::int, 500, 'cancel restores stock');
select t.raises('select public.product_save(''{"name":"X","net_rate":1,"bonus_per":100}'')', 'both parts', 'half a scheme refused');
select 'V23 TESTS PASSED';
