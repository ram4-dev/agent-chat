import { loadEnvFile } from 'node:process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../../apps/server/src/config/env';
import { createApp } from '../../apps/server/src/app';
import { ManagedDatabase } from '../../apps/server/src/managed/database';
import { createManagedServices } from '../../apps/server/src/managed/services';
import { createManagedOAuthStore } from '../../apps/server/src/managed/oauth-store';
import { createNotifications } from '../../apps/server/src/notifications/module';

/** Real HTTP, OAuth, Supabase Auth, Postgres and Vault; only the external provider is a delivery port. */
export async function notificationHarness() {
  loadEnvFile('.local-state/managed.env');
  const reservation=createServer();await new Promise<void>((resolve)=>reservation.listen(0,'127.0.0.1',resolve));
  const address=reservation.address();if(!address||typeof address==='string')throw new Error('No fixture listener');
  const origin=`http://127.0.0.1:${address.port}`;await new Promise<void>((resolve,reject)=>reservation.close((error)=>error?reject(error):resolve()));
  const config=readConfig({env:{...process.env,NODE_ENV:'test',LOG_LEVEL:'silent',PUBLIC_ORIGIN:origin},repoRoot:process.cwd()});
  if(!config.managed||!['127.0.0.1','localhost'].includes(new URL(config.managed.databaseUrl).hostname))throw new Error('Use local Supabase only');
  const db=new ManagedDatabase(config.managed.databaseUrl);
  const services=createManagedServices(db,{url:config.managed.supabaseUrl,anonKey:config.managed.supabaseAnonKey,publicOrigin:origin});
  const delivered:Array<Record<string,string>>=[];
  const notifications=createNotifications(db,services.agents,async(_url,secret,body)=>{
    if(secret!=='fixture-webhook-key')return 401;
    delivered.push(body);return 200;
  });
  const app=await createApp({config,services:{...services,notifications},oauthStore:createManagedOAuthStore(db),health:()=>db.ping()});
  await app.listen({host:'127.0.0.1',port:address.port});
  return {origin,delivered,db,notifications,close:async()=>{await app.close();await db.close();},
    dispatch:async()=>{
      const stamp=String(Math.floor(Date.now()/1000)),nonce=randomUUID();
      const proof=await db.one<{signature:string}>("SELECT encode(extensions.hmac($1||'.'||$2,decrypted_secret,'sha256'),'hex') AS signature FROM vault.decrypted_secrets WHERE name='agent_chat_notification_dispatch'",[stamp,nonce]);
      return fetch(`${origin}/internal/notifications/dispatch`,{method:'POST',headers:{'content-type':'application/json','x-agent-chat-time':stamp,'x-agent-chat-nonce':nonce,'x-agent-chat-signature':proof!.signature},body:'{}'});
    }};
}
