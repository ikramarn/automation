import { Resend } from 'resend';

// ── Sender address ─────────────────────────────────────────────────────────

const DEFAULT_FROM = 'AI Video Automation <noreply@example.com>';

function getFromAddress(): string {
  return process.env['RESEND_FROM_EMAIL'] ?? DEFAULT_FROM;
}

// ── Resend client factory ──────────────────────────────────────────────────

/**
 * Creates a Resend client using the `RESEND_API_KEY` environment variable.
 * Exported for testing / injection purposes.
 */
export function createEmailClient(): Resend {
  const apiKey = process.env['RESEND_API_KEY'] ?? '';
  return new Resend(apiKey);
}

// ── Template definitions ───────────────────────────────────────────────────

interface TemplateResult {
  subject: string;
  html: string;
}

/**
 * Returns the subject line and HTML body for the given template type.
 * Returns `null` for unknown template types so the caller can warn and skip.
 */
function buildTemplate(
  type: string,
  data: Record<string, unknown>,
): TemplateResult | null {
  switch (type) {
    // ── Pipeline outcome emails ──────────────────────────────────────────

    case 'execution-success': {
      const pipelineName = String(data['pipeline_name'] ?? '');
      const timestamp = String(data['timestamp'] ?? '');
      const videoTitle = String(data['video_title'] ?? '');
      const driveLink = String(data['drive_link'] ?? '');
      const platformStatus = data['platform_status'] as Record<string, string> | undefined;

      const platformRows = platformStatus
        ? Object.entries(platformStatus)
            .map(
              ([platform, status]) =>
                `<tr><td style="padding:4px 8px;text-transform:capitalize;">${platform}</td>` +
                `<td style="padding:4px 8px;">${status}</td></tr>`,
            )
            .join('')
        : '';

      return {
        subject: `✅ Pipeline "${pipelineName}" completed successfully`,
        html: `
<h2>Pipeline Execution Successful</h2>
<p><strong>Pipeline:</strong> ${pipelineName}</p>
<p><strong>Completed at:</strong> ${timestamp}</p>
<p><strong>Video title:</strong> ${videoTitle}</p>
${driveLink ? `<p><strong>Google Drive link:</strong> <a href="${driveLink}">${driveLink}</a></p>` : ''}
${
  platformRows
    ? `<h3>Publishing Status</h3>
<table border="1" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
  <thead><tr><th style="padding:4px 8px;">Platform</th><th style="padding:4px 8px;">Status</th></tr></thead>
  <tbody>${platformRows}</tbody>
</table>`
    : ''
}`,
      };
    }

    case 'execution-failure': {
      const pipelineName = String(data['pipeline_name'] ?? '');
      const timestamp = String(data['timestamp'] ?? '');
      const failedStep = String(data['failed_step'] ?? '');
      const failureReason = String(data['failure_reason'] ?? '');

      return {
        subject: `❌ Pipeline "${pipelineName}" failed`,
        html: `
<h2>Pipeline Execution Failed</h2>
<p><strong>Pipeline:</strong> ${pipelineName}</p>
<p><strong>Failed at:</strong> ${timestamp}</p>
<p><strong>Failed step:</strong> ${failedStep}</p>
<p><strong>Reason:</strong> ${failureReason}</p>`,
      };
    }

    case 'pipeline-paused': {
      const pipelineName = String(data['pipeline_name'] ?? '');
      const timestamp = String(data['timestamp'] ?? '');
      const consecutiveFailures = String(data['consecutive_failures'] ?? '');
      const lastFailureReason = String(data['last_failure_reason'] ?? '');

      return {
        subject: `⏸️ Pipeline "${pipelineName}" has been auto-paused`,
        html: `
<h2>Pipeline Auto-Paused</h2>
<p>Your pipeline <strong>${pipelineName}</strong> has been automatically paused after ${consecutiveFailures} consecutive failures.</p>
<p><strong>Paused at:</strong> ${timestamp}</p>
<p><strong>Last failure reason:</strong> ${lastFailureReason}</p>
<p>Please review your pipeline configuration and re-enable it when ready.</p>`,
      };
    }

    // ── Credential / token emails ────────────────────────────────────────

    case 'token-expired': {
      const platformName = String(data['platform_name'] ?? '');
      const settingsLink = String(data['settings_link'] ?? '/settings/connections');

      return {
        subject: `🔑 Action required: ${platformName} token expired`,
        html: `
<h2>Platform Token Expired</h2>
<p>Your <strong>${platformName}</strong> access token has expired. Pipelines using this platform have been paused.</p>
<p>Please reconnect your account to resume publishing:</p>
<p><a href="${settingsLink}">Reconnect ${platformName}</a></p>`,
      };
    }

    // ── Billing emails ───────────────────────────────────────────────────

    case 'payment-failure': {
      const billingPortalLink = String(data['billing_portal_link'] ?? '');

      return {
        subject: '⚠️ Payment failed — action required',
        html: `
<h2>Payment Failed</h2>
<p>We were unable to process your latest payment. Your subscription has been suspended until payment is resolved.</p>
${billingPortalLink ? `<p><a href="${billingPortalLink}">Update payment method</a></p>` : ''}`,
      };
    }

    case 'subscription-suspended': {
      const billingPortalLink = String(data['billing_portal_link'] ?? '');

      return {
        subject: '🚫 Your subscription has been suspended',
        html: `
<h2>Subscription Suspended</h2>
<p>Your AI Video Automation subscription has been suspended. All pipeline executions have been paused.</p>
${billingPortalLink ? `<p>To reactivate your subscription, please visit your <a href="${billingPortalLink}">billing portal</a>.</p>` : ''}`,
      };
    }

    // ── Account security emails ──────────────────────────────────────────

    case 'account-locked': {
      const unlockTime = String(data['unlock_time'] ?? '');

      return {
        subject: '🔒 Your account has been temporarily locked',
        html: `
<h2>Account Temporarily Locked</h2>
<p>Your account has been locked due to multiple failed login attempts.</p>
<p><strong>Your account will be unlocked at:</strong> ${unlockTime}</p>
<p>If you did not attempt to log in, please reset your password immediately.</p>`,
      };
    }

    // ── Auth / verification emails ───────────────────────────────────────

    case 'email-verify': {
      const verificationLink = String(data['verification_link'] ?? '');

      return {
        subject: 'Verify your email address',
        html: `
<h2>Verify Your Email Address</h2>
<p>Thank you for signing up. Please verify your email address by clicking the link below:</p>
<p><a href="${verificationLink}">Verify email address</a></p>
<p>This link will expire in 24 hours. If you did not create an account, you can safely ignore this email.</p>`,
      };
    }

    case 'password-reset': {
      const resetLink = String(data['reset_link'] ?? '');

      return {
        subject: 'Reset your password',
        html: `
<h2>Reset Your Password</h2>
<p>We received a request to reset the password for your account.</p>
<p><a href="${resetLink}">Reset password</a></p>
<p>This link will expire in 60 minutes. If you did not request a password reset, you can safely ignore this email.</p>`,
      };
    }

    case 'email-change': {
      const verificationLink = String(data['verification_link'] ?? '');

      return {
        subject: 'Confirm your new email address',
        html: `
<h2>Confirm Email Change</h2>
<p>You recently requested to change your email address. Please confirm your new address by clicking the link below:</p>
<p><a href="${verificationLink}">Confirm new email address</a></p>
<p>This link will expire in 24 hours. If you did not request this change, please contact support immediately.</p>`,
      };
    }

    default:
      return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Dispatches a transactional email using the Resend SDK.
 *
 * Behaviour:
 * - If `RESEND_API_KEY` is not set: logs a warning and returns without sending.
 * - If the template type is unknown: logs a warning and returns without sending.
 * - If the Resend API call fails: logs the error and returns (email is best-effort).
 * - Never throws — callers do not need to handle errors from this function.
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.6
 */
export async function sendTransactionalEmail(
  type: string,
  to: string,
  data: Record<string, unknown>,
): Promise<void> {
  // Graceful degradation: skip in dev environments without an API key.
  const apiKey = process.env['RESEND_API_KEY'];
  if (!apiKey) {
    console.warn(
      `[email] RESEND_API_KEY is not set — skipping transactional email (type: ${type}, to: ${to})`,
    );
    return;
  }

  // Resolve template
  const template = buildTemplate(type, data);
  if (!template) {
    console.warn(`[email] Unknown email template type: "${type}" — skipping dispatch`);
    return;
  }

  // Send via Resend
  const client = createEmailClient();

  try {
    const { error } = await client.emails.send({
      from: getFromAddress(),
      to,
      subject: template.subject,
      html: template.html,
    });

    if (error) {
      console.error(`[email] Resend API returned an error for type "${type}":`, error);
    }
  } catch (err) {
    // Best-effort: log and continue so callers are never disrupted.
    console.error(`[email] Failed to send transactional email (type: "${type}", to: ${to}):`, err);
  }
}
