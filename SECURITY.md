# Security Policy

opencoder is a self-hosted, friends-and-team collaborative coding environment.
This document describes the **threat model**, what the project does to mitigate
each class of risk, and the operator's responsibilities.

If you believe you've found a vulnerability, email **security@opencoder.local**
(or whatever address the operator publishes for their instance). Please do not
file public GitHub issues for security reports.

## Threat Model

opencoder is designed for these deployment shapes, in increasing order of risk:

1. **Solo / single-machine.** One developer, localhost only, no other users.
2. **LAN / friends.** Multiple trusted users on the same Wi-Fi or VPN.
3. **Small team behind a VPN/Tailscale.** Users are authenticated humans known
   to the operator.
4. **Public-internet exposure.** Anyone on the internet can reach the URL.

The default configuration targets **shape 2**. Operators choosing shape 4 must
explicitly opt into stricter settings (HSTS, locked CORS, password-protect every
pad, etc.) — see "Hardening for Public Exposure" below.

opencoder is **not** designed to defend against a sophisticated attacker who has
direct code-execution access to the host. The Docker sandbox protects the host
from untrusted code submitted *by users*; it does not protect against an
attacker who has already compromised the API process.

### In-scope threats

- Untrusted code execution escaping the sandbox to read host files, exfiltrate
  data, or pivot to other hosts on the network.
- Cross-user attacks: one signed-in user reading, modifying, or destroying
  another user's pads.
- Auth bypass: unauthenticated users accessing pads or admin endpoints.
- Auth abuse: brute-forcing logins, mass-creating accounts.
- CSRF / clickjacking against a logged-in user.
- Token leakage through URLs, logs, or browser history.
- Audit-trail evasion for sensitive actions (pad delete, password change,
  account deletion).

### Out-of-scope threats

- A malicious host operator. If you don't trust the person running the server,
  don't use it.
- Side-channel attacks against `bcrypt.compare` or JWT signing.
- Physical access to the server.
- Compromised Docker daemon, kernel, or host OS.
- DoS via network-layer flooding (use a reverse proxy / firewall).

## Sandbox Model

Code submitted by users is executed in a **Docker container** with all of the
following enforced (see `apps/api/src/exec/docker.ts`):

| Flag                          | Effect                                                |
|-------------------------------|-------------------------------------------------------|
| `--network none`              | No outbound network access                            |
| `--ipc private`               | Isolated IPC namespace                                |
| `--read-only`                 | Root filesystem is immutable                          |
| `--tmpfs /tmp:...`            | Bounded, exec-friendly scratch space                  |
| `--cap-drop ALL`              | Drops every Linux capability                          |
| `--security-opt no-new-privileges` | Blocks setuid privilege escalation               |
| `--security-opt seccomp=runtime/default` | Filters dangerous syscalls                  |
| `--user 65534:65534`          | Runs as `nobody` (unprivileged)                       |
| `--pids-limit 256`            | Caps process count (fork-bomb defense)                |
| `--ulimit nofile=64:64`       | Caps open file descriptors                            |
| `--memory <N>m`, `--cpus <N>` | Caps memory and CPU                                   |
| `--rm`                        | Container is destroyed on exit                        |

**Local fallback.** When Docker is unavailable (e.g. on a dev laptop), opencoder
falls back to spawning subprocesses directly. The local fallback does **not**
provide kernel-level isolation. Production / multi-user deployments MUST run
with Docker available. The fallback exists for development convenience only.

## Authentication & Sessions

- Passwords are hashed with **bcrypt** (10 rounds). Comparison is constant-time
  (`bcrypt.compare`).
- Sessions are **JWT bearer tokens**, signed with a secret loaded from
  `JWT_SECRET`. Tokens expire after 7 days. There is no refresh endpoint —
  tokens must be re-issued via login.
- Tokens are stored client-side in `localStorage` and additionally set as an
  `httpOnly`, `SameSite=Lax` cookie, so they survive page reloads and ride
  along on WebSocket upgrades without being placed in URLs.
- **WebSocket auth** rides the `Sec-WebSocket-Protocol` header
  (`oc.bearer.<jwt>`), never the URL. This keeps tokens out of access logs,
  browser history, and tab titles.

### Rate Limits

| Endpoint                | Limit (per IP, per minute) |
|-------------------------|----------------------------|
| `POST /api/auth/guest`  | 10                         |
| Everything else (global) | `RATE_LIMIT_PER_MINUTE` (default 120) |

Auth is name-only — there is no password or email-login surface to brute-force.
Account events (signup, name change, deletion) are recorded in the **audit log**
(`AuditLog` table).

## Security Headers

Responses ship with the following headers (via `@fastify/helmet`):

- `Content-Security-Policy` — restricts script, worker, image, font, and
  connect sources. `worker-src` and `script-src` allow `blob:` because Monaco
  and xterm require it.
- `X-Frame-Options: DENY` — blocks framing (clickjacking defense).
- `Referrer-Policy: no-referrer`.
- `X-Content-Type-Options: nosniff`.
- `Cross-Origin-Opener-Policy: same-origin`.
- `Strict-Transport-Security` is **opt-in** (set `ENABLE_HSTS=1`) because LAN
  deployments are often plain HTTP. Public-internet operators should enable it
  along with TLS.

## CORS

The default CORS config (no `ALLOWED_ORIGINS` env var) reflects the request
origin, which is permissive but convenient for dev + LAN. Operators exposing the
service to the public internet **MUST** set `ALLOWED_ORIGINS` to a comma-
separated allow-list of trusted origins.

## Audit Log

The `AuditLog` table records every:

- failed login attempt
- password change
- account deletion
- pad deletion / fork
- pad password set / clear
- member kick
- recording start / stop / delete

Each entry stores `userId`, `action`, `target`, `ip`, `userAgent`, optional
metadata, and a timestamp. The log is append-only; there is no UI surface for
viewing it (intentional — operators query the database directly).

## Pad Password Gates

Pads can be password-protected. The password is **bcrypt-hashed** the same way
account passwords are. Unlock attempts are not rate-limited per pad today — for
public-internet exposure, operators should put the entire deployment behind a
reverse proxy with IP-based throttling.

## Hardening for Public Exposure

If you are exposing opencoder to the open internet (not recommended without a
VPN), enable the following:

```bash
# .env / docker compose env
NODE_ENV=production
ENABLE_HSTS=1
ALLOWED_ORIGINS=https://opencoder.your-domain.example
JWT_SECRET=<64+ random bytes from `openssl rand -hex 64`>
RATE_LIMIT_PER_MINUTE=60
COOKIE_DOMAIN=opencoder.your-domain.example
```

Run behind a reverse proxy (Caddy, nginx, Cloudflare) that terminates TLS and
enforces network-layer rate limits. Set `trustProxy: true` (already on) so
`req.ip` reflects the X-Forwarded-For value.

## Disclosure

We aim to acknowledge security reports within 72 hours and ship fixes for
high-severity issues within 14 days. Coordinated disclosure is appreciated.
