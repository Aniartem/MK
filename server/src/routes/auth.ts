import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db.js';
import { anyUser } from '../auth.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string(), password: z.string() }).parse(req.body);
    const [user] = await query(
      `select id, name, role, password_hash from users
       where lower(email) = lower($1) and active and role in ('owner', 'manager')`,
      [body.email],
    );
    if (!user?.password_hash || !(await bcrypt.compare(body.password, user.password_hash))) {
      return reply.code(401).send({ error: 'Неверный email или пароль' });
    }
    const payload = { id: user.id, name: user.name, role: user.role };
    return { token: app.jwt.sign(payload, { expiresIn: '30d' }), user: payload };
  });

  // Вход кассира на планшете: точка выбрана при настройке планшета, кассир вводит PIN
  app.post('/api/auth/pin', async (req, reply) => {
    const body = z.object({ addressId: z.number().int(), pin: z.string().regex(/^\d{4}$/) }).parse(req.body);
    const [address] = await query('select id from addresses where id = $1 and active and not is_warehouse', [body.addressId]);
    if (!address) return reply.code(400).send({ error: 'Точка не найдена' });
    const candidates = await query(`select id, name, role, pin_hash from users where active and pin_hash is not null`);
    for (const u of candidates) {
      if (await bcrypt.compare(body.pin, u.pin_hash)) {
        const payload = { id: u.id, name: u.name, role: u.role, addressId: body.addressId };
        return { token: app.jwt.sign(payload, { expiresIn: '16h' }), user: payload };
      }
    }
    return reply.code(401).send({ error: 'Неверный PIN' });
  });

  // Список точек для первичной настройки планшета
  app.get('/api/public/addresses', async () =>
    query('select id, name from addresses where active and not is_warehouse order by name'),
  );

  app.get('/api/me', { preHandler: anyUser }, async (req) => req.user);
}
