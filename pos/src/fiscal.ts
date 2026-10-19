// Фискализация чеков (54-ФЗ). Касса передаёт каждый чек фискальному регистратору,
// который печатает его и отправляет в ОФД.
//
// Сейчас подключена заглушка: чек только сохраняется. Для боевой работы сюда подключается
// драйвер ККТ: АТОЛ (Android-драйвер ДТО 10) или Штрих-М через Capacitor-плагин,
// либо облачная касса (АТОЛ Онлайн, OrangeData) через сервер.
import type { Receipt } from './store';

export interface FiscalPrinter {
  name: string;
  printReceipt(receipt: Receipt, cashier: string): Promise<void>;
  openShift(cashier: string): Promise<void>;
  closeShift(cashier: string): Promise<void>;
}

const noop: FiscalPrinter = {
  name: 'Без ККТ (тестовый режим)',
  async printReceipt() {},
  async openShift() {},
  async closeShift() {},
};

export const fiscal: FiscalPrinter = noop;
