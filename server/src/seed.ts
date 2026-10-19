// Демо-данные: точки, ассортимент пекарни, сотрудники и ~10 недель продаж.
// Запуск: npm run seed -w server (база должна быть пустой)
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { pool, query } from './db.js';
import { migrate } from './migrate.js';
import { config } from './config.js';
import { todayIn, currentHourIn } from './period.js';

const DAYS = 70;

const catalog: [string, string, [string, number][]][] = [
  ['Хлеб', '#c08a4a', [['Батон нарезной', 65], ['Хлеб бородинский', 75], ['Багет французский', 90], ['Хлеб цельнозерновой', 110], ['Чиабатта', 95]]],
  ['Выпечка', '#e0a03a', [['Круассан', 120], ['Круассан с шоколадом', 145], ['Слойка с вишней', 95], ['Улитка с корицей', 110], ['Пирожок с капустой', 60], ['Пирожок с картофелем', 60], ['Сосиска в тесте', 85], ['Хачапури', 180]]],
  ['Десерты', '#d65a8a', [['Эклер', 130], ['Медовик (кусок)', 190], ['Наполеон (кусок)', 190], ['Чизкейк', 230], ['Маффин', 95]]],
  ['Напитки', '#4a7bd6', [['Американо', 140], ['Капучино', 180], ['Латте', 200], ['Чай', 90], ['Морс', 110]]],
];

// Доля продаж по часам: пекарня работает с 7 до 20, пики утром и в обед
const hourWeights: Record<number, number> = { 7: 1, 8: 7, 9: 11, 10: 9, 11: 15, 12: 10, 13: 9, 14: 8, 15: 10, 16: 8, 17: 9, 18: 8, 19: 5 };

function rnd(min: number, max: number) {
  return min + Math.random() * (max - min);
}
function pickHour() {
  const total = Object.values(hourWeights).reduce((a, b) => a + b, 0);
  let x = Math.random() * total;
  for (const [h, w] of Object.entries(hourWeights)) if ((x -= w) < 0) return Number(h);
  return 12;
}
function localDate(daysAgo: number) {
  return todayIn(config.timezone, -daysAgo);
}

