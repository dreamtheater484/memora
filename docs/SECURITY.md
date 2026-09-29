# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private vulnerability reporting instead: go to the repository's **Security** tab and choose **Report a vulnerability**. You will get a response as soon as possible.

## Supported versions

Memora is in early development (pre-1.0). Only the latest version on the `main` branch receives fixes.

## Security design (summary)

The full description is in [section 11 of the implementation plan](IMPLEMENTATION_PLAN.md#11-security). The main points:

- **Self-hosted, no third parties.** Memora makes no telemetry, CDN or font requests at runtime.
- **Accounts** (from Phase 2):
  - Argon2id password hashing.
  - Revocable server-side sessions in `HttpOnly`/`Secure` cookies.
  - CSRF protection and login rate limiting.
  - Optional 2FA (Phase 12).
- **HTTPS is required** for real use. Browsers only enable offline mode, secure cookies and clipboard access over HTTPS. See [SETUP.md](SETUP.md).
- **Container hardening:**
  - Runs as a non-root user (`PUID`/`PGID`).
  - Minimal Debian runtime image without a package manager toolchain.
  - Capped heap.
- **Content safety:** all rendered Markdown and HTML is sanitised, and a strict Content Security Policy is applied (from the editor phases onwards).
- **Supply chain:**
  - Dependabot updates.
  - gitleaks secret scanning over the full git history in CI.
  - Dependency and container scans.
- **Privacy of the source code:** automated guards stop personal information and secrets from ever being committed (see [CONTRIBUTING.md](../CONTRIBUTING.md#privacy-guards-read-this)).
