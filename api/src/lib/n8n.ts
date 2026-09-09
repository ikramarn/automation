/**
 * n8n REST API client.
 *
 * Creates and triggers n8n workflow instances for pipeline automation.
 * Uses N8N_API_URL and N8N_API_KEY environment variables.
 *
 * When N8N_API_URL is not set, returns placeholder values for
 * graceful degradation in development/test environments.
 */

/** Minimum n8n workflow structure for pipeline execution. */
interface N8nWorkflowPayload {
  name: string;
  nodes: unknown[];
  connections: Record<string, unknown>;
  settings: {
    executionOrder: string;
  };
}

/** Response from n8n POST /workflows */
interface N8nWorkflowResponse {
  id: string;
  [key: string]: unknown;
}

/** Response from n8n POST /api/v1/workflows/{id}/execute */
interface N8nExecuteResponse {
  data?: {
    executionId?: string | number;
    id?: string | number;
    [key: string]: unknown;
  };
  executionId?: string | number;
  id?: string | number;
  [key: string]: unknown;
}

/** Response from n8n GET /api/v1/executions/{id} */
interface N8nExecutionResponse {
  id: string | number;
  status: string;
  data?: unknown;
  [key: string]: unknown;
}

/**
 * Creates a workflow in n8n via the REST API.
 *
 * @param pipelineId - The pipeline UUID to associate with the workflow
 * @param cronExpression - UTC cron expression for scheduling (e.g. "0 14 * * *")
 * @returns The n8n workflow ID string
 *
 * @throws Error if the n8n API call fails (only when N8N_API_URL is set)
 */
export async function createN8nWorkflow(
  pipelineId: string,
  cronExpression: string,
): Promise<string> {
  const n8nApiUrl = process.env['N8N_API_URL'];
  const n8nApiKey = process.env['N8N_API_KEY'];

  // Graceful degradation: return placeholder when n8n is not configured
  if (!n8nApiUrl) {
    return `n8n-placeholder-${pipelineId}`;
  }

  const internalApiUrl = process.env['API_URL'] ?? process.env['APP_URL'] ?? '';
  const serviceToken = process.env['N8N_SERVICE_TOKEN'] ?? '';

  const workflowPayload: N8nWorkflowPayload = {
    name: `pipeline-${pipelineId}`,
    nodes: [
      {
        id: 'schedule-trigger',
        name: 'Schedule Trigger',
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2,
        position: [0, 0],
        parameters: {
          rule: {
            interval: [
              {
                field: 'cronExpression',
                expression: cronExpression,
              },
            ],
          },
        },
      },
      {
        id: 'trigger-pipeline',
        name: 'Trigger Pipeline',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [240, 0],
        parameters: {
          method: 'POST',
          url: `${internalApiUrl}/internal/trigger-pipeline`,
          sendHeaders: true,
          headerParameters: {
            parameters: [
              { name: 'Content-Type', value: 'application/json' },
              { name: 'Authorization', value: `Bearer ${serviceToken}` },
            ],
          },
          sendBody: true,
          contentType: 'json',
          body: {
            pipeline_id: pipelineId,
          },
          options: {
            response: {
              response: {
                neverError: true,
              },
            },
          },
        },
        continueOnFail: true,
      },
    ],
    connections: {
      'Schedule Trigger': {
        main: [[{ node: 'Trigger Pipeline', type: 'main', index: 0 }]],
      },
    },
    settings: {
      executionOrder: 'v1',
    },
  };

  const response = await fetch(`${n8nApiUrl}/workflows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': n8nApiKey ?? '',
    },
    body: JSON.stringify(workflowPayload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(
      `n8n workflow creation failed: HTTP ${response.status} - ${errorText}`,
    );
  }

  const data = (await response.json()) as N8nWorkflowResponse;

  if (!data.id) {
    throw new Error('n8n workflow creation response missing workflow ID');
  }

  // Activate the workflow immediately so the schedule trigger fires
  const activateResponse = await fetch(`${n8nApiUrl}/workflows/${data.id}/activate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': n8nApiKey ?? '',
    },
  });

  if (!activateResponse.ok) {
    // Log but don't fail — workflow was created, just not activated
    const errText = await activateResponse.text().catch(() => 'unknown');
    console.warn(`[n8n] Warning: workflow ${data.id} created but activation failed: ${errText}`);
  }

  return data.id;
}

