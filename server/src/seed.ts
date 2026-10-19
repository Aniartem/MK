// Демо-данные: точки, ассортимент пекарни, поставщики, сотрудники и ~10 недель работы.
// Запуск: npm run seed -w server (в базе не должно быть чеков)
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { pool, query } from './db.js';
import { migrate } from './migrate.js';
import { config } from './config.js';
import { todayIn, currentHourIn } from './period.js';

const DAYS = 70;

type Kind = 'goods' | 'product' | 'raw';
const catalog: [string, string, Kind, [string, number, string?][]][] = [
  ['Хлеб', '#c08a4a', 'product', [['Батон нарезной', 65], ['Хлеб бородинский', 75], ['Багет французский', 90], ['Хлеб цельнозерновой', 110], ['Чиабатта', 95]]],
  ['Выпечка', '#e0a03a', 'product', [['Круассан', 120], ['Круассан с шоколадом', 145], ['Слойка с вишней', 95], ['Улитка с корицей', 110], ['Пирожок с капустой', 60], ['Пирожок с картофелем', 60], ['Сосиска в тесте', 85], ['Хачапури', 180]]],
  ['Десерты', '#d65a8a', 'product', [['Эклер', 130], ['Медовик (кусок)', 190], ['Наполеон (кусок)', 190], ['Чизкейк', 230], ['Маффин', 95]]],
  ['Напитки', '#4a7bd6', 'goods', [['Американо', 140], ['Капучино', 180], ['Латте', 200], ['Чай', 90], ['Морс 0,3', 110], ['Вода 0,5', 60]]],
  ['Сырьё', '#8a94a6', 'raw', [['Мука пшеничная', 0, 'кг'], ['Масло сливочное', 0, 'кг'], ['Сахар', 0, 'кг'], ['Зерно кофе', 0, 'кг']]],
];
const rawCost: Record<string, number> = { 'Мука пшеничная': 45, 'Масло сливочное': 780, 'Сахар': 70, 'Зерно кофе': 1450 };

// Доля продаж по часам: пекарня работает с 7 до 20, пики утром и в обед
const hourWeights: Record<number, number> = { 7: 1, 8: 7, 9: 11, 10: 9, 11: 15, 12: 10, 13: 9, 14: 8, 15: 10, 16: 8, 17: 9, 18: 8, 19: 5 };

const rnd = (min: number, max: number) => min + Math.random() * (max - min);
const pad = (n: number) => String(n).padStart(2, '0');
const money = (n: number) => Math.round(n * 100) / 100;
function pickHour() {
  const total = Object.values(hourWeights).reduce((a, b) => a + b, 0);
  let x = Math.random() * total;
  for (const [h, w] of Object.entries(hourWeights)) if ((x -= w) < 0) return Number(h);
  return 12;
}
const localDate = (daysAgo: number) => todayIn(config.timezone, -daysAgo);

async function insertRows(table: string, columns: string[], types: string[], rows: unknown[][], tsColumn?: number) {
  const tz = config.timezone;
  for (let i = 0; i < rows.length; i += 5000) {
    const chunk = rows.slice(i, i + 5000);
    const select = columns.map((c, k) => (k === tsColumn ? `c${k}::timestamp at time zone $${columns.length + 1}` : `c${k}`));
    await query(
      `insert into ${table} (${columns.join(', ')})
       select ${select.join(', ')} from unnest(${types.map((t, k) => `$${k + 1}::${t}[]`).join(', ')})
         as x(${columns.map((_, k) => `c${k}`).join(', ')})`,
      [...columns.map((_, k) => chunk.map((r) => r[k])), ...(tsColumn !== undefined ? [tz] : [])],
    );
  }
}

