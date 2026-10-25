import {expect,it} from 'vitest';
import {parseSendMessageRequest,parseMessageView} from '@agent-chat/contracts';
it('validates bounded explicit IDs, canonicalizes duplicate recipients and preserves them in message projections',()=>{
 const base={text:'@Bot tu turno',idempotencyKey:'mention-1'};
 expect(parseSendMessageRequest({...base,mentionedAgentIds:['b','a','b']})).toEqual({ok:true,value:{...base,mentionedAgentIds:['a','b']}});
 for(const raw of [null,'agent',[1],[''],Array.from({length:21},(_,index)=>String(index)),['x'.repeat(129)]])expect(parseSendMessageRequest({...base,mentionedAgentIds:raw}).ok).toBe(false);
 expect(parseSendMessageRequest(base)).toEqual({ok:true,value:base});
 expect(parseMessageView({id:'message',groupId:'group',text:'@Bot',createdAt:'now',author:{kind:'human',id:'owner',displayName:'Owner'},mentionedAgentIds:['bot']})).toMatchObject({ok:true,value:{mentionedAgentIds:['bot']}});
});
