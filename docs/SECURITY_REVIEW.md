# Security review

The Phase 12 review (plan §11): a threat model, and the OWASP Application Security Verification Standard (ASVS 4.0.3) Level 1 checklist with where each requirement is met. Review it again when something changes how people log in, what leaves the server, or what the server fetches.

## Threat model

### What is worth protecting

| Asset                                       | Where it lives                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| Notes, boards, files and their history      | `data/memora.db`; on devices that were used offline, in IndexedDB                |
| Accounts: passwords, sessions, second steps | `data/memora.db` (Argon2id hashes; SHA-256 of session tokens and recovery codes) |
| Two-step verification secrets               | `data/memora.db`, sealed with AES-256-GCM under `data/secret.key`                |
| Backups and exports                         | `data/backups/`, downloads (optionally encrypted with a password)                |
| Synced notes (desktop app)                  | The sync folder in the person's cloud storage, end-to-end encrypted              |
| Sync's cloud sign-in and vault key          | Sealed by the operating system (`safeStorage`) beside the desktop app's data     |
| The server itself                           | The container: a Node.js process as a non-root user                              |

### Who might attack, and from where

1. **Someone on the internet**, when Memora is reachable through a reverse proxy. They can reach the login page and the API, but have no account.
2. **Someone on the local network**: the same, plus reading plain-HTTP traffic when HTTPS isn't set up.
3. **Another user of the same Memora.** They have an account and a session, and try to reach other people's data or administrator actions.
4. **A malicious page, or pasted or imported content.** HTML, Markdown, SVG or an archive from elsewhere, with the aim of running script in Memora or making the server fetch internal addresses.
5. **Someone with a copy of the data**, from a stolen disk, a leaked backup or a copied folder.
6. **A compromised dependency or image** (supply chain).
7. **Whoever can read or write the sync folder** (desktop app): the cloud provider, someone with the person's cloud account, another app with access to it.

### Trust boundaries and threats (STRIDE)

