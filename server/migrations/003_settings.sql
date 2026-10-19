-- Юрлица / ИП, от имени которых работают точки
create table organizations (
  id serial primary key,
  name text not null,
  inn text,
  kpp text,
  address text,
  created_at timestamptz not null default now()
);

alter table addresses add column city text;
alter table addresses add column full_address text;
alter table addresses add column organization_id int references organizations(id) on delete set null;

-- Табельный номер, доступ к точкам (пусто — ко всем) и время последнего входа
alter table users add column tab_number text;
alter table users add column address_ids int[] not null default '{}';
alter table users add column last_seen_at timestamptz;

-- Планшеты-кассы. id генерирует сам планшет при первой настройке.
create table devices (
  id uuid primary key,
  name text,
  address_id int references addresses(id) on delete set null,
  last_user_id int references users(id) on delete set null,
  last_seen_at timestamptz not null default now(),
  pending int not null default 0,
  created_at timestamptz not null default now()
);
