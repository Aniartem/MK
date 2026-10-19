import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db.js';
import { anyUser, backOffice } from '../auth.js';
import { config } from '../config.js';

const idParam = z.object({ id: z.coerce.number().int() });

const addressBody = z.object({
  name: z.string().min(1),
  city: z.string().nullable().default(null),
  fullAddress: z.string().nullable().default(null),
  organizationId: z.number().int().nullable().default(null),
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
  kind: z.enum(['goods', 'product', 'raw']).default('product'),
  vat: z.enum(['none', 'vat0', 'vat5', 'vat7', 'vat10', 'vat22']).nullable().default(null),
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
  tabNumber: z.string().nullable().default(null),
  addressIds: z.array(z.number().int()).default([]),
  active: z.boolean().default(true),
});

const productColumns = `id, name, category_id as "categoryId", price, cost, unit, kind, vat, barcode, active, sort`;

const counterpartyBody = z.object({
  name: z.string().min(1),
  inn: z.string().regex(/^(\d{10}|\d{12})$/, 'ИНН — 10 или 12 цифр').nullable().default(null),
  address: z.string().nullable().default(null),
  paymentDelay: z.number().int().nonnegative().nullable().default(null),
  note: z.string().nullable().default(null),
});

const time = z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null);
const promotionBody = z.object({
  name: z.string().min(1),
  percent: z.number().positive().max(100),
  mode: z.enum(['auto', 'manual']),
  categoryIds: z.array(z.number().int()).default([]),
  addressIds: z.array(z.number().int()).default([]),
  timeFrom: time,
  timeTo: time,
  description: z.string().nullable().default(null),
  active: z.boolean().default(true),
});
const userColumns = `id, name, role, email, active, pin_hash is not null as "hasPin", tab_number as "tabNumber",
  address_ids as "addressIds", last_seen_at as "lastSeenAt"`;

const organizationBody = z.object({
  name: z.string().min(1),
  inn: z.string().regex(/^(\d{10}|\d{12})$/, 'ИНН — 10 или 12 цифр').nullable().default(null),
  kpp: z.string().regex(/^\d{9}$/, 'КПП — 9 цифр').nullable().default(null),
  address: z.string().nullable().default(null),
  taxation: z.enum(['osn', 'usnIncome', 'usnIncomeOutcome', 'esn', 'patent']).default('usnIncome'),
  vat: z.enum(['none', 'vat0', 'vat5', 'vat7', 'vat10', 'vat22']).default('none'),
});

// PIN определяет кассира, поэтому он должен быть уникальным
async function pinTaken(pin: string, exceptId?: number) {
  const rows = await query('select id, pin_hash from users where pin_hash is not null and id <> $1', [exceptId ?? 0]);
  for (const r of rows) if (await bcrypt.compare(pin, r.pin_hash)) return true;
  return false;
}

