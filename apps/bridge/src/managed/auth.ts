import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

const scope = 'openid agent:read agent:send agent:inbox agent:receive';
interface StoredAuth {
  origin: string;
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  verifier?: string;
}

/** Only the OAuth client reads this private store; credentials never enter logs or CLI arguments. */
export class ManagedAuth implements OAuthClientProvider {
  readonly redirectUrl = 'http://127.0.0.1:8767/callback';
  readonly clientMetadata = {
    client_name: 'Agent Chat — receptor de esta Mac', redirect_uris: [this.redirectUrl],
    token_endpoint_auth_method: 'none' as const, grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'], scope,
  };
  private data: StoredAuth;
  private readonly nonce = randomBytes(24).toString('hex');
  private authorizationUrl?: URL;
  constructor(readonly origin: string, readonly directory: string) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.username || parsed.password ||
        (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)))) {
      throw new Error('Use a bare HTTPS server origin, or HTTP loopback for local tests');
    }
    this.data = { origin };
  }
  async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    try {
      const data = JSON.parse(await readFile(join(this.directory, 'oauth.json'), 'utf8')) as StoredAuth;
      if (data.origin !== this.origin) throw new Error('OAuth store belongs to a different server');
      this.data = data;
      await chmod(join(this.directory, 'oauth.json'), 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // JSON parse errors can include fragments of OAuth credentials.
        // eslint-disable-next-line preserve-caught-error
        throw new Error('Cannot load private OAuth state');
      }
    }
  }
  private async save(): Promise<void> {
    const path = join(this.directory, 'oauth.json');
    const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
    await writeFile(temporary, JSON.stringify(this.data), { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  }
  state = () => this.nonce;
  clientInformation = () => this.data.client;
  tokens = () => this.data.tokens;
  async saveClientInformation(client: OAuthClientInformationMixed) { this.data.client = client; await this.save(); }
  async saveTokens(tokens: OAuthTokens) { this.data.tokens = tokens; await this.save(); }
  async saveCodeVerifier(verifier: string) { this.data.verifier = verifier; await this.save(); }
  codeVerifier() { if (!this.data.verifier) throw new Error('Missing OAuth verifier'); return this.data.verifier; }
  redirectToAuthorization(url: URL) { this.authorizationUrl = url; throw new Error('Run bridge:managed:login to authorize this receiver'); }
  async invalidateCredentials(kind: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (kind === 'all' || kind === 'client') delete this.data.client;
    if (kind === 'all' || kind === 'tokens') delete this.data.tokens;
    if (kind === 'all' || kind === 'verifier') delete this.data.verifier;
    await this.save();
  }
  async login(openAuthorization: (url: URL) => void | Promise<void> = (url) => {
    const browser = spawn('open', [url.href], { stdio: 'ignore' });
    browser.on('error', () => {});
  }, signal?: AbortSignal): Promise<void> {
    // OAuth needs a stable registered loopback callback. This is not a development web server.
    const server = createServer();
    let rejectCallback: (error: Error) => void = () => {};
    const callback = new Promise<string>((resolve, reject) => {
      rejectCallback = reject;
      server.on('request', (request, response) => {
        const url = new URL(request.url ?? '/', this.redirectUrl);
        if (url.origin !== new URL(this.redirectUrl).origin || url.pathname !== '/callback' || request.method !== 'GET' || url.searchParams.get('state') !== this.nonce) {
          response.writeHead(400).end('Callback inválido.'); return;
        }
        const code = url.searchParams.get('code');
        if (!code || url.searchParams.has('error')) {
          response.writeHead(400).end('Autorización rechazada.'); reject(new Error('OAuth consent refused')); return;
        }
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
          .end('Agent Chat recibió la autorización. Podés cerrar esta pestaña.');
        resolve(code);
      });
    });
    void callback.catch(() => {});
    const cancel = () => { rejectCallback(new Error('Authorization window closed')); server.closeAllConnections(); server.close(); };
    signal?.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, 10 * 60_000);
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(8767, '127.0.0.1', resolve); });
      if (signal?.aborted) throw new Error('Authorization cancelled');
      try { await auth(this, { serverUrl: `${this.origin}/mcp`, scope }); }
      catch { if (!this.authorizationUrl) throw new Error('Cannot begin OAuth authorization'); }
      if (!this.authorizationUrl) { console.log('receiver.authorized'); return; }
      await openAuthorization(this.authorizationUrl);
      console.log(`receiver.authorization_required ${this.origin}`);
      const code = await callback;
      if (await auth(this, { serverUrl: `${this.origin}/mcp`, authorizationCode: code, scope }) !== 'AUTHORIZED') {
        throw new Error('OAuth authorization incomplete');
      }
      console.log('receiver.authorized');
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); server.closeAllConnections(); server.close(); }
  }
}
