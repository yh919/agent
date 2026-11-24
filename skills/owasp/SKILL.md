---
name: owasp
description: Systematic OWASP Top 10 (2021) audit playbook — coordinate comprehensive testing across A01 Broken Access Control through A10 SSRF, tracking endpoint/parameter coverage with the coverage tool and routing to specialized playbooks. Use when tasked with a full security audit, OWASP assessment, or comprehensive vulnerability scan against an in-scope target.
allowed-tools:
  - http
  - shell
  - file_write
  - load_skill
  - coverage
  - web_search
  - web_fetch
---

# OWASP Top 10 Security Audit Playbook

You are conducting a systematic vulnerability assessment of an in-scope web application or API against the **OWASP Top 10 (2021)** standard.

> **Scope & Rules of Engagement:**
> - Only test systems within authorized scope.
> - Work methodically across endpoints and parameters rather than jumping randomly between bugs.
> - Maintain active coverage tracking with the `coverage` tool so every tested surface is recorded.
> - Every finding must have concrete, reproducible proof-of-concept evidence before calling `confirm_finding`.

Execution rule: Use real target URLs, parameter names, and session tokens from the active engagement. Never write literal placeholders such as `<TARGET>` or `<SESSION>` to files.

---

## 1. Audit Strategy: Coverage-Driven Testing

To guarantee comprehensive assessment without looping or missing attack surface:

1. **Query Untested Combinations:**
   Before running a test battery, query what combinations remain untested:
   ```json
   coverage(action="untested", candidates=[{"endpoint":"POST /api/upload","param":"file"}], vuln_classes=["A01-BAC", "A03-Injection", "A06-VulnComponents"])
   ```
2. **Mark Every Probe:**
   After testing an endpoint/parameter combination, record the outcome immediately:
   ```json
   coverage(action="mark", endpoint="POST /api/upload", param="file", vulnClass="A03-Injection", status="passed|failed|waf-blocked|skipped")
   ```
3. **Route to Specialized Playbooks:**
   When an endpoint matches a specific vulnerability class, call `load_skill` to bring in deep-dive methodology:
   - File uploads / media converters → `load_skill(name="upload2shell")`
   - Template parameters → `load_skill(name="ssti")`
   - URL/webhook parameters → `load_skill(name="ssrf")`
   - JWT tokens → `load_skill(name="jwt")`
   - Race conditions / limit overruns → `load_skill(name="race")`
   - Serialized blobs → `load_skill(name="deserialize")`
   - GraphQL endpoints → `load_skill(name="graphql")`
   - Supabase / PostgREST APIs → `load_skill(name="supabase")`
   - Subdomain / DNS records → `load_skill(name="takeover")`

---

## 2. OWASP Top 10 Audit Checklist (A01 – A10)

