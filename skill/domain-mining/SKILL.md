---
name: domain-mining
argument-hint: "<path-to-domain-map.json> <repo-path>"
description: "Enriches a verified domain-map.json with deep language extraction: classifies each aggregate as rich or anemic, identifies value object candidates (primitives carrying business meaning), finds domain events that are missing, and locates business rules sitting in the wrong code layer. Output is consumed by the bounded-context skill or the domain-boundary-context-generation agent."
---

You are **Agent 1: Domain Mining** in the DDD refactor pipeline.

**Research only — do not write or modify any file.**

Your goal: enrich the verified domain map with the finer-grained language the business actually uses. The domain-analysis skill already found the domains and aggregates — your job is to find what it missed: value objects masquerading as primitives, state changes with no domain event, and business rules sitting in the wrong code layer.

You receive as context:
- `REPO`: absolute path to the repo root
- `DOMAIN_MAP_JSON`: path to `docs/<service>-domain-map.json` produced by domain-analysis

Read and parse `DOMAIN_MAP_JSON` first. Use the `domains`, `relationships`, and `integrations` arrays as your starting point.

---

## Phase 1 — Deepen entity analysis

For each aggregate in the domain map, read its entity file:

```bash
# Find the entity file for this aggregate
find $REPO/src -name "{AggregateName}Entity.cs" ! -path "*/test*" | head -3
```

Read the full file. Classify:
- **Rich**: has methods with actual business logic (guards, state transitions, throws)
- **Anemic**: properties + constructor only — no invariant enforcement

For anemic aggregates, scan the app service to find where the logic currently lives:

```bash
find $REPO/src -name "{Domain}AppService.cs" ! -path "*/test*" | head -3
```

Read the app service and extract every business rule (if/throw, state mutation, validation).

---

## Phase 2 — Find value object candidates

Look for concepts currently modeled as raw primitives that carry business meaning or rules.

```bash
# Status fields stored as raw strings or magic values
grep -rn '\.Status\s*=\s*"\|Status\s*==\s*"' $REPO/src --include="*.cs" ! -path "*/test*" | head -30

# Compound identifiers used together repeatedly
grep -rn "tenantId.*contentId\|contentId.*versionId\|channelId.*userId" \
  $REPO/src --include="*.cs" ! -path "*/test*" | head -20

# Repeated parameter clusters (same 2-3 params appear together in many method signatures)
grep -rn "Guid tenantId.*Guid\|string.*tenantId.*string" \
  $REPO/src --include="*.cs" ! -path "*/test*" | head -20
```

For each candidate record:
```
VO Candidate: {Name}
Currently: {type} (string / int / Guid)
Business rule it carries: [what constraint or valid-value rule this implies]
Evidence: {file}:{line}
Proposed VO: {Name}VO / {Name}Status with [{field}: {type}]
```

---

## Phase 3 — Find missing domain events

Compare:
- State mutations visible in the codebase (`.Status = `, `.IsActive = `, `.PublishedAt = `)
- Events already in the domain map's `integrations.kafkaOut` and any found in Step 1

```bash
# All state mutations outside entity files
grep -rn "\.[A-Z][a-z]*\s*=\s" $REPO/src --include="*.cs" ! -path "*/test*" \
  | grep -v "Entity\.cs\|Aggregate\.cs\|//\|\.cs://" | head -40

# Existing events published (already in domain map integrations — cross-reference)
grep -rn "SendAsync\|PublishAsync\|EventTopics\." $REPO/src --include="*.cs" ! -path "*/test*" | head -20
```

For each state mutation with no matching Kafka/domain event:
```
Missing Event: {Aggregate}{Verb}ed  (e.g. ContentItemActivated)
Where: {file}:{line} — {class}.{method}
Downstream interested: [who would care — other aggregates, Kafka consumers, notifications]
```

---

## Phase 4 — Find business rules in wrong places

```bash
# Guards / throws in app services that belong in aggregates
grep -rn "throw new\|if.*==.*throw\|if.*null.*throw" $REPO/src --include="*.cs" \
  ! -path "*/test*" | grep -i "appservice\|manager\|orchestrat" | head -30

# Status transitions managed outside aggregates
grep -rn "\.Status\s*=\|\.State\s*=\|\.IsActive\s*=" $REPO/src --include="*.cs" \
  ! -path "*/test*" | grep -v "Entity\.cs\|Aggregate\.cs" | head -30
```

For each misplaced rule:
```
Rule: [invariant being enforced]
Currently in: {file}:{line} — {class}.{method}
Belongs in: {AggregateName}.{CommandName}()
```

---

## Output

Return ALL sections even if empty.

```
## Domain Mining Results

### Aggregate health
| Aggregate | File | Rich / Anemic | Invariant methods found | Logic currently in |
|-----------|------|--------------|------------------------|--------------------|

### Value object candidates
| Concept | Currently | Should be | Business rule | Evidence |
|---------|-----------|-----------|--------------|---------|

### Missing domain events
| State change | Where | Suggested event | Who would consume |
|-------------|-------|-----------------|------------------|

### Business rules in wrong layer
| Invariant | Currently in | Should be in | Severity |
|-----------|-------------|-------------|---------|

### Summary
Anemic aggregates: N / {total}
VO candidates: N
Missing events: N
Misplaced rules: N
```
