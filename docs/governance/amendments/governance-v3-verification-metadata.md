# V3 public build-verification metadata

Authorized September 16, 2026 for Mainnet verification against the public
`amoeba-farm/amoeba-governance` and `amoeba-farm/amoeba-program` repositories.
The starting controller is private revision `82011c1` / public deployed revision
`629b693dd683560ed74e4e0765cdbca3843dd5ab`. Historical local-only/Devnet scopes do
not describe this explicitly authorized Mainnet preparation. No business logic,
keys, council thresholds, timing, account layouts, or prior instruction meanings
change. Existing V3 digest domains remain unchanged for compatibility.

Action 6 keeps the fixed 193-byte action ABI. Its body is target pubkey (32),
expected ProgramData deployment slot (u64 LE), public Git commit (20 raw bytes),
and 132 zero bytes. Target and commit must be nonzero. New instruction 16 is
its tag plus the exact 32-byte proposal digest. All existing proposal creation,
quorum, council freshness, cancellation, expiration, and timing checks apply.

Execution accepts only governance itself or the existing registered Spread
program. It verifies live Loader ownership/linkage, canonical ProgramData,
deployment slot and current authority. Spread's gate is authenticated readonly
and can be frozen; publishing metadata does not activate or modify it.

Exact accounts: writable signer payer, readonly config, writable proposal,
readonly executable target, readonly ProgramData, writable nonsigner authority
PDA, writable metadata PDA, readonly executable Otter Verify program,
readonly executable System program, readonly instructions sysvar, and (Spread
only) readonly canonical gate. Reject duplicates, extra accounts, CPI calls and
sibling instructions except at most two bounded ComputeBudget prefixes.

The program constructs only Otter Verify Initialize or Update, fixed program
`verifycLy8mB96wd9wqq3WDXQwM4oU6r42Th37Db9fC`, fixed canonical metadata seeds,
and four fixed inner accounts. It never accepts an arbitrary CPI payload,
account vector, URL, library, build flags, or endpoint. The recipe pins verifier
0.5.1, architecture v1, build-image digest
`0b4e3716fad9ca4b4aac3e3f977f43aad93a18c22296c0c0f44fc22e644bdd68`,
and the corresponding public repository/library. The verifier supplies
`--locked` itself; the recipe must not repeat it. Spread also pins
`--no-default-features --features mainnet-v3,devnet-solo-backfill-2026` and its
program directory. Changes to this closed recipe require a reviewed controller
upgrade. A published source commit is not a proof of binary equality; a matching
rebuild and hosted verification remain separate requirements.

Only the exact rent shortfall (at most 0.01 SOL) is transferred from the caller
to the system-owned empty authority PDA, which signs the fixed metadata CPI.
Existing metadata must have the exact recipe size, discriminator, target,
signer and bump. Postconditions require byte-exact metadata, exact rent deltas,
and unchanged authority balance, preserving donations. Every failure rolls back
both rent funding and metadata changes. No close/refund, arbitrary transfer,
loader operation, authority handback or gate change is exposed.

The controller upgrade and later metadata proposals each obey the current
4,500-slot execution delay. The 1,512,000-slot review window is an approval
deadline, not a mandatory seven-day wait. Local tests must execute the actual
controller SBF against the actual Otter Verify SBF, including both controller
and target authority seeds, initialization/update, stale deployment and council,
insufficient quorum, early execution, substitution and atomic rollback cases.
