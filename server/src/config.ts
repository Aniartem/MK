export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://mk:mk@localhost:5432/mk',
  jwtSecret: process.env.JWT_SECRET ?? (process.env.NODE_ENV === 'production' ? fail('JWT_SECRET') : 'dev-secret-change-me'),
  // Часовой пояс точек: по нему считаются часы на графике и границы дней
  timezone: process.env.APP_TZ ?? 'Europe/Moscow',
  staticDir: process.env.STATIC_DIR,
};

function fail(name: string): never {
  throw new Error(`Не задана переменная окружения ${name}`);
}
