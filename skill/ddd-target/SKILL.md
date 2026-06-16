---
name: ddd-target
argument-hint: "<service-name> [--depth <1|2|3>] [--domain <name>] [--yes]"
description: "Generates the DDD target design per bounded context. Composes output from the domain-boundary-context-generation agent (CONFIRMED_MINING + CONFIRMED_CONTEXTS) and the relationship-analysis skill (RELATIONSHIP_MAP). Never reads raw domain-map.json directly — all inputs come from upstream pipeline stages."
---

## Inputs

This skill is called **after** the following pipeline stages have already completed:

| Input | Source | Contains |
|-------|--------|---------|
| `CONFIRMED_MINING` | `domain-mining` skill (confirmed by engineer) | Per-domain health classification (`good`/`partial`/`anemic`), VO candidates, missing events, misplaced rules |
| `CONFIRMED_CONTEXTS` | `bounded-context` skill (confirmed by engineer) | Bounded context groupings, which aggregates belong to which context, ASCII context map |
| `RELATIONSHIP_MAP` | `relationship-analysis` skill | Classified inter-aggregate relationships: pattern, mechanism, ACL flag, confidence |

If any of these are missing, halt and instruct the engineer to run the upstream stage first:
- Missing `CONFIRMED_MINING` / `CONFIRMED_CONTEXTS` → run `domain-boundary-context-generation` agent
- Missing `RELATIONSHIP_MAP` → run `relationship-analysis` skill

---

## Step 1 — Reconstruct bounded context structure

From `CONFIRMED_CONTEXTS`, build the context inventory:

```
Context: Content Authoring
  Aggregates: FileEntity, FolderModel, ContentVersionModel, ApprovalModel, ...
  Owns: core authoring lifecycle (create, version, approve, expire)
  Depends on: Workspace & Identity (access guard)

Context: Publishing
  Aggregates: PublishingModel, ChannelModel, ...
  Owns: content delivery to channels
  Upstream: Content Authoring (Kafka: content-event)
...
```

State the **core domain** (most central context), **supporting domains**, and **context boundary** — what this service owns vs. what external services own.

---

## Step 2 — Design the aggregate model for each domain

For each domain in `CONFIRMED_MINING`, using its `health`, `aggregate`, `valueObjects`, `missingEvents`, and `misplacedRules`:

```
Aggregate: {aggregate.name}
  Context:    {assigned context from CONFIRMED_CONTEXTS}
  Health:     {good ✅ Rich | partial 🟡 | anemic 🔴} — from CONFIRMED_MINING
  Identity:   {aggregate.identity}
  Lifecycle:  {aggregate.lifecycle[]} — transitions are business rules, not state flags

  Invariants (derived from health assessment):
    - "{Aggregate} cannot [verb] unless [condition]"
    - One per lifecycle gate surfaced in CONFIRMED_MINING
    - One per uniqueness/integrity constraint

  Commands (one per state-mutating operation):
    - {Verb}{Name}({actorId}, {RequestType}) → raises {Name}{Verb}ed

  Value objects (from CONFIRMED_MINING.valueObjects[]):
    - {Name}: immutable, identity by value, validated on construction

  Missing events flagged by mining:
    - {event description} — add RaiseDomainEvent call to {method}

  Misplaced rules flagged by mining:
    - {rule} currently in AppService → move to {Aggregate}.{method}()

  Relationships (from RELATIONSHIP_MAP where this aggregate appears):
    - {pattern} → {target aggregate}: {mechanism} [ACL? confidence]
```

**Do not invent relationships not present in RELATIONSHIP_MAP.** If a relationship was not verified by `relationship-analysis`, note it as `? unverified`.

---

## Step 3 — Identify domain services

A domain service is needed when a business rule spans two or more aggregates and cannot belong to either one.

For each cross-aggregate rule in `CONFIRMED_MINING.misplacedRules`:
- Can the rule be enforced by one aggregate checking the other? → no service needed, use `references` relationship
- Does the rule require coordinating state changes atomically? → domain service needed

Name pattern: `{Concept}DomainService` / `I{Concept}DomainService`

---

## Step 4 — Draw the aggregate context diagram

**Source of truth for arrows**: `RELATIONSHIP_MAP` only. Draw only High and Medium confidence relationships as solid/dashed arrows; mark Low confidence as `? unverified` with grey dotted style.

### Arrow styles by pattern (from RELATIONSHIP_MAP)

| Pattern | Arrow |
|---------|-------|
| Upstream → Downstream | Solid ──► labelled `uses` |
| Anti-Corruption Layer | Solid ──► labelled `ACL ▼` (amber) |
| Conformist | Solid ──► labelled `conforms` |
| Async Event | Dashed ──► labelled with Kafka topic name (green) |
| Shared Kernel | Double-headed ◄──► (purple) |
| Co-workflow risk | Dotted ··► `? coupling` (grey) |

