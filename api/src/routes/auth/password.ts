/**
 * Password validation utilities.
 *
 * Req 1.1: Password must be 8–64 chars and contain at least one uppercase
 * letter, one lowercase letter, one digit, and one special character.
 */

export interface PasswordValidationResult {
  valid: boolean;
  reason?: string;
}

const SPECIAL_CHAR_RE = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/;

/**
 * Validates a plaintext password against the platform's password policy.
 *
 * Returns `{ valid: true }` on success, or `{ valid: false, reason }` with
 * a human-readable explanation on failure.
 */
export function validatePassword(password: string): PasswordValidationResult {
  if (password.length < 8) {
    return { valid: false, reason: 'Password must be at least 8 characters long' };
  }
  if (password.length > 64) {
    return { valid: false, reason: 'Password must be at most 64 characters long' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one uppercase letter' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one lowercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one digit' };
  }
  if (!SPECIAL_CHAR_RE.test(password)) {
    return {
      valid: false,
      reason: 'Password must contain at least one special character (!@#$%^&*()_+-=[]{};\':"|,.<>/?\\)',
    };
  }
  return { valid: true };
}
