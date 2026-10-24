import type { FastifyInstance,FastifyReply } from 'fastify';
import { z } from 'zod';
import { SESSION_COOKIE_NAME } from '@agent-chat/contracts';
import type { ApplicationServices } from '../services.js';
import { DomainError } from '../modules/errors.js';
import { readCookie } from '../adapters/http/cookie.js';
import { sendError } from '../adapters/http/error-envelope.js';

export function registerNotificationRoutes(app: FastifyInstance,services: ApplicationServices) {
  const owner = async (cookie?: string)=>(await services.auth.resolveSession(readCookie(cookie,SESSION_COOKIE_NAME))).id;
  const run=async(reply: FastifyReply,action:()=>Promise<unknown>)=>{
    reply.header('cache-control','private, no-store');
    try{return await action();}catch(error){if(error instanceof DomainError)return sendError(reply,error.statusCode,error.code);throw error;}
  };
  app.get<{Params:{agentId:string}}>('/api/agents/:agentId/notifications',(req,reply)=>run(reply,async()=>{
    const user=await owner(req.headers.cookie);await services.agents.getOwnedAgent(req.params.agentId,user);
    return services.notifications?{available:true,...await services.notifications.ownerStatus(user,req.params.agentId)}:{available:false,active:false};
  }));
  const input=z.object({connectionId:z.string().min(1),platform:z.enum(['grokbot','generic']),url:z.string().max(2048),secret:z.string().min(8).max(4096)}).strict();
  app.post<{Params:{agentId:string}}>('/api/agents/:agentId/notifications',(req,reply)=>run(reply,async()=>{
    const user=await owner(req.headers.cookie);const body=input.safeParse(req.body);
    if(!body.success)return sendError(reply,400,'invalid_input');
    if(!services.notifications)return sendError(reply,409,'conflict');
    return {available:true,...await services.notifications.configure(user,req.params.agentId,body.data)};
  }));
  app.post<{Params:{agentId:string}}>('/api/agents/:agentId/notifications/test',(req,reply)=>run(reply,async()=>{
    const user=await owner(req.headers.cookie);if(!services.notifications)return sendError(reply,409,'conflict');
    const result=await services.notifications.probe(user,req.params.agentId);
    await services.notifications.dispatch();
    return result;
  }));
  app.post<{Params:{agentId:string}}>('/api/agents/:agentId/notifications/pause',(req,reply)=>run(reply,async()=>{
    const user=await owner(req.headers.cookie);if(!services.notifications)return sendError(reply,409,'conflict');
    return {available:true,...await services.notifications.pause(user,req.params.agentId)};
  }));
  if(services.notifications){
    const notifications=services.notifications;
    app.post('/internal/notifications/dispatch',async(req,reply)=>{
      const header=(name:string)=>typeof req.headers[name]==='string'?req.headers[name] as string:'';
      if(!await notifications.authorizeDispatch(header('x-agent-chat-time'),header('x-agent-chat-nonce'),header('x-agent-chat-signature')))return sendError(reply,401,'unauthenticated');
      return notifications.dispatch();
    });
  }
}
