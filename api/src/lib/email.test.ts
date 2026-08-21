import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

// ── Resend mock ────────────────────────────────────────────────────────────
// We mock the 'resend' module before importing the module under test so that
// no real HTTP calls are made.

const mockEmailsSend = vi.fn();

vi.mock('resend', () => {
  return {
    Resend: vi.fn().mockImplementation(() => ({
      emails: {
        send: mockEmailsSend,
      },
    })),
  };
});

// Import after mocking so the module receives the mock constructor.
import { sendTransactionalEmail } from './email.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function setApiKey(value: string | undefined): void {
  if (value === undefined) {
    delete process.env['RESEND_API_KEY'];
  } else {
    process.env['RESEND_API_KEY'] = value;
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('sendTransactionalEmail', () => {
  let warnSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Default: API key is set
    setApiKey('test-api-key');
    // Default: mock returns success
    mockEmailsSend.mockResolvedValue({ data: { id: 'email-123' }, error: null });
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    delete process.env['RESEND_API_KEY'];
  });

  // ── execution-success ────────────────────────────────────────────────────

  describe('execution-success template', () => {
    it('calls Resend emails.send with correct subject and HTML', async () => {
      await sendTransactionalEmail('execution-success', 'user@example.com', {
        pipeline_name: 'Tech News',
        timestamp: '2024-01-15T10:30:00Z',
        video_title: 'AI Breakthroughs 2024',
        drive_link: 'https://drive.google.com/file/abc123',
        platform_status: { youtube: 'success', tiktok: 'failed' },
      });

      expect(mockEmailsSend).toHaveBeenCalledOnce();
      const call = mockEmailsSend.mock.calls[0]![0] as Record<string, unknown>;

      expect(call['to']).toBe('user@example.com');
      expect(call['subject']).toContain('Tech News');
      expect(call['subject']).toContain('successfully');
      expect(call['html']).toContain('Tech News');
      expect(call['html']).toContain('AI Breakthroughs 2024');
      expect(call['html']).toContain('https://drive.google.com/file/abc123');
      expect(call['html']).toContain('youtube');
      expect(call['html']).toContain('tiktok');
    });

    it('includes per-platform status table in HTML', async () => {
      await sendTransactionalEmail('execution-success', 'user@example.com', {
        pipeline_name: 'My Pipeline',
        timestamp: '2024-01-15T10:30:00Z',
        video_title: 'My Video',
        drive_link: '',
        platform_status: { youtube: 'success', facebook: 'skipped' },
      });

      const call = mockEmailsSend.mock.calls[0]![0] as Record<string, unknown>;
      expect(call['html']).toContain('success');
      expect(call['html']).toContain('skipped');
    });
  });

  // ── execution-failure ────────────────────────────────────────────────────

  describe('execution-failure template', () => {
    it('calls Resend emails.send with correct subject and HTML', async () => {
      await sendTransactionalEmail('execution-failure', 'user@example.com', {
        pipeline_name: 'Tech News',
        timestamp: '2024-01-15T10:30:00Z',
        failed_step: 'Script Generator',
        failure_reason: 'OpenAI API timeout',
      });

      expect(mockEmailsSend).toHaveBeenCalledOnce();
      const call = mockEmailsSend.mock.calls[0]![0] as Record<string, unknown>;

      expect(call['to']).toBe('user@example.com');
      expect(call['subject']).toContain('Tech News');
      expect(call['subject']).toContain('failed');
      expect(call['html']).toContain('Tech News');
      expect(call['html']).toContain('Script Generator');
      expect(call['html']).toContain('OpenAI API timeout');
    });
  });

  // ── payment-failure ──────────────────────────────────────────────────────

  describe('payment-failure template', () => {
    it('calls Resend emails.send with correct subject and HTML', async () => {
      await sendTransactionalEmail('payment-failure', 'user@example.com', {
        billing_portal_link: 'https://billing.stripe.com/portal/abc',
      });

      expect(mockEmailsSend).toHaveBeenCalledOnce();
      const call = mockEmailsSend.mock.calls[0]![0] as Record<string, unknown>;

      expect(call['to']).toBe('user@example.com');
      expect(call['subject']).toContain('Payment failed');
      expect(call['html']).toContain('https://billing.stripe.com/portal/abc');
    });
  });

  // ── account-locked ───────────────────────────────────────────────────────

  describe('account-locked template', () => {
    it('includes unlock_time in the HTML body', async () => {
      const unlockTime = '2024-01-15 11:00:00 UTC';

      await sendTransactionalEmail('account-locked', 'user@example.com', {
        unlock_time: unlockTime,
      });

      expect(mockEmailsSend).toHaveBeenCalledOnce();
      const call = mockEmailsSend.mock.calls[0]![0] as Record<string, unknown>;

      expect(call['subject']).toContain('locked');
      expect(call['html']).toContain(unlockTime);
    });
  });

  // ── pipeline-paused ──────────────────────────────────────────────────────

  describe('pipeline-paused template', () => {
    it('calls Resend with correct subject and HTML containing required fields', async () => {
      await sendTransactionalEmail('pipeline-paused', 'user@example.com', {
        pipeline_name: 'My Pipeline',
        timestamp: '2024-01-15T10:30:00Z',
        consecutive_failures: 3,
        last_failure_reason: 'HeyGen API timeout',
      });

      const call = mockEmailsSend.mock.calls[0]![0] as Record<string, unknown>;
      expect(call['subject']).toContain('My Pipeline');
      expect(call['html']).toContain('3');
      expect(call['html']).toContain('HeyGen API timeout');
    });
  });

  // ── token-expired ────────────────────────────────────────────────────────

  describe('token-expired template', () => {
    it('includes platform_name and settings_link', async () => {
      await sendTransactionalEmail('token-expired', 'user@example.com', {
        platform_name: 'YouTube',
        settings_link: '/settings/connections',
      });

      const call = mockEmailsSend.mock.calls[0]![0] as Record<string, unknown>;
      expect(call['subject']).toContain('YouTube');
      expect(call['html']).toContain('YouTube');
      expect(call['html']).toContain('/settings/connections');
    });
  });

  // ── subscription-suspended ───────────────────────────────────────────────

  describe('subscription-suspended template', () => {
    it('includes billing portal link', async () => {
      await sendTransactionalEmail('subscription-suspended', 'user@example.com', {
        billing_portal_link: 'https://billing.stripe.com/portal/xyz',
      });

      const call = mockEmailsSend.mock.calls[0]![0] as Record<string, unknown>;
      expect(call['subject']).toContain('suspended');
      expect(call['html']).toContain('https://billing.stripe.com/portal/xyz');
    });
  });

  // ── email-verify ─────────────────────────────────────────────────────────

  describe('email-verify template', () => {
    it('includes verification_link', async () => {
      await sendTransactionalEmail('email-verify', 'user@example.com', {
        verification_link: 'https://example.com/verify?token=abc',
      });

      const call = mockEmailsSend.mock.calls[0]![0] as Record<string, unknown>;
      expect(call['subject']).toContain('Verify');
      expect(call['html']).toContain('https://example.com/verify?token=abc');
    });
  });

  // ── password-reset ───────────────────────────────────────────────────────

  describe('password-reset template', () => {
    it('includes reset_link', async () => {
      await sendTransactionalEmail('password-reset', 'user@example.com', {
        reset_link: 'https://example.com/reset?token=xyz',
      });

      const call = mockEmailsSend.mock.calls[0]![0] as Record<string, unknown>;
      expect(call['subject']).toContain('password');
      expect(call['html']).toContain('https://example.com/reset?token=xyz');
    });
  });

  // ── email-change ─────────────────────────────────────────────────────────

  describe('email-change template', () => {
    it('includes verification_link', async () => {
      await sendTransactionalEmail('email-change', 'newaddress@example.com', {
        verification_link: 'https://example.com/confirm-email?token=def',
      });

      const call = mockEmailsSend.mock.calls[0]![0] as Record<string, unknown>;
      expect(call['subject']).toContain('email');
      expect(call['html']).toContain('https://example.com/confirm-email?token=def');
    });
  });

  // ── Missing RESEND_API_KEY ────────────────────────────────────────────────

  describe('missing RESEND_API_KEY', () => {
    it('logs a warning and does not call Resend', async () => {
      setApiKey(undefined);

      await sendTransactionalEmail('execution-success', 'user@example.com', {
        pipeline_name: 'Test',
        timestamp: '2024-01-15T10:30:00Z',
        video_title: 'Test Video',
        drive_link: '',
      });

      expect(mockEmailsSend).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('RESEND_API_KEY'));
    });

    it('does not throw when API key is missing', async () => {
      setApiKey(undefined);

      await expect(
        sendTransactionalEmail('execution-success', 'user@example.com', {}),
      ).resolves.toBeUndefined();
    });
  });

  // ── Unknown template type ─────────────────────────────────────────────────

  describe('unknown template type', () => {
    it('logs a warning and does not call Resend', async () => {
      await sendTransactionalEmail('nonexistent-template', 'user@example.com', {});

      expect(mockEmailsSend).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('nonexistent-template'));
    });

    it('does not throw for unknown template types', async () => {
      await expect(
        sendTransactionalEmail('totally-unknown', 'user@example.com', {}),
      ).resolves.toBeUndefined();
    });
  });

  // ── Resend API error handling ─────────────────────────────────────────────

  describe('Resend API errors', () => {
    it('logs error when Resend returns an error object but does not throw', async () => {
      mockEmailsSend.mockResolvedValue({
        data: null,
        error: { message: 'Invalid API key', name: 'validation_error' },
      });

      await expect(
        sendTransactionalEmail('password-reset', 'user@example.com', {
          reset_link: 'https://example.com/reset',
        }),
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalled();
    });

    it('logs error when Resend throws (network failure) and does not throw', async () => {
      mockEmailsSend.mockRejectedValue(new Error('Network error'));

      await expect(
        sendTransactionalEmail('email-verify', 'user@example.com', {
          verification_link: 'https://example.com/verify',
        }),
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalled();
    });
  });

  // ── From address ──────────────────────────────────────────────────────────

  describe('RESEND_FROM_EMAIL env var', () => {
    it('uses RESEND_FROM_EMAIL when set', async () => {
      process.env['RESEND_FROM_EMAIL'] = 'Custom Sender <custom@myapp.com>';

      await sendTransactionalEmail('password-reset', 'user@example.com', {
        reset_link: 'https://example.com/reset',
      });

      const call = mockEmailsSend.mock.calls[0]![0] as Record<string, unknown>;
      expect(call['from']).toBe('Custom Sender <custom@myapp.com>');

      delete process.env['RESEND_FROM_EMAIL'];
    });

    it('uses default from address when RESEND_FROM_EMAIL is not set', async () => {
      delete process.env['RESEND_FROM_EMAIL'];

      await sendTransactionalEmail('password-reset', 'user@example.com', {
        reset_link: 'https://example.com/reset',
      });

      const call = mockEmailsSend.mock.calls[0]![0] as Record<string, unknown>;
      expect(call['from']).toContain('noreply@example.com');
    });
  });
});
