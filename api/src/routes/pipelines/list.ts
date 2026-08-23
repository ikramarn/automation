import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';

/**
 * GET /pipelines — List all pipelines for the authenticated user.
 *
 * Returns a summary view of each pipeline: id, name, status,
 * last_execution_at, last_execution_status, created_at.
 *
 * Requirements: 6.4, 13.1, 13.2
 */
export async function listPipelinesRoute(app: FastifyInstance): Promise<void> {
  app.get('/', async (request, reply) => {
    const userId = request.user.id;
    const supabase = createSupabaseAdminClient();

    const { data, error } = await supabase
      .from('pipelines')
      .select(
        'id, name, status, last_execution_at, last_execution_status, created_at',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      // If table doesn't exist yet (migrations not run), return empty array
      // gracefully instead of crashing with a 500
      if (
        error.message?.includes('relation') ||
        error.message?.includes('does not exist') ||
        error.code === '42P01'
      ) {
        return reply.status(200).send([]);
      }
      request.log.error({ userId, err: error.message }, 'Failed to list pipelines');
      throw AppError.internal('Failed to retrieve pipelines');
    }

    return reply.status(200).send(data ?? []);
  });
}