| Boundary          | Threat                                                                             | Mitigation                                                                                                                                                                                                                                                                                                                                                                            | Left over                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Browser ↔ server  | **Spoofing:** guessing passwords                                                   | Argon2id; per-username and per-address throttling with doubling delays; common passwords refused; optional or required two-step verification. Codes work once; wrong codes slow the account down even with the right password. Failed logins are in the audit log.                                                                                                                    | A user who reuses a leaked password and has no second step.                                                               |
|                   | **Spoofing:** stealing a session                                                   | 256-bit tokens in `HttpOnly`, `SameSite=Lax`, `__Host-` `Secure` cookies; idle and absolute expiry; rotation on login and password change; revocable per device; HSTS over HTTPS.                                                                                                                                                                                                     | Plain HTTP on a hostile network (the login page warns).                                                                   |
|                   | **Tampering:** cross-site requests                                                 | CSRF token tied to the session on every change; `Origin` / `Sec-Fetch-Site` checks; `SameSite` cookies; no CORS; `frame-ancestors 'none'`.                                                                                                                                                                                                                                            | —                                                                                                                         |
|                   | **Information disclosure:** caching and referrers                                  | `Cache-Control: no-store` on the API; `Referrer-Policy: no-referrer`; `nosniff`.                                                                                                                                                                                                                                                                                                      | —                                                                                                                         |
|                   | **Denial of service**                                                              | Per-address API limit; body, upload and import limits; zip-bomb limits; capped heap.                                                                                                                                                                                                                                                                                                  | A determined flood: the reverse proxy or firewall has to handle it.                                                       |
| User ↔ user       | **Elevation:** reading or changing another user's data                             | Every route declares its access; the server refuses to start otherwise. Owner checks in every query. Tests walk every route with another user's ids and expect "not found".                                                                                                                                                                                                           | —                                                                                                                         |
|                   | **Elevation:** administrator actions                                               | `admin` routes; the last active administrator can't be removed; administrators can't read other people's notes.                                                                                                                                                                                                                                                                       | An administrator can reset someone's password and then log in as them. The audit log records it.                          |
| Content ↔ app     | **Tampering / elevation:** script in notes (XSS)                                   | `rehype-sanitize` and DOMPurify; Mermaid `strict`; KaTeX `trust: false`; CSP with `script-src 'self'` (no inline script, no eval); files other than images (and every SVG) served as sandboxed downloads.                                                                                                                                                                             | A sanitiser bug would still meet the CSP.                                                                                 |
|                   | **Tampering:** server-side request forgery (SSRF)                                  | Remote image download: http(s) only, resolved addresses checked (private, loopback, link-local, multicast blocked), connection to the checked address, re-checked redirects, size and time limits.                                                                                                                                                                                    | —                                                                                                                         |
|                   | **Tampering:** malicious archives                                                  | Entry count, entry size and total size limits; paths never taken from the archive; ids re-made on import.                                                                                                                                                                                                                                                                             | —                                                                                                                         |
| Data at rest      | **Information disclosure:** a copy of the database                                 | Password, session and recovery-code hashes; two-step secrets sealed with the instance key, which is not in the database or its backups; optional backup and export passwords.                                                                                                                                                                                                         | Notes are readable from a copied database. Use an encrypted volume ([ADR 0005](adr/0005-database-encryption-at-rest.md)). |
|                   | **Information disclosure:** a lost device                                          | Offline copies stay in the browser's storage for that origin; logging out removes them.                                                                                                                                                                                                                                                                                               | A device lost while signed in holds its offline copy. Revoke it under Settings → Account → Devices.                       |
| App ↔ sync folder | **Information disclosure:** the provider or anyone with the folder reads the notes | End-to-end encryption: scrypt from the passphrase, HKDF, AES-256-GCM for every file; stored files named by an HMAC; the passphrase never stored (the derived key is, sealed by the system) ([SYNC_FORMAT.md](SYNC_FORMAT.md))                                                                                                                                                         | The number, sizes and times of files. A weak passphrase (12 characters at least, common ones refused).                    |
|                   | **Tampering:** changed, swapped, replayed or planted files                         | Each file's header and path are authenticated; batches are checked against their name, device and number; remote values are checked against the schema and bound as parameters; size limits per kind of file, before and after decompression; the scrypt settings a vault file may ask for are capped; a file that can't be used holds back only its computer's changes, and is shown | Deleting files is possible (a denial of service): each computer keeps its own notes.                                      |
|                   | **Tampering:** Memora removing files that aren't its own                           | A new vault only where its folders are empty; only names of Memora's own shapes are ever removed, each computer only its own files                                                                                                                                                                                                                                                    | —                                                                                                                         |
|                   | **Elevation:** Memora reaching beyond its folder                                   | Google Drive: the `drive.file` scope, enforced by Google. WebDAV: one HTTPS base address, paths built from checked names, no redirects followed, listing entries outside the folder ignored. A folder: paths checked, temporary files renamed into place                                                                                                                              | WebDAV credentials open the whole account (kDrive, Nextcloud): an application password, revocable, is recommended.        |
|                   | **Spoofing:** a forged Google sign-in callback                                     | A one-time `state` compared in constant time, PKCE, the redirect to this computer's loopback address only, a 15-minute window                                                                                                                                                                                                                                                         | —                                                                                                                         |
|                   | **Information disclosure:** the sign-in on the computer                            | Never in the database or its backups; sealed by DPAPI, the Keychain or the Secret Service; refused where Linux has no keyring                                                                                                                                                                                                                                                         | Malware running as the person can ask the system for it, as for any app's stored sign-in.                                 |
| Build ↔ image     | **Tampering:** supply chain                                                        | Frozen lockfile; `pnpm audit` (production, high and critical) and a Trivy image scan in CI; Dependabot; pinned tool images; gitleaks over the full history.                                                                                                                                                                                                                           | Advisories not published yet.                                                                                             |
| Logs              | **Information disclosure:** secrets in logs                                        | Cookies, CSRF tokens, archive passwords and authorisation headers are redacted; note content is never logged.                                                                                                                                                                                                                                                                         | —                                                                                                                         |
| Everything        | **Repudiation**                                                                    | Audit log of logins, failed logins, account, two-step and security changes, backups, exports and imports, kept for a year.                                                                                                                                                                                                                                                            | —                                                                                                                         |