### Layout

- Place the **core aggregate** (most incoming relationships in RELATIONSHIP_MAP) in the centre
- Arrange aggregates referencing the core in a ring around it
- Domain services float between the aggregates they connect
- External systems (from RELATIONSHIP_MAP mechanisms labelled HTTP/Kafka) go outside the bounded context boundary

### Box contents (per aggregate)

```
┌─────────────────────────────┐
│  «aggregate root»           │
│  FileEntity                 │  ← name in bold
├─────────────────────────────┤
│  id: fileId (Guid)          │  ← identity
│  lifecycle: active→archived │  ← lifecycle states
│  health: ✅ Rich            │  ← from CONFIRMED_MINING
│  ◯ FileStatus               │  ← value objects (pills)
├─────────────────────────────┤
│  + CreateFile()→FileCreated │  ← commands (top 3)
│  + Archive()→FileArchived   │
│  ⚠ 3 invariants             │  ← count from CONFIRMED_MINING
└─────────────────────────────┘
```

Draw a dashed outer rectangle labelled `{service} — {context name} bounded context`.

Outside it:
- Kafka OUT topics (orange boxes) from RELATIONSHIP_MAP Async Event upstream entries
- Kafka IN topics (blue boxes) from RELATIONSHIP_MAP Async Event downstream entries
- HTTP provider boxes (from RELATIONSHIP_MAP HTTP mechanism entries)

---

## Step 5 — Gap analysis

Using `CONFIRMED_MINING` as the authoritative gap source — do not re-scan code:

| Severity | Category | Source in CONFIRMED_MINING |
|----------|---------|--------------------------|
| 🔴 P0 | Anemic model | domains where health = `anemic` |
| 🔴 P0 | Layer violation | `misplacedRules` entries |
| 🟡 P1 | Missing concept | `missingEvents` entries; VO candidates not yet extracted |
| 🟡 P1 | Relationship gap | RELATIONSHIP_MAP entries marked `? unverified` |
| 🟢 P2 | Naming | Operations named as CRUD instead of intention-revealing verbs |

For each P0 and P1, produce a before/after using actual class names:

```
### {Title} — 🔴 P0

Current (violation):
  // FileAppService.cs — transition outside aggregate
  file.Status = "archived";
  await _provider.UpdateAsync(file);

Target (DDD-correct):
  // FileEntity.cs — invariant enforced by aggregate
  public void Archive() {
    if (Status == FileStatus.Archived)
      throw new DomainException(DomainExceptionType.FileAlreadyArchived);
    Status = FileStatus.Archived;
  }
  // FileAppService.cs — orchestration only
  file.Archive();
  await _provider.UpdateAsync(file);
```

---

## Step 6 — Write the DDD target design document

Write `docs/<service>-ddd-target.html`. Content by depth:

**Depth 1** — aggregate overview
- Bounded context statement (from CONFIRMED_CONTEXTS)
- Mining summary header: total domains · N rich · N partial · N anemic · N missing events
- One card per aggregate: identity, lifecycle, health badge, invariants, commands → events, VO pills

**Depth 2** (adds to depth 1)
- Child entities with fields and mutable operations
- Domain services with the cross-aggregate rule they enforce
- Application use cases: `Actor → Guard → Load → Mutate → Persist → Dispatch → Publish → Return`
- Domain exception table

**Depth 3** (adds to depth 2, feeds directly into plan + execute)
- Value object validation rules and factory signatures
- Repository interface signatures
- Exact provider method signatures needed
- DB table names and key columns

---

## Step 7 — Confirmation gate (skip if --yes)

Present:
> "🔴 N P0  🟡 N P1  🟢 N P2 — estimated N files changed · Risk: low|medium|high"
>
> A — Full refactor (P0+P1+P2)
> B — P0 only
> C — One aggregate (pick the safest starting point)
> D — Revise the design"

Wait for response. If D, update the design and re-present.

---

## Step 8 — Write refactor design doc

Write `docs/domain-refactor-<area>.md` including:
- Refactoring intent (one paragraph)
- Scope (which severity levels)
- Gap report table (from CONFIRMED_MINING + RELATIONSHIP_MAP)
- Before/after for every included violation
- Relationship changes required (ACL insertions, event boundary cleanups from RELATIONSHIP_MAP)
- Observable truths post-refactor (what must be TRUE, not how to implement it)

Then output:
> "✅ Run `/seismic-engineering:plan docs/domain-refactor-<area>.md`"
