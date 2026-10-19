import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, getToken, setToken } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Journal from './pages/Journal';
import Products from './pages/Products';
import Employees from './pages/Employees';
import Addresses from './pages/Addresses';
import Plans from './pages/Plans';
import Budget from './pages/Budget';
import { Counterparties, Promotions } from './pages/Partners';
import { AbcReport, HourlyReport, LossesReport, MovementReport, ProductionReport, SalesReport, StockReport } from './pages/Reports';

const nav: { section?: string; items: [string, string, string][] }[] = [
  { items: [['/', 'Рабочий стол', '▦'], ['/journal', 'Журнал документов', '☰'], ['/budget', 'Бюджет', '₽']] },
  {
    section: 'Отчёты',
    items: [
      ['/sales', 'Продажи', '◫'], ['/production', 'Производство', '≋'], ['/stock', 'Склад', '▣'], ['/movement', 'Движения', '⇄'],
      ['/hourly', 'Часовые', '◷'], ['/losses', 'Потери', '⌫'], ['/abc', 'ABC', '▮'],
    ],
  },
  {
    section: 'Управление',
    items: [
      ['/products', 'Номенклатура', '≡'], ['/employees', 'Сотрудники', '☺'], ['/counterparties', 'Контрагенты', '▤'],
      ['/promotions', 'Лояльность', '%'], ['/plans', 'Планирование', '◎'], ['/addresses', 'Точки продаж', '⌂'],
    ],
  },
];

export default function App() {
  const [user, setUser] = useState<{ name: string; role: string } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) return setReady(true);
    api('/api/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  if (!ready) return null;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-mark">MK</span> Бэк-офис
        </div>
        {nav.map((group, i) => (
          <nav key={i}>
            {group.section && <div className="nav-section">{group.section}</div>}
            {group.items.map(([to, label, icon]) => (
              <NavLink key={to} to={to} end className="nav-link">
                <span className="nav-icon">{icon}</span>
                {label}
              </NavLink>
            ))}
          </nav>
        ))}
        <nav>
          <div className="nav-section">Аккаунт</div>
          <div className="nav-user">{user.name}</div>
          <a
            className="nav-link"
            href="#"
            onClick={() => {
              setToken(null);
              location.href = '/';
            }}
          >
            <span className="nav-icon">⏻</span>Выйти
          </a>
        </nav>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/budget" element={<Budget />} />
          <Route path="/sales" element={<SalesReport />} />
          <Route path="/production" element={<ProductionReport />} />
          <Route path="/stock" element={<StockReport />} />
          <Route path="/movement" element={<MovementReport />} />
          <Route path="/hourly" element={<HourlyReport />} />
          <Route path="/losses" element={<LossesReport />} />
          <Route path="/abc" element={<AbcReport />} />
          <Route path="/counterparties" element={<Counterparties />} />
          <Route path="/promotions" element={<Promotions />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/products" element={<Products />} />
          <Route path="/employees" element={<Employees />} />
          <Route path="/addresses" element={<Addresses />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
