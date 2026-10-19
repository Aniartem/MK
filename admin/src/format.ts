const num = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });

export const money = (v: number | null | undefined) => (v === null || v === undefined ? '-' : num.format(v));
export const qty = (v: number) => int.format(v);
export const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : `${v > 0 ? '+' : ''}${num.format(v)}%`;

// 53 774 -> «53,77 т.р.», 1 060 000 -> «1,06 млн.р.»
export function short(v: number) {
  if (Math.abs(v) >= 1e6) return `${num.format(v / 1e6)} млн.р.`;
  if (Math.abs(v) >= 1e3) return `${num.format(v / 1e3)} т.р.`;
  return `${num.format(v)} р.`;
}

export function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(day: string, n: number) {
  const d = new Date(day + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return isoDay(d);
}
export const dateTime = (s: string) =>
  new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
