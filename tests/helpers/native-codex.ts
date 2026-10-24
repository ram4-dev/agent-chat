import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isolatedCommand } from '../../apps/bridge/src/codex/isolated-command';
export async function nativeCodexFixture() {
  const root = await mkdtemp(join(tmpdir(),'codex-native-fixture-')); const home = join(root,'home'); const workspace = join(root,'workspace');
  const observations: Record<string, unknown>[] = [];
  const server = createServer(async (req,res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    if (req.method !== 'POST' || !req.url?.endsWith('/responses')) { res.writeHead(404).end(); return; }
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>; observations.push(body);
    const serialized = JSON.stringify(body);
    const text = JSON.stringify({ decision: serialized.includes('SILENCIO') ? 'no_reply' : 'reply', text: serialized.includes('SILENCIO') ? '' : 'Respuesta de Codex nativo' });
    const message = { id: `message-${observations.length}`, type: 'message', role:'assistant', content:[{ type:'output_text', text }] };
    const events = [{ type:'response.created', response:{ id:`response-${observations.length}` } }, { type:'response.output_item.added',output_index:0,item:{...message,content:[]} }, {type:'response.output_text.delta',item_id:message.id,output_index:0,content_index:0,delta:text}, {type:'response.output_item.done',output_index:0,item:message}, {type:'response.completed',response:{id:`response-${observations.length}`,status:'completed',usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];
    res.writeHead(200,{'content-type':'text/event-stream'}).end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  });
  try {
    await mkdir(home); await mkdir(workspace);
    const env = { PATH:process.env['PATH'], HOME:home, CODEX_HOME:home };
    const catalog = await isolatedCommand('codex',['debug','models'],{env,cwd:workspace,timeoutMs:15000,maxBytes:8*1024*1024});
    await writeFile(join(home,'catalog.json'),catalog);
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve)); const address=server.address(); if(!address || typeof address==='string') throw new Error('Provider missing');
    await writeFile(join(home,'config.toml'),`model_provider="fixture"\nmodel="gpt-6-sol"\n[model_providers.fixture]\nname="Fixture"\nbase_url="http://127.0.0.1:${address.port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n`);
    for (const profile of ['alpha','beta']) await writeFile(join(home,`${profile}.config.toml`),`model="gpt-6.1-sol"\nmodel_catalog_json=${JSON.stringify(join(home,'catalog.json'))}\nmodel_instructions_file=${JSON.stringify(join(home,`${profile}.md`))}\n`);
    await writeFile(join(home,'alpha.md'),'PERSONA_ALPHA preserve native tools.'); await writeFile(join(home,'beta.md'),'PERSONA_BETA preserve native tools.');
    await writeFile(join(workspace,'AGENTS.md'),'WORKSPACE_NATIVE use the owner configured profile.');
    return {root,home,workspace,observations,async close(){server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); await rm(root,{recursive:true,force:true});}};
  } catch(e){server.closeAllConnections();server.close();await rm(root,{recursive:true,force:true});throw e;}
}
