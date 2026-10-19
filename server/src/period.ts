import { z } from 'zod';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const periodQuery = z.object({
  start: day,
  finish: day,
  // "1,2,3" или пусто — все адреса
  addresses: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0) : null)),
});

export type Period = z.infer<typeof periodQuery>;

export function todayIn(tz: string, shiftDays = 0): string {
  const d = new Date(Date.now() + shiftDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
}

export function currentHourIn(tz: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
}

// Фрагменты SQL. Соглашение о параметрах: $1 начало, $2 конец (локальные даты), $3 часовой пояс, $4 адреса (int[] или null)
export const inPeriod = (col: string) =>
  `${col} >= ($1::date)::timestamp at time zone $3 and ${col} < ($2::date + 1)::timestamp at time zone $3`;
export const byAddress = (col: string) => `($4::int[] is null or ${col} = any($4))`;
// +1 для продажи, -1 для возврата
export const sign = `(case when r.kind = 'sale' then 1 else -1 end)`;

// Остаток товара по адресам на момент времени (параметр-выражение `at` — timestamptz)
export function balancesAt(at: string, addresses: string) {
  return `
    select address_id, product_id, sum(q) as qty from (
      select address_id, product_id, case when kind in ('writeoff', 'transfer_out') then -qty else qty end as q
      from stock_movements where created_at < ${at} and (${addresses}::int[] is null or address_id = any(${addresses}))
      union all
      select r.address_id, i.product_id, case when r.kind = 'sale' then -i.qty else i.qty end
      from receipt_items i join receipts r on r.id = i.receipt_id
      where i.product_id is not null and r.created_at < ${at} and (${addresses}::int[] is null or r.address_id = any(${addresses}))
    ) t group by 1, 2`;
}

function shiftDate(day: string, by: 'day' | 'week' | 'month' | 'year', dir: number) {
  const d = new Date(day + 'T00:00:00Z');
  if (by === 'day') d.setUTCDate(d.getUTCDate() - dir);
  if (by === 'week') d.setUTCDate(d.getUTCDate() - 7 * dir);
  if (by === 'month') d.setUTCMonth(d.getUTCMonth() - dir);
  if (by === 'year') d.setUTCFullYear(d.getUTCFullYear() - dir);
  return d.toISOString().slice(0, 10);
}
export const comparePeriod = (start: string, finish: string, by: 'day' | 'week' | 'month' | 'year') => ({
  start: shiftDate(start, by, 1),
  finish: shiftDate(finish, by, 1),
  // перевод даты прошлого периода в дату текущего — чтобы сопоставить строки «по дням»
  forward: (day: string) => shiftDate(day, by, -1),
});
