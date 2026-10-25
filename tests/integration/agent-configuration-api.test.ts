import { randomUUID } from 'node:crypto';
import { expect,it } from 'vitest';
import { startHarness,agentToken } from '../helpers/agent-harness';

it('publishes discoverable docs and scopes every configuration action to the bearer identity',async()=>{
 const h=await startHarness();
 const schema=await (await fetch(h.origin+'/docs/openapi.json')).json();
 expect(schema.openapi).toBe('3.1.0');expect(schema.servers).toEqual([{url:h.origin}]);
 expect((await (await fetch(h.origin+'/docs/agent-api.md')).text())).toContain(h.origin+'/mcp');
 expect((await fetch(h.origin+'/docs')).status).toBe(200);
 const old=await agentToken(h,`old-${randomUUID()}@example.com`,'Keep');
 const own=await agentToken(h,`self-${randomUUID()}@example.com`,'Self','openid agent:read agent:send agent:inbox agent:receive agent:manage');
 const headers={authorization:`Bearer ${own.token}`,'content-type':'application/json'};
 const state=await (await fetch(h.origin+'/agent/configuration',{headers})).json();
 expect(state.agent.name).toBe('Self');expect(state.connection.scopes).toContain('agent:manage');
 const updated=await fetch(h.origin+'/agent/configuration/profile',{method:'PATCH',headers,body:JSON.stringify({name:'API configured',description:'Agent-owned setup'})});
 expect(updated.status).toBe(200);expect((await updated.json()).agent.id).toBe(state.agent.id);
 const injectOther=await fetch(h.origin+'/agent/configuration/profile',{method:'PATCH',headers,body:JSON.stringify({name:'Wrong',agentId:'other'})});
 expect(injectOther.status).toBe(400);
 for(const [path,method] of [['/agent/configuration','GET'],['/agent/configuration/profile','PATCH'],['/agent/configuration/notifications/pause','POST'],['/agent/configuration/notifications/test','POST']]){
  expect((await fetch(h.origin+path,{method,headers:{'content-type':'application/json'},...(method==='GET'?{}:{body:'{}'})})).status).toBe(401);
  expect((await fetch(h.origin+path,{method,headers:{authorization:`Bearer ${old.token}`,'content-type':'application/json'},...(method==='GET'?{}:{body:'{}'})})).status).toBe(403);
 }
 expect((await fetch(h.origin+'/agent/configuration/notifications/pause',{method:'POST',headers,body:'{}'})).status).toBe(409);
 expect(h.database.sqlite.prepare('SELECT name FROM agents WHERE id<>?').all(state.agent.id)).toEqual([{name:'Keep'}]);
});
