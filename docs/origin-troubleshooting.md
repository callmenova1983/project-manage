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
  -H 'Referer: https://stunning-chainsaw-7qqqqjq6px4crw4p-3001.app.github.dev/projects' \
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

## 已确认的 Codespaces Origin 重写与窄兼容

现场同一空请求的服务端诊断证据：直接请求回环地址时，Origin 保持公网 HTTPS 来源；经 Codespaces 公网端口转发时，Origin 被重写成 `http://localhost:3001`、Host 为 `localhost:3001`，X-Forwarded-Host 保留公网主机、X-Forwarded-Proto 为 `https`，Referer 保留公网来源，连接对端为回环地址。该故障发生在密码校验前，不能通过改密码解决。

只有确认实例属于上述模式时，才在 API 的实际启动环境设置：

```dotenv
CODESPACES_ORIGIN_REWRITE=1
ORIGIN_DIAGNOSTICS=0
```

其余配置保持：`NODE_ENV=production`、精确的 HTTPS `APP_ORIGIN`、`HOST=127.0.0.1` 和实际 `PORT=3001`。平台提供的 `CODESPACES=true`、`CODESPACE_NAME` 必须存在且与 `https://<CODESPACE_NAME>-<PORT>.app.github.dev` 完全匹配；错误配置会拒绝启动。不要打印完整环境或任何密码、Cookie、Token。变更环境后重启 API。

此开关默认关闭。兼容分支同时要求：

- 回环 TCP 对端；Origin 和 Host 分别精确匹配 `http://localhost:<PORT>` 与 `localhost:<PORT>`。
- X-Forwarded-Host 精确匹配配置的公网主机，X-Forwarded-Proto 仅为 `https`，不接受逗号拼接和另一个 Forwarded 头。
- 浏览器 Referer 必须存在且来源精确等于 `APP_ORIGIN`，不能包含 URL 用户信息；存在的 Sec-Fetch-Site 必须为 `same-origin`。

开启兼容时响应头设为 `Referrer-Policy: same-origin`，让真实浏览器向本站 API 保留必要的 Referer，而不向其他站点发送；不开启时仍是 `no-referrer`。部署后必须刷新正式登录页，旧页面可能仍保留之前的响应策略。

不会单独信任可伪造的转发头，不开启全局 `trustProxy`，不允许其他 localhost 来源或通配域名。恶意或缺失 Referer、跨站请求和远程直连不进入兼容分支。原本精确匹配的 Origin 继续有效；提供的恶意 Referer 也会被拒绝。认证后的写入仍要求会话、CSRF、版本与幂等键。此配置面向受控 Codespace 的回环代理，不为同机不可信进程提供身份隔离；不要搬到任意反向代理或开放监听环境。

部署后可用原文档中的**无凭证空请求**再次比较本机与公网返回，预期不再得到 `Origin not allowed`，而进入相同的请求格式/账号校验结果。不要让诊断日志长期打开，不要把真实密码发给协作者或诊断工具。真实账号登录由用户自行在正式入口完成。

`node scripts/smoke-codespaces.mjs` 用实际 Chromium、编译产物及内存 API 重放已观察到的代理改写，并验证浏览器真实发送的 Origin/Referer、Secure 会话、CSRF 保存和刷新。所有请求都由隔离拦截器转交本地 API，虚构域名不访问网络，随机测试密码仅存在于内存；该结果不是实际公网部署验收。
