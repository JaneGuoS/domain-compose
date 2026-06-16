---
name: domain-compose
argument-hint: "[--refactor] [--impact <requirement>] [--yes] [PROJ-123 | github-url | repo-name | description | mockup image]"
description: "Orchestrator skill. Routes to the right sub-skill based on flags: (1) no flags = design a new domain from a requirement; (2) --refactor = run domain-analysis then produce DDD gap report and target design; (3) --impact = run impact-analysis for a requirement. See sub-skills for full detail."
---

## Skills (focused capabilities)

| Skill | What it does |
|-------|-------------|
| [`domain-analysis`](domain-analysis/SKILL.md) | Discovers domains from a codebase, verifies uniqueness + coverage, extracts inter-domain relationships → `docs/<service>-domain-map.json` |
| [`domain-mining`](domain-mining/SKILL.md) | Enriches a domain map: rich/anemic classification, value object candidates, missing events, misplaced business rules |
| [`bounded-context`](bounded-context/SKILL.md) | Groups aggregates into bounded contexts by DB/provider/Kafka cohesion, produces ASCII context map with relationship types |
| [`relationship-analysis`](relationship-analysis/SKILL.md) | Scans real code (FKs, HTTP calls, Kafka flows, shared VOs) to find and classify actual inter-aggregate relationships. Always called before diagram generation to ensure arrows are correct |
| [`ddd-target`](ddd-target/SKILL.md) | Generates the HTML DDD target design per bounded context, using verified relationship data for correct event arrows |
| [`impact-analysis`](impact-analysis/SKILL.md) | Given a requirement, classifies each domain as direct/indirect/none impact |

## Agents (composed workflows with memory)

| Agent | Composes | What it does |
|-------|---------|-------------|
| [`domain-boundary-context-generation`](../agents/domain-boundary-context-generation.md) | domain-mining + bounded-context | Orchestrates both skills sequentially, holds context across them, manages engineer confirmation gates, returns a confirmed domain model + context boundaries |
| [`ddd-critic`](../agents/ddd-critic.md) | — | Challenges the confirmed model across 5 lenses: technical vs domain boundaries, naming, aggregate sizing, missing concepts, relationship risks. Numbered findings for selective acceptance |
| [`draw-ddd-context-diagram`](../agents/draw-ddd-context-diagram.md) | relationship-analysis + ddd-target | Runs `relationship-analysis` first (verified relationships from code), then `ddd-target` (per-context HTML), then generates the context map SVG using only code-verified relationship arrows |

---

## Flags

| Flag | Meaning |
|------|---------|
| `--refactor` | Analyse an existing repo → DDD gap report + target design |
| `--impact <requirement>` | Given a requirement, highlight impacted domains and workflows |
| `--domain <name>` | Focus refactor on a single named bounded context |
| `--depth <1\|2\|3>` | DDD target design detail level (default: 1) |
| `--yes` | Skip all confirmation gates, run fully automated |

---

## Routing

```
domain-compose <input>
  │
  ├─ --refactor ──► domain-analysis (skill)
  │                      ↓
  │               domain-boundary-context-generation (agent)
  │                ├─ domain-mining (skill)         ← [user confirms]
  │                └─ bounded-context (skill)        ← [user confirms]
  │                      ↓
  │               ddd-critic (agent)                 ← [user accepts/rejects]
  │                      ↓
  │               draw-ddd-context-diagram (agent)
  │                ├─ relationship-analysis (skill)  ← verifies inter-aggregate links from code
  │                ├─ ddd-target (skill)             ← per-context aggregate model HTML
  │                └─ context-map.html (generated using verified relationships)
  │                      ↓ → /plan
  │
  ├─ --impact   ──► impact-analysis (skill) → annotated HTML map
  │
  └─ (none)     ──► Design mode (below)
```

---

## MODE: --refactor

**Step 1 — Run domain-analysis**

Invoke `domain-analysis` on the input repo. Wait for the verified `docs/<service>-domain-map.json`.

The domain-analysis skill enforces:
- Unique domain names (no duplicates)
- 100% controller/app-service coverage
- One aggregate per domain
- Explicit inter-domain relationships

Do not proceed to Step 2 if coverage < 100% or any duplicate names. Fix issues first.

---

**Step 2 — Domain Boundary & Context Generation** (`domain-boundary-context-generation` agent)

<!-- Agent dispatch: domain-boundary-context-generation (agents/domain-boundary-context-generation.md) -->

This agent runs `domain-mining` and `bounded-context` skills in sequence, managing confirmation gates internally. It returns a single confirmed domain model + context boundaries.

Dispatch `domain-boundary-context-generation` agent with `REPO`, `DOMAIN_MAP_JSON`, and `YES_MODE`. The agent internally:
1. Runs `domain-mining` skill → presents results → waits for engineer confirmation
2. Runs `bounded-context` skill with confirmed mining output → presents context map → waits for confirmation

