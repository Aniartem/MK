import { describe, expect, it } from 'vitest';
import { parseFiscalParams, sellTask, type FiscalConfig } from './fiscal';
import type { Product, Receipt } from './store';

const config: FiscalConfig = { organization: 'ИП Тест', inn: '183000000000', taxation: 'usnIncome', vat: 'none', placeAddress: 'г. Ижевск' };
const products: Product[] = [
  { id: 1, name: 'Круассан', categoryId: 1, price: 120, unit: 'шт', barcode: null },
  { id: 2, name: 'Сыр', categoryId: 2, price: 900, unit: 'кг', barcode: null, vat: 'vat10' },
];
const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  id: 'r1', cashierId: 1, shiftId: null, kind: 'sale', payment: 'cash', cardAmount: 0, createdAt: '2026-10-19T10:00:00Z',
  items: [
    { productId: 1, name: 'Круассан', price: 120, qty: 2, discount: 24 },
    { productId: 2, name: 'Сыр', price: 900, qty: 0.25, discount: 0 },
  ],
  ...over,
});

describe('задание АТОЛ на чек', () => {
  it('позиции, скидка, единицы и НДС', () => {
    const t = sellTask(receipt(), 'Анна', config, products);
    expect(t).toMatchObject({ type: 'sell', taxationType: 'usnIncome', operator: { name: 'Анна' }, paymentsPlace: 'г. Ижевск', total: 441 });
    expect(t.items[0]).toEqual({
      type: 'position', name: 'Круассан', price: 120, quantity: 2, amount: 216, infoDiscountAmount: 24,
      tax: { type: 'none' }, paymentMethod: 'fullPayment', paymentObject: 'commodity', measurementUnit: 'piece',
    });
    // у товара своя ставка НДС и весовая единица
    expect(t.items[1]).toMatchObject({ amount: 225, tax: { type: 'vat10' }, measurementUnit: 'kilogram' });
    expect(t.payments).toEqual([{ type: 'cash', sum: 441 }]);
  });

  it('возврат по карте', () => {
    const t = sellTask(receipt({ kind: 'return', payment: 'card' }), 'Анна', config, products);
    expect(t.type).toBe('sellReturn');
    expect(t.payments).toEqual([{ type: 'electronically', sum: 441 }]);
  });

  it('разбор фискальных реквизитов', () => {
    const r = parseFiscalParams({ fiscalParams: { fiscalDocumentNumber: 42, fiscalDocumentSign: 3291745218, fnNumber: '7380440700000001', fiscalReceiptDateTime: '2026-10-19T13:00:00+04:00' } });
    expect(r).toEqual({ number: 42, sign: '3291745218', fnNumber: '7380440700000001', at: '2026-10-19T13:00:00+04:00' });
  });
});
