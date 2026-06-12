---
name: impact-analysis
argument-hint: "<requirement | PROJ-123 | confluence-url> --service <name | path-to-domain-map.json>"
description: "Given a new requirement and an existing domain map, classify each domain and workflow as directly impacted, indirectly affected, or unaffected. Uses the domain relationships graph to propagate impact transitively. Outputs an annotated impact map."
---

## What this skill produces

- **Domain impact scores** — each domain classified as `direct`, `indirect`, or `none`, with a reason
- **Workflow impact** — each workflow classified with affected step indices
- **Relationship propagation** — impact spreads along `relationships` edges (a domain whose child is directly impacted becomes `indirect`)
- **Impact map HTML** — `docs/<service>-impact-<slug>.html` with colour-coded annotations

---

## Step 0 — Resolve inputs

### Requirement
Accept any of:
- Free text after the command
- Jira ticket ID → fetch via `getJiraIssue`; use summary + description + acceptance criteria
- Confluence URL → fetch via `getConfluencePage`; extract domain concepts and business rules

Extract from the requirement:
- **Entities mentioned** — nouns that map to aggregate names
- **Operations mentioned** — verbs that map to domain commands or controller actions
- **External systems** — any named services or integrations

### Domain map
Accept any of:
- `--service <name>` → load `docs/<name>-domain-map.json` or `backend/data/<name>.json`
- `--service <path>` → load the JSON at that path directly

If the domain map is missing, run `domain-analysis` first.

---

## Step 1 — Direct impact classification

For each domain, classify as `direct` if ANY of the following match the requirement:

- The requirement names an entity that matches the domain's aggregate name or keywords
- The requirement describes an operation that matches one of the domain's `operations`
- The requirement references a controller or app service owned by this domain
- The requirement mentions a Kafka topic in this domain's `integrations.kafkaOut` or `kafkaIn`

Record for each directly impacted domain:
- `matchedEntities` — which entities from the requirement matched
- `matchedOps` — which operations matched
- `reason` — one sentence explaining why this domain is directly impacted

---

## Step 2 — Indirect impact via relationship graph

Using the `relationships` array from the domain map, propagate impact transitively:

```
For each directly impacted domain D:
  For each relationship edge where D is `from` or `to`:
    The other domain becomes `indirect` (if not already `direct`)
    Reason: "Indirectly affected — <relationship type> relationship with <D>"
```

Relationship types and their propagation direction:

| Type | Propagation |
|------|------------|
| `child-of` | Parent domain becomes `indirect` when child is `direct` |
| `guarded-by` | Permission domain becomes `indirect` when guarded domain is `direct` |
| `coordinates` | Coordinated domain becomes `indirect` |
| `notifies` | Consuming domain becomes `indirect` when publishing domain is `direct` |
| `depends-on` | Source domain becomes `indirect` when dependency is `direct` |

Any domain not reached by direct or indirect classification remains `none`.

---

## Step 3 — Workflow impact

For each workflow in the domain map:

1. Check if any of its `domains` array entries are `direct` or `indirect`.
2. Identify the affected step indices — steps whose `type` matches the impacted domains' operations or kafka events.
3. Classify the workflow:
   - `direct` — at least one domain in the workflow is `direct`
   - `indirect` — at least one domain is `indirect`, none are `direct`
   - `none` — all domains are `none`

For each impacted workflow, produce:
- `affectedSteps` — array of step indices
- `criticalPath` — one sentence describing the path through the workflow the requirement touches (e.g. "POST /api/files → FileEntity.CreateFile() → Kafka file-created")

---

## Step 4 — Output JSON

```jsonc
{
  "service": "content-manager-service",
  "requirement": "Add expiration date to files",
  "analyzedAt": "YYYY-MM-DD",
  "summary": {
    "directDomains": 2,
    "indirectDomains": 3,
    "unaffectedDomains": 8,
    "directWorkflows": 1,
    "indirectWorkflows": 2
  },
  "domainScores": {
    "file-versioning": {
      "level": "direct",
      "reason": "Requirement adds expiration date field to FileEntity",
      "matchedEntities": ["FileEntity"],
      "matchedOps": ["UpdateFile"]
    },
    "expiration": {
      "level": "direct",
      "reason": "ExpirationRuleEntity directly manages expiration policies for files"
    },
    "folder": {
      "level": "indirect",
      "reason": "Indirectly affected — child-of relationship with file-versioning"
    }
  },
  "workflowImpacts": {
    "upload-file": {
      "level": "direct",
      "affectedSteps": [1, 2],
      "criticalPath": "POST /api/files → FileEntity.CreateFile() with expiration date → FileCreated event"
    }
  }
}
```

---

## Step 5 — Write annotated HTML map

Write `docs/<service>-impact-<requirement-slug>.html`:

- **Domain cards** highlighted by impact level:
  - 🔴 Red — `direct`
  - 🟡 Amber — `indirect`
  - Grey/dimmed — `none`
- **Relationship arrows** highlighted in red/amber where impact propagated
- **Workflow steps** annotated with an indicator at each affected step
- **Banner** at top showing the requirement summary
- **Legend** and summary counts

Then open it:
```bash
open "docs/<service>-impact-<slug>.html" 2>/dev/null || \
  xdg-open "docs/<service>-impact-<slug>.html" 2>/dev/null || true
echo "📄 Impact map: $(pwd)/docs/<service>-impact-<slug>.html"
```

---

## Step 6 — Report

Print:
```
✅ Impact analysis complete
   Requirement  : <summary>
   Direct       : <N> domains (<names>)
   Indirect     : <N> domains (<names>)
   Unaffected   : <N> domains
   Workflows    : <N> direct, <N> indirect
```
