import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from './api';
import { addDays, isoDay } from './format';

export type Tab = [key: string, label: ReactNode];

export function Page({ title, tabs, tab, onTab, actions, children }: {
  title: string; tabs?: Tab[]; tab?: string; onTab?: (key: string) => void; actions?: ReactNode; children: ReactNode;
}) {
  return (
    <>
      <div className={`topband small ${tabs ? 'with-tabs' : ''}`}>
        <div className="band-row">
          <h1>{title}</h1>
          <div className="actions">{actions}</div>
        </div>
        {tabs && (
          <div className="band-tabs">
            {tabs.map(([key, label]) => (
              <button key={key} className={tab === key ? 'active' : ''} onClick={() => onTab?.(key)}>{label}</button>
            ))}
          </div>
        )}
      </div>
      <div className="content">{children}</div>
    </>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`card modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn icon" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

// Вкладки и прочие переключатели живут в адресной строке, чтобы ссылкой можно было поделиться
export function useParam(name: string, fallback: string): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams();
  return [params.get(name) ?? fallback, (v) => setParams((p) => { p.set(name, v); return p; })];
}
export const useTab = (fallback: string) => useParam('tab', fallback);

// Фильтры отчётов тоже живут в адресной строке
export function useFilters(defaults: { start?: string; finish?: string } = {}) {
  const [params, setParams] = useSearchParams();
  const today = isoDay(new Date());
  const f = {
    start: params.get('start') ?? defaults.start ?? today,
    finish: params.get('finish') ?? defaults.finish ?? today,
    day: params.get('day') ?? today,
    addresses: params.get('addresses') ?? '',
    search: params.get('search') ?? '',
    category: params.get('category') ?? '',
    kind: params.get('kind') ?? '',
  };
  const set = (patch: Partial<typeof f>) =>
    setParams((p) => {
      for (const [k, v] of Object.entries(patch)) v ? p.set(k, v) : p.delete(k);
      return p;
    });
  return [f, set] as const;
}
export type Filters = ReturnType<typeof useFilters>[0];

let addressCache: Promise<{ id: number; name: string; isWarehouse: boolean }[]> | null = null;
let categoryCache: Promise<{ id: number; name: string; color: string }[]> | null = null;
export const loadAddresses = () => (addressCache ??= api('/api/addresses'));
export const loadCategories = () => (categoryCache ??= api('/api/categories'));
export const resetCaches = () => { addressCache = null; categoryCache = null; };

export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): [T | null, () => void] {
  const [data, setData] = useState<T | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    load().then((d) => alive && setData(d)).catch(() => alive && setData(null));
    return () => { alive = false; };
  }, [...deps, n]);
  return [data, () => setN(n + 1)];
}

export function DateRange({ start, finish, onChange }: { start: string; finish: string; onChange: (s: string, f: string) => void }) {
  const len = (Date.parse(finish) - Date.parse(start)) / 86400000 + 1;
  return (
    <div className="filter-group">
      <button className="btn icon" onClick={() => onChange(addDays(start, -len), addDays(finish, -len))}>‹</button>
      <div className="daterange">
        <input type="date" value={start} max={finish} onChange={(e) => e.target.value && onChange(e.target.value, finish)} />
        <span>—</span>
        <input type="date" value={finish} min={start} onChange={(e) => e.target.value && onChange(start, e.target.value)} />
      </div>
      <button className="btn icon" onClick={() => onChange(addDays(start, len), addDays(finish, len))}>›</button>
    </div>
  );
}

export function DayPicker({ day, onChange }: { day: string; onChange: (d: string) => void }) {
  return (
    <div className="filter-group">
      <button className="btn icon" onClick={() => onChange(addDays(day, -1))}>‹</button>
      <div className="daterange"><input type="date" value={day} onChange={(e) => e.target.value && onChange(e.target.value)} /></div>
      <button className="btn icon" onClick={() => onChange(addDays(day, 1))}>›</button>
    </div>
  );
}

export function MultiPicker({ options, value, onChange, placeholder }: {
  options: { id: number | string; name: string }[]; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = value ? value.split(',') : [];
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const toggle = (id: string) => onChange((selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]).join(','));
  const label = selected.length ? options.filter((o) => selected.includes(String(o.id))).map((o) => o.name).join(', ') : placeholder;
  return (
    <div className="picker" ref={ref}>
      <button className={`picker-btn ${selected.length ? '' : 'muted'}`} onClick={() => setOpen(!open)}>
        <span>{label}</span>▾
      </button>
      {open && (
        <div className="picker-menu">
          {options.map((o) => (
            <label key={o.id}>
              <input type="checkbox" checked={selected.includes(String(o.id))} onChange={() => toggle(String(o.id))} /> {o.name}
            </label>
          ))}
          {selected.length > 0 && <button className="btn link" onClick={() => onChange('')}>Сбросить</button>}
        </div>
      )}
    </div>
  );
}

export const kindLabels: Record<string, string> = { goods: 'Товар', product: 'Продукция', raw: 'Сырьё' };

// Стандартная панель фильтров отчётов
export function FilterBar({ f, set, period = 'range', show = ['addresses', 'search', 'category', 'kind'], children }: {
  f: Filters; set: (p: Partial<Filters>) => void; period?: 'range' | 'day' | 'none';
  show?: ('addresses' | 'search' | 'category' | 'kind')[]; children?: ReactNode;
}) {
  const [addresses, setAddresses] = useState<{ id: number; name: string }[]>([]);
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    loadAddresses().then(setAddresses);
    loadCategories().then(setCategories);
  }, []);
  return (
    <div className="filters-bar">
      {period === 'range' && <DateRange start={f.start} finish={f.finish} onChange={(start, finish) => set({ start, finish })} />}
      {period === 'day' && <DayPicker day={f.day} onChange={(day) => set({ day })} />}
      {show.includes('addresses') && (
        <MultiPicker options={addresses} value={f.addresses} onChange={(addresses) => set({ addresses })} placeholder="Все адреса" />
      )}
      {show.includes('search') && (
        <input className="input" placeholder="Поиск в названии" defaultValue={f.search}
          onKeyDown={(e) => e.key === 'Enter' && set({ search: (e.target as HTMLInputElement).value })}
          onBlur={(e) => set({ search: e.target.value })} />
      )}
      {show.includes('category') && (
        <select className="input" value={f.category} onChange={(e) => set({ category: e.target.value })}>
          <option value="">Все категории</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      {show.includes('kind') && (
        <select className="input" value={f.kind} onChange={(e) => set({ kind: e.target.value })}>
          <option value="">Тип номенклатуры</option>
          {Object.entries(kindLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      )}
      <div className="filters-extra">{children}</div>
    </div>
  );
}

export type Column<R> = {
  key: string;
  label: ReactNode;
  value?: (r: R) => unknown;
  render?: (v: any, r: R) => ReactNode;
  // как выводить в CSV и сортировать, если отличается от render
  sum?: boolean;
  align?: 'left' | 'right';
  className?: (v: any, r: R) => string | undefined;
  group?: string;
};

function csvEscape(v: unknown) {
  const s = v === null || v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(name: string, columns: { key: string; label: ReactNode; value?: (r: any) => unknown }[], rows: any[]) {
  const header = columns.map((c) => csvEscape(typeof c.label === 'string' ? c.label : c.key)).join(';');
  const lines = rows.map((r) => columns.map((c) => csvEscape(c.value ? c.value(r) : r[c.key])).join(';'));
  // BOM, чтобы Excel открыл кириллицу правильно
  const blob = new Blob(['﻿' + [header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function DataTable<R extends Record<string, any>>({ columns, rows, totals = true, onRow, rowClass, exportName, empty = 'Нет данных за период', expanded }: {
  columns: Column<R>[]; rows: R[] | null; totals?: boolean; onRow?: (r: R) => void; rowClass?: (r: R) => string | undefined;
  exportName?: string; empty?: string; expanded?: (r: R) => ReactNode;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const get = (c: Column<R>, r: R) => (c.value ? c.value(r) : r[c.key]);
  const sorted = useMemo(() => {
    if (!rows || !sort) return rows;
    const c = columns.find((x) => x.key === sort.key)!;
    return [...rows].sort((a, b) => {
      const va = get(c, a), vb = get(c, b);
      if (typeof va === 'number' || typeof vb === 'number') return (Number(va ?? -Infinity) - Number(vb ?? -Infinity)) * sort.dir;
      return String(va ?? '').localeCompare(String(vb ?? ''), 'ru') * sort.dir;
    });
  }, [rows, sort, columns]);
  const groups = columns.some((c) => c.group);
  const showTotals = totals && rows && rows.length > 0 && columns.some((c) => c.sum);

  return (
    <div className="card table-wrap">
      {exportName && rows && (
        <div className="table-tools">
          <button className="btn small" onClick={() => exportCsv(exportName, columns, sorted ?? [])}>⇩ Экспорт в Excel (CSV)</button>
        </div>
      )}
      <table className="table">
        <thead>
          {groups && (
            <tr className="group-row">
              {columns.map((c, i) => {
                if (i > 0 && columns[i - 1].group === c.group && c.group) return null;
                const span = c.group ? columns.slice(i).findIndex((x) => x.group !== c.group) : 1;
                return <th key={c.key} colSpan={span === -1 ? columns.length - i : span || 1}>{c.group ?? ''}</th>;
              })}
            </tr>
          )}
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`sortable ${c.align === 'right' ? 'right' : ''}`}
                onClick={() => setSort(sort?.key === c.key ? (sort.dir === -1 ? { key: c.key, dir: 1 } : null) : { key: c.key, dir: -1 })}>
                {c.label}{sort?.key === c.key && (sort.dir === -1 ? ' ↓' : ' ↑')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {showTotals && (
            <tr className="totals">
              {columns.map((c, i) => (
                <td key={c.key} className={c.align === 'right' ? 'right' : ''}>
                  {i === 0 ? 'Итого' : c.sum ? (c.render ?? String)(rows!.reduce((s, r) => s + (Number(get(c, r)) || 0), 0), {} as R) : ''}
                </td>
              ))}
            </tr>
          )}
          {!rows && <tr><td colSpan={columns.length} className="empty">Загрузка…</td></tr>}
          {sorted?.map((r, i) => (
            <RowView key={r.id ?? r.key ?? i} r={r} columns={columns} get={get} onRow={onRow} rowClass={rowClass} expanded={expanded} />
          ))}
          {rows && !rows.length && <tr><td colSpan={columns.length} className="empty">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function RowView<R>({ r, columns, get, onRow, rowClass, expanded }: {
  r: R; columns: Column<R>[]; get: (c: Column<R>, r: R) => unknown; onRow?: (r: R) => void;
  rowClass?: (r: R) => string | undefined; expanded?: (r: R) => ReactNode;
}) {
  const extra = expanded?.(r);
  return (
    <>
      <tr className={`${onRow ? 'clickable' : ''} ${rowClass?.(r) ?? ''}`} onClick={() => onRow?.(r)}>
        {columns.map((c, i) => {
          const v = get(c, r);
          return (
            <td key={c.key} className={[i === 0 ? 'name' : '', c.align === 'right' ? 'right' : '', c.className?.(v, r) ?? ''].join(' ')}>
              {c.render ? c.render(v, r) : (v as ReactNode) ?? '—'}
            </td>
          );
        })}
      </tr>
      {extra && <tr className="details"><td colSpan={columns.length}>{extra}</td></tr>}
    </>
  );
}

export const today = () => isoDay(new Date());
