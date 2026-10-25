import Fastify, { type FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { createRequestLimiter } from './modules/rate-limit/index.js';
import { createMcpAuthenticator } from './adapters/mcp/auth.js';
import { readCookie } from './adapters/http/cookie.js';
import { sendError } from './adapters/http/error-envelope.js';
import { LIMITS, RATE_LIMITS, SESSION_COOKIE_NAME } from '@agent-chat/contracts';
import { registerAgentSocket } from './adapters/agent-ws/index.js';
import { registerBrowserSocket } from './adapters/browser-ws/index.js';
import { registerInteractionRoutes } from './adapters/oauth/interactions.js';
import { registerMcpRoutes } from './adapters/mcp/routes.js';
import { createOidcProvider, loadOrGenerateJwks, toPublicJwk, } from './adapters/oauth/provider.js';
import { registerOidcRoutes } from './adapters/oauth/routes.js';
import type { RuntimeConfig } from './config/index.js';
import type { DatabaseHandle } from './persistence/index.js';
import { createServices, type ApplicationServices } from './services.js';
import { registerHttpAdapter } from './adapters/http/index.js';
import type { OAuthStore } from './persistence/oauth-store.js';
export interface AppDependencies {
    config: RuntimeConfig;
    database?: DatabaseHandle;
    oauthStore?: OAuthStore;
    health?: () => Promise<boolean>;
    budget?: (key: string, max: number) => Promise<boolean>;
    services?: ApplicationServices;
}
/**
 * Builds the Fastify application. The returned instance is not listening: the
 * entrypoint decides when the process may accept traffic.
 *
 * Route order is load-bearing. The authorization server owns fixed root paths
 * and the browser socket owns a fixed path, so both must be registered before
 * the static catch-all that serves the client bundle; otherwise the catch-all
 * would answer for them with the not-found envelope.
 */
export async function createApp({ config, database, oauthStore, health, budget, services = createServices(database!), }: AppDependencies): Promise<FastifyInstance> {
    const app = Fastify({
        trustProxy: config.trustProxy === 'platform' ? true : config.trustProxy ?? false,
        logger: config.logLevel === 'silent' ? false : {
            level: config.logLevel,
            // OAuth callback query strings may contain single-use credentials.
            serializers: { req: (req) => ({ method: req.method, url: req.url?.split('?')[0], hostname: req.hostname, remoteAddress: req.ip }) },
            redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
        },
    });
    const sockets = await import('@fastify/websocket');
    await app.register(sockets.default, {
        options: { maxPayload: limits.websocketFrameBytes },
    });
    const jwks = config.managed?.jwks ?? await loadOrGenerateJwks(config.oidcJwksPath);
    const provider = await createOidcProvider({
        issuer: config.publicOrigin,
        trustProxy: !!config.trustProxy,
        ...(database ? { sqlite: database.sqlite } : {}),
        ...(oauthStore ? { store: oauthStore } : {}),
        ...(config.managed ? { cookieKeys: config.managed.cookieKeys } : {}),
        agents: services.agents,
        jwks,
        interactionsUrl: (uid) => `${interactionPrefix}/${uid}`,
        ...(providerLogLevelOf(config) === undefined ? {} : { logLevel: providerLogLevelOf(config) }),
    });
    const limiter = createRequestLimiter();
    const authorize = createMcpAuthenticator({ publicJwk: toPublicJwk(jwks.keys[0]), issuer: config.publicOrigin, audience: config.publicOrigin, agents: services.agents });
    app.addHook('onRequest', async (request, reply) => {
        const path = request.url.split('?')[0]!;
        if (!(path.startsWith('/api/') || path.startsWith('/native/') || path.startsWith('/agent/') || path.startsWith('/internal/') || path.startsWith('/ws/') || ['/mcp', '/auth', '/token', '/reg'].includes(path)))
            return;
        let key = `ip:${request.ip}`;
        let max: number = RATE_LIMITS.UNAUTHENTICATED_IP;
        if (path === '/mcp' || path === '/ws/agent') {
            try {
                const credential = await authorize(request.headers.authorization);
                key = `agent:${credential.connectionId}`;
                max = RATE_LIMITS.AGENT_CONNECTION;
            }
            catch { /* Invalid credentials share the unauthenticated IP budget. */ }
        }
        else if (path.startsWith('/api/') || path === '/ws/browser') {
            const token = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
            try {
                await services.auth.resolveSession(token);
                key = `human:${createHash('sha256').update(token!).digest('hex')}`;
                max = RATE_LIMITS.HUMAN_SESSION;
            }
            catch { /* No authenticated human session. */ }
        }
        if (!(budget ? await budget(key, max) : limiter.allow(key, max)))
            return sendError(reply, 429, 'rate_limited');
    });
    // Handlers reach the provider through the instance rather than through a
    // module-level singleton, so two applications in one process stay isolated.
    app.decorate('oidcProvider', provider);
    // A plain HTML form posts urlencoded, so the consent screen needs a parser
    // for it; the application API keeps its JSON parser.
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
        done(null, new URLSearchParams(body as string));
    });
    await registerOidcRoutes(app, provider, config.trustProxy === 'platform');
    registerInteractionRoutes(app, {
        provider,
        agents: services.agents,
        auth: services.auth,
        ...(database ? { sqlite: database.sqlite } : {}),
        ...(oauthStore ? { store: oauthStore } : {}),
        issuer: config.publicOrigin,
    });
    // The MCP endpoint is mounted before the static catch-all for the same reason
    // the OAuth routes are: the catch-all would otherwise answer for it.
    await registerMcpRoutes(app, {
        publicJwk: toPublicJwk(jwks.keys[0]),
        issuer: config.publicOrigin,
        audience: config.publicOrigin,
        services,
    });
    registerAgentSocket(app, {
        publicJwk: toPublicJwk(jwks.keys[0]), issuer: config.publicOrigin,
        audience: config.publicOrigin, services,
    });
    registerBrowserSocket(app, {
        auth: services.auth,
        groups: services.groups,
        hub: services.hub,
        maxSocketsPerSession: limits.browserSocketsPerSession,
        ...(services.socketLeases ? { socketLeases: services.socketLeases } : {}),
    });
    registerHttpAdapter(app, { config, ...(database ? { database } : {}), ...(health ? { health } : {}), services });
    if (services.nativeDelivery) {
        const delivery = services.nativeDelivery;
        const retain = () => { try { delivery.retain(); } catch { app.log.warn('Native retention deferred'); } };
        const retention = setInterval(retain, 3600_000);
        retention.unref();
        app.addHook('onReady', async () => { retain(); });
        app.addHook('onClose', async () => { clearInterval(retention); });
    }
    return app;
}
/** Read once so the route table and the provider cannot disagree about sizes. */
const limits = {
    websocketFrameBytes: LIMITS.WEBSOCKET_FRAME_BYTES,
    browserSocketsPerSession: LIMITS.BROWSER_SOCKETS_MAX_PER_SESSION,
} as const;
const interactionPrefix = '/oauth/interaction';
/**
 * The provider accepts a narrower set of levels than the application does, so
 * the two are mapped rather than passed through; a silent or trace-level
 * application run disables the provider's own logging.
 */
function providerLogLevelOf(config: RuntimeConfig): string | undefined {
    const level = config.logLevel;
    return level === 'debug' || level === 'info' || level === 'warn' || level === 'error'
        ? level
        : undefined;
}
/** The instance type the factory returns, for adapters and tests that hold one. */
export type { FastifyInstance };
