# Session Memory — AutomateSocials Video Pipeline Debugging

Last updated: 2026-09-10 (session covering ~06:00–15:00 UTC)

## Goal
Get the AutomateSocials video automation pipeline (VPS 76.13.254.137) working
end-to-end for HeyGen Video Agent (prompt-only, `content_source=agent`) mode:
niche/prompt in → HeyGen generates video → Google Drive upload → social publish.

## Where things stand right now
The n8n workflow has been rewritten extensively this session and is **live and
deployed**, but **has not yet completed a fully successful end-to-end run**.
Progress has been real and incremental — each fix gets further than the last —
but the very last blocker (HeyGen's Video Agent session itself failing during
the planning phase, for reasons HeyGen's API doesn't clearly expose) is
unresolved as of the last test.

Commit `e4d7e58` (pushed to origin/master) captures the current live n8n
workflow JSON. **No Jenkins deploy is needed for n8n workflow changes** — they
go live immediately via n8n's REST API. Jenkins only matters if `api/` or
`dashboard/` source changes (it currently does not need to run for anything
outstanding from this session).

## Root causes found and fixed this session (chronological)

1. **n8n on wrong Docker volume.** Earlier DB-wipe recovery had restarted the
   n8n container manually, binding to a bare-named volume (`n8n_data`) instead
   of the compose-managed one (`autoflow_n8n_data`). Fixed by copying data to
   the correct volume and restarting via `docker compose`. This also fixed:

2. **`N8N_SERVICE_TOKEN` missing from n8n container env** — caused by the same
   wrong-restart issue. This meant `Cleanup`'s callback to
   `/internal/execution-log/update` always failed auth silently, leaving every
   `execution_logs` row stuck at `status: running` forever.

3. **`Initialize` node dropped `content_source` and all `heygen_*` fields**
   from the webhook payload — every pipeline silently ran the classic
   OpenAI/news path regardless of dashboard selection. Fixed: `Initialize`
   now forwards `content_source`, `heygen_mode`, `heygen_agent_prompt`,
   `heygen_custom_script`, `heygen_engine`, etc.

4. **Missing `heygen_agent_prompt` had no fallback.** Added: if blank, build a
   prompt from `niche_keyword` + duration/tone/language — matches the user's
   stated intent ("just pass the niche, let HeyGen do the rest").

5. **THE BIG ONE: `$http` doesn't exist in n8n's Code node sandbox.** Every
   node used `$http.get()/.request()` for all HTTP calls — confirmed by
   reading n8n's own source (`Sandbox.js`, `Code.node.js` inside the
   `n8n-nodes-base` package in the container). The real API is
   `helpers.httpRequest(...)`. This meant literally every HTTP call in the
   workflow (news fetch, HeyGen, Drive, YouTube, etc.) was silently failing
   this entire time, regardless of any other bug. Rewrote all 7 affected
   nodes: Content_Fetcher, Script_Generator, Video_Generator, File_Stager
   (later removed), Drive_Uploader, Social_Publisher, Cleanup.

6. **`URLSearchParams` also not exposed in the sandbox** (only `require()` of
   allow-listed builtins and the injected `helpers`/`$env`/data-proxy are
   available). Found this breaking Drive_Uploader's OAuth token exchange.
   Fixed by building the form-urlencoded body manually.

7. **Cloudflare R2 was never actually configured** — the VPS `.env` had
   literal placeholder strings (`REPLACE_WITH_R2_KEY_ID`, etc.), not real
   credentials. Also, n8n's `auth: {type: 'aws', ...}` option on
   `helpers.httpRequest` does NOT actually sign S3/R2 requests — confirmed
   empirically (falls through to empty Basic auth). User decided (given R2
   was optional and free either way) to **remove R2 entirely**: deleted the
   `File_Stager` node, rewired `Video_Generator → Drive_Uploader` directly,
   Drive_Uploader/Social_Publisher now read `ctx.heygen_video_url` (HeyGen's
   CDN link) directly instead of a staged R2 copy.

8. **`Error_Router` node was wired to every node's NORMAL success output**,
   not a real n8n error connector — it fired on every single node completion
   (success or not), synthesized a fake `__error: true` with
   `__error_step: 'Unknown'`, and raced ahead to `Cleanup` before the real
   pipeline (which takes minutes due to HeyGen polling) ever finished. This
   was the root cause of several "instant failure" false negatives during
   testing. Removed the node entirely and rewired the graph into a plain
   linear chain — every node's own try/catch already threads `__error`
   through `ctx`, so this was redundant AND actively harmful.

