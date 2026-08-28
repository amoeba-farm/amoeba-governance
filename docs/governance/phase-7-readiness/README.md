# Phase 7 readiness pack

This directory contains planning and independent-verification artifacts only.
It does not authorize or perform controller deployment, controller
initialization, controller immutability, Spread bridge activation, ProgramData
authority handoff, transaction signing, or any live RPC write.

Every identity field remains an explicit placeholder. The Release 1 tooling
must reject these templates, the repository's synthetic test controller
identity, default public keys, and any manifest whose cluster/genesis identity
has not been independently confirmed.

The readiness artifacts are:

1. [Production identity checklist](production-identity-checklist.md)
2. [Controller deployment manifest template](controller-deployment-manifest.template.json)
3. [Controller initialization manifest template](controller-initialization-manifest.template.json)
4. [Controller immutability verification plan](controller-immutability-verification-plan.md)
5. [Spread bridge release plan](spread-bridge-release-plan.md)
6. [ProgramData authority handoff plan](programdata-authority-handoff-plan.md)
7. [Old-authority negative-test plan](old-authority-negative-test-plan.md)
8. [Rollback rehearsal plan](rollback-rehearsal-plan.md)
9. [Receipt-v3 checklist](receipt-v3-checklist.md)
10. [Operator runbook](operator-runbook.md)

The intended future ceremony order remains:

```text
deploy controller
-> initialize exact config/policy/council/frozen gate
-> independently verify state and artifact
-> make controller immutable
-> install and verify Spread bridge
-> transfer target ProgramData authority
```

No step may be reordered merely to make a rehearsal pass. In particular,
initialization precedes controller immutability, and the target remains frozen
until the bridge and authority graph have been independently verified.
