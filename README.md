# DomainCompose

A multi-agent Claude plugin and local web studio for DDD refactoring of Seismic microservices. Point it at a service repo, and it maps every aggregate, classifies health, detects bounded contexts, challenges the model, and generates a refactor plan — all with engineer confirmation gates at each stage.

---

## Pipeline overview

DomainCompose runs in two sequential phases, each gated by engineer review.

```
① CURRENT DDD MAP
   domain-analysis          — full controller/app-service scan → domain-map.json
         ↓
   domain-boundary-context-generation  (AGENT)
     ├── domain-mining       — Rich/Partial/Anemic, VOs, missing events, misplaced rules
     │       ↓  [confirm]
     └── bounded-context     — DB/Kafka/HTTP cohesion groups, ASCII context map
             ↓  [confirm]
   impact-analysis           — optional: classify domains per requirement

② DDD TARGET GENERATION
   ddd-critic               (AGENT)  — 5-lens adversarial review of the confirmed model
         ↓  [engineer accepts findings]
   draw-ddd-context-diagram (AGENT)
     ├── relationship-analysis  — code-verified inter-aggregate arrows
     └── ddd-target             — aggregate model per context → HTML + plan doc
```

---

## Skills

| Skill | Invoked by | What it does |
|-------|-----------|-------------|
| `domain-analysis` | engineer | Scans every controller and app service. One aggregate per domain. Outputs `docs/<service>-domain-map.json`. |
| `domain-mining` | `domain-boundary-context-generation` agent | Deep enrichment: Rich/Partial/Anemic health, value object candidates, missing domain events, misplaced business rules. |
| `bounded-context` | `domain-boundary-context-generation` agent | Groups aggregates by shared DB tables, providers, and Kafka topics. Produces ASCII context map and upstream/downstream graph. |
| `relationship-analysis` | `draw-ddd-context-diagram` agent | Reads real code — FK refs, HTTP provider calls, Kafka pub/sub — to build a verified `RELATIONSHIP_MAP`. |
| `ddd-target` | `draw-ddd-context-diagram` agent | Composes `CONFIRMED_MINING + CONFIRMED_CONTEXTS + RELATIONSHIP_MAP` into a per-context aggregate model. Never reads raw `domain-map.json`. |
| `impact-analysis` | engineer | Classifies each domain as direct/indirect/none for a given requirement. Uses the relationship graph to propagate transitively. |

## Agents

| Agent | Role |
|-------|------|
| `domain-boundary-context-generation` | Orchestrates `domain-mining` then `bounded-context`. Maintains context across both. Manages two confirmation gates. Returns `CONFIRMED_MINING + CONFIRMED_CONTEXTS`. |
| `ddd-critic` | Adversarial review across 5 lenses: technical boundary confusion, naming anti-patterns, aggregate sizing, missing domain concepts, coupling risks. Numbers every finding so the engineer can accept/reject individually. |
| `draw-ddd-context-diagram` | Runs `relationship-analysis` first (code-verified arrows), then `ddd-target`. Produces `context-map.html`, `ddd-target.html`, and `domain-refactor-<area>.md`. |

---

## Repository structure

```
domain-compose/
├── skill/
│   ├── domain-analysis/SKILL.md
│   ├── domain-mining/SKILL.md
│   ├── bounded-context/SKILL.md
│   ├── relationship-analysis/SKILL.md
│   ├── ddd-target/SKILL.md
│   ├── impact-analysis/SKILL.md
│   └── references/
│       └── ddd-patterns.md
│
├── agents/
│   ├── domain-boundary-context-generation.md
│   ├── ddd-critic.md
│   └── draw-ddd-context-diagram.md
│
├── frontend/
│   └── index.html              ← Studio UI (single-file CDN React, no build needed)
│
├── backend/
│   ├── server.js               ← Express (port 3001) — serves UI + REST API
│   ├── data/                   ← Pre-analysed service JSON files
│   └── scripts/
│       ├── claude-analyze.js   ← Two-phase Claude analysis runner
│       ├── analyze-service.js  ← Local directory analysis runner
│       └── discover-service.js ← Service catalog discovery runner
│
└── docs/
    ├── architecture.html       ← Pipeline architecture diagram
    └── <service>-*.html        ← Generated domain map + DDD target outputs
```

---

## DomainCompose Studio

A local web UI for navigating analysis results. Start the backend and open `http://localhost:3001`.

### Views

**Domain Map** — Domain cards showing health status (Rich ✅ / Partial 🟡 / Anemic 🔴), lifecycle, operations, and integrations. Type a requirement in the search bar to highlight impacted domains via `impact-analysis`.

**DDD Target** — Confirmed domain model from the pipeline. Shows a mining summary strip (health counts + bounded context count), aggregate cards grouped by bounded context, and the SVG context map. The "Service Integration Contracts" panel at the bottom shows what the service owns, its external dependencies, and the events it publishes and consumes.

**Gap Analysis** — DDD violations table (P0 / P1 / P2) with file-level detail and before/after code examples.

### Running locally

Prerequisites: Node.js 18+, `claude` CLI authenticated, `gh` CLI authenticated.

```bash
cd domain-compose/backend
npm install
node server.js
# → http://localhost:3001
```

### Analysing a new service

Click **+ Analyze repo** in the top-right corner. Accepts a GitHub URL or a local path:

```
https://github.com/seismic/channel-service
/path/to/service-repo
```

Analysis takes 10–20 minutes. Progress logs stream live. When complete, the service appears in the dropdown automatically.

To re-analyse and overwrite existing results:

```bash
node backend/scripts/claude-analyze.js \
  --url https://github.com/seismic/<name> \
  --out <name> \
  --fresh
```

---

## Data schema

Each `backend/data/*.json` file follows this shape:

```jsonc
{
  "service": "content-manager-service",
  "analyzedAt": "2026-06-01",
  "boundedContext": {
    "owns": [],
    "dependsOn": [],
    "publishes": [],
    "consumes": []
  },
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

## API reference

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/api/services` | — | List available service names |
| GET | `/api/analyze/:service` | — | Full domain map JSON for a service |
| POST | `/api/discover` | `{ url?, alias?, out?, maxDomains? }` | Start analysis from GitHub URL or service alias |
| POST | `/api/jobs` | `{ dir, out?, maxDomains? }` | Start analysis from local directory path |
| POST | `/api/analyze-upload` | `{ out?, files: [{path, content}] }` | Start analysis from uploaded file contents |
| GET | `/api/jobs/:id` | — | Poll job status (`running/done/error`) + log lines |
| POST | `/api/impact` | `{ service, requirement }` | Impact scores per domain and workflow |
