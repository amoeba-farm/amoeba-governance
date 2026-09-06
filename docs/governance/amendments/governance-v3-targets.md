# V3 typed target governance

This user-authorized Devnet extension adds target governance to the existing
upgradeable V3 council. It preserves the 384-byte council, 400-byte proposal,
existing action encodings and instruction tags 0–10. It is installed through the
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

Instructions 12/13 install/extend an approved target artifact. The target must
already be EmergencyFrozen at the action's exact gate epoch. Extension grows only
toward the approved bytes in Loader-safe 10,240-byte increments. Installation
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
