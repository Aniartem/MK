import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db.js';
import { anyUser, backOffice } from '../auth.js';

const idParam = z.object({ id: z.coerce.number().int() });

const addressBody = z.object({
  name: z.string().min(1),
  isWarehouse: z.boolean().default(false),
  active: z.boolean().default(true),
});

const categoryBody = z.object({
  name: z.string().min(1),
  color: z.string().default('#4a7bd6'),
  sort: z.number().int().default(0),
});

const productBody = z.object({
  name: z.string().min(1),
  categoryId: z.number().int().nullable(),
  price: z.number().nonnegative(),
  cost: z.number().nonnegative().default(0),
  unit: z.string().default('шт'),
  barcode: z.string().nullable().default(null),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
});

const userBody = z.object({
  name: z.string().min(1),
  role: z.enum(['owner', 'manager', 'cashier']),
  email: z.string().email().nullable().default(null),
  password: z.string().min(6).optional(),
  pin: z.string().regex(/^\d{4}$/, 'PIN — 4 цифры').optional(),
  active: z.boolean().default(true),
});

const productColumns = `id, name, category_id as "categoryId", price, cost, unit, barcode, active, sort`;
const userColumns = `id, name, role, email, active, pin_hash is not null as "hasPin"`;

// PIN определяет кассира, поэтому он должен быть уникальным
async function pinTaken(pin: string, exceptId?: number) {
  const rows = await query('select id, pin_hash from users where pin_hash is not null and id <> $1', [exceptId ?? 0]);
  for (const r of rows) if (await bcrypt.compare(pin, r.pin_hash)) return true;
  return false;
}

export async function manageRoutes(app: FastifyInstance) {
  // Адреса
  app.get('/api/addresses', { preHandler: anyUser }, async () =>
    query(`select id, name, is_warehouse as "isWarehouse", active from addresses order by is_warehouse desc, name`),
  );
  app.post('/api/addresses', { preHandler: backOffice }, async (req) => {
    const b = addressBody.parse(req.body);
    const [row] = await query('insert into addresses (name, is_warehouse, active) values ($1, $2, $3) returning id', [
      b.name, b.isWarehouse, b.active,
    ]);
    return row;
  });
  app.put('/api/addresses/:id', { preHandler: backOffice }, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = addressBody.parse(req.body);
    await query('update addresses set name = $2, is_warehouse = $3, active = $4 where id = $1', [id, b.name, b.isWarehouse, b.active]);
    return { ok: true };
  });

  // Категории
  app.get('/api/categories', { preHandler: anyUser }, async () =>
    query('select id, name, color, sort from categories order by sort, name'),
  );
  app.post('/api/categories', { preHandler: backOffice }, async (req) => {
    const b = categoryBody.parse(req.body);
    const [row] = await query('insert into categories (name, color, sort) values ($1, $2, $3) returning id', [b.name, b.color, b.sort]);
    return row;
  });
  app.put('/api/categories/:id', { preHandler: backOffice }, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = categoryBody.parse(req.body);
    await query('update categories set name = $2, color = $3, sort = $4 where id = $1', [id, b.name, b.color, b.sort]);
    return { ok: true };
  });
  app.delete('/api/categories/:id', { preHandler: backOffice }, async (req) => {
    const { id } = idParam.parse(req.params);
    await query('delete from categories where id = $1', [id]);
    return { ok: true };
  });

  // Номенклатура
  app.get('/api/products', { preHandler: anyUser }, async () =>
    query(`select ${productColumns} from products order by sort, name`),
  );
  app.post('/api/products', { preHandler: backOffice }, async (req) => {
    const b = productBody.parse(req.body);
    const [row] = await query(
      `insert into products (name, category_id, price, cost, unit, barcode, active, sort)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [b.name, b.categoryId, b.price, b.cost, b.unit, b.barcode, b.active, b.sort],
    );
    return row;
  });
  app.put('/api/products/:id', { preHandler: backOffice }, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = productBody.parse(req.body);
    await query(
      `update products set name = $2, category_id = $3, price = $4, cost = $5, unit = $6, barcode = $7, active = $8, sort = $9
       where id = $1`,
      [id, b.name, b.categoryId, b.price, b.cost, b.unit, b.barcode, b.active, b.sort],
    );
    return { ok: true };
  });

  // Сотрудники
  app.get('/api/users', { preHandler: backOffice }, async () => query(`select ${userColumns} from users order by role, name`));
  app.post('/api/users', { preHandler: backOffice }, async (req, reply) => {
    const b = userBody.parse(req.body);
    if (b.role === 'owner' && req.user.role !== 'owner') return reply.code(403).send({ error: 'Недостаточно прав' });
    if (b.pin && (await pinTaken(b.pin))) return reply.code(400).send({ error: 'Такой PIN уже занят' });
    const [row] = await query(
      `insert into users (name, role, email, password_hash, pin_hash, active) values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        b.name, b.role, b.email,
        b.password ? await bcrypt.hash(b.password, 10) : null,
        b.pin ? await bcrypt.hash(b.pin, 10) : null,
        b.active,
      ],
    );
    return row;
  });
  app.put('/api/users/:id', { preHandler: backOffice }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = userBody.parse(req.body);
    const [existing] = await query('select role from users where id = $1', [id]);
    if (!existing) return reply.code(404).send({ error: 'Не найден' });
    if ((b.role === 'owner' || existing.role === 'owner') && req.user.role !== 'owner') {
      return reply.code(403).send({ error: 'Недостаточно прав' });
    }
    if (b.pin && (await pinTaken(b.pin, id))) return reply.code(400).send({ error: 'Такой PIN уже занят' });
    await query(
      `update users set name = $2, role = $3, email = $4, active = $5,
         password_hash = coalesce($6, password_hash), pin_hash = coalesce($7, pin_hash)
       where id = $1`,
      [
        id, b.name, b.role, b.email, b.active,
        b.password ? await bcrypt.hash(b.password, 10) : null,
        b.pin ? await bcrypt.hash(b.pin, 10) : null,
      ],
    );
    return { ok: true };
  });

  // План продаж: по точке на каждый день
  app.get('/api/plans', { preHandler: backOffice }, async (req) => {
    const q = z.object({ start: z.string(), finish: z.string() }).parse(req.query);
    return query(
      `select address_id as "addressId", to_char(day, 'YYYY-MM-DD') as day, amount from sales_plans
       where day between $1 and $2 order by day`,
      [q.start, q.finish],
    );
  });
  app.put('/api/plans', { preHandler: backOffice }, async (req) => {
    const b = z.object({ addressId: z.number().int(), day: z.string(), amount: z.number().nonnegative() }).parse(req.body);
    await query(
      `insert into sales_plans (address_id, day, amount) values ($1, $2, $3)
       on conflict (address_id, day) do update set amount = excluded.amount`,
      [b.addressId, b.day, b.amount],
    );
    return { ok: true };
  });
}
