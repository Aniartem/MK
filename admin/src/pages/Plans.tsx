import { useEffect, useState } from 'react';
import { api, qs } from '../api';
import { Page } from '../components';
import { addDays, isoDay } from '../format';

export default function Plans() {
  const [month, setMonth] = useState(isoDay(new Date()).slice(0, 7));
  const [addresses, setAddresses] = useState<{ id: number; name: string; isWarehouse: boolean }[]>([]);
  const [plans, setPlans] = useState<Record<string, number>>({});

  const start = `${month}-01`;
  const finish = addDays(isoDay(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)), -1);
  const days: string[] = [];
  for (let d = start; d <= finish; d = addDays(d, 1)) days.push(d);

  useEffect(() => {
    api('/api/addresses').then((a) => setAddresses(a.filter((x: any) => !x.isWarehouse)));
  }, []);
  useEffect(() => {
    api(`/api/plans?${qs({ start, finish })}`).then((rows: any[]) =>
      setPlans(Object.fromEntries(rows.map((r) => [`${r.addressId}:${r.day}`, r.amount]))),
    );
  }, [start, finish]);

  async function save(addressId: number, day: string, value: string) {
    const amount = Number(value);
    if (Number.isNaN(amount) || plans[`${addressId}:${day}`] === amount) return;
    await api('/api/plans', { method: 'PUT', body: { addressId, day, amount } });
    setPlans({ ...plans, [`${addressId}:${day}`]: amount });
  }

  return (
    <Page title="План продаж" actions={<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />}>
      <div className="card table-wrap">
        <table className="table plans">
          <thead>
            <tr><th>День</th>{addresses.map((a) => <th key={a.id}>{a.name}</th>)}</tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d}>
                <td>{d.slice(8, 10)}.{d.slice(5, 7)}</td>
                {addresses.map((a) => (
                  <td key={a.id}>
                    <input
                      key={`${a.id}:${d}:${plans[`${a.id}:${d}`] ?? ''}`}
                      type="number"
                      defaultValue={plans[`${a.id}:${d}`] ?? ''}
                      onBlur={(e) => e.target.value !== '' && save(a.id, d, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
