# opencoder

A self-hosted, open-source **CoderPad-style** collaborative coding pad — for you
and your friends, on your own port.

> Run it on your machine. Pick a port. Share the URL with friends. Code,
> debug, run, interview, score — all in real time. No SaaS, no per-seat
> billing, no AI hiring funnel. Just a programmable workspace you control.

## Features

- 🎛 **Multi-language IDE** — Python, JavaScript, TypeScript, Go, Rust, Java,
  C, C++, Ruby, C# — sandboxed in Docker (with a graceful local-subprocess
  fallback when Docker isn't there)
- 🤝 **Real-time collab** — Yjs CRDT-backed editor, presence + cursors, no
  conflicts
- 📁 **Multi-file workspaces** per pad, rename / delete / sort
- 🖥 **Terminal** with `xterm.js` + `node-pty` (sandboxed shell inside the pad)
- 💬 **Chat sidebar** per pad with history
- ⏪ **Code playback** — scrub the editing timeline like a film strip, replay
  every keystroke + run + chat
- 🧪 **Interview rooms** with a question bank, candidate-only view, and
  structured 5-axis rubric (correctness / style / communication / problem
  solving / hire-or-not)
- 🤖 **AI code review** (optional, opt-in) — point at Claude or OpenAI and
  get inline `{file, line, severity, comment}` annotations
- 👥 **Invites + share links** with roles: `owner / collaborator / viewer /
  candidate`
- 📦 **One-port deploy** — single Docker image serves the SPA + API + WS,
  one `PORT` you choose

## Quickstart — self-host (one port, one command)

```bash
# 1. Clone
git clone https://github.com/your-user/opencoder.git
cd opencoder

# 2. Configure
cp .env.example .env
# Edit .env — at minimum set a strong JWT_SECRET. Pick PORT if you like.
# Generate a secret:
#   openssl rand -hex 32

# 3. Run
docker compose up --build -d

# 4. Visit
open "http://localhost:${PORT:-4000}"

# Friends on your LAN:
#   http://<your-LAN-ip>:${PORT}
# Friends off-LAN: put it behind Tailscale / Cloudflare Tunnel.
```

**Important:** the compose file mounts your host Docker socket so the API
can spawn sandboxed code-runner containers. If you don't want that, set
`EXEC_FORCE_LOCAL=true` in your `.env` — code will run as subprocesses
inside the api container instead. (Less isolated. Friends-only trust.)

## Quickstart — local dev

```bash
pnpm install

# 1. Configure
cp apps/api/.env.example apps/api/.env

# 2. Set up the DB
pnpm --filter @opencoder/api prisma:generate
pnpm --filter @opencoder/api prisma:migrate

# 3. Run api (:4000) and web (:5173) together
pnpm dev
```

Visit <http://localhost:5173>.

## Scripts

| Command            | Purpose                                       |
| ------------------ | --------------------------------------------- |
| `pnpm dev`         | Run api + web in watch mode                   |
| `pnpm build`       | Build all packages                            |
| `pnpm test`        | Unit + integration tests (Vitest)             |
| `pnpm test:e2e`    | Playwright end-to-end suite                   |
| `pnpm typecheck`   | TypeScript no-emit across the workspace       |
| `pnpm lint`        | ESLint                                        |
| `pnpm format`      | Prettier                                      |

## Architecture

```
apps/
  api/        Fastify + Prisma/SQLite + WebSocket multiplex
              (collab, chat, terminal) + Docker code runners
  web/        Vite + React + Monaco + Yjs + xterm.js
packages/
  shared/     Shared types, language registry, WS envelope
```

Pad state lives in SQLite. Editor edits flow over a binary WS envelope:

```
byte 0     : message type (hello / state / update / awareness / chat / ping)
bytes 1-N  : payload (Yjs binary update, JSON, or terminal data)
```

Yjs updates persist as `EditEvent` rows so playback can rebuild a doc state
at any point in time.

## Roles

| Role           | Edit code | Run code | Terminal | Chat | Score | Invite |
| -------------- | :-------: | :------: | :------: | :--: | :---: | :----: |
| `owner`        |     ✓     |    ✓     |    ✓     |  ✓   |   ✓   |   ✓    |
| `collaborator` |     ✓     |    ✓     |    ✓     |  ✓   |       |        |
| `candidate`    |     ✓     |    ✓     |    ✓     |  ✓   |       |        |
| `viewer`       |           |          |          |  ✓   |       |        |

(Candidates differ from collaborators only in the interview UI: they don't
see the interviewer's rubric.)

## Security notes

- **Self-host trust model.** opencoder is designed for groups of friends,
  hackathon teams, or interview crews. There is no audit log, no SOC2.
- **Don't expose your raw port to the public internet.** Front it with a
  reverse proxy (Caddy, nginx) over HTTPS, or use Tailscale / Cloudflare
  Tunnel for off-LAN access.
- **Code execution** runs in throwaway Docker containers with a memory cap,
  CPU cap, no network, and a tmpfs. If Docker isn't available, fall back to
  local subprocess — only safe with friends you trust.
- **Terminals** spawn a real shell inside the api container (or, if you're
  doing dev, on your laptop). Don't grant `collaborator` to randoms.

## License

MIT — see [LICENSE](./LICENSE).
