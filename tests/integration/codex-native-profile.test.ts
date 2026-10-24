import { it, expect } from 'vitest';
import { checkCodexNativeProfileHost } from '../../apps/bridge/src/codex/profile-capability';
import { isolatedCommand } from '../../apps/bridge/src/codex/isolated-command';
import { hasNativeTools } from '../../apps/bridge/src/codex/native-profile-probe';
import { nativeCodexFixture } from '../helpers/native-codex';
it('checks the installed host without granting native activation', async()=>{
  const result=await checkCodexNativeProfileHost(); expect(result.supported).toBe(false);
  expect(['app_server_profile_unsupported','not_demonstrated']).toContain(result.reason);
});
it('two isolated native CLI profiles preserve distinct personas and tools without proving App Server support', async()=>{
 const f=await nativeCodexFixture();
 try {
  for(const profile of ['alpha','beta']) await isolatedCommand('codex',['exec','--profile',profile,'--json','--skip-git-repo-check','-C',f.workspace,'Reply with JSON decision reply and text using no tools.'],{env:{PATH:process.env['PATH'],HOME:f.home,CODEX_HOME:f.home},cwd:f.workspace,timeoutMs:15000,maxBytes:1024*1024});
  expect(f.observations).toHaveLength(2); expect(f.observations.every(hasNativeTools)).toBe(true);
  expect(JSON.stringify(f.observations[0])).toContain('PERSONA_ALPHA');expect(JSON.stringify(f.observations[0])).not.toContain('PERSONA_BETA');
  expect(JSON.stringify(f.observations[1])).toContain('PERSONA_BETA');expect(JSON.stringify(f.observations[1])).not.toContain('PERSONA_ALPHA');
 } finally {await f.close();}
},30000);
