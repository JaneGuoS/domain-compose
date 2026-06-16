---
name: relationship-analysis
argument-hint: "<path-to-domain-map.json> <repo-path> <confirmed-contexts>"
description: "Analyzes the actual relationships between aggregate roots across bounded contexts by reading real code — foreign key references, HTTP calls, Kafka event flows, and shared value objects. Classifies each relationship as upstream/downstream, shared kernel, ACL site, conformist, or async event. Called by the draw-ddd-context-diagram agent before generating the context map, to ensure the diagram shows correct and meaningful inter-aggregate relationships."
---

You are the **Relationship Analysis** skill.

**Research only — do not write or modify any file.**

Your job: find the real relationships between aggregate roots and classify them correctly, so the context map can show accurate arrows instead of assumed or invented connections.

You receive:
- `DOMAIN_MAP_JSON`: path to `docs/<service>-domain-map.json`
- `REPO`: absolute path to the repo root
- `CONFIRMED_CONTEXTS`: output of the `bounded-context` skill (which aggregates belong to which context)

---

## Phase 1 — Aggregate root registry

Parse `DOMAIN_MAP_JSON`. Build a registry of every aggregate root and which bounded context it belongs to:

```
Aggregate         Context         Domain ID
ItemModel         Authoring       content-engagement
FolderModel       Authoring       folder
TeamSiteModel     Workspace       team-site
...
```

---

## Phase 2 — Foreign key / entity reference scan

For each aggregate root entity file, find references to other aggregate roots by ID:

```bash
# Find entity files
find $REPO/src -name "*Entity*.cs" -o -name "*Model*.cs" | grep -v test | grep -v migration

# For each file, find FK-style fields (GUIDs referencing other aggregates)
grep -n "Guid\|Id\b\|ItemId\|FolderId\|TeamSiteId\|UserId" <entity-file> | grep -v "//" | head -20
```

For each FK field found, determine:
- Which aggregate owns the FK (the "downstream" aggregate)
- Which aggregate the FK points to (the "upstream" aggregate)
- Whether it's a hard dependency (non-nullable) or optional reference (nullable)

---

## Phase 3 — HTTP provider call scan

From the `integrations.http` array in the domain map, and from the actual provider implementations:

```bash
# Find provider interfaces
find $REPO/src -path "*/DataAccess/*" -name "I*Provider*.cs" | grep -v test
find $REPO/src -path "*/DataAccess/*" -name "I*Repository*.cs" | grep -v test

# For each domain's provider, check if it calls into another domain's provider or table
grep -rn "I[A-Z][a-zA-Z]*Provider\|I[A-Z][a-zA-Z]*Repository" \
  $REPO/src --include="*.cs" ! -path "*/test*" | head -30
```

For each cross-domain HTTP provider call, record:
- Calling aggregate (downstream)
- Called aggregate/service (upstream)
- Method name that is called
- Whether translation is performed (→ ACL site) or model is used as-is (→ conformist)

---

## Phase 4 — Kafka event flow scan

From the domain map's `integrations.kafkaOut` and `integrations.kafkaIn` arrays:

```bash
# Find who publishes and who consumes each topic
grep -rn "eventbus\.\|EventTopics\.\|TopicConstants\." \
  $REPO/src --include="*.cs" ! -path "*/test*" | head -30
```

For each Kafka topic:
- Which aggregate publishes the event (upstream)
- Which aggregate(s) consume the event (downstream)
- Whether consumer domain translates the event or uses it directly

---

## Phase 5 — Shared value object scan

Find value objects or constants referenced by more than one aggregate:

```bash
# Find value types / enums defined in a shared location
find $REPO/src -path "*/Domain/ValueObjects*" -o -path "*/Domain/Enums*" | grep -v test | head -20

# See which aggregates import them
grep -rn "using.*ValueObjects\|using.*Enums" $REPO/src --include="*.cs" | grep -v test | head -20
```

---

## Phase 6 — Workflow co-occurrence analysis

From `DOMAIN_MAP_JSON`, for each workflow that spans multiple domains:
- Count how many workflows domains appear in together
- High co-occurrence (≥3 shared workflows) = strong coupling, likely same context
- Low co-occurrence (1 shared workflow) = loose coupling, clean event boundary

---

## Phase 7 — Classify each relationship

For every inter-aggregate dependency found in Phases 2–5, classify:

| Pattern | Criteria | Arrow style |
|---------|----------|-------------|
| **Upstream → Downstream** | A's FK points to B; A calls B's provider | Solid arrow, labelled `uses` |
| **Shared Kernel** | Both aggregates own and mutate the same concept | Double-headed dashed arrow |
| **Anti-Corruption Layer** | Downstream translates upstream's model | Solid arrow, labelled `ACL ▼` |
| **Conformist** | Downstream uses upstream's model as-is (no translation) | Solid arrow, labelled `conforms` |
| **Async Event** | Downstream consumes Kafka topic from upstream | Dashed arrow, labelled with topic name |
| **Co-workflow** | Appear together in ≥3 workflows but no direct code dependency | Dotted line (context coupling risk) |

---

## Output

```
## Relationship Analysis Results

### Inter-aggregate relationships

| From (downstream) | Pattern | To (upstream) | Mechanism | ACL? | Confidence |
|-------------------|---------|---------------|-----------|------|-----------|
| ItemModel | Upstream→Downstream | FolderModel | FK: FolderId (non-null) | No | High |
| ItemModel | Async Event | SearchIndex | Kafka: search.ingest | No | High |
| PublishingModel | ACL | ItemModel | HTTP: ContentProvider.GetItemAsync() + translation | Yes | High |
| TeamSiteModel | Upstream→Downstream | UserModel | FK: OwnerId → UMS | ACL | Medium |

### Shared kernel concepts

| Concept | Shared by | Owned by | Type |
|---------|-----------|----------|------|
| MaterializedPath | ItemModel, FolderModel | Both | Shared VO |
| TenantId | All aggregates | Infrastructure | Infrastructure VO |

### Boundary tensions (coupling that risks becoming circular)

| Tension | Aggregates | Risk | Resolution |
|---------|-----------|------|-----------|
| Bidirectional reference | ItemModel ↔ FolderModel | Circular dependency | Extract TreePath value object as shared kernel |

### Context-to-context relationship map

| From context | Pattern | To context | Mechanism | Notes |
|-------------|---------|-----------|-----------|-------|
| Authoring | Upstream→Downstream | Publishing | Kafka: content-event | Clean event boundary |
| Workspace | Upstream→Downstream | Authoring | FK guard (TeamSiteId) | ACL needed if contexts split |
| Authoring | Async Event | Analytics | Kafka: data-collection | One-way, safe |

### Confidence summary
High confidence: N relationships (code evidence found)
Medium confidence: N relationships (inferred from workflow co-occurrence)
Low confidence: N relationships (naming convention only — verify manually)
```
