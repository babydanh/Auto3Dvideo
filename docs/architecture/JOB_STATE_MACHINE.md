# Job State Machine

## States

```text
DRAFT → READY → WAITING_APPROVAL → QUEUED → RUNNING → SUCCEEDED
                                                ├→ FAILED
                                                ├→ CANCELLED
                                                └→ BLOCKED
SUCCEEDED → INGESTING → REVIEW_REQUIRED → APPROVED → DELIVERED
```

`EXPIRED` is used for a lease or approval that passed its expiry. `SKIPPED` is used only when a graph explicitly permits a stage to be skipped and records the reason.

## P0 persisted state contract

The initial SQLite/Tauri implementation persists a deliberately smaller, lowercase state set so the mock runner can be tested without starting external workers: `draft`, `queued`, `running`, `succeeded`, `failed`, `cancel_requested` and `cancelled`. The uppercase lifecycle above remains the target architecture for approval, ingestion, review and delivery phases; it is not yet presented as implemented behavior.

| From | To | P0 rule |
|---|---|---|
| `draft` | `queued` | Recipe/project inputs have passed the local boundary |
| `queued` | `running` | Mock/native runner claims the job |
| `queued` | `cancelled` | User cancels before a worker starts |
| `running` | `succeeded` | The bounded mock path completes successfully |
| `running` | `failed` | An approved failure path records an error and finish time |
| `running` | `cancel_requested` | User asks a running worker to stop |
| `cancel_requested` | `cancelled` | Cancellation is acknowledged |
| `failed` | `queued` | User invokes retry; the attempt counter is preserved |

`cancel_requested` is intentionally separate from `cancelled`: a future worker must acknowledge process termination before the terminal state is recorded. P0 exposes the command boundary and audit event, but does not yet supervise a real process.

## Valid transitions

| From | To | Condition |
|---|---|---|
| `DRAFT` | `READY` | Inputs and contract validate |
| `READY` | `WAITING_APPROVAL` | Policy requires human decision |
| `READY` | `QUEUED` | No approval is required |
| `WAITING_APPROVAL` | `QUEUED` | Approval is recorded |
| `WAITING_APPROVAL` | `BLOCKED` | Reviewer rejects or scope is unsafe |
| `QUEUED` | `RUNNING` | Resource lease acquired |
| `RUNNING` | `SUCCEEDED` | Exit/output validation passes |
| `RUNNING` | `FAILED` | Process/provider/output failure |
| `RUNNING` | `CANCELLED` | Cancellation completed or forced |
| `RUNNING` | `EXPIRED` | Lease expires and process state is unknown |
| `FAILED` | `QUEUED` | Retry policy and reconciliation permit retry |
| `EXPIRED` | `QUEUED` | Reconciliation proves retry is safe |
| `SUCCEEDED` | `INGESTING` | Output ingestion begins |
| `INGESTING` | `REVIEW_REQUIRED` | Output is present and policy review is needed |
| `REVIEW_REQUIRED` | `APPROVED` | Human accepts output |
| `APPROVED` | `DELIVERED` | Delivery validation passes |

## Transition invariants

Transitions are transactional. Every transition has an actor (`system`, `user`, `agent` or `provider`), cause, timestamp and event ID. Invalid transitions are rejected; clients must refresh state rather than guessing. A state transition never deletes output or evidence. In P0, each native transition writes a bounded `job.transition` audit event; richer actor/cause payloads are reserved for the durable executor slice.

## Recovery semantics

On restart, the runner rehydrates nonterminal jobs. `QUEUED` jobs can be requeued. `RUNNING` jobs require lease/process reconciliation. A provider job with a known external ID is checked before a new submission. Jobs with unknown paid side effects become `RECONCILIATION_REQUIRED`/`BLOCKED` until a safe outcome is known.
