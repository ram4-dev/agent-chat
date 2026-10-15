import { describe, expect, it } from 'vitest';
import { DOMAIN_ERROR_CODES } from '@agent-chat/contracts';
import {
  createIdentityModule,
  type IdentityModule,
  type UserRecord,
  type UserRepository,
  type Clock,
} from '../../apps/server/src/modules/identity/index';
import { generateUuidV7 } from '../../apps/server/src/modules/identity/ids';
import {
  EmailAlreadyRegisteredError,
  InvalidInputError,
} from '../../apps/server/src/modules/identity/errors';

const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z');

/** In-memory stand-in for the `users` table, including its unique e-mail index. */
function createFakeUsers(): UserRepository & { rows: UserRecord[] } {
  const rows: UserRecord[] = [];
  return {
    rows,
    insert(user) {
      if (rows.some((row) => row.email === user.email)) {
        throw new EmailAlreadyRegisteredError();
      }
      rows.push(user);
    },
    findByEmail: (email) => rows.find((row) => row.email === email),
    findById: (id) => rows.find((row) => row.id === id),
  };
}

function identityWith(fake: UserRepository): IdentityModule {
  let counter = 0;
  const clock: Clock = { now: () => FIXED_NOW };
  return createIdentityModule({
    users: fake,
    clock,
    generateId: () => `user-${++counter}`,
  });
}

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('generateUuidV7', () => {
  it('encodes the timestamp, the version, and the variant the schema documents', () => {
    const id = generateUuidV7(Date.parse('2026-01-01T00:00:00.000Z'));

    expect(id).toHaveLength(36);
    // The first 12 hex characters are the timestamp: 1767225600000 == 0x019b76daa800.
    expect(id.slice(0, 13)).toBe('019b76da-a800');
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('sorts lexicographically in the order the identifiers were created', () => {
    const earlier = generateUuidV7(1_700_000_000_000);
    const later = generateUuidV7(1_700_000_000_001);

    expect(earlier < later).toBe(true);
  });

  it('produces a distinct identifier for the same millisecond', () => {
    const first = generateUuidV7(1_700_000_000_000);
    const second = generateUuidV7(1_700_000_000_000);

    expect(first).not.toBe(second);
  });
});

describe('createIdentityModule', () => {
  it('stores the normalized e-mail and the trimmed display name', () => {
    const fake = createFakeUsers();
    const identity = identityWith(fake);

    const user = identity.createUser({
      email: '  Person@Example.COM ',
      displayName: '  Ada Lovelace  ',
      passwordHash: '$argon2id$stored',
    });

    expect(user).toEqual({
      id: 'user-1',
      email: 'person@example.com',
      passwordHash: '$argon2id$stored',
      displayName: 'Ada Lovelace',
      createdAt: FIXED_NOW.toISOString(),
    });
    expect(fake.rows).toEqual([user]);
  });

  it('lets the unique index decide duplicates and keeps the conflict signal', () => {
    const fake = createFakeUsers();
    const identity = identityWith(fake);
    identity.createUser({ email: 'p@example.com', displayName: 'Ada', passwordHash: 'hash' });

    const error = captureError(() =>
      identity.createUser({ email: 'P@Example.com', displayName: 'Grace', passwordHash: 'hash' }),
    );

    expect(error).toBeInstanceOf(EmailAlreadyRegisteredError);
    expect((error as EmailAlreadyRegisteredError).code).toBe(DOMAIN_ERROR_CODES.conflict);
    expect(fake.rows).toHaveLength(1);
  });

  it.each([
    ['not-an-email', 'Ada'],
    ['person@example', 'Ada'],
    ['person@example.com', '   '],
  ])('rejects the pair %j / %j before touching the table', (email, displayName) => {
    const fake = createFakeUsers();
    const identity = identityWith(fake);

    const error = captureError(() => identity.createUser({ email, displayName, passwordHash: 'h' }));

    expect(error).toBeInstanceOf(InvalidInputError);
    expect((error as InvalidInputError).statusCode).toBe(400);
    expect(fake.rows).toEqual([]);
  });

  it('finds a stored user through a differently cased e-mail', () => {
    const fake = createFakeUsers();
    const identity = identityWith(fake);
    const created = identity.createUser({
      email: 'person@example.com',
      displayName: 'Ada',
      passwordHash: 'hash',
    });

    expect(identity.findByEmail(' Person@Example.com ')?.id).toBe(created.id);
    expect(identity.findByEmail('nobody@example.com')).toBeUndefined();
  });

  it('projects the current user without the password hash', () => {
    const fake = createFakeUsers();
    const identity = identityWith(fake);
    const created = identity.createUser({
      email: 'person@example.com',
      displayName: 'Ada',
      passwordHash: '$argon2id$secret',
    });

    expect(identity.getCurrentUser(created.id)).toEqual({
      id: 'user-1',
      email: 'person@example.com',
      displayName: 'Ada',
      createdAt: FIXED_NOW.toISOString(),
    });
    expect(identity.getCurrentUser('user-999')).toBeUndefined();
  });
});
