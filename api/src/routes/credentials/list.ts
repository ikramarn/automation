import type { FastifyInstance } from 'fastify';
import { createSupabaseAdminClient } from '../../lib/supabase.js';

/**
 * GET /credentials
 *
 * Returns the list of stored credential types for the authenticated user,
 * with masked values and status. Raw API keys are NEVER returned.
 *
 * Response shape per item:
 *   { credential_type, masked_value, status, updated_at }
 *
 * Requirements: 3.1, 3.4, 18.4
 */
export async function listCredentialsRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    {
      schema: {
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                credential_type: { type: 'string' },
                masked_value: { type: 'string' },
                status: { type: 'string' },
                updated_at: { type: 'string' },
              },
              required: ['credential_type', 'masked_value', 'status', 'updated_at'],
            },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.user.id;
      const supabase = createSupabaseAdminClient();

      const { data, error } = await supabase
        .from('credentials')
        .select('credential_type, masked_value, status, updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      if (error) {
        request.log.error({ userId, err: error.message }, 'Failed to list credentials');
        throw new Error('Failed to retrieve credentials');
      }

      return reply.status(200).send(data ?? []);
    },
  );
}
