import { createClient } from '@supabase/supabase-js';
import { ManagedDatabase } from './database.js';
import { createManagedServices, MESSAGE_VIEW } from './services.js';
import { createManagedOAuthStore } from './oauth-store.js';
import { createApp } from '../app.js';
import type { RuntimeConfig } from '../config/env.js';
import type { MessageView } from '@agent-chat/contracts';
import { registerManagedRecovery } from './recovery.js';

/** Compose without writing local files or requiring process-local authoritative state. */
export async function createManagedApp(config: RuntimeConfig) {
  if (!config.managed) throw new Error('Managed configuration required');
  const managed = config.managed;
  const db = new ManagedDatabase(managed.databaseUrl, managed.databaseCa);
  try {
    await db.ping();
    const services = createManagedServices(db, { url: managed.supabaseUrl, anonKey: managed.supabaseAnonKey, publicOrigin: config.publicOrigin });
    let cursor = Number((await db.one<{ sequence: string }>('SELECT COALESCE(MAX(sequence),0) AS sequence FROM change_events'))!.sequence);
    let draining = false;
    let stopped = false;
    const drain = async () => {
      if (draining || stopped) return;
      draining = true;
      try {
        const events = await db.rows<{ sequence: string; kind: string; entity_id: string }>('SELECT sequence,kind,entity_id FROM change_events WHERE sequence>$1 ORDER BY sequence LIMIT 200', [cursor]);
        for (const event of events) {
          if (event.kind === 'message') {
            const message = await db.one<MessageView>(`${MESSAGE_VIEW} WHERE m.id=$1`, [event.entity_id]);
            if (message) services.hub.publishMessage(message);
          } else if (event.kind === 'agent') services.hub.publishAgentState(event.entity_id);
          cursor = Number(event.sequence);
        }
      } catch { /* Durable hints remain available; the next pass retries. */ }
      finally { draining = false; }
    };
    const realtime = createClient(managed.supabaseUrl, managed.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const channel = realtime.channel('agent-chat:server', { config: { private: true } })
      .on('broadcast', { event: 'changed' }, () => { void drain(); }).subscribe();
    // A reconnect or missed broadcast cannot lose a committed notification.
    const timer = setInterval(() => { void drain(); }, 1500);
    timer.unref();
    const app = await createApp({
      config, services, oauthStore: createManagedOAuthStore(db), health: () => db.ping(),
      budget: async (key, max) => {
        const row = await db.one<{ count: number }>(`INSERT INTO request_budgets(principal,bucket,count) VALUES($1,$2,1)
          ON CONFLICT(principal,bucket) DO UPDATE SET count=request_budgets.count+1 RETURNING count`, [key, Math.floor(Date.now() / 60000)]);
        return row!.count <= max;
      },
    });
    registerManagedRecovery(app, db, { url: managed.supabaseUrl, anonKey: managed.supabaseAnonKey, publicOrigin: config.publicOrigin });
    app.addHook('onClose', async () => {
      stopped = true;
      clearInterval(timer);
      await realtime.removeChannel(channel);
      await db.close();
    });
    return app;
  } catch (error) {
    await db.close();
    throw error;
  }
}