/**
 * Triggers an execution of the video-automation-pipeline workflow in n8n.
 *
 * n8n 1.x does not expose a REST /execute endpoint. Instead, workflows are
 * triggered via their Webhook node URL. The "My workflow" automation engine
 * listens on POST /webhook/trigger-pipeline and expects:
 *   { credentials: {...}, pipelineConfig: {...} }
 *
 * The workflowId parameter is kept for API compatibility but is not used in
 * the HTTP call — all pipelines funnel through the single automation engine
 * workflow (tqs6G4wSCDWFkiwd) via the shared webhook path.
 *
 * Credentials are passed in the request body and are processed in-memory by
 * n8n only — they are never written to n8n's persistent database or logs.
 *
 * @param workflowId - The n8n workflow ID (unused in call, kept for compat)
 * @param credentials - Map of credential name → value (heygen_api_key, etc.)
 * @param pipelineConfig - Pipeline configuration including pipeline_id, user_id, etc.
 * @returns Object containing the n8n execution ID
 *
 * @throws Error if the n8n webhook call fails (only when N8N_API_URL is set)
 */
export async function triggerN8nWorkflow(
  workflowId: string,
  credentials: Record<string, string>,
  pipelineConfig: Record<string, unknown>,
): Promise<{ executionId: string }> {
  const n8nApiUrl = process.env['N8N_API_URL'];

  // Graceful degradation: return placeholder when n8n is not configured
  if (!n8nApiUrl) {
    return { executionId: `n8n-exec-placeholder-${String(pipelineConfig['pipeline_id'] ?? 'unknown')}` };
  }

  // Derive the webhook base URL from N8N_API_URL.
  // N8N_API_URL = http://n8n:5678/api/v1  → webhook base = http://n8n:5678
  const webhookBase = n8nApiUrl.replace(/\/api\/v1\/?$/, '');

  // POST to the webhook node of the "My workflow" automation engine.
  // The webhook path "trigger-pipeline" is fixed in the n8n workflow definition.
  // Credentials and pipeline config are passed in the body — never stored by n8n.
  const webhookPayload = {
    credentials,
    pipelineConfig: {
      ...pipelineConfig,
      // Pass internal API URL so n8n can call back for execution log updates
      internal_api_url: process.env['API_URL'] ?? '',
    },
  };

  const response = await fetch(
    `${webhookBase}/webhook/trigger-pipeline`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookPayload),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(
      `n8n workflow execution trigger failed: HTTP ${response.status} - ${errorText}`,
    );
  }

  const data = (await response.json()) as N8nExecuteResponse;

  // n8n webhook response returns executionId at various paths depending on version
  const rawId =
    data?.data?.executionId ??
    data?.data?.id ??
    data?.executionId ??
    data?.id;

  // If no executionId returned (n8n responded but didn't include one), use a
  // timestamp-based fallback so the execution log can still be created.
  const executionId = rawId !== undefined && rawId !== null
    ? String(rawId)
    : `webhook-triggered-${Date.now()}`;

  return { executionId };
}

/**
 * Retrieves the status of an n8n workflow execution.
 *
 * @param executionId - The n8n execution ID returned by triggerN8nWorkflow
 * @returns Object with status string and optional raw data from n8n
 *
 * @throws Error if the n8n API call fails (only when N8N_API_URL is set)
 */
export async function getN8nExecutionStatus(
  executionId: string,
): Promise<{ status: string; data?: unknown }> {
  const n8nApiUrl = process.env['N8N_API_URL'];
  const n8nApiKey = process.env['N8N_API_KEY'];

  // Graceful degradation: return placeholder when n8n is not configured
  if (!n8nApiUrl) {
    return { status: 'unknown', data: undefined };
  }

  const response = await fetch(
    `${n8nApiUrl}/executions/${encodeURIComponent(executionId)}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-N8N-API-KEY': n8nApiKey ?? '',
      },
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(
      `n8n execution status check failed: HTTP ${response.status} - ${errorText}`,
    );
  }

  const data = (await response.json()) as N8nExecutionResponse;

  if (!data.status) {
    throw new Error('n8n execution status response missing status field');
  }

  return { status: data.status, data };
}
