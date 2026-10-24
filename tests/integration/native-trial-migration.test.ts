import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { it,expect } from 'vitest';
import { randomUUID, generateKeyPairSync, createHash, sign } from 'node:crypto';
import { mkdtemp,rm,writeFile,readFile,readdir,stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { nativeProofPayload,nativeResultPayload } from '@agent-chat/contracts';
import { createDatabase } from '../../apps/server/src/persistence/client';
import { migrateFromDirectory } from '../../apps/server/src/persistence/migrate';
import { createServices } from '../../apps/server/src/services';
import { trialMigration } from '../../apps/server/src/modules/native-access/trial-migration';
it('migrates only a paused quiescent copy, publishes once and rolls back without changing source or OAuth',async()=>{
 const root=await mkdtemp(join(tmpdir(),'native-migration-'));const source=createDatabase({path:join(root,'source.db'),busyTimeoutMs:1000});
 let copy:ReturnType<typeof createDatabase>|undefined;
 try{
  migrateFromDirectory(source.sqlite,resolve('db/migrations'));const s=createServices(source);const owner=randomUUID();source.sqlite.prepare('INSERT INTO users(id,email,password_hash,display_name) VALUES(?,?,?,?)').run(owner,'trial@example.com','fixture','Trial');
  const agent=s.agents.createAgent({ownerUserId:owner,name:'Trial'});const group=s.groups.createGroup({userId:owner,name:'Trial'}).group.id;s.groups.admitAgent({userId:owner,groupId:group,agentId:agent.id});
  s.automation.configureForOwner(owner,agent.id,group,false);
  source.sqlite.prepare('UPDATE agent_automation_bindings SET thread_id=? WHERE agent_id=?').run('legacy-conversation',agent.id);
  const targetId=randomUUID();s.nativeAccess.repository.registerTarget({id:targetId,ownerUserId:owner,provider:'hermes',connectorId:'trial',nativeRef:'synthetic',contextMode:'native_per_group'});
  const client=randomUUID();source.sqlite.prepare('INSERT INTO oauth_clients(client_id,client_name,redirect_uris) VALUES(?,?,?)').run(client,'fixture','[]');
  const connection=s.agents.createConnection({agentId:agent.id,oauthClientId:client});
  await promisify(execFile)(process.execPath,['scripts/native-trial-copy.mjs',join(root,'source.db'),join(root,'copy.db')]);
  await expect(promisify(execFile)(process.execPath,['scripts/native-trial-copy.mjs',join(root,'source.db'),join(root,'copy.db')])).rejects.toThrow();copy=createDatabase({path:join(root,'copy.db'),busyTimeoutMs:1000});const c=createServices(copy);const migration=trialMigration(copy.sqlite,'agent-chat-disposable-copy');
  copy.sqlite.prepare('UPDATE agent_automation_bindings SET enabled=1').run();expect(()=>migration.apply(owner,agent.id,targetId)).toThrow('Pause');copy.sqlite.prepare('UPDATE agent_automation_bindings SET enabled=0').run();
  const manifest=migration.apply(owner,agent.id,targetId);expect(c.nativeAccess.repository.findBinding(owner,manifest.bindingId)).toMatchObject({enabled:false,legacyProjection:false});
  expect(source.sqlite.prepare('SELECT count(*) AS n FROM native_bindings').get()).toEqual({n:0});
  const keys=generateKeyPairSync('ed25519');c.nativeAccess.setProofKey(owner,targetId,keys.publicKey.export({type:'spki',format:'pem'}).toString());copy.sqlite.prepare('UPDATE native_runtime_targets SET capabilities_json=? WHERE id=?').run(JSON.stringify({groupIsolation:'verified',durableResults:'verified',approvals:'verified',toolCatalog:'verified',nativeVisibility:'verified'}),targetId);
  const challenge=c.nativeAccess.createChallenge(owner,{kind:'automatic',connectionId:connection.id,bindingId:manifest.bindingId,revision:manifest.revision,targetId,scopes:['native:read','native:claim','native:start','native:complete']});c.nativeAccess.consumeChallenge(connection.id,challenge.challenge,{bindingId:manifest.bindingId,revision:manifest.revision,targetId});
  c.nativeDelivery.configureOwner(owner,manifest.bindingId,manifest.revision,true);const controller=randomUUID();const {epoch}=c.nativeDelivery.open(connection.id,controller);
  c.messaging.send({author:{kind:'human',id:owner},groupId:group,text:'Synthetic migration message',idempotencyKey:'trial'});const d=c.nativeDelivery.next(connection.id,controller,epoch).delivery!;c.nativeDelivery.begin(connection.id,d.ticket);
  c.nativeDelivery.configureOwner(owner,manifest.bindingId,manifest.revision,false);expect(()=>migration.rollback(manifest)).toThrow('Unconfirmed');
  const result={decision:'reply' as const,text:'Synthetic native reply',conversationRef:'trial-native'};const data={eventId:d.ticket.eventId,targetId,startKey:d.startKey,runRef:'trial-run',terminal:'completed' as const,resultHash:createHash('sha256').update(nativeResultPayload(result)).digest('hex')};
  // Pause is respected: resume explicitly before authenticated completion/publication.
  c.nativeDelivery.configureOwner(owner,manifest.bindingId,manifest.revision,true);c.nativeDelivery.save(connection.id,d.ticket,result,{data,signature:sign(null,Buffer.from(nativeProofPayload(data)),keys.privateKey).toString('base64url')});const receipt=c.nativeDelivery.finish(connection.id,d.ticket);expect(receipt.messageId).toBeTruthy();expect(c.nativeDelivery.finish(connection.id,d.ticket)).toEqual(receipt);
  c.nativeDelivery.configureOwner(owner,manifest.bindingId,manifest.revision,false);const back=migration.rollback(manifest);expect(back.legacyProjection).toBe(true);expect(back.revision).toBeGreaterThan(manifest.revision);
  expect(copy.sqlite.prepare('SELECT enabled,thread_id FROM agent_automation_bindings WHERE agent_id=?').get(agent.id)).toEqual({enabled:0,thread_id:'legacy-conversation'});
  expect(()=>c.nativeAccess.resolve(connection.id)).toThrow();
  expect(source.sqlite.prepare('SELECT * FROM agent_connections').all()).toEqual(copy.sqlite.prepare('SELECT * FROM agent_connections').all());
  expect(source.sqlite.prepare('SELECT * FROM oauth_clients').all()).toEqual(copy.sqlite.prepare('SELECT * FROM oauth_clients').all());
 } finally{copy?.close();source.close();await rm(root,{recursive:true,force:true});}
});

it('never overwrites a trimmed destination and removes only private failed backups',async()=>{
 const root=await mkdtemp(join(tmpdir(),'native-copy-safety-'));const source=join(root,'source.db');const existing=join(root,'existing.db');const target=join(root,'retry.db');
 const db=createDatabase({path:source,busyTimeoutMs:1000});db.sqlite.exec('CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES(\'fixture\')');db.close();
 const run=(input:string,output:string)=>promisify(execFile)(process.execPath,['scripts/native-trial-copy.mjs',input,output]);
 try{
  await writeFile(existing,'EXISTING-DESTINATION');
  for(const destination of [existing+' ',existing+'\t',' '+existing,existing]){
   await expect(run(source,destination)).rejects.toThrow();expect(await readFile(existing,'utf8')).toBe('EXISTING-DESTINATION');
  }
  await expect(run(join(root,'missing.db'),target)).rejects.toThrow();
  expect(await readdir(root)).toEqual(expect.not.arrayContaining(['retry.db']));
  const corrupt=join(root,'corrupt.db');await writeFile(corrupt,'not a SQLite database');await expect(run(corrupt,target)).rejects.toThrow();
  expect((await readdir(root)).some(name=>name.startsWith('.agent-chat-backup-'))).toBe(false);
  expect((await readdir(root)).includes('retry.db')).toBe(false);
  await run(source,target);expect((await stat(target)).mode & 0o777).toBe(0o600);const copied=createDatabase({path:target,busyTimeoutMs:1000});try{expect(copied.sqlite.prepare('SELECT value FROM sentinel').get()).toEqual({value:'fixture'});}finally{copied.close();}
  expect((await readdir(root)).some(name=>name.startsWith('.agent-chat-backup-'))).toBe(false);
 }finally{await rm(root,{recursive:true,force:true});}
});
