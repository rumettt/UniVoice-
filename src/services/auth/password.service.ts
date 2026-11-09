import * as argon2 from 'argon2';

/**
 * Hashes a plaintext password using Argon2id.
 * Never logs or stores plaintext passwords.
 */
export async function hashPassword(plainText: string): Promise<string> {
  return argon2.hash(plainText, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MB
    timeCost: 3,       // 3 iterations
    parallelism: 4,
  });
}

/**
 * Securely verifies a candidate password against an Argon2id hash.
 * Returns false on verification error or mismatch without leaking internal details.
 */
export async function verifyPassword(
  hash: string,
  plainText: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plainText);
  } catch {
    return false;
  }
}
