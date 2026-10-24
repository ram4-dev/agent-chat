import type { AsyncPort } from "../../services.js";
import type { FastifyInstance, FastifyReply } from 'fastify';
import { AUTH_LIMITS, AUTH_PATHS, DOMAIN_ERROR_CODES, SESSION_COOKIE_NAME, parseLoginRequest, parseRegisterRequest, type AuthResponse, type CurrentUserResponse, type LogoutResponse, } from '@agent-chat/contracts';
import { ConfirmationRequiredError, type AuthModule } from '../../modules/auth/index.js';
import { DomainError } from '../../modules/errors.js';
import { clearedSessionCookie, readCookie, serializeSessionCookie } from './cookie.js';
import { sendError } from './error-envelope.js';
export interface AuthRoutesDependencies {
    auth: AsyncPort<AuthModule>;
    /** `Secure` is added to the cookie for every environment that is not local. */
    secureCookies: boolean;
}
/**
 * The four human session routes.
 *
 * Adapters stay thin: they read the transport, call one use case, and translate
 * a domain failure into the shared error envelope. No authorization rule and no
 * persistence detail appears here.
 */
export function registerAuthRoutes(app: FastifyInstance, { auth, secureCookies }: AuthRoutesDependencies): void {
    const cookieOptions = {
        secure: secureCookies,
        maxAgeSeconds: AUTH_LIMITS.HUMAN_SESSION_INACTIVITY_SECONDS,
    };
    app.post(AUTH_PATHS.register, async (request, reply) => {
        const body = parseRegisterRequest(request.body);
        if (!body.ok) {
            return sendInvalidInput(reply);
        }
        return run(reply, async (): Promise<AuthResponse> => {
            const { user, sessionToken } = await auth.register(body.value);
            setSessionCookie(reply, sessionToken, cookieOptions);
            return reply.code(201).send({ user });
        });
    });
    app.post(AUTH_PATHS.login, async (request, reply) => {
        const body = parseLoginRequest(request.body);
        if (!body.ok) {
            return sendInvalidInput(reply);
        }
        return run(reply, async (): Promise<AuthResponse> => {
            const { user, sessionToken } = await auth.login(body.value);
            setSessionCookie(reply, sessionToken, cookieOptions);
            return reply.send({ user });
        });
    });
    app.post(AUTH_PATHS.logout, (request, reply) => {
        return run(reply, async () => {
            await auth.logout(sessionCookie(request.headers.cookie));
            reply.header('set-cookie', clearedSessionCookie(SESSION_COOKIE_NAME, { secure: secureCookies }));
            return reply.send({ status: 'ok' } satisfies LogoutResponse);
        });
    });
    app.get(AUTH_PATHS.me, (request, reply) => {
        return run(reply, async () => {
            const user = await auth.currentUser(sessionCookie(request.headers.cookie));
            return reply.send({ user } satisfies CurrentUserResponse);
        });
    });
}
function sessionCookie(cookieHeader: string | undefined): string | undefined {
    return readCookie(cookieHeader, SESSION_COOKIE_NAME);
}
function setSessionCookie(reply: FastifyReply, token: string, options: {
    secure: boolean;
    maxAgeSeconds: number;
}): void {
    reply.header('set-cookie', serializeSessionCookie(SESSION_COOKIE_NAME, token, options));
}
/**
 * Runs one handler and maps a deliberate domain failure onto the wire.
 *
 * Anything unexpected is rethrown so the shared error handler owns it and the
 * response keeps a stable code without leaking internals.
 */
async function run<T>(reply: FastifyReply, handler: () => T | Promise<T>): Promise<T | FastifyReply> {
    try {
        return await handler();
    }
    catch (error) {
        if (error instanceof ConfirmationRequiredError) return reply.code(202).send({ status: 'confirmation_required' });
        if (error instanceof DomainError) {
            return sendError(reply, error.statusCode, error.code);
        }
        throw error;
    }
}
function sendInvalidInput(reply: FastifyReply): FastifyReply {
    return sendError(reply, 400, DOMAIN_ERROR_CODES.invalid_input);
}
