import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AsyncPort } from '../services.js';
import type { AgentsModule } from '../modules/agents/index.js';
import type { ManagedDatabase } from '../managed/database.js';
import { DomainError } from '../modules/errors.js';
import { approvedWebhook, webhookTransport } from './transport.js';

export interface NotificationPrincipal { agentId: string; connectionId: string }
type Config = { agent_id: string; connection_id: string; revision: number; platform: string; webhook_url: string;
  secret_id: string; enabled: boolean; verified_at: string | null };
type Job = { id: string; agent_id: string; revision: number; kind: string; challenge: string; status: string; created_at: Date };
export type NotificationDelivery = (url: string, secret: string, body: Record<string, string>, signal: AbortSignal) => Promise<number>;
const deny = (): never => { throw new DomainError('forbidden', 403, 'Notification operation refused'); };
const invalid = (): never => { throw new DomainError('invalid_input', 400, 'Invalid notification configuration'); };

export function createNotifications(db: ManagedDatabase, agents: AsyncPort<AgentsModule>,
  deliver: NotificationDelivery = (url, secret, body, signal) => webhookTransport(url, secret).notify(body, signal)) {
  async function config(agentId: string) { return db.one<Config>('SELECT * FROM notification_configs WHERE agent_id=$1', [agentId]); }
  async function status(principal: NotificationPrincipal) {
    const c = await config(principal.agentId);
    if (!c || c.connection_id !== principal.connectionId) return { configured: false, active: false, receipt_confirmed: false };
    const latest = await db.one<{ status: string; kind: string; created_at: string }>(
      "SELECT status,kind,created_at FROM notification_jobs WHERE agent_id=$1 AND revision=$2 AND status NOT IN ('coalesced','cancelled') ORDER BY created_at DESC LIMIT 1", [c.agent_id,c.revision]);
    const attention = !!await db.one("SELECT 1 FROM notification_jobs WHERE agent_id=$1 AND revision=$2 AND status IN ('failed','uncertain') LIMIT 1", [c.agent_id,c.revision]);
    let credentialActive=false;
    try{const current=await agents.resolveActiveConnection(c.connection_id);credentialActive=['agent:read','agent:send','agent:inbox','agent:receive'].every((scope)=>current.connection.scopes.includes(scope as typeof current.connection.scopes[number]));}catch{/* Revocation disables delivery. */}
    return { configured: true, active: c.enabled && !!c.verified_at && credentialActive && !attention, enabled: c.enabled,
      reason:!credentialActive?'authorization_required':!c.enabled?'paused':attention?'needs_review':c.verified_at?'active':'receipt_pending',
      receipt_confirmed: !!c.verified_at, platform: c.platform, destination_host: new URL(c.webhook_url).hostname,
      connection_id: c.connection_id, needs_attention: attention, latest_delivery: latest ?? null };
  }
  async function ownerStatus(ownerId: string, agentId: string) {
    await agents.getOwnedAgent(agentId, ownerId);
    const c = await config(agentId);
    const current=(await agents.listConnections(agentId,ownerId)).filter((item)=>!item.revokedAt);
    const names=await db.rows<{client_id:string;client_name:string}>('SELECT client_id,client_name FROM oauth_clients WHERE client_id=ANY($1::text[])',[current.map((item)=>item.oauthClientId)]);
    const connections = current.map(({ id,oauthClientId,scopes }) => ({ id,oauthClientId,scopes,clientName:names.find((item)=>item.client_id===oauthClientId)?.client_name??'Cliente MCP' }));
    return { ...await status({ agentId,connectionId: c?.connection_id ?? '' }), connections };
  }
  async function configure(ownerId: string, agentId: string, input: { connectionId: string; platform: string; url: string; secret: string }) {
    await agents.getOwnedAgent(agentId,ownerId);
    const resolved = await agents.resolveActiveConnection(input.connectionId);
    if (resolved.agent.id !== agentId || !['agent:read','agent:send','agent:inbox','agent:receive'].every((s) => resolved.connection.scopes.includes(s as typeof resolved.connection.scopes[number]))) deny();
    if (!['grokbot','generic'].includes(input.platform) || input.secret.length<8 || input.secret.length>4096 || /[\r\n]/.test(input.secret)) invalid();
    try { approvedWebhook(input.url,[new URL(input.url).hostname]); } catch { invalid(); }
    await db.transaction(async () => {
      await db.lock(`notification-config:${agentId}`);
      const old = await config(agentId);
      const ref = await db.one<{ id: string }>('SELECT vault.create_secret($1) AS id',[input.secret]);
      await db.rows(`INSERT INTO notification_configs(agent_id,connection_id,platform,webhook_url,secret_id) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(agent_id) DO UPDATE SET connection_id=excluded.connection_id,platform=excluded.platform,
        webhook_url=excluded.webhook_url,secret_id=excluded.secret_id,revision=notification_configs.revision+1,
        enabled=true,verified_at=NULL,updated_at=now()`,[agentId,input.connectionId,input.platform,input.url,ref!.id]);
      await db.rows("UPDATE notification_jobs SET status='cancelled' WHERE agent_id=$1 AND status IN ('queued','sending','accepted')",[agentId]);
      if (old) await db.rows('DELETE FROM vault.secrets WHERE id=$1',[old.secret_id]);
      await db.notify('agent',agentId);
    });
    return ownerStatus(ownerId,agentId);
  }
  async function probe(ownerId: string,agentId: string,connectionId?: string) {
    await agents.getOwnedAgent(agentId,ownerId);
    return db.transaction(async () => {
      await db.lock(`notification-config:${agentId}`);
      const c = await config(agentId); if (!c) return invalid();
      if(connectionId && c.connection_id!==connectionId)return deny();
      await agents.resolveActiveConnection(c.connection_id);
      const existing = await db.one<{ id: string }>("SELECT id FROM notification_jobs WHERE agent_id=$1 AND revision=$2 AND kind='probe' AND status IN ('queued','sending','accepted') AND created_at>now()-interval '30 seconds' ORDER BY created_at DESC LIMIT 1",[agentId,c.revision]);
      if (existing) return { delivery_id: existing.id };
      await db.rows("UPDATE notification_jobs SET status='cancelled' WHERE agent_id=$1 AND kind='probe' AND status IN ('queued','sending','accepted')",[agentId]);
      await db.rows('UPDATE notification_configs SET enabled=true,verified_at=NULL WHERE agent_id=$1',[agentId]);
      const job = await db.one<{ id: string }>("INSERT INTO notification_jobs(agent_id,revision,kind) VALUES($1,$2,'probe') RETURNING id",[agentId,c.revision]);
      await db.notify('agent',agentId);
      return { delivery_id: job!.id };
    });
  }
  async function pause(ownerId: string,agentId: string,connectionId?: string) {
    await agents.getOwnedAgent(agentId,ownerId);
    await db.transaction(async () => {
      await db.lock(`notification-config:${agentId}`);
      if(connectionId && (await config(agentId))?.connection_id!==connectionId)return deny();
      await db.rows('UPDATE notification_configs SET enabled=false,verified_at=NULL,revision=revision+1 WHERE agent_id=$1',[agentId]);
      await db.rows("UPDATE notification_jobs SET status='cancelled' WHERE agent_id=$1 AND status IN ('queued','sending','accepted')",[agentId]);
      await db.notify('agent',agentId);
    });
    return ownerStatus(ownerId,agentId);
  }
  async function reconcile() {
    await db.rows("UPDATE notification_jobs j SET status='cancelled' WHERE status IN ('failed','uncertain') AND EXISTS(SELECT 1 FROM inbox_events e WHERE e.id=j.event_id AND e.acknowledged_at IS NOT NULL)");
    await db.rows(`INSERT INTO notification_jobs(agent_id,revision,kind,event_id)
      SELECT e.agent_id,c.revision,'wake',e.id FROM inbox_events e JOIN notification_configs c ON c.agent_id=e.agent_id
      JOIN agents a ON a.id=e.agent_id JOIN agent_connections ac ON ac.id=c.connection_id
      JOIN group_agent_memberships m ON m.agent_id=e.agent_id AND m.group_id=e.group_id
      WHERE c.enabled AND c.verified_at IS NOT NULL AND e.acknowledged_at IS NULL AND a.status='active' AND ac.revoked_at IS NULL AND ARRAY['agent:read','agent:send','agent:inbox','agent:receive'] <@ string_to_array(ac.scopes,' ')
      ON CONFLICT DO NOTHING`);
  }
  async function confirm(principal: NotificationPrincipal,id: string,challenge: string) {
    const result = await db.transaction(async () => {
      await db.lock(`notification-config:${principal.agentId}`);
      const c = await config(principal.agentId);
      const j = await db.one<Job>('SELECT * FROM notification_jobs WHERE id=$1',[id]);
      if (!c || !j || !c.enabled || c.connection_id!==principal.connectionId || j.agent_id!==principal.agentId || j.revision!==c.revision ||
          !['sending','accepted','confirmed','uncertain','failed'].includes(j.status) || Date.now()-new Date(j.created_at).getTime()>600_000 ||
          Buffer.byteLength(challenge)!==Buffer.byteLength(j.challenge) || !timingSafeEqual(Buffer.from(challenge),Buffer.from(j.challenge))) return deny();
      await db.rows("UPDATE notification_jobs SET status='confirmed',confirmed_at=COALESCE(confirmed_at,now()) WHERE id=$1",[id]);
      if (j.kind==='probe') await db.rows('UPDATE notification_configs SET verified_at=COALESCE(verified_at,now()) WHERE agent_id=$1',[c.agent_id]);
      if (j.kind==='probe') await db.rows("UPDATE notification_jobs SET status='cancelled' WHERE agent_id=$1 AND revision=$2 AND kind='probe' AND status IN ('failed','uncertain')",[c.agent_id,c.revision]);
      await db.notify('agent',c.agent_id);
      return { received: true, kind: j.kind };
    });
    await reconcile();
    return { ...result, ...await status(principal) };
  }
  async function dispatch() {
    await reconcile();
    const jobs = await db.transaction(async () => {
      await db.lock('notification-dispatch');
      const expired=await db.rows<{agent_id:string}>("UPDATE notification_jobs SET status='uncertain' WHERE (status='sending' AND claimed_at<now()-interval '2 minutes') OR (status='accepted' AND created_at<now()-interval '10 minutes') RETURNING agent_id");
      for(const id of new Set(expired.map((item)=>item.agent_id)))await db.notify('agent',id);
      await db.rows(`UPDATE notification_jobs j SET status='cancelled' WHERE j.status='queued' AND NOT EXISTS(
        SELECT 1 FROM notification_configs c JOIN agents a ON a.id=c.agent_id JOIN agent_connections ac ON ac.id=c.connection_id
        WHERE c.agent_id=j.agent_id AND c.revision=j.revision AND c.enabled AND a.status='active' AND ac.revoked_at IS NULL AND ARRAY['agent:read','agent:send','agent:inbox','agent:receive'] <@ string_to_array(ac.scopes,' ')
        AND (j.kind='probe' OR EXISTS(SELECT 1 FROM inbox_events e JOIN group_agent_memberships m ON m.group_id=e.group_id AND m.agent_id=e.agent_id
          WHERE e.id=j.event_id AND e.acknowledged_at IS NULL)))`);
      const selected: Array<Job & { webhook_url: string; secret: string; connection_id: string }> = [];
      for (let i=0;i<4;i++) {
        const j = await db.one<Job & { webhook_url: string; secret: string; connection_id: string }>(`SELECT j.*,c.webhook_url,c.connection_id,v.decrypted_secret AS secret
          FROM notification_jobs j JOIN notification_configs c ON c.agent_id=j.agent_id AND c.revision=j.revision
          JOIN vault.decrypted_secrets v ON v.id=c.secret_id WHERE j.status='queued' AND c.enabled
          AND (j.kind='probe' OR (c.verified_at IS NOT NULL AND (c.last_dispatched_at IS NULL OR c.last_dispatched_at<now()-interval '30 seconds')))
          ORDER BY (j.kind='probe') DESC,j.created_at LIMIT 1 FOR UPDATE OF j,c SKIP LOCKED`);
        if (!j) break;
        await db.rows("UPDATE notification_jobs SET status='sending',claimed_at=now() WHERE id=$1",[j.id]);
        if (j.kind==='wake') {
          await db.rows('UPDATE notification_configs SET last_dispatched_at=now() WHERE agent_id=$1',[j.agent_id]);
          await db.rows("UPDATE notification_jobs SET status='coalesced' WHERE agent_id=$1 AND revision=$2 AND kind='wake' AND status='queued'",[j.agent_id,j.revision]);
        }
        selected.push(j);
      }
      return selected;
    });
    await Promise.all(jobs.map(async (j) => {
      let code: number | undefined;
      try { code = await deliver(j.webhook_url,j.secret,{ version:'1',type:'agent_chat.notification',kind:j.kind,
        agent_id:j.agent_id,connection_id:j.connection_id,delivery_id:j.id,challenge:j.challenge },AbortSignal.timeout(10_000)); }
      catch { /* An ambiguous dispatch is not repeated: the routine may have started. */ }
      await db.rows(`UPDATE notification_jobs SET status=CASE WHEN status='confirmed' THEN status ELSE $2 END,
        status_code=$3,accepted_at=CASE WHEN $3=200 THEN COALESCE(accepted_at,now()) ELSE accepted_at END WHERE id=$1 AND status IN ('sending','confirmed')`,
        [j.id,code===200?'accepted':code===undefined?'uncertain':'failed',code??null]);
      await db.notify('agent',j.agent_id);
    }));
    if(jobs.length&&await db.one(`SELECT 1 FROM notification_jobs j JOIN notification_configs c ON c.agent_id=j.agent_id AND c.revision=j.revision
      WHERE j.status='queued' AND c.enabled AND (j.kind='probe' OR (c.verified_at IS NOT NULL AND (c.last_dispatched_at IS NULL OR c.last_dispatched_at<now()-interval '30 seconds'))) LIMIT 1`)) {
      await db.rows('SELECT agent_chat.kick_notification_dispatch(true)');
    }
    return { attempted: jobs.length };
  }
  async function authorizeDispatch(stamp: string,nonce: string,signature: string) {
    if (!/^\d{10}$/.test(stamp) || !/^[0-9a-f-]{36}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(signature) || Math.abs(Date.now()/1000-Number(stamp))>120) return false;
    const credential = await db.one<{ secret: string }>("SELECT decrypted_secret AS secret FROM vault.decrypted_secrets WHERE name='agent_chat_notification_dispatch'");
    if (!credential || !timingSafeEqual(Buffer.from(signature),Buffer.from(createHmac('sha256',credential.secret).update(`${stamp}.${nonce}`).digest('hex')))) return false;
    await db.rows('DELETE FROM notification_dispatch_nonces WHERE expires_at<now()');
    return !!await db.one('INSERT INTO notification_dispatch_nonces(nonce,expires_at) VALUES($1,now()+interval \'3 minutes\') ON CONFLICT DO NOTHING RETURNING nonce',[nonce]);
  }
  async function replyReceipt(principal:NotificationPrincipal,eventId:string){
    const event=await db.one<{group_id:string}>(`SELECT e.group_id FROM inbox_events e JOIN group_agent_memberships m ON m.group_id=e.group_id AND m.agent_id=e.agent_id
      WHERE e.id=$1 AND e.agent_id=$2`,[eventId,principal.agentId]);
    if(!event)return deny();
    const message=await db.one<{id:string;text:string}>(`SELECT m.id,m.text FROM message_idempotency i JOIN messages m ON m.id=i.message_id
      WHERE i.author_kind='agent' AND i.agent_author_id=$1 AND i.idempotency_key=$2 AND m.group_id=$3`,[principal.agentId,`reply:${eventId}:final`,event.group_id]);
    return {published:!!message,...(message?{message}:{}),idempotency_key:`reply:${eventId}:final`};
  }
  async function isActive(agentId:string){
    return !!await db.one(`SELECT 1 FROM notification_configs c JOIN agents a ON a.id=c.agent_id JOIN agent_connections ac ON ac.id=c.connection_id
      WHERE c.agent_id=$1 AND c.enabled AND c.verified_at IS NOT NULL AND a.status='active' AND ac.revoked_at IS NULL
      AND ARRAY['agent:read','agent:send','agent:inbox','agent:receive'] <@ string_to_array(ac.scopes,' ')
      AND NOT EXISTS(SELECT 1 FROM notification_jobs j WHERE j.agent_id=c.agent_id AND j.revision=c.revision AND j.status IN ('failed','uncertain'))`,[agentId]);
  }
  return { status,ownerStatus,configure,probe,pause,confirm,dispatch,authorizeDispatch,replyReceipt,isActive,
    initializeDispatcher: async (origin: string) => { await db.rows('UPDATE notification_settings SET dispatch_origin=$1 WHERE singleton',[origin]); } };
}
export type NotificationsModule = ReturnType<typeof createNotifications>;
