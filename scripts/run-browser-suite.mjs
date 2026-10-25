import {spawnSync} from 'node:child_process';
import {URL,fileURLToPath} from 'node:url';
import process from 'node:process';

const args=process.argv.slice(2);
const cli=fileURLToPath(new URL('../node_modules/@playwright/test/cli.js',import.meta.url));
// Full suites create many independent owners from one loopback IP. Give each
// standard Playwright shard a fresh app/database lifecycle instead of changing
// production request budgets, mocking the limiter, adding retries or waiting out
// its window. Explicit targeted CLI invocations retain native Playwright behavior.
const fullSuite=!process.env['AGENT_CHAT_E2E_BASE_URL'] && args.every(arg=>arg.startsWith('--config='));
const shards=fullSuite?4:1;
const backend=args.some(arg=>arg.includes('playwright.managed.config'))?'supabase':'sqlite';
for(let shard=1;shard<=shards;shard++){
 if(fullSuite)process.stdout.write(`Browser suite: ${backend} isolated shard ${shard}/${shards}\n`);
 const isolated=fullSuite?[`--shard=${shard}/${shards}`,`--output=.local-state/playwright/${backend}/shard-${shard}`]:[];
 const child=spawnSync(process.execPath,[cli,'test',...args,...isolated],{stdio:'inherit',env:process.env});
 if(child.error){process.stderr.write('Unable to start the browser suite\n');process.exit(1);}
 if(child.status!==0)process.exit(child.status??1);
}
