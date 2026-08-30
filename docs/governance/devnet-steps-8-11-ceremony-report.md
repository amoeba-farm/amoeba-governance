# Devnet Steps 8–11 ceremony prerequisite-stop report

Status: **STOPPED BEFORE STEP 8 — HARD PREREQUISITES 1–7 ARE ABSENT**

Ceremony ID: `20260830T024123Z-prerequisite-stop`

This report applies the hard first gate in
`Amoeba_Devnet_Governance_Steps_8_to_11_Agent_Spec.md`. The assignment allows
Steps 8–11 only after all seven earlier on-chain stages already exist on Devnet.
They do not. No attempt was made to backfill them.

## 1. Assignment identity and source inputs

The assignment file is 31,471 bytes, 1,130 lines, SHA-256
`c116e43808af64f1c366443e1a80ca227c2bcd0cfc9cddc182f70dfe596d4edd`.

| Input | Governance | Spread |
|---|---|---|
| Repository | `SPACE999978/ameba_gov` | `SPACE999978/ameba_spread` |
| PR | [#1](https://github.com/SPACE999978/ameba_gov/pull/1) | [#20](https://github.com/SPACE999978/ameba_spread/pull/20) |
| Head | `52642f787bdd234469cb04efbd90332ff514e0aa` | `ad225990ef72726a58aef8810263fad5503af218` |
| Base | `c2771a7a74c895bbb9a81ba38273e19ac25931ea` | `88c067ae6f2901131698be1e12fdff6f259b361b` |
| Changed files | 81 | 95 |
| Reviews | 0 | 0 |
| Review threads/open | 0/0 | 0/0 |
| State | open, mergeable, `UNSTABLE` | open, mergeable, `UNSTABLE` |
| Local worktree at preflight | clean, exact remote feature head | clean, exact remote feature head |

## 2. Hosted CI and audit preflight

Hosted CI is not green. Governance runs `33286547021` and `33286530344`
each contain two failed jobs with zero executed steps. Spread runs
`33286555175` and `33286529997` each contain four failed jobs with zero
executed steps. No billing waiver was invoked: the on-chain prerequisite gate
failed before ceremony admission, so rerunning the full local waiver suite
would not authorize Step 8.

There are no submitted reviews, no review threads, and no independent external
audit. The absence of an external audit could be represented by the assignment's
Devnet-only audit waiver only after the other gates pass; it does not cure the
missing on-chain stages.

## 3. Reviewed identity is deliberately unselected

The exact Spread-head identity manifest, SHA-256
`7a8fb47f58011c19ec7522a11893bb13b6709dc4c0b0bca22735dc52196208e3`,
states:

- status `unselected` and identity generation `0`;
- controller Program, controller config PDA, and protocol gate PDA are `null`.

Its review record, SHA-256
`e9ff5083c40733fd0ee04a4f4f36f1f757e592f2bc6d1601ad1f98a40303c19a`,
states `pending-selection`, has zero independent reviews, sets
`productionUseAuthorized` to false, and leaves the reviewed source commit,
controller artifact, deployed ProgramData, immutability receipt, and Spread
bridge-plan commitments null.

The tracked Devnet deployment manifest is `preproduction-blocked`; its source,
artifact, ProgramData, upgrade, and validation evidence is null. The tracked
release intent has `deploymentEnabled: false`, no final artifact identity, and
`upgradeAuthorized: false`.

## 4. Finalized Devnet observation

Read-only observation used `https://api.devnet.solana.com`, commitment
`finalized`, and verified genesis
`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.

At observation context slot `490199962`:

| Field | Value |
|---|---|
| Spread Program | `9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH` |
| Loader | `BPFLoaderUpgradeab1e11111111111111111111111` |
| ProgramData | `2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3` |
| Current upgrade authority | `D5jhTM3kYHdKixrc52Kn657gBHytQLhQqsTmJBcNFVdq` |
| Last deploy slot | `487702729` |
| Payload capacity | `1,241,776` bytes |
| Raw ProgramData length | `1,241,821` bytes |
| Raw ProgramData SHA-256 | `5eef434e2b02d70e3776fe2b7b624be3e87d56884ab74145929fbe1d65b3fb02` |
| Capacity-wide payload SHA-256 | `bcc76952d9f57a63b0853a372c57bb32e90b0d851d7ba90c252d88be73b54191` |
| Trailing zero bytes | `99,127` |

The current legacy authority is still present, which is consistent with the
ceremony not having reached handoff. It is not proof of Step 7.

No reviewed bridge artifact hash exists, so exact deployed-byte comparison is
impossible. The capacity-wide payload does not contain the Phase 3 synthetic
marker, the local-ceremony marker, or the gate discriminator as an ASCII
substring. Their absence is not positive bridge evidence and cannot substitute
for an exact artifact commitment.

The two tracked local bridge candidates also rule themselves out. At finalized
context slot `490201962`, the first `1,154,184` live payload bytes hash to
`c112d21a8830b318e67a690d08fffdb58609f0215c59e1de528248c93ecc1bc2`,
not the tracked SBPF-v0 candidate hash
`7b29416cba304909b5546aa4726aedbf7fb7a9b4e506d7292f171f5afcb20749`.
The tracked SBPF-v2 candidate is `1,281,248` bytes, which exceeds the live
payload capacity by `39,472` bytes. Neither tracked candidate is the deployed
bridge.

The synthetic fixture controller address
`4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi` is a System-owned,
non-executable, zero-data account—not an SBF controller. Its fixture config PDA
`DeXoJJjvjQ8zbw9Dv6YeAiYJfx6UvQzFnZ4k8b6ZkYQK` and fixture gate PDA
`DKhD62NUwnURpbvxnrqvvfqTG7zix9nWn1j72r4k1jw1` do not exist on Devnet.
The separate local-ceremony fixture controller
`8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR` is likewise System-owned,
non-executable, and zero-data; its config
`FYdLuzfpWBibs7g8K6e5qwvBKPSrDQGWKEPoM1rtTqsX` and gate
`EFgLaszu2GXC7zo5Q4pcg2hGfhZULSjUKhsit5PczQWf` are absent.

## 5. Mandatory prerequisite result

| Required earlier stage | Result | Evidence |
|---|---|---|
| 1. Chosen controller identity/source/artifact fixed | **FAIL** | Reviewed identity is unselected; all identity/artifact fields are null. |
| 2. Five seats, guardian, and treasury fixed | **FAIL** | No reviewed identity or initialized governance-root manifest fixes these live addresses. |
| 3. Controller deployed | **FAIL** | No reviewed controller Program ID exists; the synthetic fixture address is not executable. |
| 4. Exact Bootstrap V1 initialization | **FAIL** | No reviewed deployed controller or canonical config address exists. |
| 5. Canonical initialization-only frozen gate | **FAIL** | No canonical gate address exists to observe; the fixture gate account is absent. |
| 6. Controller made immutable | **FAIL** | No controller ProgramData or immutability receipt exists. |
| 7. Exact Spread bridge installed | **FAIL** | No reviewed bridge artifact/controller identity exists for exact comparison. |

This is a Gate-A-style prerequisite failure. The Steps 8–11 assignment
explicitly prohibits implementing or improvising the missing earlier stages.

## 6. Ceremony step status and side-effect boundary

| Stage | Status |
|---|---|
| Step 8 — census/quiescence | **NOT STARTED** |
| Step 9 — authority handoff | **NOT STARTED** |
| Step 10 — former-authority negative test | **NOT STARTED** |
| Step 11 — governed activation | **NOT STARTED** |

No signer capability was requested or acquired. No RPC write, simulation for
submission, transaction signature, deployment, authority change, service
mutation, writer stop/start, lock acquisition, or Mainnet action occurred.
Read-only services and mutation writers were left in their pre-existing states;
this report makes no unmeasured health claim about them.

Because the reviewed controller identity has no canonical gate address, a live
gate state cannot truthfully be asserted. The ceremony made no state change.

Evidence is in
`evidence/devnet-governance-activation/20260830T024123Z-prerequisite-stop/`.

## 7. Safest next design

A separate, explicit Steps 1–7 ceremony must first select and independently
review a real Devnet controller identity and exact artifacts; fix five real
seat capabilities, guardian, and treasury; deploy and initialize the controller;
prove the bootstrap-only frozen gate; remove controller upgrade authority; and
install and independently verify the exact Spread bridge while the legacy
authority remains current. Only then can this Steps 8–11 assignment be rerun.

Mainnet remains unauthorized.

In the assignment's mandatory fixed stop vocabulary, “gate remains frozen”
means no activation was attempted; it is not an assertion that a canonical gate
account was found.

DEVNET CEREMONY STOPPED SAFELY AT STEP 8; GATE REMAINS FROZEN.
