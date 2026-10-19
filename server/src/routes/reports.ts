import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { backOffice } from '../auth.js';
import { config } from '../config.js';
import { balancesAt, byAddress, comparePeriod, inPeriod, periodQuery, sign } from '../period.js';

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const share = (part: number, whole: number) => (whole ? round((100 * part) / whole) : null);

const filters = periodQuery.extend({
  category: z.coerce.number().int().optional(),
  search: z.string().optional(),
  kind: z.enum(['goods', 'product', 'raw']).optional(),
});
type Filters = z.infer<typeof filters>;

// $1–$4 — период и адреса, $5 категория, $6 поиск, $7 тип номенклатуры
const params = (f: Filters, start = f.start, finish = f.finish) => [
  start, finish, config.timezone, f.addresses, f.category ?? null, f.search?.trim() || null, f.kind ?? null,
];
const productFilter = `($5::int is null or p.category_id = $5)
  and ($6::text is null or p.name ilike '%' || $6 || '%')
  and ($7::text is null or p.kind = $7)`;

// Остатки на конец дня: период из одного дня
const dayFilters = (q: unknown) => {
  const day = z.object({ day: z.string() }).parse(q).day;
  return filters.parse({ ...(q as object), start: day, finish: day });
};

// Продажи с группировкой по разным разрезам
const salesGroups = {
  products: { key: `coalesce(p.name, i.name)`, name: `coalesce(p.name, i.name)`, extra: `min(c.name)` },
  categories: { key: `coalesce(c.name, 'Без категории')`, name: `coalesce(c.name, 'Без категории')`, extra: `null` },
  addresses: { key: `a.name`, name: `a.name`, extra: `null` },
  days: {
    key: `to_char((r.created_at at time zone $3)::date, 'YYYY-MM-DD')`,
    name: `to_char((r.created_at at time zone $3)::date, 'YYYY-MM-DD')`,
    extra: `null`,
  },
  hours: {
    key: `lpad(extract(hour from r.created_at at time zone $3)::text, 2, '0')`,
    name: `lpad(extract(hour from r.created_at at time zone $3)::text, 2, '0') || ':00'`,
    extra: `null`,
  },
  employees: { key: `u.name`, name: `u.name`, extra: `null` },
};

async function salesRows(by: keyof typeof salesGroups | 'payments', f: Filters, start = f.start, finish = f.finish) {
  if (by === 'payments') {
    return query(
      `select name as key, name, null as extra, sum(cnt) as checks, 0 as qty, 0 as cost, 0 as discount, sum(amount) as revenue
       from (
         select 'Наличные' as name, ${sign} * r.cash_amount as amount, (r.cash_amount > 0 and r.kind = 'sale')::int as cnt
         from receipts r where ${inPeriod('r.created_at')} and ${byAddress('r.address_id')}
         union all
         select 'Карта', ${sign} * r.card_amount, (r.card_amount > 0 and r.kind = 'sale')::int
         from receipts r where ${inPeriod('r.created_at')} and ${byAddress('r.address_id')}
       ) t group by name`,
      params(f, start, finish).slice(0, 4),
    );
  }
  const g = salesGroups[by];
  return query(
    `select ${g.key} as key, ${g.name} as name, ${g.extra} as extra,
       count(distinct r.id) filter (where r.kind = 'sale') as checks,
       sum(${sign} * i.qty) as qty,
       sum(${sign} * i.qty * i.cost) as cost,
       sum(${sign} * i.discount) as discount,
       sum(${sign} * i.amount) as revenue
     from receipt_items i
     join receipts r on r.id = i.receipt_id
     join addresses a on a.id = r.address_id
     join users u on u.id = r.cashier_id
     left join products p on p.id = i.product_id
     left join categories c on c.id = p.category_id
     where ${inPeriod('r.created_at')} and ${byAddress('r.address_id')}
       and ($5::int is null or p.category_id = $5)
       and ($6::text is null or coalesce(p.name, i.name) ilike '%' || $6 || '%')
       and ($7::text is null or p.kind = $7)
     group by 1, 2`,
    params(f, start, finish),
  );
}