9. **`Notify` node's `bodyParameters` was empty** (`{}`) — every notification
   call failed with `400 Request validation failed — must have required
   property 'user_id'`. Fixed: now maps `user_id`, `pipeline_id`,
   `execution_id`, `status` (from `final_status`), `failure_reason` from
   context.

10. **HeyGen Video Agent requires an explicit plan-approval step.** HeyGen's
    Video Agent ALWAYS stops at a "Video Plan" checkpoint (research +
    storyboard) before rendering — even with `mode: 'generate'`. You must send
    a follow-up message (`POST /v3/video-agents/{session_id}` with
    `{message: 'Proceed'}` or similar) to confirm the plan before any
    credits are spent or rendering starts. Confirmed via HeyGen's own docs
    (`developers.heygen.com/docs/interactive-sessions`,
    `help.heygen.com/en/articles/16007192-video-agent-faq`) and the user's own
    screenshots of the HeyGen dashboard showing plans stuck at "Continue when
    you're ready." Implemented the approval call in `Video_Generator`.

11. **Approval loop had a real bug (found by the user, not by testing):** the
    loop's exit condition was `!videoId`, but HeyGen's create response often
    already includes a placeholder `video_id` immediately, before the plan is
    even approved. This made the loop exit before ever sending "Proceed" —
    exactly why the fix "worked once, broke again": it was a race depending on
    whether that placeholder happened to be present yet. Fixed: loop is now
    driven by session `status` (only trust `video_id` once status reaches
    `generating`/`completed`), not by `video_id` presence. Verified with two
    regression tests (`scripts/test-approval-flow-mock.js`,
    `test-approval-flow-mock2.js` — recreate these if needed, they were
    deleted in scripts/ cleanup at session end, logic lives in the git history
    of `n8n/workflows/video-automation-pipeline.json`).

12. **Error-message extraction bug:** when a HeyGen session failed during
    "thinking" (before reaching an approval checkpoint), the code picked
    the *first model message it found* as the "failure reason" — which was
    sometimes just the agent's conversational opening greeting ("Hi ikram!
    I'm on it...*"), not an actual error. Fixed: now prefers a message with
    `type: 'error'`, falls back to a clearly-labeled "no specific error —
    last agent message was: ..." instead of presenting the greeting as if it
    were the failure reason. Also now preserves `heygen_session_id` and
    `heygen_video_id` on failure (previously lost, making failures
    undiagnosable without a fresh HeyGen API call).

## STILL UNRESOLVED — pick up here next session

The most recent real test (execution 36, ~14:34–14:37 UTC) failed with the
HeyGen session itself reporting `status: 'failed'` during the ~3-minute
"thinking"/research phase — **before ever reaching the approval checkpoint**.
This happened for a "crypto market" niche prompt. HeyGen's API gives no
`failure_message`/`failure_code` and no error-typed message in this case —
the session just dies with only a greeting in the transcript.

This does NOT look like a code bug (the approval-loop fix is confirmed
correct via unit tests and via real execution logs from the prior test that
got further). It looks like something failing on HeyGen's platform side
during research/planning for that specific prompt/session. Not yet
diagnosed further because:
- HeyGen's API exposes no reason for this class of failure.
- The user asked to stop making exploratory test calls directly against
  HeyGen (each one creates a real video plan / consumes quota and clutters
  their HeyGen dashboard with pending items).
- The user's own HeyGen dashboard UI likely shows more detail than the API
  does (per earlier screenshots) — worth checking there directly next time
  a failure happens, rather than more API probing from this side.

### Next steps when resuming
1. Ask the user to trigger one more real pipeline test (agent mode) and
   check BOTH: (a) the dashboard's execution detail failure_reason, now with
   the improved error message, and (b) their HeyGen dashboard UI directly for
   that session, to see if HeyGen shows a real reason there that the API
   hides.
2. If the session keeps failing at "thinking" for crypto-related prompts
   specifically, consider whether it's a content-policy/safety rejection on
   HeyGen's side (financial advice/predictions content might get flagged) —
   worth testing with a neutral/generic prompt if the user is willing, OR
   just asking the user to try a different niche next time to isolate this.
