# Release 1 local ceremony receipt

Status: **PASS — COMPLETE LOCAL HAPPY-PATH CEREMONY; NOT PRODUCTION EVIDENCE**

This receipt records one identity-bound Release 1 ceremony against a
sacrificial target on an ephemeral loopback `solana-test-validator`. It proves
the local happy path and the former-authority negative case. It does not close
the separate V3 rollback-execution or all-candidate chunk-benchmark blockers.

No Devnet or Mainnet endpoint, production identity, production key, service,
deployed Spread ProgramData, or live authority was read or mutated. The
validator was stopped after read-only receipt recovery.

## Source and artifact binding

| Item | Value |
|---|---|
| Governance baseline | `c2771a7a74c895bbb9a81ba38273e19ac25931ea` |
| Governance runtime-source candidate | `1ff442252907a017913d47591c1857c2e4df3f0b` |
| Governance checkout at launch | `af716231fff6be583eb5ba1ed168a93830effad3` plus the local harness-only Node lookup patch |
| Spread ceremony checkout | `0db82a79204c45edb69fffea603a9ab16c6c74d0` |
| Controller SBPF v2 artifact | 1,109,432 bytes, `4ee8bc7221f23d533d92eea797cd0b7ab67fb708603cf9ef7475f59a4ebd2c5d` |
| Identity-bound Spread SBPF v2 artifact | 1,282,184 bytes, `efd4f8ce4fe8ca9d16d5b97247e6065e47ba3e65a862c6dccc61095cbe2032b2` |
| Evidence directory | `C:\Users\space\.codex\artifacts\release1-ceremony\standalone\run-33713-1788028908930` |
| Validator genesis | `HapSrKJED3yquB9drG3L6MgYGdr9Pp1c82q9ojTRTT8N` |
| Cluster-domain bytes | `f664cdf63e77456fb7eb0328d3cef06fce9b09d86c9498bdfaba61f7f0eee8a3` |
| On-chain trace duration | approximately 2,424.29 seconds |

The deterministic identities are local fixtures and are release-forbidden:

| Role | Identity |
|---|---|
| controller Program | `8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR` |
| controller ProgramData | `6QqhM6ffwu1gjQ5Da5wqjSFmQZeoh4Gmyb6hAxBUcYAH` |
| controller config | `FYdLuzfpWBibs7g8K6e5qwvBKPSrDQGWKEPoM1rtTqsX` |
| controller authority PDA | `7SWLoH1skyksSu44K7aroPs8gDDoMHeV8Pyk7X1Aaohh` |
| sacrificial target Program | `9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH` |
| sacrificial target ProgramData | `2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3` |
| former target authority | `EZuaS642kkJk7GV9KhfJ4ZHa6yTX6qrBAGRsvFAMme1Y` |

## On-chain result

The controller SBF completed this exact sequence through real Loader-v3
behavior:

1. initialize the controller in the canonical frozen bootstrap state;
2. observe controller ProgramData and make the controller immutable;
3. record the immutable-controller receipt;
4. observe the target bridge artifact;
5. approve, queue, and execute checked `SetAuthorityChecked` handoff;
6. submit a separately signed old-authority direct upgrade and require failure
   with unchanged target and buffer bytes;
7. approve, queue, and execute bootstrap activation;
8. create and seal primary and rollback proposals and buffers;
9. approve, queue, freeze, and accept protected prestate;
10. execute one durable-nonce v0 controller transaction containing the typed
    Loader Upgrade CPI;
11. mechanically verify deployed ProgramData and zero tail;
12. accept protected poststate, separately approve unfreeze, and unfreeze;
13. retire the prepared rollback; and
14. execute the first Spread mutation through the active canonical gate.

Key transaction facts:

