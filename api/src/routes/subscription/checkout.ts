import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createStripeClient } from '../../lib/stripe.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { AppError } from '../../errors/AppError.js';

/**
 * POST /subscription/checkout
 *
 * Creates a Stripe Checkout session for the subscription tier.
 * Gets or creates a Stripe Customer for the user, stores the customer ID
 * in user_profiles, and returns the checkout session redirect URL.
 *
 * Requirements: 2.1, 2.2
 */
export async function checkoutRoute(app: FastifyInstance): Promise<void> {
  app.post('/checkout', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user.id;
    const userEmail = request.user.email;

    const priceId = process.env['STRIPE_PRICE_ID'];
    const successUrl = process.env['STRIPE_SUCCESS_URL'];
    const cancelUrl = process.env['STRIPE_CANCEL_URL'];

    if (!priceId) {
      throw new AppError(500, 'server_error', 'STRIPE_PRICE_ID is not configured');
    }
    if (!successUrl) {
      throw new AppError(500, 'server_error', 'STRIPE_SUCCESS_URL is not configured');
    }
    if (!cancelUrl) {
      throw new AppError(500, 'server_error', 'STRIPE_CANCEL_URL is not configured');
    }

    const stripe = createStripeClient();
    const supabase = createSupabaseAdminClient();

    // Look up existing stripe_customer_id from user_profiles
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      // PGRST116 = row not found; other errors are real errors
      request.log.error({ err: profileError }, 'Failed to fetch user profile');
      throw new AppError(500, 'server_error', 'Failed to retrieve user profile');
    }

    let stripeCustomerId: string | null = profile?.stripe_customer_id ?? null;

    // Create a new Stripe Customer if one doesn't exist yet
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: { supabase_user_id: userId },
      });
      stripeCustomerId = customer.id;

      // Persist the new customer ID back to user_profiles
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', userId);

      if (updateError) {
        request.log.error({ err: updateError }, 'Failed to save stripe_customer_id');
        // Non-fatal: we can still proceed with checkout but log the issue
      }
    }

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      client_reference_id: userId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return reply.code(200).send({ url: session.url });
  });
}
