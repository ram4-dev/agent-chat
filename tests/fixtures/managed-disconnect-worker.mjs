import { ManagedDatabase } from '../../apps/server/dist/managed/database.js';
import process from 'node:process';

const db = new ManagedDatabase(process.env.DATABASE_URL);
const original = new Error('original-operation-failure');
const mode = process.argv[2];
const resume = new Promise((resolve) => process.once('message', resolve));
let attempts = 0;
let failure;
try {
  await db.transaction(async () => {
    attempts++;
    const { pid } = await db.one('SELECT pg_backend_pid() AS pid');
    process.send({ type: 'ready', pid });
    if (mode === 'query') await db.rows('SELECT pg_sleep(10)');
    else await resume;
    if (mode === 'operation-error') throw original;
  });
} catch (error) {
  failure = error;
}
const recovered = await db.one('SELECT pg_backend_pid() AS pid, 42 AS value');
await db.close();
process.send({ type: 'result', failed: !!failure, originalPreserved: failure === original,
  errorCode: failure?.code, attempts, recovered });
process.disconnect();
