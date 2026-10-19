import { useState } from 'react';
import { api, setToken } from '../api';

export default function Login({ onLogin }: { onLogin: (u: { name: string; role: string }) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const res = await api('/api/auth/login', { method: 'POST', body: { email, password } });
      setToken(res.token);
      onLogin(res.user);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <div className="logo">
          <span className="logo-mark">MK</span> Бэк-офис
        </div>
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label>
          Пароль
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn primary">Войти</button>
      </form>
    </div>
  );
}
