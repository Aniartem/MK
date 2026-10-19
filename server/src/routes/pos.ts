import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { anyUser } from '../auth.js';

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

const cashOpBody = z.object({
  id: z.string().uuid(),
  cashierId: z.number().int().optional(),
  shiftId: z.string().uuid().nullable().default(null),
  kind: z.enum(['deposit', 'withdrawal']),
  amount: z.number().positive(),
  note: z.string().nullable().default(null),
  createdAt: z.string().datetime(),
});

const syncBody = z.object({
  shifts: z.array(shiftBody).default([]),
  receipts: z.array(receiptBody).default([]),
  cashOps: z.array(cashOpBody).default([]),
});

export async function posRoutes(app: FastifyInstance) {
  app.get('/api/pos/catalog', { preHandler: anyUser }, async (req) => ({
    categories: await query('select id, name, color from categories order by sort, name'),
    products: await query(
      `select id, name, category_id as "categoryId", price, unit, barcode
       from products where active and kind <> 'raw' order by sort, name`,
    ),
    promotions: await query(
      `select id, name, percent, mode, category_ids as "categoryIds",
         to_char(time_from, 'HH24:MI') as "timeFrom", to_char(time_to, 'HH24:MI') as "timeTo"
       from promotions
       where active and (address_ids = '{}' or $1::int = any(address_ids))
       order by mode, name`,
      [req.user.addressId ?? 0],
    ),
  }));

  // Планшет копит смены, чеки и кассовые операции локально и отправляет их пачкой, когда есть сеть.
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
          // себестоимость фиксируем на момент продажи
          await db.query(
            `insert into receipt_items (receipt_id, product_id, name, price, qty, discount, amount, cost)
             select $1, i.product_id, i.name, i.price, i.qty, i.discount, i.amount, coalesce(p.cost, 0)
             from unnest($2::int[], $3::text[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[])
               as i(product_id, name, price, qty, discount, amount)
             left join products p on p.id = i.product_id`,
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

      const acceptedCashOps: string[] = [];
      for (const o of body.cashOps) {
        await db.query(
          `insert into cash_ops (id, shift_id, address_id, user_id, kind, amount, note, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do nothing`,
          [o.id, o.shiftId, addressId, cashierOf(o), o.kind, money(o.amount), o.note, o.createdAt],
        );
        acceptedCashOps.push(o.id);
      }
      return { accepted, acceptedCashOps };
    });
  });
}
