import { DOMAIN_ERROR_CODES } from '@agent-chat/contracts';
import { DomainError } from '../errors.js';

/**
 * Raised when the caller cannot see the group.
 *
 * A non-member and a missing group answer identically: telling a caller that a
 * private group exists would leak the membership graph the PRD protects.
 */
export class GroupNotFoundError extends DomainError {
  constructor(message = 'Group not found') {
    super(DOMAIN_ERROR_CODES.not_found, 404, message);
  }
}

/** Raised when a member attempts something reserved for a group admin. */
export class NotGroupAdminError extends DomainError {
  constructor(message = 'Group admin authority is required') {
    super(DOMAIN_ERROR_CODES.forbidden, 403, message);
  }
}

/** Raised when an operation would leave a private group without an admin. */
export class LastGroupAdminError extends DomainError {
  constructor(message = 'A group must keep at least one admin') {
    super(DOMAIN_ERROR_CODES.conflict, 409, message);
  }
}

/** Raised when an invitation token is unknown, expired, or already used. */
export class InvitationInvalidError extends DomainError {
  constructor(message = 'Invitation is not usable') {
    super(DOMAIN_ERROR_CODES.not_found, 404, message);
  }
}
