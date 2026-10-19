import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, LineController, BarController, Filler, Legend, Tooltip,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import { api, qs } from '../api';
import { addDays, isoDay, money, pct, qty, short } from '../format';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, LineController, BarController, Filler, Legend, Tooltip);

type Row = {
  id?: number; name: string; revenue: number; vsAverage: number | null; checks: number; avgCheck: number;
  production: number; remainder: number; sku: number; losses: number; sent: number; received: number;
  plan: number | null; forecast: number; planPct: number | null;
};
type Data = {
  top: { yesterday: number; today: number; month: number };
  kpi: { revenue: number; returns: number; checks: number; avgCheck: number; production: number; losses: number };
  series: { label: string; revenue: number; checks: number; items: number; avgRevenue: number; avgChecks: number }[];
  addresses: { totals: Row; rows: Row[] };
};

const reportTabs = [
  ['addresses', 'Адреса'], ['products', 'Товары'], ['employees', 'Сотрудники'], ['payments', 'Оплаты'], ['categories', 'Категории'],
] as const;

export default function Dashboard() {
  const [params, setParams] = useSearchParams();
  const today = isoDay(new Date());
  const start = params.get('start') ?? today;
  const finish = params.get('finish') ?? today;
  const addresses = params.get('addresses') ?? '';
  const [group, setGroup] = useState<'hour' | 'day'>(start === finish ? 'hour' : 'day');
  const [metric, setMetric] = useState<'revenue' | 'checks'>('revenue');
  const [tab, setTab] = useState<(typeof reportTabs)[number][0]>('addresses');
  const [data, setData] = useState<Data | null>(null);
  const [report, setReport] = useState<any[] | null>(null);
  const [allAddresses, setAllAddresses] = useState<{ id: number; name: string }[]>([]);

  const update = (next: Record<string, string>) => setParams({ start, finish, addresses, ...next });
  const shift = (dir: number) => {
    const len = (new Date(finish).getTime() - new Date(start).getTime()) / 86400000 + 1;
    update({ start: addDays(start, dir * len), finish: addDays(finish, dir * len) });
  };

  useEffect(() => {
    api('/api/addresses').then(setAllAddresses);
  }, []);
  useEffect(() => {
    setGroup(start === finish ? 'hour' : 'day');
  }, [start, finish]);
  useEffect(() => {
    api<Data>(`/api/dashboard?${qs({ start, finish, addresses, group })}`).then(setData);
  }, [start, finish, addresses, group]);
  useEffect(() => {
    setReport(null);
    if (tab !== 'addresses') api(`/api/reports/sales?${qs({ start, finish, addresses, by: tab })}`).then(setReport);
  }, [tab, start, finish, addresses]);

  return (
    <>
      <div className="topband">
        <div className="filters">
          <button className="btn icon" onClick={() => shift(-1)}>‹</button>
          <div className="daterange">
            <input type="date" value={start} max={finish} onChange={(e) => e.target.value && update({ start: e.target.value })} />
            <span>—</span>
            <input type="date" value={finish} min={start} onChange={(e) => e.target.value && update({ finish: e.target.value })} />
          </div>
          <button className="btn icon" onClick={() => shift(1)}>›</button>
          <AddressPicker all={allAddresses} value={addresses} onChange={(v) => update({ addresses: v })} />
        </div>
        {data && (
          <div className="topstats">
            <button onClick={() => update({ start: addDays(today, -1), finish: addDays(today, -1) })}>
              <small>Вчера</small>{short(data.top.yesterday)}
            </button>
            <button className={start === today && finish === today ? 'active' : ''} onClick={() => update({ start: today, finish: today })}>
              <small>Сегодня</small>{short(data.top.today)}
            </button>
            <button onClick={() => update({ start: today.slice(0, 8) + '01', finish: today })}>
              <small>Месяц</small>{short(data.top.month)}
            </button>
          </div>
        )}
      </div>

      {data && (
        <div className="content">
          <div className="kpis">
            <Kpi title="Выручка без возвратов" value={money(data.kpi.revenue)} badge={money(data.kpi.returns)} badgeKind="bad" />
            <Kpi title="Количество чеков" value={qty(data.kpi.checks)} badge={money(data.kpi.avgCheck)} badgeKind="good" currency={false} />
            <Kpi title="Сумма выпуска" value={money(data.kpi.production)} />
            <Kpi title="Потери" value={money(data.kpi.losses)} />
          </div>

          <div className="card chart-card">
            <div className="tabs">
              <button className={metric === 'revenue' ? 'active' : ''} onClick={() => setMetric('revenue')}>Выручка</button>
              <button className={metric === 'checks' ? 'active' : ''} onClick={() => setMetric('checks')}>Чеки</button>
              <select value={group} onChange={(e) => setGroup(e.target.value as 'hour' | 'day')}>
                <option value="hour">Час</option>
                <option value="day">День</option>
              </select>
            </div>
            <SalesChart data={data.series} metric={metric} group={group} />
          </div>

          <div className="tabs report-tabs">
            {reportTabs.map(([key, label]) => (
              <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
            ))}
          </div>
          {tab === 'addresses' ? <AddressTable totals={data.addresses.totals} rows={data.addresses.rows} /> : <ReportTable tab={tab} rows={report} />}
        </div>
      )}
    </>
  );
}

