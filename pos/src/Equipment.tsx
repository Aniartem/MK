import { useState } from 'react';
import * as fiscal from './fiscal';
import type { AcquiringSettings } from './acquiring';
import { storage } from './store';

// Настройка ККТ и терминала на планшете. Доступна администратору и владельцу.
export function Equipment({ cashier, onClose }: { cashier: string; onClose: () => void }) {
  const [f, setF] = useState(storage.fiscalSettings());
  const [a, setA] = useState(storage.acquiringSettings());
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const config = storage.catalog().fiscal;

  const save = (next: fiscal.FiscalSettings) => {
    setF(next);
    storage.setFiscalSettings(next);
  };
  const saveA = (next: AcquiringSettings) => {
    setA(next);
    storage.setAcquiringSettings(next);
  };
  async function run(label: string, action: () => Promise<string | void>) {
    setBusy(true);
    setStatus(`${label}…`);
    try {
      setStatus(`✓ ${(await action()) || `${label}: готово`}`);
    } catch (e) {
      setStatus(`✗ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel modal equipment">
        <div className="modal-head">
          <h2>Оборудование</h2>
          <button onClick={onClose}>✕</button>
        </div>

        <h3>ККТ АТОЛ</h3>
        <div className="segmented">
          {([['none', 'Без ККТ'], ['atol-native', 'К планшету'], ['atol-web', 'Веб-сервер ДТО']] as const).map(([k, l]) => (
            <button key={k} className={f.driver === k ? 'active' : ''} onClick={() => save({ ...f, driver: k })}>{l}</button>
          ))}
        </div>
        {f.driver === 'none' && <p className="muted">Тестовый режим: чеки не печатаются и не уходят в ФНС. Для реальной торговли подключите ККТ.</p>}
        {f.driver === 'atol-native' && (
          <>
            <div className="segmented">
              {([['usb', 'USB'], ['bluetooth', 'Bluetooth'], ['tcp', 'Wi-Fi / сеть']] as const).map(([k, l]) => (
                <button key={k} className={f.port === k ? 'active' : ''} onClick={() => save({ ...f, port: k })}>{l}</button>
              ))}
            </div>
            {f.port !== 'usb' && (
              <input className="note" placeholder={f.port === 'tcp' ? 'IP-адрес ККТ, например 192.168.1.50:5555' : 'MAC-адрес ККТ, например 00:11:22:33:44:55'}
                value={f.address} onChange={(e) => save({ ...f, address: e.target.value.trim() })} />
            )}
          </>
        )}
        {f.driver === 'atol-web' && (
          <input className="note" placeholder="Адрес веб-сервера ДТО, например http://192.168.1.20:16732" value={f.webUrl}
            onChange={(e) => save({ ...f, webUrl: e.target.value.trim() })} />
        )}
        {f.driver !== 'none' && (
          <>
            <div className="muted">
              {config?.taxation
                ? `Чеки от: ${config.organization ?? '—'}, ИНН ${config.inn ?? '—'}, СНО ${taxationLabel[config.taxation] ?? config.taxation}, НДС ${vatLabel[config.vat]}`
                : 'Точка не привязана к организации — укажите её в кабинете (Настройки → Адреса), затем войдите на кассу заново.'}
            </div>
            <div className="row-buttons">
              <button className="big" disabled={busy} onClick={() => run('Проверка связи', () => fiscal.deviceInfo(f))}>Проверить связь</button>
              <button className="big" disabled={busy} onClick={() => run('X-отчёт', () => fiscal.reportX(f, cashier))}>X-отчёт</button>
            </div>
          </>
        )}

        <h3>Оплата картой</h3>
        <div className="segmented">
          <button className={a.mode === 'manual' ? 'active' : ''} onClick={() => saveA({ mode: 'manual' })}>Отдельный терминал</button>
          <button className={a.mode === 'sber' ? 'active' : ''} onClick={() => saveA({ mode: 'sber' })}>Интегрированный Сбербанк</button>
        </div>
        <p className="muted">
          {a.mode === 'manual'
            ? 'Кассир вводит сумму на терминале и подтверждает в кассе, что оплата прошла.'
            : 'Касса сама передаёт сумму на пин-пад Сбербанка. Требуется установленная библиотека интеграции Сбербанка.'}
        </p>
        {status && <div className={status.startsWith('✗') ? 'error' : status.startsWith('✓') ? 'ok-text' : 'muted'}>{status}</div>}
      </div>
    </div>
  );
}

const taxationLabel: Record<string, string> = {
  osn: 'ОСН', usnIncome: 'УСН доходы', usnIncomeOutcome: 'УСН доходы − расходы', esn: 'ЕСХН', patent: 'Патент',
};
const vatLabel: Record<string, string> = { none: 'не облагается', vat0: '0%', vat5: '5%', vat7: '7%', vat10: '10%', vat22: '22%' };
