-- File storage (Supabase only): product photos are public, payment receipts are private.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- product photos: only the admin can add or replace them
create policy "product images: admin writes" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());
create policy "product images: admin updates" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());
create policy "product images: admin deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());
create policy "product images: signed-in users read" on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images');

-- receipts: each user uploads into a folder named after their own user id
create policy "receipts: upload into own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

-- receipts can be opened by the admin, the uploader, the customer the payment belongs to,
-- and that customer's assigned order taker
create policy "receipts: read when allowed" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (public.is_admin()
         or (storage.foldername(name))[1] = auth.uid()::text
         or public.can_view_proof(name)));
