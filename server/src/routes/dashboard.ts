import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { backOffice } from '../auth.js';
import { config } from '../config.js';
import { byAddress, currentHourIn, inPeriod, periodQuery, todayIn } from '../period.js';

// Тот же период k недель назад: из него считаем «в среднем»
const inPeriodWeeksAgo = (col: string) =>
  `${col} >= ($1::date - 7 * k)::timestamp at time zone $3 and ${col} < ($2::date + 1 - 7 * k)::timestamp at time zone $3`;
const signed = `case when r.kind = 'sale' then r.total else -r.total end`;
const AVG_WEEKS = 4;

const dashboardQuery = periodQuery.extend({ group: z.enum(['hour', 'day']).default('hour') });

function daysBetween(start: string, finish: string) {
  const out: string[] = [];
  for (let d = new Date(start + 'T00:00:00Z'); d <= new Date(finish + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const pct = (value: number, base: number) => (base ? Math.round((value / base - 1) * 10000) / 100 : null);

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/api/dashboard', { preHandler: backOffice }, async (req) => {
    const q = dashboardQuery.parse(req.query);
    const tz = config.timezone;
    const params = [q.start, q.finish, tz, q.addresses];
    const today = todayIn(tz);

    const [kpi] = await query(
      `select coalesce(sum(${signed}), 0) as revenue,
         coalesce(sum(r.total) filter (where r.kind = 'return'), 0) as returns,
         count(*) filter (where r.kind = 'sale') as checks,
         coalesce(sum(r.total) filter (where r.kind = 'sale'), 0) as sales
       from receipts r where ${inPeriod('r.created_at')} and ${byAddress('r.address_id')}`,
      params,
    );
    const [stock] = await query(
      `select coalesce(sum(amount) filter (where kind = 'production'), 0) as production,
         coalesce(sum(amount) filter (where kind = 'writeoff'), 0) as losses
       from stock_movements m where ${inPeriod('m.created_at')} and ${byAddress('m.address_id')}`,
      params,
    );

    // График: ключ — час суток или номер дня от начала периода
    const key = (shift: string) =>
      q.group === 'hour'
        ? `extract(hour from r.created_at at time zone $3)::int`
        : `((r.created_at at time zone $3)::date - ($1::date ${shift}))`;
    const current = await query(
      `select ${key('')} as key, sum(${signed}) as revenue, count(*) filter (where r.kind = 'sale') as checks
       from receipts r where ${inPeriod('r.created_at')} and ${byAddress('r.address_id')} group by 1`,
      params,
    );
    const items = await query(
      `select ${key('')} as key, sum(case when r.kind = 'sale' then i.qty else -i.qty end) as qty
       from receipt_items i join receipts r on r.id = i.receipt_id
       where ${inPeriod('r.created_at')} and ${byAddress('r.address_id')} group by 1`,
      params,
    );
    const history = await query(
      `select k, ${key('- 7 * k')} as key, sum(${signed}) as revenue, count(*) filter (where r.kind = 'sale') as checks
       from generate_series(1, ${AVG_WEEKS}) k
       join receipts r on ${inPeriodWeeksAgo('r.created_at')}
       where ${byAddress('r.address_id')} group by 1, 2`,
      params,
    );
    const weeks = new Set(history.map((h) => h.k)).size || 1;
    const labels =
      q.group === 'hour' ? Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')) : daysBetween(q.start, q.finish);
    const series = labels.map((label, i) => {
      const cur = current.find((c) => c.key === i);
      const hist = history.filter((h) => h.key === i);
      return {
        label,
        revenue: cur?.revenue ?? 0,
        checks: cur?.checks ?? 0,
        items: items.find((c) => c.key === i)?.qty ?? 0,
        avgRevenue: Math.round((hist.reduce((s, h) => s + h.revenue, 0) / weeks) * 100) / 100,
        avgChecks: Math.round((hist.reduce((s, h) => s + h.checks, 0) / weeks) * 10) / 10,
      };
    });

    // Таблица по адресам
    const addresses = await query(
      `select id, name from addresses where active and ($1::int[] is null or id = any($1)) order by is_warehouse desc, name`,
      [q.addresses],
    );
    const sales = await query(
      `select r.address_id as id, sum(${signed}) as revenue, count(*) filter (where r.kind = 'sale') as checks,
         coalesce(sum(r.total) filter (where r.kind = 'sale'), 0) as sales
       from receipts r where ${inPeriod('r.created_at')} and ${byAddress('r.address_id')} group by 1`,
      params,
    );
    const sku = await query(
      `select r.address_id as id, count(distinct i.product_id) as sku
       from receipt_items i join receipts r on r.id = i.receipt_id
       where r.kind = 'sale' and ${inPeriod('r.created_at')} and ${byAddress('r.address_id')} group by 1`,
      params,
    );
    const avg = await query(
      `select r.address_id as id, sum(${signed}) / count(distinct k) as revenue
       from generate_series(1, ${AVG_WEEKS}) k join receipts r on ${inPeriodWeeksAgo('r.created_at')}
       where ${byAddress('r.address_id')} group by 1`,
      params,
    );
    const moves = await query(
      `select address_id as id,
         coalesce(sum(amount) filter (where kind = 'production'), 0) as production,
         coalesce(sum(amount) filter (where kind = 'writeoff'), 0) as losses,
         coalesce(sum(amount) filter (where kind = 'transfer_out'), 0) as sent,
         coalesce(sum(amount) filter (where kind = 'transfer_in'), 0) as received
       from stock_movements m where ${inPeriod('m.created_at')} and ${byAddress('m.address_id')} group by 1`,
      params,
    );
    const plans = await query(
      `select address_id as id, sum(amount) as plan from sales_plans
       where day between $1::date and $2::date and ($3::int[] is null or address_id = any($3)) group by 1`,
      [q.start, q.finish, q.addresses],
    );
    // Прогноз на сегодня: уже продано + сколько обычно продают в оставшиеся часы этого дня недели
    const remaining =
      q.start <= today && today <= q.finish
        ? await query(
            `select r.address_id as id, sum(${signed}) / ${AVG_WEEKS} as revenue
             from generate_series(1, ${AVG_WEEKS}) k
             join receipts r on r.created_at >= ($1::date - 7 * k)::timestamp at time zone $2
               and r.created_at < ($1::date - 7 * k + 1)::timestamp at time zone $2
             where extract(hour from r.created_at at time zone $2) > $3 and ($4::int[] is null or r.address_id = any($4))
             group by 1`,
            [today, tz, currentHourIn(tz), q.addresses],
          )
        : [];

    const rows = addresses.map((a) => {
      const s = sales.find((x) => x.id === a.id) ?? { revenue: 0, checks: 0, sales: 0 };
      const m = moves.find((x) => x.id === a.id) ?? { production: 0, losses: 0, sent: 0, received: 0 };
      const plan = plans.find((x) => x.id === a.id)?.plan ?? null;
      const forecast = Math.round((s.revenue + (remaining.find((x) => x.id === a.id)?.revenue ?? 0)) * 100) / 100;
      return {
        id: a.id,
        name: a.name,
        revenue: s.revenue,
        vsAverage: pct(s.revenue, avg.find((x) => x.id === a.id)?.revenue ?? 0),
        checks: s.checks,
        avgCheck: s.checks ? Math.round((s.sales / s.checks) * 100) / 100 : 0,
        production: m.production,
        remainder: Math.round((m.production + m.received - m.sent - m.losses - s.revenue) * 100) / 100,
        sku: sku.find((x) => x.id === a.id)?.sku ?? 0,
        losses: m.losses,
        sent: m.sent,
        received: m.received,
        plan,
        forecast,
        planPct: plan ? Math.round((forecast / plan) * 10000) / 100 : null,
      };
    });
    const sum = (k: keyof (typeof rows)[number]) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);
    const avgTotal = avg.reduce((t, a) => t + a.revenue, 0);
    const planTotal = rows.some((r) => r.plan !== null) ? sum('plan') : null;
    const totals = {
      revenue: sum('revenue'),
      vsAverage: pct(sum('revenue'), avgTotal),
      checks: sum('checks'),
      avgCheck: kpi.checks ? Math.round((kpi.sales / kpi.checks) * 100) / 100 : 0,
      production: sum('production'),
      remainder: sum('remainder'),
      sku: sku.length ? Math.max(...sku.map((s) => s.sku)) : 0,
      losses: sum('losses'),
      sent: sum('sent'),
      received: sum('received'),
      plan: planTotal,
      forecast: sum('forecast'),
      planPct: planTotal ? Math.round((sum('forecast') / planTotal) * 10000) / 100 : null,
    };

    // Шапка: вчера, сегодня, месяц
    const [top] = await query(
      `select
         coalesce(sum(${signed}) filter (where (r.created_at at time zone $1)::date = $2::date - 1), 0) as yesterday,
         coalesce(sum(${signed}) filter (where (r.created_at at time zone $1)::date = $2::date), 0) as today
       from receipts r
       where r.created_at >= ($2::date - 1)::timestamp at time zone $1
         and ($3::int[] is null or r.address_id = any($3))`,
      [tz, today, q.addresses],
    );
    const [month] = await query(
      `select coalesce(sum(${signed}), 0) as month from receipts r
       where r.created_at >= date_trunc('month', $2::date)::timestamp at time zone $1 and ($3::int[] is null or r.address_id = any($3))`,
      [tz, today, q.addresses],
    );

    return {
      top: { yesterday: top.yesterday, today: top.today, month: month.month },
      kpi: {
        revenue: kpi.revenue,
        returns: kpi.returns,
        checks: kpi.checks,
        avgCheck: totals.avgCheck,
        production: stock.production,
        losses: stock.losses,
      },
      series,
      addresses: { totals, rows },
    };
  });
}
