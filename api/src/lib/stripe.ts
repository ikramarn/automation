import Stripe from 'stripe';

/**
 * Creates a Stripe client lazily using the STRIPE_SECRET_KEY environment variable.
 *
 * The client is created on first call, not at module load time, to avoid
 * issues in test environments where the env var may not be set.
 *
 * Requirements: 2.1, 2.2, 2.8
 */
export function createStripeClient(): Stripe {
  const secretKey = process.env['STRIPE_SECRET_KEY'];

  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY environment variable is required');
  }

  return new Stripe(secretKey, {
    apiVersion: '2024-06-20',
  });
}
