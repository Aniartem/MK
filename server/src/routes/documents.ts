import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { anyUser, backOffice } from '../auth.js';
import { config } from '../config.js';
import { balancesAt, periodQuery } from '../period.js';

const stockBody = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(['production', 'writeoff', 'transfer', 'supply', 'inventory']),
  addressId: z.number().int(),
  toAddressId: z.number().int().optional(),
  counterpartyId: z.number().int().optional(),
  note: z.string().optional(),
  // для инвентаризации qty — фактический остаток, для поступления cost — закупочная цена за единицу
  items: z.array(z.object({ productId: z.number().int(), qty: z.number().nonnegative(), cost: z.number().nonnegative().optional() })).min(1),
});

const journalTypes = [
  'sale', 'return', 'production', 'writeoff', 'transfer', 'supply', 'inventory',
  'shift_open', 'shift_close', 'deposit', 'withdrawal',
] as const;

// Ожидаемая сумма наличных в смене: на начало + продажи − возвраты + внесения − изъятия
const expectedCash = (shift: string) => `(${shift}.opening_cash
  + coalesce((select sum(case when r.kind = 'sale' then r.cash_amount else -r.cash_amount end) from receipts r where r.shift_id = ${shift}.id), 0)
  + coalesce((select sum(case when o.kind = 'deposit' then o.amount else -o.amount end) from cash_ops o where o.shift_id = ${shift}.id), 0))`;

