// Создание первого владельца на чистом сервере:
//   docker compose exec app node server/dist/create-owner.js email@example.ru пароль "Имя"
import bcrypt from 'bcryptjs';
import { pool, query } from './db.js';
import { migrate } from './migrate.js';

const [email, password, name = 'Владелец'] = process.argv.slice(2);
if (!email || !password || password.length < 6) {
  console.error('Использование: create-owner <email> <пароль от 6 символов> [имя]');
  process.exit(1);
}
await migrate();
await query(
  `insert into users (name, role, email, password_hash) values ($1, 'owner', $2, $3)
   on conflict (email) do update set password_hash = excluded.password_hash, active = true`,
  [name, email, await bcrypt.hash(password, 10)],
);
console.log(`Владелец ${email} создан`);
await pool.end();
