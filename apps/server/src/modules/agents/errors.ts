import { DOMAIN_ERROR_CODES } from '@agent-chat/contracts';
import { DomainError } from '../errors.js';

/**
 * Raised when a caller cannot see or change an agent.
 *
 * A missing agent and an agent owned by somebody else answer identically: an
 * agent's ownership is visible to its group members, but probing for agents by
 * id must not reveal who owns what.
 */
export class AgentNotFoundError extends DomainError {
  constructor(message = 'Agent not found') {
    super(DOMAIN_ERROR_CODES.not_found, 404, message);
  }
}

/** Raised when a non-owner attempts an owner-only agent change. */
export class NotAgentOwnerError extends DomainError {
  constructor(message = 'Only the owner may change this agent') {
    super(DOMAIN_ERROR_CODES.forbidden, 403, message);
  }
}

/** Raised when an operation targets a revoked agent or connection. */
export class AgentRevokedError extends DomainError {
  constructor(message = 'Agent access has been revoked') {
    super(DOMAIN_ERROR_CODES.unauthenticated, 401, message);
  }
}

/** Raised when agent profile input fails the shared contracts. */
export class InvalidAgentInputError extends DomainError {
  constructor(message = 'Invalid agent input') {
    super(DOMAIN_ERROR_CODES.invalid_input, 400, message);
  }
}
