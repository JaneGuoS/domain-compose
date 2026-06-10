# DDD Patterns Reference

Quick reference for concepts used in the domain-compose schema.

## Aggregate
A cluster of domain objects (entities + value objects) treated as a unit
for data changes. Has a single root entity. All external references must
go through the root. Changes are atomic — the whole aggregate is consistent.

**In C# Seismic code:** Usually a class named `<Name>Entity` with private
setters, domain methods, and a collection of child entities.

## Identity
What makes an aggregate instance unique. Often a database ID, but
domain-meaningful identities are better (e.g. `ContentObjectId + TeamSiteId`
is more informative than just `long id`).

## Lifecycle
Ordered states an aggregate transitions through. Important because:
- Transitions are business rules (you can't go backwards)
- They reveal invariants ("cannot delete while SUBMITTED")
- They expose the real domain complexity

Look for `enum <Name>Status { ... }` in C# — the values are the lifecycle.

## Value Object
Immutable object defined by its attributes, not identity. No ID.
Examples: `Email`, `ContentStatus`, `ExpirationDate`, `VersionNumber`.

In C# usually a readonly struct or record with no setter mutations.

## Command
An intent to change state. Named in imperative form: `Checkout(userId)`,
`Approve(reviewerId)`. Maps directly to a domain method.

## Domain Event
Something that happened, named in past tense: `ContentCheckedOut`,
`WorkflowApproved`. Published after a command succeeds.

## Invariant
A business rule that must always be true. Written as a plain-English
sentence: "Cannot activate unless status is READY or UPLOAD_COMPLETE".

In C# look for:
- Guard clauses at the start of domain methods: `if (Status != ContentStatus.Ready) throw new InvalidOperationException(...)`
- Conditional logic that prevents state transitions

## Domain Service
Coordinates multiple aggregates for operations that don't naturally
belong to one root. Signs you're looking at one: it takes multiple
entity IDs as parameters, or its name includes "Orchestrator", "Coordinator",
"Saga". These usually warrant their own domain in the schema.

## Repository
Persistence abstraction for an aggregate. Usually `I<Name>Repository`.
Helps identify aggregate boundaries — each repository owns one aggregate.

## Anemic Domain Model (anti-pattern)
When "entities" are just data bags with no behavior — all logic lives
in services. Signs:
- Entity has only getters/setters, no methods
- Service classes do all the logic
- No invariant enforcement in the domain

Mark health as `anemic` and note it honestly. These are refactor targets.

## DDD Violation (workflow step type: "violation")
Use this for steps in a workflow that break DDD principles:
- Setting entity state from outside the aggregate (e.g. `item.Status = X` in a Writer)
- Business logic in a Controller
- Repository calls from a domain entity
- 45-checkpoint orchestrators (a sign of big-ball-of-mud)

These are valuable to surface because they explain why the codebase is hard
to change.
