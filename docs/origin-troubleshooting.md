# Login reports `Origin not allowed`

This exact error is emitted by the API's source check **before password verification**. It is not evidence that a password is wrong. Resetting an account does not fix this error.

## Current Codespaces test deployment

The browser opens `https://stunning-chainsaw-7qqqqjq6px4crw4p-3001.app.github.dev/projects`. The running API's non-secret configuration must therefore contain:

```text
APP_ORIGIN=https://stunning-chainsaw-7qqqqjq6px4crw4p-3001.app.github.dev
PORT=3001
```

Use the origin (scheme, hostname and optional port), without `/projects`, any query or fragment. The local initializer writes `APP_ORIGIN=http://localhost:4173`, and the local Docker Compose example uses `http://localhost:3001`; neither matches the forwarded HTTPS page. Those defaults remain appropriate only for their documented local workflows.

The deployment operator should check the **actual API process/launcher environment**, change that one allowed origin and restart the same API process. An already exported `APP_ORIGIN` takes precedence over `.env`; editing the file alone will not replace an old exported value. Keep the same database and authentication settings, and keep AI disabled. Do not rerun setup/seed/reset, disclose credentials, restart an unrelated process or change port visibility to diagnose an origin mismatch.

`HOST` controls the server listen interface, not the browser's origin. The existing working listener may use `127.0.0.1` or `0.0.0.0` according to its forwarding setup. `NODE_ENV=production` requires an explicit HTTPS origin and sets Secure cookies. A mode change is not a substitute for correcting the origin. Vite `allowedHosts` is relevant only to a separate Vite development server; this compiled API serves the frontend on port 3001.

After loading the code update, the API prints its validated `Allowed browser origin` at startup. This diagnostic contains no credentials. A trailing slash/default port is canonicalized to browser-origin form; credentials, page paths, wildcard hosts, non-HTTP(S) schemes, query and fragment are rejected before opening the application database. Production still requires an explicit HTTPS origin.

## Credential-free verification

The deployment/browser worker can send an empty JSON login request with the actual browser origin:

```bash
curl -i -X POST \
  'https://stunning-chainsaw-7qqqqjq6px4crw4p-3001.app.github.dev/api/auth/login' \
  -H 'Origin: https://stunning-chainsaw-7qqqqjq6px4crw4p-3001.app.github.dev' \
  -H 'Content-Type: application/json' \
  --data '{}'
```

Expected: **400** input validation (`Please check the submitted values`), because origin passed and no credentials were supplied. **403 `Origin not allowed`** still indicates an origin mismatch. **429** means the existing login rate limit was reached; wait for its window rather than weakening it. Do not loop this probe. The user then submits their own credentials normally; agents do not inspect or enter them.

## Security retained and regression evidence

`trustProxy: false` stays in place. The allowed origin never comes from `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`, a browser payload or an `*.app.github.dev` wildcard. Internal proxy Host values may legitimately differ from the public browser origin. A matching origin does not replace authentication or CSRF: authenticated writes still require the session's `x-csrf-token`, and foreign origins remain rejected even with valid session/CSRF values.

`tests/integration/origin.test.ts` reproduces the screenshot error against a localhost-configured in-memory API, then verifies the exact public origin, an internal proxy Host, Secure/HttpOnly cookie flags, missing CSRF rejection, a valid authenticated write and hostile/null/different-scheme/lookalike origins with forged proxy headers. Tests use synthetic local injection only. They do not submit passwords to the live Codespace or control the user's browser.

## If local and forwarded requests differ despite the same configuration

The deployment worker reported that the same synthetic login request with the exact public Origin reached credential validation locally but returned `Origin not allowed` through the forwarded URL. This rules out treating a spelling correction as the confirmed fix for that instance. Community proxy reports are hypotheses, not evidence of the headers received by this API.

For a narrowly scoped diagnostic, the operator can temporarily set `ORIGIN_DIAGNOSTICS=1`, restart the API, and send one empty-JSON login request to each local/forwarded path with these headers:

```text
Origin: https://stunning-chainsaw-7qqqqjq6px4crw4p-3001.app.github.dev
Referer: https://stunning-chainsaw-7qqqqjq6px4crw4p-3001.app.github.dev/projects
Content-Type: application/json
X-PM-Origin-Probe: 1
```

Record only the JSON `origin-probe` log line from each request. The diagnostic is off by default and runs only for marked `POST /api/auth/login` requests. Its fixed allowlist includes normalized Origin, Host, Forwarded host/proto, X-Forwarded-Host/proto, Referer **origin only**, configured origin and a boolean for loopback peer. It excludes cookies, Authorization, all request bodies/passwords, full Referer paths/queries and forwarding IP addresses. Restore `ORIGIN_DIAGNOSTICS` to unset/0 and restart after capture. It does not change request acceptance or trust forwarded headers.

The diagnostic/configuration patch alone does not fix a proxy rewrite. Do not add localhost to a broad origin allowlist or enable general proxy trust. A compatibility change needs the observed local/forwarded metadata and a narrowly scoped browser-origin/CSRF policy review first.
