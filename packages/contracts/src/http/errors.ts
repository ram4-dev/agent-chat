import type { DomainErrorCode } from '../domain/errors.js';

export interface ErrorResponse {
  error: { code: DomainErrorCode };
}
