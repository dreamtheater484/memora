# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private vulnerability reporting instead: go to the repository's **Security** tab and choose **Report a vulnerability**. You will get a response as soon as possible.

## Supported versions

Memora is in early development (pre-1.0). Only the latest version on the `main` branch receives fixes.

## Security design (summary)

The full description is in [section 11 of the implementation plan](IMPLEMENTATION_PLAN.md#11-security); the threat model and the OWASP ASVS Level 1 checklist are in [SECURITY_REVIEW.md](SECURITY_REVIEW.md). The main points:

- **Self-hosted, no third parties.** Memora makes no telemetry, CDN or font requests at runtime.
- **Accounts:**
  - Passwords are hashed with Argon2id (19 MiB, 8 passes). At least 12 characters; common passwords and ones containing the username are refused.
  - The first administrator can only be created with a one-time setup code printed in the server log.
  - Sessions live on the server and can be revoked from **Settings → Account → Devices**. The browser holds a random token in an `HttpOnly`, `SameSite=Lax` cookie (`__Host-` and `Secure` over HTTPS); the database stores only its SHA-256 hash. Sessions expire after 12 hours of inactivity, or 30 days with "remember this device", and after 90 days in any case.
  - Every change needs a CSRF token tied to the session, and must come from Memora's own origin (`Origin` / `Sec-Fetch-Site` checks).
  - Failed logins and setup attempts slow down per username and per address, doubling up to 15 minutes. The API also limits requests per address.
  - Every API route declares who may call it (anyone, signed-in users, or administrators). The server refuses to start if one doesn't, and tests check every route. A user asking for someone else's data gets "not found".
  - **Two-step verification** with an authenticator app (TOTP, RFC 6238), each code accepted once, plus ten single-use recovery codes stored as hashes. Administrators can require it for everyone. Changes to it ask for the password again.
  - Logins, failed logins, account, two-step and security changes, backups, exports and imports go to an audit log, kept for a year.
  - Locked out: `memora-admin reset-password` or `memora-admin reset-2fa` inside the container.
- **Secrets at rest.** Two-step verification secrets are encrypted (AES-256-GCM) with an instance key kept in its own file (`data/secret.key`), not in the database or its backups. The database file itself isn't encrypted: use an encrypted volume ([ADR 0005](adr/0005-database-encryption-at-rest.md)).
- **HTTPS is required** for real use. Browsers only enable offline mode, secure cookies and clipboard access over HTTPS. See [SETUP.md](SETUP.md).
- **Container hardening:**
  - Runs as a non-root user: the data folder's owner, or `PUID`/`PGID`.
  - Minimal Debian runtime image without a package manager toolchain.
  - Capped heap.
- **Content safety:** all rendered Markdown and HTML is sanitised. A strict Content Security Policy allows only Memora's own scripts (no inline scripts, no eval), and the end-to-end tests run under it. Pages also get `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, cross-origin isolation headers, a restrictive `Permissions-Policy`, and HSTS over HTTPS.
- **Supply chain:**
  - Dependabot updates.
  - gitleaks secret scanning over the full git history in CI.
  - `pnpm audit` (production dependencies, high and critical) and a Trivy scan of the image in CI.
- **Privacy of the source code:** automated guards stop personal information and secrets from ever being committed (see [CONTRIBUTING.md](../CONTRIBUTING.md#privacy-guards-read-this)).
