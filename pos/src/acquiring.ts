// Оплата картой через банковский терминал.
//
//  • manual — терминал работает отдельно: кассир вводит сумму на терминале и подтверждает в кассе, что оплата прошла.
//    Работает с любым терминалом, в том числе со Сбербанком, без интеграции.
//  • sber   — интегрированный пин-пад Сбербанка: касса сама передаёт сумму на терминал и получает результат.
//    Для работы нужна интеграционная библиотека Сбербанка (выдаётся банком по договору эквайринга),
//    подключённая в Android-приложение как плагин «SberAcquiring» (см. pos/android/app/libs/README.md).
import { registerPlugin } from '@capacitor/core';

export type AcquiringSettings = { mode: 'manual' | 'sber' };
export type CardResult = { rrn: string | null; mask: string | null };

export const defaultAcquiringSettings: AcquiringSettings = { mode: 'manual' };

interface SberPlugin {
  pay(options: { amount: number }): Promise<{ rrn?: string; cardMask?: string }>;
  refund(options: { amount: number; rrn: string | null }): Promise<{ rrn?: string; cardMask?: string }>;
}
const Sber = registerPlugin<SberPlugin>('SberAcquiring');

// Сумма в копейках — так её принимают терминалы
const kopecks = (rub: number) => Math.round(rub * 100);

export async function payByTerminal(amount: number, refundOf?: { rrn: string | null }): Promise<CardResult> {
  try {
    const r = refundOf ? await Sber.refund({ amount: kopecks(amount), rrn: refundOf.rrn }) : await Sber.pay({ amount: kopecks(amount) });
    return { rrn: r.rrn ?? null, mask: r.cardMask ?? null };
  } catch (e) {
    const message = (e as Error).message ?? '';
    if (/not implemented|not available|unimplemented/i.test(message)) {
      throw new Error('Интеграция с терминалом Сбербанка не установлена. Включите режим «Отдельный терминал» в настройках оборудования.');
    }
    throw new Error(message || 'Терминал отклонил операцию');
  }
}
