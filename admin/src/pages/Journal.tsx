import { Fragment, useEffect, useState } from 'react';
import { api, qs } from '../api';
import { Page } from '../components';
import { dateTime, isoDay, money, qty } from '../format';

const kindLabel: Record<string, string> = { sale: 'Продажа', return: 'Возврат' };
const payLabel: Record<string, string> = { cash: 'Наличные', card: 'Карта', mixed: 'Смешанная' };

export default function Journal() {
  const [start, setStart] = useState(isoDay(new Date()));
  const [finish, setFinish] = useState(isoDay(new Date()));
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api(`/api/receipts?${qs({ start, finish, limit: 500 })}`).then(setRows);
  }, [start, finish]);

  return (
    <Page
      title="Журнал чеков"
      actions={
        <div className="daterange">
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <span>—</span>
          <input type="date" value={finish} onChange={(e) => setFinish(e.target.value)} />
        </div>
      }
    >
      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>№</th><th>Дата</th><th>Тип</th><th>Адрес</th><th>Кассир</th><th>Оплата</th><th>Сумма</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr className="clickable" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <td>{r.number}</td>
                  <td>{dateTime(r.createdAt)}</td>
                  <td className={r.kind === 'return' ? 'bad' : ''}>{kindLabel[r.kind]}</td>
                  <td>{r.address}</td>
                  <td>{r.cashier}</td>
                  <td>{payLabel[r.payment]}</td>
                  <td>{money(r.total)}</td>
                </tr>
                {open === r.id && (
                  <tr className="details">
                    <td colSpan={7}>
                      {r.items.map((i: any, n: number) => (
                        <div key={n}>
                          {i.name} — {qty(i.qty)} × {money(i.price)} = {money(i.amount)}
                        </div>
                      ))}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!rows.length && <tr><td colSpan={7} className="empty">Нет чеков за период</td></tr>}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
