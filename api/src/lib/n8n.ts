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
    ],
    connections: {},
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

  return data.id;
}

/**
 * Triggers an execution of the video-automation-pipeline workflow in n8n.
 *
 * Credentials are passed as execution data in the request body and are
 * processed in-memory by n8n only — they are never written to n8n's
 * persistent database or logs.
 *
 * @param workflowId - The n8n workflow ID to execute
 * @param credentials - Map of credential name → value (heygen_api_key, etc.)
 * @param pipelineConfig - Pipeline configuration including pipeline_id, user_id, execution_id, etc.
 * @returns Object containing the n8n execution ID
 *
 * @throws Error if the n8n API call fails (only when N8N_API_URL is set)
 */
export async function triggerN8nWorkflow(
  workflowId: string,
  credentials: Record<string, string>,
  pipelineConfig: Record<string, unknown>,
): Promise<{ executionId: string }> {
  const n8nApiUrl = process.env['N8N_API_URL'];
  const n8nApiKey = process.env['N8N_API_KEY'];

  // Graceful degradation: return placeholder when n8n is not configured
  if (!n8nApiUrl) {
    return { executionId: `n8n-exec-placeholder-${String(pipelineConfig['pipeline_id'] ?? 'unknown')}` };
  }

  // Credentials are passed as execution data — never stored in n8n credential DB
  const executionData = {
    workflowData: {
      // Execution input data is passed via the webhook trigger body in the workflow.
      // The /execute endpoint injects this as the workflow's input payload.
    },
    runData: {},
    startNodes: [],
    destinationNode: '',
    // Pass credentials + pipeline config as the workflow's input data.
    // The Webhook/Trigger node in the workflow reads body.credentials and body.pipelineConfig.
    inputData: {
      body: {
        credentials,
        pipelineConfig,
      },
    },
  };

  const response = await fetch(
    `${n8nApiUrl}/api/v1/workflows/${encodeURIComponent(workflowId)}/execute`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-N8N-API-KEY': n8nApiKey ?? '',
      },
      body: JSON.stringify(executionData),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(
      `n8n workflow execution trigger failed: HTTP ${response.status} - ${errorText}`,
    );
  }

  const data = (await response.json()) as N8nExecuteResponse;

  // n8n returns executionId at various paths depending on version
  const rawId =
    data?.data?.executionId ??
    data?.data?.id ??
    data?.executionId ??
    data?.id;

  if (rawId === undefined || rawId === null) {
    throw new Error('n8n workflow execution response missing executionId');
  }

  return { executionId: String(rawId) };
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
    `${n8nApiUrl}/api/v1/executions/${encodeURIComponent(executionId)}`,
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
