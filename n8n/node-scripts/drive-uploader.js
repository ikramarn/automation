/**
 * drive-uploader.js
 * Standalone logic for the Drive_Uploader n8n node.
 * Exported functions can be unit-tested independently of n8n.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 4.3, 4.5, 4.6
 */

// ---------------------------------------------------------------------------
// File name builder (Req 10.2)
// ---------------------------------------------------------------------------

/**
 * Sanitize a pipeline name for use as a filename component.
 * Replaces characters that are invalid in filenames with underscores.
 * Collapses consecutive underscores and trims leading/trailing underscores.
 *
 * @param {string} name
 * @returns {string}
 */
function sanitizePipelineName(name) {
  if (!name || typeof name !== 'string') return 'Pipeline';
  // Replace characters invalid in filenames: / \ : * ? " < > | and control chars
  let sanitized = name.replace(/[/\\:*?"<>|]/g, '_');
  // Also replace characters awkward in filenames: newlines, tabs, etc.
  sanitized = sanitized.replace(/[\r\n\t]/g, '_');
  // Collapse multiple consecutive underscores into one
  sanitized = sanitized.replace(/_+/g, '_');
  // Trim leading/trailing underscores and whitespace
  sanitized = sanitized.replace(/^[_\s]+|[_\s]+$/g, '');
  return sanitized || 'Pipeline';
}

/**
 * Build the Google Drive filename for an uploaded video.
 * Format: [PipelineName]_[YYYY-MM-DD]_[HH-MM].mp4  (Req 10.2)
 *
 * The pipeline name is sanitized to remove characters invalid in filenames.
 * The timestamp is derived from the provided executionTimestamp (ISO string or Date).
 *
 * @param {string} pipelineName          - Pipeline name (will be sanitized)
 * @param {string|Date} executionTimestamp - Execution start time (ISO 8601 or Date)
 * @returns {string}  e.g. "My_Pipeline_2024-07-15_09-30.mp4"
 */
function buildDriveFileName(pipelineName, executionTimestamp) {
  const safe = sanitizePipelineName(pipelineName);

  let date;
  if (executionTimestamp instanceof Date) {
    date = executionTimestamp;
  } else if (typeof executionTimestamp === 'string' && executionTimestamp) {
    date = new Date(executionTimestamp);
  } else {
    date = new Date();
  }

  // Fall back to current time if the timestamp is invalid
  if (isNaN(date.getTime())) {
    date = new Date();
  }

  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');

  return `${safe}_${yyyy}-${mm}-${dd}_${hh}-${min}.mp4`;
}

// ---------------------------------------------------------------------------
// Folder error detection (Req 10.7)
// ---------------------------------------------------------------------------

/**
 * Returns true if the error indicates the Drive destination folder was not
 * found or is inaccessible (HTTP 404 or 403, or common Google Drive error codes).
 *
 * Covers:
 *   - HTTP 404 / "not found" → folder does not exist
 *   - HTTP 403 / "forbidden" / "permission" → folder inaccessible
 *   - Google Drive API error codes: 404, 403
 *
 * @param {Error|object|null} error
 * @returns {boolean}
 */
function isDriveFolderError(error) {
  if (!error) return false;

  // Check numeric HTTP status code (e.g., err.status, err.statusCode, err.code)
  const numericStatus =
    error.status ||
    error.statusCode ||
    (typeof error.code === 'number' ? error.code : null);

  if (numericStatus === 404 || numericStatus === 403) return true;

  // Check Google Drive API error structure: { errors: [{ domain, reason, message }] }
  if (error.errors && Array.isArray(error.errors)) {
    for (const e of error.errors) {
      const reason = (e.reason || '').toLowerCase();
      const domain = (e.domain || '').toLowerCase();
      if (
        reason === 'notfound' ||
        reason === 'forbidden' ||
        reason === 'insufficientpermissions' ||
        domain === 'youtube.quota' ||
        e.code === 404 ||
        e.code === 403
      ) {
        return true;
      }
    }
  }

  // Check string-based message for common patterns
  const msg = (
    (error.message || '') +
    ' ' +
    (error.reason || '') +
    ' ' +
    (typeof error.code === 'string' ? error.code : '')
  ).toLowerCase();

  if (
    msg.includes('not found') ||
    msg.includes('notfound') ||
    msg.includes('404') ||
    msg.includes('forbidden') ||
    msg.includes('403') ||
    msg.includes('permission denied') ||
    msg.includes('insufficient permission') ||
    msg.includes('folder not found') ||
    msg.includes('does not exist')
  ) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Google OAuth token exchange (Req 4.3, 4.5)
// ---------------------------------------------------------------------------

/**
 * Exchange a Google OAuth refresh token for a new access token.
 *
 * Uses the Google OAuth 2.0 token endpoint.
 * Throws if the exchange fails (non-retryable — caller should record failure
 * and abort the upload step per Req 4.3).
 *
 * @param {string} refreshToken          - The stored Google OAuth refresh token
 * @param {Function} httpPost            - async (url: string, headers: object, body: string|URLSearchParams) => any
 *                                         Injectable for testing; matches n8n $http.request pattern
 * @returns {Promise<{ accessToken: string }>}
 * @throws {Error} with descriptive message on failure
 */
async function exchangeGoogleRefreshToken(refreshToken, httpPost) {
  if (!refreshToken) {
    throw new Error('Google Drive authorization expired');
  }

  const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

  // Google requires form-encoded body for token exchange
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: '', // populated by environment in n8n (GOOGLE_CLIENT_ID)
    client_secret: '', // populated by environment in n8n (GOOGLE_CLIENT_SECRET)
  });

  let response;
  try {
    response = await httpPost(
      GOOGLE_TOKEN_URL,
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      params.toString()
    );
  } catch (err) {
    // Any HTTP-level failure is treated as a non-retryable auth failure (Req 4.5)
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Google Drive authorization expired: ${msg}`);
  }

  const data = typeof response === 'string' ? JSON.parse(response) : response;

  // Google returns { error, error_description } on failure
  if (data && data.error) {
    throw new Error(
      `Google Drive authorization expired: ${data.error_description || data.error}`
    );
  }

  const accessToken = data && (data.access_token || data.accessToken);
  if (!accessToken) {
    throw new Error('Google Drive authorization expired: no access token in response');
  }

  return { accessToken };
}

// ---------------------------------------------------------------------------
// R2 → Drive upload logic (Req 10.1, 10.3, 10.4, 10.5, 10.6, 10.7)
// ---------------------------------------------------------------------------

/**
 * Sleep for ms milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Download a video from R2 and upload it to Google Drive.
 *
 * On folder error (404/403): records "destination folder not found or inaccessible",
 *   does NOT retry, resolves without throwing (non-blocking, Req 10.7).
 * On other upload failure: retries once after 30s (Req 10.4).
 * On retry failure: resolves with failure info (non-blocking, Req 10.5).
 *
 * @param {object} params
 * @param {string} params.accessToken       - Google Drive access token
 * @param {string} params.folderId          - Google Drive destination folder ID
 * @param {string} params.fileName          - Target filename (e.g. "Pipeline_2024-07-15_09-30.mp4")
 * @param {string} params.r2ObjectKey       - R2 object key of the video
 * @param {object} params.r2Config          - R2 config: { accessKeyId, secretAccessKey, endpoint, bucketName }
 * @param {Function} r2Get                  - async (r2Config, objectKey) => { data: Buffer, size: number }
 * @param {Function} driveUpload            - async (accessToken, folderId, fileName, data) => { fileId, webViewLink }
 * @returns {Promise<{
 *   drive_upload_status: 'success' | 'failed',
 *   gdrive_file_id: string | null,
 *   gdrive_link: string | null,
 *   drive_upload_error: string | null
 * }>}
 */
async function uploadToDrive(params, r2Get, driveUpload) {
  const { accessToken, folderId, fileName, r2ObjectKey, r2Config } = params;

  /**
   * Single attempt: download from R2 and upload to Drive.
   * Returns result on success, or throws on any failure.
   */
  async function attempt() {
    const { data } = await r2Get(r2Config, r2ObjectKey);
    const { fileId, webViewLink } = await driveUpload(accessToken, folderId, fileName, data);
    return { fileId, webViewLink };
  }

  // First attempt
  try {
    const { fileId, webViewLink } = await attempt();
    return {
      drive_upload_status: 'success',
      gdrive_file_id: fileId,
      gdrive_link: webViewLink,
      drive_upload_error: null,
    };
  } catch (firstErr) {
    // Req 10.7: Folder not found / inaccessible — abort without retry
    if (isDriveFolderError(firstErr)) {
      return {
        drive_upload_status: 'failed',
        gdrive_file_id: null,
        gdrive_link: null,
        drive_upload_error: 'destination folder not found or inaccessible',
      };
    }

    // Req 10.4: Retry once after 30 seconds for other errors
    await sleep(30_000);

    try {
      const { fileId, webViewLink } = await attempt();
      return {
        drive_upload_status: 'success',
        gdrive_file_id: fileId,
        gdrive_link: webViewLink,
        drive_upload_error: null,
      };
    } catch (retryErr) {
      // Req 10.5: Log and continue — drive failure is non-blocking
      const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);

      // Req 10.7: Also check folder error on retry
      if (isDriveFolderError(retryErr)) {
        return {
          drive_upload_status: 'failed',
          gdrive_file_id: null,
          gdrive_link: null,
          drive_upload_error: 'destination folder not found or inaccessible',
        };
      }

      return {
        drive_upload_status: 'failed',
        gdrive_file_id: null,
        gdrive_link: null,
        drive_upload_error: msg,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Main entry point — called from n8n Drive_Uploader node
// ---------------------------------------------------------------------------

/**
 * Run the full Drive upload pipeline.
 *
 * 1. Exchange refresh token for access token (abort upload step on failure).
 * 2. Build the Drive filename from pipeline name + execution timestamp.
 * 3. Download video from R2 and upload to Drive.
 * 4. Return result (never throws — drive failure is non-blocking).
 *
 * @param {object} ctx - n8n execution context
 * @param {Function} httpPost  - async (url, headers, body) => response (for token exchange)
 * @param {Function} r2Get     - async (r2Config, objectKey) => { data, size }
 * @param {Function} driveUpload - async (accessToken, folderId, fileName, data) => { fileId, webViewLink }
 * @returns {Promise<{
 *   drive_upload_status: string,
 *   gdrive_file_id: string|null,
 *   gdrive_link: string|null,
 *   drive_upload_error: string|null
 * }>}
 */
async function runDriveUploader(ctx, httpPost, r2Get, driveUpload) {
  const refreshToken = ctx.credentials && ctx.credentials.google_drive_refresh_token;
  const folderId = ctx.gdrive_folder_id || null;
  const pipelineName = ctx.pipeline_name || '';
  const executionTimestamp = ctx.started_at || new Date().toISOString();
  const r2ObjectKey = ctx.r2_object_key || '';

  const r2Config = {
    accessKeyId: (ctx.credentials && ctx.credentials.r2_access_key_id) || '',
    secretAccessKey: (ctx.credentials && ctx.credentials.r2_secret_access_key) || '',
    endpoint: (ctx.credentials && ctx.credentials.r2_endpoint) || '',
    bucketName: (ctx.credentials && ctx.credentials.r2_bucket_name) || '',
  };

  // Req 4.3: Exchange refresh token — abort upload (but NOT pipeline) on failure
  let accessToken;
  try {
    const result = await exchangeGoogleRefreshToken(refreshToken, httpPost);
    accessToken = result.accessToken;
  } catch (tokenErr) {
    const msg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
    return {
      drive_upload_status: 'failed',
      gdrive_file_id: null,
      gdrive_link: null,
      drive_upload_error: msg,
    };
  }

  // If no folder configured, skip upload
  if (!folderId) {
    return {
      drive_upload_status: 'skipped',
      gdrive_file_id: null,
      gdrive_link: null,
      drive_upload_error: 'no Google Drive folder configured',
    };
  }

  // Build filename (Req 10.2)
  const fileName = buildDriveFileName(pipelineName, executionTimestamp);

  // Req 10.1, 10.4, 10.5, 10.7: Attempt upload with retry
  return uploadToDrive(
    { accessToken, folderId, fileName, r2ObjectKey, r2Config },
    r2Get,
    driveUpload
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  buildDriveFileName,
  sanitizePipelineName,
  isDriveFolderError,
  exchangeGoogleRefreshToken,
  uploadToDrive,
  runDriveUploader,
  sleep,
};
