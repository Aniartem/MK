import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate } from './migrate.js';

await migrate();
const app = await buildApp();
await app.listen({ port: config.port, host: '0.0.0.0' });
