import argon2 from 'argon2';

/**
 * The password-hashing port.
 *
 * The modules depend on this interface, never on `argon2` directly, so a use
 * case can be exercised without paying for real key derivation.
 */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}

/**
 * Argon2id with the library's current default cost parameters, which the
 * approved design selects. Only the encoding mode is pinned here: choosing
 * memory, iterations, and parallelism explicitly would silently freeze values
 * that belong to the dependency's security review.
 */
export function createArgon2PasswordHasher(): PasswordHasher {
  return {
    hash: (password) => argon2.hash(password, { type: argon2.argon2id }),
    verify: async (passwordHash, password) => {
      if (passwordHash === '') {
        return false;
      }
      try {
        return await argon2.verify(passwordHash, password);
      } catch {
        // A stored value that is not a valid encoding must fail closed rather
        // than turn a bad row into a 500.
        return false;
      }
    },
  };
}
