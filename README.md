# DomainCompose Studio

Interactive web app for visualising service domain architecture, exploring DDD target designs, and analysing requirement impact across a Seismic microservice.

---

## Architecture

```
domain-compose/
├── frontend/
│   ├── index.html          ← The entire running app (single-file, CDN React, no build needed)
│   └── src/                ← Work-in-progress Vite/React migration (not used by the server yet)
│       ├── components/
│       │   ├── AnalyzePanel.tsx
│       │   ├── DomainGrid.tsx
│       │   ├── ImpactBar.tsx
│       │   ├── IntegrationPanel.tsx
│       │   └── WorkflowPanel.tsx
│       └── App.tsx
│
├── backend/
│   ├── server.js           ← Express server (port 3001) — serves frontend + REST API
│   ├── data/               ← Pre-analysed service JSON files (one per service)
│   │   ├── content-manager-service.json
│   │   ├── channel.json
│   │   └── repo.json
│   └── scripts/
│       ├── claude-analyze.js   ← Two-phase Claude analysis pipeline (Phase 1: deep analysis, Phase 2: normalise to schema)
│       ├── analyze-service.js  ← Local directory analysis runner
│       └── discover-service.js ← Service catalog discovery runner
│
└── skill/
    └── SKILL.md            ← domain-compose Claude skill definition (used by the analysis pipeline)
```

### How analysis works

Clicking **+ Analyze repo** triggers a two-phase pipeline:

```
Input (GitHub URL / local path)
        ↓
Phase 1 — claude-analyze.js
  Claude runs domain-compose --refactor --yes on the repo
  → Free-form raw findings JSON (domains, workflows, gaps)
        ↓
Phase 2 — claude-analyze.js
  A second constrained Claude call normalises the findings
  → Exact Studio schema (backend/data/<service>.json)
        ↓
Server reloads the service and the UI renders it
```

The server polls job status every 800ms via `GET /api/jobs/:id` and streams log lines to the UI while the job runs.

### Data schema

Each `backend/data/*.json` file follows this shape:

```jsonc
{
  "service": "content-manager-service",
  "analyzedAt": "2026-06-01",
  "boundedContext": { "owns": [], "dependsOn": [], "publishes": [], "consumes": [] },
  "domains": [{
    "id": "file",
    "name": "File",
    "icon": "📄",
    "health": "anemic | partial | good",
    "operations": ["..."],
    "keywords": ["..."],
    "dddTarget": {
      "aggregate": "FileEntity",
      "identity": "fileId (Guid)",
      "lifecycle": ["active", "archived"],
      "valueObjects": ["FileStatus"],
      "invariants": ["..."],
      "commands": [{ "cmd": "CreateFile(...)", "event": "FileCreated" }]
    }
  }],
  "workflows": [{ "id": "...", "name": "...", "domains": ["file"], "steps": [] }],
  "gapAnalysis": [{ "id": 1, "title": "...", "severity": "P0|P1|P2", "category": "..." }],
  "integrations": { "kafkaIn": [], "kafkaOut": [], "http": [], "background": [] }
}
```

---

## Running locally

### Prerequisites

- Node.js 18+
- `claude` CLI installed and authenticated (`claude --version`)
- `gh` CLI authenticated for analysis from GitHub URLs (`gh auth status`)

### Start the server

```bash
cd domain-compose/backend
npm install
node server.js
# Opens http://localhost:3001 automatically
```

The server serves `frontend/index.html` directly — no frontend build step needed.

### Analyse a new service

Click **+ Analyze repo** in the top-right corner. Two input modes:

**GitHub URL** — clones and analyses any accessible repo:
```
https://github.com/seismic/channel-service
```

**Local path** — analyses a repo already on disk:
```
/path/to/service-repo
```

Analysis takes 10–20 minutes. Progress logs stream live in the UI. When complete, the service is added to the dropdown and loaded automatically.

To re-analyse with fresh results (discarding the existing JSON):
```bash
node backend/scripts/claude-analyze.js --url https://github.com/seismic/<name> --out <name> --fresh
```

---

## Views

| View | What it shows |
|------|--------------|
| **📄 Domain Map** | Domain cards with health status, key workflows, external integrations. Type a requirement in the top bar to highlight impacted domains. |
| **🔷 DDD Target** | Aggregate context diagram + per-aggregate design (lifecycle, value objects, invariants, commands). Left panel lists aggregate models — click to highlight in the diagram and scroll to the card. |
| **⚠ Gap Analysis** | DDD violations table (P0/P1/P2) with file-level detail. |

---

## API reference

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/api/services` | — | List available service names |
| GET | `/api/analyze/:service` | — | Full domain map JSON for a service |
| POST | `/api/discover` | `{ url?, alias?, out?, maxDomains? }` | Start analysis from GitHub URL or service alias |
| POST | `/api/jobs` | `{ dir, out?, maxDomains? }` | Start analysis from local directory path |
| POST | `/api/analyze-upload` | `{ out?, files: [{path, content}] }` | Start analysis from uploaded file contents |
| GET | `/api/jobs/:id` | — | Poll job status (`running/done/error`) and log lines |
| POST | `/api/impact` | `{ service, requirement }` | Impact scores per domain and workflow |

---

## Frontend developer notes

The current running app lives entirely in `frontend/index.html` (~75 KB, vanilla JS with CDN React). It is **not** built from `frontend/src/`.

The `frontend/src/` directory is a work-in-progress Vite/React migration. To complete the migration:

1. Port components from `frontend/index.html` into `frontend/src/components/`
2. Run `npm install` and `npm run dev` in `frontend/` for hot-reload dev (proxies `/api` to port 3001)
3. When ready to ship, run `npm run build` — this outputs to `frontend/dist/`
4. Update `backend/server.js` line 10: change `FRONTEND_DIR` to `path.join(__dirname, '..', 'frontend', 'dist')`
5. Restart the server

Until migration is complete, edit `frontend/index.html` directly and restart the backend to see changes.
