---
name: domain-analysis
argument-hint: "<github-url | repo-path | service-alias> [--depth <1|2|3>] [--max-domains N] [--yes]"
description: "Analyse an existing service repo for bounded contexts, aggregate models, and DDD health. Outputs a verified domain map JSON with full controller/app-service coverage and explicit inter-domain relationships. Use before domain-compose --refactor or as a standalone diagnostic."
---

## What this skill produces

A single verified JSON file (`docs/<service>-domain-map.json`) containing:

- **domains** — each domain with its controllers, app services, aggregate model, health, and operations
- **relationships** — explicit domain-to-domain edges (child-of, guarded-by, notifies, coordinates)
- **coverageReport** — every controller and app service mapped to a domain; lists anything uncovered
- **integrations** — Kafka topics, HTTP providers, background services

---

## Hard constraints — enforced before output

These are not guidelines. Output is invalid if any constraint is violated.

| # | Constraint | Check |
|---|-----------|-------|
| 1 | **Unique names** | No two domains may share a name or differ only by a suffix (e.g. "File" and "FileVersion" must merge into "File & Versioning"). |
| 2 | **Full coverage** | Every `*Controller.cs` and `*AppService.cs` (excluding test files) must appear in exactly one domain's `controllers` or `appServices` list. |
| 3 | **One aggregate per domain** | Each domain has exactly one aggregate root. If a domain needs two, split it into two domains with distinct names. |
| 4 | **Relationship completeness** | Any foreign-key field on an aggregate (e.g. `folderId`, `tenantId`) that references another domain's aggregate must appear as an entry in `relationships`. |

---

## Step 0 — Resolve input

| Input | Action |
|-------|--------|
| GitHub URL | `gh repo clone <url> /tmp/<service> -- --depth 1 --filter=blob:none` |
| Service alias (no slash) | `gh repo clone seismic/<alias> /tmp/<alias> -- --depth 1 --filter=blob:none` |
| Local path | Use directly |

Set `REPO_ROOT` to the resolved directory. Set `SERVICE_NAME` from the last URL/path segment.

---

## Step 1 — Enumerate domain signals

Run the following to build an exhaustive list of source files before identifying domains:

```bash
# All controllers (exclude test projects)
find "$REPO_ROOT" -name "*Controller.cs" ! -path "*/test*" ! -path "*/Test*" | sort

# All app services
find "$REPO_ROOT" -name "*AppService.cs" ! -path "*/test*" ! -path "*/Test*" | sort

# All entities (aggregate candidates)
find "$REPO_ROOT" -name "*Entity.cs" ! -path "*/test*" ! -path "*/Test*" | sort

# Domain folder structure
ls "$REPO_ROOT"/src/*/Domain/ 2>/dev/null || ls "$REPO_ROOT"/src/*/domain/ 2>/dev/null
```

Record the **full list** of controllers and app services. This list is the coverage baseline — every file on it must be assigned to a domain in Step 2.

---

## Step 2 — Identify and verify domains

For each candidate domain:

1. Read the controller and app service to understand what business capability it serves.
2. Read the entity class to identify the aggregate root, lifecycle states, and invariants.
3. Assign the controller and app service to the domain.

**Merge rule**: If two controllers handle closely related concepts with overlapping entities (e.g. `FileController` and `FileVersionController` both operate on file content), merge them into one domain. The merged domain name must reflect both (e.g. "File & Versioning", not "File" or "FileVersion").

After assigning all controllers and app services, verify:
- Every file from Step 1 appears in exactly one domain → **coverage = 100%**
- No two domains have the same name or a name that is a prefix/suffix of another → **names are unique**

If coverage < 100%: create a catch-all domain for the uncovered files, name it clearly (e.g. "System & Configuration"), and flag it in `coverageReport.uncoveredFiles` with a note.

---

## Step 3 — Extract inter-domain relationships

For each domain, read its entity and app service to find references to other domains:

```bash
# Foreign key fields that reference other aggregates
grep -rn "Id\b" "$REPO_ROOT"/src/<DomainProject>/<Name>Entity.cs 2>/dev/null

# Cross-domain calls in app service
grep -rn "AppService\|Provider\|Repository" "$REPO_ROOT"/src/<AppProject>/<Name>AppService.cs 2>/dev/null
```

For each reference found, record a relationship:

