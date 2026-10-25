import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { test,expect } from '@playwright/test';

test.skip(!process.env['MANAGED_E2E'],'Requires disposable local Supabase Auth.');

test('verified email opens a session directly, clears credentials and rejects reuse',async({page,baseURL})=>{
 expect((await (await page.request.get('/.well-known/agent-chat.json')).json()).mcp_url).toBe(`${baseURL}/mcp`);
 const result=spawnSync('supabase',['status','--output','json'],{encoding:'utf8'});
 expect(result.status).toBe(0);
 const config=JSON.parse(result.stdout) as {API_URL:string;SERVICE_ROLE_KEY:string};
 if(!['localhost','127.0.0.1'].includes(new URL(config.API_URL).hostname))throw new Error('Only disposable local Auth is allowed');
 const email=`confirm-${randomUUID()}@example.com`;
 const generated=await fetch(`${config.API_URL}/auth/v1/admin/generate_link`,{method:'POST',headers:{apikey:config.SERVICE_ROLE_KEY,authorization:`Bearer ${config.SERVICE_ROLE_KEY}`,'content-type':'application/json'},body:JSON.stringify({type:'signup',email,password:'a-sufficiently-long-password',data:{display_name:'Email QA'},redirect_to:`${baseURL}/auth/confirm`})});
 expect(generated.status).toBe(200);
 const {action_link:link}=await generated.json() as {action_link:string};
 expect(typeof link==='string').toBe(true);
 let credential='';
 page.on('request',request=>{if(new URL(request.url()).pathname==='/api/auth/confirm')credential=(request.postDataJSON() as {accessToken:string}).accessToken;});
 await page.goto('/');
 await page.evaluate(link=>location.assign(link),link);
 await expect(page.getByRole('main')).toHaveClass(/workspace/);
 expect(new URL(page.url()).hash).toBe('');expect(new URL(page.url()).pathname).toBe('/');
 const me=await page.request.get('/api/auth/me');expect(me.status()).toBe(200);expect((await me.json()).user.email).toBe(email);
 const cookie=(await page.context().cookies()).find(c=>c.name==='agent_chat_session');expect(cookie?.httpOnly).toBe(true);
 await page.reload();await expect(page.getByRole('main')).toHaveClass(/workspace/);
 const replay=await page.request.post('/api/auth/confirm',{headers:{origin:baseURL!},data:{accessToken:credential}});expect(replay.status()).toBe(401);
 const crossOrigin=await page.request.post('/api/auth/confirm',{headers:{origin:'https://unrelated.example'},data:{accessToken:credential}});expect(crossOrigin.status()).toBe(403);
 await page.getByRole('button',{name:'Cerrar sesión'}).click();
 await page.goto('/auth/confirm#error=access_denied&error_code=otp_expired');
 await expect(page.getByRole('alert')).toContainText('El enlace de confirmación venció');expect(new URL(page.url()).hash).toBe('');
 const invalid=await page.request.post('/api/auth/confirm',{headers:{origin:baseURL!},data:{accessToken:'invalid'}});expect(invalid.status()).toBe(401);
});
