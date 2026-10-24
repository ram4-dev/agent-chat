import { Pool, type PoolClient } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';

export class ManagedDatabase {
  private readonly pool: Pool;
  private readonly transactionContext = new AsyncLocalStorage<PoolClient>();

  constructor(url: string, ca?: string) {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
    for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) parsed.searchParams.delete(key);
    this.pool = new Pool({
      connectionString: parsed.toString(),
      max: 3,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 20_000,
      allowExitOnIdle: true,
      ssl: local ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    });
    // Connection loss must not expose the connection string through a logged Error.
    this.pool.on('error', () => console.error('Postgres idle connection lost'));
  }

  async rows<T>(sql: string, values: unknown[] = []): Promise<T[]> {
    const executor = this.transactionContext.getStore();
    if (!executor) return this.transaction(() => this.rows<T>(sql, values));
    const result = await executor.query(sql, values);
    return result.rows as T[];
  }

  async one<T>(sql: string, values: unknown[] = []): Promise<T | undefined> {
    return (await this.rows<T>(sql, values))[0];
  }

  async transaction<T>(operation: () => Promise<T>): Promise<T> {
    if (this.transactionContext.getStore()) return operation();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL search_path TO agent_chat,public; SET LOCAL statement_timeout=10000');
      const result = await this.transactionContext.run(client, operation);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async lock(key: string): Promise<void> {
    await this.rows('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
  }

  async notify(kind: 'message' | 'agent' | 'membership', id: string): Promise<void> {
    await this.rows('INSERT INTO change_events(kind,entity_id) VALUES($1,$2)', [kind, id]);
    await this.rows("SELECT realtime.send($1::jsonb,'changed','agent-chat:server',true)", [JSON.stringify({ kind, id })]);
  }

  async ping(): Promise<boolean> {
    return !!await this.one('SELECT 1 FROM agent_chat.users LIMIT 1').then(() => true);
  }

  async close(): Promise<void> { await this.pool.end(); }
}