## OWASP ASVS 4.0.3, Level 1

✓ met · ~ met in part, with the reason · n/a does not apply to Memora.

### V1 Architecture

| #          | Requirement                                              | Status | Where                                             |
| ---------- | -------------------------------------------------------- | ------ | ------------------------------------------------- |
| (L1 items) | Covered by the chapters below; the threat model is above | ✓      | This document; [ARCHITECTURE.md](ARCHITECTURE.md) |

### V2 Authentication

| #      | Requirement                                                 | Status | Where                                                                                                                  |
| ------ | ----------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| 2.1.1  | Passwords of at least 12 characters                         | ✓      | `PASSWORD_MIN_LENGTH` (shared), checked on the server                                                                  |
| 2.1.2  | Passwords of 64 characters or more allowed                  | ✓      | Up to 1024                                                                                                             |
| 2.1.3  | No truncation                                               | ✓      | Argon2id takes the whole password                                                                                      |
| 2.1.4  | Any printable Unicode, including spaces and emoji           | ✓      | No character rules                                                                                                     |
| 2.1.5  | Users can change their password                             | ✓      | Settings → Account → Password                                                                                          |
| 2.1.6  | The current password is needed to change it                 | ✓      | `POST /auth/password`                                                                                                  |
| 2.1.7  | Breached or common passwords are refused                    | ✓      | Bundled list of common passwords (`auth/common-passwords.ts`), and the username                                        |
| 2.1.8  | A password strength meter                                   | ✓      | `NewPasswordHint` on every new-password field (Phase 12)                                                               |
| 2.1.9  | No composition rules                                        | ✓      | Length only                                                                                                            |
| 2.1.10 | No periodic rotation                                        | ✓      |                                                                                                                        |
| 2.1.11 | Pasting and password managers work                          | ✓      | `autocomplete` attributes, hidden username fields                                                                      |
| 2.1.12 | The password can be shown while typing                      | ✓      | `PasswordInput`                                                                                                        |
| 2.2.1  | Anti-automation against credential stuffing and brute force | ✓      | `Throttle` per username, address and (for codes) account; the API limit                                                |
| 2.2.2  | No weak authenticators (SMS, email)                         | ✓      | Authenticator apps only                                                                                                |
| 2.2.3  | Users told of changes to their credentials                  | ~      | Memora sends no email. Changes are in the audit log, and other devices are signed out on password and two-step changes |
| 2.3.1  | Initial passwords random, one-time, short-lived             | ✓      | Temporary passwords: 80 random bits, must be replaced at the first login                                               |
| 2.5.1  | No recovery secrets sent in clear                           | ✓      | Resets happen through an administrator or `memora-admin`                                                               |
| 2.5.2  | No password hints or security questions                     | ✓      |                                                                                                                        |
| 2.5.3  | Recovery never reveals the password                         | ✓      |                                                                                                                        |
| 2.5.4  | No shared or default accounts                               | ✓      | The first administrator needs the setup code from the log                                                              |
| 2.5.5  | Users told when authentication factors change               | ~      | As 2.2.3                                                                                                               |
| 2.5.6  | Forgotten passwords go through a secure recovery path       | ✓      | Administrator reset, or `memora-admin reset-password`; lost phones: recovery codes, or `reset-2fa`                     |
| 2.7.x  | Out-of-band verifiers                                       | n/a    | None                                                                                                                   |
| 2.8.1  | Time-based one-time passwords have a defined lifetime       | ✓      | 30-second steps, one step either side, each code once (`auth/totp.ts`)                                                 |

### V3 Session management