function Kpi({ title, value, badge, badgeKind, currency = true }: { title: string; value: string; badge?: string; badgeKind?: 'good' | 'bad'; currency?: boolean }) {
  return (
    <div className="card kpi">
      <div className="kpi-title">{title}</div>
      <div className="kpi-value">
        {value} {badge && <span className={`badge ${badgeKind}`}>{badge}</span>}
      </div>
      {currency && <span className="kpi-currency">₽</span>}
    </div>
  );
}

function AddressPicker({ all, value, onChange }: { all: { id: number; name: string }[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = value ? value.split(',').map(Number) : [];
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const toggle = (id: number) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onChange(next.join(','));
  };
  const label = selected.length ? all.filter((a) => selected.includes(a.id)).map((a) => a.name).join(', ') : 'Все адреса';
  return (
    <div className="picker" ref={ref}>
      <button className={`picker-btn ${selected.length ? '' : 'muted'}`} onClick={() => setOpen(!open)}>
        <span>{label}</span>▾
      </button>
      {open && (
        <div className="picker-menu">
          {all.map((a) => (
            <label key={a.id}>
              <input type="checkbox" checked={selected.includes(a.id)} onChange={() => toggle(a.id)} /> {a.name}
            </label>
          ))}
          {selected.length > 0 && <button className="btn link" onClick={() => onChange('')}>Сбросить</button>}
        </div>
      )}
    </div>
  );
}

function SalesChart({ data, metric, group }: { data: Data['series']; metric: 'revenue' | 'checks'; group: 'hour' | 'day' }) {
  const unit = group === 'hour' ? 'час' : 'день';
  const chartData = useMemo(
    () => ({
      labels: data.map((d) => (group === 'day' ? d.label.slice(8, 10) + '.' + d.label.slice(5, 7) : d.label)),
      datasets: [
        {
          type: 'line' as const,
          label: metric === 'revenue' ? `Выручка за ${unit}` : `Чеки за ${unit}`,
          data: data.map((d) => d[metric]),
          borderColor: '#3b6fd4',
          backgroundColor: (ctx: any) => {
            const { chart } = ctx;
            if (!chart.chartArea) return 'rgba(59,111,212,0.3)';
            const g = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
            g.addColorStop(0, 'rgba(59,111,212,0.45)');
            g.addColorStop(1, 'rgba(59,111,212,0.02)');
            return g;
          },
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          pointBackgroundColor: '#fff',
          borderWidth: 2,
          order: 1,
        },
        {
          type: 'line' as const,
          label: `В среднем за ${unit}`,
          data: data.map((d) => (metric === 'revenue' ? d.avgRevenue : d.avgChecks)),
          borderColor: '#a9c1ec',
          backgroundColor: 'rgba(169,193,236,0.25)',
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2,
          order: 2,
        },
        {
          type: 'bar' as const,
          label: 'Товары',
          data: data.map((d) => d.items),
          backgroundColor: '#5ccf85',
          hidden: true,
          order: 3,
        },
      ],
    }),
    [data, metric, group, unit],
  );
  return (
    <div className="chart">
      <Chart
        type="line"
        data={chartData}
        options={{
          maintainAspectRatio: false,
          locale: 'ru-RU',
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'top', labels: { boxWidth: 36, boxHeight: 10, font: { size: 11 } } } },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, grid: { color: '#e3e8f0' }, border: { dash: [3, 3] } },
          },
        }}
      />
    </div>
  );
}

