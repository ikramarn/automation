/**
 * drive-uploader.test.js
 * Vitest unit tests for the Drive_Uploader node logic.
 *
 * Requirements validated: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 4.3, 4.5, 4.6
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildDriveFileName,
  sanitizePipelineName,
  isDriveFolderError,
  exchangeGoogleRefreshToken,
  uploadToDrive,
} from './drive-uploader.js';

// ---------------------------------------------------------------------------
// buildDriveFileName — Req 10.2
// ---------------------------------------------------------------------------

describe('buildDriveFileName', () => {
  it('produces the correct format: [name]_[YYYY-MM-DD]_[HH-MM].mp4', () => {
    const result = buildDriveFileName('MyPipeline', '2024-07-15T09:30:00.000Z');
    expect(result).toBe('MyPipeline_2024-07-15_09-30.mp4');
  });

  it('zero-pads month, day, hour and minute', () => {
    // 2024-01-05T03:07:00Z
    const result = buildDriveFileName('News', '2024-01-05T03:07:00.000Z');
    expect(result).toBe('News_2024-01-05_03-07.mp4');
  });

  it('always ends with .mp4', () => {
    const result = buildDriveFileName('Test', '2024-06-01T12:00:00.000Z');
    expect(result.endsWith('.mp4')).toBe(true);
  });

  it('uses UTC time for the date/time portion', () => {
    // 2024-12-31T23:45:00Z (UTC — should show 23-45, not a local-adjusted value)
    const result = buildDriveFileName('Pipe', '2024-12-31T23:45:00.000Z');
    expect(result).toBe('Pipe_2024-12-31_23-45.mp4');
  });

  it('accepts a Date object as the timestamp', () => {
    const date = new Date('2024-03-20T14:05:00.000Z');
    const result = buildDriveFileName('Weekly', date);
    expect(result).toBe('Weekly_2024-03-20_14-05.mp4');
  });

  it('handles pipeline names with spaces', () => {
    const result = buildDriveFileName('My Cool Pipeline', '2024-06-01T10:00:00.000Z');
    expect(result).toBe('My Cool Pipeline_2024-06-01_10-00.mp4');
  });

  it('handles pipeline names with hyphens and numbers', () => {
    const result = buildDriveFileName('Tech-News-2024', '2024-08-10T08:15:00.000Z');
    expect(result).toBe('Tech-News-2024_2024-08-10_08-15.mp4');
  });

  it('sanitizes forward slash in pipeline name', () => {
    const result = buildDriveFileName('News/Daily', '2024-06-01T00:00:00.000Z');
    expect(result).not.toContain('/News/Daily');
    expect(result).toContain('_2024-06-01_00-00.mp4');
  });

  it('sanitizes backslash in pipeline name', () => {
    const result = buildDriveFileName('News\\Daily', '2024-06-01T00:00:00.000Z');
    expect(result).not.toContain('\\');
    expect(result.endsWith('.mp4')).toBe(true);
  });

  it('sanitizes colon in pipeline name', () => {
    const result = buildDriveFileName('Breaking: News', '2024-06-01T00:00:00.000Z');
    expect(result).not.toContain(':');
    expect(result).toContain('_2024-06-01_00-00.mp4');
  });

  it('sanitizes asterisk, question mark, and quotes', () => {
    const result = buildDriveFileName('My*Pipe?line"2024', '2024-06-01T00:00:00.000Z');
    expect(result).not.toMatch(/[*?"]/);
    expect(result.endsWith('.mp4')).toBe(true);
  });

  it('sanitizes angle brackets and pipe character', () => {
    const result = buildDriveFileName('<News>|Pipe', '2024-06-01T00:00:00.000Z');
    expect(result).not.toMatch(/[<>|]/);
    expect(result.endsWith('.mp4')).toBe(true);
  });

  it('collapses multiple consecutive underscores from sanitization', () => {
    // "A//B" → "A__B" → "A_B" after collapse
    const result = buildDriveFileName('A//B', '2024-06-01T00:00:00.000Z');
    expect(result).not.toContain('__');
  });

  it('falls back to "Pipeline" when name is empty string', () => {
    const result = buildDriveFileName('', '2024-06-01T00:00:00.000Z');
    expect(result).toBe('Pipeline_2024-06-01_00-00.mp4');
  });

  it('falls back to "Pipeline" when name is null', () => {
    const result = buildDriveFileName(null, '2024-06-01T00:00:00.000Z');
    expect(result).toBe('Pipeline_2024-06-01_00-00.mp4');
  });

  it('handles an invalid timestamp gracefully (uses current time)', () => {
    // Just verify it returns a valid .mp4 filename without throwing
    const result = buildDriveFileName('Test', 'not-a-date');
    expect(typeof result).toBe('string');
    expect(result.endsWith('.mp4')).toBe(true);
    expect(result.startsWith('Test_')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sanitizePipelineName
// ---------------------------------------------------------------------------

describe('sanitizePipelineName', () => {
  it('returns the name unchanged when no special chars', () => {
    expect(sanitizePipelineName('TechNews')).toBe('TechNews');
  });

  it('replaces / with underscore', () => {
    expect(sanitizePipelineName('A/B')).toBe('A_B');
  });

  it('replaces : with underscore', () => {
    expect(sanitizePipelineName('A:B')).toBe('A_B');
  });

  it('replaces * with underscore', () => {
    expect(sanitizePipelineName('A*B')).toBe('A_B');
  });

  it('replaces ? with underscore', () => {
    expect(sanitizePipelineName('A?B')).toBe('A_B');
  });

  it('replaces " with underscore', () => {
    expect(sanitizePipelineName('A"B')).toBe('A_B');
  });

  it('replaces | with underscore', () => {
    expect(sanitizePipelineName('A|B')).toBe('A_B');
  });

  it('collapses consecutive underscores', () => {
    expect(sanitizePipelineName('A//B')).toBe('A_B');
  });

  it('trims leading/trailing whitespace', () => {
    expect(sanitizePipelineName('  News  ')).toBe('News');
  });

  it('returns "Pipeline" for empty string', () => {
    expect(sanitizePipelineName('')).toBe('Pipeline');
  });

  it('returns "Pipeline" for null', () => {
    expect(sanitizePipelineName(null)).toBe('Pipeline');
  });

  it('returns "Pipeline" for undefined', () => {
    expect(sanitizePipelineName(undefined)).toBe('Pipeline');
  });

  it('preserves hyphens and numbers', () => {
    expect(sanitizePipelineName('Tech-News-2024')).toBe('Tech-News-2024');
  });

  it('preserves spaces', () => {
    expect(sanitizePipelineName('My Cool Pipeline')).toBe('My Cool Pipeline');
  });
});

// ---------------------------------------------------------------------------
// isDriveFolderError — Req 10.7
// ---------------------------------------------------------------------------

describe('isDriveFolderError', () => {
  it('returns false for null', () => {
    expect(isDriveFolderError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isDriveFolderError(undefined)).toBe(false);
  });

  it('returns true for error with status 404', () => {
    expect(isDriveFolderError({ status: 404 })).toBe(true);
  });

  it('returns true for error with status 403', () => {
    expect(isDriveFolderError({ status: 403 })).toBe(true);
  });

  it('returns true for error with statusCode 404', () => {
    expect(isDriveFolderError({ statusCode: 404 })).toBe(true);
  });

  it('returns true for error with statusCode 403', () => {
    expect(isDriveFolderError({ statusCode: 403 })).toBe(true);
  });

  it('returns true for error with numeric code 404', () => {
    expect(isDriveFolderError({ code: 404 })).toBe(true);
  });

  it('returns true for error with numeric code 403', () => {
    expect(isDriveFolderError({ code: 403 })).toBe(true);
  });

  it('returns false for error with status 500', () => {
    expect(isDriveFolderError({ status: 500 })).toBe(false);
  });

  it('returns false for error with status 429', () => {
    expect(isDriveFolderError({ status: 429 })).toBe(false);
  });

  it('returns true for "not found" in message', () => {
    expect(isDriveFolderError(new Error('Folder not found'))).toBe(true);
  });

  it('returns true for "404" in message', () => {
    expect(isDriveFolderError(new Error('HTTP 404: resource missing'))).toBe(true);
  });

  it('returns true for "forbidden" in message', () => {
    expect(isDriveFolderError(new Error('Access forbidden to folder'))).toBe(true);
  });

  it('returns true for "403" in message', () => {
    expect(isDriveFolderError(new Error('HTTP 403: insufficient permissions'))).toBe(true);
  });

  it('returns true for "permission denied" in message', () => {
    expect(isDriveFolderError(new Error('Permission denied to write folder'))).toBe(true);
  });

  it('returns true for "does not exist" in message', () => {
    expect(isDriveFolderError(new Error('The folder does not exist'))).toBe(true);
  });

  it('returns false for generic network errors', () => {
    expect(isDriveFolderError(new Error('ECONNRESET'))).toBe(false);
    expect(isDriveFolderError(new Error('Network timeout'))).toBe(false);
    expect(isDriveFolderError(new Error('Quota exceeded'))).toBe(false);
  });

  it('returns true for Google Drive API errors array with 404 code', () => {
    const error = { errors: [{ code: 404, reason: 'notFound', message: 'File not found' }] };
    expect(isDriveFolderError(error)).toBe(true);
  });

  it('returns true for Google Drive API errors array with 403 code', () => {
    const error = { errors: [{ code: 403, reason: 'forbidden', message: 'Forbidden' }] };
    expect(isDriveFolderError(error)).toBe(true);
  });

  it('returns true for Google Drive API errors with notFound reason', () => {
    const error = { errors: [{ reason: 'notFound', message: 'File not found.' }] };
    expect(isDriveFolderError(error)).toBe(true);
  });

  it('returns true for Google Drive API errors with insufficientPermissions reason', () => {
    const error = { errors: [{ reason: 'insufficientPermissions', message: 'Insufficient Permission' }] };
    expect(isDriveFolderError(error)).toBe(true);
  });

  it('is case-insensitive for message matching', () => {
    expect(isDriveFolderError(new Error('FOLDER NOT FOUND'))).toBe(true);
    expect(isDriveFolderError(new Error('FORBIDDEN'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// exchangeGoogleRefreshToken — Req 4.3, 4.5
// ---------------------------------------------------------------------------

describe('exchangeGoogleRefreshToken', () => {
  it('returns access token on successful exchange', async () => {
    const httpPost = async () => ({
      access_token: 'ya29.abc123',
      token_type: 'Bearer',
      expires_in: 3600,
    });

    const result = await exchangeGoogleRefreshToken('refresh-token-abc', httpPost);
    expect(result).toEqual({ accessToken: 'ya29.abc123' });
  });

  it('throws on missing refresh token', async () => {
    const httpPost = vi.fn();
    await expect(exchangeGoogleRefreshToken('', httpPost)).rejects.toThrow(
      'Google Drive authorization expired'
    );
    // Should not call httpPost if no token
    expect(httpPost).not.toHaveBeenCalled();
  });

  it('throws on null refresh token', async () => {
    const httpPost = vi.fn();
    await expect(exchangeGoogleRefreshToken(null, httpPost)).rejects.toThrow(
      'Google Drive authorization expired'
    );
    expect(httpPost).not.toHaveBeenCalled();
  });

  it('throws when Google returns error in response body', async () => {
    const httpPost = async () => ({
      error: 'invalid_grant',
      error_description: 'Token has been expired or revoked.',
    });

    await expect(
      exchangeGoogleRefreshToken('expired-token', httpPost)
    ).rejects.toThrow('Google Drive authorization expired');
  });

  it('includes the OAuth error description in the thrown error', async () => {
    const httpPost = async () => ({
      error: 'invalid_grant',
      error_description: 'Token has been expired or revoked.',
    });

    await expect(
      exchangeGoogleRefreshToken('expired-token', httpPost)
    ).rejects.toThrow('Token has been expired or revoked.');
  });

  it('throws when Google returns error without description', async () => {
    const httpPost = async () => ({
      error: 'unauthorized_client',
    });

    await expect(
      exchangeGoogleRefreshToken('some-token', httpPost)
    ).rejects.toThrow('Google Drive authorization expired');
  });

  it('throws when httpPost itself throws (network error)', async () => {
    const httpPost = async () => {
      throw new Error('ECONNREFUSED');
    };

    await expect(
      exchangeGoogleRefreshToken('some-token', httpPost)
    ).rejects.toThrow('Google Drive authorization expired');
  });

  it('throws when response contains no access_token field', async () => {
    const httpPost = async () => ({
      token_type: 'Bearer',
      expires_in: 3600,
      // missing access_token
    });

    await expect(
      exchangeGoogleRefreshToken('some-token', httpPost)
    ).rejects.toThrow('Google Drive authorization expired');
  });

  it('handles JSON string response correctly', async () => {
    const httpPost = async () =>
      JSON.stringify({ access_token: 'ya29.fromstring', token_type: 'Bearer', expires_in: 3600 });

    const result = await exchangeGoogleRefreshToken('refresh-token', httpPost);
    expect(result.accessToken).toBe('ya29.fromstring');
  });

  it('calls httpPost with the Google token endpoint URL', async () => {
    const calls = [];
    const httpPost = async (url) => {
      calls.push(url);
      return { access_token: 'ya29.test' };
    };

    await exchangeGoogleRefreshToken('token', httpPost);
    expect(calls[0]).toBe('https://oauth2.googleapis.com/token');
  });

  it('calls httpPost with Content-Type application/x-www-form-urlencoded', async () => {
    const capturedHeaders = [];
    const httpPost = async (_url, headers) => {
      capturedHeaders.push(headers);
      return { access_token: 'ya29.test' };
    };

    await exchangeGoogleRefreshToken('token', httpPost);
    expect(capturedHeaders[0]['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('includes grant_type=refresh_token in the request body', async () => {
    const capturedBodies = [];
    const httpPost = async (_url, _headers, body) => {
      capturedBodies.push(body);
      return { access_token: 'ya29.test' };
    };

    await exchangeGoogleRefreshToken('my-refresh-token', httpPost);
    expect(capturedBodies[0]).toContain('grant_type=refresh_token');
  });

  it('includes the refresh token in the request body', async () => {
    const capturedBodies = [];
    const httpPost = async (_url, _headers, body) => {
      capturedBodies.push(body);
      return { access_token: 'ya29.test' };
    };

    await exchangeGoogleRefreshToken('my-secret-refresh-token', httpPost);
    expect(capturedBodies[0]).toContain('my-secret-refresh-token');
  });
});

// ---------------------------------------------------------------------------
// uploadToDrive (integration of retry/folder-error logic) — Req 10.4, 10.5, 10.7
// ---------------------------------------------------------------------------

describe('uploadToDrive', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeParams = (overrides = {}) => ({
    accessToken: 'ya29.abc',
    folderId: 'folder-id-123',
    fileName: 'MyPipeline_2024-07-15_09-30.mp4',
    r2ObjectKey: 'user-1/pipe-1/exec-1/video.mp4',
    r2Config: {
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      endpoint: 'https://r2.example.com',
      bucketName: 'video-staging',
    },
    ...overrides,
  });

  const makeR2Get = (data = Buffer.from('video')) =>
    async () => ({ data, size: data.length });

  const makeDriveUpload = (fileId = 'gfile-abc', webViewLink = 'https://drive.google.com/file/d/gfile-abc') =>
    async () => ({ fileId, webViewLink });

  it('returns success with gdrive_file_id and gdrive_link on successful upload (Req 10.3)', async () => {
    const promise = uploadToDrive(makeParams(), makeR2Get(), makeDriveUpload());
    const result = await promise;

    expect(result.drive_upload_status).toBe('success');
    expect(result.gdrive_file_id).toBe('gfile-abc');
    expect(result.gdrive_link).toBe('https://drive.google.com/file/d/gfile-abc');
    expect(result.drive_upload_error).toBeNull();
  });

  it('retries once after 30s on first upload failure (Req 10.4)', async () => {
    let callCount = 0;
    const driveUpload = async () => {
      callCount++;
      if (callCount === 1) throw new Error('Upload failed');
      return { fileId: 'gfile-retry', webViewLink: 'https://drive.google.com/retry' };
    };

    const promise = uploadToDrive(makeParams(), makeR2Get(), driveUpload);
    await vi.advanceTimersByTimeAsync(30_001);
    const result = await promise;

    expect(callCount).toBe(2);
    expect(result.drive_upload_status).toBe('success');
    expect(result.gdrive_file_id).toBe('gfile-retry');
  });

  it('returns failed status (non-blocking) when both upload attempts fail (Req 10.5)', async () => {
    const driveUpload = async () => { throw new Error('Quota exceeded'); };

    const promise = uploadToDrive(makeParams(), makeR2Get(), driveUpload);
    await vi.advanceTimersByTimeAsync(30_001);
    const result = await promise;

    expect(result.drive_upload_status).toBe('failed');
    expect(result.gdrive_file_id).toBeNull();
    expect(result.gdrive_link).toBeNull();
    expect(result.drive_upload_error).toBe('Quota exceeded');
  });

  it('records "destination folder not found or inaccessible" on 404 folder error without retry (Req 10.7)', async () => {
    const folderErr = new Error('File not found');
    folderErr.status = 404;

    let callCount = 0;
    const driveUpload = async () => {
      callCount++;
      throw folderErr;
    };

    // Should NOT wait 30s — resolves immediately
    const result = await uploadToDrive(makeParams(), makeR2Get(), driveUpload);

    expect(callCount).toBe(1); // no retry for folder errors
    expect(result.drive_upload_status).toBe('failed');
    expect(result.drive_upload_error).toBe('destination folder not found or inaccessible');
  });

  it('records "destination folder not found or inaccessible" on 403 folder error without retry (Req 10.7)', async () => {
    const folderErr = new Error('Forbidden');
    folderErr.status = 403;

    let callCount = 0;
    const driveUpload = async () => {
      callCount++;
      throw folderErr;
    };

    const result = await uploadToDrive(makeParams(), makeR2Get(), driveUpload);

    expect(callCount).toBe(1);
    expect(result.drive_upload_status).toBe('failed');
    expect(result.drive_upload_error).toBe('destination folder not found or inaccessible');
  });

  it('records "destination folder not found or inaccessible" on "not found" message (Req 10.7)', async () => {
    const driveUpload = async () => { throw new Error('Folder not found'); };

    const result = await uploadToDrive(makeParams(), makeR2Get(), driveUpload);
    expect(result.drive_upload_error).toBe('destination folder not found or inaccessible');
    expect(result.drive_upload_status).toBe('failed');
  });

  it('does not retry on folder error — resolves without advancing timers', async () => {
    vi.useRealTimers(); // use real timers to ensure no 30s delay
    const driveUpload = async () => {
      const err = new Error('not found');
      err.status = 404;
      throw err;
    };

    const start = Date.now();
    const result = await uploadToDrive(makeParams(), makeR2Get(), driveUpload);
    const elapsed = Date.now() - start;

    expect(result.drive_upload_status).toBe('failed');
    // Should complete much faster than 30s
    expect(elapsed).toBeLessThan(1000);
  });

  it('includes the correct file id and link on success', async () => {
    const result = await uploadToDrive(
      makeParams(),
      makeR2Get(),
      makeDriveUpload('drive-file-xyz', 'https://drive.google.com/file/d/drive-file-xyz')
    );

    expect(result.gdrive_file_id).toBe('drive-file-xyz');
    expect(result.gdrive_link).toBe('https://drive.google.com/file/d/drive-file-xyz');
  });
});