| #     | Requirement                                     | Status | Where                                                                   |
| ----- | ----------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| 3.1.1 | Session tokens never in URLs                    | ✓      | Cookie only; archive passwords travel in a header                       |
| 3.2.1 | A new token on authentication                   | ✓      | `createSession`; rotated on password change                             |
| 3.2.2 | At least 64 bits of entropy                     | ✓      | 256 bits                                                                |
| 3.2.3 | Stored securely in the browser                  | ✓      | `HttpOnly` cookie                                                       |
| 3.3.1 | Logout and expiry end the session on the server | ✓      | Sessions are server-side rows                                           |
| 3.3.2 | Re-authentication at least every 30 days        | ✓      | 30 days idle with "remember", 12 hours without, 90 days at most         |
| 3.4.1 | `Secure` cookie attribute                       | ✓      | Over HTTPS (and on localhost)                                           |
| 3.4.2 | `HttpOnly`                                      | ✓      |                                                                         |
| 3.4.3 | `SameSite`                                      | ✓      | `Lax`                                                                   |
| 3.4.4 | `__Host-` prefix                                | ✓      | Over HTTPS                                                              |
| 3.4.5 | Path attribute when sharing a domain            | ✓      | `Path=/` with `__Host-`: the whole origin is Memora's                   |
| 3.7.1 | Re-authentication before sensitive changes      | ✓      | The password again for password and two-step changes and recovery codes |

### V4 Access control

| #     | Requirement                                        | Status | Where                                                                                                         |
| ----- | -------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| 4.1.1 | Enforced on the server                             | ✓      | `registerAuth` hook; owner checks in queries                                                                  |
| 4.1.2 | Access attributes can't be changed by users        | ✓      | Roles only through admin routes                                                                               |
| 4.1.3 | Least privilege                                    | ✓      | Administrators can't read notes                                                                               |
| 4.1.5 | Fails securely                                     | ✓      | A route without an access policy stops the server from starting                                               |
| 4.2.1 | Protection against direct object reference attacks | ✓      | `auth/access.test.ts` tries other users' ids on every route                                                   |
| 4.2.2 | CSRF protection                                    | ✓      | Token, origin checks, `SameSite`                                                                              |
| 4.3.1 | Administrative interfaces use multi-factor         | ~      | Available and can be required for everyone; not forced by default (a first run with no phone must still work) |
| 4.3.2 | No directory browsing                              | ✓      | Static files by name only                                                                                     |

### V5 Validation, sanitisation and encoding

| #      | Requirement                                      | Status | Where                                                                                    |
| ------ | ------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------- |
| 5.1.1  | Parameter pollution                              | ✓      | Query and body parsed through schemas                                                    |
| 5.1.2  | Mass assignment                                  | ✓      | Zod schemas name every field a route takes                                               |
| 5.1.3  | Input validated (allow-lists)                    | ✓      | Zod on every route                                                                       |
| 5.1.4  | Structured data validated                        | ✓      | As above                                                                                 |
| 5.1.5  | Redirects only to allowed destinations           | ✓      | `safeRedirect`: same-origin paths only                                                   |
| 5.2.1  | Untrusted HTML sanitised                         | ✓      | DOMPurify, `rehype-sanitize`                                                             |
| 5.2.2  | Unstructured data sanitised                      | ✓      | Names and titles are text; React escapes                                                 |
| 5.2.4  | No `eval` or dynamic code                        | ✓      | CSP without `unsafe-eval`; zod runs without its eval probe                               |
| 5.2.5  | Template injection                               | n/a    | No server-side templates                                                                 |
| 5.2.6  | SSRF protection                                  | ✓      | `assets/fetch.ts`                                                                        |
| 5.2.7  | SVG can't run script                             | ✓      | SVG files are never shown inline: only served as sandboxed downloads (`assets/image.ts`) |
| 5.2.8  | Markdown and similar sanitised                   | ✓      | The Markdown pipeline ends in `rehype-sanitize`                                          |
| 5.3.1  | Output encoding for its context                  | ✓      | React; JSON responses                                                                    |
| 5.3.3  | Protection against reflected, stored and DOM XSS | ✓      | As 5.2.x, plus the CSP                                                                   |
| 5.3.4  | Parameterised queries                            | ✓      | Drizzle and prepared statements; FTS queries built from tokens, never pasted             |
| 5.3.7  | LDAP injection                                   | n/a    |                                                                                          |
| 5.3.8  | OS command injection                             | n/a    | No shell commands                                                                        |
| 5.3.9  | Local and remote file inclusion                  | ✓      | Files are addressed by generated ids; backup names are checked                           |
| 5.3.10 | XPath and XML injection                          | n/a    |                                                                                          |
| 5.5.2  | XML external entities                            | n/a    | Word files are read in the browser                                                       |
| 5.5.3  | No unsafe deserialisation                        | ✓      | JSON only, validated                                                                     |

