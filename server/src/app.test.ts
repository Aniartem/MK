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
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Samara' }).format(new Date());

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

describe('доступ к точкам', () => {
  it('кассир с ограничением не входит на чужой точке, а планшет регистрируется', async () => {
    const [{ id: other }] = await query(`insert into addresses (name) values ('Другая точка') returning id`);
    await query(`insert into users (name, role, pin_hash, address_ids) values ('Ограниченный', 'cashier', $1, $2)`, [
      await bcrypt.hash('5555', 4), [pointId],
    ]);
    const denied = await app.inject({ method: 'POST', url: '/api/auth/pin', payload: { addressId: other, pin: '5555' } });
    expect(denied.statusCode).toBe(403);
    const deviceId = randomUUID();
    const ok = await app.inject({ method: 'POST', url: '/api/auth/pin', payload: { addressId: pointId, pin: '5555', deviceId } });
    expect(ok.statusCode).toBe(200);
    const [d] = await query('select address_id from devices where id = $1', [deviceId]);
    expect(d.address_id).toBe(pointId);
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

describe('склад и касса', () => {
  const auth = () => ({ authorization: `Bearer ${ownerToken}` });

  it('поступление обновляет себестоимость товара', async () => {
    const [{ id }] = await query(`insert into products (name, price, cost, kind) values ('Вода', 60, 20, 'goods') returning id`);
    const res = await app.inject({
      method: 'POST', url: '/api/stock', headers: auth(),
      payload: { kind: 'supply', addressId: pointId, items: [{ productId: id, qty: 24, cost: 25 }] },
    });
    expect(res.statusCode).toBe(200);
    const [p] = await query('select cost from products where id = $1', [id]);
    expect(p.cost).toBe(25);
    const [m] = await query(`select qty, cost from stock_movements where kind = 'supply' and product_id = $1`, [id]);
    expect(m).toEqual({ qty: 24, cost: 600 });
  });

  it('инвентаризация записывает разницу с учётным остатком', async () => {
    // по круассанам: выпуск 10, продано 3, возврат 1 → учёт 8; по факту 6
    const res = await app.inject({
      method: 'POST', url: '/api/stock', headers: auth(),
      payload: { kind: 'inventory', addressId: pointId, items: [{ productId, qty: 6 }] },
    });
    expect(res.statusCode).toBe(200);
    const [m] = await query(`select qty, amount from stock_movements where kind = 'inventory' and product_id = $1`, [productId]);
    expect(m).toEqual({ qty: -2, amount: -240 });
    const stock = await app.inject({ url: `/api/reports/stock?day=${today}`, headers: auth() });
    expect(stock.json().find((r: any) => r.id === productId).qty).toBe(6);
  });

  it('расхождение кассы учитывает изъятия', async () => {
    const shiftId = randomUUID();
    const opened = new Date().toISOString();
    const sync = (payload: object) =>
      app.inject({ method: 'POST', url: '/api/pos/sync', headers: { authorization: `Bearer ${cashierToken}` }, payload });
    await sync({
      shifts: [{ id: shiftId, openedAt: opened, openingCash: 1000 }],
      receipts: [{ id: randomUUID(), shiftId, kind: 'sale', payment: 'cash', createdAt: opened, items: [{ productId, name: 'Круассан', price: 120, qty: 5 }] }],
      cashOps: [{ id: randomUUID(), shiftId, kind: 'withdrawal', amount: 500, createdAt: opened }],
    });
    // ожидается 1000 + 600 − 500 = 1100, в кассе 1090
    await sync({ shifts: [{ id: shiftId, openedAt: opened, closedAt: new Date().toISOString(), openingCash: 1000, closingCash: 1090 }] });
    const res = await app.inject({ url: `/api/reports/employees?start=${today}&finish=${today}`, headers: auth() });
    expect(res.json()[0]).toMatchObject({ name: 'Кассир', shifts: 1, discrepancy: -10 });

    const journal = await app.inject({ url: `/api/journal?start=${today}&finish=${today}&types=shift_close,withdrawal`, headers: auth() });
    expect(journal.json().map((j: any) => j.type).sort()).toEqual(['shift_close', 'withdrawal']);
    const details = await app.inject({ url: `/api/journal/shift_close/${shiftId}`, headers: auth() });
    expect(details.json()).toMatchObject({ expectedCash: 1100, closingCash: 1090, checks: 1 });
  });

  it('ABC делит товары на группы', async () => {
    const res = await app.inject({ url: `/api/reports/abc?start=${today}&finish=${today}`, headers: auth() });
    const { rows, matrix } = res.json();
    expect(rows[0]).toMatchObject({ name: 'Круассан', revenueGroup: 'A' });
    expect(Object.values(matrix).flatMap((r: any) => Object.values(r)).reduce((a: number, b: any) => a + b, 0)).toBe(rows.length);
  });
});

describe('фискализация', () => {
  it('чек, допечатанный позже, обновляется без дублей позиций', async () => {
    const id = randomUUID();
    const base = {
      id, kind: 'sale', payment: 'card', createdAt: new Date().toISOString(),
      items: [{ productId, name: 'Круассан', price: 120, qty: 1 }], card: { rrn: '123456789012', mask: '**** 4242' },
    };
    const send = (fiscal: object) =>
      app.inject({
        method: 'POST', url: '/api/pos/sync', headers: { authorization: `Bearer ${cashierToken}` },
        payload: { receipts: [{ ...base, fiscal }] },
      });
    await send({ status: 'error', error: 'Нет связи с ККТ' });
    let [r] = await query('select fiscal_status, fiscal_error, card_rrn from receipts where id = $1', [id]);
    expect(r).toEqual({ fiscal_status: 'error', fiscal_error: 'Нет связи с ККТ', card_rrn: '123456789012' });

    await send({ status: 'done', number: 77, sign: '3291745218', fnNumber: '7380440700000001', at: '2026-10-19T13:00:00+04:00' });
    [r] = await query('select fiscal_status, fiscal_number, fiscal_sign, fiscal_error from receipts where id = $1', [id]);
    expect(r).toEqual({ fiscal_status: 'done', fiscal_number: 77, fiscal_sign: '3291745218', fiscal_error: null });

    // напечатанный чек уже не перезаписывается
    await send({ status: 'error', error: 'повтор' });
    [r] = await query('select fiscal_status from receipts where id = $1', [id]);
    expect(r.fiscal_status).toBe('done');
    const items = await query('select count(*) from receipt_items where receipt_id = $1', [id]);
    expect(items[0].count).toBe(1);
  });
});

