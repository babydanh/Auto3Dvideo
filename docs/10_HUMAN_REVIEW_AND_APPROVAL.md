# Human Review and Approval Workflow

## Principle

Automation can prepare and validate artifacts, but a human remains the decision maker for creative quality, rights, safety, policy, paid spending and publication. The system records the decision and its scope.

## Review layers

| Layer | Reviewer question |
|---|---|
| Structural | Are required files, states, dependencies and metadata present? |
| Technical | Do media, render, captions, audio and dimensions pass validation? |
| Creative | Does the video communicate the brief with acceptable pacing and consistency? |
| Rights | Are assets, voice, likeness, music and provider terms acceptable for the target? |
| Safety | Are claims, people, sensitive topics and generated scenes safe to publish? |
| Platform | Is disclosure, format, commercial content and account context handled? |
| Release | Is the final package the intended version and is rollback/archive ready? |

## Decision states

```text
PENDING
  → APPROVED
  → REJECTED
  → NEEDS_REVISION
  → BLOCKED
```

A decision includes reviewer identity, timestamp, target entity/version, checklist result, comments, evidence links and expiry when applicable.

## Preview-first policy

Agent or automation requests that modify a timeline, import assets, start paid generation, install custom nodes, delete files or prepare publishing must first produce a preview. The user may approve, reject or ask for revision. Destructive or external actions never rely on implied approval from a previous unrelated run.

## Reviewer checklist

```text
[ ] Brief and audience remain correct
[ ] Script and claims have evidence where needed
[ ] Shot order and duration are correct
[ ] Character/object/style continuity is acceptable
[ ] Text and subtitles are accurate and readable
[ ] Audio is synchronized and rights-cleared
[ ] Asset rights/provenance are approved
[ ] AI disclosure state is correct
[ ] Delivery outputs have passed technical validation
[ ] No unintended personal data or private content is present
[ ] Publish action, if any, is separately approved
```

## Gate behavior

A missing review blocks delivery. A reviewer can approve one shot without approving the full episode. A later change to an approved input invalidates downstream approvals according to dependency impact and creates a new version rather than silently mutating history.
