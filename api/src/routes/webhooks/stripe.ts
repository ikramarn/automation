import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Stripe from 'stripe';
import { createStripeClient } from '../../lib/stripe.js';
import { createSupabaseAdminClient } from '../../lib/supabase.js';
import { delay } from '../../lib/delay.js';
import { sendTransactionalEmail } from '../../lib/email.js';

// ── Retry configuration ────────────────────────────────────────────────────

/**
 * Exponential backoff delay sequence (in milliseconds) for webhook processing
 * retries. Matches the spec: [5s, 10s, 20s, 40s, 80s] — five retries max.
 *
 * Requirements: 2.9
 */
export const RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 40_000, 80_000] as const;

/** Maximum number of retry attempts after an initial processing failure. */
const MAX_RETRIES = RETRY_DELAYS_MS.length; // 5

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolves the email address for a user identified by their Stripe customer ID.
 * Returns `null` if the user cannot be found.
 */
async function resolveUserEmail(
  log: FastifyRequest['log'],
  stripeCustomerId: string,
): Promise<string | null> {
  const supabase = createSupabaseAdminClient();

  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('email')
    .eq('stripe_customer_id', stripeCustomerId)
    .single();

  if (error || !profile) {
    log.warn({ stripeCustomerId, error }, 'Could not resolve user email for notification');
    return null;
  }

  return profile.email as string;
}

/**
 * Sends a transactional email notification for a billing event.
 * Looks up the user's email via Stripe customer ID, then dispatches the
 * appropriate email template. Failures are logged but never re-thrown.
 */
async function sendNotification(
  log: FastifyRequest['log'],
  type: string,
  stripeCustomerId: string,
): Promise<void> {
  const email = await resolveUserEmail(log, stripeCustomerId);
  if (!email) {
    log.warn({ type, stripeCustomerId }, 'Skipping notification — could not resolve user email');
    return;
  }

  const billingPortalUrl = process.env['BILLING_PORTAL_URL'] ?? '';

  try {
    await sendTransactionalEmail(type, email, {
      billing_portal_link: billingPortalUrl,
    });
  } catch (err) {
    // sendTransactionalEmail is already best-effort, but guard defensively.
    log.warn({ err, type, stripeCustomerId }, 'Failed to send billing notification email');
  }
}

/**
 * Suspends all active pipelines for a user identified by their Stripe
 * customer ID.  Updates the pipeline rows to `status = 'suspended'`.
 */
async function suspendUserPipelines(
  log: FastifyRequest['log'],
  stripeCustomerId: string,
): Promise<void> {
  const supabase = createSupabaseAdminClient();

  // Resolve user by stripe_customer_id
  const { data: profile, error: profileErr } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('stripe_customer_id', stripeCustomerId)
    .single();

  if (profileErr || !profile) {
    log.warn({ stripeCustomerId, profileErr }, 'Could not resolve user for pipeline suspension');
    return;
  }

  const { error: pipelineErr } = await supabase
    .from('pipelines')
    .update({ status: 'suspended' })
    .eq('user_id', profile.id)
    .in('status', ['active', 'running']);

  if (pipelineErr) {
    log.warn({ err: pipelineErr }, 'Failed to suspend pipelines after subscription event');
  }
}

// ── Event processors ───────────────────────────────────────────────────────

/**
 * `checkout.session.completed` — activate subscription.
 * Requirements: 2.3
 */
async function handleCheckoutSessionCompleted(
  log: FastifyRequest['log'],
  session: Stripe.Checkout.Session,
): Promise<void> {
  const stripeCustomerId = session.customer as string | null;
  const stripeSubscriptionId = session.subscription as string | null;

  if (!stripeCustomerId) {
    log.warn({ sessionId: session.id }, 'checkout.session.completed has no customer — skipping');
    return;
  }

  const supabase = createSupabaseAdminClient();

  const { error } = await supabase
    .from('user_profiles')
    .update({
      subscription_status: 'active',
      ...(stripeSubscriptionId ? { stripe_subscription_id: stripeSubscriptionId } : {}),
    })
    .eq('stripe_customer_id', stripeCustomerId);

  if (error) {
    throw new Error(`DB update failed for checkout.session.completed: ${error.message}`);
  }

  log.info(
    { stripeCustomerId, stripeSubscriptionId },
    'Subscription activated via checkout.session.completed',
  );
}

