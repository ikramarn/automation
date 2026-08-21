/**
 * Property 13: Password Validation Invariants
 *
 * Validates: Requirements 1.1
 *
 * Password rules (Req 1.1):
 *   - Length: 8–64 characters (inclusive)
 *   - At least one uppercase letter (A-Z)
 *   - At least one lowercase letter (a-z)
 *   - At least one digit (0-9)
 *   - At least one special character from: !@#$%^&*()_+-=[]{};\':"|,.<>/?\\
 */

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { validatePassword } from './password.js';

// ---------------------------------------------------------------------------
// Character class helpers
// ---------------------------------------------------------------------------

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SPECIALS = "!@#$%^&*()_+-=[]{};\\':\"|,.<>/?\\\\";

// Arbitraries for each character class
const arbUppercase = fc.constantFrom(...UPPERCASE);
const arbLowercase = fc.constantFrom(...LOWERCASE);
const arbDigit = fc.constantFrom(...DIGITS);
const arbSpecial = fc.constantFrom(...Array.from(SPECIALS));

/** Pick one random character from a string. */
function oneOf(chars: string) {
  return fc.constantFrom(...Array.from(chars));
}

/**
 * Builds a valid password arbitrary:
 *  1 uppercase + 1 lowercase + 1 digit + 1 special + enough padding to hit [8, 64]
 */
