import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://mk:mk@localhost:5432/mk_test' },
    fileParallelism: false,
  },
});
