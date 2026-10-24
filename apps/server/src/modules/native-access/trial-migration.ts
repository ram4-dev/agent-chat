import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { runImmediateTransaction } from '../../persistence/client.js';
import { createNativeRuntimeRepository } from '../../persistence/native-runtime-repository.js';
export interface TrialMigration { owner: string; agentId: string; bindingId: string; revision: number; legacyTargetId: string; nativeTargetId: string; groupIds: string[] }
/** Offline disposable-copy operation only. Not registered as an HTTP or MCP operation. */
export function trialMigration(sqlite: Database.Database, copyMarker: string) {
  if (copyMarker !== 'agent-chat-disposable-copy') throw new Error('Trial copy required');
  const repository=createNativeRuntimeRepository(sqlite);
  function quiescent(agentId:string,targetId:string,bindingId?:string) {
    if(sqlite.prepare("SELECT 1 FROM agent_automation_jobs WHERE agent_id=? AND state!='done'").get(agentId) ||
       sqlite.prepare("SELECT 1 FROM native_deliveries WHERE state NOT IN ('queued','done') AND (agent_id=? OR target_id=? OR binding_id=?)").get(agentId,targetId,bindingId??'')) throw new Error('Unconfirmed work prevents migration');
    if(sqlite.prepare('SELECT 1 FROM agent_automation_bindings WHERE agent_id=? AND enabled=1').get(agentId)) throw new Error('Pause legacy bindings first');
  }
  return {
    apply(owner:string,agentId:string,targetId:string):TrialMigration {
      return runImmediateTransaction(sqlite,()=>{
        const agent=sqlite.prepare('SELECT 1 FROM agents WHERE id=? AND owner_user_id=? AND status=\'active\'').get(agentId,owner);
        const target=repository.findTarget(owner,targetId);if(!agent||!target||target.provider==='legacy_codex')throw new Error('Owned native target required');
        const current=sqlite.prepare('SELECT id,current_revision,legacy_projection FROM native_bindings WHERE agent_id=? AND owner_user_id=?').get(agentId,owner) as {id:string;current_revision:number;legacy_projection:number}|undefined;
        if(current && current.legacy_projection!==1)throw new Error('Native binding already selected');
        quiescent(agentId,targetId,current?.id);
        const groups=(sqlite.prepare('SELECT group_id FROM agent_automation_bindings WHERE agent_id=?').all(agentId) as {group_id:string}[]).map(r=>r.group_id);
        if(!groups.length)throw new Error('Legacy selection required');
        if(groups.some(group=>!sqlite.prepare('SELECT 1 FROM group_agent_memberships WHERE group_id=? AND agent_id=?').get(group,agentId)))throw new Error('Current membership required');
        let legacyTargetId=agentId;
        if(current)legacyTargetId=repository.findBinding(owner,current.id)!.targetId;
        else { repository.registerTarget({id:legacyTargetId,ownerUserId:owner,provider:'legacy_codex',connectorId:'legacy-local',nativeRef:agentId,contextMode:'native_per_group'}); }
        const id=current?.id??randomUUID();const revision=(current?.current_revision??0)+1;
        if(current)sqlite.prepare('UPDATE native_bindings SET legacy_projection=0,enabled=0 WHERE id=?').run(id);
        else sqlite.prepare('INSERT INTO native_bindings(id,agent_id,owner_user_id,current_revision) VALUES(?,?,?,?)').run(id,agentId,owner,revision);
        sqlite.prepare('INSERT INTO native_binding_versions VALUES(?,?,?,?)').run(id,revision,targetId,owner);
        for(const group of groups){sqlite.prepare('INSERT INTO native_binding_groups(binding_id,revision,group_id) VALUES(?,?,?)').run(id,revision,group);sqlite.prepare('INSERT INTO native_conversations(binding_id,revision,group_id) VALUES(?,?,?)').run(id,revision,group);}
        sqlite.prepare('UPDATE native_bindings SET current_revision=? WHERE id=?').run(revision,id);
        return {owner,agentId,bindingId:id,revision,legacyTargetId,nativeTargetId:targetId,groupIds:groups};
      });
    },
    rollback(manifest:TrialMigration) {
      return runImmediateTransaction(sqlite,()=>{
        const binding=repository.findBinding(manifest.owner,manifest.bindingId);
        if(!binding||binding.agentId!==manifest.agentId||binding.revision!==manifest.revision||binding.targetId!==manifest.nativeTargetId||binding.enabled)throw new Error('Pause exact migrated binding first');
        quiescent(manifest.agentId,manifest.nativeTargetId,manifest.bindingId);
        const next=repository.replaceVersion({ownerUserId:manifest.owner,bindingId:manifest.bindingId,expectedRevision:manifest.revision,targetId:manifest.legacyTargetId,groupIds:manifest.groupIds});
        sqlite.prepare('UPDATE native_bindings SET legacy_projection=1 WHERE id=?').run(binding.id);
        return {...next,legacyProjection:true}; // Legacy remains paused; activation requires an explicit owner action.
      });
    },
  };
}
