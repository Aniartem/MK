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
