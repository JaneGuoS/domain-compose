# DomainCompose Studio

Interactive web app for visualising service domain architecture and analysing requirement impact.
**Zero dependencies** — pure Node.js backend, single HTML frontend using CDN React.

## Quick start (1 command)

### Start the server
```bash
cd domain-compose/backend
node server.js
# Browser opens automatically at http://localhost:3001
# ✅  API running on http://localhost:3001
```

```

That's it. No npm install needed.

---

## Features

| Feature | How to use |
|---------|-----------|
| **Domain Map** | Opens automatically — 9 domain cards with health status |
| **Workflow viewer** | Click any workflow row to expand step-by-step flow |
| **Impact analysis** | Type a requirement in the top bar → domains and workflows highlight red/amber |
| **Integrations panel** | Kafka topics, HTTP services, background workers |

## Project structure
```
domain-compose-studio/
├── backend/
│   ├── server.js                          ← Pure Node.js HTTP server (no dependencies)
│   └── data/
│       └── content-manager-service.json   ← Pre-analysed demo data
└── frontend/
    └── index.html                         ← Self-contained React app (loads from CDN)
```

## API endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/services` | List available services |
| GET | `/api/analyze/:service` | Get full domain map JSON |
| POST | `/api/impact` | `{ service, requirement }` → impact scores per domain/workflow |

## Adding more services
Add a new JSON file to `backend/data/` following the same schema as `content-manager-service.json`.
The `/api/services` endpoint picks it up automatically.
