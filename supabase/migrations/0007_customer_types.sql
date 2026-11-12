-- More customer types. All of them order, pay and have a ledger the same way.
-- Login role: a distributor logs in as 'distributor'; every other type logs in as 'store'
-- (a customer login), so permissions stay exactly as before.
alter table public.customers drop constraint customers_type_check;
alter table public.customers add constraint customers_type_check
  check (type in ('store', 'distributor', 'wholesaler', 'retailer', 'clinic', 'hospital'));

create or replace function public.customer_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  me public.profiles := app.require('admin');
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_taker uuid := nullif(p->>'order_taker_id', '')::uuid;
  v_opening numeric := coalesce(nullif(p->>'opening_balance', '')::numeric, 0);
  v_disc numeric := coalesce(nullif(p->>'default_discount_pct', '')::numeric, 0);
  v_type text := p->>'type';
  v_old_type text;
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Name is required'; end if;
  if v_type is null or v_type not in ('store', 'distributor', 'wholesaler', 'retailer', 'clinic', 'hospital') then
    raise exception 'Choose the customer type';
  end if;
  if v_disc < 0 or v_disc > 100 then raise exception 'Discount must be between 0 and 100'; end if;
  if v_taker is not null and not exists (
       select 1 from public.profiles where id = v_taker and role = 'order_taker') then
    raise exception 'Selected order taker was not found';
  end if;

  if v_id is null then
    insert into public.customers(type, name, owner_name, phone, address, city, order_taker_id,
                                 default_discount_pct, is_active)
    values (v_type, trim(p->>'name'), nullif(trim(p->>'owner_name'), ''),
            nullif(app.norm_phone(p->>'phone'), ''), nullif(trim(p->>'address'), ''),
            nullif(trim(p->>'city'), ''), v_taker, v_disc, coalesce((p->>'is_active')::boolean, true))
    returning id into v_id;
    if v_opening <> 0 then
      insert into public.ledger_entries(customer_id, kind, debit, credit, note, created_by)
      values (v_id, 'opening', greatest(v_opening, 0), greatest(-v_opening, 0), 'Opening balance', me.id);
    end if;
    perform app.log(me.id, 'customer_created', 'customer', v_id, p);
  else
    select type into v_old_type from public.customers where id = v_id;
    if not found then raise exception 'Customer not found'; end if;
    -- a customer with logins cannot switch between distributor and the other types,
    -- because the login role depends on it
    if (v_old_type = 'distributor') <> (v_type = 'distributor')
       and exists (select 1 from public.profiles where customer_id = v_id) then
      raise exception 'This customer already has an app login, so it cannot be changed to or from Distributor';
    end if;
    update public.customers set
      type = v_type,
      name = trim(p->>'name'),
      owner_name = nullif(trim(p->>'owner_name'), ''),
      phone = nullif(app.norm_phone(p->>'phone'), ''),
      address = nullif(trim(p->>'address'), ''),
      city = nullif(trim(p->>'city'), ''),
      order_taker_id = v_taker,
      default_discount_pct = v_disc,
      is_active = coalesce((p->>'is_active')::boolean, is_active)
    where id = v_id;
    perform app.log(me.id, 'customer_updated', 'customer', v_id, p);
  end if;
  return v_id;
end $$;

create or replace function public.service_create_profile(p_user_id uuid, p_role text, p_full_name text, p_phone text,
                                                         p_customer_id uuid default null) returns void
language plpgsql security definer set search_path = public, app as $$
declare v_phone text := app.norm_phone(p_phone); v_type text;
begin
  if p_role not in ('admin', 'order_taker', 'store', 'distributor') then raise exception 'Invalid role'; end if;
  if coalesce(trim(p_full_name), '') = '' then raise exception 'Name is required'; end if;
  if v_phone !~ '^03[0-9]{9}$' then raise exception 'Enter a valid mobile number, e.g. 03001234567'; end if;
  if p_role in ('store', 'distributor') then
    select type into v_type from public.customers where id = p_customer_id;
    if v_type is null then raise exception 'This login must be linked to a customer'; end if;
    -- the login role follows the customer type
    p_role := case when v_type = 'distributor' then 'distributor' else 'store' end;
  else
    p_customer_id := null;
  end if;
  insert into public.profiles(id, role, full_name, phone, customer_id)
  values (p_user_id, p_role, trim(p_full_name), v_phone, p_customer_id);
end $$;

-- keep the grants exactly as before (create or replace keeps them, this is a safety net)
revoke execute on function public.customer_save(jsonb) from public, anon;
grant execute on function public.customer_save(jsonb) to authenticated;
revoke execute on function public.service_create_profile(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.service_create_profile(uuid, text, text, text, uuid) to service_role;
