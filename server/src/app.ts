import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { ZodError } from 'zod';
import { config } from './config.js';
import { authRoutes } from './routes/auth.js';
import { manageRoutes } from './routes/manage.js';
import { posRoutes } from './routes/pos.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { documentRoutes } from './routes/documents.js';
import { reportRoutes } from './routes/reports.js';
import { budgetRoutes } from './routes/budget.js';

export async function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: config.jwtSecret });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'Неверные данные', details: err.issues });
    app.log.error(err);
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status).send({ error: status === 500 ? 'Ошибка сервера' : (err as Error).message });
  });

  app.get('/api/health', async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(manageRoutes);
  await app.register(posRoutes);
  await app.register(dashboardRoutes);
  await app.register(documentRoutes);
  await app.register(reportRoutes);
  await app.register(budgetRoutes);

  // В продакшене сервер отдаёт собранные кабинет (/) и кассу (/pos/)
  if (config.staticDir) {
    await app.register(fastifyStatic, { root: path.resolve(config.staticDir), wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Не найдено' });
      return reply.sendFile(req.url.startsWith('/pos') ? 'pos/index.html' : 'index.html');
    });
  }
  return app;
}
