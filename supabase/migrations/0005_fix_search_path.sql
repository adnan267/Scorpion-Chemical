-- Pin search_path on the small helper functions (Supabase security advisor).
alter function app.today() set search_path = pg_catalog;
alter function app.money(numeric) set search_path = pg_catalog;
alter function app.method_label(text) set search_path = pg_catalog;
alter function app.fmt_date(date) set search_path = pg_catalog;
alter function app.norm_phone(text) set search_path = pg_catalog;
alter function app.ledger_immutable() set search_path = pg_catalog;
