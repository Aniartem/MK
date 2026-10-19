-- Тип номенклатуры: товар (перепродажа), продукция (своё производство), сырьё (не продаётся на кассе)
alter table products add column kind text not null default 'product' check (kind in ('goods', 'product', 'raw'));

-- Себестоимость единицы на момент продажи — для прибыли и ABC
alter table receipt_items add column cost numeric(12, 2) not null default 0;

create table counterparties (
  id serial primary key,
  name text not null,
  inn text,
  address text,
  payment_delay int,
  note text,
  created_at timestamptz not null default now()
);

-- Поступление от поставщика и инвентаризация. У инвентаризации qty — разница (может быть < 0).
alter table stock_movements drop constraint stock_movements_kind_check;
alter table stock_movements add constraint stock_movements_kind_check
  check (kind in ('production', 'writeoff', 'transfer_out', 'transfer_in', 'supply', 'inventory'));
alter table stock_movements drop constraint stock_movements_qty_check;
alter table stock_movements add constraint stock_movements_qty_check check (qty <> 0);
alter table stock_movements add column cost numeric(12, 2) not null default 0;
alter table stock_movements add column counterparty_id int references counterparties(id);
create index stock_movements_doc_idx on stock_movements (doc_id);

-- Внесение и изъятие наличных на кассе
create table cash_ops (
  id uuid primary key,
  shift_id uuid references shifts(id),
  address_id int not null references addresses(id),
  user_id int not null references users(id),
  kind text not null check (kind in ('deposit', 'withdrawal')),
  amount numeric(12, 2) not null check (amount > 0),
  note text,
  created_at timestamptz not null
);
create index cash_ops_created_idx on cash_ops (created_at);
create index shifts_opened_idx on shifts (opened_at);

-- Скидки и акции. Пустые массивы категорий/адресов — действует на всё.
create table promotions (
  id serial primary key,
  name text not null,
  percent numeric(5, 2) not null check (percent > 0 and percent <= 100),
  mode text not null check (mode in ('auto', 'manual')),
  category_ids int[] not null default '{}',
  address_ids int[] not null default '{}',
  time_from time,
  time_to time,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Бюджет: прочие доходы и расходы (выручка с касс считается автоматически)
create table budget_ops (
  id serial primary key,
  day date not null,
  kind text not null check (kind in ('income', 'expense')),
  article text not null,
  amount numeric(12, 2) not null check (amount > 0),
  address_id int references addresses(id),
  counterparty_id int references counterparties(id),
  planned boolean not null default false,
  paid boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);
create index budget_ops_day_idx on budget_ops (day);
