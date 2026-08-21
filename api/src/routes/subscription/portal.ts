import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createStripeClient } from '../../lib/stripe.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { AppError } from '../../errors/AppError.js';

/**
 * GET /subscription/portal
 *
 * Creates a Stripe Customer Portal session for the authenticated user.
 * Returns the portal session URL for the user to manage their subscription.
 *
 * Requirements: 2.8
 */
export async function portalRoute(app: FastifyInstance): Promise<void> {
  app.get('/portal', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user.id;

    const supabase = createSupabaseAdminClient();

    // Fetch stripe_customer_id from user_profiles
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (profileError) {
      request.log.error({ err: profileError }, 'Failed to fetch user profile for portal');
      throw new AppError(500, 'server_error', 'Failed to retrieve user profile');
    }

    const stripeCustomerId: string | null = profile?.stripe_customer_id ?? null;

    if (!stripeCustomerId) {
      throw new AppError(400, 'no_subscription', 'No Stripe customer found for this user');
    }

    const stripe = createStripeClient();

    const returnUrl = process.env['STRIPE_PORTAL_RETURN_URL'] ?? process.env['STRIPE_SUCCESS_URL'];
    if (!returnUrl) {
      throw new AppError(500, 'server_error', 'Portal return URL is not configured');
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });

    return reply.code(200).send({ url: portalSession.url });
  });
}