3. If it's confirmed to be prompt-content-specific, no code fix is possible
   here — would need to inform the user this is a HeyGen platform behavior,
   not a pipeline bug.
4. If HeyGen's dashboard reveals a specific, actionable reason (e.g. an
   avatar/voice conflict, an unsupported style_id, something else), come back
   and encode that as a clearer error message or a retry/adjustment in
   `Video_Generator`.
5. Once a video successfully generates and reaches `Drive_Uploader`, that
   node has NOT yet been proven end-to-end — it was code-reviewed and its two
   riskiest HTTP calls (OAuth token exchange, multipart binary upload) were
   verified in isolation against real HTTP behavior, but never exercised for
   real inside the pipeline. Watch this step closely on the next successful
   video generation.
6. Social_Publisher (YouTube via Ayrshare or direct API depending on audit
   status) has also never been exercised for real yet — same caveat.

## Key technical facts (don't rediscover these)

- **n8n version:** 1.48.0. Code node sandbox does NOT expose `$http`,
  `URLSearchParams`, or bare Node builtins. Only `helpers.*` (httpRequest,
  etc.), `$env`, `$input`, the workflow data-proxy, and explicitly
  allow-listed `require()` targets (via `NODE_FUNCTION_ALLOW_BUILTIN`, unset
  = nothing allowed) are available. `helpers.httpRequest`'s `auth: {type:
  'aws'}` does NOT sign S3-compatible requests — confirmed empirically, do
  not rely on it if R2/S3 is ever reintroduced.
- **HeyGen v3 API responses are wrapped in `{data: {...}}`** — always check
  both `resp.data?.field` and `resp.field` defensively.
- **HeyGen session statuses:** `thinking` → (`waiting_for_input` |
  `reviewing`) → approve → `generating` → `completed` | `failed`. Approval:
  `POST /v3/video-agents/{session_id}` with a message body (e.g.
  `{message: 'Proceed'}`).
- **HeyGen video statuses:** `pending`/`processing` → `completed` | `failed`.
  On failure, `GET /v3/videos/{video_id}` may include `failure_message`/
  `failure_code`, but in practice these are often empty (confirmed on 2+
  failed videos this session) — don't rely on always getting a reason.
- **n8n workflow ID:** `2vFZUPrgs1oJauGd` ("My workflow", 11 nodes after
  cleanup: Webhook, Initialize, Initialize_Log, Merge_Init_Context,
  Content_Fetcher, Script_Generator, Video_Generator, Drive_Uploader,
  Social_Publisher, Cleanup, Notify — linear chain, no Error_Router).
- **n8n API key:**
  `n8n_api_1237d0de674ad45fcaaccb35d1a8f53c818ea1b6feaf4900ba9567ba49096ee61022f714bda2f1b1`
- **N8N_SERVICE_TOKEN:**
  `2f27852ca0f5375e53b7b7a58ea129c73f3b3ff6f7f1413b0d35d3e76b2b3396`
- **Real test pipeline ID:** `730a98ff-43f5-408d-8a85-9f38ab6e735c` (name
  "mango", content_source=agent, has real HeyGen+YouTube+Drive credentials).
  User also created additional test pipelines during this session (crypto
  niche variants) via the dashboard GUI directly.
- **n8n's execution-list REST API is unreliable for "live" status** — it
  sometimes returns stale/cached data for in-flight or just-completed
  executions. The reliable way to check real execution state: query n8n's
  SQLite DB directly. DB path inside container:
  `/home/node/.n8n/.n8n/database.sqlite` (note the doubled `.n8n/.n8n`, an
  artifact of `N8N_USER_FOLDER=/home/node/.n8n` combined with n8n's default
  behavior). n8n's own bundled `sqlite3` node module is usable directly:
  `require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3')`. Tables:
  `execution_entity` (id, status, startedAt, stoppedAt, workflowId, finished)
  and `execution_data` (executionId, data — a large numbered-reference-string
  serialization, not plain JSON; the n8n REST API's `?includeData=true`
  deserializes this for you and is easier to work with once you have a
  confirmed-real execution id).
