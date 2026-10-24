import { DOMAIN_ERROR_CODES } from '@agent-chat/contracts';
import { DomainError } from '../errors.js';

/**
 * Raised when untrusted input fails a shared contract check.
 *
 * The response is deliberately identical for every rejection reason: telling a
 * caller which part of their input was wrong turns registration into an oracle
 * for which addresses exist.
 */
export class InvalidInputError extends DomainError {
  constructor(message = 'Invalid input') {
    super(DOMAIN_ERROR_CODES.invalid_input, 400, message);
  }
}

/**
 * Raised when the unique e-mail index rejects an insert, or when a caller
 * inserts a row that would collide with it.
 *
 * The message never confirms that the address exists; it only reports that the
 * pair cannot be registered.
 */
export class EmailAlreadyRegisteredError extends DomainError {
  constructor(message = 'Email already registered') {
    super(DOMAIN_ERROR_CODES.conflict, 409, message);
  }
}

/** Raised when a stored session is absent, expired, or revoked. */
export class SessionInvalidError extends DomainError {
  constructor(message = 'Session is not valid') {
    super(DOMAIN_ERROR_CODES.unauthenticated, 401, message);
  }
}

/** Raised when credentials do not match a stored account. */
export class InvalidCredentialsError extends DomainError {
  constructor(message = 'Invalid credentials') {
    super(DOMAIN_ERROR_CODES.unauthenticated, 401, message);
  }
}

export { DomainError };