const arbValidPassword = fc
  .tuple(
    arbUppercase,
    arbLowercase,
    arbDigit,
    arbSpecial,
    // Padding to reach valid length — drawn from all four classes so it can't
    // accidentally remove a required class.
    fc.array(
      oneOf(UPPERCASE + LOWERCASE + DIGITS + SPECIALS),
      { minLength: 4, maxLength: 60 },
    ),
  )
  .map(([u, l, d, s, padding]) => {
    // Shuffle so the required chars aren't always at the front.
    const chars = [u, l, d, s, ...padding];
    for (let i = chars.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  })
  .filter((p) => p.length >= 8 && p.length <= 64);

// ---------------------------------------------------------------------------
// Concrete unit tests (oracle / readable examples)
// ---------------------------------------------------------------------------

describe('validatePassword — concrete examples', () => {
  it('accepts a fully compliant password', () => {
    expect(validatePassword('Passw0rd!')).toEqual({ valid: true });
  });

  it('accepts a password at the minimum length of 8', () => {
    expect(validatePassword('Ab1!Xy2@')).toEqual({ valid: true });
  });

  it('accepts a password at the maximum length of 64', () => {
    // 'Aa1!' (4) + 'b'.repeat(60) (60) = 64 chars
    const p64 = 'Aa1!' + 'b'.repeat(60);
    expect(p64.length).toBe(64);
    expect(validatePassword(p64)).toEqual({ valid: true });
  });

  it('rejects a 7-character password even with all required classes', () => {
    const result = validatePassword('Aa1!bcd');
    expect(result.valid).toBe(false);
  });

  it('rejects a 65-character password', () => {
    const p = 'Aa1!' + 'b'.repeat(61);
    expect(p.length).toBe(65);
    expect(validatePassword(p).valid).toBe(false);
  });

  it('rejects a password missing uppercase', () => {
    expect(validatePassword('password1!')).toEqual({
      valid: false,
      reason: 'Password must contain at least one uppercase letter',
    });
  });

  it('rejects a password missing lowercase', () => {
    expect(validatePassword('PASSWORD1!')).toEqual({
      valid: false,
      reason: 'Password must contain at least one lowercase letter',
    });
  });

  it('rejects a password missing a digit', () => {
    expect(validatePassword('Password!')).toEqual({
      valid: false,
      reason: 'Password must contain at least one digit',
    });
  });

  it('rejects a password missing a special character', () => {
    expect(validatePassword('Password1')).toEqual({
      valid: false,
      reason: 'Password must contain at least one special character (!@#$%^&*()_+-=[]{};\':"|,.<>/?\\)',
    });
  });

  it('rejects an empty string', () => {
    expect(validatePassword('').valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Property A — Length too short: strings of length < 8 are always rejected
// ---------------------------------------------------------------------------

describe('Property 13A — length too short always rejected', () => {
  it('rejects any string with length < 8', () => {
    /**
     * **Validates: Requirements 1.1**
     */
    fc.assert(
      fc.property(fc.string({ maxLength: 7 }), (s) => {
        const result = validatePassword(s);
        return result.valid === false;
      }),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property B — Length too long: strings of length > 64 are always rejected
// ---------------------------------------------------------------------------

describe('Property 13B — length too long always rejected', () => {
  it('rejects any string with length > 64', () => {
    /**
     * **Validates: Requirements 1.1**
     */
    fc.assert(
      fc.property(
        fc.string({ minLength: 65, maxLength: 200 }),
        (s) => {
          const result = validatePassword(s);
          return result.valid === false;
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property C — Missing uppercase: no uppercase → always rejected
// ---------------------------------------------------------------------------

describe('Property 13C — missing uppercase always rejected', () => {
  it('rejects passwords of valid length that contain no uppercase letter', () => {
    /**
     * **Validates: Requirements 1.1**
     *
     * Strategy: generate strings from lowercase + digits + specials only (no A-Z).
     */
    const lowerDigitSpecial = LOWERCASE + DIGITS + SPECIALS;
    fc.assert(
      fc.property(
        fc
          .array(oneOf(lowerDigitSpecial), { minLength: 8, maxLength: 64 })
          .map((chars) => chars.join('')),
        (s) => {
          // Guard: the generated string must actually lack uppercase (it should by
          // construction, but ensure the property is vacuously safe).
          if (/[A-Z]/.test(s)) return true; // skip — generator produced uppercase somehow
          return validatePassword(s).valid === false;
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property D — Missing lowercase: no lowercase → always rejected
// ---------------------------------------------------------------------------

describe('Property 13D — missing lowercase always rejected', () => {
  it('rejects passwords of valid length that contain no lowercase letter', () => {
    /**
     * **Validates: Requirements 1.1**
     */
    const upperDigitSpecial = UPPERCASE + DIGITS + SPECIALS;
    fc.assert(
      fc.property(
        fc
          .array(oneOf(upperDigitSpecial), { minLength: 8, maxLength: 64 })
          .map((chars) => chars.join('')),
        (s) => {
          if (/[a-z]/.test(s)) return true;
          return validatePassword(s).valid === false;
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property E — Missing digit: no digit → always rejected
// ---------------------------------------------------------------------------

describe('Property 13E — missing digit always rejected', () => {
  it('rejects passwords of valid length that contain no digit', () => {
    /**
     * **Validates: Requirements 1.1**
     */
    const upperLowerSpecial = UPPERCASE + LOWERCASE + SPECIALS;
    fc.assert(
      fc.property(
        fc
          .array(oneOf(upperLowerSpecial), { minLength: 8, maxLength: 64 })
          .map((chars) => chars.join('')),
        (s) => {
          if (/[0-9]/.test(s)) return true;
          return validatePassword(s).valid === false;
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property F — Missing special char: no special → always rejected
// ---------------------------------------------------------------------------

describe('Property 13F — missing special character always rejected', () => {
  it('rejects passwords of valid length that contain no special character', () => {
    /**
     * **Validates: Requirements 1.1**
     */
    const specialRe = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/;
    const alphanumeric = UPPERCASE + LOWERCASE + DIGITS;
    fc.assert(
      fc.property(
        fc
          .array(oneOf(alphanumeric), { minLength: 8, maxLength: 64 })
          .map((chars) => chars.join('')),
        (s) => {
          if (specialRe.test(s)) return true;
          return validatePassword(s).valid === false;
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property G — Valid password space: all-requirements-met strings accepted
// ---------------------------------------------------------------------------

describe('Property 13G — valid password space accepted', () => {
  it('accepts any password that satisfies all four character-class requirements within 8–64 chars', () => {
    /**
     * **Validates: Requirements 1.1**
     */
    fc.assert(
      fc.property(arbValidPassword, (p) => {
        const result = validatePassword(p);
        return result.valid === true;
      }),
      { numRuns: 1000 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property H — Boundary: exactly 8 chars with all classes → valid
// ---------------------------------------------------------------------------

describe('Property 13H — boundary: 8-char password with all classes is valid', () => {
  it('accepts any 8-character password containing all required classes', () => {
    /**
     * **Validates: Requirements 1.1**
     */
    fc.assert(
      fc.property(
        fc
          .tuple(arbUppercase, arbLowercase, arbDigit, arbSpecial)
          .map(([u, l, d, s]) => {
            // Exactly 8 chars: guaranteed 1 of each class + 4 more from any class
            const extra = Array.from({ length: 4 }, () =>
              (UPPERCASE + LOWERCASE + DIGITS + SPECIALS)[
                Math.floor(Math.random() * (UPPERCASE + LOWERCASE + DIGITS + SPECIALS).length)
              ],
            );
            const chars = [u, l, d, s, ...extra];
            // Shuffle
            for (let i = chars.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [chars[i], chars[j]] = [chars[j], chars[i]];
            }
            return chars.join('');
          })
          .filter((p) => p.length === 8),
        (p) => validatePassword(p).valid === true,
      ),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property I — Boundary: exactly 64 chars with all classes → valid
// ---------------------------------------------------------------------------

describe('Property 13I — boundary: 64-char password with all classes is valid', () => {
  it('accepts any 64-character password containing all required classes', () => {
    /**
     * **Validates: Requirements 1.1**
     */
    fc.assert(
      fc.property(
        fc
          .tuple(arbUppercase, arbLowercase, arbDigit, arbSpecial)
          .map(([u, l, d, s]) => {
            const allChars = UPPERCASE + LOWERCASE + DIGITS + SPECIALS;
            const extra = Array.from({ length: 60 }, () =>
              allChars[Math.floor(Math.random() * allChars.length)],
            );
            const chars = [u, l, d, s, ...extra];
            // Shuffle
            for (let i = chars.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [chars[i], chars[j]] = [chars[j], chars[i]];
            }
            return chars.join('');
          })
          .filter((p) => p.length === 64),
        (p) => validatePassword(p).valid === true,
      ),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property J — Length 7 → always rejected even with all character classes
// ---------------------------------------------------------------------------

describe('Property 13J — 7-char passwords rejected even with all classes', () => {
  it('rejects a 7-character password that contains all required character classes', () => {
    /**
     * **Validates: Requirements 1.1**
     *
     * Strategy: build strings of exactly 7 chars that include at least one of
     * each class — they must still be rejected because length < 8.
     */
    fc.assert(
      fc.property(
        fc
          .tuple(arbUppercase, arbLowercase, arbDigit, arbSpecial)
          .map(([u, l, d, s]) => {
            // 4 required chars + 3 more from any class = 7 total
            const allChars = UPPERCASE + LOWERCASE + DIGITS + SPECIALS;
            const extra = Array.from({ length: 3 }, () =>
              allChars[Math.floor(Math.random() * allChars.length)],
            );
            const chars = [u, l, d, s, ...extra];
            for (let i = chars.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [chars[i], chars[j]] = [chars[j], chars[i]];
            }
            return chars.join('');
          })
          .filter((p) => p.length === 7),
        (p) => validatePassword(p).valid === false,
      ),
      { numRuns: 500 },
    );
  });
});
