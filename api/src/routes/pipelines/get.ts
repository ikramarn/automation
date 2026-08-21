import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';

/**
 * GET /pipelines/:id — Retrieve full pipeline detail.
 *
 * Verifies ownership: returns 404 if the pipeline does not exist
 * or belongs to a different user.
 *
 * Requirements: 6.4
 */
export async function getPipelineRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.user.id;
      const { id } = request.params;
      const supabase = createSupabaseAdminClient();

      const { data, error } = await supabase
        .from('pipelines')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        request.log.error({ userId, pipelineId: id, err: error.message }, 'Failed to get pipeline');
        throw AppError.internal('Failed to retrieve pipeline');
      }

      if (!data) {
        throw AppError.notFound('Pipeline');
      }

      return reply.status(200).send(data);
    },
  );
}
