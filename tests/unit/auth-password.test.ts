import { describe, expect, it } from 'vitest';
import { createArgon2PasswordHasher } from '../../apps/server/src/modules/auth/password';

const PASSWORD = 'correct horse battery staple';

describe('createArgon2PasswordHasher', () => {
  it('hashes with Argon2id, as the approved design requires', async () => {
    const hashed = await createArgon2PasswordHasher().hash(PASSWORD);

    expect(hashed.startsWith('$argon2id$')).toBe(true);
    expect(hashed).not.toContain(PASSWORD);
  });

  it('accepts the password it hashed', async () => {
    const hasher = createArgon2PasswordHasher();
    const hashed = await hasher.hash(PASSWORD);

    expect(await hasher.verify(hashed, PASSWORD)).toBe(true);
  });

  it('rejects a different password', async () => {
    const hasher = createArgon2PasswordHasher();
    const hashed = await hasher.hash(PASSWORD);

    expect(await hasher.verify(hashed, 'correct horse battery staple!')).toBe(false);
    expect(await hasher.verify(hashed, PASSWORD.toUpperCase())).toBe(false);
    expect(await hasher.verify(hashed, '')).toBe(false);
  });

  it('salts every hash so two equal passwords never share a digest', async () => {
    const hasher = createArgon2PasswordHasher();

    const first = await hasher.hash(PASSWORD);
    const second = await hasher.hash(PASSWORD);

    expect(first).not.toBe(second);
    expect(await hasher.verify(first, PASSWORD)).toBe(true);
    expect(await hasher.verify(second, PASSWORD)).toBe(true);
  });

  it('answers false for a stored value that is not a hash instead of throwing', async () => {
    const hasher = createArgon2PasswordHasher();

    expect(await hasher.verify('', PASSWORD)).toBe(false);
    expect(await hasher.verify('not-a-hash', PASSWORD)).toBe(false);
  });
});
