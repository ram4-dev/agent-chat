import {randomBytes,randomUUID} from 'node:crypto';
import {expect,test} from '@playwright/test';
import {authorizeAgent,mcpClient,payload} from '../e2e/helpers/agent';
import {agents,createGroup,addAgent} from '../e2e/helpers/ui';
import {cloudReceiver} from './receiver';
const scopes='openid agent:read agent:send agent:inbox agent:receive agent:manage';

test('deployed skill, OAuth identities, HTTPS webhook, mention-only wake, reply and ACK',async({page,baseURL})=>{
 test.skip(process.env['AGENT_CHAT_CLOUD_E2E']!=='1','Cloud writes require explicit opt-in');
 const origin=baseURL!;
 if(!process.env['SUPABASE_URL']||!process.env['SUPABASE_SERVICE_ROLE_KEY'])throw new Error('Missing private SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
 const receiver=await cloudReceiver();const clients:Array<Awaited<ReturnType<typeof mcpClient>>>=[];
 const identities:Array<Awaited<ReturnType<typeof authorizeAgent>>>=[];
 let cookie='';let primaryFailure:unknown;const cleanupFailures:string[]=[];
 try{
  // Tunnel connection + local routing are fixture readiness. Public reachability is
  // proved below by Vercel's actual signed-in webhook probe, not this Mac's DNS cache.
  await expect.poll(()=>receiver.ready(),{timeout:10000}).toBe(200);
  console.log('cloud-e2e: QA receiver and temporary tunnel connected');
  const discovery=await page.request.get('/.well-known/agent-chat.json');expect(discovery.status()).toBe(200);
  const skill=await page.request.get('/skills/agent-chat/SKILL.md');expect(skill.status()).toBe(200);expect(await skill.text()).toContain(origin+'/mcp');
  // SMTP delivery is a separate prerequisite: create only an isolated confirmed QA identity.
  const email=`vercel-e2e-${randomUUID()}@example.com`,password=randomBytes(24).toString('base64url');
  const created=await fetch(`${process.env['SUPABASE_URL']}/auth/v1/admin/users`,{method:'POST',headers:{apikey:process.env['SUPABASE_SERVICE_ROLE_KEY'],authorization:`Bearer ${process.env['SUPABASE_SERVICE_ROLE_KEY']}`,'content-type':'application/json'},body:JSON.stringify({email,password,email_confirm:true,user_metadata:{display_name:'Vercel QA'}})});
  expect(created.ok).toBe(true);
  const login=await page.request.post('/api/auth/login',{headers:{origin},data:{email,password}});expect(login.status()).toBe(200);
  cookie=(await page.context().cookies(origin)).map(value=>`${value.name}=${value.value}`).join('; ');
  await page.goto('/');await expect(page.getByRole('main')).toHaveClass(/workspace/);
  console.log('cloud-e2e: confirmed QA login and public skill verified');
  await agents(page);await page.getByRole('button',{name:'Conectar cliente',exact:true}).click();
  await expect(page.getByLabel('Skill para configurar un agente',{exact:true})).toHaveValue(origin+'/skills/agent-chat/SKILL.md');
  for(const name of ['QA Alpha','QA Beta']){
   const identity=await authorizeAgent(page,origin,undefined,undefined,scopes);identities.push(identity);
   const client=await mcpClient(origin,identity.token);clients.push(client);
   payload(await client.callTool({name:'configure_agent_profile',arguments:{name,description:'Isolated live Vercel E2E fixture'}}));
   const confirmed=payload<{agent:{id:string;name:string};connection:{id:string}}>(await client.callTool({name:'get_identity',arguments:{}}));expect(confirmed.agent).toMatchObject({id:identity.agentId,name});expect(confirmed.connection.id).toBe(identity.connectionId);
   const setup=payload<{setup_url:string;private_configuration:{url:string;available:boolean}}>(await client.callTool({name:'setup_notifications',arguments:{platform:'generic',can_create_webhook_routine:true}}));expect(setup.private_configuration.available).toBe(true);
   const hook=receiver.register(identity.agentId,identity.connectionId,client);
   if(name==='QA Alpha'){
    const registered=await fetch(setup.private_configuration.url,{method:'POST',headers:{authorization:`Bearer ${identity.token}`,'content-type':'application/json'},body:JSON.stringify({platform:'generic',...hook}),signal:AbortSignal.timeout(30000)});
    expect(registered.status).toBe(200);expect(JSON.stringify(await registered.json())).not.toContain(hook.secret);
   }else{
    await page.goto(setup.setup_url);
    const dialog=page.getByRole('dialog',{name:'Notificaciones de QA Beta',exact:true});await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Cliente MCP para notificaciones')).toHaveValue(identity.connectionId);
    await dialog.getByLabel('URL del webhook',{exact:true}).fill(hook.url);await dialog.getByLabel('Clave del webhook',{exact:true}).fill(hook.secret);
    await dialog.getByRole('button',{name:'Guardar y probar',exact:true}).click();
    await expect(dialog.getByLabel('Clave del webhook',{exact:true})).toHaveValue('');
   }
   await expect.poll(async()=>payload<{active:boolean}>(await client.callTool({name:'get_notification_status',arguments:{}})).active,{timeout:90000,intervals:[500,1000,2000]}).toBe(true);
   expect(receiver.deliveries.some(item=>item.agentId===identity.agentId&&item.kind==='probe')).toBe(true);
   expect(receiver.handled).toHaveLength(0);expect(receiver.failures).toEqual([]);
   console.log(`cloud-e2e: OAuth, profile and real HTTPS probe verified for ${name}`);
  }
  await page.goto('/');await expect(page.getByRole('main')).toHaveClass(/workspace/);
  const group=await createGroup(page,'Vercel QA directed notifications');await addAgent(page,'QA Alpha');await addAgent(page,'QA Beta');
  for(const [index,mobile] of [false,true].entries()){
   await page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:900});
   const close=page.getByRole('button',{name:'Cerrar detalles',exact:true});if(mobile&&await close.isVisible())await close.click();
   const message=page.getByLabel('Mensaje',{exact:true});const label=mobile?'QA Beta':'QA Alpha';const selected=identities[index]!;
   await message.fill(mobile?'@QA B':'@QA A');await expect(page.getByRole('listbox',{name:'Agentes para mencionar'})).toBeVisible();await message.press('Enter');
   await expect(page.getByRole('button',{name:`Quitar mención a ${label}`,exact:true})).toBeVisible();
   const text=`@${label} prueba ${mobile?'móvil':'desktop'} ${randomUUID()}`;await message.fill(text);await page.getByRole('button',{name:'Enviar mensaje',exact:true}).click();
   await expect(page.getByRole('list',{name:'Mensajes'})).toContainText(text);
   await expect.poll(()=>({handled:receiver.handled.filter(item=>item.agentId===selected.agentId).length,errors:receiver.failures.length}),{timeout:90000,intervals:[500,1000,2000]}).toEqual({handled:1,errors:0});
   await expect(page.getByRole('list',{name:'Mensajes'})).toContainText(`QA recibió: ${text}`);
   expect(receiver.deliveries.filter(item=>item.kind==='wake'&&item.agentId===selected.agentId)).toHaveLength(1);
   const other=identities[1-index]!;expect(receiver.handled.filter(item=>item.agentId===other.agentId)).toHaveLength(index);
   expect(receiver.deliveries.filter(item=>item.kind==='wake'&&item.agentId===other.agentId)).toHaveLength(index);
   expect(payload<{events:unknown[]}>(await clients[index]!.callTool({name:'get_inbox',arguments:{}})).events).toHaveLength(0);
   const history=payload<{messages:Array<{text:string;mentionedAgentIds?:string[]}>}>(await clients[1-index]!.callTool({name:'read_messages',arguments:{group_id:group}}));expect(history.messages.find(item=>item.text===text)?.mentionedAgentIds).toEqual([selected.agentId]);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:`.local-state/verification/vercel-real-${mobile?'mobile':'desktop'}.png`,fullPage:true});
   console.log(`cloud-e2e: ${mobile?'mobile':'desktop'} mention, actual push, reply and ACK verified`);
  }
  // Disconnect the QA host and reconnect the same authorized identity.
  await clients[1]!.close();clients[1]=await mcpClient(origin,identities[1]!.token);receiver.replaceClient(identities[1]!.agentId,clients[1]!);
  expect(payload<{connection:{id:string}}>(await clients[1]!.callTool({name:'get_identity',arguments:{}})).connection.id).toBe(identities[1]!.connectionId);
  const pause=await page.request.post(`/api/agents/${identities[1]!.agentId}/notifications/pause`,{headers:{origin},data:{}});expect(pause.status()).toBe(200);
  expect(payload<{active:boolean}>(await clients[1]!.callTool({name:'get_notification_status',arguments:{}})).active).toBe(false);
  const wakesBefore=receiver.deliveries.filter(item=>item.kind==='wake'&&item.agentId===identities[1]!.agentId).length;
  const pausedText=`Paused QA recovery ${randomUUID()}`,request={text:pausedText,idempotencyKey:randomUUID(),mentionedAgentIds:[identities[1]!.agentId]};
  const first=await page.request.post(`/api/groups/${group}/messages`,{headers:{origin},data:request});expect(first.status()).toBe(201);
  const replay=await page.request.post(`/api/groups/${group}/messages`,{headers:{origin},data:request});expect(replay.status()).toBe(200);expect((await replay.json()).message.id).toBe((await first.json()).message.id);
  expect(payload<{events:unknown[]}>(await clients[1]!.callTool({name:'get_inbox',arguments:{}})).events).toHaveLength(1);
  expect(receiver.deliveries.filter(item=>item.kind==='wake'&&item.agentId===identities[1]!.agentId)).toHaveLength(wakesBefore);
  const resume=await page.request.post(`/api/agents/${identities[1]!.agentId}/notifications/test`,{headers:{origin},data:{}});expect(resume.status()).toBe(200);
  await expect.poll(()=>({handled:receiver.handled.filter(item=>item.agentId===identities[1]!.agentId).length,errors:receiver.failures.length}),{timeout:90000,intervals:[500,1000,2000]}).toEqual({handled:2,errors:0});
  const recovered=payload<{messages:Array<{text:string}>}>(await clients[1]!.callTool({name:'read_messages',arguments:{group_id:group}}));expect(recovered.messages.filter(message=>message.text===`QA recibió: ${pausedText}`)).toHaveLength(1);
  expect(payload<{events:unknown[]}>(await clients[1]!.callTool({name:'get_inbox',arguments:{}})).events).toHaveLength(0);
  console.log('cloud-e2e: reconnect, pause, durable recovery and idempotency verified');
  const revoked=await page.request.delete(`/api/agent-connections/${identities[1]!.connectionId}`,{headers:{origin}});expect(revoked.status()).toBe(200);
  await expect(clients[1]!.callTool({name:'get_identity',arguments:{}})).rejects.toThrow('unauthenticated');
  const ownerState=await page.request.get(`/api/agents/${identities[1]!.agentId}/notifications`);expect(ownerState.status()).toBe(200);expect((await ownerState.json()).active).toBe(false);
  console.log('cloud-e2e: revocation blocks the previous OAuth connection');
  expect(receiver.failures).toEqual([]);
 }catch(error){primaryFailure=error;}finally{
  // Pause only identities created by this test, using its own private owner session.
  const results=await Promise.allSettled(identities.map(async identity=>{
   const response=await fetch(`${origin}/api/agents/${identity.agentId}/notifications/pause`,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error('QA pause failed');
  }));
  if(results.some(result=>result.status==='rejected'))cleanupFailures.push('QA pause');
  try{await receiver.close();}catch{cleanupFailures.push('receiver close');}
  for(const client of clients)try{await client.close();}catch{cleanupFailures.push('MCP close');}
 }
 if(primaryFailure)throw primaryFailure;
 expect(cleanupFailures).toEqual([]);
});
