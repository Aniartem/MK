import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { anyUser, backOffice } from '../auth.js';
import { config } from '../config.js';
import { periodQuery } from '../period.js';

const money = (n: number) => Math.round(n * 100) / 100;

// cashierId передаёт планшет: чеки из очереди могут уйти уже после смены кассира
const shiftBody = z.object({
  id: z.string().uuid(),
  cashierId: z.number().int().optional(),
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable().default(null),
  openingCash: z.number().nonnegative().default(0),
  closingCash: z.number().nonnegative().nullable().default(null),
});

const receiptBody = z.object({
  id: z.string().uuid(),
  cashierId: z.number().int().optional(),
  shiftId: z.string().uuid().nullable().default(null),
  kind: z.enum(['sale', 'return']),
  payment: z.enum(['cash', 'card', 'mixed']),
  cardAmount: z.number().nonnegative().default(0),
  createdAt: z.string().datetime(),
  items: z
    .array(
      z.object({
        productId: z.number().int().nullable(),
        name: z.string(),
        price: z.number().nonnegative(),
        qty: z.number().positive(),
        discount: z.number().nonnegative().default(0),
      }),
    )
    .min(1),
});

const syncBody = z.object({
  shifts: z.array(shiftBody).default([]),
  receipts: z.array(receiptBody).default([]),
});

const stockBody = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(['production', 'writeoff', 'transfer']),
  addressId: z.number().int(),
  toAddressId: z.number().int().optional(),
  note: z.string().optional(),
  items: z.array(z.object({ productId: z.number().int(), qty: z.number().positive() })).min(1),
});

