import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { AppError } from '../../errors/AppError.js';

/**
 * GET /subscription/status
 *
 * Returns the current subscription status for the authenticated user
 * from the user_profiles table.
 *
 * Requirements: 2.1, 2.6
 */
export async function statusRoute(app: FastifyInstance): Promise<void> {
  app.get('/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user.id;

    const supabase = createSupabaseAdminClient();

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('subscription_status, stripe_subscription_id, subscription_expires_at')
      .eq('id', userId)
      .single();

    if (profileError) {
      request.log.error({ err: profileError }, 'Failed to fetch subscription status');
      throw new AppError(500, 'server_error', 'Failed to retrieve subscription status');
    }

    return reply.code(200).send({
      subscription_status: profile?.subscription_status ?? 'inactive',
      stripe_subscription_id: profile?.stripe_subscription_id ?? null,
      subscription_expires_at: profile?.subscription_expires_at ?? null,
    });
  });
}
