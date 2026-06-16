---
name: domain-compose
description: "DEPRECATED — this file is the old monolithic skill. The current orchestrator is at skill/SKILL.md one level up."
---

# DEPRECATED

This skill file has been superseded. The current authoritative orchestrator skill is:

**`skill/SKILL.md`** — routes to sub-skills and agents.

## Current structure

```
domain-compose/
├── skill/
│   ├── SKILL.md                        ← orchestrator (this is the one to use)
│   ├── domain-analysis/SKILL.md
│   ├── domain-mining/SKILL.md
│   ├── bounded-context/SKILL.md
│   ├── relationship-analysis/SKILL.md  ← new
│   ├── ddd-target/SKILL.md
│   └── impact-analysis/SKILL.md
└── agents/
    ├── domain-boundary-context-generation.md
    ├── ddd-critic.md
    └── draw-ddd-context-diagram.md     ← composes relationship-analysis + ddd-target
```