async function main() {
  await migrate();
  const [{ count }] = await query('select count(*) from receipts');
  if (count > 0) throw new Error('В базе уже есть чеки — сид не нужен');

  await query(`insert into users (name, role, email, password_hash, pin_hash) values ('Владелец', 'owner', 'admin@mk.local', $1, $2)`, [
    await bcrypt.hash('admin123', 10), await bcrypt.hash('0000', 10),
  ]);
  const cashiers: number[] = [];
  for (const [name, pin, tab] of [['Анна', '1111', '001'], ['Мария', '2222', '002'], ['Ольга', '3333', '003'], ['Ирина', '4444', '004']]) {
    const [u] = await query(`insert into users (name, role, pin_hash, tab_number) values ($1, 'cashier', $2, $3) returning id`, [
      name, await bcrypt.hash(pin, 10), tab,
    ]);
    cashiers.push(u.id);
  }

  const [org] = await query(`insert into organizations (name, inn, address) values ('ИП Демо Д. Д.', '183000000000', 'г. Ижевск') returning id`);
  const [warehouse] = await query(
    `insert into addresses (name, is_warehouse, city, full_address, organization_id) values ('Основной склад', true, 'Ижевск', 'г. Ижевск, ул. Ленина, 144 к2', $1) returning id`,
    [org.id],
  );
  const points: { id: number; traffic: number }[] = [];
  for (const [name, traffic, full] of [
    ['Пекарня 7 Подлесная 34а', 140, 'г. Ижевск, ул. 7-я Подлесная, 34а'],
    ['Пекарня ТЦ Восток, Ленина 144', 175, 'г. Ижевск, ул. Ленина, 144в'],
    ['Родная пекарня Дзержинского, 59', 60, 'г. Ижевск, ул. Дзержинского, 59'],
  ] as const) {
    const [a] = await query(`insert into addresses (name, city, full_address, organization_id) values ($1, 'Ижевск', $2, $3) returning id`, [
      name, full, org.id,
    ]);
    points.push({ id: a.id, traffic });
  }

  const suppliers: number[] = [];
  for (const [name, inn, address, delay] of [
    ['ООО «Молочный двор»', '1834100340', 'г. Ижевск, Воткинское шоссе, 178', null],
    ['ООО «Кофе Трейд»', '5836674347', 'г. Пенза, ул. Бекешская, 51А', 7],
    ['ИП Мельников А. В.', '183513339091', 'г. Ижевск', 14],
  ] as const) {
    const [c] = await query(`insert into counterparties (name, inn, address, payment_delay) values ($1, $2, $3, $4) returning id`, [name, inn, address, delay]);
    suppliers.push(c.id);
  }

  type P = { id: number; name: string; price: number; cost: number; kind: Kind; categoryId: number };
  const products: P[] = [];
  const categoryIds: Record<string, number> = {};
  let sort = 0;
  for (const [cat, color, kind, items] of catalog) {
    const [c] = await query(`insert into categories (name, color, sort) values ($1, $2, $3) returning id`, [cat, color, sort++]);
    categoryIds[cat] = c.id;
    for (const [name, price, unit] of items) {
      const cost = kind === 'raw' ? rawCost[name] : Math.round(price * (kind === 'goods' ? 0.45 : 0.35));
      const [p] = await query(
        `insert into products (name, category_id, price, cost, sort, kind, unit) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [name, c.id, price, cost, sort++, kind, unit ?? 'шт'],
      );
      products.push({ id: p.id, name, price, cost, kind, categoryId: c.id });
    }
  }
  const sellable = products.filter((p) => p.kind !== 'raw');
  const byId = new Map(products.map((p) => [p.id, p]));

  await query(
    `insert into promotions (name, percent, mode, category_ids, time_from, time_to, description) values
       ('Скидка 30% на выпечку после 19:00', 30, 'auto', $1, '19:00', '23:59', 'Распродажа свежей выпечки вечером'),
       ('Скидка студентам и пенсионерам 10%', 10, 'manual', '{}', null, null, 'По документу'),
       ('Скидка 40% на вчерашнюю продукцию', 40, 'manual', $2, null, null, null)`,
    [[categoryIds['Выпечка']], [categoryIds['Хлеб'], categoryIds['Выпечка']]],
  );

  const nowHour = currentHourIn(config.timezone);
  const shifts: unknown[][] = [];
  const receipts: unknown[][] = [];
  const items: unknown[][] = [];
  const moves: unknown[][] = [];
  const cashOps: unknown[][] = [];
  const move = (doc: string, kind: string, address: number, p: P, qty: number, ts: string, user: number | null, counterparty: number | null = null) =>
    moves.push([doc, kind, address, p.id, qty, money(qty * p.price), money(qty * p.cost), user, counterparty, ts]);

  for (let d = DAYS; d >= 0; d--) {
    const day = localDate(d);
    const weekday = new Date(day + 'T12:00:00Z').getUTCDay();
    const dayFactor = (weekday === 0 || weekday === 6 ? 1.2 : 1) * rnd(0.85, 1.15);

    // Раз в неделю — поступление напитков и сырья на склад
    if (weekday === 1 || d === DAYS) {
      const doc = randomUUID();
      for (const p of products.filter((x) => x.kind === 'goods')) move(doc, 'supply', warehouse.id, p, 240, `${day} 08:00:00`, null, suppliers[1]);
      const raw = randomUUID();
      for (const p of products.filter((x) => x.kind === 'raw')) move(raw, 'supply', warehouse.id, p, 50, `${day} 08:10:00`, null, suppliers[2]);
    }

    for (const point of points) {
      const cashier = cashiers[(d + point.id) % cashiers.length];
      const shiftId = randomUUID();
      const n = Math.round(point.traffic * dayFactor);
      const sold = new Map<number, number>();
      let cash = 0;
      for (let i = 0; i < n; i++) {
        const hour = pickHour();
        if (d === 0 && hour > nowHour) continue;
        const ts = `${day} ${pad(hour)}:${pad(Math.floor(rnd(0, 60)))}:${pad(Math.floor(rnd(0, 60)))}`;
        const id = randomUUID();
        const lines = new Map<number, number>();
        const count = Math.random() < 0.6 ? 1 : Math.random() < 0.7 ? 2 : 3;
        for (let j = 0; j < count; j++) {
          const p = sellable[Math.floor(Math.random() * sellable.length)];
          lines.set(p.id, (lines.get(p.id) ?? 0) + (p.kind === 'goods' || Math.random() < 0.8 ? 1 : 2));
        }
        const isReturn = Math.random() < 0.003;
        let total = 0;
        let discount = 0;
        for (const [pid, qty] of lines) {
          const p = byId.get(pid)!;
          const disc = hour >= 19 && p.categoryId === categoryIds['Выпечка'] ? money(p.price * qty * 0.3) : 0;
          total += p.price * qty - disc;
          discount += disc;
          items.push([id, pid, p.name, p.price, qty, disc, money(p.price * qty - disc), p.cost]);
          sold.set(pid, (sold.get(pid) ?? 0) + (isReturn ? -qty : qty));
        }
        const card = Math.random() < 0.7;
        if (!card) cash += isReturn ? -total : total;
        receipts.push([id, point.id, cashier, shiftId, isReturn ? 'return' : 'sale', card ? 'card' : 'cash', card ? 0 : total, card ? total : 0, money(discount), money(total), ts]);
      }

      // Утром — выпуск с запасом ~15% и перемещение напитков со склада, вечером — списание остатка
      const prodDoc = randomUUID();
      const transferDoc = randomUUID();
      const lossDoc = randomUUID();
      for (const [pid, qty] of sold) {
        const p = byId.get(pid)!;
        const need = Math.ceil(Math.max(qty, 0) * 1.15);
        if (!need) continue;
        if (p.kind === 'product') {
          move(prodDoc, 'production', point.id, p, need, `${day} 06:30:00`, cashier);
          if (d > 0 && need > qty) move(lossDoc, 'writeoff', point.id, p, need - qty, `${day} 20:10:00`, cashier);
        } else {
          move(transferDoc, 'transfer_out', warehouse.id, p, need, `${day} 06:45:00`, null);
          move(transferDoc, 'transfer_in', point.id, p, need, `${day} 06:45:00`, null);
        }
      }

      // Смена: открытие с 3000 ₽, вечером изъятие выручки и закрытие с небольшим расхождением
      const opening = 3000;
      const closed = d > 0;
      if (closed) {
        const withdrawal = Math.max(Math.round((cash - 500) / 100) * 100, 0);
        if (withdrawal > 0) cashOps.push([randomUUID(), shiftId, point.id, cashier, 'withdrawal', withdrawal, 'Инкассация', `${day} 20:14:00`]);
        const discrepancy = Math.random() < 0.8 ? 0 : Math.round(rnd(-50, 30));
        shifts.push([shiftId, point.id, cashier, `${day} 06:55:00`, `${day} 20:15:00`, opening, money(opening + cash - withdrawal + discrepancy)]);
      } else {
        shifts.push([shiftId, point.id, cashier, `${day} 06:55:00`, null, opening, null]);
      }
    }
  }

  // у смен две метки времени — вставляем отдельным запросом
  for (let i = 0; i < shifts.length; i += 5000) {
    const chunk = shifts.slice(i, i + 5000);
    await query(
      `insert into shifts (id, address_id, cashier_id, opened_at, closed_at, opening_cash, closing_cash)
       select id, a, c, o::timestamp at time zone $8, cl::timestamp at time zone $8, oc, cc
       from unnest($1::uuid[], $2::int[], $3::int[], $4::text[], $5::text[], $6::numeric[], $7::numeric[]) as x(id, a, c, o, cl, oc, cc)`,
      [...[0, 1, 2, 3, 4, 5, 6].map((k) => chunk.map((r) => r[k])), config.timezone],
    );
  }
  await insertRows('receipts', ['id', 'address_id', 'cashier_id', 'shift_id', 'kind', 'payment', 'cash_amount', 'card_amount', 'discount', 'total', 'created_at'],
    ['uuid', 'int', 'int', 'uuid', 'text', 'text', 'numeric', 'numeric', 'numeric', 'numeric', 'text'], receipts, 10);
  await insertRows('receipt_items', ['receipt_id', 'product_id', 'name', 'price', 'qty', 'discount', 'amount', 'cost'],
    ['uuid', 'int', 'text', 'numeric', 'numeric', 'numeric', 'numeric', 'numeric'], items);
  await insertRows('stock_movements', ['doc_id', 'kind', 'address_id', 'product_id', 'qty', 'amount', 'cost', 'user_id', 'counterparty_id', 'created_at'],
    ['uuid', 'text', 'int', 'int', 'numeric', 'numeric', 'numeric', 'int', 'int', 'text'], moves, 9);
  await insertRows('cash_ops', ['id', 'shift_id', 'address_id', 'user_id', 'kind', 'amount', 'note', 'created_at'],
    ['uuid', 'uuid', 'int', 'int', 'text', 'numeric', 'text', 'text'], cashOps, 7);

  // Демо-чеки пробиты без ККТ
  await query(`update receipts set fiscal_status = 'skipped'`);

  // План продаж на текущий месяц: средняя выручка точки +5%
  await query(
    `insert into sales_plans (address_id, day, amount)
     select a.id, d::date, round(coalesce((select sum(total) / 28 from receipts r where r.address_id = a.id
       and r.created_at > now() - interval '28 days'), 0) * 1.05, -2)
     from addresses a, generate_series(date_trunc('month', $1::date), date_trunc('month', $1::date) + interval '1 month - 1 day', '1 day') d
     where not a.is_warehouse`,
    [localDate(0)],
  );

  // Бюджет: аренда, зарплата, коммуналка — план и факт по месяцам
  const months = [...new Set([localDate(DAYS), localDate(35), localDate(0)].map((d) => d.slice(0, 7)))];
  for (const month of months) {
    for (const point of points) {
      const rent = point.traffic > 150 ? 120000 : point.traffic > 100 ? 80000 : 45000;
      const salary = point.traffic > 100 ? 140000 : 90000;
      for (const [article, amount, day] of [['Аренда', rent, '05'], ['Зарплата', salary, '15'], ['Коммунальные услуги', Math.round(rent * 0.15), '20']] as const) {
        await query(
          `insert into budget_ops (day, kind, article, amount, address_id, planned) values ($1, 'expense', $2, $3, $4, true)`,
          [`${month}-${day}`, article, amount, point.id],
        );
        if (`${month}-${day}` <= localDate(0)) {
          await query(
            `insert into budget_ops (day, kind, article, amount, address_id) values ($1, 'expense', $2, $3, $4)`,
            [`${month}-${day}`, article, Math.round(amount * rnd(0.95, 1.05)), point.id],
          );
        }
      }
    }
    await query(
      `insert into budget_ops (day, kind, article, amount, counterparty_id) values ($1, 'expense', 'Закупка сырья и товаров', $2, $3)`,
      [`${month}-03`, 180000, suppliers[1]],
    );
  }

  console.log(`Готово: ${receipts.length} чеков, ${items.length} позиций, ${moves.length} движений, ${shifts.length} смен`);
  console.log('Вход в кабинет: admin@mk.local / admin123; PIN кассиров: 1111, 2222, 3333, 4444');
}

main().finally(() => pool.end());
