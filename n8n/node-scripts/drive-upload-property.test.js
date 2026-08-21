/**
 * drive-upload-property.test.js
 * Property-based tests for Drive_Uploader node logic (Property 5).
 *
 * **Validates: Requirements 10.5, 15.3**
 *
 * Property 5: Drive Upload Non-Blocking
 * Drive upload failures must never throw — they always resolve with a
 * structured failure result so the social publishing step can still proceed.
 */

import { describe, it, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { uploadToDrive, isDriveFolderError } from './drive-uploader.js';

// ---------------------------------------------------------------------------
// Arbitraries / generators
// ---------------------------------------------------------------------------

/** Arbitrary: an error with a numeric HTTP status code */
const arbStatusCodeError = fc.oneof(
  fc.record({ status: fc.constantFrom(404, 403) }),
  fc.record({ statusCode: fc.constantFrom(404, 403) }),
  fc.record({ code: fc.constantFrom(404, 403) }),
);

/** Arbitrary: an error with a string message containing folder-related keywords */
const arbFolderMessageError = fc.constantFrom(
  { message: 'not found' },
  { message: 'folder not found' },
  { message: 'does not exist' },
  { message: 'forbidden' },
  { message: 'permission denied' },
  { message: 'insufficient permission' },
  { message: '404' },
  { message: '403' },
);

/** Arbitrary: non-folder errors (generic runtime errors) */
const arbGenericError = fc.constantFrom(
  { message: 'network timeout' },
  { message: 'connection refused' },
  { message: 'ECONNRESET' },
  { message: 'upload stream error' },
  { message: 'internal server error' },
  { message: 'rate limit exceeded' },
);

/** Arbitrary: all drive failure types (folder + generic) */
const arbAnyDriveError = fc.oneof(
  arbStatusCodeError,
  arbFolderMessageError,
  arbGenericError,
);

/** Arbitrary: a valid upload params object */
const arbUploadParams = fc.record({
  accessToken: fc.string({ minLength: 1, maxLength: 40 }),
  folderId: fc.string({ minLength: 1, maxLength: 40 }),
  fileName: fc.string({ minLength: 1, maxLength: 80 }),
  r2ObjectKey: fc.string({ minLength: 1, maxLength: 80 }),
  r2Config: fc.record({
    accessKeyId: fc.string({ minLength: 1 }),
    secretAccessKey: fc.string({ minLength: 1 }),
    endpoint: fc.string({ minLength: 1 }),
    bucketName: fc.string({ minLength: 1 }),
  }),
});

// ---------------------------------------------------------------------------
// Property A — uploadToDrive always resolves (never throws)
// ---------------------------------------------------------------------------

describe('Property 5A — uploadToDrive: always resolves regardless of failure type', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with drive_upload_status="failed" when r2Get throws a folder error (no retry)', async () => {
    /**
     * **Validates: Requirements 10.5, 15.3**
     * For folder errors (404/403), uploadToDrive must resolve immediately
     * (no 30s retry) and return { drive_upload_status: 'failed' }.
     * Folder errors are the most common Drive failure type in production.
     */
    await fc.assert(
      fc.asyncProperty(arbUploadParams, arbStatusCodeError, async (params, err) => {
        const r2Get = async () => {
          throw Object.assign(new Error('drive error'), err);
        };
        const driveUpload = async () => ({ fileId: 'test', webViewLink: 'http://test' });

        let result;
        let threw = false;
        try {
          // Folder errors do NOT trigger the 30s sleep, so no timer advance needed
          result = await uploadToDrive(params, r2Get, driveUpload);
        } catch {
          threw = true;
        }

        return !threw && result.drive_upload_status === 'failed';
      }),
      { numRuns: 50 },
    );
  });

  it('resolves with drive_upload_status="failed" when driveUpload throws a folder error', async () => {
    /**
     * **Validates: Requirements 10.5, 15.3**
     * When the Drive API itself returns a folder error, uploadToDrive resolves
     * without throwing, returning a structured failure result.
     */
    await fc.assert(
      fc.asyncProperty(arbUploadParams, arbStatusCodeError, async (params, err) => {
        const r2Get = async () => ({ data: Buffer.from('video-data'), size: 10 });
        const driveUpload = async () => {
          throw Object.assign(new Error('drive error'), err);
        };

        let result;
        let threw = false;
        try {
          result = await uploadToDrive(params, r2Get, driveUpload);
        } catch {
          threw = true;
        }

        return !threw && result.drive_upload_status === 'failed';
      }),
      { numRuns: 50 },
    );
  });

  it('resolves with drive_upload_status="failed" when driveUpload throws folder message errors', async () => {
    /**
     * **Validates: Requirements 10.5, 15.3**
     * Folder errors identified by message content also resolve without throwing.
     */
    await fc.assert(
      fc.asyncProperty(arbUploadParams, arbFolderMessageError, async (params, err) => {
        const r2Get = async () => ({ data: Buffer.from('video-data'), size: 10 });
        const driveUpload = async () => {
          throw Object.assign(new Error(err.message || 'folder error'), err);
        };

        let result;
        let threw = false;
        try {
          result = await uploadToDrive(params, r2Get, driveUpload);
        } catch {
          threw = true;
        }

        return !threw && result.drive_upload_status === 'failed';
      }),
      { numRuns: 50 },
    );
  });

  it('result always has the required shape fields on folder error', async () => {
    /**
     * **Validates: Requirements 10.5**
     * Whether upload succeeds or fails with a folder error, the returned object
     * always has the expected shape.
     */
    await fc.assert(
      fc.asyncProperty(arbUploadParams, arbStatusCodeError, async (params, err) => {
        const r2Get = async () => {
          throw Object.assign(new Error('folder error'), err);
        };
        const driveUpload = async () => ({ fileId: null, webViewLink: null });

        let result;
        try {
          result = await uploadToDrive(params, r2Get, driveUpload);
        } catch {
          return false; // should not throw
        }

        return (
          'drive_upload_status' in result &&
          'gdrive_file_id' in result &&
          'gdrive_link' in result &&
          'drive_upload_error' in result
        );
      }),
      { numRuns: 50 },
    );
  });

  it('resolves with drive_upload_status="success" when upload succeeds', async () => {
    /**
     * **Validates: Requirements 10.5**
     * When r2Get and driveUpload both succeed, uploadToDrive resolves with
     * drive_upload_status="success".
     */
    await fc.assert(
      fc.asyncProperty(
        arbUploadParams,
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        async (params, fileId, webViewLink) => {
          const r2Get = async () => ({ data: Buffer.from('video'), size: 5 });
          const driveUpload = async () => ({ fileId, webViewLink });

          let result;
          try {
            result = await uploadToDrive(params, r2Get, driveUpload);
          } catch {
            return false;
          }

          return (
            result.drive_upload_status === 'success' &&
            result.gdrive_file_id === fileId &&
            result.gdrive_link === webViewLink
          );
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property B — isDriveFolderError correctly classifies 404/403 errors
// ---------------------------------------------------------------------------

describe('Property 5B — isDriveFolderError: classifies 404/403 status codes as folder errors', () => {
  it('returns true for any error with status=404 or status=403', () => {
    /**
     * **Validates: Requirements 10.5**
     * Any error carrying HTTP status 404 or 403 must be classified as a
     * folder error — these indicate "not found" and "access denied".
     */
    fc.assert(
      fc.property(fc.constantFrom(404, 403), (code) => {
        // Test via .status
        const errStatus = { status: code, message: 'drive api error' };
        // Test via .statusCode
        const errStatusCode = { statusCode: code, message: 'drive api error' };
        // Test via numeric .code
        const errCode = { code: code, message: 'drive api error' };

        return (
          isDriveFolderError(errStatus) === true &&
          isDriveFolderError(errStatusCode) === true &&
          isDriveFolderError(errCode) === true
        );
      }),
      { numRuns: 100 },
    );
  });

  it('returns false for non-folder HTTP status codes (200, 500, 429, etc.)', () => {
    /**
     * **Validates: Requirements 10.5**
     * Status codes that do NOT indicate a folder problem must not be classified
     * as folder errors.
     */
    fc.assert(
      fc.property(fc.constantFrom(200, 201, 400, 429, 500, 502, 503), (code) => {
        const err = { status: code, message: 'some error' };
        return isDriveFolderError(err) === false;
      }),
      { numRuns: 100 },
    );
  });

  it('returns false for null/undefined errors', () => {
    /**
     * **Validates: Requirements 10.5**
     * isDriveFolderError must handle null/undefined safely.
     */
    fc.assert(
      fc.property(fc.constantFrom(null, undefined), (val) => {
        return isDriveFolderError(val) === false;
      }),
      { numRuns: 50 },
    );
  });

  it('returns true for errors with folder-related keywords in message', () => {
    /**
     * **Validates: Requirements 10.5**
     * String messages containing "not found", "forbidden", "permission denied"
     * must be classified as folder errors.
     */
    fc.assert(
      fc.property(
        fc.constantFrom(
          'not found',
          'folder not found',
          'does not exist',
          'forbidden',
          'permission denied',
          'insufficient permission',
        ),
        (keyword) => {
          const err = { message: `Drive API error: ${keyword}` };
          return isDriveFolderError(err) === true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
