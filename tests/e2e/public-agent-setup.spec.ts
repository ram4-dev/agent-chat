import {randomUUID} from 'node:crypto';
import {expect,test} from '@playwright/test';
import {authorizeAgent,mcpClient,payload} from './helpers/agent';
import {signUp,createGroup,addAgent,send,agents} from './helpers/ui';
import {notificationHarness} from '../helpers/notification-harness';
const scope='openid agent:read agent:send agent:inbox agent:receive agent:manage';

for(const mobile of [false,true])test(`public skill, new identities and directed mentions (${mobile?'mobile':'desktop'})`,async({page})=>{
 if(mobile)await page.setViewportSize({width:390,height:844});
 await page.goto('/');const origin=new URL(page.url()).origin;
 const skill=await page.request.get('/skills/agent-chat/SKILL.md');expect(skill.status()).toBe(200);expect(await skill.text()).toContain(origin+'/mcp');
 await signUp(page,`mention-${randomUUID()}@example.com`,'Mention owner');
 await agents(page);await page.getByRole('button',{name:'Conectar cliente',exact:true}).click();
 await expect(page.getByLabel('Skill para configurar un agente',{exact:true})).toHaveValue(origin+'/skills/agent-chat/SKILL.md');
 const first=await authorizeAgent(page,origin,undefined,undefined,scope);const a=await mcpClient(origin,first.token);
 let b:Awaited<ReturnType<typeof mcpClient>>|undefined;
 try{
  expect(payload<{agent:{id:string}}>(await a.callTool({name:'configure_agent_profile',arguments:{name:'Alpha',description:'First bot'}})).agent.id).toBe(first.agentId);
  const second=await authorizeAgent(page,origin,undefined,undefined,scope);b=await mcpClient(origin,second.token);
  payload(await b.callTool({name:'configure_agent_profile',arguments:{name:'Beta'}}));expect(first.agentId).not.toBe(second.agentId);
  await page.goto(origin);await expect(page.getByRole('main')).toHaveClass(/workspace/);
  const group=await createGroup(page,'Conversación dirigida');await addAgent(page,'Alpha');await addAgent(page,'Beta');
  if(mobile)await page.getByRole('button',{name:'Cerrar detalles',exact:true}).click();
  const message=page.getByLabel('Mensaje',{exact:true});await message.fill('@Al');
  await expect(page.getByRole('listbox',{name:'Agentes para mencionar'})).toBeVisible();
  await page.screenshot({path:`.local-state/verification/mention-picker-${mobile?'mobile':'desktop'}.png`,fullPage:true});
  await message.press('Enter');await expect(page.getByRole('button',{name:'Quitar mención a Alpha',exact:true})).toBeVisible();
  await message.fill('@AlphaOther');await expect(page.getByRole('button',{name:'Quitar mención a Alpha',exact:true})).toHaveCount(0);
  await message.fill('@Al');await message.press('Enter');
  await message.fill('@Alpha solo vos');await page.getByRole('button',{name:'Enviar mensaje',exact:true}).click();
  await expect(page.getByRole('list',{name:'Mensajes'})).toContainText('Aviso dirigido a Alpha');
  const firstInbox=payload<{events:Array<{message:{mentionedAgentIds:string[]}}>}>(await a.callTool({name:'get_inbox',arguments:{}}));expect(firstInbox.events).toHaveLength(1);expect(firstInbox.events[0]!.message.mentionedAgentIds).toEqual([first.agentId]);
  expect(payload<{events:unknown[]}>(await b.callTool({name:'get_inbox',arguments:{}})).events).toHaveLength(0);
  const peers=payload<{agents:Array<{id:string}>}>(await b.callTool({name:'get_group_agents',arguments:{group_id:group}}));expect(peers.agents.map(item=>item.id).sort()).toEqual([first.agentId,second.agentId].sort());
  await send(page,'Ahora para todos');expect(payload<{events:unknown[]}>(await b.callTool({name:'get_inbox',arguments:{}})).events).toHaveLength(1);
  await page.reload();await expect(page.getByRole('list',{name:'Mensajes'})).toContainText('Aviso dirigido a Alpha');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`.local-state/verification/directed-mentions-${mobile?'mobile':'desktop'}.png`,fullPage:true});
 }finally{await a.close();await b?.close();}
});