async function main() {
  await migrate();
  const [{ count }] = await query('select count(*) from receipts');
  if (count > 0) throw new Error('В базе уже есть чеки — сид не нужен');

  const pw = await bcrypt.hash('admin123', 10);
  await query(`insert into users (name, role, email, password_hash, pin_hash) values ('Владелец', 'owner', 'admin@mk.local', $1, $2)`, [
    pw, await bcrypt.hash('0000', 10),
  ]);
  const cashiers: number[] = [];
  for (const [name, pin] of [['Анна', '1111'], ['Мария', '2222'], ['Ольга', '3333'], ['Ирина', '4444']]) {
    const [u] = await query(`insert into users (name, role, pin_hash) values ($1, 'cashier', $2) returning id`, [
      name, await bcrypt.hash(pin, 10),
    ]);
    cashiers.push(u.id);
  }

  await query(`insert into addresses (name, is_warehouse) values ('Основной склад', true)`);
  const points: { id: number; traffic: number }[] = [];
  for (const [name, traffic] of [['Пекарня 7 Подлесная 34а', 140], ['Пекарня ТЦ Восток, Ленина 144', 175], ['Родная пекарня Дзержинского, 59', 60]] as const) {
    const [a] = await query(`insert into addresses (name) values ($1) returning id`, [name]);
    points.push({ id: a.id, traffic });
  }

  const products: { id: number; name: string; price: number; drink: boolean }[] = [];
  let sort = 0;
  for (const [cat, color, items] of catalog) {
    const [c] = await query(`insert into categories (name, color, sort) values ($1, $2, $3) returning id`, [cat, color, sort++]);
    for (const [name, price] of items) {
      const [p] = await query(`insert into products (name, category_id, price, cost, sort) values ($1, $2, $3, $4, $5) returning id`, [
        name, c.id, price, Math.round(price * 0.35), sort++,
      ]);
      products.push({ id: p.id, name, price, drink: cat === 'Напитки' });
    }
  }

  const nowHour = currentHourIn(config.timezone);
  const receipts: any[][] = [];
  const items: any[][] = [];
  const moves: any[][] = [];
  for (let d = DAYS; d >= 0; d--) {
    const day = localDate(d);
    const weekday = new Date(day + 'T12:00:00Z').getUTCDay();
    const dayFactor = (weekday === 0 || weekday === 6 ? 1.2 : 1) * rnd(0.85, 1.15);
    for (const point of points) {
      const cashier = cashiers[(d + point.id) % cashiers.length];
      const n = Math.round(point.traffic * dayFactor);
      const produced = new Map<number, number>();
      for (let i = 0; i < n; i++) {
        const hour = pickHour();
        if (d === 0 && hour > nowHour) continue;
        const ts = `${day} ${String(hour).padStart(2, '0')}:${String(Math.floor(rnd(0, 60))).padStart(2, '0')}:${String(Math.floor(rnd(0, 60))).padStart(2, '0')}`;
        const id = randomUUID();
        const lines = new Map<number, number>();
        const count = Math.random() < 0.6 ? 1 : Math.random() < 0.7 ? 2 : 3;
        for (let j = 0; j < count; j++) {
          const p = products[Math.floor(Math.random() * products.length)];
          lines.set(p.id, (lines.get(p.id) ?? 0) + (p.drink || Math.random() < 0.8 ? 1 : 2));
        }
        const isReturn = Math.random() < 0.003;
        let total = 0;
        for (const [pid, qty] of lines) {
          const p = products.find((x) => x.id === pid)!;
          total += p.price * qty;
          items.push([id, pid, p.name, p.price, qty, p.price * qty]);
          if (!p.drink) produced.set(pid, (produced.get(pid) ?? 0) + qty);
        }
        const card = Math.random() < 0.7;
        receipts.push([id, point.id, cashier, isReturn ? 'return' : 'sale', card ? 'card' : 'cash', card ? 0 : total, card ? total : 0, total, ts]);
      }
      // Выпуск утром с запасом ~15%, вечером списание остатка (на сегодня — только выпуск)
      const docId = randomUUID();
      const lossId = randomUUID();
      for (const [pid, qty] of produced) {
        const p = products.find((x) => x.id === pid)!;
        const made = Math.ceil(qty * 1.15);
        moves.push([docId, 'production', point.id, pid, made, made * p.price, `${day} 06:30:00`]);
        if (d > 0 && made > qty) moves.push([lossId, 'writeoff', point.id, pid, made - qty, (made - qty) * p.price, `${day} 20:10:00`]);
      }
    }
  }

  const tz = config.timezone;
  for (let i = 0; i < receipts.length; i += 5000) {
    const chunk = receipts.slice(i, i + 5000);
    const col = (k: number) => chunk.map((r) => r[k]);
    await query(
      `insert into receipts (id, address_id, cashier_id, kind, payment, cash_amount, card_amount, total, created_at)
       select id, a, c, k, p, ca, cc, t, ts::timestamp at time zone $10
       from unnest($1::uuid[], $2::int[], $3::int[], $4::text[], $5::text[], $6::numeric[], $7::numeric[], $8::numeric[], $9::text[])
         as x(id, a, c, k, p, ca, cc, t, ts)`,
      [...[0, 1, 2, 3, 4, 5, 6, 7, 8].map(col), tz],
    );
  }
  for (let i = 0; i < items.length; i += 10000) {
    const chunk = items.slice(i, i + 10000);
    const col = (k: number) => chunk.map((r) => r[k]);
    await query(
      `insert into receipt_items (receipt_id, product_id, name, price, qty, amount)
       select * from unnest($1::uuid[], $2::int[], $3::text[], $4::numeric[], $5::numeric[], $6::numeric[])`,
      [0, 1, 2, 3, 4, 5].map(col),
    );
  }
  for (let i = 0; i < moves.length; i += 10000) {
    const chunk = moves.slice(i, i + 10000);
    const col = (k: number) => chunk.map((r) => r[k]);
    await query(
      `insert into stock_movements (doc_id, kind, address_id, product_id, qty, amount, created_at)
       select d, k, a, p, q, am, ts::timestamp at time zone $8
       from unnest($1::uuid[], $2::text[], $3::int[], $4::int[], $5::numeric[], $6::numeric[], $7::text[]) as x(d, k, a, p, q, am, ts)`,
      [...[0, 1, 2, 3, 4, 5, 6].map(col), tz],
    );
  }
  // План на текущий месяц: средняя выручка точки +5%
  await query(
    `insert into sales_plans (address_id, day, amount)
     select a.id, d::date, round(coalesce((select sum(total) / 28 from receipts r where r.address_id = a.id
       and r.created_at > now() - interval '28 days'), 0) * 1.05, -2)
     from addresses a, generate_series(date_trunc('month', $1::date), date_trunc('month', $1::date) + interval '1 month - 1 day', '1 day') d
     where not a.is_warehouse`,
    [localDate(0)],
  );
  console.log(`Готово: ${receipts.length} чеков, ${items.length} позиций, ${moves.length} движений`);
  console.log('Вход в кабинет: admin@mk.local / admin123; PIN кассиров: 1111, 2222, 3333, 4444');
}

main().finally(() => pool.end());
