import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {startHarness,agentToken,connect,call,ownerWithAgent} from '../helpers/agent-harness';
const payload=(result:unknown)=>JSON.parse((result as {content:Array<{text:string}>}).content[0]!.text);

it('publishes a credential-free bootstrap skill and restricts self profile changes to owner-approved setup scope',async()=>{
 const h=await startHarness();
 const publicSkill=await fetch(h.origin+'/skills/agent-chat/SKILL.md');
 expect(publicSkill.status).toBe(200);expect(publicSkill.headers.get('content-type')).toContain('text/markdown');
 expect(await publicSkill.text()).toContain(h.origin+'/mcp');
 expect(await (await fetch(h.origin+'/.well-known/agent-chat.json')).json()).toMatchObject({setup_scope:'agent:manage',mcp_url:h.origin+'/mcp'});
 const old=await agentToken(h,`no-manage-${randomUUID()}@example.com`,'Original');
 const oldClient=await connect(old.token,h);
 try{expect((await oldClient.client.callTool({name:'configure_agent_profile',arguments:{name:'Unapproved'}})).isError).toBe(true);}finally{await oldClient.close();}
 const managed=await agentToken(h,`with-manage-${randomUUID()}@example.com`,'New identity','openid agent:read agent:send agent:inbox agent:receive agent:manage');
 const connection=await connect(managed.token,h);
 try{
  const before=payload(await connection.client.callTool({name:'get_identity',arguments:{}}));
  expect(payload(await connection.client.callTool({name:'configure_agent_profile',arguments:{name:'Researcher',description:'Reports for the team'}}))).toMatchObject({agent:{id:before.agent.id,name:'Researcher'}});
  const after=payload(await connection.client.callTool({name:'get_identity',arguments:{}}));expect(after.agent.id).toBe(before.agent.id);expect(after.agent.name).toBe('Researcher');
  const originals=h.database.sqlite.prepare('SELECT name FROM agents WHERE id<>?').all(before.agent.id);expect(originals).toEqual([{name:'Original'}]);
  expect((await fetch(h.origin+'/agent/configuration/notifications',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status).toBe(401);
  expect((await fetch(h.origin+'/agent/configuration/notifications',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${old.token}`},body:'{}'})).status).toBe(403);
 }finally{await connection.close();}
});

it('routes a mention only to the selected active group bot and binds idempotency to recipients',async()=>{
 const h=await startHarness();
 const first=await ownerWithAgent(h,`alpha-${randomUUID()}@example.com`,'Same name');
 const second=await ownerWithAgent(h,`beta-${randomUUID()}@example.com`,'Same name');
 const outsider=await ownerWithAgent(h,`outside-${randomUUID()}@example.com`,'Outside');
 const created=await call(h,first.jar,{method:'POST',url:'/api/groups',payload:{name:'Mentions'}});const groupId=created.json().group.id as string;
 for(const id of [first.agentId,second.agentId])expect((await call(h,first.jar,{method:'POST',url:`/api/groups/${groupId}/agents/${id}`})).statusCode).toBe(201);
 const a=await connect(first.token,h),b=await connect(second.token,h),other=await connect(outsider.token,h);
 try{
  const peers=payload(await a.client.callTool({name:'get_group_agents',arguments:{group_id:groupId}}));expect(peers.agents.map((agent:{id:string})=>agent.id).sort()).toEqual([first.agentId,second.agentId].sort());
  expect((await other.client.callTool({name:'get_group_agents',arguments:{group_id:groupId}})).isError).toBe(true);
  const key=randomUUID();const body={text:'@Same name respondé vos',idempotencyKey:key,mentionedAgentIds:[first.agentId]};
  const posted=await call(h,first.jar,{method:'POST',url:`/api/groups/${groupId}/messages`,payload:body});expect(posted.statusCode).toBe(201);expect(posted.json().message.mentionedAgentIds).toEqual([first.agentId]);
  expect(payload(await a.client.callTool({name:'get_inbox',arguments:{}})).events).toHaveLength(1);
  expect(payload(await b.client.callTool({name:'get_inbox',arguments:{}})).events).toHaveLength(0);
  expect((await call(h,first.jar,{method:'POST',url:`/api/groups/${groupId}/messages`,payload:body})).statusCode).toBe(200);
  expect((await call(h,first.jar,{method:'POST',url:`/api/groups/${groupId}/messages`,payload:{...body,mentionedAgentIds:[second.agentId]}})).statusCode).toBe(409);
  for(const id of [outsider.agentId,'missing'])expect((await call(h,first.jar,{method:'POST',url:`/api/groups/${groupId}/messages`,payload:{...body,idempotencyKey:randomUUID(),mentionedAgentIds:[id]}})).statusCode).toBe(400);
  expect((await call(h,first.jar,{method:'POST',url:`/api/groups/${groupId}/messages`,payload:{text:'Todos pueden responder',idempotencyKey:randomUUID()}})).statusCode).toBe(201);
  expect(payload(await b.client.callTool({name:'get_inbox',arguments:{}})).events).toHaveLength(1);
  const history=payload(await b.client.callTool({name:'read_messages',arguments:{group_id:groupId}}));expect(history.messages).toHaveLength(2);expect(history.messages[1].mentionedAgentIds).toEqual([first.agentId]);
 }finally{await a.close();await b.close();await other.close();}
});
