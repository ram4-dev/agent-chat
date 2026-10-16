import type Database from 'better-sqlite3';

interface ClientArtifactRow {
  payload: string;
  expires_at: string | null;
  consumed_at: string | null;
}

/**
 * Mirrors a dynamically registered client into the application's client registry.
 *
 * The authorization server owns client registration and stores its own copy of
 * the metadata. The application also needs a row of its own, for two reasons: an
 * agent connection is bound to a real client through a foreign key, and the
 * product needs a durable, queryable record of which software was granted access
 * and to which redirect URIs.
 *
 * The projection is deliberately narrow: the client name, its redirect URIs, and
 * whether it is a public client. Secrets never appear here, and a client that is
 * not a public client is recorded as such rather than silently treated as one.
 */
export function ensureClientRegistered(sqlite: Database.Database, clientId: string): void {
  const existing = sqlite
    .prepare('SELECT 1 AS present FROM oauth_clients WHERE client_id = ?')
    .get(clientId);

  if (existing !== undefined) {
    return;
  }

  const row = sqlite
    .prepare(
      `SELECT payload, expires_at, consumed_at
         FROM oidc_artifacts
        WHERE model = 'Client' AND id = ?`,
    )
    .get(clientId) as ClientArtifactRow | undefined;

  if (row === undefined) {
    // Registering an unknown client would invent a client that never
    // authenticated, so the caller must fail instead.
    throw new Error(`Client ${clientId} is not registered with the authorization server`);
  }

  const payload = JSON.parse(row.payload) as {
    client_name?: unknown;
    redirect_uris?: unknown;
    token_endpoint_auth_method?: unknown;
    is_public?: unknown;
  };

  const redirectUris = Array.isArray(payload.redirect_uris)
    ? payload.redirect_uris.filter((uri): uri is string => typeof uri === 'string')
    : [];

  const authMethod =
    typeof payload.token_endpoint_auth_method === 'string'
      ? payload.token_endpoint_auth_method
      : 'none';

  sqlite
    .prepare(
      `INSERT INTO oauth_clients
         (client_id, client_name, redirect_uris, token_endpoint_auth_method, is_public, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      clientId,
      typeof payload.client_name === 'string' && payload.client_name !== ''
        ? payload.client_name
        : 'Unnamed MCP client',
      JSON.stringify(redirectUris),
      authMethod,
      // A client with no authentication method is a public client; anything
      // else holds a secret and must not be treated as one.
      authMethod === 'none' ? 1 : 0,
      JSON.stringify({ redirectUris }),
    );
}
