import { randomBytes } from 'node:crypto';

/** The four legal first hex characters of the RFC 9562 variant field. */
const VARIANT_NIBBLES = ['8', '9', 'a', 'b'] as const;

/** Milliseconds since the Unix epoch that fit in the 48-bit UUIDv7 timestamp. */
const MAX_TIMESTAMP_MS = 2 ** 48 - 1;

/** Hex characters in a UUIDv7 node segment. */
const NODE_HEX_LENGTH = 12;

/**
 * Generates an opaque, time-ordered UUIDv7 identifier.
 *
 * The approved Program Design chooses UUIDv7 because it sorts by creation time,
 * which keeps SQLite indexes dense and makes cursors cheap, while staying
 * non-guessable: the timestamp is public but the remaining random bits are not.
 * Identifiers are never sequential integers, so an identifier cannot be
 * enumerated, which is what the denial-without-leakage policy requires.
 */
export function generateUuidV7(nowMs: number = Date.now()): string {
  const timestamp = Math.floor(nowMs);

  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > MAX_TIMESTAMP_MS) {
    throw new RangeError(`Timestamp out of range for a UUIDv7: ${nowMs}`);
  }

  const timeHex = timestamp.toString(16).padStart(12, '0');
  const entropy = randomBytes(10).toString('hex');

  const timeLow = timeHex.slice(0, 8);
  const timeMid = timeHex.slice(8, 12);
  const versionAndRand = `7${entropy.slice(0, 3)}`;
  const variant = VARIANT_NIBBLES[randomBytes(1)[0]! & 0x03]!;
  const clockSeq = `${variant}${entropy.slice(3, 6)}`;
  const node = entropy.slice(6, 6 + NODE_HEX_LENGTH);

  return `${timeLow}-${timeMid}-${versionAndRand}-${clockSeq}-${node}`;
}