- **The single most reliable source of truth for "did this pipeline actually
  run and what happened" is `execution_logs` in Supabase**, not n8n's own
  execution UI/API — the API's `pipelineExecutor.ts` creates this row
  up-front and `Cleanup` finalizes it via callback. Query via a `.cjs` script
  copied into the `api` container (has `SUPABASE_URL`/`SUPABASE_SECRET_KEY`
  env vars already).
- **Deployment mechanics for n8n workflow changes** (repeat every time):
  1. Edit local `n8n/workflows/video-automation-pipeline.json` (or write
     individual node `jsCode` to a temp `.js` file and merge back with a
     small script — see git history of this session for the exact pattern
     if recreating tooling).
  2. `scp` the workflow JSON to `/tmp/workflow-agent-fix.json` on the VPS.
  3. `docker cp` it into the `n8n` container, then run a small deploy script
     (was `/tmp/daf.js` this session, deleted at cleanup — recreate: load the
     JSON, PUT to `/api/v1/workflows/{id}`, deactivate → update → activate,
     verify via GET).
  4. **Always re-verify the deployed code's character count / a distinctive
     substring matches your local file** — there were at least two incidents
     this session of deploying a stale copy because the `scp` hadn't finished
     before the deploy script ran against the old `/tmp` file.
- **SSH/exec pattern that reliably works:** write every script to a local
  `.js` file first, `scp` to `/tmp/<name>.js` on the VPS, `docker cp` into
  the target container, `docker exec <container> node /tmp/<name>.js`.
  Inline `node -e "..."` via SSH from PowerShell consistently fails on quote
  escaping — never attempt it, always use a file.
- **Container names:** `n8n`, `api`, `nextjs`, `redis`, `caddy`. Deployed API
  image as of session end: `ikcloudky6/automation:api-206d8077` (predates
  this session's R2-removal change in `pipelineExecutor.ts`, but that change
  nets out to zero diff anyway — see below).

## Decisions made this session
- Removed Cloudflare R2 entirely rather than set up real credentials — user
  confirmed cost/complexity tradeoff favored removal (R2 free tier vs. HeyGen
  CDN direct-link, at this pipeline's scale, cost is a wash; R2 added an
  entire unnecessary hop, AWS SigV4 signing complexity, and was never
  actually configured anyway).
- Net effect: `api/src/lib/pipelineExecutor.ts` and `docker-compose.yml` end
  this session with ZERO diff vs. origin/master — R2 credential-injection
  code and the `NODE_FUNCTION_ALLOW_BUILTIN=crypto` env var were added
  mid-session then removed again once R2 was dropped, since nothing needs
  `crypto` anymore either. Only `n8n/workflows/video-automation-pipeline.json`
  has real, committed changes (commit `e4d7e58`).
- Kept `mode: 'generate'` (not `mode: 'chat'`) for the HeyGen Video Agent
  call — appropriate for unattended scheduled pipelines with no human
  reviewer, but this mode STILL requires the approval step (confirmed via
  docs — the naming is misleading, it does not mean "skip approval").
- Did not touch `n8n/node-scripts/video-generator.js` (the older, separate
  "canonical tested" reference implementation with its own R2/uploadToR2
  logic and a pre-existing failing test unrelated to this session). It is
  NOT what's deployed live — the live workflow's Code node `jsCode` is a
  hand-maintained near-duplicate. Worth reconciling/deleting the stale
  reference eventually, but out of scope for this session.
- Cleaned up all temporary debug/test scripts from `scripts/` at session end
  (only `vps-deploy.sh` and `vps-setup.sh` persist, per established
  workspace convention). If resuming debugging, recreate throwaway scripts
  as needed rather than expecting them to still exist.

## User preferences observed this session
- Wants concrete pass/fail with real evidence, not optimistic assumptions —
  called out "you made changes when you were doing that Google Drive
  change" correctly (see bug #11) and pushed back effectively when I said
  things were "confirmed working" prematurely.
- Sensitive to burning real HeyGen credits/quota via exploratory test calls
  and to cluttering their HeyGen dashboard with abandoned test plans — avoid
  unnecessary direct HeyGen API calls; prefer having the user trigger real
  tests from their dashboard and share screenshots/results.
- Wants Jenkins vs. "just deploy to n8n directly" distinction made explicit
  every time — reiterate which deployment path is needed for a given change.
- Prefers being told directly when something is genuinely unresolved rather
  than a reassuring "should work now."
