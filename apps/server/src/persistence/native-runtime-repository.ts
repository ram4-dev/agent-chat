import type Database from 'better-sqlite3';
import { isPlainObject, UNKNOWN_NATIVE_CAPABILITIES, type NativeCapabilities, type NativeRuntimeTarget, type NativeBinding } from '@agent-chat/contracts';
import { runImmediateTransaction } from './client.js';

interface TargetRow {
  id: string; owner_user_id: string; provider: NativeRuntimeTarget['provider']; connector_id: string;
  native_ref: string; context_mode: NativeRuntimeTarget['contextMode']; capabilities_json: string; verified_at: number | null;
}
interface BindingRow {
  id: string; agent_id: string; owner_user_id: string; target_id: string; current_revision: number; enabled: number; legacy_projection: number;
}
const bindingView = (r: BindingRow): NativeBinding => ({
  id: r.id, agentId: r.agent_id, ownerUserId: r.owner_user_id, targetId: r.target_id,
  revision: r.current_revision, enabled: r.enabled === 1, legacyProjection: r.legacy_projection === 1,
});
function capabilities(text: string): NativeCapabilities {
  const raw: unknown = JSON.parse(text);
  if (!isPlainObject(raw)) throw new Error('Invalid native capability record');
  const result = { ...UNKNOWN_NATIVE_CAPABILITIES };
  for (const key of Object.keys(result) as (keyof NativeCapabilities)[]) {
    const value = raw[key];
    if (value === undefined) continue;
    if (value !== 'unknown' && value !== 'verified' && value !== 'unsupported') throw new Error('Invalid native capability status');
    result[key] = value;
  }
  return result;
}

/** Persistence foundation only. It does not grant authority or start consumers. */
export function createNativeRuntimeRepository(sqlite: Database.Database) {
  function findBinding(ownerUserId: string, id: string): NativeBinding | undefined {
    const row = sqlite.prepare(`SELECT b.*,v.target_id FROM native_bindings b JOIN native_binding_versions v
      ON v.binding_id=b.id AND v.revision=b.current_revision WHERE b.id=? AND b.owner_user_id=?`)
      .get(id, ownerUserId) as BindingRow | undefined;
    return row ? bindingView(row) : undefined;
  }
  function groups(bindingId: string, revision: number, groupIds: readonly string[]) {
    for (const groupId of groupIds) {
      sqlite.prepare('INSERT INTO native_binding_groups(binding_id,revision,group_id) VALUES(?,?,?)').run(bindingId, revision, groupId);
      sqlite.prepare('INSERT INTO native_conversations(binding_id,revision,group_id) VALUES(?,?,?)').run(bindingId, revision, groupId);
    }
  }
  return {
    findBinding,
    findTarget(ownerUserId: string, id: string): NativeRuntimeTarget | undefined {
      const row = sqlite.prepare('SELECT * FROM native_runtime_targets WHERE id=? AND owner_user_id=?').get(id, ownerUserId) as TargetRow | undefined;
      if (!row) return undefined;
      return { id: row.id, ownerUserId: row.owner_user_id, provider: row.provider, connectorId: row.connector_id,
        nativeRef: row.native_ref, contextMode: row.context_mode,
        capabilities: capabilities(row.capabilities_json), verifiedAt: row.verified_at };
    },
    registerTarget(input: Pick<NativeRuntimeTarget, 'id' | 'ownerUserId' | 'provider' | 'connectorId' | 'nativeRef' | 'contextMode'>): void {
      sqlite.prepare(`INSERT INTO native_runtime_targets(id,owner_user_id,provider,connector_id,native_ref,context_mode)
        VALUES(?,?,?,?,?,?)`).run(input.id, input.ownerUserId, input.provider, input.connectorId, input.nativeRef, input.contextMode);
    },
    createBinding(input: { id: string; agentId: string; ownerUserId: string; targetId: string; groupIds: readonly string[] }): NativeBinding {
      return runImmediateTransaction(sqlite, () => {
        sqlite.prepare('INSERT INTO native_bindings(id,agent_id,owner_user_id,current_revision) VALUES(?,?,?,1)').run(input.id, input.agentId, input.ownerUserId);
        sqlite.prepare('INSERT INTO native_binding_versions(binding_id,revision,target_id,owner_user_id) VALUES(?,1,?,?)').run(input.id, input.targetId, input.ownerUserId);
        groups(input.id, 1, input.groupIds);
        return findBinding(input.ownerUserId, input.id)!;
      });
    },
    replaceVersion(input: { ownerUserId: string; bindingId: string; expectedRevision: number; targetId: string; groupIds: readonly string[] }): NativeBinding {
      return runImmediateTransaction(sqlite, () => {
        const binding = findBinding(input.ownerUserId, input.bindingId);
        if (!binding || binding.legacyProjection || binding.revision !== input.expectedRevision) throw new Error('Native binding revision conflict');
        const active = sqlite.prepare(`SELECT 1 FROM native_deliveries WHERE state NOT IN ('queued','done')
          AND (binding_id=? OR target_id=?)`).get(binding.id, input.targetId);
        if (active) throw new Error('Native target has unconfirmed work');
        const revision = binding.revision + 1;
        sqlite.prepare('INSERT INTO native_binding_versions(binding_id,revision,target_id,owner_user_id) VALUES(?,?,?,?)').run(binding.id, revision, input.targetId, input.ownerUserId);
        groups(binding.id, revision, input.groupIds);
        if (binding.targetId === input.targetId) {
          for (const groupId of input.groupIds) {
            const previous = sqlite.prepare(`SELECT generation,native_ref FROM native_conversations
              WHERE binding_id=? AND revision=? AND group_id=? ORDER BY generation DESC LIMIT 1`)
              .get(binding.id, binding.revision, groupId) as { generation: number; native_ref: string | null } | undefined;
            if (previous) sqlite.prepare(`UPDATE native_conversations SET generation=?,native_ref=?
              WHERE binding_id=? AND revision=? AND group_id=?`).run(previous.generation, previous.native_ref, binding.id, revision, groupId);
          }
        }
        sqlite.prepare('UPDATE native_bindings SET current_revision=?,enabled=0 WHERE id=?').run(revision, binding.id);
        return findBinding(input.ownerUserId, binding.id)!;
      });
    },
  };
}
