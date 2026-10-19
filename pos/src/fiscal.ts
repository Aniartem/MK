// Фискализация чеков (54-ФЗ) на ККТ АТОЛ.
//
// Касса формирует JSON-задания в формате «Драйвера ККТ 10» АТОЛ и отправляет их одним из способов:
//  • atol-native — драйвер внутри Android-приложения (ККТ подключена к планшету по USB, Bluetooth или Wi-Fi);
//  • atol-web    — «Веб-сервер ДТО» АТОЛ в сети точки (HTTP API v2);
//  • none        — тестовый режим без ККТ: чеки только сохраняются.
import { registerPlugin } from '@capacitor/core';
import type { Product, Receipt } from './store';

export type Vat = 'none' | 'vat0' | 'vat5' | 'vat7' | 'vat10' | 'vat22';
export type FiscalConfig = { organization: string | null; inn: string | null; taxation: string; vat: Vat; placeAddress: string | null };
export type FiscalSettings = {
  driver: 'none' | 'atol-native' | 'atol-web';
  port: 'usb' | 'bluetooth' | 'tcp';
  // tcp: «IP:порт» ККТ, bluetooth: MAC-адрес
  address: string;
  webUrl: string;
};
export type FiscalResult = { number: number | null; sign: string | null; fnNumber: string | null; at: string | null };

export const defaultFiscalSettings: FiscalSettings = { driver: 'none', port: 'usb', address: '', webUrl: 'http://192.168.0.10:16732' };

const units: Record<string, string> = { шт: 'piece', кг: 'kilogram', г: 'gram', л: 'liter', мл: 'milliliter' };

const round = (n: number) => Math.round(n * 100) / 100;

// Задание на печать чека продажи или возврата
export function sellTask(receipt: Receipt, cashier: string, config: FiscalConfig, products: Product[]) {
  const items = receipt.items.map((i) => {
    const product = products.find((p) => p.id === i.productId);
    const amount = round(i.price * i.qty - i.discount);
    return {
      type: 'position',
      name: i.name,
      price: i.price,
      quantity: i.qty,
      amount,
      ...(i.discount > 0 ? { infoDiscountAmount: round(i.discount) } : {}),
      tax: { type: product?.vat ?? config.vat },
      paymentMethod: 'fullPayment',
      paymentObject: 'commodity',
      measurementUnit: units[product?.unit ?? 'шт'] ?? 'piece',
    };
  });
  const total = round(items.reduce((s, i) => s + i.amount, 0));
  const card = receipt.payment === 'card' ? total : receipt.payment === 'cash' ? 0 : Math.min(receipt.cardAmount, total);
  const payments = [
    ...(total - card > 0 ? [{ type: 'cash', sum: round(total - card) }] : []),
    ...(card > 0 ? [{ type: 'electronically', sum: round(card) }] : []),
  ];
  return {
    type: receipt.kind === 'return' ? 'sellReturn' : 'sell',
    taxationType: config.taxation,
    operator: { name: cashier },
    ...(config.placeAddress ? { paymentsPlace: config.placeAddress } : {}),
    items,
    payments,
    total,
  };
}

const operatorTask = (type: string, cashier: string) => ({ type, operator: { name: cashier } });

export function parseFiscalParams(result: any): FiscalResult {
  const p = result?.fiscalParams ?? {};
  return {
    number: p.fiscalDocumentNumber ?? null,
    sign: p.fiscalDocumentSign != null ? String(p.fiscalDocumentSign) : null,
    fnNumber: p.fnNumber ?? null,
    at: p.fiscalReceiptDateTime ?? null,
  };
}

// ——— Транспорты ———

interface AtolNativePlugin {
  configure(options: { port: string; address: string }): Promise<void>;
  process(options: { task: string }): Promise<{ result: string }>;
}
const AtolNative = registerPlugin<AtolNativePlugin>('Atol');

async function runNative(settings: FiscalSettings, task: object) {
  await AtolNative.configure({ port: settings.port, address: settings.address });
  const { result } = await AtolNative.process({ task: JSON.stringify(task) });
  return result ? JSON.parse(result) : {};
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Веб-сервер ДТО: задание ставится в очередь, результат забирается опросом
async function runWeb(settings: FiscalSettings, task: object, timeoutMs = 60000) {
  const base = settings.webUrl.replace(/\/$/, '');
  const uuid = crypto.randomUUID();
  const put = await fetch(`${base}/api/v2/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uuid, request: [task] }),
  }).catch(() => {
    throw new Error(`Веб-сервер ДТО недоступен по адресу ${base}. Проверьте, что компьютер с ККТ включён и в той же сети.`);
  });
  if (!put.ok) throw new Error(`Веб-сервер ДТО ответил ${put.status}`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(500);
    const res = await fetch(`${base}/api/v2/requests/${uuid}`);
    if (!res.ok) continue;
    const r = (await res.json()).results?.[0];
    if (!r || r.status === 'wait' || r.status === 'inProgress') continue;
    if (r.status === 'ready' && !r.errorCode) return r.result ?? {};
    throw new Error(r.errorDescription || `Ошибка ККТ (${r.status}, код ${r.errorCode})`);
  }
  throw new Error('ККТ не ответила за минуту');
}

export async function runTask(settings: FiscalSettings, task: object) {
  if (settings.driver === 'atol-native') return runNative(settings, task);
  if (settings.driver === 'atol-web') return runWeb(settings, task);
  throw new Error('ККТ не подключена');
}

// ——— Операции кассы ———

export const fiscalEnabled = (s: FiscalSettings) => s.driver !== 'none';

function requireConfig(config: FiscalConfig | null): FiscalConfig {
  if (!config?.taxation) throw new Error('Точка не привязана к организации — укажите её в кабинете: Настройки → Адреса');
  return config;
}

export async function printReceipt(settings: FiscalSettings, config: FiscalConfig | null, receipt: Receipt, cashier: string, products: Product[]) {
  const result = await runTask(settings, sellTask(receipt, cashier, requireConfig(config), products));
  return parseFiscalParams(result);
}

// Открывает смену на ККТ, если она ещё не открыта. Просроченную (больше 24 часов) нужно сначала закрыть.
export async function openShift(settings: FiscalSettings, cashier: string) {
  const status = await runTask(settings, { type: 'getShiftStatus' });
  const state = status?.shiftStatus?.state;
  if (state === 'opened') return;
  if (state === 'expired') throw new Error('Смена на ККТ длится больше 24 часов. Закройте её (Z-отчёт) и откройте заново.');
  await runTask(settings, operatorTask('openShift', cashier));
}

export async function closeShift(settings: FiscalSettings, cashier: string) {
  await runTask(settings, operatorTask('closeShift', cashier));
}

export async function reportX(settings: FiscalSettings, cashier: string) {
  await runTask(settings, operatorTask('reportX', cashier));
}

export async function deviceInfo(settings: FiscalSettings) {
  const r = await runTask(settings, { type: 'getDeviceInfo' });
  const d = r?.deviceInfo ?? {};
  return [d.modelName, d.serial && `№ ${d.serial}`, d.firmwareVersion && `прошивка ${d.firmwareVersion}`].filter(Boolean).join(', ') || 'ККТ на связи';
}
