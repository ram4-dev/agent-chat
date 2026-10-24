import { afterAll,afterEach,expect,it } from 'vitest';
import { randomUUID,createHmac } from 'node:crypto';
import { ManagedDatabase } from '../../apps/server/src/managed/database';
import { createManagedServices } from '../../apps/server/src/managed/services';
import { createNotifications,type NotificationDelivery } from '../../apps/server/src/notifications/module';

const url=process.env['DATABASE_URL'];
if(!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('Notification tests require disposable local Supabase');
const db=new ManagedDatabase(url);afterEach(async()=>{await db.rows("UPDATE notification_jobs SET status='cancelled' WHERE status='queued'");});
afterAll(async()=>{await db.close();});
// No outbound networking: the delivery port is exercised against a controlled provider.
async function fixture(deliver:NotificationDelivery){
  const services=createManagedServices(db,{url:process.env['SUPABASE_URL']!,anonKey:process.env['SUPABASE_ANON_KEY']!,publicOrigin:'http://127.0.0.1:4319'});
  const user=await services.identity.createUser({email:`notifications-${randomUUID()}@example.com`,displayName:'Notification owner',passwordHash:'external'});
  const agent=await services.agents.createAgent({ownerUserId:user.id,name:'Notification agent'});
  const client=randomUUID();await db.rows("INSERT INTO oauth_clients(client_id,client_name,redirect_uris) VALUES($1,'Notifications','[]')",[client]);
  const connection=await services.agents.createConnection({agentId:agent.id,oauthClientId:client});
  const {group}=await services.groups.createGroup({userId:user.id,name:'Notification test'});
  await services.groups.admitAgent({userId:user.id,groupId:group.id,agentId:agent.id});
  const notifications=createNotifications(db,services.agents,deliver);
  const principal={agentId:agent.id,connectionId:connection.id};
  const configure=()=>notifications.configure(user.id,agent.id,{connectionId:connection.id,platform:'grokbot',url:'https://notifications.example.com/routine',secret:'fixture-private-key'});
  return {services,user,agent,connection,group,notifications,principal,configure};
}

it('requires real MCP receipt, preserves pending messages and coalesces wake dispatch',async()=>{
  const delivered:Array<Record<string,string>>=[];
  const f=await fixture(async(_url,_secret,body)=>{delivered.push(body);return 200;});
  await f.configure();
  expect(await f.notifications.status(f.principal)).toMatchObject({configured:true,active:false});
  await f.notifications.probe(f.user.id,f.agent.id);await f.notifications.dispatch();
  expect(delivered).toHaveLength(1);
  expect(await f.notifications.status(f.principal)).toMatchObject({active:false,latest_delivery:{status:'accepted'}});
  await expect(f.notifications.confirm(f.principal,delivered[0]!.delivery_id!,'0'.repeat(48))).rejects.toMatchObject({code:'forbidden'});
  const confirmed=await f.notifications.confirm(f.principal,delivered[0]!.delivery_id!,delivered[0]!.challenge!);
  expect(confirmed).toMatchObject({active:true,receipt_confirmed:true,kind:'probe'});
  for(const text of ['One','Two'])await f.services.messaging.send({author:{kind:'human',id:f.user.id},groupId:f.group.id,text,idempotencyKey:randomUUID()});
  expect((await f.services.inbox.listPending({agentId:f.agent.id})).events).toHaveLength(2);
  await Promise.all([f.notifications.dispatch(),f.notifications.dispatch()]);
  expect(delivered.filter((x)=>x.kind==='wake')).toHaveLength(1);
  expect(JSON.stringify(delivered)).not.toContain('One');expect(JSON.stringify(delivered)).not.toContain('fixture-private-key');
  expect((await f.services.inbox.listPending({agentId:f.agent.id})).events).toHaveLength(2);
  await f.notifications.pause(f.user.id,f.agent.id);
  expect(await f.notifications.status(f.principal)).toMatchObject({active:false,enabled:false});
  await expect(f.notifications.confirm(f.principal,delivered[1]!.delivery_id!,delivered[1]!.challenge!)).rejects.toMatchObject({code:'forbidden'});
});

it('does not repeat an ambiguous dispatch or leak its credentials through status',async()=>{
  let attempts=0;
  const f=await fixture(async()=>{attempts++;throw new Error('Network response lost');});
  const configured=await f.configure();expect(JSON.stringify(configured)).not.toContain('fixture-private-key');
  await f.notifications.probe(f.user.id,f.agent.id);await f.notifications.dispatch();await f.notifications.dispatch();
  expect(attempts).toBe(1);expect(await f.notifications.status(f.principal)).toMatchObject({active:false,needs_attention:true,latest_delivery:{status:'uncertain'}});
  expect((await f.services.inbox.listPending({agentId:f.agent.id})).events).toHaveLength(0);
});

it('binds configuration and confirmations to the owner and exact OAuth connection',async()=>{
  let wake:Record<string,string>={};const f=await fixture(async(_u,_k,b)=>{wake=b;return 200;});
  await expect(f.notifications.configure(randomUUID(),f.agent.id,{connectionId:f.connection.id,platform:'grokbot',url:'https://notifications.example.com/routine',secret:'fixture-private-key'})).rejects.toMatchObject({code:'not_found'});
  await f.configure();await f.notifications.probe(f.user.id,f.agent.id);await f.notifications.dispatch();
  await expect(f.notifications.confirm({...f.principal,connectionId:randomUUID()},wake.delivery_id!,wake.challenge!)).rejects.toMatchObject({code:'forbidden'});
  await f.services.agents.revokeConnection(f.connection.id,f.user.id);
  expect(await f.notifications.status(f.principal)).toMatchObject({active:false});
});

it('authenticates dispatcher calls with expiring single-use signatures',async()=>{
  const f=await fixture(async()=>200);
  const stamp=String(Math.floor(Date.now()/1000)),nonce=randomUUID();
  const key=await db.one<{secret:string}>("SELECT decrypted_secret AS secret FROM vault.decrypted_secrets WHERE name='agent_chat_notification_dispatch'");
  const signature=createHmac('sha256',key!.secret).update(`${stamp}.${nonce}`).digest('hex');
  expect(await f.notifications.authorizeDispatch(stamp,nonce,'0'.repeat(64))).toBe(false);
  expect(await f.notifications.authorizeDispatch(stamp,nonce,signature)).toBe(true);
  expect(await f.notifications.authorizeDispatch(stamp,nonce,signature)).toBe(false);
  expect(await f.notifications.authorizeDispatch('1000000000',randomUUID(),signature)).toBe(false);
});

it('cancels queued delivery after revocation and denies direct database roles access to configuration',async()=>{
  let attempts=0;const f=await fixture(async()=>{attempts++;return 200;});
  await f.configure();await f.notifications.probe(f.user.id,f.agent.id);
  await f.services.agents.revokeConnection(f.connection.id,f.user.id);await f.notifications.dispatch();expect(attempts).toBe(0);
  for(const role of ['anon','authenticated'])await expect(db.transaction(async()=>{
    await db.rows(`SET LOCAL ROLE ${role}`);await db.rows('SELECT * FROM agent_chat.notification_configs');
  })).rejects.toMatchObject({code:'42501'});
});
