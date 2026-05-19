# opencoder

A self-hosted, open-source CoderPad-style collaborative coding pad for friends. Run it on
your machine, share your port, and code together in real time across 10+ languages.

> **Tip:** opencoder is built to be run on **your own port**. You decide who has access by
> who you give the URL to. Use Tailscale or Cloudflare Tunnel for off-LAN access.

## Features

- Real-time collaborative editing (Yjs CRDT) with cursors and presence
- Multi-file workspace per pad
- Multi-language code execution: Python, JavaScript, TypeScript, Go, Rust, Java, C, C++,
  Ruby, C# — sandboxed in Docker (with graceful fallback)
- Embedded shell terminal (`xterm` + `node-pty`)
- Real-time per-pad chat
- Code playback — scrub through the editing history
- Interview rooms with a question bank, candidate/interviewer split views, and structured
  scoring
- Optional AI code review (Claude or OpenAI; opt-in)
- Invite friends via email or share link with `owner`/`collaborator`/`viewer`/`candidate`
  roles
- Self-hosted: one binary, one Docker Compose file, one configurable `PORT`

## Quickstart (development)

```bash
# 1. Install dependencies
pnpm install

# 2. Set up the database
cp apps/api/.env.example apps/api/.env
pnpm --filter @opencoder/api prisma:generate
pnpm --filter @opencoder/api prisma:migrate

# 3. Run dev servers (api on :4000, web on :5173)
pnpm dev
```

Open <http://localhost:5173> and register an account.

## Quickstart (self-hosting)

```bash
# Pick the port you want friends to hit
export PORT=4000
cp .env.example .env

docker compose up --build
```

Share `http://<your-ip>:$PORT` with friends.

## Scripts

| Command           | What it does                                |
| ----------------- | ------------------------------------------- |
| `pnpm dev`        | Run api and web in dev mode                 |
| `pnpm build`      | Build all packages                          |
| `pnpm test`       | Run unit + integration tests                |
| `pnpm test:e2e`   | Run Playwright end-to-end tests             |
| `pnpm lint`       | Lint everything                             |
| `pnpm typecheck`  | TypeScript no-emit check across the repo    |
| `pnpm format`     | Prettier-format all source files            |

## Architecture

```
apps/
  api/   Fastify + Prisma/SQLite + WebSocket multiplex (collab, chat, terminal)
  web/   Vite + React + Monaco + Yjs + xterm.js
packages/
  shared/ Shared TypeScript types + language registry + WS envelope
```

## License

MIT — see [LICENSE](./LICENSE).
