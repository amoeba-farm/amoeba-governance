# V3 Devnet governed setup release — September 6, 2026

The [finalized identity](identity.json) was read at slot 494223048 on September 6,
2026 at 19:52:56 UTC. The [release receipt](receipt.json) records the paired
Spread/controller upgrades, separate gate activation, and create-once Light
configuration. The gate is Active at epoch 6. Both programs remain controlled
by the same KMS-backed three-of-five council.

The council retains 4,000,000 approval slots, 4,500 execution-delay slots and
7,000,000 expiry slots. The approval period is approximately a week at the
previously measured Devnet slot rate; these slot counts do not guarantee a
fixed wall-clock duration. The historical 450-slot approval window is not the
current V3 policy.

## Final executable identities

| Program | Artifact source | Executable bytes | Executable SHA-256 |
| --- | --- | ---: | --- |
| Controller `8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx` | `590e3cd65d429338757aca1ca7f21e9bcd012b94` | 202,616 | `50d409bceaebef4ce3edcee9e757b4f995e0405a482ad32f3272e13aa94dca47` |
| Spread `2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw` | `d739bcd15068fb79e0b32d0c4eda02703c6417d4` | 1,236,592 | `0dd6a6def09a8fc690572bf5a430157644b9b1e5ebac60a2f07c481a3bf0d22d` |

Spread's allocated ProgramData payload is 1,241,504 bytes, including exactly
4,912 trailing zero bytes. Its payload SHA-256 is
`23f6d99a47cc79d2babad6758531664414cfc51df313ae82ea2cfd6c32829f87`.
The runtime rejected the exact 5,328-byte growth request and required at least
10,240 bytes; [the retained simulation](runtime-extension-floor.json) and
finalized extension receipts establish that floor. No optional headroom was
added. Controller storage has no padding beyond its executable.

Each artifact was built twice with identical final bytes. The retained
commands used separate named build directories but permitted caches; this
receipt does not attest independent clean builds. Exact input-inventory hashes,
features, source/build commitments, authorities, deployment slots and transaction
signatures are in the release receipt.

## Scope and preserved state

The controller adds only the typed, create-once Spread Light configuration
action documented in the [amendment](../../amendments/governance-v3-spread-light-config.md).
It retains council custody, ordinary quorum/timing checks, and the fixed CPI
account/payload boundary. Proposal 10 executed that action successfully.

The loader-only replacements preserved all 2,459 inventoried Spread-owned
accounts and 48 inventoried custody/mint accounts. All three before/after
censuses have invariant SHA-256
`514361ee3ee7c4cab9d39512921a0453d10132f3bfe46ff5f3e9e94e401d60da`.
Oracle and demo business operations occur separately from those code-only
replacements. This evidence package establishes deployment identity and Light
initialization; issuance, liquidity, swaps and final market parity require the
separate fresh-path audit in Spread. It records no application or service rollout.

`inventory.json` hashes each public account-data and receipt file. ProgramData
files contain the actual finalized account bytes, including Loader headers;
they are not reconstructed account observations. Earlier September 5 receipts
remain historical and unchanged.
