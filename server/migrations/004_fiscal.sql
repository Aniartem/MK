-- Система налогообложения и ставка НДС по умолчанию — нужны для каждого фискального чека
alter table organizations add column taxation text not null default 'usnIncome'
  check (taxation in ('osn', 'usnIncome', 'usnIncomeOutcome', 'esn', 'patent'));
alter table organizations add column vat text not null default 'none'
  check (vat in ('none', 'vat0', 'vat5', 'vat7', 'vat10', 'vat22'));

-- Ставка НДС товара, если отличается от ставки организации
alter table products add column vat text check (vat in ('none', 'vat0', 'vat5', 'vat7', 'vat10', 'vat22'));

-- Фискальные реквизиты чека из ККТ и данные оплаты картой
alter table receipts add column fiscal_number int;
alter table receipts add column fiscal_sign text;
alter table receipts add column fn_number text;
alter table receipts add column fiscal_at timestamptz;
alter table receipts add column fiscal_error text;
alter table receipts add column card_rrn text;
alter table receipts add column card_mask text;
alter table receipts add constraint receipts_fiscal_status_check
  check (fiscal_status in ('pending', 'done', 'error', 'skipped'));
create index receipts_fiscal_pending_idx on receipts (fiscal_status) where fiscal_status in ('pending', 'error');
