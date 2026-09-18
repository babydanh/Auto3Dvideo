# Implementation Quality Gates

## Gate sequence

```text
G0 scope
  → G1 contracts
  → G2 local safety
  → G3 mock execution
  → G4 real tool integration
  → G5 review/evidence
  → G6 packaging
```

## Gate definitions

| Gate | Required evidence | Release blocker |
|---|---|---|
| G0 Scope | User journey, non-goals and acceptance criteria | Ambiguous product boundary |
| G1 Contracts | Valid schemas, migrations and fixture compatibility | Invalid/cyclic/unversioned contract |
| G2 Safety | Path/process/secret/download tests | Arbitrary command or secret leak |
| G3 Mock | End-to-end mock run and recovery test | Runner cannot complete without paid tools |
| G4 Tools | Health checks and real local fixture | Tool version/path/output not controlled |
| G5 Review | Creative, rights, disclosure, accessibility and cost evidence | Human/policy review missing |
| G6 Packaging | Installer, restore, upgrade, rollback and release notes | User cannot reproduce or recover |

## Change report

Every implementation change includes:

```text
problem
scope
contracts_changed
state_transitions_changed
security_impact
cost_impact
rights/policy_impact
tests_run
known_gaps
rollback
status
```

## Quality principle

A green build proves only that the tested build steps passed. It does not prove that generated media is good, assets are licensed, platform monetization is available or the workflow is safe for every machine. Those claims need separate evidence.