| Relationship type | When to use |
|------------------|-------------|
| `child-of` | This aggregate has a FK to another aggregate's root (e.g. File has `folderId → Folder`) |
| `guarded-by` | This aggregate's operations check permissions owned by another domain |
| `coordinates` | This app service calls another app service to complete an operation |
| `notifies` | This domain publishes a Kafka event that another domain consumes |
| `depends-on` | This domain reads data from another domain's provider without mutating it |

---

## Step 4 — Assess domain health

For each domain, classify health:

| Health | Criteria |
|--------|---------|
| `good` | Entity has private setters, domain methods enforce invariants, no business logic in app service |
| `partial` | Entity has some methods but app service still contains some business rules |
| `anemic` | Entity is a data bag (public setters, no domain methods), all logic in app service or provider |

---

## Step 5 — Build and verify the output JSON

Assemble the output. Before writing, run the constraint checks:

```
✓ All domain names unique?
✓ Sum of controllers across all domains == total controllers found in Step 1?
✓ Sum of appServices across all domains == total app services found in Step 1?
✓ Every FK field on every entity has a corresponding relationship entry?
```

If any check fails, fix the domain list before proceeding.

Output schema:

```jsonc
{
  "service": "content-manager-service",
  "analyzedAt": "YYYY-MM-DD",
  "techStack": "C# .NET / Dapper / Postgres",
  "domains": [
    {
      "id": "file-versioning",           // kebab-case, globally unique
      "name": "File & Versioning",        // human name, globally unique
      "icon": "📄",
      "health": "anemic",               // good | partial | anemic
      "healthReason": "FileEntity has only public setters; lifecycle transitions managed in FileAppService",
      "controllers": ["FileController.cs", "FileVersionController.cs"],
      "appServices": ["FileAppService.cs", "FileVersionAppService.cs"],
      "operations": ["CreateFile", "UpdateFile", "ArchiveFile", "CreateVersion"],
      "keywords": ["file", "version", "content", "upload"],
      "aggregate": {
        "name": "FileEntity",
        "identity": "fileId (Guid)",
        "lifecycle": ["active", "archived", "deleted"],
        "valueObjects": ["FileStatus", "ContentType"],
        "childEntities": ["FileVersionEntity"],
        "invariants": [
          "A File cannot be archived unless it has at least one published version",
          "FileVersion content type must match the parent File's allowed types"
        ],
        "commands": [
          { "method": "CreateFile(actorId, request)", "raises": "FileCreated" },
          { "method": "Archive(actorId)", "raises": "FileArchived" }
        ]
      }
    }
  ],
  "relationships": [
    {
      "from": "file-versioning",
      "to": "folder",
      "type": "child-of",
      "field": "folderId",
      "description": "Every File belongs to exactly one Folder"
    },
    {
      "from": "file-versioning",
      "to": "permission",
      "type": "guarded-by",
      "description": "File operations check ContentPermissionEntity before mutating"
    }
  ],
  "workflows": [
    {
      "id": "upload-file",
      "name": "Upload File",
      "domains": ["file-versioning", "folder", "permission"],
      "steps": [
        { "label": "POST /api/files", "type": "api" },
        { "label": "Check folder permission", "type": "domain" },
        { "label": "FileEntity.CreateFile()", "type": "domain" },
        { "label": "FileCreated → Kafka", "type": "kafka" }
      ]
    }
  ],
  "integrations": {
    "kafkaIn":    ["eventbus.public.team.site-created"],
    "kafkaOut":   ["eventbus.public.content.file-created"],
    "http":       ["UMS — user identity", "VFS — file storage"],
    "background": ["FileExpirationConsumer", "ContentIndexWorker"]
  },
  "coverageReport": {
    "totalControllers": 15,
    "totalAppServices": 14,
    "coveredControllers": 15,
    "coveredAppServices": 14,
    "coveragePct": 100,
    "uncoveredFiles": []
  }
}
```

---

## Step 6 — Write output and report

Write the JSON to `docs/<service>-domain-map.json`.

Print a summary:

```
✅ Domain analysis complete: <service>
   Domains    : <N> (all names unique ✓)
   Coverage   : <N>/<total> controllers, <N>/<total> app services (100% ✓)
   Relationships: <N> inter-domain edges
   Health     : <N> good / <N> partial / <N> anemic
   Violations : <N> P0, <N> P1 (run domain-compose --refactor to see full gap analysis)
```

If coverage < 100%, list uncovered files explicitly so the engineer can investigate.
