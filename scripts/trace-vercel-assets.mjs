import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';
import { log } from 'node:console';
const directory = new URL('../apps/web/dist/', import.meta.url);
const files = readdirSync(directory, { recursive: true }).filter((file) => statSync(new URL(file, directory)).isFile()).sort();
// Vercel's Node tracer needs literal reads for assets addressed dynamically by Fastify.
// The generated module is deployment input, not a source-controlled list of Vite hashes.
const source = `import {readFileSync} from 'node:fs';\n` + files.map((file) =>
  `readFileSync(new URL(${JSON.stringify(`../apps/web/dist/${file}`)},import.meta.url));`,
).join('\n') + '\n';
writeFileSync(new URL('../src/vercel-assets.generated.js', import.meta.url), source);
log(`Prepared deployment tracing for ${files.length} web assets.`);
