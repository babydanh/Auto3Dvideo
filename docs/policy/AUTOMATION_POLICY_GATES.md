# Automation Policy and Quality Gates

## Gate model

A workflow can be technically executable but still unsafe, unlicensed or unpublishable. Auto3Dvideo separates execution gates from creative, rights, policy and release gates.

| Gate | Pass condition | Block condition |
|---|---|---|
| `GATE-01-CONTRACTS` | Workflow, job and outputs validate | Missing/invalid schema or cyclic graph |
| `GATE-02-RIGHTS` | All publish assets have approved scope | Unknown license, derivative or likeness status |
| `GATE-03-BUDGET` | Cost is known and reserved | Unknown cost, cap exceeded or approval missing |
| `GATE-04-EXECUTION-SAFETY` | Tool/path/args are allowlisted | Arbitrary command, path escape or unsafe download |
| `GATE-05-HUMAN-REVIEW` | Required review decisions exist | Creative, safety, disclosure or quality review pending |
| `GATE-06-DELIVERY` | Output probes/checksums/manifest pass | Invalid media, missing captions or incomplete package |

## Status semantics

`PASS` means the deterministic condition was verified. `PASS_WITH_CONDITIONS` means the package is usable only within listed limitations. `BLOCKED` means the next action must not proceed. `NEEDS_HUMAN_REVIEW` means automation cannot decide. `NEEDS_LEGAL_REVIEW` is used for rights, platform, contract or jurisdiction questions and is not a legal conclusion.

## No silent bypass

A gate may be waived only by an explicit, scoped, expiring waiver that records owner, approver, rationale, compensating control and affected outputs. A waiver cannot turn unknown rights into approved rights or authorize unsafe process execution.

## Publish gate

The publish operation is disabled in the initial release. When introduced, it requires official platform API support, account authorization, content/AI disclosure state, rights approval, user confirmation and an auditable rollback/disable path.
