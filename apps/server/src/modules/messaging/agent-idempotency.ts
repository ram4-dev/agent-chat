import { DomainError } from '../errors.js';
const NATIVE_PREFIX = 'native:';
/** Existing automatic publication keys remain stable across upgrades and retries. */
export const nativePublicationKey = (eventId: string): string => `${NATIVE_PREFIX}${eventId}`;
/** Public agent writes cannot occupy the automatic publication namespace. */
export function assertPublicAgentIdempotencyKey(key: string): void {
  if (key.startsWith(NATIVE_PREFIX)) throw new DomainError('invalid_input', 400, 'Reserved native idempotency prefix');
}
