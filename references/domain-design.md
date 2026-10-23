# Domain Design

Establish the language and ownership of a concept before designing code around
it. A ByMorning domain may be a business concept, a bounded context, or a public
Core capability. In every case it needs one canonical name, a precise meaning,
and explicit authority.

## Records

Use each document for one job:

| Document          | Owns                                                             | Must Not Contain                                                       |
| ----------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `CONTEXT.md`      | Canonical terms and implementation-free meanings                 | Files, functions, databases, protocols, or implementation plans        |
| `references/*.md` | Reusable agent process and examples                              | Product-specific decisions                                            |

## Domain Gate

Use this gate when adding, renaming, or moving a concept, capability, ownership
rule, or service seam. Skip it for a routine fix that keeps established meaning
and ownership intact.

1. Read `CONTEXT.md`.
2. Trace the concept through schemas, Core, protocols, handlers, tests, and
   package-local instructions. Repository evidence answers factual questions.
3. Identify the concept's meaning, identity, owner, lifecycle, relationships,
   and invariants. Separate it from neighboring terms.
4. Test the proposed meaning with concrete scenarios, including one failure or
   edge case that distinguishes it from a neighboring concept.
5. Propose one singular, one- or two-word canonical name and definition. Surface
   conflicts with existing vocabulary explicitly.
6. Ask the user to decide the unresolved domain question and wait.
7. Once confirmed, update `CONTEXT.md` before service design begins.

Do not infer a product decision from current code merely because the code needs
an answer. Code is evidence of current behavior, not authority for an unresolved
meaning.

## Proposal Card

Use this compact form when requesting confirmation:

```text
Term: <singular one- or two-word name>
Meaning: <implementation-free definition>
Identity: <what makes one instance the same instance, if applicable>
Authority: <what this concept alone decides or owns>
Neighbors: <how it differs from the closest existing terms>
Scenario: <ordinary case>
Edge case: <case that tests the distinction>
Recommendation: <recommended decision and why>
```

Ask one decision at a time unless the user explicitly requests grouped
questions.

## ByMorning Example

`Provider` and `Model` are deliberately separate domains:

```text
Provider
  owns endpoint, request format, activation, and authentication configuration

Model
  owns one destination: its Provider, the upstream model name, and
  model-specific execution configuration
```

A Model refers to a Provider but does not own credential material. Putting
Provider authentication on Model would blur both meanings and duplicate
credential authority across destinations.

The confirmed glossary definitions belong in `CONTEXT.md`.
