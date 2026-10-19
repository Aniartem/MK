import { useState } from 'react';
import { api } from '../api';
import { DataTable, Field, Modal, Page, resetCaches, useLoad, useTab } from '../components';
import { dateTime } from '../format';

type Address = {
  id?: number; name: string; isWarehouse: boolean; active: boolean; city: string | null; fullAddress: string | null;
  organizationId: number | null; organization?: string | null;
};
type Organization = { id?: number; name: string; inn: string | null; kpp: string | null; address: string | null };
type Device = { id: string; name: string | null; address: string | null; user: string | null; lastSeenAt: string; pending: number };

export default function Settings() {
  const [tab, setTab] = useTab('addresses');
  const [settings] = useLoad<{ timezone: string }>(() => api('/api/settings'), []);
  return (
    <Page title="Настройки" tabs={[['addresses', 'Адреса'], ['organizations', 'Организации'], ['devices', 'Устройства']]} tab={tab} onTab={setTab}>
      {tab === 'addresses' && <Addresses timezone={settings?.timezone} />}
      {tab === 'organizations' && <Organizations />}
      {tab === 'devices' && <Devices />}
    </Page>
  );
}

function Addresses({ timezone }: { timezone?: string }) {
  const [rows, reload] = useLoad<Address[]>(() => api('/api/addresses'), []);
  const [orgs] = useLoad<Organization[]>(() => api('/api/organizations'), []);
  const [search, setSearch] = useState('');
  const [inactive, setInactive] = useState(false);
  const [edit, setEdit] = useState<Address | null>(null);
  const [error, setError] = useState('');

  async function save() {
    if (!edit) return;
    setError('');
    try {
      await api(edit.id ? `/api/addresses/${edit.id}` : '/api/addresses', { method: edit.id ? 'PUT' : 'POST', body: edit });
      setEdit(null);
      resetCaches();
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const q = search.toLowerCase();
  return (
    <>
      <div className="filters-bar">
        <input className="input grow" placeholder="Поиск" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="check"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Показывать неактивные</label>
        <div className="filters-extra">
          <button className="btn primary" onClick={() => setEdit({ name: '', isWarehouse: false, active: true, city: null, fullAddress: null, organizationId: orgs?.[0]?.id ?? null })}>
            Создать
          </button>
        </div>
      </div>
      <DataTable<Address>
        rows={rows?.filter((r) => (inactive || r.active) && (!q || `${r.name} ${r.fullAddress ?? ''}`.toLowerCase().includes(q))) ?? null}
        onRow={setEdit}
        exportName="адреса"
        columns={[
          { key: 'name', label: 'Название', render: (v, r) => <>{v}{r.fullAddress && <small className="sub">{r.fullAddress}</small>}</> },
          { key: 'isWarehouse', label: 'Тип', value: (r) => (r.isWarehouse ? 'Склад' : 'Точка продаж') },
          { key: 'city', label: 'Город', render: (v) => v ?? '—' },
          { key: 'tz', label: 'Часовой пояс', value: () => timezone ?? '' },
          { key: 'organization', label: 'Организация', render: (v) => v ?? '—' },
          { key: 'active', label: 'Активный', value: (r) => (r.active ? '+' : '—') },
        ]}
      />
      <p className="hint">Часовой пояс общий для всей сети и задаётся переменной APP_TZ на сервере — по нему считаются часы на графиках и границы дня.</p>
      {edit && (
        <Modal title={edit.id ? edit.name : 'Новый адрес'} onClose={() => setEdit(null)}>
          <div className="form">
            <Field label="Название (как будет видно в отчётах)"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <Field label="Город"><input value={edit.city ?? ''} onChange={(e) => setEdit({ ...edit, city: e.target.value || null })} /></Field>
            <Field label="Полный адрес"><input value={edit.fullAddress ?? ''} onChange={(e) => setEdit({ ...edit, fullAddress: e.target.value || null })} /></Field>
            <Field label="Организация">
              <select value={edit.organizationId ?? ''} onChange={(e) => setEdit({ ...edit, organizationId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">—</option>
                {orgs?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <label className="check"><input type="checkbox" checked={edit.isWarehouse} onChange={(e) => setEdit({ ...edit, isWarehouse: e.target.checked })} /> Это склад (без кассы)</label>
            <label className="check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Активный</label>
            {error && <div className="error">{error}</div>}
            <button className="btn primary" disabled={!edit.name} onClick={save}>Сохранить</button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Organizations() {
  const [rows, reload] = useLoad<Organization[]>(() => api('/api/organizations'), []);
  const [edit, setEdit] = useState<Organization | null>(null);
  const [error, setError] = useState('');

  async function save() {
    if (!edit) return;
    setError('');
    try {
      await api(edit.id ? `/api/organizations/${edit.id}` : '/api/organizations', { method: edit.id ? 'PUT' : 'POST', body: edit });
      setEdit(null);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <div className="filters-bar">
        <div className="filters-extra">
          <button className="btn primary" onClick={() => setEdit({ name: '', inn: null, kpp: null, address: null })}>Создать</button>
        </div>
      </div>
      <DataTable<Organization>
        rows={rows}
        onRow={setEdit}
        empty="Добавьте ИП или ООО, от имени которого работают точки"
        columns={[
          { key: 'name', label: 'Название' },
          { key: 'inn', label: 'ИНН', render: (v) => v ?? '—' },
          { key: 'kpp', label: 'КПП', render: (v) => v ?? '—' },
          { key: 'address', label: 'Юридический адрес', render: (v) => v ?? '—' },
        ]}
      />
      {edit && (
        <Modal title={edit.id ? edit.name : 'Новая организация'} onClose={() => setEdit(null)}>
          <div className="form">
            <Field label="Название (ИП Иванов И. И., ООО «Ромашка»)"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <Field label="ИНН"><input inputMode="numeric" value={edit.inn ?? ''} onChange={(e) => setEdit({ ...edit, inn: e.target.value.replace(/\D/g, '') || null })} /></Field>
            <Field label="КПП (для ООО)"><input inputMode="numeric" value={edit.kpp ?? ''} onChange={(e) => setEdit({ ...edit, kpp: e.target.value.replace(/\D/g, '') || null })} /></Field>
            <Field label="Юридический адрес"><input value={edit.address ?? ''} onChange={(e) => setEdit({ ...edit, address: e.target.value || null })} /></Field>
            {error && <div className="error">{error}</div>}
            <button className="btn primary" disabled={!edit.name} onClick={save}>Сохранить</button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Devices() {
  const [rows, reload] = useLoad<Device[]>(() => api('/api/devices'), []);
  const [edit, setEdit] = useState<Device | null>(null);
  const stale = (d: Device) => Date.now() - Date.parse(d.lastSeenAt) > 30 * 60000;

  async function save() {
    if (!edit) return;
    await api(`/api/devices/${edit.id}`, { method: 'PUT', body: { name: edit.name || null } });
    setEdit(null);
    reload();
  }
  async function remove() {
    if (edit && confirm('Удалить устройство из списка? Если планшет снова выйдет на связь, он появится опять.')) {
      await api(`/api/devices/${edit.id}`, { method: 'DELETE' });
      setEdit(null);
      reload();
    }
  }

  return (
    <>
      <DataTable<Device>
        rows={rows}
        onRow={setEdit}
        empty="Пока ни один планшет не подключался"
        rowClass={(d) => (d.pending > 0 ? 'highlight' : undefined)}
        columns={[
          { key: 'name', label: 'Название', value: (d) => d.name ?? `Касса ${d.id.slice(0, 6)}` },
          { key: 'address', label: 'Адрес', render: (v) => v ?? '—' },
          { key: 'user', label: 'Последний кассир', render: (v) => v ?? '—' },
          { key: 'lastSeenAt', label: 'На связи', render: (v, d) => <span className={stale(d) ? 'muted' : 'good'}>{dateTime(v)}</span> },
          { key: 'pending', label: 'Не отправлено', align: 'right', render: (v) => (v ? <span className="bad">{v}</span> : '0') },
        ]}
      />
      <p className="hint">Планшеты-кассы появляются здесь автоматически после первого входа кассира. Если касса давно не выходила на связь или копит неотправленные чеки — проверьте интернет на точке.</p>
      {edit && (
        <Modal title="Устройство" onClose={() => setEdit(null)}>
          <div className="form">
            <Field label="Название (например, «Касса у входа»)"><input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <button className="btn primary" onClick={save}>Сохранить</button>
            <button className="btn danger" onClick={remove}>Удалить из списка</button>
          </div>
        </Modal>
      )}
    </>
  );
}