export async function posRoutes(app: FastifyInstance) {
  app.get('/api/pos/catalog', { preHandler: anyUser }, async () => ({
    categories: await query('select id, name, color from categories order by sort, name'),
    products: await query(
      `select id, name, category_id as "categoryId", price, unit, barcode from products where active order by sort, name`,
    ),
  }));

  // Планшет копит смены и чеки локально и отправляет их пачкой, когда есть сеть.
  // Повторная отправка безопасна: записи с тем же id пропускаются.
  app.post('/api/pos/sync', { preHandler: anyUser }, async (req, reply) => {
    const addressId = req.user.addressId;
    if (!addressId) return reply.code(400).send({ error: 'Планшет не привязан к точке' });
    const body = syncBody.parse(req.body);
    const staff = new Set((await query<{ id: number }>('select id from users where active')).map((u) => u.id));
    const cashierOf = (x: { cashierId?: number }) => (x.cashierId && staff.has(x.cashierId) ? x.cashierId : req.user.id);

    return tx(async (db) => {
      for (const s of body.shifts) {
        await db.query(
          `insert into shifts (id, address_id, cashier_id, opened_at, closed_at, opening_cash, closing_cash)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (id) do update set
             closed_at = coalesce(excluded.closed_at, shifts.closed_at),
             closing_cash = coalesce(excluded.closing_cash, shifts.closing_cash)`,
          [s.id, addressId, cashierOf(s), s.openedAt, s.closedAt, s.openingCash, s.closingCash],
        );
      }

      const accepted: string[] = [];
      for (const r of body.receipts) {
        const items = r.items.map((i) => ({ ...i, amount: money(i.price * i.qty - i.discount) }));
        const total = money(items.reduce((s, i) => s + i.amount, 0));
        const discount = money(items.reduce((s, i) => s + i.discount, 0));
        const card = r.payment === 'card' ? total : r.payment === 'cash' ? 0 : Math.min(money(r.cardAmount), total);
        const inserted = await db.query(
          `insert into receipts (id, address_id, cashier_id, shift_id, kind, payment, cash_amount, card_amount, discount, total, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           on conflict (id) do nothing`,
          [r.id, addressId, cashierOf(r), r.shiftId, r.kind, r.payment, money(total - card), card, discount, total, r.createdAt],
        );
        if (inserted.rowCount) {
          await db.query(
            `insert into receipt_items (receipt_id, product_id, name, price, qty, discount, amount)
             select $1, * from unnest($2::int[], $3::text[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[])`,
            [
              r.id,
              items.map((i) => i.productId),
              items.map((i) => i.name),
              items.map((i) => i.price),
              items.map((i) => i.qty),
              items.map((i) => i.discount),
              items.map((i) => i.amount),
            ],
          );
        }
        accepted.push(r.id);
      }
      return { accepted };
    });
  });

  // Выпуск, списание и перемещение. Кассир может работать только со своей точкой.
  app.post('/api/stock', { preHandler: anyUser }, async (req, reply) => {
    const b = stockBody.parse(req.body);
    if (req.user.role === 'cashier' && b.addressId !== req.user.addressId) {
      return reply.code(403).send({ error: 'Можно только для своей точки' });
    }
    if (b.kind === 'transfer' && (!b.toAddressId || b.toAddressId === b.addressId)) {
      return reply.code(400).send({ error: 'Укажите точку получателя' });
    }
    const docId = b.id ?? randomUUID();
    await tx(async (db) => {
      const exists = await db.query('select 1 from stock_movements where doc_id = $1 limit 1', [docId]);
      if (exists.rowCount) return;
      const rows: [string, number][] =
        b.kind === 'transfer'
          ? [['transfer_out', b.addressId], ['transfer_in', b.toAddressId!]]
          : [[b.kind, b.addressId]];
      for (const [kind, addressId] of rows) {
        await db.query(
          `insert into stock_movements (doc_id, kind, address_id, product_id, qty, amount, user_id, note)
           select $1, $2, $3, p.id, i.qty, round(i.qty * p.price, 2), $4, $5
           from unnest($6::int[], $7::numeric[]) as i(product_id, qty)
           join products p on p.id = i.product_id`,
          [docId, kind, addressId, req.user.id, b.note ?? null, b.items.map((i) => i.productId), b.items.map((i) => i.qty)],
        );
      }
    });
    return { id: docId };
  });

  // Журнал документов: чеки и складские движения за период
  app.get('/api/receipts', { preHandler: backOffice }, async (req) => {
    const p = periodQuery.parse(req.query);
    const { limit, offset } = z
      .object({ limit: z.coerce.number().int().max(500).default(100), offset: z.coerce.number().int().default(0) })
      .parse(req.query);
    return query(
      `select r.id, r.number, r.kind, r.payment, r.total, r.discount, r.cash_amount as "cashAmount", r.card_amount as "cardAmount",
         r.created_at as "createdAt", r.fiscal_status as "fiscalStatus", a.name as address, u.name as cashier,
         (select json_agg(json_build_object('name', i.name, 'price', i.price, 'qty', i.qty, 'amount', i.amount) order by i.id)
            from receipt_items i where i.receipt_id = r.id) as items
       from receipts r
       join addresses a on a.id = r.address_id
       join users u on u.id = r.cashier_id
       where r.created_at >= ($1::date)::timestamp at time zone $3
         and r.created_at < ($2::date + 1)::timestamp at time zone $3
         and ($4::int[] is null or r.address_id = any($4))
       order by r.created_at desc
       limit $5 offset $6`,
      [p.start, p.finish, config.timezone, p.addresses, limit, offset],
    );
  });

  app.get('/api/stock', { preHandler: backOffice }, async (req) => {
    const p = periodQuery.parse(req.query);
    return query(
      `select m.doc_id as id,
         case when bool_or(m.kind = 'transfer_out') then 'transfer' else min(m.kind) end as kind, min(m.created_at) as "createdAt", min(m.note) as note,
         (select string_agg(a.name, ' → ' order by x.kind = 'transfer_in')
            from (select distinct address_id, kind from stock_movements where doc_id = m.doc_id) x
            join addresses a on a.id = x.address_id) as address, min(u.name) as "user",
         sum(m.amount) filter (where m.kind <> 'transfer_in') as amount,
         json_agg(json_build_object('name', p.name, 'qty', m.qty, 'amount', m.amount))
           filter (where m.kind <> 'transfer_in') as items
       from stock_movements m
       join products p on p.id = m.product_id
       left join users u on u.id = m.user_id
       where m.created_at >= ($1::date)::timestamp at time zone $3
         and m.created_at < ($2::date + 1)::timestamp at time zone $3
         and ($4::int[] is null or m.address_id = any($4))
       group by m.doc_id
       order by min(m.created_at) desc`,
      [p.start, p.finish, config.timezone, p.addresses],
    );
  });
}