### V6 Stored cryptography

| #     | Requirement                 | Status | Where                                                                             |
| ----- | --------------------------- | ------ | --------------------------------------------------------------------------------- |
| 6.2.1 | Cryptography fails securely | ✓      | AES-GCM authentication failures give "can't open", never plaintext (`openSecret`) |

### V7 Errors and logging

| #     | Requirement                              | Status | Where                                                   |
| ----- | ---------------------------------------- | ------ | ------------------------------------------------------- |
| 7.1.1 | No credentials or session tokens in logs | ✓      | Pino `redact`                                           |
| 7.1.2 | No other sensitive data in logs          | ✓      | Note content is never logged                            |
| 7.4.1 | A generic message for unexpected errors  | ✓      | "Something went wrong."; details only in the server log |

### V8 Data protection

| #     | Requirement                                   | Status | Where                                                                                                  |
| ----- | --------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| 8.2.1 | Sensitive responses not cached                | ✓      | `Cache-Control: no-store` on the API                                                                   |
| 8.2.2 | No sensitive data in browser storage          | ~      | Offline mode keeps notes in IndexedDB by design (§9.6); only for the signed-in user; removed on logout |
| 8.2.3 | Client storage cleared when the session ends  | ✓      | `signedOut(…, { forget: true })`                                                                       |
| 8.3.1 | Sensitive data in bodies or headers, not URLs | ✓      |                                                                                                        |
| 8.3.2 | Users can export and remove their data        | ✓      | Export (Phase 9); an administrator deletes accounts                                                    |
| 8.3.3 | Clear about what is collected                 | ✓      | Nothing leaves the server: no telemetry, CDN or font requests                                          |
| 8.3.4 | Sensitive data identified                     | ✓      | The asset table above                                                                                  |

### V9 Communication

| #     | Requirement                    | Status | Where                                                                                                             |
| ----- | ------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------- |
| 9.1.1 | TLS for all client connections | ~      | The reverse proxy or Tailscale serves HTTPS ([SETUP.md](SETUP.md)); HSTS once it does; plain HTTP shows a warning |
| 9.1.2 | Strong TLS configuration       | ~      | The reverse proxy's configuration                                                                                 |
| 9.1.3 | Current TLS versions only      | ~      | As 9.1.2                                                                                                          |

### V10 Malicious code

| #      | Requirement                         | Status | Where                                                                                          |
| ------ | ----------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| 10.3.1 | Updates checked for integrity       | ✓      | Memora never updates itself; images are built by CI from a checked commit and pulled from GHCR |
| 10.3.2 | Subresource integrity for CDN files | n/a    | Nothing is loaded from other origins                                                           |
| 10.3.3 | Protection from subdomain takeover  | n/a    |                                                                                                |

### V11 Business logic

| #      | Requirement                | Status | Where                                         |
| ------ | -------------------------- | ------ | --------------------------------------------- |
| 11.1.1 | Steps happen in order      | ✓      | A code needs the ticket from a right password |
| 11.1.2 | Realistic human timing     | ✓      | Rate limits                                   |
| 11.1.3 | Limits per user and action | ✓      | Throttles, job limits                         |
| 11.1.4 | Anti-automation            | ✓      | As 2.2.1                                      |
| 11.1.5 | Business logic limits      | ✓      | Upload, import, WIP and depth limits          |

### V12 Files and resources

