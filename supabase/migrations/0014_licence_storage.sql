-- Customer licence photos (Supabase only): private, stored as <customer id>/<file>.
-- Admin, the customer's order taker and the customer's own login may upload and see them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('licence-photos', 'licence-photos', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "licence photos: upload when allowed" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'licence-photos' and public.can_access_customer_file(name));
create policy "licence photos: read when allowed" on storage.objects
  for select to authenticated
  using (bucket_id = 'licence-photos' and public.can_access_customer_file(name));
