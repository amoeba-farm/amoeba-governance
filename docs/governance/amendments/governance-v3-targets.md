# V3 typed target governance

This user-authorized Devnet extension adds target governance to the existing
upgradeable V3 council. It preserves the 384-byte council, 400-byte proposal,
existing action encodings and instruction tags 0–9. Tags 10 and 13 are retired. It is installed through the
live V3 council's ordinary self-upgrade mechanism.

New action 3 binds a target program, gate epoch, immutable buffer, exact payload
length, length-bound Merkle root, current ProgramData slot/capacity and source/build
commitments. Its 192-byte body commits the artifact through the Merkle root; the
build receipt also binds its ordinary file SHA-256. It uses the same verification,
three-seat quorum, one-week minimum approval interval, independent execution delay,
expiry and cancellation checks as self-upgrades. There is no 450-slot approval lane.

Instruction 11 registers a target, requiring its current deployment authority and
three distinct current council seats to sign the exact transaction. It creates
one canonical 192-byte gate and atomically transfers Loader-v3 upgrade authority
to `ameba-governance-v3/target-authority/<target>`. Registration is create-only,
leaves the gate EmergencyFrozen at epoch 1, and accepts no arbitrary CPI.

Instruction 12 installs an approved target artifact. The target must already be
EmergencyFrozen at the action's exact gate epoch. ProgramData growth uses the
cluster's permissionless top-level Loader-v3 ExtendProgram instruction, completed
before proposal creation. New proposals reject an artifact larger than their
snapshotted capacity. Tags 10/13 reject before account access; no unsupported
checked-extension CPI remains reachable. Installation
checks exact Program/ProgramData linkage and authority, increments the gate epoch,
records the completed proposal and leaves the gate frozen. Controller upgrades
cannot consume target proposals and target upgrades cannot address the controller.

Action 4 and instruction 14 change a target gate through the same council proposal
process, checking its expected epoch and incrementing it. Activation is always a
separate decision. A concurrent gate change invalidates an older target upgrade.
No authority revocation, transfer-out, arbitrary CPI or program-close instruction
is introduced. The council remains able to amend its own code through its existing
self-upgrade mechanism.

The current deployment scope ends with new Spread registered and frozen. Do not
initialize business accounts or integrate applications as part of this task.

## Live Devnet loader correction

The initial candidate's extension CPI failed in finalized simulation with
`Program BPFLoaderUpgradeab1e11111111111111111111111 not supported by inner instructions`.
No extension or upgrade transaction was submitted for that candidate. Its approved
proposal was cancelled through the three-seat council and its buffer closed to the
configured treasury. The replacement first extends ProgramData externally, then
creates a new proposal against the finalized deployment slot/capacity. This resets
the ordinary 4,500-slot execution delay while retaining a one-week approval window.

The SBF rehearsals explicitly deactivate `enable_extend_program_checked` to match
the observed Devnet restriction and exercise top-level extension before proposal
creation. This is not a controller authority bypass: the external instruction can
allocate bytes but cannot install code or change upgrade authority. Installation
still requires the council's approved proposal and immutable verified buffer.

## Week window calibrated to current Devnet

The live performance read on September 6 at 02:40 UTC covered 3,600 seconds and
21,724 slots: about 0.1657 seconds per slot. The original nominal floor of 1,512,000
slots represents only about 2.9 days at that rate. The council therefore sets its
live timing profile to 4,000,000 approval slots, 4,500 delay slots, and 7,000,000
expiry slots. That approval window is about 7.7 days at the measured rate.

The constant named WEEK_SLOTS preserves the initial nominal 400 ms floor and the
existing proposal validation rules. It is not the live profile after this council
policy update. Every new action, including program upgrades, snapshots the current
council timing profile; existing proposals retain their original snapshots. Slot
counts remain authoritative because their wall-clock duration varies.
