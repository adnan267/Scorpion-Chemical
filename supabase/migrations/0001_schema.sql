-- Scorpion Chemical distribution app — v1 schema
-- All tables have row-level security ON with no policies: the app never touches
-- tables directly. Every read/write goes through the functions in 0002_functions.sql,
-- which check the caller's role.

create schema if not exists app;

-- ---------- users ----------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          text not null check (role in ('admin','order_taker','store','distributor')),
  full_name     text not null,
  phone         text not null unique,
  customer_id   uuid,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------- customers (medical stores and distributors) ----------
create table public.customers (
  id                    uuid primary key default gen_random_uuid(),
  type                  text not null check (type in ('store','distributor')),
  name                  text not null,
  owner_name            text,
  phone                 text,
  address               text,
  city                  text,
  order_taker_id        uuid references public.profiles(id) on delete set null,
  default_discount_pct  numeric(5,2) not null default 0 check (default_discount_pct between 0 and 100),
  is_active             boolean not null default true,
  created_at            timestamptz not null default now()
);
alter table public.profiles
  add constraint profiles_customer_fk foreign key (customer_id) references public.customers(id) on delete set null;
create index customers_order_taker_idx on public.customers(order_taker_id);

-- ---------- products and stock ----------
create table public.products (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  pack_size        text,
  category         text,
  retail_price     numeric(12,2) check (retail_price is null or retail_price >= 0),
  net_rate         numeric(12,2) not null check (net_rate >= 0),
  packing          text,
  image_path       text,
  stock_qty        integer not null default 0,
  low_stock_level  integer not null default 0,
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now()
);

create table public.customer_discounts (
  customer_id   uuid not null references public.customers(id) on delete cascade,
  product_id    uuid not null references public.products(id) on delete cascade,
  discount_pct  numeric(5,2) not null check (discount_pct between 0 and 100),
  primary key (customer_id, product_id)
);

-- ---------- orders ----------
create sequence public.order_no_seq start 1001;
create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  order_no        text not null unique default ('ORD-' || nextval('public.order_no_seq')),
  customer_id     uuid not null references public.customers(id),
  created_by      uuid not null references public.profiles(id),
  order_taker_id  uuid references public.profiles(id),
  status          text not null default 'pending'
                  check (status in ('pending','confirmed','dispatched','delivered','cancelled')),
  subtotal        numeric(12,2) not null default 0,
  discount_total  numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  due_date        date,
  notes           text,
  stock_deducted  boolean not null default false,
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  confirmed_at    timestamptz,
  dispatched_at   timestamptz,
  delivered_at    timestamptz,
  cancelled_at    timestamptz
);
create index orders_customer_idx on public.orders(customer_id, created_at desc);
create index orders_status_idx on public.orders(status, created_at desc);
create index orders_taker_idx on public.orders(order_taker_id);

create table public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  product_id    uuid not null references public.products(id),
  product_name  text not null,
  qty           integer not null check (qty > 0),
  unit_price    numeric(12,2) not null,
  discount_pct  numeric(5,2) not null default 0,
  line_total    numeric(12,2) not null
);
create index order_items_order_idx on public.order_items(order_id);

create table public.stock_entries (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products(id) on delete cascade,
  qty          integer not null,
  kind         text not null check (kind in ('in','adjust','order','order_cancel')),
  note         text,
  batch_no     text,
  expiry_date  date,
  order_id     uuid references public.orders(id) on delete set null,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);
create index stock_entries_product_idx on public.stock_entries(product_id, created_at desc);

-- ---------- payments ----------
create sequence public.payment_no_seq start 1001;
create table public.payments (
  id               uuid primary key default gen_random_uuid(),
  payment_no       text not null unique default ('PAY-' || nextval('public.payment_no_seq')),
  customer_id      uuid not null references public.customers(id),
  order_id         uuid references public.orders(id) on delete set null,
  amount           numeric(12,2) not null check (amount > 0),
  method           text not null check (method in ('cash','bank_transfer','jazzcash','easypaisa','other')),
  reference_no     text,
  proof_path       text,
  note             text,
  paid_on          date not null default current_date,
  status           text not null default 'pending' check (status in ('pending','approved','rejected')),
  entered_by       uuid not null references public.profiles(id),
  entered_by_role  text not null,
  admin_remarks    text,
  reviewed_by      uuid references public.profiles(id),
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index payments_customer_idx on public.payments(customer_id, created_at desc);
create index payments_status_idx on public.payments(status, created_at desc);
create index payments_entered_by_idx on public.payments(entered_by);

-- ---------- ledger (append-only) ----------
create table public.ledger_entries (
  id              bigint generated always as identity primary key,
  customer_id     uuid not null references public.customers(id),
  kind            text not null check (kind in ('opening','order','payment','adjustment')),
  debit           numeric(12,2) not null default 0 check (debit >= 0),
  credit          numeric(12,2) not null default 0 check (credit >= 0),
  ref_order_id    uuid references public.orders(id),
  ref_payment_id  uuid references public.payments(id),
  note            text,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  check (debit = 0 or credit = 0)
);
create index ledger_customer_idx on public.ledger_entries(customer_id, id);
create unique index ledger_one_per_order on public.ledger_entries(ref_order_id) where kind = 'order';
create unique index ledger_one_per_payment on public.ledger_entries(ref_payment_id) where kind = 'payment';

-- The ledger is append-only: block updates and deletes even for the table owner.
create function app.ledger_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'Ledger entries cannot be changed or deleted. Add an adjustment entry instead.';
end $$;
create trigger ledger_no_update before update or delete on public.ledger_entries
  for each row execute function app.ledger_immutable();

-- ---------- notifications ----------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  body        text not null,
  kind        text not null default 'info',
  ref_type    text,
  ref_id      uuid,
  dedupe_key  text,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
create unique index notifications_dedupe on public.notifications(user_id, dedupe_key) where dedupe_key is not null;

create table public.push_tokens (
  token       text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  platform    text,
  updated_at  timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens(user_id);

-- ---------- settings and activity log ----------
create table public.app_settings (
  key    text primary key,
  value  jsonb not null
);
insert into public.app_settings(key, value) values
  ('company', jsonb_build_object(
      'name', 'Scorpion Chemical',
      'address', 'Khanewal Road, Multan',
      'phone', '0300-7334811',
      'email', 'scorpionchem.pk@gmail.com'));

create table public.activity_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles(id),
  action      text not null,
  entity      text not null,
  entity_id   uuid,
  details     jsonb,
  created_at  timestamptz not null default now()
);
create index activity_entity_idx on public.activity_log(entity, entity_id, id);

-- ---------- lock every table down ----------
alter table public.profiles            enable row level security;
alter table public.customers           enable row level security;
alter table public.products            enable row level security;
alter table public.customer_discounts  enable row level security;
alter table public.orders              enable row level security;
alter table public.order_items         enable row level security;
alter table public.stock_entries       enable row level security;
alter table public.payments            enable row level security;
alter table public.ledger_entries      enable row level security;
alter table public.notifications       enable row level security;
alter table public.push_tokens         enable row level security;
alter table public.app_settings        enable row level security;
alter table public.activity_log        enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
