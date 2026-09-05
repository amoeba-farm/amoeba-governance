# V3 council core deployed on Devnet

Finalized verification at slot **493766911**, 2026-09-05 22:53:05 UTC.

| Item | Verified value |
| --- | --- |
| Program | `8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx` |
| ProgramData | `7eW9UXcCDrpEAQ93fP7o2zgGMKhAKi3zJLihELjR8xYd` |
| Council config | `Ec5H8jsGvaLU3T3gp6qTayPjY2qF3geBbVKWz4rsaEHB` |
| Live upgrade authority | `Frc28QFQxqUxF9HPgzcmm5VkqorqUb2LeLPE5uKU6Ycp` (council PDA) |
| Council | Existing five Devnet KMS seats; any three approve |
| Approval window | 1,512,000 slots, approximately one week |
| Execution delay | 4,500 slots from proposal creation |
| Proposal expiry | 2,592,000 slots from proposal creation |
| Artifact | 169,912 bytes |
| Artifact SHA-256 | `6e48e439f2f3532d5b82505b231aac5e88ffadd462b063a93f78b1c75b6fd4b7` |
| Source commit | `913b95ca612d18fc985a619e2152a5b3386be4f7` |

[Deployment transaction](https://explorer.solana.com/tx/2gNt2kMJnQAKmDmViYQ8S9XtVnjUzuru36PuVyJE6CJQg592LMttNSKiamFgN7LVz4KgRV8jwyHidcQpAugu73Mn?cluster=devnet)
and [council initialization](https://explorer.solana.com/tx/iQshrLYoiWtQwFNVfVkfk3SsqBGLHwZPhKVy8VMgmWPKw5pviLsx8Y7vdjriQyLxL8U2YGxCWyG2CfzmgSyDULv?cluster=devnet)
both finalized successfully. Initialization carried the payer, temporary deployer,
and three KMS seat signatures. ProgramData now retains an upgrade authority;
the temporary deployer no longer controls it.

The live ProgramData payload exactly matches the attested local artifact. Config
was decoded with the strict V3 client and its identities, five seats, treasury,
timing and initial epoch/version were checked. The [receipt](receipt.json)
contains the finalized observations and transaction statuses.

Four focused Rust tests, two TypeScript tests, TypeScript typechecking, and one
actual-SBF self-upgrade rehearsal passed. The rehearsal includes buffer
verification, approvals after 450 slots, rejection of two-seat execution,
ProgramData growth, successful three-seat self-upgrade, and a subsequent
instruction using the upgraded program. The full historical Release 1 suite
was not run. Dependency stack diagnostics were confined to 17 functions absent
from the final linked ELF; [the diagnostic record](sbf-diagnostics.json) retains
that distinction rather than reporting a warning-free dependency build.

The public Devnet RPC rate-limited the CLI's batched buffer writes. The same
buffer and program identity were retained; the upload completed using paced,
800-byte writes, refreshed blockhashes every four submissions, and a finalized
byte-for-byte buffer comparison. Deployment then used that exact prewritten
buffer. No additional program deployment was used as an intermediate step.
Private keys and upload/signing journals remain in the secure local run directory;
none are included in this evidence folder.

This is the first, self-governing council core. It currently governs its own code,
timing and council rotation. **Existing Spread still uses the old controller.**
External target registration, a Spread gate and replacement Spread integration
remain subsequent work. Existing V2 code, Spread state, and GETC economics were
not changed by this deployment.
