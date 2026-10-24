import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import process from 'node:process';
import { log } from 'node:console';

const root = process.cwd();
const output = resolve(root, '.vercel/output/functions/index.func');
const config = JSON.parse(readFileSync(resolve(output, '.vc-config.json'), 'utf8'));
if (config.runtime !== 'nodejs22.x') throw new Error('Deployment must use Node 22');
if (!existsSync(resolve(output, config.handler))) throw new Error('Deployment handler is missing');
const web = resolve(root, 'apps/web/dist');
let checked = 0;
for (const name of readdirSync(web, { recursive: true })) {
  const source = resolve(web, name);
  if (!statSync(source).isFile()) continue;
  const packaged = resolve(output, 'apps/web/dist', name);
  if (!existsSync(packaged) || !readFileSync(source).equals(readFileSync(packaged))) throw new Error(`Missing or stale packaged web asset: ${name}`);
  checked++;
}
for (const name of readdirSync(output, { recursive: true })) {
  if (name.split('/').some((part) => part === '.local-state' || part === '.env' || part.startsWith('.env.'))) {
    throw new Error(`Environment file present in deployment artifact: ${relative(output, resolve(output, name))}`);
  }
}
const guidePath = '.agents/skills/agent-chat-participation/SKILL.md';
if (!existsSync(resolve(output, guidePath)) || !readFileSync(resolve(root, guidePath)).equals(readFileSync(resolve(output, guidePath)))) {
  throw new Error('Agent participation skill missing or stale in deployment artifact');
}
log(`Deployment artifact verified: Node 22, handler, participation skill and ${checked} matching web assets; no environment files.`);
