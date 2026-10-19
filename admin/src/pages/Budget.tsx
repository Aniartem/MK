import { useEffect, useState } from 'react';
import { api } from '../api';
import { DataTable, Field, Modal, Page, loadAddresses, useLoad, useParam, useTab } from '../components';
import { money } from '../format';

type Line = { article: string; plan: number; fact: number; done: number | null };
type Summary = {
  summary: {
    profit: { plan: number; fact: number }; profitPct: number | null;
    income: Line; incomeArticles: Line[]; expense: Line; expenseArticles: Line[]; expensePct: number | null;
  };
  indicators: { name: string; fact: number; pct: number | null }[];
  addresses: any[];
};
type Op = {
  id?: number; day: string; kind: 'income' | 'expense'; article: string; amount: number; addressId: number | null;
  counterpartyId: number | null; planned: boolean; paid: boolean; note: string | null; address?: string; counterparty?: string;
};

const pctText = (v: number | null) => (v === null ? '—' : `${money(v)}%`);

function MonthPicker({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const shift = (n: number) => {
    const d = new Date(`${month}-15`);
    d.setMonth(d.getMonth() + n);
    onChange(d.toISOString().slice(0, 7));
  };
  return (
    <div className="filter-group">
      <button className="btn icon" onClick={() => shift(-1)}>‹</button>
      <div className="daterange"><input type="month" value={month} onChange={(e) => e.target.value && onChange(e.target.value)} /></div>
      <button className="btn icon" onClick={() => shift(1)}>›</button>
    </div>
  );
}

export default function Budget() {
  const [tab, setTab] = useTab('summary');
  const [month, setMonth] = useParam('month', new Date().toISOString().slice(0, 7));
  const [edit, setEdit] = useState<Op | null>(null);
  const [data, reloadSummary] = useLoad<Summary>(() => api(`/api/budget?month=${month}`), [month]);
  const [ops, reloadOps] = useLoad<Op[]>(() => api(`/api/budget/ops?month=${month}`), [month]);
  const reload = () => { reloadSummary(); reloadOps(); };
  const newOp = (): Op => ({ day: `${month}-01`, kind: 'expense', article: '', amount: 0, addressId: null, counterpartyId: null, planned: false, paid: true, note: null });

  return (
    <Page
      title="Бюджет"
      tabs={[['summary', 'Сводка'], ['ops', 'Операции']]}
      tab={tab}
      onTab={setTab}
      actions={<button className="btn primary" onClick={() => setEdit(newOp())}>Добавить операцию</button>}
    >
      <div className="filters-bar"><MonthPicker month={month} onChange={setMonth} /></div>
      {tab === 'summary' && data && (
        <>
          <div className="card section">
            <h3>Бюджет</h3>
            <table className="table">
              <thead><tr><th>Статья</th><th className="right">План</th><th className="right">% выполнения</th><th className="right">Факт</th><th className="right">% дохода</th></tr></thead>
              <tbody>
                <tr className="strong"><td>Прибыль</td><td className="right">{money(data.summary.profit.plan)}</td><td className="right">—</td><td className="right">{money(data.summary.profit.fact)}</td><td className="right">{pctText(data.summary.profitPct)}</td></tr>
                <tr className="strong"><td>Доходы</td><td className="right">{money(data.summary.income.plan)}</td><td className="right">{pctText(data.summary.income.done)}</td><td className="right">{money(data.summary.income.fact)}</td><td /></tr>
                {data.summary.incomeArticles.map((a) => (
                  <tr key={'i' + a.article}><td className="indent">{a.article}</td><td className="right">{money(a.plan)}</td><td className="right">{pctText(a.done)}</td><td className="right">{money(a.fact)}</td><td /></tr>
                ))}
                <tr className="strong"><td>Расходы</td><td className="right">{money(data.summary.expense.plan)}</td><td className="right">{pctText(data.summary.expense.done)}</td><td className="right">{money(data.summary.expense.fact)}</td><td className="right">{pctText(data.summary.expensePct)}</td></tr>
                {data.summary.expenseArticles.map((a) => (
                  <tr key={'e' + a.article}><td className="indent">{a.article}</td><td className="right">{money(a.plan)}</td><td className="right">{pctText(a.done)}</td><td className="right">{money(a.fact)}</td><td /></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card section">
            <h3>Ключевые показатели</h3>
            <table className="table">
              <thead><tr><th>Показатель</th><th className="right">Факт</th><th className="right">% от выручки</th></tr></thead>
              <tbody>
                {data.indicators.map((i) => (
                  <tr key={i.name}><td>{i.name}</td><td className="right">{money(i.fact)}</td><td className="right">{pctText(i.pct)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="section">
            <h3 className="section-title">Адреса</h3>
            <DataTable
              rows={data.addresses}
              columns={[
                { key: 'name', label: 'Адрес' },
                { key: 'incomePlan', label: 'Доходы, план', align: 'right', sum: true, render: money },
                { key: 'incomeFact', label: 'Доходы, факт', align: 'right', sum: true, render: money },
                { key: 'incomePct', label: '%', align: 'right', render: pctText },
                { key: 'expensePlan', label: 'Расходы, план', align: 'right', sum: true, render: money },
                { key: 'expenseFact', label: 'Расходы, факт', align: 'right', sum: true, render: money },
                { key: 'expensePct', label: '%', align: 'right', render: pctText },
                { key: 'profit', label: 'Прибыль, факт', align: 'right', sum: true, render: money, className: (v: number) => (v < 0 ? 'bad' : undefined) },
                { key: 'profitPct', label: 'Прибыль, % дохода', align: 'right', render: pctText },
              ]}
            />
          </div>
        </>
      )}
      {tab === 'ops' && (
        <DataTable<Op>
          rows={ops}
          exportName={`бюджет-операции-${month}`}
          onRow={setEdit}
          empty="Операций за месяц нет"
          columns={[
            { key: 'day', label: 'Дата', render: (v) => v.split('-').reverse().join('.') },
            { key: 'kind', label: 'Вид', render: (v) => (v === 'income' ? 'Доход' : 'Расход') },
            { key: 'article', label: 'Статья' },
            { key: 'address', label: 'Адрес', render: (v) => v ?? 'Вся сеть' },
            { key: 'counterparty', label: 'Контрагент', render: (v) => v ?? '—' },
            { key: 'planned', label: 'План/факт', render: (v) => (v ? 'План' : 'Факт') },
            { key: 'amount', label: 'Сумма', align: 'right', render: (v, r) => <span className={r.kind === 'income' ? 'good' : ''}>{money(v)}</span> },
          ]}
        />
      )}
      {edit && <OpModal op={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </Page>
  );
}

function OpModal({ op, onClose, onSaved }: { op: Op; onClose: () => void; onSaved: () => void }) {
  const [o, setO] = useState(op);
  const [addresses, setAddresses] = useState<{ id: number; name: string }[]>([]);
  const [counterparties, setCounterparties] = useState<{ id: number; name: string }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    loadAddresses().then(setAddresses);
    api('/api/counterparties').then(setCounterparties);
  }, []);

  async function save() {
    setError('');
    try {
      const body = { ...o, amount: Number(o.amount) };
      await api(o.id ? `/api/budget/ops/${o.id}` : '/api/budget/ops', { method: o.id ? 'PUT' : 'POST', body });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function remove() {
    if (o.id && confirm('Удалить операцию?')) {
      await api(`/api/budget/ops/${o.id}`, { method: 'DELETE' });
      onSaved();
    }
  }

  return (
    <Modal title={o.id ? 'Операция' : 'Новая операция'} onClose={onClose}>
      <div className="form">
        <div className="segmented">
          <button className={o.kind === 'expense' ? 'active' : ''} onClick={() => setO({ ...o, kind: 'expense' })}>Расход</button>
          <button className={o.kind === 'income' ? 'active' : ''} onClick={() => setO({ ...o, kind: 'income' })}>Доход</button>
        </div>
        <div className="segmented">
          <button className={!o.planned ? 'active' : ''} onClick={() => setO({ ...o, planned: false })}>Факт</button>
          <button className={o.planned ? 'active' : ''} onClick={() => setO({ ...o, planned: true })}>План</button>
        </div>
        <Field label="Дата"><input type="date" value={o.day} onChange={(e) => setO({ ...o, day: e.target.value })} /></Field>
        <Field label="Статья (например, Аренда, Зарплата)">
          <input list="articles" value={o.article} onChange={(e) => setO({ ...o, article: e.target.value })} autoFocus />
          <datalist id="articles">
            {['Аренда', 'Зарплата', 'Коммунальные услуги', 'Закупка сырья и товаров', 'Налоги', 'Реклама', 'Ремонт и оборудование', 'Банковские комиссии'].map((a) => <option key={a} value={a} />)}
          </datalist>
        </Field>
        <Field label="Сумма, ₽"><input type="number" step="0.01" value={o.amount || ''} onChange={(e) => setO({ ...o, amount: Number(e.target.value) })} /></Field>
        <Field label="Адрес">
          <select value={o.addressId ?? ''} onChange={(e) => setO({ ...o, addressId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Вся сеть</option>
            {addresses.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Контрагент">
          <select value={o.counterpartyId ?? ''} onChange={(e) => setO({ ...o, counterpartyId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">—</option>
            {counterparties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Комментарий"><input value={o.note ?? ''} onChange={(e) => setO({ ...o, note: e.target.value || null })} /></Field>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={!o.article || !o.amount} onClick={save}>Сохранить</button>
        {o.id && <button className="btn danger" onClick={remove}>Удалить</button>}
      </div>
    </Modal>
  );
}
