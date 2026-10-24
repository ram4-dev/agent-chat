import type { AsyncPort } from "../../services.js";
import { jwtVerify, type JWK } from 'jose';
import type { AgentsModule, AgentScope } from '../../modules/agents/index.js';
/** What a verified MCP credential is allowed to do, and as whom. */
export interface AgentCredential {
    agentId: string;
    connectionId: string;
    scopes: AgentScope[];
    expiresAt: number;
}
export class McpUnauthenticated extends Error {
    constructor(message = 'An agent credential is required') {
        super(message);
        this.name = 'McpUnauthenticated';
    }
}
export interface McpAuthenticatorOptions {
    /** The public half of the signing key; the private half never reaches here. */
    publicJwk: JWK;
    issuer: string;
    audience: string;
    agents: AsyncPort<AgentsModule>;
}
/**
 * Verifies the bearer credential an MCP tool call carries.
 *
 * Four things have to hold before any tool runs, and they are checked in this
 * order so that a token which is merely well-formed still gets no access: the
 * signature and expiry must verify for our issuer and audience; the token must
 * carry an agent binding at all; the connection behind it must be live; and the
 * agent behind that connection must still be active.
 *
 * Connection and agent state are read from the database on every call, which is
 * what makes revocation take effect on the next tool call instead of when a
 * token happens to expire.
 */
export function createMcpAuthenticator({ publicJwk, issuer, audience, agents, }: McpAuthenticatorOptions): (authorization: string | undefined) => Promise<AgentCredential> {
    const key = { ...publicJwk, use: 'sig' } as unknown as CryptoKey;
    return async (authorization) => {
        if (authorization === undefined || !authorization.startsWith('Bearer ')) {
            throw new McpUnauthenticated();
        }
        let payload;
        try {
            ({ payload } = await jwtVerify(authorization.slice(7), key, { issuer, audience, algorithms: ['EdDSA'], requiredClaims: ['exp', 'iat'] }));
        }
        catch {
            // The reason a token is rejected is never reported to the caller: an
            // expired, forged, and wrong-audience credential all get one answer.
            throw new McpUnauthenticated();
        }
        const { agent_id: agentId, connection_id: connectionId } = payload as {
            agent_id?: unknown;
            connection_id?: unknown;
        };
        if (typeof agentId !== 'string' || typeof connectionId !== 'string') {
            // A token issued without an agent binding is not an agent credential.
            throw new McpUnauthenticated();
        }
        let resolved;
        try {
            resolved = await agents.resolveActiveConnection(connectionId);
        }
        catch {
            throw new McpUnauthenticated();
        }
        if (resolved.agent.id !== agentId) {
            throw new McpUnauthenticated();
        }
        return {
            agentId,
            connectionId,
            scopes: resolved.connection.scopes.filter((scope) => typeof payload.scope === 'string' && payload.scope.split(' ').includes(scope)) as AgentScope[],
            expiresAt: payload.exp! * 1000,
        };
    };
}
