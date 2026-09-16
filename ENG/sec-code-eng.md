---
name: sec-code-eng
language: en
description: "Verifiable security guidance for web, mobile, desktop, APIs, and the software supply chain."
version: "2026.09"
last-reviewed: "2026-08-10"
guide-id: security
requires-gates:
  - threat-boundary
completion-evidence:
  - security-validation
---

# Security Guide for Web, Mobile, and Desktop Development

Practical secure-coding guidance for web, mobile (iOS/Android), and desktop
(Windows/macOS) development. Use this document to turn risks into testable
controls, evidence, and recorded decisions.

**Related documents**: for general code quality/structure, see
[`clean-code-eng.md`](./clean-code-eng.md). For testing frameworks and tools
(including SAST/DAST in the pipeline), see
[`test-code-eng.md`](./test-code-eng.md). For videos and HTML compositions,
see [HyperFrames](https://hyperframes.heygen.com) and treat scripts, assets,
and external URLs as attack surface. This file is the canonical security
reference; secrets, authorization, cryptography, and OWASP rules live here,
not in the other files.

**Tooling policy**: identify the stack, stage, and applicable checks; prefer an
already-available equivalent that produces compatible evidence. Ask for
authorization before installing a tool or changing the environment. If no
safe equivalent exists, record the required check as blocked and never claim
it passed. Do not install merely optional resources.

## General principles (valid for any platform)

- **Secure by design**: think about security during the design phase, not as a "review" at the end. Perform threat modeling for sensitive features (login, payment, file upload).
- **Least privilege**: users, processes, API keys, and database credentials must have only the permissions strictly necessary.
- **Defense in depth**: never rely on a single layer of protection (e.g., validation only on the frontend). Every critical validation/authorization decision must be enforced at a trusted boundary: a server-side or serverless service for remote authority, or a documented OS, process, or container boundary for local/offline authority.
- **Never trust the client**: data coming from the browser, mobile app, or desktop app can be manipulated. Authoritative decisions about remote authentication, authorization, price, or permission belong at a trusted service boundary. For local/offline authority, protect the documented OS/process/container boundary and protected local storage, Keychain, or credential vault with integrity, confidentiality, and capability checks. Input crossing either boundary remains untrusted; client-side checks are only defense in depth.
- **Fail secure / secure by default**: in case of an error or missing configuration, the system must deny access by default, never grant it.
- **Secrets never in source code**: API keys, passwords, tokens, and certificates belong in environment variables or secret management services (Vault, AWS Secrets Manager, Azure Key Vault, GCP Secret Manager) — never committed to git.
- **Compositions and media are inputs too**: validate generated HTML/JS, manifests, URLs, formats, sizes, and media origins; pin dependencies where possible and never embed secrets in a composition or video bundle.
- **Continuously update dependencies**: use automated scanners (Dependabot, Renovate, Snyk, `npm audit`, `pip-audit`, `bundler-audit`) and treat critical vulnerabilities as high-priority bugs.
- **Log security events, never sensitive data**: record login attempts, authorization failures, and permission changes; never log passwords, complete tokens, card numbers, or personal data in plain text.
- **Cryptography**: use a high-level library and a validated implementation;
  choose the algorithm, mode, key size, and parameters for the use case, and
  maintain an inventory and migration path. Never implement primitives or
  mistake an algorithm name for a security guarantee.

---

## Verifiable baseline: OWASP ASVS 5.0

- Adopt **OWASP ASVS 5.0.0 Level 1 (L1)** as the minimum baseline for web
  applications and APIs. Adopt **L2** for sensitive applications, including
  those handling material authentication, health, financial, regulated, or
  high-impact operations. L3 requires specialist analysis and is not inferred
  automatically.
- Use the OWASP Top 10 for awareness and risk prioritization, not as a
  sufficient verification checklist. Record the ASVS level, applicable
  requirements, exceptions, owner, evidence, and verification date.
- Cite requirements with the full version, for example
  `v5.0.0-1.2.4`; unversioned IDs can change. Do not claim conformance just
  because a scanner passed: every applicable requirement needs reproducible
  evidence, manual review, or a not-applicable rationale.
- For mobile, complement this baseline with MASVS/MASTG; ASVS still applies to
  the web backend and API controls used by the app.

### Minimum evidence map

| Control | Confirmed ASVS 5.0.0 references | Expected evidence |
| --- | --- | --- |
| Server-side validation and authorization | `v5.0.0-2.2.2`, `v5.0.0-8.3.1` | negative tests per operation and resource |
| Parameterized SQL | `v5.0.0-1.2.4` | test/review showing no input concatenation |
| Cookies and headers | chapters V3.3 and V3.4 | captured responses and browser tests |
| File upload | chapters V5.1 through V5.4 | valid, invalid, compressed, and malicious corpus |
| Session | chapters V7.2 through V7.4 | verified rotation, expiry, and invalidation |
| OAuth/OIDC and tokens | chapters V9 and V10 | signature, claim, replay, and redirect cases |
| Secrets and dependencies | chapters V13.3 and V15.1/V15.2 | scans, inventory, SBOM, and rotation trail |

---

## High-risk input contracts

### Outbound requests and SSRF

Before untrusted input may influence an outbound request, define and test this
contract (`v5.0.0-1.3.6`, `v5.0.0-13.2.4`,
`v5.0.0-15.3.2`):

- accept only required schemes, normally `https`; parse and canonicalize with
  a URL library, reject embedded credentials, fragments, and ambiguous syntax,
  and compare scheme, host, and port with an exact business-destination
  allowlist;
- resolve every A and AAAA record and reject any non-global result: private,
  loopback, link-local, multicast, reserved, and cloud metadata endpoints.
  Apply the same policy at the egress firewall/proxy;
- prevent **DNS rebinding**: validate every DNS answer immediately before the
  connection, connect only to the validated address, and preserve TLS
  validation of the expected hostname. Do not rely on textual domain
  validation alone;
- disable redirects by default. If required, cap the number of hops and repeat
  parsing, allowlisting, DNS resolution, and IP blocking for **every** target;
- do not forward internal cookies, tokens, or headers to the destination.
  Define connect and total timeouts, response-size, concurrency, retry, and
  bandwidth limits; fail closed and log the reason without secrets;
- test alternative URL syntax and IPv4/IPv6, redirects, DNS changes, internal
  destinations, `169.254.169.254`/metadata, and slow or oversized responses.

If the product genuinely needs arbitrary destinations, isolate the fetcher
without credentials, enforce an egress proxy, and use a special-address
denylist as an additional defense; never present a denylist as an allowlist
replacement.

### File upload, processing, and download

Every file flow must document types and limits before implementation and meet,
according to its level, ASVS 5.0.0 chapters V5.1 through V5.4:

- allow only necessary extensions and verify extension, signature (*magic
  bytes*), and content with a specialized parser; never trust the client-sent
  `Content-Type`;
- generate the name/ID on the server, retain the original name only as
  sanitized metadata, and never use user input to build paths;
- limit received bytes, dimensions/complexity, quantity per user, items in an
  archive, and **post-decompression limits** before extraction
  (`v5.0.0-5.1.1`, `v5.0.0-5.2.1` through `v5.0.0-5.2.3`);
- store files in a private service or outside the webroot, without execute
  permission and with a server-defined content type. Isolate parsers and
  converters;
- apply antivirus/sandboxing and CDR to compatible formats when risk requires
  it. Quarantine the file until a result arrives and define behavior on
  scanner timeout or failure;
- serve downloads only after authentication and per-object authorization,
  through a handler that maps an internal ID, with
  `Content-Disposition: attachment` and a sanitized name; never expose the
  real path or permit active execution;
- test double extensions, false MIME, path traversal, zip slip, symlinks, ZIP
  or XML bombs, polyglot files, unavailable parsers, and horizontal access.

---

## OWASP Top 10:2025 (Web) — overview and mitigation

1. **A01 – Broken Access Control (Broken access control)**: validate authorization on every route/endpoint, on the server, for every resource (including direct ID/IDOR). Never trust a `role` sent by the client. Apply deny-by-default.
2. **A02 – Security Misconfiguration**: remove default accounts/services, disable stack traces and detailed error messages in production, configure security headers (see HTTP section), and keep dev/staging/prod environments consistently hardened.
3. **A03 – Software Supply Chain Failures**: audit dependencies, use lockfiles (`package-lock.json`, `poetry.lock`), generate an SBOM (Software Bill of Materials), validate package integrity (checksums/signatures), and restrict CI/CD and publish-token permissions.
4. **A04 – Cryptographic Failures**: use modern HTTPS/TLS, calibrated password
   hashing, and AEAD through a high-level library; keep keys outside code and
   maintain a cryptographic inventory and migration plan.
5. **A05 – Injection**: use parameterized queries/ORMs (never concatenate SQL), validate and sanitize all input, escape output in templates (protection against XSS), and avoid `eval`/`exec` with external data.
6. **A06 – Insecure Design**: apply threat modeling, and review critical flows (password recovery, upload, payment) with a focus on abuse, not just the "happy path."
7. **A07 – Authentication Failures**: require MFA for sensitive accounts, apply rate limiting to login, block/delay after failed attempts, use session tokens with expiration and rotation, and never reveal whether the "user exists" in login error messages.
8. **A08 – Software or Data Integrity Failures**: validate update/package signatures, use CI/CD with protected pipelines (branch protection, commit signing), and never deserialize untrusted data without schema validation.
9. **A09 – Security Logging and Alerting Failures**: ensure security event logs (login, authorization failure, permission change) with automatic alerts for anomalies (multiple failures, access outside the usual pattern).
10. **A10 – Mishandling of Exceptional Conditions**: explicitly handle exceptions and resource limits (timeouts, quotas, payload/upload size limits), never expose a stack trace to the end user, and always "fail closed" on unexpected errors.

---

## Web — Backend by language/technology

### Node.js / JavaScript / TypeScript

- **Helmet** (Express) or equivalent middleware to configure security headers automatically.
- Input validation with **Zod**, **Joi**, or **Yup** — never trust `req.body` without a schema.
- ORMs with parameterized queries (**Prisma**, **Drizzle**, **TypeORM**) instead of manually concatenated SQL.
- `npm audit` / **Snyk** / **Socket.dev** for dependencies; beware of *supply chain attacks* through malicious npm packages/typosquatting.
- Never use `eval()`, `new Function()`, or `child_process.exec()` with unsanitized input.
- Rate limiting with **express-rate-limit** or at the gateway/CDN (Cloudflare, etc.).

### Python

- ORMs with parameterized queries (**Django ORM**, **SQLAlchemy**) — never `cursor.execute(f"...{var}...")`.
- Schema validation with **Pydantic** (FastAPI already uses it natively).
- `pip-audit` / **Safety** / **Bandit** (static SAST for Python) in CI.
- Django: keep `DEBUG = False` in production, keep `SECRET_KEY` outside the code, restrict `ALLOWED_HOSTS`, and use `django-csp` for Content-Security-Policy.
- Never use `pickle` to deserialize data from an untrusted source (arbitrary code execution).

### .NET / C\#

- Use **Entity Framework** with LINQ/parameters (never `SqlCommand` with string concatenation).
- **ASP.NET Core Identity** or **Duende IdentityServer**/**Microsoft.Identity.Web** for authentication/OAuth2/OIDC.
- Data Protection API for encrypting data at rest and tokens.
- `dotnet list package --vulnerable` to check for vulnerable dependencies; enable **NuGet Audit**.
- Configure `[ValidateAntiForgeryToken]` on forms; use `HttpOnly`/`Secure`/`SameSite` on session cookies.

### Java

- **Prepared Statements**/parameterized JPA (never `Statement` with concatenation).
- **Spring Security** for declarative authentication/authorization; **OWASP Dependency-Check** or **Snyk** integrated with Maven/Gradle.
- Avoid insecure deserialization of Java objects (`ObjectInputStream` from untrusted sources) — use JSON with a validated schema instead of Java binary serialization whenever possible.
- Disable external entity resolution in XML parsers (protection against XXE): `setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)`.

### PHP

- **PDO with prepared statements** (never `mysqli_query` with concatenation).
- Modern frameworks (Laravel, Symfony) already perform automatic escaping in templates (Blade/Twig) — avoid `{!! !!}`/`|raw` without sanitization.
- `composer audit` for vulnerable dependencies.
- Configure `session.cookie_httponly`, `session.cookie_secure`, `session.cookie_samesite` in `php.ini`.

### Ruby / Rails

- ActiveRecord with parameters (never `where("... #{var}")`).
- **Brakeman** (SAST specific to Rails) in CI.
- `bundler-audit` for vulnerable gems.
- Rails protects against CSRF by default (`protect_from_forgery`) — never disable it without a justified need.

### Go

- `database/sql` with parameters (`?`/`$1`) — never use `fmt.Sprintf` to build SQL.
- **govulncheck** to check for known vulnerabilities in dependencies and the stdlib.
- Use `context.Context` with a timeout in every external call to avoid resource exhaustion.

---

## Web — Frontend / Browser

- **XSS**: never insert unsanitized HTML through `innerHTML`,
  `dangerouslySetInnerHTML`, or `v-html` with user data. Modern frameworks
  escape by default; do not bypass that behavior without contextual
  sanitization by a maintained library.
- **CSRF**: use an anti-CSRF token for state-changing operations and validate
  `Origin`/`Referer` where applicable. `SameSite` helps but does not replace a
  CSRF control when the flow permits cross-site requests.
- **Clickjacking**: use CSP `frame-ancestors`. `X-Frame-Options: DENY` may
  remain for legacy clients, but is not the primary control
  (`v5.0.0-3.4.6`).
- **Subresource Integrity (SRI)**: use `integrity` and `crossorigin` for static,
  versioned CDN assets; prefer self-hosting when a resource changes without
  versioning.
- **Client-side storage**: do not store tokens or sensitive data in
  `localStorage`, `sessionStorage`, or IndexedDB when an `HttpOnly` session
  cookie satisfies the flow. Assume XSS can read all JavaScript-accessible
  storage.
- **Third parties**: every browser script, tag, widget, and SDK is part of the
  supply chain; minimize, inventory, pin versions, and review data flows.

### CSP rollout and reporting

Start with `Content-Security-Policy-Report-Only`, correct legitimate
violations, and only then promote the same tested policy to
`Content-Security-Policy`. Nonces must be random, unpredictable, and new for
every response; never copy the placeholder below literally. Rate-limit the
reporting endpoint and apply retention and redaction because payloads can
contain URL data.

```http
Reporting-Endpoints: csp="https://example.com/security/csp-reports"
Content-Security-Policy-Report-Only: default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'nonce-{RANDOM_PER_RESPONSE}'; report-to csp
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=()
```

`object-src 'none'` and `base-uri 'none'` are the minimum in
`v5.0.0-3.4.3`; fit `frame-ancestors`, `form-action`, `connect-src`,
`img-src`, `style-src`, and other directives to the architecture. Avoid
`unsafe-inline`, `unsafe-eval`, broad wildcards, and unnecessary hosts.
Collect and test reports, but do not treat `Report-Only` as enforcement.

### Exact-origin CORS

- Compare a canonicalized origin by the **scheme + host + port** tuple with an
  explicit allowlist (`v5.0.0-3.4.2`). Reject `Origin: null`, subdomain
  wildcards, and permissive regexes; `example.com.attacker.tld` is not part of
  `example.com`.
- If the response reflects an allowlisted origin, return exactly that origin
  and include `Vary: Origin` so caches do not share the wrong variant. Never
  reflect the header before the comparison.
- Use `Access-Control-Allow-Credentials: true` only for trusted origins with a
  documented need. `*` is only for a genuinely public response without
  credentials or sensitive data.
- Restrict methods and headers, validate preflight, and keep authentication and
  authorization at the endpoint: CORS is a browser policy, not access control
  against non-browser clients.

### Staged HSTS

Send HSTS only over HTTPS. Start in a controlled environment with a short
`max-age`, monitor failures, and gradually increase it to at least one year
(`v5.0.0-3.4.1`). Add `includeSubDomains` only after inventorying **every**
current and future subdomain and confirming valid HTTPS on each one.

```http
Strict-Transport-Security: max-age=300
```

The example is the initial stage and does not yet satisfy ASVS verification.
After a validated rollout, the L1 target is `max-age=31536000` or greater; at
L2+, the policy must also cover every subdomain.

Preload is an explicit L3 decision (`v5.0.0-3.7.4`) with impact that is hard
to reverse. Use `max-age=63072000; includeSubDomains; preload` only after the
inventory, domain-owner approval, a recovery plan, and compliance with the
preload-list requirements. Sending the directive does not submit the domain.

### Cookies and session lifecycle

Use `SameSite=Strict` or `Lax` by default. `SameSite=None` is an exception for
a documented cross-site flow and requires `Secure` plus compatible CSRF
protection. Prefer the `__Host-` prefix, which requires `Secure`, `Path=/`, and
no `Domain`; session tokens also use `HttpOnly` (`v5.0.0-3.3.1` through
`v5.0.0-3.3.4`).

```http
Set-Cookie: __Host-Session=<opaque>; Path=/; Secure; HttpOnly; SameSite=Lax
```

Generate opaque IDs with a CSPRNG, rotate them at login, reauthentication, and
privilege change, and invalidate the old value (`v5.0.0-7.2.3`,
`v5.0.0-7.2.4`). Define and enforce server-side **idle** and **absolute**
timeouts based on risk (`v5.0.0-7.3.1`, `v5.0.0-7.3.2`). Logout, expiry,
account disablement, and revocation must prevent reuse, not merely delete the
browser cookie.

---

## REST / GraphQL APIs / Identity

- **Authorization**: enforce RBAC/ABAC in the backend for every operation,
  object, and field; deny by default and test horizontal and vertical access.
  Hiding buttons is not authorization.
- **Rate limits and schemas**: limit by user, credential, and operation, not
  only by IP; validate payloads against OpenAPI/JSON Schema and impose size,
  depth, pagination, and time limits.
- **Service-to-service communication**: use workload identities, short-lived
  tokens, or least-privilege certificates. Avoid shared static credentials
  (`v5.0.0-13.2.1`). Use mTLS or message signing when the risk analysis
  requires it.

### OAuth 2.0 and OpenID Connect

- Use **Authorization Code + PKCE** with `S256` for public and confidential
  clients. Bind `code_verifier`, `state`, and, for OIDC, `nonce` to the
  initiating transaction and session; each value is unpredictable and
  single-use (`v5.0.0-10.1.2`, `v5.0.0-10.2.1`,
  `v5.0.0-10.5.1`).
- Compare redirect URIs with the registered allowlist by exact string; do not
  use wildcards, prefixes, or open redirectors (`v5.0.0-10.4.1`). Validate the
  expected issuer and protect multi-issuer clients against mix-up.
- At the authorization server, issue short-lived, single-use authorization
  codes. Reject a second exchange of the same code and revoke tokens already
  issued from it; limit lifetime to at most 10 minutes at L1/L2 and 1 minute at
  L3 (`v5.0.0-10.4.2`, `v5.0.0-10.4.3`).
- Authenticate every confidential client on backchannel requests to the
  authorization server, including the token endpoint, PAR, and revocation
  (`v5.0.0-10.4.10`, L2). PKCE binds the transaction to the `code_verifier`,
  but it **does not replace** confidential-client authentication.
- Identify and link an OIDC account only by the stable (`iss`, `sub`) pair;
  validate that `sub` is valid in that issuer's context. Never use email or an
  isolated `sub` as an identity key across issuers (`v5.0.0-10.5.2`, L2).
- Do not use the implicit grant (`response_type=token`) or Resource Owner
  Password Credentials/password grant. Tokens leave through the token
  endpoint, never through a front-channel URL. Restrict scopes and audiences
  to the minimum required.

### JWTs, revocation, and refresh tokens

- Allowlist algorithms per context and reject `none`; prefer only symmetric
  **or** only asymmetric algorithms in each context. If both are unavoidable,
  explicitly separate keys, configuration, and validation paths to prevent
  key/algorithm confusion (`v5.0.0-9.1.2`).
- Bind every key to exactly one allowed algorithm and confirm that the received
  `alg` matches the operation performed. Validate the signature/MAC before
  claims and obtain keys only from trusted issuer configuration; headers such
  as `jku`, `x5u`, and `jwk` must not select an arbitrary source or key
  (`v5.0.0-9.1.1` through `v5.0.0-9.1.3`; RFC 8725 §3.1).
- Validate token type and purpose, `iss`, `aud`, `exp`, and `nbf`, with minimal,
  explicit clock skew (`v5.0.0-9.2.1` through `v5.0.0-9.2.3`). Do not use an
  ID Token as an access token.
- For replay-sensitive operations, validate a unique identifier/`jti` and use
  state, or adopt sender-constrained tokens (mTLS/DPoP). Short expiration
  reduces the window but does not detect replay by itself.
- Plan revocation: reference tokens can use **token introspection**;
  self-contained JWTs require a denylist, a per-user key/version, or a cutoff
  timestamp. On logout, incident, or loss of authorization, invalidate the
  corresponding state (`v5.0.0-7.4.1`).
- Refresh tokens are rotated and protected like credentials. On every
  exchange, invalidate the previous one; reuse of an already rotated token
  revokes the family, terminates the session, and raises an alert. For public
  clients, use rotation or sender constraint as required by RFC 9700.

### GraphQL

Enforce authorization at every resolver/operation/field, validate input,
limit depth, quantity, batching, and cost (`v5.0.0-4.3.1`), and apply timeouts
and rate limits. Disabling or restricting **introspection** can reduce schema
exposure where it is not public (`v5.0.0-4.3.2`), but it is optional hardening
only: it replaces neither authorization nor anti-abuse controls, and fields
can still be guessed. Keep it when the public contract requires it and protect
data independently of that choice.

---

## Database

- Always use **parameterized queries/prepared statements** — never concatenate strings with user input (protection against SQL Injection).
- **Least privilege**: the application user in the database must not have `DROP`/`ALTER` permission or access to unused schemas; the migration user is separate from the runtime user.
- **Encryption at rest** for sensitive data (PII, payment data) through native database encryption (TDE) or at the column/field level.
- **Encrypted backups** tested periodically (restore drill).
- **Connection secrets** (connection string, password) outside the code, through a secret manager or an environment variable injected at runtime.
- Audit access to sensitive tables (logs of who accessed customer data).

---

## Cryptography and passwords

- **Passwords**: use **Argon2id** first and calibrate memory, iterations, and
  parallelism on production hardware to retain defensive cost without causing
  DoS. If unavailable, use scrypt; keep bcrypt for legacy only, accounting for
  its input limit; use PBKDF2 when FIPS requires it. Store the algorithm and
  parameters with the hash and rehash after authentication when policy evolves
  (`v5.0.0-11.4.2`).
- **Data at rest**: prefer AEAD, such as AES-GCM or
  **ChaCha20-Poly1305**, through a high-level API. Never reuse a nonce with the
  same key; authenticate relevant metadata as AAD and fail closed on tag
  failure. Do not use ECB, unauthenticated encryption, or keys derived by a
  fast hash (`v5.0.0-11.3.1` through `v5.0.0-11.3.3`). Specific evidence of
  nonce generation and uniqueness is L3 (`v5.0.0-11.3.4`).
- **Keys**: generate with a CSPRNG, separate by environment and purpose, store
  in an appropriate KMS/HSM/Keystore, restrict access, and document generation,
  activation, rotation, revocation, backup, and destruction. Never log a key
  or plaintext.
- **Algorithm agility**: maintain an inventory of algorithms, keys, and
  certificates, a versioned format, and a tested path to change algorithms,
  parameters, and keys and to re-encrypt data (`v5.0.0-11.1.2`,
  `v5.0.0-11.2.1`, `v5.0.0-11.2.2`). Agility does not mean accepting an
  attacker-selected algorithm.

---

## Infrastructure, DevOps, and CI/CD

### Secrets and workload identities

- Centralize secrets in an appropriate service; separate
  dev/test/staging/prod, enforce least privilege, and prefer workload
  identities, OIDC federation, certificates, or short-lived dynamic
  credentials to static keys (`v5.0.0-13.2.1`, `v5.0.0-13.3.1`).
- Run secret scanning in the IDE or **pre-commit**, block in CI/PR, and
  periodically scan all Git history, artifacts, images, and logs. Use
  recognizable fake values in examples and tests; do not rely only on regexes
  or log redaction.
- Track the owner, consumers, environment, purpose, expiry, and rotation
  schedule. Audit reads, changes, failures, and anomalous use without logging
  the value; test rotation and revocation without downtime.
- On exposure, treat it as an incident: contain, **revoke first**, rotate every
  dependent, investigate logs/artifacts/clones, notify owners, and document the
  cause. Deleting the file or making another commit does not invalidate the
  secret.
- Remove a value from Git history only after revocation and coordinated impact
  analysis; rewriting affects SHAs, branches, forks, and clones and requires
  communication plus reintroduction prevention. Treat the secret as
  compromised even after cleanup.

### Supply chain and promotion

- Use lockfiles and allowlisted, trusted registries/proxies. Reserve internal
  namespaces and names, configure explicit scopes, and verify the origin of
  direct and transitive dependencies to prevent **dependency confusion**
  (`v5.0.0-15.1.2`, `v5.0.0-15.2.4`).
- Pin GitHub Actions and reusable workflows to a full commit; pin plugins and
  tools to an immutable version or verified digest as supported by their
  ecosystem, and pin images/artifacts by digest. Mutable tags and branches are
  not identity evidence. Automate update proposals, but require review and run
  with a minimal token.
- Generate SBOMs and provenance/attestations in the isolated builder; sign when
  applicable and verify builder identity, source, commit, and digest before
  deployment. A checksum from the same compromised channel is insufficient.
- Build once and promote the **same immutable artifact** between environments;
  do not rebuild for production. Record approvals and associate release, SBOM,
  attestation, tests, and configuration with the digest.
- Roll out gradually (canary/percentage), monitor technical and security
  signals, provide automatic abort, and roll back to a previously verified
  digest. Never “fix” production by modifying the running artifact.

### Pipeline verification

- Integrate SAST, SCA, secret scanning, IaC scanning, container scanning, and
  DAST according to the architecture; critical failures block merge/deploy or
  receive a time-bound exception with an owner and documented risk.
- Use ephemeral runners, branch protection, mandatory workflow review, minimum
  permissions, and approved environments. Do not expose production secrets to
  untrusted pull-request builds.
- Base images must be minimal, must not run as `root`, and must be rebuilt in a
  controlled way when fixes arrive; verify signature/attestation at
  admission/deploy, not only during the build.

---

## Mobile — OWASP Mobile Top 10:2024 and best practices

1. **M1 – Improper Credential Usage**: never hardcode API keys/secrets in the app binary (they can be extracted through reverse engineering); use the backend as a proxy for calls that require a secret.
2. **M2 – Inadequate Supply Chain Security**: audit third-party SDKs (analytics, ads) for permissions and collected data; pin dependency versions (lockfiles).
3. **M3 – Insecure Authentication/Authorization**: for remote or service-backed features, every authorization decision belongs at the backend/trusted service boundary; for local/offline authority, enforce the documented OS/process/container capability boundary. Use tokens with short expiration; biometrics (Face ID/Touch ID, BiometricPrompt) only as a *convenience* for accessing an already protected secret, never as the sole authentication factor for a backend.
4. **M4 – Insufficient Input/Output Validation**: validate all input (deep links, intents, forms) in the app and again at the applicable trusted service or local boundary.
5. **M5 – Insecure Communication**: HTTPS is mandatory (App Transport Security
   on iOS, `usesCleartextTraffic=false` on Android); use platform TLS
   validation. Pinning requires a threat model and operational plan.
6. **M6 – Inadequate Privacy Controls**: request only the necessary permissions (camera, location, contacts), explain the reason (App Tracking Transparency on iOS), and minimize personal-data collection.
7. **M7 – Insufficient Binary Protections**: code obfuscation (ProGuard/R8 on Android, symbol obfuscation on iOS), jailbreak/root detection for sensitive apps, and binary integrity verification.
8. **M8 – Security Misconfiguration**: disable debug/verbose logs in production builds, and remove test/staging endpoints from the published app.
9. **M9 – Insecure Data Storage**: never save sensitive data in plaintext in
   `SharedPreferences`, `UserDefaults`, or flat files; use **Keychain** on iOS
   and keys in the **Android Keystore**, with storage encryption appropriate
   for the data.
10. **M10 – Insufficient Cryptography**: use native cryptographic APIs or a
    maintained high-level library with authenticated encryption; never
    implement a cipher.

### iOS — specific

- **Keychain Services** for tokens, passwords, and keys — never `UserDefaults` for sensitive data.
- **App Transport Security (ATS)** enabled (blocks insecure HTTP by default); exceptions only with documented justification.
- Prefer platform TLS validation; adopt pinning only after threat modeling,
  with backup pins, expiry, telemetry, and tested recovery.
- Review `Info.plist` permissions (`NSCameraUsageDescription`, etc.) — request only what is necessary, with a clear description for the user.
- Use **Data Protection** (`NSFileProtectionComplete`) for sensitive files on disk.

### Android — specific

- Use the **Android Keystore System** to generate and retain non-exportable
  keys, hardware/StrongBox-backed where available and necessary. Encrypt data
  with AEAD and store only ciphertext in a file/database; Keystore stores the
  key, not arbitrary data.
- Prefer platform TLS and Certificate Transparency. Android does not recommend
  certificate pinning by default; use it only when the threat model outweighs
  outage risk, with multiple backup pins (at least one under your control), a
  short expiration, telemetry, recovery, and tested updates. Never implement a
  `TrustManager` that accepts every certificate.
- `EncryptedSharedPreferences` is deprecated. Retain it only during
  legacy/migration work with a removal plan and verified backup rules; do not
  recommend it for new code and never put secrets in plain
  `SharedPreferences`.
- Use **Network Security Config** for cleartext policy and trusted CAs.
  Certificate Transparency is unavailable through API 35; it is opt-in on API
  36 and enabled by default on API 37+, unless an exception is configured. Set
  pins only when exceptionally approved.
- **ProGuard/R8** for obfuscation and removal of unused code in release builds.
- Be careful with **implicit Intents** and **Deep Links** — validate the origin and sanitize data received through `Intent`/`Deep Link`; never trust them as a secure source.
- `android:exported="false"` on components (Activities/Services/Receivers) that do not need to be accessed by other apps.
- Check **runtime permissions** with the minimum necessary and an explanation for the user.

---

## Desktop — Windows and macOS

### Windows

- **DPAPI (Data Protection API)** or **Windows Credential Manager** to store local secrets (never in plain-text configuration files).
- **Code signing** with a valid certificate — unsigned builds trigger SmartScreen/Defender alerts.
- Run with the lowest possible privilege; avoid requiring administrator elevation unless strictly necessary (UAC).
- Validate update integrity (digital signature) before applying updates — never download/execute a binary without verification.
- Sandboxing where possible (**AppContainer**, MSIX with restricted capabilities).

### macOS

- **Keychain Services** (the same conceptual API as iOS) to store credentials and keys.
- **Apple notarization** and **code signing (codesign)** required for distribution outside the App Store without triggering Gatekeeper blocking.
- **App Sandbox** and **Hardened Runtime** enabled, requesting only the necessary *entitlements* (network, camera, file access).
- Never disable **App Transport Security**/TLS validation to "make" production debugging easier.
- Validate the integrity of auto-updates (e.g., **Sparkle** framework) with an EdDSA signature before installing.

### Common rules (Windows + macOS)

- Never store passwords, tokens, or API keys in plain-text configuration files (`.ini`, `.json`, `.xml`) in the user directory — use the OS's native credential vault.
- Every auto-update channel must use HTTPS + package signature verification before installation.
- Minimize permissions requested from the OS (file, network, automation access) and explain the reason to the user.
- Treat the user's machine as an untrusted environment: any secret embedded in the binary can be extracted by a user with local privileges.

---

## Cross-cutting: Hybrid and cross-platform apps (Electron, React Native, Flutter, .NET MAUI)

- **Electron**: keep `nodeIntegration: false` and `contextIsolation: true` in `BrowserWindow`; use `preload` scripts with explicitly exposed APIs (`contextBridge`); update Electron/Chromium frequently (browser vulnerabilities affect the entire app).
- **React Native**: follow the same secure-storage rules as native mobile (use `react-native-keychain`, not plain `AsyncStorage` for secrets); validate deep links.
- **Flutter**: use `flutter_secure_storage` (which uses Keychain/Keystore underneath) instead of `shared_preferences` for sensitive data.
- In all cases: sensitive business logic and API secrets must never live only on the client. Remote or service-backed authority requires a trusted server-side or serverless enforcement boundary; local/offline authority requires the documented OS/process/container boundary, protected local storage/Keychain/credential vault, and integrity, confidentiality, and capability controls.

---

## Instruction template for inclusion in CLAUDE.md / AGENTS.md

```
## Security

- Web/API baseline: OWASP ASVS 5.0.0 L1; use L2 for sensitive applications.
  Record the requirement, evidence, and exception, not only a scanner result.
- Never commit secrets (keys, passwords, tokens, certificates). Use a secret
  manager and short-lived identity. Scan pre-commit, CI, and history.
- All client and externally supplied input is untrusted: validate and sanitize
  it at the trusted service boundary or, for local/offline paths, at the
  documented OS/process/container/storage boundary, even if the frontend/app
  already validated it.
- Every outbound URL uses an exact allowlist, blocks non-global/metadata
  networks and DNS rebinding, and revalidates redirects; set timeouts/limits.
- Uploads use generated names, validate type/content and post-decompression
  size, stay outside the webroot, and are downloaded only after authorization.
- Every database query uses parameters/prepared statements or an ORM.
  Never concatenate SQL strings.
- Enforce every authorization decision at the appropriate trusted boundary: a
  service boundary for remote authority or a documented OS/process/container
  capability boundary for local/offline authority. Never trust
  roles/permissions sent by the client.
- Passwords: calibrated Argon2id; scrypt fallback, bcrypt legacy, PBKDF2/FIPS.
  Data: AEAD AES-GCM/ChaCha20-Poly1305 through a high-level library.
- Cookies: __Host- + Path=/ + HttpOnly + Secure + SameSite=Lax/Strict;
  document SameSite=None. Apply idle/absolute timeouts and rotation.
- Deploy CSP through Report-Only/reporting. Stage HSTS; never enable
  includeSubDomains/preload without an inventory and explicit decision.
- OAuth/OIDC: Authorization Code + PKCE S256, state, nonce, exact redirect;
  short/single-use code and confidential-client authentication. PKCE does not
  replace it; OIDC accounts use (iss, sub), never email or isolated sub.
- JWT: one symmetric or asymmetric family per context; every key belongs to
  one algorithm. Separate keys/config/paths if both are unavoidable.
- Dependencies: run vulnerability audits (npm audit, pip-audit,
  govulncheck, dotnet list package --vulnerable) and resolve high-severity
  issues; pin actions by commit and plugins/artifacts by an immutable version
  or verified digest.
- Mobile: sensitive data only in Keychain (iOS) or encrypted with a key in
  Keystore (Android). EncryptedSharedPreferences is legacy/migration only.
- Desktop: secrets only in the OS's native credential vault (DPAPI/Credential
  Manager on Windows, Keychain on macOS). Never in a flat config file.
- Logs never contain passwords, complete tokens, card data, or PII in
  plain text.
- Every new feature that handles sensitive data (login, payment,
  upload, permissions) receives a threat review before implementation.
```

---

## Security Review Checklist

- [ ] Scope, ASVS 5.0.0 level (L1 or L2), exceptions, and evidence are
  recorded; the Top 10 was not used as a replacement checklist.
- [ ] Untrusted input is validated and authorization is enforced at the
  appropriate trusted boundary: a server/service for remote or service-backed
  authority, or the documented OS/process/container/storage boundary for
  local/offline authority; SQL is parameterized (`v5.0.0-2.2.2`,
  `v5.0.0-8.3.1`, `v5.0.0-1.2.4`).
- [ ] SSRF cases cover allowlists, non-global/metadata IPs, DNS rebinding,
  redirects, timeouts, and limits (`v5.0.0-1.3.6`).
- [ ] Uploads cover generated names, type/content, post-decompression limits,
  private storage, applicable AV/CDR, and authorized download (ASVS 5.0.0,
  V5.1–V5.4).
- [ ] CSP passed through `Report-Only`, CORS matches an exact origin and sends
  `Vary: Origin`, and HSTS shipped without automatic preload (ASVS 5.0.0,
  V3.4).
- [ ] The `__Host-` cookie and session lifecycle were tested for SameSite,
  rotation, idle/absolute timeout, logout, and revocation (ASVS 5.0.0, V3.3
  and V7).
- [ ] OAuth/OIDC uses Code + PKCE, `state`, `nonce`, and exact redirects; JWTs
  and refresh tokens have validation, replay, rotation, and revocation tests.
  Short/single-use codes, confidential-client backchannel authentication, and
  (`iss`, `sub`) OIDC accounts are verified (ASVS 5.0.0, V9/V10).
- [ ] JWT separates symmetric/asymmetric algorithms by context and binds each
  key to one algorithm; any exception separates keys, configuration, and
  paths (`v5.0.0-9.1.1` through `v5.0.0-9.1.3`).
- [ ] Secret scanning covers pre-commit, CI, and history; exposure has a
  revocation, rotation, audit, and Git remediation playbook (ASVS 5.0.0,
  V13.3).
- [ ] Dependencies come from a trusted registry; actions use full commits,
  plugins/artifacts use an immutable version or verified digest, provenance is
  verified, and dependency confusion is tested.
- [ ] Passwords use Argon2id/scrypt or a documented exception; data uses AEAD,
  and there is a cryptographic inventory/agility plan (ASVS 5.0.0, V11).
- [ ] Android uses Keystore and platform TLS; any pinning has a threat model,
  backups, expiration, telemetry, and recovery. Legacy
  `EncryptedSharedPreferences` has a migration.
- [ ] GraphQL enforces authorization and anti-abuse independently of
  introspection (`v5.0.0-4.3.1`, `v5.0.0-4.3.2`).
- [ ] Logs and alerts prove security events without exposing secrets or PII;
  code, dependency, IaC, image, and runtime scans have a failure policy.

---

## Sources and References

- OWASP ASVS 5.0.0: https://owasp.org/projects/asvs
- Official OWASP ASVS 5.0.0 CSV: https://github.com/OWASP/ASVS/raw/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv
- OWASP Top 10:2025 (Web): https://owasp.org/Top10/2025/
- OWASP Mobile Top 10:2024: https://owasp.org/www-project-mobile-top-10/
- OWASP Mobile Application Security Verification Standard (MASVS) / MASTG: https://owasp.org/projects/mobile-application-security
- OWASP Cheat Sheet Series: https://cheatsheetseries.owasp.org/
- OWASP SSRF Prevention: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP File Upload: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- OWASP Content Security Policy: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
- OWASP HTTP Strict Transport Security: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html
- OWASP HTTP Headers: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
- OWASP Session Management: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP Password Storage: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Cryptographic Storage: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- OWASP OAuth2: https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html
- OWASP GraphQL: https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html
- OWASP Secrets Management: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- OWASP Software Supply Chain Security: https://cheatsheetseries.owasp.org/cheatsheets/Software_Supply_Chain_Security_Cheat_Sheet.html
- OWASP GitHub Actions Security: https://cheatsheetseries.owasp.org/cheatsheets/GitHub_Actions_Security_Cheat_Sheet.html
- Android TLS and certificate pinning: https://developer.android.com/privacy-and-security/security-ssl
- Android Network Security Config and Certificate Transparency: https://developer.android.com/privacy-and-security/security-config
- Android cryptography and Keystore: https://developer.android.com/privacy-and-security/cryptography
- Android `EncryptedSharedPreferences` (deprecated): https://developer.android.com/reference/androidx/security/crypto/EncryptedSharedPreferences
- OAuth 2.0 Security Best Current Practice, RFC 9700: https://www.rfc-editor.org/rfc/rfc9700
- JWT Best Current Practices, RFC 8725: https://www.rfc-editor.org/rfc/rfc8725
- Web Origin, RFC 6454: https://www.rfc-editor.org/rfc/rfc6454
- OAuth 2.0 Token Introspection, RFC 7662: https://www.rfc-editor.org/rfc/rfc7662
- ChaCha20-Poly1305, RFC 8439: https://www.rfc-editor.org/rfc/rfc8439
- GitHub Actions: use full-length commit SHA: https://docs.github.com/en/actions/reference/security/secure-use
- GitHub artifact attestations: https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations
- Apple Platform Security Guide: https://support.apple.com/guide/security/
- Microsoft Security Development Lifecycle (SDL): https://www.microsoft.com/sdl
