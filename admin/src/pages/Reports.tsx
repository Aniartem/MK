import { qs, api } from '../api';
import { Column, DataTable, FilterBar, Page, useFilters, useLoad, useParam, useTab, kindLabels } from '../components';
import { addDays, money, pct, qty } from '../format';

const num = (key: string, label: string, sum = true, render: (v: any) => React.ReactNode = money): Column<any> =>
  ({ key, label, sum, render, align: 'right' });
const qtyCol = (key: string, label: string, sum = true) => num(key, label, sum, qty);
const pctCol = (key: string, label: string): Column<any> => ({ key, label, align: 'right', render: (v) => (v === null ? '—' : `${money(v)}%`) });
const nameCol = (label = 'Номенклатура'): Column<any> => ({ key: 'name', label });
const categoryCol: Column<any> = { key: 'category', label: 'Категория', render: (v) => <span className="caps">{v ?? '—'}</span> };
const negative = (v: number) => (v < 0 ? 'bad' : undefined);

function useReport<T = any[]>(path: string, params: Record<string, string | number | undefined | null>) {
  return useLoad<T>(() => api(`${path}?${qs(params)}`), [path, JSON.stringify(params)]);
}
const base = (f: ReturnType<typeof useFilters>[0]) => ({
  start: f.start, finish: f.finish, addresses: f.addresses, search: f.search, category: f.category, kind: f.kind,
});

// ——— Продажи ———
const salesTabs: [string, string, string][] = [
  ['products', 'Номенклатура', 'Номенклатура'], ['categories', 'Категории', 'Категория'], ['addresses', 'Адреса', 'Адрес'],
  ['days', 'Дни', 'День'], ['hours', 'Часы', 'Час'], ['employees', 'Сотрудники', 'Сотрудник'], ['payments', 'Оплаты', 'Способ оплаты'],
];
const compareTabs: [string, string][] = [['none', 'Без сравнения'], ['day', 'День назад'], ['week', 'Неделя назад'], ['month', 'Месяц назад'], ['year', 'Год назад']];

