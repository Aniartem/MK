import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { buildApp } from './app.js';
import { migrate } from './migrate.js';
import { pool, query } from './db.js';

// Интеграционные тесты на отдельной базе (TEST_DATABASE_URL), каждый запуск начинается с чистой схемы
let app: Awaited<ReturnType<typeof buildApp>>;
let ownerToken: string;
let cashierToken: string;
let pointId: number;
let productId: number;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());

beforeAll(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate();
  await query(`insert into users (name, role, email, password_hash) values ('Владелец', 'owner', 'o@test', $1)`, [await bcrypt.hash('secret1', 4)]);
  await query(`insert into users (name, role, pin_hash) values ('Кассир', 'cashier', $1)`, [await bcrypt.hash('1234', 4)]);
  [{ id: pointId }] = await query(`insert into addresses (name) values ('Точка') returning id`);
  [{ id: productId }] = await query(`insert into products (name, price) values ('Круассан', 120) returning id`);
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('вход', () => {
  it('владелец входит по паролю', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'o@test', password: 'secret1' } });
    expect(res.statusCode).toBe(200);
    ownerToken = res.json().token;
  });
  it('неверный пароль отклоняется', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'o@test', password: 'nope' } });
    expect(res.statusCode).toBe(401);
  });
  it('кассир входит по PIN и не видит отчёты', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/pin', payload: { addressId: pointId, pin: '1234' } });
    expect(res.statusCode).toBe(200);
    cashierToken = res.json().token;
    const dash = await app.inject({
      url: `/api/dashboard?start=${today}&finish=${today}`,
      headers: { authorization: `Bearer ${cashierToken}` },
    });
    expect(dash.statusCode).toBe(403);
  });
});

describe('синхронизация чеков', () => {
  const shiftId = randomUUID();
  const sale = {
    id: randomUUID(),
    shiftId,
    kind: 'sale',
    payment: 'cash',
    createdAt: new Date().toISOString(),
    items: [{ productId: 0, name: 'Круассан', price: 120, qty: 3, discount: 0 }],
  };

  it('повторная отправка не создаёт дубль', async () => {
    sale.items[0].productId = productId;
    const payload = { shifts: [{ id: shiftId, openedAt: new Date().toISOString(), openingCash: 1000 }], receipts: [sale] };
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/pos/sync', headers: { authorization: `Bearer ${cashierToken}` }, payload });
      expect(res.statusCode).toBe(200);
      expect(res.json().accepted).toEqual([sale.id]);
    }
    const rows = await query('select total from receipts');
    expect(rows).toEqual([{ total: 360 }]);
  });

  it('сумму чека считает сервер, а не планшет', async () => {
    const id = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/api/pos/sync',
      headers: { authorization: `Bearer ${cashierToken}` },
      payload: { receipts: [{ ...sale, id, kind: 'return', items: [{ ...sale.items[0], qty: 1 }] }] },
    });
    const [r] = await query('select total, kind from receipts where id = $1', [id]);
    expect(r).toEqual({ total: 120, kind: 'return' });
  });

  it('рабочий стол учитывает возвраты и выпуск', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/stock',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { kind: 'production', addressId: pointId, items: [{ productId, qty: 10 }] },
    });
    const res = await app.inject({
      url: `/api/dashboard?start=${today}&finish=${today}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const d = res.json();
    expect(d.kpi).toMatchObject({ revenue: 240, returns: 120, checks: 1, avgCheck: 360, production: 1200 });
    const row = d.addresses.rows.find((r: any) => r.id === pointId);
    expect(row).toMatchObject({ revenue: 240, checks: 1, production: 1200, remainder: 960, sku: 1 });
    expect(d.series.reduce((s: number, x: any) => s + x.revenue, 0)).toBe(240);
  });

  it('кассир не может списать товар на чужой точке', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/stock',
      headers: { authorization: `Bearer ${cashierToken}` },
      payload: { kind: 'writeoff', addressId: pointId + 100, items: [{ productId, qty: 1 }] },
    });
    expect(res.statusCode).toBe(403);
  });
});