test('private host setup binds its own identity and only the mentioned bot gets a webhook wake',async({page})=>{
 test.skip(process.env['MANAGED_E2E']!=='1','Requires local Supabase and Vault');
 const h=await notificationHarness();const clients:Array<Awaited<ReturnType<typeof mcpClient>>>=[];
 const identities:Array<Awaited<ReturnType<typeof authorizeAgent>>>=[];
 try{
  await page.goto(h.origin);await signUp(page,`private-setup-${randomUUID()}@example.com`,'Setup owner');
  for(const name of ['One','Two']){
   const identity=await authorizeAgent(page,h.origin,undefined,undefined,scope);identities.push(identity);
   const client=await mcpClient(h.origin,identity.token);clients.push(client);
   payload(await client.callTool({name:'configure_agent_profile',arguments:{name}}));
   const setup=payload<{private_configuration:{url:string;available:boolean}}>(await client.callTool({name:'setup_notifications',arguments:{platform:'grokbot'}}));expect(setup.private_configuration.available).toBe(true);
   const response=await fetch(setup.private_configuration.url,{method:'POST',headers:{authorization:`Bearer ${identity.token}`,'content-type':'application/json'},body:JSON.stringify({platform:'grokbot',url:'https://notifications.example.com/routine',secret:'fixture-webhook-key'})});
   expect(response.status).toBe(200);const status=await response.json();expect(status.active).toBe(false);expect(JSON.stringify(status)).not.toContain('fixture-webhook-key');
   const probe=h.delivered.find(item=>item.agent_id===identity.agentId&&item.kind==='probe')!;expect(probe).toBeDefined();
   expect(payload<{active:boolean}>(await client.callTool({name:'confirm_notification_delivery',arguments:{delivery_id:probe.delivery_id,challenge:probe.challenge}})).active).toBe(true);
  }
  await page.goto(h.origin);await expect(page.getByRole('main')).toHaveClass(/workspace/);const group=await createGroup(page,'Webhook mentions');await addAgent(page,'One');await addAgent(page,'Two');
  await page.getByLabel('Mensaje',{exact:true}).fill('@On');await page.getByLabel('Mensaje',{exact:true}).press('Enter');await page.getByLabel('Mensaje',{exact:true}).fill('@One tu turno');await page.getByRole('button',{name:'Enviar mensaje',exact:true}).click();
  await expect(page.getByRole('list',{name:'Mensajes'})).toContainText('@One tu turno');
  expect((await h.dispatch()).status).toBe(200);
  const wakes=h.delivered.filter(item=>item.kind==='wake');expect(wakes).toHaveLength(1);expect(wakes[0]!.agent_id).toBe(identities[0]!.agentId);
  expect(payload<{events:unknown[]}>(await clients[1]!.callTool({name:'get_inbox',arguments:{}})).events).toHaveLength(0);
  const jobs=await h.db.rows<{agent_id:string}>(`SELECT j.agent_id FROM notification_jobs j JOIN inbox_events e ON e.id=j.event_id WHERE e.group_id=$1`,[group]);expect(jobs.map(job=>job.agent_id)).toEqual([identities[0]!.agentId]);
  const wake=wakes[0]!;payload(await clients[0]!.callTool({name:'confirm_notification_delivery',arguments:{delivery_id:wake.delivery_id,challenge:wake.challenge}}));
  const inbox=payload<{events:Array<{eventId:string}>}>(await clients[0]!.callTool({name:'get_inbox',arguments:{}}));payload(await clients[0]!.callTool({name:'send_message',arguments:{group_id:group,text:'Respondió One',idempotency_key:`reply:${inbox.events[0]!.eventId}:final`}}));
  payload(await clients[0]!.callTool({name:'ack_inbox',arguments:{event_id:inbox.events[0]!.eventId}}));await expect(page.getByRole('list',{name:'Mensajes'})).toContainText('Respondió One');
 }finally{for(const identity of identities)await page.request.post(`${h.origin}/api/agents/${identity.agentId}/notifications/pause`,{headers:{origin:h.origin},data:{}});for(const client of clients)await client.close();await h.close();}
});