| #      | Requirement                                    | Status | Where                                                                                       |
| ------ | ---------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| 12.1.1 | No overly large files                          | ✓      | `MEMORA_MAX_UPLOAD_MB`, `MEMORA_MAX_IMPORT_MB`                                              |
| 12.3.1 | File names never used as paths                 | ✓      | Stored by generated id                                                                      |
| 12.3.2 | Metadata can't cause path traversal            | ✓      |                                                                                             |
| 12.3.3 | No remote file inclusion                       | ✓      |                                                                                             |
| 12.3.4 | No reflective file download                    | ✓      | `Content-Disposition` on downloads                                                          |
| 12.3.5 | No OS commands with file metadata              | ✓      |                                                                                             |
| 12.4.1 | Uploads stored outside the web root            | ✓      | Inside the database                                                                         |
| 12.4.2 | Uploads scanned for malware                    | ~      | Not in Memora: files only reach their owner, and anything but images as sandboxed downloads |
| 12.5.1 | Only known file types served by the web tier   | ✓      | The built app only                                                                          |
| 12.5.2 | Uploads never run as HTML or scripts           | ✓      | `Content-Security-Policy: default-src 'none'; sandbox`, `nosniff`                           |
| 12.6.1 | Outgoing requests to allowed destinations only | ✓      | As 5.2.6                                                                                    |

### V13 API

| #      | Requirement                              | Status | Where                          |
| ------ | ---------------------------------------- | ------ | ------------------------------ |
| 13.1.1 | The same encoding and parsers everywhere | ✓      | JSON with UTF-8                |
| 13.1.3 | No secrets in API URLs                   | ✓      |                                |
| 13.2.1 | Only the HTTP methods each route needs   | ✓      | Routes are declared per method |
| 13.2.2 | JSON validated against a schema          | ✓      | Zod                            |
| 13.2.3 | CSRF protection for cookie-based APIs    | ✓      | As 4.2.2                       |
| 13.3.x | SOAP and XML                             | n/a    |                                |

### V14 Configuration

| #      | Requirement                                  | Status | Where                                                                            |
| ------ | -------------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| 14.2.1 | Components up to date, without known flaws   | ✓      | Dependabot; `pnpm audit` and Trivy in CI (Phase 12)                              |
| 14.2.2 | Unneeded features, docs and samples removed  | ✓      | Minimal runtime image; no source maps                                            |
| 14.2.3 | Subresource integrity                        | n/a    | No outside assets                                                                |
| 14.3.2 | No debug modes in production                 | ✓      |                                                                                  |
| 14.3.3 | Headers don't reveal component versions      | ✓      | No `Server` or `X-Powered-By`; the health check's version is by design (updates) |
| 14.4.1 | A `Content-Type` with charset                | ✓      | Fastify                                                                          |
| 14.4.2 | API downloads have `Content-Disposition`     | ✓      |                                                                                  |
| 14.4.3 | A Content Security Policy                    | ✓      | `CONTENT_SECURITY_POLICY` (shared); the end-to-end tests run under it            |
| 14.4.4 | `X-Content-Type-Options: nosniff`            | ✓      |                                                                                  |
| 14.4.5 | `Strict-Transport-Security`                  | ✓      | Over HTTPS                                                                       |
| 14.4.6 | A `Referrer-Policy`                          | ✓      | `no-referrer`                                                                    |
| 14.4.7 | Framing only by allowed origins              | ✓      | `frame-ancestors 'none'`, `X-Frame-Options: DENY`                                |
| 14.5.1 | Only the HTTP methods needed                 | ✓      |                                                                                  |
| 14.5.2 | `Origin` not used for access decisions alone | ✓      | Only in addition to the CSRF token                                               |
| 14.5.3 | CORS allow-list                              | ✓      | No CORS headers: other origins can't read answers                                |

## Findings fixed in Phase 12

- No password strength meter (2.1.8): added.
- No security headers on pages (14.4.x): a CSP and the other headers. The inline handler on the offline page was replaced with a link.
- Zod probed for `eval` at start (5.2.4): it now starts without the probe in the browser.
- Deleting backups, exports and imports weren't in the audit log: they are now.
- `lodash-es` (through mermaid) had a high-severity advisory: overridden to the fixed version.
- No second factor (2.8, 4.3.1): TOTP two-step verification, recovery codes, and an administrator setting to require it.
