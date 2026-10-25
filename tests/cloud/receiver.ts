import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import type {Client} from '@modelcontextprotocol/sdk/client/index.js';

type Envelope={version:string;type:string;kind:string;agent_id:string;connection_id:string;delivery_id:string;challenge:string};
type InboxEvent={eventId:string;message:{id:string;text:string;author:{kind:string}};groupId:string};
function result<T>(value:unknown):T{
 const response=value as {isError?:boolean;content:Array<{text:string}>};
 if(response.isError)throw new Error('QA agent operation refused');
 return JSON.parse(response.content[0]!.text) as T;
}

/** Real HTTPS ingress and real MCP calls; no application delivery port is replaced. */
export async function cloudReceiver(){
 const port=Number(process.env['PORT']);const proxy=process.env['PORTLESS_URL'];
 if(!port||!proxy)throw new Error('Run cloud E2E through Portless');
 const routes=new Map<string,{secret:string;agentId:string;connectionId:string;client:Client;chain:Promise<void>}>();
 const deliveries:Array<{agentId:string;kind:string;deliveryId:string}>=[];
 const handled:Array<{agentId:string;messageId:string;eventId:string}>=[];
 const failures:Array<{stage:string}>=[];
 const gate={enabled:true};
 async function processWake(route:NonNullable<ReturnType<typeof routes.get>>,body:Envelope){
  let stage='identity';
  try{
   const identity=result<{agent:{id:string};connection:{id:string}}>(await route.client.callTool({name:'get_identity',arguments:{}}));
   if(identity.agent.id!==body.agent_id||identity.connection.id!==body.connection_id)throw new Error('Wrong QA identity');
   stage='delivery confirmation';result(await route.client.callTool({name:'confirm_notification_delivery',arguments:{delivery_id:body.delivery_id,challenge:body.challenge}}));
   if(body.kind==='probe')return;
   stage='inbox';const inbox=result<{events:InboxEvent[]}>(await route.client.callTool({name:'get_inbox',arguments:{}}));
   for(const event of inbox.events){
    if(event.message.author.kind==='human'){
     stage='reply receipt';const receipt=result<{published:boolean}>(await route.client.callTool({name:'get_notification_reply_receipt',arguments:{event_id:event.eventId}}));
     if(!receipt.published){
      stage='reply';result(await route.client.callTool({name:'send_message',arguments:{group_id:event.groupId,text:`QA recibió: ${event.message.text}`,idempotency_key:`reply:${event.eventId}:final`,
       // Keep this QA reply visible to humans without waking the other fixture bot.
       mentioned_agent_ids:[route.agentId]}}));
     }
    }
    stage='ack';result(await route.client.callTool({name:'ack_inbox',arguments:{event_id:event.eventId}}));
    if(event.message.author.kind==='human')handled.push({agentId:route.agentId,messageId:event.message.id,eventId:event.eventId});
   }
  }catch{failures.push({stage});}
 }
 const server=createServer(async(request,response)=>{
  if(request.method==='GET'&&request.url==='/ready'){response.writeHead(200,{'content-type':'application/json'}).end('{"ready":true}');return;}
  const route=routes.get(request.url??'');const bearer=request.headers.authorization??'';
  if(!route||request.method!=='POST'||Buffer.byteLength(bearer)!==Buffer.byteLength(`Bearer ${route.secret}`)||!timingSafeEqual(Buffer.from(bearer),Buffer.from(`Bearer ${route.secret}`))){response.writeHead(401).end();return;}
  let raw='';for await(const chunk of request){raw+=String(chunk);if(Buffer.byteLength(raw)>4096){response.writeHead(413).end();return;}}
  let body:Envelope;try{body=JSON.parse(raw) as Envelope;}catch{response.writeHead(400).end();return;}
  if(!body||body.version!=='1'||body.type!=='agent_chat.notification'||!['probe','wake'].includes(body.kind)||body.agent_id!==route.agentId||body.connection_id!==route.connectionId||typeof body.delivery_id!=='string'||!/^[0-9a-f]{48}$/.test(body.challenge)){response.writeHead(400).end();return;}
  deliveries.push({agentId:body.agent_id,kind:body.kind,deliveryId:body.delivery_id});
  response.writeHead(200).end();
  if(gate.enabled)route.chain=route.chain.then(()=>processWake(route,body));
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 await mkdir('.local-state/cloud',{recursive:true,mode:0o700});
 const config='.local-state/cloud/empty-tunnel.yml';await writeFile(config,'{}\n', {mode:0o600});
 const destination=new URL(proxy);const host=destination.host;destination.hostname='127.0.0.1';
 const tunnelLog=createWriteStream('.local-state/cloud/tunnel.log',{flags:'w',mode:0o600});
 const tunnel=spawn('cloudflared',['tunnel','--config',config,'--no-autoupdate','--protocol','http2','--url',destination.href,'--http-host-header',host],{stdio:['ignore','pipe','pipe'],env:{PATH:process.env['PATH'],HOME:process.env['HOME'],TMPDIR:process.env['TMPDIR']}});
 let origin:string;
 try{
  origin=await new Promise<string>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Temporary HTTPS ingress unavailable')),30000);
   let assigned:string|undefined,connected=false;
   const scan=(chunk:Buffer)=>{
    tunnelLog.write(chunk);const line=chunk.toString();
    const matches=line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g)??[];
    assigned??=matches.find(url=>new URL(url).hostname!=='api.trycloudflare.com');
    connected ||= line.includes('Registered tunnel connection');
    if(assigned&&connected){clearTimeout(timer);resolve(assigned);}
   };
   tunnel.stdout.on('data',scan);tunnel.stderr.on('data',scan);
   tunnel.once('error',()=>{clearTimeout(timer);reject(new Error('Temporary HTTPS ingress unavailable'));});
   tunnel.once('exit',()=>{tunnelLog.end();clearTimeout(timer);reject(new Error('Temporary HTTPS ingress stopped'));});
  });
 }catch(error){tunnel.kill('SIGTERM');server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));throw error;}
 return {origin,deliveries,handled,failures,gate,
  async ready(){return(await fetch(`http://127.0.0.1:${port}/ready`,{signal:AbortSignal.timeout(5000)})).status;},
  register(agentId:string,connectionId:string,client:Client){const path=`/${randomUUID()}`;const secret=randomBytes(32).toString('base64url');routes.set(path,{agentId,connectionId,client,secret,chain:Promise.resolve()});return {url:origin+path,secret};},
  replaceClient(agentId:string,client:Client){for(const route of routes.values())if(route.agentId===agentId)route.client=client;},
  async close(){
   await Promise.all([...routes.values()].map(route=>route.chain));
   tunnel.kill('SIGTERM');
   await new Promise<void>(resolve=>{const timer=setTimeout(()=>{tunnel.kill('SIGKILL');resolve();},3000);tunnel.once('exit',()=>{clearTimeout(timer);resolve();});});
   server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  }};
}
