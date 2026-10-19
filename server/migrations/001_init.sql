-- Точки продаж и склады
create table addresses (
  id serial primary key,
  name text not null,
  is_warehouse boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Владелец, управляющие и кассиры. Кассиры входят на планшете по PIN-коду.
create table users (
  id serial primary key,
  name text not null,
  role text not null check (role in ('owner', 'manager', 'cashier')),
  email text unique,
  password_hash text,
  pin_hash text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table categories (
  id serial primary key,
  name text not null,
  color text not null default '#4a7bd6',
  sort int not null default 0
);

create table products (
  id serial primary key,
  name text not null,
  category_id int references categories(id) on delete set null,
  price numeric(12, 2) not null check (price >= 0),
  cost numeric(12, 2) not null default 0,
  unit text not null default 'шт',
  barcode text,
  active boolean not null default true,
  sort int not null default 0
);

-- Кассовые смены. id создаёт планшет, чтобы работать без сети.
create table shifts (
  id uuid primary key,
  address_id int not null references addresses(id),
  cashier_id int not null references users(id),
  opened_at timestamptz not null,
  closed_at timestamptz,
  opening_cash numeric(12, 2) not null default 0,
  closing_cash numeric(12, 2)
);

-- Чеки. id создаёт планшет: повторная отправка того же чека ничего не дублирует.
create table receipts (
  id uuid primary key,
  number serial,
  address_id int not null references addresses(id),
  cashier_id int not null references users(id),
  shift_id uuid references shifts(id),
  kind text not null check (kind in ('sale', 'return')),
  payment text not null check (payment in ('cash', 'card', 'mixed')),
  cash_amount numeric(12, 2) not null default 0,
  card_amount numeric(12, 2) not null default 0,
  discount numeric(12, 2) not null default 0,
  total numeric(12, 2) not null,
  created_at timestamptz not null,
  synced_at timestamptz not null default now(),
  fiscal_status text not null default 'pending'
);
create index receipts_created_idx on receipts (created_at);
create index receipts_address_created_idx on receipts (address_id, created_at);

create table receipt_items (
  id serial primary key,
  receipt_id uuid not null references receipts(id) on delete cascade,
  product_id int references products(id) on delete set null,
  name text not null,
  price numeric(12, 2) not null,
  qty numeric(12, 3) not null,
  discount numeric(12, 2) not null default 0,
  amount numeric(12, 2) not null
);
create index receipt_items_receipt_idx on receipt_items (receipt_id);

-- Движения товара: выпуск, списание (потери), перемещение между точками.
-- qty всегда положительное, направление задаёт kind.
create table stock_movements (
  id serial primary key,
  doc_id uuid not null,
  kind text not null check (kind in ('production', 'writeoff', 'transfer_out', 'transfer_in')),
  address_id int not null references addresses(id),
  product_id int not null references products(id),
  qty numeric(12, 3) not null check (qty > 0),
  amount numeric(12, 2) not null,
  user_id int references users(id),
  note text,
  created_at timestamptz not null default now()
);
create index stock_movements_created_idx on stock_movements (created_at);

-- План продаж на день по точке
create table sales_plans (
  address_id int not null references addresses(id) on delete cascade,
  day date not null,
  amount numeric(12, 2) not null,
  primary key (address_id, day)
);