export async function documentRoutes(app: FastifyInstance) {
  // Складские документы. Кассир может работать только со своей точкой.
  app.post('/api/stock', { preHandler: anyUser }, async (req, reply) => {
    const b = stockBody.parse(req.body);
    if (req.user.role === 'cashier' && b.addressId !== req.user.addressId) {
      return reply.code(403).send({ error: 'Можно только для своей точки' });
    }
    if (b.kind === 'transfer' && (!b.toAddressId || b.toAddressId === b.addressId)) {
      return reply.code(400).send({ error: 'Укажите точку получателя' });
    }
    const docId = b.id ?? randomUUID();
    const productIds = b.items.map((i) => i.productId);
    const qtys = b.items.map((i) => i.qty);
    const costs = b.items.map((i) => i.cost ?? null);

    await tx(async (db) => {
      const exists = await db.query('select 1 from stock_movements where doc_id = $1 limit 1', [docId]);
      if (exists.rowCount) return;

      if (b.kind === 'inventory') {
        // Записываем разницу между фактом и учётным остатком
        await db.query(
          `with b as (${balancesAt('now()', 'array[$3::int]')})
           insert into stock_movements (doc_id, kind, address_id, product_id, qty, amount, cost, user_id, note)
           select $1, 'inventory', $3, p.id, d.diff, round(d.diff * p.price, 2), round(d.diff * p.cost, 2), $2, $4
           from (
             select i.product_id, i.qty - coalesce((select qty from b where b.product_id = i.product_id), 0) as diff
             from unnest($5::int[], $6::numeric[]) as i(product_id, qty)
           ) d join products p on p.id = d.product_id
           where d.diff <> 0`,
          [docId, req.user.id, b.addressId, b.note ?? null, productIds, qtys],
        );
        return;
      }

      const rows: [string, number][] =
        b.kind === 'transfer' ? [['transfer_out', b.addressId], ['transfer_in', b.toAddressId!]] : [[b.kind, b.addressId]];
      for (const [kind, addressId] of rows) {
        await db.query(
          `insert into stock_movements (doc_id, kind, address_id, product_id, qty, amount, cost, user_id, note, counterparty_id)
           select $1, $2, $3, p.id, i.qty, round(i.qty * p.price, 2), round(i.qty * coalesce(i.cost, p.cost), 2), $4, $5, $6
           from unnest($7::int[], $8::numeric[], $9::numeric[]) as i(product_id, qty, cost)
           join products p on p.id = i.product_id
           where i.qty > 0`,
          [docId, kind, addressId, req.user.id, b.note ?? null, b.counterpartyId ?? null, productIds, qtys, costs],
        );
      }
      // Закупочная цена из поступления становится себестоимостью товара
      if (b.kind === 'supply') {
        await db.query(
          `update products p set cost = i.cost from unnest($1::int[], $2::numeric[]) as i(product_id, cost)
           where p.id = i.product_id and i.cost is not null and p.kind <> 'product'`,
          [productIds, costs],
        );
      }
    });
    return { id: docId };
  });

  // Единый журнал: чеки, складские документы, смены и кассовые операции
  app.get('/api/journal', { preHandler: backOffice }, async (req) => {
    const q = periodQuery
      .extend({
        types: z.string().optional().transform((v) => (v ? v.split(',').filter((t) => (journalTypes as readonly string[]).includes(t)) : null)),
        users: z.string().optional().transform((v) => (v ? v.split(',').map(Number) : null)),
        limit: z.coerce.number().int().max(1000).default(300),
      })
      .parse(req.query);
    const period = (col: string) =>
      `${col} >= ($1::date)::timestamp at time zone $3 and ${col} < ($2::date + 1)::timestamp at time zone $3`;
    const addr = (col: string) => `($4::int[] is null or ${col} = any($4))`;
    return query(
      `select * from (
         select r.id::text as id, r.kind as type, r.number::text as number, r.created_at as at,
           a.name as address, u.name as "user", r.cashier_id as user_id, r.total as amount,
           case r.payment when 'card' then 'Безнал.' when 'cash' then 'Нал.' else 'Смешанная' end as note,
           r.fiscal_status as status
         from receipts r join addresses a on a.id = r.address_id join users u on u.id = r.cashier_id
         where ${period('r.created_at')} and ${addr('r.address_id')}
         union all
         select m.doc_id::text,
           case when bool_or(m.kind = 'transfer_out') then 'transfer' else min(m.kind) end,
           null, min(m.created_at),
           (select string_agg(a.name, ' → ' order by x.kind = 'transfer_in')
              from (select distinct address_id, kind from stock_movements where doc_id = m.doc_id) x
              join addresses a on a.id = x.address_id),
           min(u.name), min(m.user_id),
           case when bool_or(m.kind = 'supply') then sum(m.cost) else sum(m.amount) filter (where m.kind <> 'transfer_in') end,
           coalesce(min(cp.name), min(m.note)), null
         from stock_movements m
         left join users u on u.id = m.user_id
         left join counterparties cp on cp.id = m.counterparty_id
         where ${period('m.created_at')}
         group by m.doc_id
         having bool_or(${addr('m.address_id')})
         union all
         select sh.id::text, 'shift_open', null, sh.opened_at, a.name, u.name, sh.cashier_id, sh.opening_cash, null, null
         from shifts sh join addresses a on a.id = sh.address_id join users u on u.id = sh.cashier_id
         where ${period('sh.opened_at')} and ${addr('sh.address_id')}
         union all
         select sh.id::text, 'shift_close', null, sh.closed_at, a.name, u.name, sh.cashier_id, sh.closing_cash,
           'Расхождение: ' || round(sh.closing_cash - ${expectedCash('sh')}, 2), null
         from shifts sh join addresses a on a.id = sh.address_id join users u on u.id = sh.cashier_id
         where sh.closed_at is not null and ${period('sh.closed_at')} and ${addr('sh.address_id')}
         union all
         select o.id::text, o.kind, null, o.created_at, a.name, u.name, o.user_id, o.amount, o.note, null
         from cash_ops o join addresses a on a.id = o.address_id join users u on u.id = o.user_id
         where ${period('o.created_at')} and ${addr('o.address_id')}
       ) j
       where ($5::text[] is null or j.type = any($5)) and ($6::int[] is null or j.user_id = any($6))
       order by j.at desc
       limit $7`,
      [q.start, q.finish, config.timezone, q.addresses, q.types, q.users, q.limit],
    );
  });

  // Состав документа из журнала
  app.get('/api/journal/:type/:id', { preHandler: backOffice }, async (req, reply) => {
    const { type, id } = z.object({ type: z.enum(journalTypes), id: z.string().uuid() }).parse(req.params);
    if (type === 'sale' || type === 'return') {
      return query(
        `select name, price, qty, discount, amount from receipt_items where receipt_id = $1 order by id`,
        [id],
      );
    }
    if (type === 'shift_open' || type === 'shift_close') {
      const [s] = await query(
        `select sh.opening_cash as "openingCash", sh.closing_cash as "closingCash", ${expectedCash('sh')} as "expectedCash",
           (select count(*) from receipts r where r.shift_id = sh.id and r.kind = 'sale') as checks,
           (select coalesce(sum(case when r.kind = 'sale' then r.total else -r.total end), 0) from receipts r where r.shift_id = sh.id) as revenue,
           (select coalesce(sum(case when r.kind = 'sale' then r.card_amount else -r.card_amount end), 0) from receipts r where r.shift_id = sh.id) as card
         from shifts sh where sh.id = $1`,
        [id],
      );
      return s ?? reply.code(404).send({ error: 'Не найдено' });
    }
    if (type === 'deposit' || type === 'withdrawal') return [];
    return query(
      `select p.name, m.qty, m.amount, m.cost from stock_movements m join products p on p.id = m.product_id
       where m.doc_id = $1 and m.kind <> 'transfer_in' order by p.name`,
      [id],
    );
  });
}
