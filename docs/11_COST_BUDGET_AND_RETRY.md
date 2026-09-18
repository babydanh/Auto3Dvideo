# Cost, Budget and Retry Policy

## Purpose

Prevent accidental spending and turn generation quality into a measurable production metric. The workflow tracks cost by provider, model, job, shot, episode and accepted output.

## Cost classes

| Class | Example | Accounting |
|---|---|---|
| `free_local` | Blender, FFmpeg, local ComfyUI | Time, electricity and hardware usage |
| `free_tier` | Limited cloud credits | Quota and terms are recorded; not assumed unlimited |
| `paid_api` | Per-second/per-request video generation | Estimate before submit and record actual |
| `subscription` | Monthly tool plan | Record plan period and allocated quota |
| `human_time` | Editing, review and rights work | Optional estimate for project planning |

## Budget fields

```text
budget_id
project_id
period
currency
limit
reserved
spent
remaining
approval_required
last_calculated_at
```

## Guard rules

1. A paid job with unknown cost is blocked.
2. A job cannot reserve more than the remaining budget without explicit override.
3. A retry creates a new attempt but is charged to the same logical job.
4. A lost provider response triggers reconciliation before a new request.
5. The queue stops accepting new paid work when the cap is reached.
6. Budget overrides require actor, reason, scope and expiry.

## Quality-adjusted metric

```text
cost_per_accepted_shot = total_attempt_cost / accepted_shot_count
```

Track this alongside latency, retries and reviewer score. A cheaper provider is not better if it produces fewer usable shots.

## Retry policy

| Error | Retry |
|---|---|
| Validation error | No; fix input |
| Missing local dependency | No; install/repair after approval |
| Timeout before external submit | Yes, bounded |
| Provider 429/transient network | Yes with backoff |
| Provider job submitted, response lost | Reconcile first |
| Unsafe/rights/policy rejection | No automatic retry |
| Output quality rejection | Human chooses new prompt/version |
| Process crash | One controlled retry after logs |

## Example defaults

```yaml
budget:
  monthly_usd: 0
  per_episode_usd: 0
  require_approval_for_paid: true
retry:
  max_attempts_per_shot: 3
  exponential_backoff_seconds: [5, 30, 180]
  retryable_errors: [TIMEOUT, NETWORK, RATE_LIMIT]
  reconcile_unknown_submissions: true
```

These are safe defaults, not provider pricing. The user must change them intentionally.