function AddressTable({ totals, rows }: { totals: Row; rows: Row[] }) {
  const cols: [keyof Row, string, (v: any) => React.ReactNode][] = [
    ['revenue', 'Выручка', money],
    ['vsAverage', '% от среднего', (v) => <span className={v > 0 ? 'good' : v < 0 ? 'bad' : ''}>{pct(v)}</span>],
    ['checks', 'Чеки', qty],
    ['avgCheck', 'Средний чек', money],
    ['production', 'Сумма выпуска', money],
    ['remainder', 'Остаток продукция', money],
    ['sku', 'SKU', qty],
    ['losses', 'Потери общие', money],
    ['sent', 'Отправлено', money],
    ['received', 'Принято', money],
    ['plan', 'План продаж', money],
    ['forecast', 'Прогноз', money],
    ['planPct', '% от плана продаж', (v) => (v === null ? '-' : `${money(v)}%`)],
  ];
  const [sort, setSort] = useState<keyof Row | null>(null);
  const sorted = sort ? [...rows].sort((a, b) => Number(b[sort] ?? 0) - Number(a[sort] ?? 0)) : rows;
  return (
    <div className="card table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Адрес</th>
            {cols.map(([k, label]) => (
              <th key={k} onClick={() => setSort(sort === k ? null : k)} className="sortable">
                {label} {sort === k && '↓'}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="totals">
            <td>Итого</td>
            {cols.map(([k, , f]) => <td key={k}>{f(totals[k])}</td>)}
          </tr>
          {sorted.map((r) => (
            <tr key={r.id}>
              <td className="name">{r.name}</td>
              {cols.map(([k, , f]) => <td key={k}>{f(r[k])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const reportColumns: Record<string, [string, string, (v: any) => React.ReactNode][]> = {
  products: [['name', 'Товар', String], ['qty', 'Количество', qty], ['checks', 'Чеков', qty], ['revenue', 'Выручка', money], ['profit', 'Прибыль', money], ['share', 'Доля, %', money]],
  categories: [['name', 'Категория', String], ['qty', 'Количество', qty], ['revenue', 'Выручка', money], ['profit', 'Прибыль', money], ['share', 'Доля, %', money]],
  employees: [['name', 'Сотрудник', String], ['revenue', 'Выручка', money], ['checks', 'Чеки', qty], ['avgCheck', 'Средний чек', money], ['discount', 'Скидки', money], ['profit', 'Прибыль', money]],
  payments: [['name', 'Способ оплаты', String], ['revenue', 'Сумма', money], ['checks', 'Чеков', qty]],
};

function ReportTable({ tab, rows }: { tab: string; rows: any[] | null }) {
  const cols = reportColumns[tab];
  return (
    <div className="card table-wrap">
      <table className="table">
        <thead>
          <tr>{cols.map(([k, label]) => <th key={k}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {rows?.map((r, i) => (
            <tr key={i}>{cols.map(([k, , f], j) => <td key={k} className={j === 0 ? 'name' : ''}>{f(r[k])}</td>)}</tr>
          ))}
          {rows && !rows.length && (
            <tr><td colSpan={cols.length} className="empty">Нет данных за период</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
