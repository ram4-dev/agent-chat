import { readFileSync } from 'node:fs';
import Provider, { errors } from 'oidc-provider';
import { exportJWK, generateKeyPair, type JWK } from 'jose';
import type Database from 'better-sqlite3';
import { LIMITS } from '@agent-chat/contracts';
import { AGENT_SCOPES } from '../../modules/agents/index.js';
import type { AgentsModule } from '../../modules/agents/index.js';
import { createSqliteOAuthStore, type OAuthStore } from '../../persistence/oauth-store.js';
import type { AsyncPort } from '../../services.js';
import { isAgentResource } from './resource.js';

/** The paths the provider owns. They are registered explicitly on Fastify. */
export const OIDC_ROUTE_PATHS = [
  '/.well-known/openid-configuration',
  '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration/jwks',
  '/jwks',
  '/auth',
  // The provider resumes an authorization request after an interaction through
  // this path; leaving it unregistered makes every completed consent a 404.
  '/auth/:uid',
  '/token',
  '/me',
  '/reg',
  '/reg/:clientId',
  '/session/end',
  '/revocation',
  '/introspection',
  '/device/auth',
  '/device/verify',
  '/device/callback',
] as const;

export interface OidcProviderOptions {
  /**
   * The issuer, which must be the bare origin.
   *
   * A path-bearing issuer makes the provider publish endpoints under that path
   * while still expecting them at the root, and every request then answers 404.
   */
  issuer: string;
  trustProxy?: boolean;
  sqlite?: Database.Database;
  store?: OAuthStore;
  agents: AsyncPort<AgentsModule>;
  /** Signing material; generated for local use when omitted. */
  jwks?: { keys: JWK[] };
  /** Cookie encryption keys. Omitted means a generated pair. */
  cookieKeys?: string[];
  interactionsUrl(uid: string): string;
  /** Development-only verbose logging; never enabled in production. */
  logLevel?: string;
}

/**
 * Builds the in-process authorization server.
 *
 * It is configured to hand out agent credentials rather than human sessions:
 * every access token is audience-bound to this resource, PKCE is mandatory, and
 * `extraAccessTokenClaims` injects `agent_id` and `connection_id` only after the
 * agents module confirms the connection and its agent are both still live.
 */
