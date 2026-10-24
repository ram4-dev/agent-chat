import console from 'node:console';
import { URL } from 'node:url';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { existsSync, writeFileSync } from 'node:fs';
console.log(JSON.stringify({ fixturePid: process.pid }));
const server = createServer(async (request, response) => {
  const cancelled = new globalThis.AbortController();
  response.once('close', () => cancelled.abort());
  try {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(request.url, process.env.NATIVE_UPSTREAM);
    const headers = { ...request.headers, host: url.host }; delete headers.connection; delete headers['content-length'];
    let tool;
    try { tool = JSON.parse(body.toString()).params?.name; } catch { /* Protocol non-tool requests. */ }
    if (tool === process.env.NATIVE_BLOCK_TOOL && process.env.NATIVE_BLOCK_MARKER && !existsSync(process.env.NATIVE_BLOCK_MARKER)) {
      writeFileSync(process.env.NATIVE_BLOCK_MARKER, 'blocked');
      await new Promise(resolve => response.once('close', resolve)); return;
    }
    const upstream = await globalThis.fetch(url, { method: request.method, headers, signal: cancelled.signal, ...(body.length ? { body } : {}) });
    const content = Buffer.from(await upstream.arrayBuffer());
    if (tool === (process.env.NATIVE_DROP_TOOL ?? 'native_finish') && process.env.NATIVE_LOST_RESPONSE && !existsSync(process.env.NATIVE_LOST_RESPONSE)) {
      // The upstream has committed and replied; discard only its first response.
      writeFileSync(process.env.NATIVE_LOST_RESPONSE, 'lost'); response.destroy(); return;
    }
    response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' }); response.end(content);
  } catch { response.destroy(); }
});
server.listen(Number(process.env.PORT), process.env.HOST ?? '127.0.0.1');
process.once('SIGTERM', () => { server.closeAllConnections(); server.close(); });
