---
name: ddd-target
argument-hint: "<service-name | path-to-domain-map.json> [--depth <1|2|3>] [--domain <name>] [--yes]"
description: "Takes a verified domain map JSON (output of domain-analysis) and produces a DDD target design: aggregate context diagram, per-aggregate model cards, gap analysis, and a refactor plan doc. Relationships between aggregates are derived from the domain map's relationships array — never from workflow sequences."
---

## Input

Requires a verified `docs/<service>-domain-map.json` produced by the `domain-analysis` skill.
The `relationships` array in that JSON is the authoritative source for inter-aggregate connections.

If the file doesn't exist, run `domain-analysis` first.

---

## Relationship types and their diagram representation

The `relationships` array uses these types. Each maps to a specific arrow style in the aggregate context diagram:

| Type | Meaning | Arrow style |
|------|---------|-------------|
| `child-of` | This aggregate has a mandatory FK to another aggregate's root. The child cannot exist without the parent. | Filled diamond (composition) ◆── |
| `references` | This aggregate stores an optional FK to another aggregate. Looser coupling than child-of. | Open arrow ──► |
| `guarded-by` | This aggregate's commands call a permission/policy aggregate before mutating state. | Dashed arrow - - ► labelled "checks" |
| `coordinates` | An app service or domain service orchestrates both aggregates together. | Double-headed arrow ◄──► labelled "coordinates" |
| `notifies` | This aggregate raises a domain event that another aggregate consumes. | Orange arrow ──► labelled with event name |
| `depends-on` | This aggregate reads data from another aggregate's read model or provider. | Grey dashed arrow - - ► labelled "reads" |

**Critical rule**: Relationships come ONLY from the `relationships` array. Never infer relationships from workflow step sequences — workflows describe runtime orchestration, not domain model structure.

---

## Step 1 — Define bounded context

From the domain map `boundedContext` field, state:
- **Core domain**: the primary business capability (what this service uniquely owns)
- **Supporting domains**: areas that support core but could be separated
- **Context boundary**: what this service owns vs. what external services own

---

## Step 2 — Design aggregate model for each domain

For each domain in the map, using the domain's `aggregate`, `relationships`, and `operations`:

```
Aggregate: {aggregate.name}
  Identity:   {aggregate.identity}
  Lifecycle:  {aggregate.lifecycle[]} — transitions are business rules, not just state flags
  
  Invariants (derived from health assessment and operations, not from current code):
    - "{Aggregate} cannot [verb] unless [condition]"
    - One invariant per lifecycle transition gate
    - One invariant per uniqueness or integrity constraint visible in operations
  
  Commands (one per state-mutating operation):
    - {Verb}{Name}({actorId}, {RequestType}) → raises {Name}{Verb}ed
  
  Value objects (from aggregate.valueObjects[]):
    - {Name}: immutable, identity by value, validated on construction
  
  Child entities (from aggregate.childEntities[]):
    - {Name}: has identity, belongs to exactly this aggregate, not shared
  
  Relationships (from domain map relationships[] where from == this domain):
    - {type} → {target domain}: {description}
```

**Do not add relationships that are not in the domain map `relationships` array.** If a relationship is missing from the domain map, note it as a gap rather than inventing it.

---

## Step 3 — Identify domain services

A domain service is needed when a business rule spans two or more aggregates and cannot belong to either one.

For each cross-aggregate invariant in the gap analysis, decide:
- Can the rule be enforced by one aggregate checking the other via its interface? → no service needed, use `references` relationship
- Does the rule require coordinating state changes in two aggregates atomically? → domain service needed

Name pattern: `{Concept}DomainService` / `I{Concept}DomainService`

---

## Step 4 — Draw the aggregate context diagram

**Source of truth for arrows**: the `relationships` array only. No workflow-derived arrows.

### Layout

