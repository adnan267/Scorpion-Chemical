-- Scorpion Chemical v2.5 (17 Nov 2026)
--  * Only the admin and order takers can enter cash payments.
create or replace function app.payments_no_customer_cash() returns trigger language plpgsql as $$
begin
  if new.method = 'cash' and new.entered_by_role not in ('admin', 'order_taker') then
    raise exception 'Cash is handed to the order taker. Choose bank transfer, JazzCash or Easypaisa.';
  end if;
  return new;
end $$;