| Fact | Value |
|---|---|
| checked handoff accepted slot | `1968` |
| former-authority failed attempt slot | `1968`, later transaction in the same slot |
| bootstrap activation slot | `3305` |
| activation gate epoch | `1 -> 2` |
| governed upgrade slot | `5259` |
| complete frozen-lifecycle final gate epoch | `4` |
| message version | v0 |
| lookup table | `HkdJHt4hAbJqTpuVFtpMD7x6gbcuaLtgzqznpmysqP5G` |
| durable nonce authority | `3eurDeWCx97QWeMBEqsEvHKgCUTDKN4ojRsLm2hjTx8r` |
| upgrade signature | `afb4698cd7ff67b68e7c71b32c7e24dbb282453cbc9fa62e904c6905d351444f409ad7185295cdb4436b54f4ceeb5bfacaa482381ea52c5eec56113fef753304` |

The same-slot negative test is valid because transaction ordering and observed
post-handoff authority state, rather than a slot increment, prove that the
former-authority transaction followed handoff. The receipt requires that the
attempt not predate handoff, fail with the controller PDA still authoritative,
and leave the exact raw target root unchanged.

## Independent receipt v4 result

The finalized receipt contains the twelve fixed ceremony-account snapshots,
their exact bytes and SHA-256 values, checked Loader CPI evidence, the failed
former-authority transaction, bootstrap activation, and the subsequent
controller-PDA upgrade event.

The independent verifier returned:

```json
{
  "valid": true,
  "receiptDigest": "faae42ced84225366d4ef5eb99bdfe69aaa1094e000756195382e08bd477cb11",
  "controllerImmutable": true,
  "checkedHandoff": true,
  "bootstrapActivated": true,
  "oldAuthorityRejected": true,
  "capacity": "1282184",
  "finalGateEpoch": "2"
}
```

`finalGateEpoch` in receipt v4 is the bootstrap-activation epoch. The separate
transaction evidence binds complete upgrade/unfreeze epoch `4`.

| Evidence file | Bytes | SHA-256 |
|---|---:|---|
| `receipt-v4-material.json` | 25,447 | `4bff22093217bad565d6c9f390dbebb6b683971ebc3d45e3a496311e47153717` |
| `standalone-transaction-evidence.json` | 440 | `d8b126f8668f366e8d1369c89ea1e7621057bbd53466c7d86ec3b3b8a2c51a89` |
| `receipt-v4.json` | 25,535 | `ed79983416c131dafd6e659c6012b693ae36e3198095c2754ed3456b57fdbaff` |
| `receipt-v4-verification.json` | 276 | `80f1bd9edb80ec3d29e969930485515194c30237759eb4822df1c1c150704529` |

## Recovery audit

The original Rust test wrapper completed every on-chain action and persisted
the receipt material and transaction evidence, then failed while spawning the
checked-in TypeScript finalizer because `node` was not present on the WSL child
process PATH. No transaction failed and no on-chain step was repeated.

Recovery exposed and corrected four off-chain parity issues:

- the receipt verifier now recognizes the dedicated local ceremony controller
  identity while rejecting both synthetic identities in production mode;
- the TypeScript Loader header parser mirrors Rust and real Loader v3: after
  authority becomes `None`, the fixed metadata region may retain old key bytes;
  those bytes remain raw-committed but have no authority semantics;
- a failed old-authority transaction may finalize later in the same slot as
  handoff; and
- the executable accepts an explicit Windows absolute adapter path without
  mistaking the drive letter for a URI scheme.

The preserved ledger was restarted without `--reset` only to serve finalized
read-only RPC. Two fresh CLI processes independently verified the same receipt,
recovered and extended one hash-chained journal to four entries, and released
the exact exclusive lock after each run. The validator was then stopped.

| Recovery evidence | Value |
|---|---|
| CLI passes | 2 |
| journal entries | 4 |
| journal SHA-256 | `b83edddfb5c50df471cb4a5436d712707c1485a70688febc8884c4549a09cd14` |
| lock after completion | absent |
| recovery RPC writes | none |
| recovery summary SHA-256 | `3efe03716ff7fd71055cd178c17b1585624e247f77011d85cdef487f1dddbdd5` |

## Qualification

This is complete local happy-path and old-authority-negative evidence. It is
not an executed V3 rollback rehearsal: the rollback was independently sealed,
approved, timelocked, and retired after successful poststate. It also does not
replace the missing actual-SBF 32-, 64-, and 128-KiB chunk-candidate
measurements. The Release 1 branch therefore remains **NOT EXIT-COMPLETE**.