- Place the **core aggregate** (most incoming `references`/`child-of` relationships) in the centre
- Arrange aggregates that reference the core in a ring around it
- Aggregates with no relationships to others go on the periphery
- Domain services float between the aggregates they connect
- External systems (HTTP providers, Kafka) go outside the bounded context boundary

### Box contents (per aggregate)

Each aggregate box is a UML-style class box with three compartments:

```
┌─────────────────────────────┐
│  «aggregate root»           │
│  FileEntity                 │  ← name in bold
├─────────────────────────────┤
│  id: fileId (Guid)          │  ← identity
│  lifecycle: active→archived │  ← lifecycle states
│  ◯ FileStatus               │  ← value objects as pills
│  ◯ ContentType              │
├─────────────────────────────┤
│  + CreateFile()→FileCreated │  ← commands (top 3)
│  + Archive()→FileArchived   │
│  ⚠ 3 invariants             │  ← invariant count
└─────────────────────────────┘
```

Child entities appear as smaller dashed boxes attached below the parent aggregate box.

### Arrows

Draw one arrow per entry in the `relationships` array:

```
child-of    ◆────────►  (filled diamond at child end, arrow at parent)
references  ────────►   (open arrowhead)
guarded-by  - - - - ►  (dashed, labelled "checks")
coordinates ◄── ──►    (double arrow, labelled with domain service name)
notifies    ────────►  (orange, labelled with event name)
depends-on  · · · · ►  (grey dotted, labelled "reads")
```

Label every arrow with the `field` (if present) or `description` from the relationship entry, truncated to 20 chars.

### External boundary

Draw a dashed outer rectangle labelled "{service} — bounded context".

Outside it, on the right edge:
- Kafka OUT topics as orange rounded boxes labelled with short topic name
- Kafka IN topics as blue rounded boxes

Outside it, on the bottom edge:
- HTTP provider boxes labelled with provider name (from `integrations.http[]`)

---

## Step 5 — Gap analysis

Assess DDD violations against the target design:

| Severity | Category | What to look for |
|----------|---------|-----------------|
| 🔴 P0 | Anemic model | Entity has public setters; lifecycle transitions happen outside entity methods; invariants checked in AppService |
| 🔴 P0 | Layer violation | Domain layer imports infrastructure namespace; AppService constructs domain objects with `new` instead of factory |
| 🟡 P1 | Missing concept | Status as raw string instead of value object; no domain event raised for state transitions; cross-aggregate FK without a relationship entry |
| 🟡 P1 | Relationship gap | FK field exists on an entity but no corresponding entry in the `relationships` array |
| 🟢 P2 | Naming | Entity method named as CRUD (`Update`) instead of intention-revealing (`Publish`, `Archive`) |

For each P0 and P1, produce a before/after using actual class names from the domain map:

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

Files affected:
  - Move: FileAppService.cs lines ~45 → FileEntity.cs
  - Add: DomainExceptionType.FileAlreadyArchived
```

---

## Step 6 — DDD target design document

Write `docs/<service>-ddd-target.html`. Content by depth:

**Depth 1** — aggregate overview
- Bounded context statement
- One card per aggregate: identity, lifecycle, invariants (plain English), commands → events, value object pills

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
- Gap report table
- Before/after for every included violation
- Observable truths post-refactor (what must be TRUE, not how to implement it)

Then output:
> "✅ Run `/seismic-engineering:plan docs/domain-refactor-<area>.md`"

---

## Relationship gap detection

After Step 2, scan all aggregate fields for FK patterns not covered by a relationship entry:

```
For each domain D:
  For each field in D.aggregate matching pattern *Id, *Key, *Reference:
    If no relationship entry exists where from==D.id and field==that fieldName:
      Flag as P1 gap: "Missing relationship: {D.name}.{field} → (unknown target)"
      Suggest: "Add relationship entry — likely type 'child-of' or 'references'"
```

This catches the case where domain-analysis missed a relationship.