export async function createOidcProvider({
  issuer,
  trustProxy = false,
  sqlite,
  store: configuredStore,
  agents,
  jwks,
  cookieKeys,
  interactionsUrl,
  logLevel,
}: OidcProviderOptions): Promise<Provider> {
  if (!configuredStore && !sqlite) throw new Error('OAuth persistence is required');
  const store = configuredStore ?? createSqliteOAuthStore(sqlite!);
  const provider = new Provider(issuer, {
    adapter: store.adapterFactory(async (grantId) => {
      const claims = await store.claims(grantId, agents);
      if (claims) await agents.revokeCompromisedConnection(claims.connectionId);
    }) as never,
    findAccount: async (_ctx, accountId, token) => {
      if (token?.grantId && (await store.claims(token.grantId, agents)) === undefined) return undefined;
      const user = await store.hasUser(accountId);
      return user ? { accountId, claims: async () => ({ sub: accountId }) } : undefined;
    },
    clients: [],
    jwks: jwks ?? (await generateJwks()),
    cookies: {
      keys: cookieKeys ?? [randomKey(), randomKey()],
      // The interaction cookie only has to survive a consent screen.
      short: { sameSite: 'lax', path: '/' },
      long: { sameSite: 'lax', path: '/' },
    },
    features: {
      // MCP clients register themselves; a pre-shared client id would make the
      // platform unusable with arbitrary clients.
      registration: { enabled: true, initialAccessToken: false },
      revocation: { enabled: true },
      introspection: { enabled: true },
      // The provider's built-in screens auto-approve. Consent here has to bind
      // a real human and a real agent identity, so they stay off.
      devInteractions: { enabled: false },
      // Access tokens are minted as JWTs for our own resource.
      //
      // The format is configured per resource server rather than globally, so a
      // credential can carry the agent it speaks for and a resource can verify
      // issuer, audience, and expiry locally instead of introspecting every call.
      resourceIndicators: {
        enabled: true,
        defaultResource: () => issuer,
        // The token request carries no `resource` parameter. Without this the
        // resource granted at the authorization request is never applied to the
        // issued access token, so it stays opaque instead of carrying the agent.
        useGrantedResource: () => true,
        getResourceServerInfo: (_ctx, resource) => {
          if (!isAgentResource(resource, issuer)) throw new errors.InvalidTarget();
          return {
          scope: [...AGENT_SCOPES].join(' '),
          audience: issuer,
          accessTokenFormat: 'jwt',
          jwt: { sign: { alg: 'EdDSA' } },
          };
        },
      },
    },
    // Every client is treated as public, so PKCE is the only proof of
    // possession there is; making it optional would let a client opt out.
    pkce: { required: () => true },
    // The deployment signs with EdDSA only, while a client's default
    // expectation is RS256. Declaring the default here keeps MCP clients working
    // without each of them having to know our key type.
    clientDefaults: { id_token_signed_response_alg: 'EdDSA' },
    // Agent credentials must outlive a single working session: an owner consents
    // once and the runtime keeps operating for up to the refresh-token family
    // lifetime. Without this, refresh tokens would require the `offline_access`
    // scope, which would put a library default in front of a product decision.
    issueRefreshToken: () => true,
    expiresWithSession: () => false,
    scopes: ['openid', ...AGENT_SCOPES],
    claims: { openid: ['sub'] },
    interactions: {
      url: (_ctx, interaction) => interactionsUrl(interaction.uid),
    },
    ttl: {
      AuthorizationCode: LIMITS.OAUTH_AUTHORIZATION_CODE_TTL_SECONDS,
      AccessToken: LIMITS.ACCESS_TOKEN_TTL_SECONDS,
      RefreshToken: LIMITS.REFRESH_TOKEN_FAMILY_MAX_LIFETIME_DAYS * 24 * 60 * 60,
      IdToken: LIMITS.ACCESS_TOKEN_TTL_SECONDS,
      Interaction: 10 * 60,
      Session: 8 * 60 * 60,
      Grant: LIMITS.REFRESH_TOKEN_FAMILY_MAX_LIFETIME_DAYS * 24 * 60 * 60,
    },
    // Rotation is what makes a stolen refresh token single-use: the second use
    // of an old value is detectable and takes the whole family down.
    rotateRefreshToken: true,
    clientBasedCORS: () => false,
    ...(logLevel === undefined ? {} : { logLevel: logLevel as never }),
    // The one extension point that turns a human consent into an agent
    // credential. It re-checks live state on every issuance.
    extraTokenClaims: async (
      _ctx: unknown,
      token: { grantId?: string; clientId?: string },
    ) => {
      if (token.clientId === undefined) {
        return {};
      }

      const claims = (await store.claims(token.grantId, agents));
      return claims === undefined
        ? {}
        : { agent_id: claims.agentId, connection_id: claims.connectionId };
    },
  });

  // Forwarded headers are trusted only when explicitly configured. The route
  // adapter removes them from requests that did not arrive over loopback.
  provider.proxy = trustProxy;

  return provider;
}

/**
 * Loads signing keys from a file when one is configured, otherwise generates a
 * throwaway pair.
 *
 * Local and test runs must work with no external secret, and a deployment must
 * be able to keep its keys out of the database and the repository.
 */
export async function loadOrGenerateJwks(path?: string): Promise<{ keys: JWK[] }> {
  if (path !== undefined && path !== '') {
    const contents = JSON.parse(readFileSync(path, 'utf8')) as { keys: JWK[] };
    if (!Array.isArray(contents.keys) || contents.keys.length === 0) {
      throw new Error(`No keys in the JWKS file at ${path}`);
    }
    return contents;
  }
  return generateJwks();
}

/**
 * Public half of each signing key.
 *
 * Token verification must never hold the private half: only the fields a
 * resource needs to check a signature survive here.
 */
export function toPublicJwk(jwk: JWK): JWK {
  const { d: _d, p: _p, q: _q, dp: _dp, dq: _dq, qi: _qi, ...publicPart } = jwk;
  return publicPart;
}

async function generateJwks(): Promise<{ keys: JWK[] }> {
  const { privateKey } = await generateKeyPair('EdDSA', {
    crv: 'Ed25519',
    extractable: true,
  });
  const jwk = await exportJWK(privateKey);
  return { keys: [{ ...jwk, alg: 'EdDSA', use: 'sig', kid: 'agent-chat-1' }] };
}

function randomKey(): string {
  // The provider only needs high-entropy cookie keys; length is what matters.
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}