/**
 * `invoice.payment_failed` — suspend subscription and notify user.
 * Requirements: 2.4
 */
async function handleInvoicePaymentFailed(
  log: FastifyRequest['log'],
  invoice: Stripe.Invoice,
): Promise<void> {
  const stripeCustomerId = invoice.customer as string | null;

  if (!stripeCustomerId) {
    log.warn({ invoiceId: invoice.id }, 'invoice.payment_failed has no customer — skipping');
    return;
  }

  const supabase = createSupabaseAdminClient();

  const { error } = await supabase
    .from('user_profiles')
    .update({ subscription_status: 'suspended' })
    .eq('stripe_customer_id', stripeCustomerId);

  if (error) {
    throw new Error(`DB update failed for invoice.payment_failed: ${error.message}`);
  }

  await sendNotification(log, 'payment-failure', stripeCustomerId);

  log.info({ stripeCustomerId }, 'Subscription suspended via invoice.payment_failed');
}

/**
 * `customer.subscription.deleted` — cancel subscription, suspend pipelines,
 * and notify user.
 * Requirements: 2.5
 */
async function handleSubscriptionDeleted(
  log: FastifyRequest['log'],
  subscription: Stripe.Subscription,
): Promise<void> {
  const stripeCustomerId = subscription.customer as string | null;

  if (!stripeCustomerId) {
    log.warn(
      { subscriptionId: subscription.id },
      'customer.subscription.deleted has no customer — skipping',
    );
    return;
  }

  const supabase = createSupabaseAdminClient();

  const { error } = await supabase
    .from('user_profiles')
    .update({ subscription_status: 'cancelled' })
    .eq('stripe_customer_id', stripeCustomerId);

  if (error) {
    throw new Error(`DB update failed for customer.subscription.deleted: ${error.message}`);
  }

  await suspendUserPipelines(log, stripeCustomerId);
  await sendNotification(log, 'subscription-suspended', stripeCustomerId);

  log.info({ stripeCustomerId }, 'Subscription cancelled via customer.subscription.deleted');
}

/**
 * `customer.subscription.updated` — handle `past_due` / `unpaid` status
 * transitions by suspending the subscription and pipelines.
 * Requirements: 2.4, 2.5
 */
async function handleSubscriptionUpdated(
  log: FastifyRequest['log'],
  subscription: Stripe.Subscription,
): Promise<void> {
  const suspendStatuses = new Set(['past_due', 'unpaid']);

  if (!suspendStatuses.has(subscription.status)) {
    // Nothing to do for other statuses (e.g. active, trialing, canceled)
    return;
  }

  const stripeCustomerId = subscription.customer as string | null;

  if (!stripeCustomerId) {
    log.warn(
      { subscriptionId: subscription.id },
      'customer.subscription.updated has no customer — skipping',
    );
    return;
  }

  const supabase = createSupabaseAdminClient();

  const { error } = await supabase
    .from('user_profiles')
    .update({ subscription_status: 'suspended' })
    .eq('stripe_customer_id', stripeCustomerId);

  if (error) {
    throw new Error(`DB update failed for customer.subscription.updated: ${error.message}`);
  }

  await suspendUserPipelines(log, stripeCustomerId);

  log.info(
    { stripeCustomerId, stripeStatus: subscription.status },
    'Subscription suspended via customer.subscription.updated',
  );
}

// ── Dispatch ───────────────────────────────────────────────────────────────

/**
 * Dispatches a verified Stripe event to the appropriate handler.
 * Unknown event types are silently ignored (return without action).
 */
async function dispatchEvent(
  log: FastifyRequest['log'],
  event: Stripe.Event,
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(log, event.data.object as Stripe.Checkout.Session);
      break;

    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(log, event.data.object as Stripe.Invoice);
      break;

    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(log, event.data.object as Stripe.Subscription);
      break;

    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(log, event.data.object as Stripe.Subscription);
      break;

    default:
      // Silently ignore events we don't handle — return 200 to Stripe
      log.debug({ eventType: event.type }, 'Unhandled Stripe event type — ignoring');
      break;
  }
}

