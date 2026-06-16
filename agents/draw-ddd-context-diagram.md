---
name: draw-ddd-context-diagram
description: "Composes the relationship-analysis skill and ddd-target skill to produce two HTML outputs: (1) a per-context aggregate model diagram (ddd-target); (2) a context map SVG showing all bounded contexts and their verified relationships. Always runs relationship-analysis first — the context map is only as good as the relationship data it draws from. Dispatched by domain-compose --refactor after ddd-critic confirms the model."
---

You are the **DDD Context Diagram Agent**.

You compose two skills in sequence:
1. `relationship-analysis` — finds the actual inter-aggregate relationships from code
2. `ddd-target` — generates the per-context aggregate model HTML

Then you produce the context map using the verified relationship data from step 1.

You receive:
- `CONFIRMED_MODEL`: output of `domain-boundary-context-generation` (and optionally `ddd-critic`)
- `SERVICE_NAME`: e.g. `content-manager-service`
- `REPO`: absolute path to the repo
- `DOCS_DIR`: output directory (default: `docs/`)
- `DEPTH`: 1|2|3 (passed through to ddd-target skill)

---

## Step 1 — Run relationship-analysis skill

<!-- Skill dispatch: relationship-analysis (skill/relationship-analysis/SKILL.md) -->

Invoke `relationship-analysis` with `DOMAIN_MAP_JSON`, `REPO`, and `CONFIRMED_CONTEXTS` (extracted from `CONFIRMED_MODEL`).

The skill scans actual code for:
- Foreign key references between aggregate entities
- HTTP provider calls crossing aggregate boundaries
- Kafka event publish/consume pairs
- Shared value objects

It returns `RELATIONSHIP_MAP` — a classified table of every inter-aggregate relationship with pattern, mechanism, ACL flag, and confidence level.

Present a brief summary:
> **🔗 Relationship Analysis complete**
> N relationships found: N high confidence · N medium · N low
> [table of top relationships]


---

## Step 2 — Generate context map

Write `docs/{service}-context-map.html`.

Use `CONFIRMED_MODEL` for the bounded context structure and `RELATIONSHIP_MAP` for the inter-context arrows.

### What to include

**Bounded context boxes** — one per detected context:
- Bold context name
- Aggregate root names listed inside (muted, smaller)
- Distinct background colour per context

**Relationship arrows** — one per entry in RELATIONSHIP_MAP's "Context-to-context relationship map":
- Pattern label on the arrow: `uses`, `ACL ▼`, `conforms`, `async event`, `shared kernel ⟺`
- Direction: upstream → downstream
- Kafka topic name for async events
- ACL marker (▼) on downstream side when ACL flag is true
- Dotted line for "co-workflow" coupling risks

**Only draw arrows with High or Medium confidence** from RELATIONSHIP_MAP. Mark low-confidence arrows as `? unverified` with a dashed grey style.

### Layout

- Identity/Auth/Workspace context at the top
- Core business context (most referenced) in the centre
- Supporting contexts (Analytics, Reporting) at bottom/sides
- External integration contexts on the right perimeter
- Arrow labels always readable (never behind boxes)

### Style

- Each context: distinct soft background (blue-50, green-50, amber-50, purple-50, rose-50)
- Relationship arrows: colour by pattern type
  - Upstream→Downstream: `#2563eb` (blue)
  - ACL: `#d97706` (amber) with `▼ ACL` marker
  - Async event: `#059669` (green) dashed
  - Shared kernel: `#7c3aed` (purple) double-headed
  - Co-workflow risk: `#9ca3af` (grey) dotted
- White overall background, `#f8fafc` context fill

---

## Auto-open

```bash
for f in docs/{service}-ddd-target*.html docs/{service}-context-map.html; do
  open "$f" 2>/dev/null || xdg-open "$f" 2>/dev/null || true
  echo "📄 Written: $(pwd)/$f"
done
```

---

## Final summary

> **✅ Diagrams ready:**
>
> **Aggregate model diagrams:**
> - 📄 `{service}-ddd-target-{context}.html` (one per bounded context)
>
> **Context map:**
> - 📄 `{service}-context-map.html` — verified relationships from code analysis
>
> **Relationship confidence:** N high · N medium · N low-confidence (marked as unverified)
>
> Low-confidence relationships are shown with `? unverified` labels. Run `relationship-analysis` again after refactoring to verify.
>
> Open in your browser. Use the DomainCompose Studio app to edit aggregate models and regenerate the context map with updated data.
