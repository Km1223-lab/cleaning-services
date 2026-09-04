# KM Cleaning Services — Base44 Dev Notes

## What this is
A static website (PWA) for a Nairobi cleaning business. No build step, no backend in
this repo — it's plain HTML/CSS/JS served as-is.

## Architecture
- `km-cleaning-services.html` — main website (the entry point served at `/`).
- `admin.html` — staff dashboard for viewing/managing booking requests.
- `km-chat-worker.js` — Cloudflare Worker (deployed separately on Cloudflare, NOT run
  here). Handles the AI chat (proxies to Anthropic) and booking storage (Cloudflare KV).
- `manifest.json`, `service-worker.js`, `icons/` — PWA shell.

## How it runs here
`docker-compose.base44.yml` serves the repo root with `nginx:alpine` on host port 3000.
`nginx.base44.conf` sets `index km-cleaning-services.html` so `/` loads the main page.

### Setup quirk: directory permissions
The repo root is mode `700` after clone. nginx's worker process (non-root) cannot
traverse it and returns 403. Fix: `chmod 755 .` at the repo root. This is required
after a fresh clone.

### Setup quirk: icons/ folder
The icon PNGs ship at the repo root, but `manifest.json` and the HTML reference
`icons/icon-192.png` etc. An `icons/` directory with copies of the PNGs must exist
for the PWA manifest to resolve. It is created during setup (`cp *.png icons/`).

## What does NOT work in the preview
- **AI chat** and **booking submission** call `WORKER_URL` (a Cloudflare Worker) which
  is not deployed here. `WORKER_URL` in `km-cleaning-services.html` is still the
  placeholder `https://km-cleaning-chat-proxy.YOUR-SUBDOMAIN.workers.dev`, so those
  features will fail until the Worker is deployed and the URL is set.
- To make chat work locally you'd need an `ANTHROPIC_API_KEY` (see `.base44/environment.json`).
- The rest of the site (hero, services, gallery, contact info, WhatsApp link) browses fine.

## Verify it works
```bash
docker compose -f docker-compose.base44.yml up -d
curl -sf -H "Host: external-preview.example.com" http://localhost:3000/   # 200 + KM Cleaning title
```