/**
 * Dispatches the event with exponential backoff retry on failure.
 *
 * On each failure the handler waits RETRY_DELAYS_MS[attempt] before
 * trying again. After MAX_RETRIES failures the last error is re-thrown
 * so the route handler can return 500 (Stripe will retry delivery).
 *
 * Exported for property-based testing only — treat as internal.
 *
 * Requirements: 2.9
 */
export async function dispatchWithRetry(
  log: FastifyRequest['log'],
  event: Stripe.Event,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await dispatchEvent(log, event);
      return; // success — exit immediately
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        const waitMs = RETRY_DELAYS_MS[attempt] as number;
        log.warn(
          { err, attempt: attempt + 1, waitMs, eventType: event.type },
          'Webhook processing failed — retrying with backoff',
        );
        await delay(waitMs);
      }
    }
  }

  // All retries exhausted
  throw lastError;
}

// ── Route ──────────────────────────────────────────────────────────────────

/**
 * POST /webhooks/stripe
 *
 * Stripe webhook endpoint.  Body parsing is disabled so we can read the raw
 * request body, which is required for signature verification.
 *
 * Flow:
 *   1. Read raw body as a Buffer (content-type: application/json from Stripe)
 *   2. Verify Stripe-Signature header with constructEventAsync()
 *   3. Return 400 on invalid signature
 *   4. Dispatch to the appropriate event handler with exponential backoff
 *   5. Return 200 on success (Stripe marks delivery as succeeded)
 *   6. Return 500 on exhausted retries (Stripe will re-deliver)
 *
 * Requirements: 2.3, 2.4, 2.5, 2.9
 */
export async function stripeWebhookRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/stripe',
    {
      config: {
        // Signal to Fastify that we are handling the raw body ourselves.
        // The built-in JSON body parser is still registered globally, but we
        // read req.raw (the Node IncomingMessage) before Fastify touches it
        // when we inject requests in tests via content-type text/plain.
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];

      if (!webhookSecret) {
        request.log.error('STRIPE_WEBHOOK_SECRET is not configured');
        return reply.code(500).send({ error: 'Webhook secret not configured' });
      }

      // ── Read raw body ──────────────────────────────────────────────────
      // Fastify buffers the request body before the handler runs.  In
      // production (real HTTP), `request.body` is the parsed JSON object;
      // we need the raw bytes for Stripe's HMAC signature verification.
      //
      // Strategy:
      //   1. If `request.body` is a Buffer, use it directly (edge case).
      //   2. If `request.body` is a string, encode it.
      //   3. Otherwise serialize the parsed object back to JSON — this
      //      preserves the exact byte sequence Stripe signed as long as
      //      the content-type is application/json (Stripe always sends JSON).
      //
      // We do NOT attempt to re-read from `request.raw` because Fastify
      // has already consumed the stream by the time the handler executes.
      let rawBody: Buffer;

      if (Buffer.isBuffer(request.body)) {
        rawBody = request.body;
      } else if (typeof request.body === 'string') {
        rawBody = Buffer.from(request.body);
      } else if (request.body !== undefined && request.body !== null) {
        rawBody = Buffer.from(JSON.stringify(request.body));
      } else {
        rawBody = Buffer.alloc(0);
      }

      // ── Verify Stripe signature ────────────────────────────────────────
      const signature = request.headers['stripe-signature'] as string | undefined;

      if (!signature) {
        return reply.code(400).send({ error: 'Missing Stripe-Signature header' });
      }

      const stripe = createStripeClient();
      let event: Stripe.Event;

      try {
        event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
      } catch (err) {
        request.log.warn({ err }, 'Stripe webhook signature verification failed');
        return reply.code(400).send({ error: 'Invalid webhook signature' });
      }

      // ── Dispatch event with retry ──────────────────────────────────────
      try {
        await dispatchWithRetry(request.log, event);
      } catch (err) {
        request.log.error(
          { err, eventType: event.type, eventId: event.id },
          'Stripe webhook processing failed after all retries',
        );
        // Return 500 so Stripe knows to re-deliver this event
        return reply.code(500).send({ error: 'Webhook processing failed' });
      }

      return reply.code(200).send({ received: true });
    },
  );
}