function shifted(day: string, by: string) {
  const d = new Date(day + 'T12:00:00');
  if (by === 'day') d.setDate(d.getDate() - 1);
  if (by === 'week') d.setDate(d.getDate() - 7);
  if (by === 'month') d.setMonth(d.getMonth() - 1);
  if (by === 'year') d.setFullYear(d.getFullYear() - 1);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function SalesReport() {
  const [tab, setTab] = useTab('products');
  const [f, set] = useFilters();
  const [compare, setCompare] = useParam('compare', 'none');
  const [rows] = useReport('/api/reports/sales', { ...base(f), by: tab, compare });
  const label = salesTabs.find((t) => t[0] === tab)![2];
  const columns: Column<any>[] = [
    nameCol(label),
    ...(tab === 'products' ? [{ ...categoryCol, key: 'extra' }] : []),
    ...(tab !== 'payments' ? [qtyCol('qty', 'Кол-во'), num('cost', 'Себестоимость'), num('discount', 'Скидка')] : [qtyCol('checks', 'Чеков')]),
    num('revenue', 'Выручка'),
    ...(tab !== 'payments' ? [{ ...num('profit', 'Прибыль'), className: negative }, pctCol('share', 'Доля')] : []),
    ...(compare !== 'none'
      ? [num('prevRevenue', 'Выручка ранее'), { ...pctCol('change', 'Изменение'), render: (v: number | null) => pct(v), className: (v: number) => (v > 0 ? 'good' : v < 0 ? 'bad' : '') }]
      : []),
  ];
  return (
    <Page title="Отчёт по продажам" tabs={salesTabs.map(([k, l]) => [k, l])} tab={tab} onTab={setTab}>
      <FilterBar f={f} set={set} />
      <div className="subtabs">
        {compareTabs.map(([k, l]) => (
          <button key={k} className={compare === k ? 'active' : ''} onClick={() => setCompare(k)}>
            {l}
            <small>{k === 'none' ? '—' : `${shifted(f.start, k)}–${shifted(f.finish, k)}`}</small>
          </button>
        ))}
      </div>
      <DataTable columns={columns} rows={rows} exportName={`продажи-${tab}-${f.start}-${f.finish}`} />
    </Page>
  );
}

// ——— Производство ———
export function ProductionReport() {
  const [f, set] = useFilters();
  const [rows] = useReport('/api/reports/production', base(f));
  return (
    <Page title="Отчёт о производстве">
      <FilterBar f={f} set={set} show={['addresses', 'search', 'category']} />
      <DataTable
        exportName={`производство-${f.start}-${f.finish}`}
        rows={rows}
        columns={[
          nameCol('Название'), categoryCol,
          qtyCol('sales', 'Продажи'), qtyCol('production', 'Выпуск'),
          qtyCol('daysNoSales', 'Без продаж, дней', false), qtyCol('daysNoProduction', 'Без выпуска, дней', false),
          qtyCol('writeoff', 'Списание'), pctCol('pctOfProduction', '% от выпуска'), pctCol('pctOfSales', '% от продаж'),
          num('productionSum', 'Сумма выпуска'),
        ]}
      />
    </Page>
  );
}

// ——— Склад: остатки ———
export function StockReport() {
  const [f, set] = useFilters();
  const [rows] = useReport('/api/reports/stock', { ...base(f), day: f.day, start: undefined, finish: undefined });
  return (
    <Page title="Склад">
      <FilterBar f={f} set={set} period="day" />
      <p className="hint">Остатки на конец выбранного дня. Отрицательный остаток — продано больше, чем выпущено или поступило.</p>
      <DataTable
        exportName={`остатки-${f.day}`}
        rows={rows}
        columns={[
          nameCol(), { key: 'unit', label: 'Ед. изм.' }, categoryCol,
          { key: 'kind', label: 'Тип', render: (v) => kindLabels[v] },
          { ...qtyCol('qty', 'Остаток'), className: negative },
          { ...num('retailSum', 'Сумма в р. ценах'), className: negative },
          { ...num('costSum', 'Сумма в себест.'), className: negative },
        ]}
      />
    </Page>
  );
}

// ——— Движение товара ———
export function MovementReport() {
  const [unit, setUnit] = useTab('qty');
  const [f, set] = useFilters();
  const [rows] = useReport('/api/reports/movement', { ...base(f), unit });
  const v = unit === 'qty' ? qty : money;
  const col = (key: string, label: string, group?: string): Column<any> => ({ key, label, group, align: 'right', sum: unit !== 'qty', render: v, className: (x: number) => (x < 0 ? 'bad' : x === 0 ? 'muted' : undefined) });
  return (
    <Page title="Отчёт о движении" tabs={[['qty', 'Количество'], ['retail', 'Рын. цены'], ['cost', 'Себестоимость']]} tab={unit} onTab={setUnit}>
      <FilterBar f={f} set={set} />
      <DataTable
        exportName={`движение-${f.start}-${f.finish}`}
        rows={rows}
        columns={[
          nameCol(), { key: 'unit', label: 'Ед. изм.' },
          col('opening', 'Остаток на начало'),
          col('production', 'Выпуск', 'Приход'), col('supply', 'Поставка', 'Приход'),
          col('transferOut', 'Отгрузка', 'Перемещение'), col('transferIn', 'Получение', 'Перемещение'),
          col('sales', 'Продажа'), col('returns', 'Возврат'), col('losses', 'Потери'), col('inventory', 'Инвентаризация'),
          col('closing', 'Остаток на конец'),
        ]}
      />
    </Page>
  );
}

// ——— Часовые остатки ———
export function HourlyReport() {
  const [f, set] = useFilters();
  const [data] = useReport<{ addresses: { id: number; name: string }[]; rows: any[] }>('/api/reports/hourly', { ...base(f), day: f.day });
  return (
    <Page title="Часовые остатки">
      <FilterBar f={f} set={set} period="day" show={['addresses', 'search', 'category']} />
      <p className="hint">Остаток каждого товара по точкам прямо сейчас (для прошлых дат — на конец дня). Красным — товар закончился. Сортировка по продажам за 4 недели.</p>
      {data && (
        <div className="card table-wrap">
          <table className="table matrix">
            <thead>
              <tr>
                <th>Номенклатура</th><th className="right">Топ</th>
                {data.addresses.map((a) => <th key={a.id} className="vertical"><span>{a.name}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="name">{r.name}</td>
                  <td className="right">{r.top}</td>
                  {data.addresses.map((a) => {
                    const b = Number(r.balances[a.id] ?? 0);
                    return <td key={a.id} className={`right ${b <= 0 ? 'cell-bad' : ''}`}>{qty(b)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}

// ——— Потери ———
export function LossesReport() {
  const [tab, setTab] = useTab('products');
  const [f, set] = useFilters({ start: addDays(new Date().toISOString().slice(0, 10), -30) });
  const [rows] = useReport('/api/reports/losses', { ...base(f), by: tab });
  const columns: Column<any>[] =
    tab === 'products'
      ? [nameCol(), { key: 'unit', label: 'Ед. изм.' }, qtyCol('sales', 'Продажи'), qtyCol('production', 'Выпуск'),
         qtyCol('writeoff', 'Списание'), num('writeoffSum', 'Потери, ₽'), pctCol('pctOfSales', '% от продаж')]
      : [nameCol(tab === 'addresses' ? 'Адрес' : 'День'), num('sales', 'Выручка'), num('production', 'Сумма выпуска'),
         num('writeoffSum', 'Потери, ₽'), pctCol('pctOfSales', '% от продаж')];
  return (
    <Page title="Потери" tabs={[['products', 'Номенклатура'], ['addresses', 'Адреса'], ['days', 'Дни']]} tab={tab} onTab={setTab}>
      <FilterBar f={f} set={set} show={tab === 'products' ? ['addresses', 'search', 'category', 'kind'] : ['addresses']} />
      <DataTable rows={rows} columns={columns} exportName={`потери-${tab}-${f.start}-${f.finish}`} empty="Списаний за период нет" />
    </Page>
  );
}

// ——— ABC-анализ ———
const groupClass = (v: string) => (v === 'A' ? 'cell-good' : v === 'B' ? 'cell-warn' : 'cell-bad');

export function AbcReport() {
  const [f, set] = useFilters({ start: new Date().toISOString().slice(0, 8) + '01' });
  const [data] = useReport<{ matrix: Record<string, Record<string, number>>; rows: any[] }>('/api/reports/abc', base(f));
  const twoLine = (sub: string) => (v: number, r: any) => (
    <>{money(v)}<small className="sub">{r[sub] == null ? '' : `${money(r[sub])}%`}</small></>
  );
  return (
    <Page title="ABC-анализ">
      <FilterBar f={f} set={set} />
      {data && (
        <>
          <div className="card abc-matrix">
            <table>
              <thead><tr><th>Выручка \ Прибыль</th>{'ABC'.split('').map((g) => <th key={g}>{g}</th>)}</tr></thead>
              <tbody>
                {'ABC'.split('').map((rg) => (
                  <tr key={rg}><th>{rg}</th>{'ABC'.split('').map((pg) => <td key={pg}>{data.matrix[rg][pg]}</td>)}</tr>
                ))}
              </tbody>
            </table>
            <p className="hint">Группа A — товары, дающие первые 80% выручки (прибыли), B — следующие 15%, C — остальные 5%. Строки — группа по выручке, столбцы — по прибыли.</p>
          </div>
          <DataTable
            rows={data.rows}
            exportName={`abc-${f.start}-${f.finish}`}
            columns={[
              nameCol(), { key: 'unit', label: 'Ед. изм.' }, num('price', 'Цена', false), qtyCol('qty', 'Продаж'),
              { ...num('revenue', 'Выручка'), render: twoLine('revenueShare'), className: (_v, r) => groupClass(r.revenueGroup) },
              { key: 'revenueGroup', label: 'Группа выручки' },
              num('cost', 'Себестоимость'),
              { ...pctCol('markup', 'Наценка'), className: (v: number) => (v < 0 ? 'cell-bad' : undefined) },
              pctCol('costPct', 'Себестоимость, %'),
              { ...num('profit', 'Прибыль'), render: twoLine('profitShare'), className: (_v, r) => groupClass(r.profitGroup) },
              { key: 'profitGroup', label: 'Группа прибыли' },
            ]}
          />
        </>
      )}
    </Page>
  );
}

// ——— Сотрудники: сводка ———
export function EmployeesReport() {
  const [f, set] = useFilters();
  const [rows] = useReport('/api/reports/employees', { start: f.start, finish: f.finish, addresses: f.addresses });
  return (
    <>
      <FilterBar f={f} set={set} show={['addresses']} />
      <DataTable
        rows={rows}
        exportName={`сотрудники-${f.start}-${f.finish}`}
        columns={[
          nameCol('Сотрудник'), num('sales', 'Продажи'), num('returns', 'Возвраты'), num('revenue', 'Выручка'), qtyCol('checks', 'Чеки'),
          num('avgCheck', 'Средний чек', false), num('discounts', 'Скидки'), qtyCol('shifts', 'Смен'),
          { ...num('discrepancy', 'Касса (расхождение)'), className: (v: number) => (v < 0 ? 'bad' : v > 0 ? 'good' : undefined) },
        ]}
      />
    </>
  );
}