export async function reportRoutes(app: FastifyInstance) {
  app.get('/api/reports/sales', { preHandler: backOffice }, async (req) => {
    const q = filters
      .extend({
        by: z.enum(['products', 'categories', 'addresses', 'days', 'hours', 'employees', 'payments']).default('products'),
        compare: z.enum(['none', 'day', 'week', 'month', 'year']).default('none'),
      })
      .parse(req.query);
    const rows = await salesRows(q.by, q);
    const total = rows.reduce((s, r) => s + r.revenue, 0);
    let prev = new Map<string, number>();
    if (q.compare !== 'none') {
      const cmp = comparePeriod(q.start, q.finish, q.compare);
      const prevRows = await salesRows(q.by, q, cmp.start, cmp.finish);
      prev = new Map(prevRows.map((r) => [q.by === 'days' ? cmp.forward(r.key) : r.key, r.revenue]));
      // строки, которые продавались только в прошлом периоде
      for (const key of prev.keys()) {
        if (!rows.some((r) => r.key === key)) {
          rows.push({ key, name: key, extra: null, checks: 0, qty: 0, cost: 0, discount: 0, revenue: 0 });
        }
      }
    }
    const ordered = q.by === 'days' || q.by === 'hours';
    return rows
      .map((r) => {
        const before = prev.get(r.key);
        return {
          ...r,
          cost: round(r.cost),
          profit: round(r.revenue - r.cost),
          share: share(r.revenue, total),
          avgCheck: r.checks ? round(r.revenue / r.checks) : null,
          prevRevenue: q.compare === 'none' ? undefined : before ?? 0,
          change: q.compare === 'none' || !before ? null : round((r.revenue / before - 1) * 100),
        };
      })
      .sort((a, b) => (ordered ? (a.key < b.key ? -1 : 1) : b.revenue - a.revenue));
  });

  // Производство: продажи против выпуска и списаний по продукции
  app.get('/api/reports/production', { preHandler: backOffice }, async (req) => {
    const f = filters.parse(req.query);
    const days = Math.round((Date.parse(f.finish) - Date.parse(f.start)) / 86400000) + 1;
    return query(
      `with s as (
         select i.product_id as id, sum(${sign} * i.qty) as sales,
           count(distinct (r.created_at at time zone $3)::date) as sale_days
         from receipt_items i join receipts r on r.id = i.receipt_id
         where ${inPeriod('r.created_at')} and ${byAddress('r.address_id')} group by 1
       ), m as (
         select product_id as id,
           coalesce(sum(qty) filter (where kind = 'production'), 0) as production,
           coalesce(sum(amount) filter (where kind = 'production'), 0) as production_sum,
           coalesce(sum(qty) filter (where kind = 'writeoff'), 0) as writeoff,
           count(distinct (created_at at time zone $3)::date) filter (where kind = 'production') as prod_days
         from stock_movements where ${inPeriod('created_at')} and ${byAddress('address_id')} group by 1
       )
       select p.id, p.name, c.name as category,
         coalesce(s.sales, 0) as sales, coalesce(m.production, 0) as production,
         $8::int - coalesce(s.sale_days, 0) as "daysNoSales", $8::int - coalesce(m.prod_days, 0) as "daysNoProduction",
         coalesce(m.writeoff, 0) as writeoff,
         round(100 * m.writeoff / nullif(m.production, 0), 2) as "pctOfProduction",
         round(100 * m.writeoff / nullif(s.sales, 0), 2) as "pctOfSales",
         coalesce(m.production_sum, 0) as "productionSum"
       from products p
       left join categories c on c.id = p.category_id
       left join s on s.id = p.id
       left join m on m.id = p.id
       where p.kind = 'product' and (p.active or s.id is not null or m.id is not null) and ${productFilter}
       order by p.name`,
      [...params(f), days],
    );
  });

  // Остатки на конец дня
  app.get('/api/reports/stock', { preHandler: backOffice }, async (req) => {
    const f = dayFilters(req.query);
    return query(
      `with b as (${balancesAt('($2::date + 1)::timestamp at time zone $3', '$4')})
       select p.id, p.name, p.unit, p.kind, c.name as category, coalesce(sum(b.qty), 0) as qty,
         round(coalesce(sum(b.qty), 0) * p.price, 2) as "retailSum",
         round(coalesce(sum(b.qty), 0) * p.cost, 2) as "costSum"
       from products p
       left join categories c on c.id = p.category_id
       left join b on b.product_id = p.id
       where ${productFilter} and $1::date is not null
       group by p.id, c.name
       having p.active or coalesce(sum(b.qty), 0) <> 0
       order by p.name`,
      params(f),
    );
  });

  // Движение товара за период: остаток на начало, приход и расход по видам, остаток на конец
  app.get('/api/reports/movement', { preHandler: backOffice }, async (req) => {
    const f = filters.extend({ unit: z.enum(['qty', 'retail', 'cost']).default('qty') }).parse(req.query);
    const rows = await query(
      `with o as (
         select product_id as id, sum(qty) as qty
         from (${balancesAt('($1::date)::timestamp at time zone $3', '$4')}) b group by 1
       ), mv as (
         select product_id as id,
           sum(qty) filter (where kind = 'production') as production,
           sum(qty) filter (where kind = 'supply') as supply,
           sum(qty) filter (where kind = 'transfer_out') as transfer_out,
           sum(qty) filter (where kind = 'transfer_in') as transfer_in,
           sum(qty) filter (where kind = 'writeoff') as losses,
           sum(qty) filter (where kind = 'inventory') as inventory
         from stock_movements where ${inPeriod('created_at')} and ${byAddress('address_id')} group by 1
       ), s as (
         select i.product_id as id,
           sum(i.qty) filter (where r.kind = 'sale') as sales, sum(i.qty) filter (where r.kind = 'return') as returns
         from receipt_items i join receipts r on r.id = i.receipt_id
         where ${inPeriod('r.created_at')} and ${byAddress('r.address_id')} group by 1
       )
       select p.id, p.name, p.unit, p.price, p.cost, c.name as category,
         coalesce(o.qty, 0) as opening,
         coalesce(mv.production, 0) as production, coalesce(mv.supply, 0) as supply,
         coalesce(mv.transfer_out, 0) as "transferOut", coalesce(mv.transfer_in, 0) as "transferIn",
         coalesce(s.sales, 0) as sales, coalesce(s.returns, 0) as returns,
         coalesce(mv.losses, 0) as losses, coalesce(mv.inventory, 0) as inventory
       from products p
       left join categories c on c.id = p.category_id
       left join o on o.id = p.id left join mv on mv.id = p.id left join s on s.id = p.id
       where ${productFilter} and (o.id is not null or mv.id is not null or s.id is not null)
       order by p.name`,
      params(f),
    );
    const cols = ['opening', 'production', 'supply', 'transferOut', 'transferIn', 'sales', 'returns', 'losses', 'inventory'] as const;
    return rows.map((r) => {
      const factor = f.unit === 'qty' ? 1 : f.unit === 'retail' ? r.price : r.cost;
      const closing = r.opening + r.production + r.supply - r.transferOut + r.transferIn - r.sales + r.returns - r.losses + r.inventory;
      const out: Record<string, unknown> = { id: r.id, name: r.name, unit: r.unit, category: r.category };
      for (const k of cols) out[k] = round(r[k] * factor, 3);
      out.closing = round(closing * factor, 3);
      return out;
    });
  });

  // Часовые остатки: товар × адрес на текущий момент (или на конец выбранного дня)
  app.get('/api/reports/hourly', { preHandler: backOffice }, async (req) => {
    const f = dayFilters(req.query);
    const addresses = await query(
      `select id, name from addresses where active and ($1::int[] is null or id = any($1)) order by is_warehouse desc, name`,
      [f.addresses],
    );
    const rows = await query(
      `with b as (${balancesAt('least(now(), ($2::date + 1)::timestamp at time zone $3)', '$4')}),
       top as (
         select i.product_id as id, sum(i.qty) as sold
         from receipt_items i join receipts r on r.id = i.receipt_id
         where r.kind = 'sale' and r.created_at >= ($1::date - 28)::timestamp at time zone $3 and ${byAddress('r.address_id')}
         group by 1
       )
       select p.id, p.name, coalesce(top.sold, 0) as sold,
         coalesce(json_object_agg(b.address_id, b.qty) filter (where b.address_id is not null), '{}') as balances
       from products p
       left join top on top.id = p.id
       left join b on b.product_id = p.id
       where p.active and p.kind <> 'raw' and ${productFilter}
       group by p.id, top.sold
       order by coalesce(top.sold, 0) desc, p.name`,
      params(f),
    );
    return { addresses, rows: rows.map((r, i) => ({ ...r, top: i + 1 })) };
  });

  // Потери (списания) по товарам, адресам или дням
  app.get('/api/reports/losses', { preHandler: backOffice }, async (req) => {
    const q = filters.extend({ by: z.enum(['products', 'addresses', 'days']).default('products') }).parse(req.query);
    if (q.by === 'products') {
      return query(
        `with s as (
           select i.product_id as id, sum(${sign} * i.qty) as sales
           from receipt_items i join receipts r on r.id = i.receipt_id
           where ${inPeriod('r.created_at')} and ${byAddress('r.address_id')} group by 1
         ), m as (
           select product_id as id,
             coalesce(sum(qty) filter (where kind = 'production'), 0) as production,
             coalesce(sum(qty) filter (where kind = 'writeoff'), 0) as writeoff,
             coalesce(sum(amount) filter (where kind = 'writeoff'), 0) as writeoff_sum
           from stock_movements where ${inPeriod('created_at')} and ${byAddress('address_id')} group by 1
         )
         select p.id, p.name, p.unit, c.name as category, coalesce(s.sales, 0) as sales, m.production,
           m.writeoff, m.writeoff_sum as "writeoffSum",
           round(100 * m.writeoff / nullif(s.sales, 0), 2) as "pctOfSales"
         from products p
         left join categories c on c.id = p.category_id
         join m on m.id = p.id
         left join s on s.id = p.id
         where m.writeoff > 0 and ${productFilter}
         order by m.writeoff desc`,
        params(q),
      );
    }
    const key = q.by === 'addresses' ? 'a.name' : `to_char((x.at at time zone $3)::date, 'YYYY-MM-DD')`;
    return query(
      `select ${key} as name,
         coalesce(sum(x.revenue), 0) as sales, coalesce(sum(x.production), 0) as production,
         coalesce(sum(x.writeoff), 0) as "writeoffSum",
         round(100 * sum(x.writeoff) / nullif(sum(x.revenue), 0), 2) as "pctOfSales"
       from (
         select r.address_id, r.created_at as at, ${sign} * r.total as revenue, 0 as production, 0 as writeoff
         from receipts r where ${inPeriod('r.created_at')} and ${byAddress('r.address_id')}
         union all
         select address_id, created_at, 0,
           case when kind = 'production' then amount else 0 end, case when kind = 'writeoff' then amount else 0 end
         from stock_movements
         where kind in ('production', 'writeoff') and ${inPeriod('created_at')} and ${byAddress('address_id')}
       ) x join addresses a on a.id = x.address_id
       group by 1 order by 1`,
      params(q).slice(0, 4),
    );
  });

  // ABC-анализ: группы по выручке и по прибыли (накопленные 80% / 95%)
  app.get('/api/reports/abc', { preHandler: backOffice }, async (req) => {
    const f = filters.parse(req.query);
    const sold = (await salesRows('products', f)).filter((r) => r.qty > 0);
    const products = new Map((await query('select name, price, unit from products')).map((p) => [p.name, p]));
    const items = sold.map((r) => ({ ...r, cost: round(r.cost), profit: round(r.revenue - r.cost) }));

    const grouper = (field: 'revenue' | 'profit') => {
      const positive = items.filter((r) => r[field] > 0).sort((a, b) => b[field] - a[field]);
      const total = positive.reduce((s, r) => s + r[field], 0);
      const out = new Map<object, string>();
      let acc = 0;
      for (const r of positive) {
        // доля считается до добавления строки, чтобы лидер всегда попадал в A
        out.set(r, acc / total < 0.8 ? 'A' : acc / total < 0.95 ? 'B' : 'C');
        acc += r[field];
      }
      return (r: object) => out.get(r) ?? 'C';
    };
    const revenueGroup = grouper('revenue');
    const profitGroup = grouper('profit');
    const totalRevenue = items.reduce((s, r) => s + r.revenue, 0);
    const totalProfit = items.reduce((s, r) => s + r.profit, 0);

    const rows = items
      .map((r) => ({
        name: r.name,
        unit: products.get(r.name)?.unit ?? 'шт',
        price: products.get(r.name)?.price ?? null,
        qty: r.qty,
        revenue: r.revenue,
        revenueShare: share(r.revenue, totalRevenue),
        revenueGroup: revenueGroup(r),
        cost: r.cost,
        markup: r.cost ? round(((r.revenue - r.cost) / r.cost) * 100) : null,
        costPct: share(r.cost, r.revenue),
        profit: r.profit,
        profitShare: share(r.profit, totalProfit),
        profitGroup: profitGroup(r),
      }))
      .sort((a, b) => b.revenue - a.revenue);
    const matrix: Record<string, Record<string, number>> = {};
    for (const g of 'ABC') matrix[g] = { A: 0, B: 0, C: 0 };
    for (const r of rows) matrix[r.revenueGroup][r.profitGroup]++;
    return { matrix, rows };
  });

  // Сотрудники: продажи, возвраты, средний чек и расхождения кассы по закрытым сменам
  app.get('/api/reports/employees', { preHandler: backOffice }, async (req) => {
    const f = periodQuery.parse(req.query);
    return query(
      `with s as (
         select r.cashier_id as id,
           coalesce(sum(r.total) filter (where r.kind = 'sale'), 0) as sales,
           coalesce(sum(r.total) filter (where r.kind = 'return'), 0) as returns,
           count(*) filter (where r.kind = 'sale') as checks,
           coalesce(sum(r.discount) filter (where r.kind = 'sale'), 0) as discounts
         from receipts r where ${inPeriod('r.created_at')} and ${byAddress('r.address_id')} group by 1
       ), cash as (
         select sh.cashier_id as id, count(*) as shifts,
           sum(sh.closing_cash - (sh.opening_cash
             + coalesce((select sum(case when r.kind = 'sale' then r.cash_amount else -r.cash_amount end)
                         from receipts r where r.shift_id = sh.id), 0)
             + coalesce((select sum(case when o.kind = 'deposit' then o.amount else -o.amount end)
                         from cash_ops o where o.shift_id = sh.id), 0)
           )) as discrepancy
         from shifts sh
         where sh.closed_at is not null and ${inPeriod('sh.closed_at')} and ${byAddress('sh.address_id')}
         group by 1
       )
       select u.id, u.name, u.role, s.sales, s.returns, s.sales - s.returns as revenue, s.checks,
         round(s.sales / nullif(s.checks, 0), 2) as "avgCheck", s.discounts,
         coalesce(cash.shifts, 0) as shifts, round(coalesce(cash.discrepancy, 0), 2) as discrepancy
       from users u join s on s.id = u.id left join cash on cash.id = u.id
       order by revenue desc`,
      [f.start, f.finish, config.timezone, f.addresses],
    );
  });
}
