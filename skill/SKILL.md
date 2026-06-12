---
name: domain-compose
argument-hint: "[--refactor] [--impact <requirement>] [--yes] [PROJ-123 | github-url | repo-name | description | mockup image]"
description: "Orchestrator skill. Routes to the right sub-skill based on flags: (1) no flags = design a new domain from a requirement; (2) --refactor = run domain-analysis then produce DDD gap report and target design; (3) --impact = run impact-analysis for a requirement. See sub-skills for full detail."
---

## Sub-skills

| Sub-skill | What it does | When it runs |
|-----------|-------------|-------------|
| [`domain-analysis`](domain-analysis/SKILL.md) | Discovers all domains from a codebase, verifies uniqueness + coverage, extracts inter-domain relationships, outputs `docs/<service>-domain-map.json` | Called by `--refactor` before DDD design |
| [`impact-analysis`](impact-analysis/SKILL.md) | Given a requirement + domain map, classifies each domain and workflow as direct/indirect/none using the relationships graph | Called by `--impact` |

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
  ├─ --refactor ──► domain-analysis → DDD gap report → DDD target design → /plan
  │
  ├─ --impact   ──► impact-analysis → annotated HTML map
  │
  └─ (none)     ──► Design mode (below)
```

---

## MODE: --refactor

**Step 1 — Run domain-analysis**

Invoke `domain-analysis` on the input repo. Wait for the verified `docs/<service>-domain-map.json` before proceeding.

The domain-analysis skill enforces:
- Unique domain names (no duplicates)
- 100% controller/app-service coverage
- One aggregate per domain
- Explicit inter-domain relationships

Do not proceed to Step 2 if domain-analysis reports coverage < 100% or any duplicate names. Fix the issues first.

**Step 2 — DDD gap analysis**

Using the verified domain map, assess DDD violations:

| Severity | Meaning |
|----------|---------|
| 🔴 P0 | Fundamental — business rules unprotected, logic in wrong layer |
| 🟡 P1 | Structural — correct behaviour, wrong place |
| 🟢 P2 | Improvement — lower cognitive load |

Gap categories:
- **Anemic model** — entity is a data bag, logic lives in app service
- **Layer violation** — domain calls infrastructure directly, controller does orchestration
- **Missing concept** — value objects as primitives, no domain events raised for state changes
- **Infra coupling** — domain depends on concrete providers, not interfaces

For each P0 and P1 produce a before/after code snippet using actual class names from the repo.

**Step 3 — DDD target design** (`--depth 1|2|3`)

| Depth | Includes |
|-------|---------|
| 1 | Aggregate roots, value objects, lifecycle, invariants, commands → events |
| 2 | + Child entities, domain services, exception types, application use cases |
| 3 | + Value object validation, repository interfaces, factory signatures, exact provider methods, DB tables |

Write `docs/<service>-ddd-target.html`.

**Step 4 — Confirmation gate**

Present summary:
> "🔴 N P0  🟡 N P1  🟢 N P2 — estimated N files changed"
>
> A — Full refactor (P0+P1+P2) → plan
> B — P0 only
> C — One aggregate
> D — Revise design

Skip if `--yes`.

**Step 5 — Hand off**

Write `docs/domain-refactor-<area>.md` and output:
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
