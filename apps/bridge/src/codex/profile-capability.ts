import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
/** No inference, personal config or OAuth. A launch alone never proves profile selection. */
export async function checkCodexNativeProfileHost(): Promise<{ supported: false; reason: 'app_server_profile_unsupported' | 'not_demonstrated' }> {
  const root = await mkdtemp(join(tmpdir(),'codex-profile-host-'));
  try {
    return await new Promise(resolve => {
      const child=spawn('codex',['--profile','agent-chat-probe','app-server','--listen','stdio://'],{cwd:root,env:{PATH:process.env['PATH'],HOME:root,CODEX_HOME:root},detached:true,stdio:['ignore','ignore','pipe']});
      let stderr='';const stop=()=>{try{if(child.pid)process.kill(-child.pid,'SIGKILL');}catch{/* Owned group already exited. */}};
      const timer=setTimeout(stop,5000);child.stderr.on('data',(chunk:Buffer)=>{if(stderr.length<65536)stderr+=chunk.toString();});
      child.once('error',stop);child.once('exit',stop);
      child.once('close',()=>{clearTimeout(timer);resolve({supported:false,reason:stderr.includes('--profile only applies to runtime commands')?'app_server_profile_unsupported':'not_demonstrated'});});
    });
  } finally { await rm(root,{recursive:true,force:true}); }
}