export async function manageRoutes(app: FastifyInstance) {
  // Адреса
  app.get('/api/addresses', { preHandler: anyUser }, async () =>
    query(
      `select a.id, a.name, a.is_warehouse as "isWarehouse", a.active, a.city, a.full_address as "fullAddress",
         a.organization_id as "organizationId", o.name as organization
       from addresses a left join organizations o on o.id = a.organization_id
       order by a.is_warehouse desc, a.name`,
    ),
  );
  app.post('/api/addresses', { preHandler: backOffice }, async (req) => {
    const b = addressBody.parse(req.body);
    const [row] = await query(
      `insert into addresses (name, is_warehouse, active, city, full_address, organization_id)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [b.name, b.isWarehouse, b.active, b.city, b.fullAddress, b.organizationId],
    );
    return row;
  });
  app.put('/api/addresses/:id', { preHandler: backOffice }, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = addressBody.parse(req.body);
    await query(
      `update addresses set name = $2, is_warehouse = $3, active = $4, city = $5, full_address = $6, organization_id = $7 where id = $1`,
      [id, b.name, b.isWarehouse, b.active, b.city, b.fullAddress, b.organizationId],
    );
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
      `insert into products (name, category_id, price, cost, unit, barcode, active, sort, kind, vat)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [b.name, b.categoryId, b.price, b.cost, b.unit, b.barcode, b.active, b.sort, b.kind, b.vat],
    );
    return row;
  });
  app.put('/api/products/:id', { preHandler: backOffice }, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = productBody.parse(req.body);
    await query(
      `update products set name = $2, category_id = $3, price = $4, cost = $5, unit = $6, barcode = $7, active = $8, sort = $9,
         kind = $10, vat = $11
       where id = $1`,
      [id, b.name, b.categoryId, b.price, b.cost, b.unit, b.barcode, b.active, b.sort, b.kind, b.vat],
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
      `insert into users (name, role, email, password_hash, pin_hash, active, tab_number, address_ids)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [
        b.name, b.role, b.email,
        b.password ? await bcrypt.hash(b.password, 10) : null,
        b.pin ? await bcrypt.hash(b.pin, 10) : null,
        b.active, b.tabNumber, b.addressIds,
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
         password_hash = coalesce($6, password_hash), pin_hash = coalesce($7, pin_hash), tab_number = $8, address_ids = $9
       where id = $1`,
      [
        id, b.name, b.role, b.email, b.active,
        b.password ? await bcrypt.hash(b.password, 10) : null,
        b.pin ? await bcrypt.hash(b.pin, 10) : null,
        b.tabNumber, b.addressIds,
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

  // Контрагенты (поставщики)
  app.get('/api/counterparties', { preHandler: backOffice }, async () =>
    query(`select id, name, inn, address, payment_delay as "paymentDelay", note from counterparties order by name`),
  );
  app.post('/api/counterparties', { preHandler: backOffice }, async (req) => {
    const b = counterpartyBody.parse(req.body);
    const [row] = await query(
      `insert into counterparties (name, inn, address, payment_delay, note) values ($1, $2, $3, $4, $5) returning id`,
      [b.name, b.inn, b.address, b.paymentDelay, b.note],
    );
    return row;
  });
  app.put('/api/counterparties/:id', { preHandler: backOffice }, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = counterpartyBody.parse(req.body);
    await query(`update counterparties set name = $2, inn = $3, address = $4, payment_delay = $5, note = $6 where id = $1`, [
      id, b.name, b.inn, b.address, b.paymentDelay, b.note,
    ]);
    return { ok: true };
  });

  // Скидки и акции
  app.get('/api/promotions', { preHandler: backOffice }, async () =>
    query(
      `select id, name, percent, mode, category_ids as "categoryIds", address_ids as "addressIds",
         to_char(time_from, 'HH24:MI') as "timeFrom", to_char(time_to, 'HH24:MI') as "timeTo", description, active
       from promotions order by active desc, name`,
    ),
  );
  app.post('/api/promotions', { preHandler: backOffice }, async (req) => {
    const b = promotionBody.parse(req.body);
    const [row] = await query(
      `insert into promotions (name, percent, mode, category_ids, address_ids, time_from, time_to, description, active)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [b.name, b.percent, b.mode, b.categoryIds, b.addressIds, b.timeFrom, b.timeTo, b.description, b.active],
    );
    return row;
  });
  app.put('/api/promotions/:id', { preHandler: backOffice }, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = promotionBody.parse(req.body);
    await query(
      `update promotions set name = $2, percent = $3, mode = $4, category_ids = $5, address_ids = $6, time_from = $7,
         time_to = $8, description = $9, active = $10 where id = $1`,
      [id, b.name, b.percent, b.mode, b.categoryIds, b.addressIds, b.timeFrom, b.timeTo, b.description, b.active],
    );
    return { ok: true };
  });

  // Организации (юрлица и ИП)
  app.get('/api/organizations', { preHandler: backOffice }, async () =>
    query(`select id, name, inn, kpp, address, taxation, vat from organizations order by name`),
  );
  app.post('/api/organizations', { preHandler: backOffice }, async (req) => {
    const b = organizationBody.parse(req.body);
    const [row] = await query(
      `insert into organizations (name, inn, kpp, address, taxation, vat) values ($1, $2, $3, $4, $5, $6) returning id`,
      [b.name, b.inn, b.kpp, b.address, b.taxation, b.vat],
    );
    return row;
  });
  app.put('/api/organizations/:id', { preHandler: backOffice }, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = organizationBody.parse(req.body);
    await query(`update organizations set name = $2, inn = $3, kpp = $4, address = $5, taxation = $6, vat = $7 where id = $1`, [
      id, b.name, b.inn, b.kpp, b.address, b.taxation, b.vat,
    ]);
    return { ok: true };
  });

  // Планшеты-кассы: когда были на связи и сколько у них неотправленных чеков
  app.get('/api/devices', { preHandler: backOffice }, async () =>
    query(
      `select d.id, d.name, d.address_id as "addressId", a.name as address, u.name as "user", d.last_seen_at as "lastSeenAt",
         d.pending, d.created_at as "createdAt"
       from devices d left join addresses a on a.id = d.address_id left join users u on u.id = d.last_user_id
       order by d.last_seen_at desc`,
    ),
  );
  app.put('/api/devices/:id', { preHandler: backOffice }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ name: z.string().nullable() }).parse(req.body);
    await query('update devices set name = $2 where id = $1', [id, b.name]);
    return { ok: true };
  });
  app.delete('/api/devices/:id', { preHandler: backOffice }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await query('delete from devices where id = $1', [id]);
    return { ok: true };
  });

  app.get('/api/settings', { preHandler: backOffice }, async () => ({ timezone: config.timezone }));
}