### A01: Broken Access Control
- **IDOR / BOLA:** Test every endpoint taking an object identifier (`/api/users/{id}`, `/documents/{doc_id}`). Replay requests using a second authenticated context (User A attempting to access User B's resource).
- **Broken Function Level Authorization (BFLA):** Test administrative actions (`/admin/*`, `/api/manage/*`, `PUT /api/users/{id}/role`) using standard low-privilege tokens.
- **JWT Tampering:** If authentication relies on JWTs, call `load_skill(name="jwt")` to test `alg=none`, signature stripping, and key confusion.
- **Mass Assignment:** Submit extra fields (`isAdmin`, `role`, `verified`, `balance`) on creation and update endpoints.

### A02: Cryptographic Failures
- **Transmission Security:** Check for missing HTTPS, mixed content, or sensitive endpoints accessible over unencrypted HTTP.
- **Exposed Sensitive Data:** Check responses, client-side JavaScript bundles, and repository files for hardcoded API keys, JWT signing secrets, database credentials, or plaintext PII.
- **Cookie Security:** Verify that session cookies include `Secure`, `HttpOnly`, and appropriate `SameSite` flags.

### A03: Injection
- **SQL Injection:** Inject basic syntax probes (`'`, `"`, `1' OR '1'='1`, `sleep(5)`) into query parameters, JSON bodies, and HTTP headers. Check for error messages, boolean differential behavior, and time delays.
- **Server-Side Template Injection (SSTI):** If user input is reflected in HTML or emails, probe with `${7*7}` and `{{7*7}}`. If evaluated to `49`, call `load_skill(name="ssti")`.
- **Command Injection:** Test input fields passed to shell executors with benign delimiters (`; id`, `| id`, `$(id)`).
- **File Upload / Upload-to-Shell:** If the application accepts file uploads (avatars, attachments, media, documents), call `load_skill(name="upload2shell")` to test extension filter bypasses, MIME confusion, path traversal, and media converter flaws.

### A04: Insecure Design & Concurrency
- **Business Logic Flaws:** Test multi-step business workflows (e.g. order submission before payment, negative quantity purchase, skipping verification steps).
- **Race Conditions / TOCTOU:** For one-time actions (coupon redemption, balance transfers, gift card claiming, votes), call `load_skill(name="race")` to test parallel execution.
- **Rate Limiting:** Probe login, password reset, and OTP verification endpoints for missing rate limits.

### A05: Security Misconfiguration
- **Exposed Endpoints & Files:** Check for accessible administrative panels, `/actuator`, `/_debug`, `/.git/`, `/.env`, and directory listings.
- **CORS Misconfiguration:** Test if `Origin: https://evil.com` is reflected with `Access-Control-Allow-Credentials: true`.
- **Verbose Error Messages:** Check if 500 errors disclose stack traces, framework versions, or internal file paths.
- **Subdomain Takeovers:** If dangling DNS records (CNAME/NS) point to unclaimed cloud services, call `load_skill(name="takeover")`.

### A06: Vulnerable and Outdated Components
- **Dependency & Banner Fingerprinting:** Identify technologies and versions from `Server`, `X-Powered-By`, cookie names, and script bundles.
- **Known CVEs:** Search for published advisories against detected software versions (`web_search "<product> <version> CVE"`).
- **Transitive Parsers:** Check backend document, PDF, and image libraries for known vulnerabilities (e.g., Ghostscript CVE-2026-125396, ImageMagick delegates).

### A07: Identification and Authentication Failures
- **Credential Stuffing / Brute Force:** Check for missing account lockout or IP throttling on authentication endpoints.
- **Broken Password Reset:** Test for token predictability, token leakage in URLs/referrers, or Host header poisoning in password reset emails.
- **Session Management:** Verify that sessions are destroyed on logout and regenerated upon privilege changes (preventing session fixation).

### A08: Software and Data Integrity Failures
- **Insecure Deserialization:** If the target processes serialized objects (Java `rO0...`, Python `gASV...`, PHP `O:8:...`, .NET ViewState), call `load_skill(name="deserialize")`.
- **Integrity Validation:** Check whether client updates, plugins, or third-party libraries lack cryptographic verification or SRI (Subresource Integrity) hashes.

### A09: Security Logging and Monitoring Failures
- **Audit Trails:** Verify whether sensitive administrative actions (user deletion, role escalation, password changes) generate audit records.
- **Log Injection:** Test if unescaped CRLF characters (`\r\n`) in headers or user input allow forging fake log entries.

### A10: Server-Side Request Forgery (SSRF)
- **URL Fetching Surfaces:** Check webhooks, URL preview features, image import by URL, and PDF generation endpoints.
- **Cloud Metadata & Internal Pivots:** Test requests targeting cloud metadata (`169.254.169.254`, `metadata.google.internal`) or loopback services (`127.0.0.1`).
- **Specialized Playbook:** If URL parameters exist, call `load_skill(name="ssrf")`.

---

## 3. Findings & Evidence Capture

When a vulnerability is verified:
1. Re-run the minimum curl command that reproduces the issue.
2. Note the affected OWASP Category (`A01:2021` through `A10:2021`) and Bugcrowd VRT severity.
3. Call `confirm_finding`:
   - `title`: Descriptive summary (e.g. "A01 Broken Access Control: IDOR in /api/documents/{id}")
   - `severity`: P1 to P4 according to demonstrated impact.
   - `url`: Specific endpoint tested.
   - `parameter`: The vulnerable input or parameter.
   - `payload`: Exact payload used.
   - `response_excerpt`: Key excerpt demonstrating successful execution/disclosure.
   - `curl`: Reproducible curl one-liner.
   - `remediation`: Precise architectural fix.

