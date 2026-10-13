# Qwen meeting-note suggestions

The server has an adapter for `qwen3.6-35b-a3b`, **disabled by default**. No live provider request or credential verification was performed. Tests use synthetic responses. Configuration is not evidence of connectivity. The private browser-only Site continues to use the local rules adapter and cannot call Qwen.

## Verified provider and endpoints

Official documentation checked on 2026-10-10 UTC:

- [Model information](https://help.aliyun.com/zh/model-studio/qwen3-6-35b-a3b): exact model identifier and Alibaba Cloud Model Studio (百炼) provider; model regions listed include Beijing, Singapore, Virginia and Frankfurt.
- [Base URL overview](https://www.alibabacloud.com/help/en/model-studio/base-url): region and billing-plan-specific endpoints, shared and workspace domains.
- [Chinese compatibility documentation](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope): OpenAI-compatible Chat Completions; keys must match endpoint region.
- [Structured output](https://help.aliyun.com/zh/model-studio/qwen-structured-output): Qwen3.6 open models support JSON Object in non-thinking mode. This model is not listed for strict JSON Schema. We request JSON Object with `enable_thinking: false` and validate independently with Zod.

Confirm the account's region, deployment scope, model access and exact Base URL in the provider console. An access region alone does not prove processing/data-residency scope. The code never infers region from a key or silently changes regions/models.

| `QWEN_REGION` | Shared Base URL | Dedicated Base URL |
| --- | --- | --- |
| `cn-beijing` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` |
| `ap-southeast-1` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` |
| `us-east-1` | `https://dashscope-us.aliyuncs.com/compatible-mode/v1` | `https://{WorkspaceId}.us-east-1.maas.aliyuncs.com/compatible-mode/v1` |
| `eu-central-1` | Not accepted by this adapter | `https://{WorkspaceId}.eu-central-1.maas.aliyuncs.com/compatible-mode/v1` |

Replace `{WorkspaceId}` with the actual console value. The English compatibility page contains an inconsistent Beijing example; the Chinese compatibility page and Base URL overview agree on `cn-beijing`, which this implementation follows. Coding Plan/Token Plan endpoints are excluded (officially intended for interactive coding tools), as are arbitrary proxy URLs, trial endpoints and unverified regions. Only HTTPS, a matching official host and `/compatible-mode/v1` are accepted. Credentials in URLs, queries, fragments, alternate ports and redirects are rejected.

## Minimal safe configuration and handoff

The administrator UI now provides a dedicated **Model settings → Qwen API key** form when there is no operator-provisioned Qwen configuration. An administrator can enter the key there, choose the approved region/endpoint and a finite allowance/expiry, and save an encrypted workspace credential without making any model call. The saved key is never returned; the input clears after submission. Calls remain disabled until separately enabled. This workspace-scoped path is an alternative to the environment provisioning steps below. Back up the private `<database-path>.credentials-key` file together with SQLite. Configuration is not proof of real connectivity or a currency billing cap.

1. Revoke any credential pasted in a conversation and create a replacement through the provider console. Do not put it in chat, issues, PRs, screenshots, repository files or browser forms. This implementation never reads conversation credentials.
2. Confirm Model Studio pay-as-you-go provider, region, endpoint, model access and a finite test allowance. Confirm the monetary ceiling in the provider's own controls: application attempt limits are not a currency billing cap. Do not assume budget alerts stop billing. Identify a backend runtime/secret manager that accepts the replacement securely; if none exists, stop before live calls.
3. Inject `DASHSCOPE_API_KEY` into the backend runtime only. Never prefix it with `VITE_`, include it in frontend assets, localStorage or a static Site, or print it. Set non-secret `QWEN_REGION` and `QWEN_BASE_URL` from the console. `.env.example` contains only empty placeholders and disabled settings. Never commit a populated `.env`.
4. Set `AI_PROVIDER=qwen`, `AI_CALLS_ENABLED=true`, `QWEN_MODEL=qwen3.6-35b-a3b`. Supply an approved `AI_BUDGET_ID`, `AI_MAX_REQUESTS` (1–1000, all outbound attempts) and future ISO-8601 `AI_BUDGET_EXPIRES_AT` with explicit timezone. Do not rotate the budget ID to bypass the allowance. Retain SQLite across restarts.
5. Keep `AI_MAX_RETRIES=0` for first validation. Defaults: 15-second timeout, 2048 output tokens. Allowed: timeout 1000–30000ms, output 512–4096 tokens, retries 0–1. Each retry consumes another attempt. Input is capped at 12000 characters, 100 lines and 64000 UTF-8 bytes including project context; response body at most 256000 bytes.
6. Start the authenticated backend with that secret environment and use its server-backed frontend (without `VITE_DEMO_MODE=1`). Setup/start/build makes no automatic model call. Select Qwen in Meeting notes, approve sending the current source and project matching fields, then generate one synthetic review. Inspect sources/candidates, check provider billing and remaining attempts, and disable or continue only within the approved allowance.

Live activation remains pending provider/region choice, secure replacement-secret handoff and a finite approved test allowance. Mock tests do not authorize live calls or deployment.

## Data flow and review boundary

Browser → authenticated same-origin `POST /api/proposals/qwen` → server-only adapter → validated draft → editable human review → existing transactional `POST /api/proposals/:id/apply`.

`GET /api/ai/capabilities` requires a session and exposes configured provider/model/region and remaining attempts, never key or endpoint. `connectionVerified: false` avoids claiming connectivity from configuration. A generated proposal records provider/model/region/prompt version.

The request contains numbered source lines and only this workspace's project IDs, names and aliases. It excludes descriptions, latest updates, working notes, tasks, users, sessions and credentials. External processing consent is separate from application confirmation; editing source clears consent. Generating a proposal does not change projects, tasks, activity or workspace revision. Source/proposals are stored in the private application database, never this repository or request logs.

The system instruction is fixed. Notes and names/aliases are serialized as untrusted user-message data. Search, tools and thinking are disabled, with no model-controlled network/database tools. Parsing rejects extra suggestion fields, invalid actions/statuses, unknown/duplicate project IDs, nonexistent source lines, unsupported quotes, duplicate suggestions, malformed/truncated output and tool calls. Exact source wording comes from server-owned input by line number.

These controls limit prompt-injection impact; they do not guarantee semantic correctness or eliminate hallucination. Even a valid quote can accompany an inaccurate title/status. Every suggestion starts without a selected project, with both confirmation flags false. The reviewer chooses the project and confirms every change. Replacing an update requires a second confirmation and current version. Existing workspace isolation, CSRF, optimistic concurrency and rollback remain enforced. Activity references the original proposal and source line.

## Reliability and spending controls

- Five Qwen generation requests/minute/IP, existing authentication, and one in-flight AI review per workspace per server process.
- Persistent idempotency: a successful/failed key replays its saved outcome without contacting Qwen. A pending key is refused; interrupted requests are not automatically replayed after restart, because billing may be unknown. The UI reports this before a new request.
- Persistent attempt ledger reserves before each outbound attempt, atomically checks configured budget/expiry and survives restart. Errors/timeouts count. Never reset the database to renew allowance.
- Only HTTP 429/503 can retry, at most once and only if configured. Retry-After is honored within 0–2 seconds, otherwise the request fails. No retry for timeout, ambiguous network failure, authentication/model error or invalid output; no silent fallback.
- Fetch/body timeout, byte limits and schema validation. Vendor bodies, exception details, credentials and prompts are not logged or exposed in errors. The browser retains notes and supports explicit rules fallback.
- The static private Site does not gain server capabilities and continues to disclose browser-local/no-AI behavior.

## Validation boundaries

`tests/unit/qwen.test.ts`: approved endpoints/configuration, source isolation, malicious/invalid model fields, timeout, bounded retries and response limits. `tests/integration/qwen-api.test.ts`: actual Fastify/SQLite with injected synthetic fetch, auth/CSRF/consent, capabilities, confirmed application, concurrent/repeated requests, restart-persistent budgets and no-write failures. `tests/e2e/qwen-review.spec.ts`: intercepted provider capability/generation responses; its screenshots are mock UI evidence, not live connectivity evidence. Local-adapter tests prove it does not contact Qwen.

Unverified: actual account/region access and parameter support, live latency/quality, token usage/billing, live retry behavior, regional processing scope and deployed operation. Multi-instance concurrency and centralized currency accounting require separate work beyond this single SQLite/server implementation.
