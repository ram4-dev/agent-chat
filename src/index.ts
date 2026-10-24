// Vercel detects the framework from a direct import in the monorepo entrypoint.
import 'fastify';
import './vercel-assets.generated.js';
import { readConfig } from '../apps/server/src/config/env.js';
import { createManagedApp } from '../apps/server/src/managed/runtime.js';

// Vercel's Fastify framework adapter captures the listener; no SQLite path exists here.
const config = readConfig({ env: process.env, repoRoot: process.cwd() });
if (!config.managed) throw new Error('Vercel entrypoint requires managed storage');
const app = await createManagedApp(config);
void app.listen({ port: Number(process.env['PORT'] ?? 3000), host: '0.0.0.0' });
