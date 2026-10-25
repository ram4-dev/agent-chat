import type { FastifyInstance } from 'fastify';
import { AUTH_LIMITS, SESSION_COOKIE_NAME, isPlainObject } from '@agent-chat/contracts';
import { serializeSessionCookie } from '../adapters/http/cookie.js';
import { sendError } from '../adapters/http/error-envelope.js';
import { DomainError } from '../modules/errors.js';
import { createManagedHumanAuth, type SupabaseAuthConfig } from './human-auth.js';
import type { ManagedDatabase } from './database.js';

export function registerManagedConfirmation(app: FastifyInstance, db: ManagedDatabase, config: SupabaseAuthConfig, secureCookies: boolean) {
  const auth=createManagedHumanAuth(db,config);
  app.post('/api/auth/confirm',async(request,reply)=>{
    reply.header('cache-control','private, no-store');
    const token=isPlainObject(request.body)?request.body['accessToken']:undefined;
    if(typeof token!=='string'||!token.length||token.length>20_000||/[\r\n]/.test(token))return sendError(reply,400,'invalid_input');
    try{
      const result=await auth.confirmEmail(token);
      reply.header('set-cookie',serializeSessionCookie(SESSION_COOKIE_NAME,result.sessionToken,{secure:secureCookies,maxAgeSeconds:AUTH_LIMITS.HUMAN_SESSION_INACTIVITY_SECONDS}));
      return {user:result.user};
    }catch(error){
      if(error instanceof DomainError)return sendError(reply,error.statusCode,error.code);
      return sendError(reply,503,'temporarily_unavailable');
    }
  });
}
