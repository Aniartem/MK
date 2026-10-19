import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { backOffice } from '../auth.js';
import { config } from '../config.js';

const round = (n: number) => Math.round(n * 100) / 100;
const pctOf = (part: number, whole: number) => (whole ? round((100 * part) / whole) : null);

const opBody = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['income', 'expense']),
  article: z.string().min(1),
  amount: z.number().positive(),
  addressId: z.number().int().nullable().default(null),
  counterpartyId: z.number().int().nullable().default(null),
  planned: z.boolean().default(false),
  paid: z.boolean().default(true),
  note: z.string().nullable().default(null),
});

const monthQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });

export async function budgetRoutes(app: FastifyInstance) {
  // Сводка за месяц: выручка с касс + прочие доходы, расходы по статьям, ключевые показатели и разрез по адресам
  app.get('/api/budget', { preHandler: backOffice }, async (req) => {
    const { month } = monthQuery.parse(req.query);
    const params = [`${month}-01`, config.timezone];
    const range = (col: string) =>
      `${col} >= ($1::date)::timestamp at time zone $2 and ${col} < ($1::date + interval '1 month')::timestamp at time zone $2`;
    const dayRange = `day >= $1::date and day < ($1::date + interval '1 month')`;

    const sales = await query(
      `select r.address_id as id, sum(case when r.kind = 'sale' then r.total else -r.total end) as revenue
       from receipts r where ${range('r.created_at')} group by 1`,
      params,
    );
    const plans = await query(
      `select address_id as id, sum(amount) as plan from sales_plans where ${dayRange} and $2::text is not null group by 1`,
      params,
    );
    const ops = await query(
      `select kind, article, address_id as "addressId", planned, sum(amount) as amount
       from budget_ops where ${dayRange} and $2::text is not null group by 1, 2, 3, 4`,
      params,
    );
    const [kpi] = await query(
      `select
         (select coalesce(sum(case when r.kind = 'sale' then i.qty else -i.qty end * i.cost), 0)
            from receipt_items i join receipts r on r.id = i.receipt_id where ${range('r.created_at')}) as "salesCost",
         (select coalesce(sum(m.qty * p.cost), 0) from stock_movements m join products p on p.id = m.product_id
            where m.kind = 'production' and ${range('m.created_at')}) as "productionCost",
         (select coalesce(sum(m.qty * p.cost), 0) from stock_movements m join products p on p.id = m.product_id
            where m.kind = 'writeoff' and ${range('m.created_at')}) as "writeoffCost",
         (select coalesce(sum(m.cost), 0) from stock_movements m
            where m.kind = 'inventory' and ${range('m.created_at')}) as "inventoryDiff"`,
      params,
    );

    const revenue = sales.reduce((s, r) => s + r.revenue, 0);
    const salesPlan = plans.reduce((s, r) => s + r.plan, 0);
    const articles = (kind: 'income' | 'expense') => {
      const names = [...new Set(ops.filter((o) => o.kind === kind).map((o) => o.article))].sort();
      return names.map((article) => {
        const of = (planned: boolean) =>
          ops.filter((o) => o.kind === kind && o.article === article && o.planned === planned).reduce((s, o) => s + o.amount, 0);
        return { article, plan: of(true), fact: of(false) };
      });
    };
    const income = [{ article: 'Основные продажи', plan: salesPlan, fact: revenue }, ...articles('income')];
    const expense = articles('expense');
    const sum = (list: { plan: number; fact: number }[], k: 'plan' | 'fact') => round(list.reduce((s, r) => s + r[k], 0));
    const incomeTotal = { plan: sum(income, 'plan'), fact: sum(income, 'fact') };
    const expenseTotal = { plan: sum(expense, 'plan'), fact: sum(expense, 'fact') };
    const withPct = (r: { plan: number; fact: number }) => ({ ...r, done: r.plan ? round((100 * r.fact) / r.plan) : null });

    const addresses = await query(`select id, name from addresses where active order by is_warehouse desc, name`);
    const opsFor = (id: number, kind: string, planned: boolean) =>
      ops.filter((o) => o.addressId === id && o.kind === kind && o.planned === planned).reduce((s, o) => s + o.amount, 0);
    const byAddress = addresses.map((a) => {
      const incomePlan = (plans.find((p) => p.id === a.id)?.plan ?? 0) + opsFor(a.id, 'income', true);
      const incomeFact = (sales.find((s) => s.id === a.id)?.revenue ?? 0) + opsFor(a.id, 'income', false);
      const expensePlan = opsFor(a.id, 'expense', true);
      const expenseFact = opsFor(a.id, 'expense', false);
      return {
        id: a.id,
        name: a.name,
        incomePlan: round(incomePlan),
        incomeFact: round(incomeFact),
        incomePct: incomePlan ? round((100 * incomeFact) / incomePlan) : null,
        expensePlan: round(expensePlan),
        expenseFact: round(expenseFact),
        expensePct: expensePlan ? round((100 * expenseFact) / expensePlan) : null,
        profit: round(incomeFact - expenseFact),
        profitPct: pctOf(incomeFact - expenseFact, incomeFact),
      };
    });

    return {
      summary: {
        profit: { plan: round(incomeTotal.plan - expenseTotal.plan), fact: round(incomeTotal.fact - expenseTotal.fact) },
        income: withPct(incomeTotal),
        incomeArticles: income.map(withPct),
        expense: withPct(expenseTotal),
        expenseArticles: expense.map(withPct),
        profitPct: pctOf(incomeTotal.fact - expenseTotal.fact, incomeTotal.fact),
        expensePct: pctOf(expenseTotal.fact, incomeTotal.fact),
      },
      indicators: [
        { name: 'Себестоимость продаж', fact: round(kpi.salesCost), pct: pctOf(kpi.salesCost, revenue) },
        { name: 'Себестоимость выпуска', fact: round(kpi.productionCost), pct: pctOf(kpi.productionCost, revenue) },
        { name: 'Себестоимость списания', fact: round(kpi.writeoffCost), pct: pctOf(kpi.writeoffCost, revenue) },
        { name: 'Расхождения по инвентаризации', fact: round(kpi.inventoryDiff), pct: pctOf(kpi.inventoryDiff, revenue) },
      ],
      addresses: byAddress,
    };
  });

  app.get('/api/budget/ops', { preHandler: backOffice }, async (req) => {
    const { month } = monthQuery.parse(req.query);
    return query(
      `select o.id, to_char(o.day, 'YYYY-MM-DD') as day, o.kind, o.article, o.amount, o.address_id as "addressId",
         a.name as address, o.counterparty_id as "counterpartyId", c.name as counterparty, o.planned, o.paid, o.note
       from budget_ops o
       left join addresses a on a.id = o.address_id
       left join counterparties c on c.id = o.counterparty_id
       where o.day >= $1::date and o.day < ($1::date + interval '1 month')
       order by o.day, o.id`,
      [`${month}-01`],
    );
  });
  app.post('/api/budget/ops', { preHandler: backOffice }, async (req) => {
    const b = opBody.parse(req.body);
    const [row] = await query(
      `insert into budget_ops (day, kind, article, amount, address_id, counterparty_id, planned, paid, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [b.day, b.kind, b.article, b.amount, b.addressId, b.counterpartyId, b.planned, b.paid, b.note],
    );
    return row;
  });
  app.put('/api/budget/ops/:id', { preHandler: backOffice }, async (req) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const b = opBody.parse(req.body);
    await query(
      `update budget_ops set day = $2, kind = $3, article = $4, amount = $5, address_id = $6, counterparty_id = $7,
         planned = $8, paid = $9, note = $10 where id = $1`,
      [id, b.day, b.kind, b.article, b.amount, b.addressId, b.counterpartyId, b.planned, b.paid, b.note],
    );
    return { ok: true };
  });
  app.delete('/api/budget/ops/:id', { preHandler: backOffice }, async (req) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    await query('delete from budget_ops where id = $1', [id]);
    return { ok: true };
  });
}
