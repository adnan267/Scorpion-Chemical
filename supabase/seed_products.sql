-- The products from Scorpion Chemical's printed rate list (Nov 2026).
-- Photos: upload the files in seed/product-images/seed/ to the "product-images" bucket, folder "seed".
insert into public.products (name, pack_size, category, retail_price, net_rate, packing, image_path, sort_order, is_active) values
  ('Blue Guard Face Mask (Adult)',  'Box of 50',   'Masks',       null, 200, '50 pc per box',     'seed/mask-adult-box.jpg',  10, true),
  ('Face Mask (Adult)',             'Pouch of 10', 'Masks',       null,  70, '10 pc per pouch',   'seed/mask-adult-pouch.jpg', 20, true),
  ('FLO.B Face Mask (Baby)',        'Box of 50',   'Masks',       null, 200, '50 pc per box',     'seed/mask-baby-box.jpg',   30, true),
  ('Face Mask (Baby)',              'Pouch of 10', 'Masks',       null,  70, '10 pc per pouch',   'seed/mask-baby-pouch.jpg', 40, true),
  ('Surgical Cap',                  null,          'Disposables', null, 250, null,                'seed/surgical-cap.jpg',    50, true),
  ('Gloves',                        null,          'Disposables', null,  50, null,                'seed/gloves.jpg',          60, true),
  ('Senza Skin Lightening Cream',   null,          'Cosmetics',   null, 380, null,                'seed/senza-cream.jpg',     70, true),
  ('Cyclone Toilet Cleaner',        '250ml',       'Cleaners',    null, 150, null,                'seed/cyclone-toilet-cleaner.jpg', 80, true),
  ('Cyclone Toilet Cleaner',        '500ml',       'Cleaners',     350, 250, null,                'seed/cyclone-toilet-cleaner.jpg', 90, true),
  ('Blue Guard Methylated Spirit',  '30ml',        'Spirit',        90,  60, '100 pc per carton', 'seed/methylated-spirit-30ml.jpg',  100, true),
  ('Blue Guard Methylated Spirit',  '60ml',        'Spirit',       150,  75, '100 pc per carton', 'seed/methylated-spirit-60ml.jpg',  110, true),
  ('Blue Guard Methylated Spirit',  '100ml',       'Spirit',       200, 100, '100 pc per carton', 'seed/methylated-spirit-100ml.jpg', 120, true),
  ('Blue Guard Methylated Spirit',  '120ml',       'Spirit',       240, 120, '100 pc per carton', 'seed/methylated-spirit-120ml.jpg', 130, true),
  ('Blue Guard Methylated Spirit',  '120ml Sprayer', 'Spirit',     280, 145, '100 pc per carton', 'seed/methylated-spirit-120ml-sprayer.jpg', 140, true),
  ('Blue Guard Methylated Spirit',  '240ml',       'Spirit',       360, 180, '50 pc per carton',  'seed/methylated-spirit-240ml.jpg', 150, true),
  ('Blue Guard Methylated Spirit',  '450ml',       'Spirit',       550, 275, '25 pc per carton',  'seed/methylated-spirit-450ml.jpg', 160, true),
  -- net rate not on the rate list: hidden from customers until the admin sets the rate
  ('Blue Guard White Phenyl',             '50ml',    'Cleaners', 300, 0, null, 'seed/white-phenyl-50ml.jpg', 200, false),
  ('Blue Guard White Phenyl',             '3 litre', 'Cleaners', null, 0, null, 'seed/white-phenyl-3l.jpg',   210, false),
  ('Blue Guard White Phenyl Concentrate', '100ml',   'Cleaners', null, 0, null, 'seed/white-phenyl-concentrate-100ml.jpg', 220, false);