The agent returns `CONFIRMED_MODEL` (aggregate health + enrichments + context boundaries + ASCII map).

If `--yes` is set: agent skips both confirmation gates automatically.

---

**Step 3 — DDD Critic** (`ddd-critic` agent)

<!-- Agent dispatch: ddd-critic (agents/ddd-critic.md) -->

Dispatch `ddd-critic-agent` with `REPO`, `DOMAIN_MAP_JSON`, confirmed mining output, and confirmed context output. Present in chat:

> **🔍 DDD Critic — Agent 3 complete**
>
> **N findings:** ❌ N high · ⚠️ N medium · ℹ️ N low
>
> [Finding #1] — TECHNICAL vs DOMAIN BOUNDARY ❌
> {challenge text}
>
> [Finding #2] — NAMING ANTI-PATTERN ⚠️
> {challenge text}
>
> ...
>
> **Survives critique:** {list}
>
> Which findings do you want to incorporate?
> - **A — Accept all**
> - **B — Select** → list numbers (e.g. "1, 3")
> - **C — Reject all**

Wait for response. If `--yes`: accept all High and Medium findings.

---

**Step 4 — Draw DDD Context Diagram** (`draw-ddd-context-diagram` agent)

<!-- Agent dispatch: draw-ddd-context-diagram (agents/draw-ddd-context-diagram.md) -->

Dispatch `draw-ddd-context-diagram` agent with `CONFIRMED_MODEL`, `SERVICE_NAME`, `REPO`, and `DOCS_DIR`.

The agent produces:
- `docs/{service}-context-map.html` — SVG showing all bounded contexts and relationships
- `docs/{service}-ddd-target-{context}.html` per bounded context (or single `ddd-target.html`)

Both files are auto-opened in the browser. The DomainCompose Studio app also reflects the updated model — engineers can edit aggregate fields in-app and regenerate the context diagram from the updated state.

Depth levels (`--depth 1|2|3`) are passed through to the agent.

---

**Step 5 — Confirmation gate**

Present summary. Skip if `--yes`.

---

**Step 6 — DDD target design** (`ddd-target` skill — optional, for written design doc)

Invoke `ddd-target` with the confirmed + critiqued domain map.

If multi-context detected (Step 3):
- Write `docs/<service>-context-map.html` — SVG context map with all contexts, relationships, ACL markers
- Write `docs/<service>-ddd-target-<context>.html` per context

If single context:
- Write `docs/<service>-ddd-target.html`

Depth levels (`--depth 1|2|3`):

| Depth | Includes |
|-------|---------|
| 1 | Aggregate roots, value objects, lifecycle, invariants, commands → events |
| 2 | + Child entities, domain services, exception types, application use cases |
| 3 | + Value object validation, repository interfaces, factory signatures, DB tables |

Auto-open all generated files in browser.

**Step 6 — Confirmation gate**

Present summary:
> "**N bounded contexts · N aggregate roots · N VO candidates · N missing events**
>
> Critic findings applied: {list accepted}
>
> How to proceed?
> - A — Full refactor (all contexts) → plan
> - B — One context first → which?
> - C — Revise the design"

Skip if `--yes`.

**Step 7 — Hand off**

Write `docs/domain-refactor-<area>.md` including:
- Bounded context summary
- Mining findings incorporated
- Critic findings accepted
- Observable truths (what must be true for refactor to be complete)

Output:
> "✅ Run `/seismic-engineering:plan docs/domain-refactor-<area>.md`"

---

## MODE: --impact

Invoke `impact-analysis` with the requirement and `--service <name>`.

The impact-analysis skill:
- Classifies each domain as `direct`, `indirect`, or `none`
- Propagates impact along the `relationships` graph
- Identifies affected workflow steps
- Writes an annotated HTML map

---

## MODE: Design (no flags)

Model a new domain from a business requirement. See `domain-compose/SKILL.md` for the full design workflow (Steps 0–7: enrich input → clarify → model → infrastructure map → use cases → write doc → architecture diagram → hand off to plan).

---

## Design depth levels

| Level | DDD target includes | Best for |
|-------|-------------------|---------|
| `--depth 1` *(default)* | Aggregate roots, value objects, lifecycle states, invariants, commands → domain events | Quick overview, demos |
| `--depth 2` | Depth 1 + child entities, domain service rules, exception types, application use cases | Sprint planning, team review |
| `--depth 3` | Depth 2 + value object validation, repository interfaces, factory signatures, provider methods, DB tables | Implementation handoff |

---

## Shadow paths

- **No input** → ask: "Are you designing a new domain or refactoring an existing repo?"
- **Jira/Confluence unavailable** → continue with ambient context, note data is missing
- **Repo inaccessible** → ask for path; if unavailable, flag all structural assumptions
- **domain-analysis reports issues** → stop, report exact violations, do not proceed to DDD design
