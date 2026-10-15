# Mainnet Spread retirement

The current user request authorizes replacing the old Mainnet Spread executable,
recovering all accessible assets to the existing KMS treasury, and reclaiming its
rent. This supersedes historical local-only restrictions for this bounded run.
The separate controller retains its existing council, timing, other targets and
instruction behavior.

Controller release 3 adds action 7 (`RetireTarget`) and instruction 17. The
112-byte policy binds target, frozen gate epoch, deployment slot, SHA-256 of the
entire ProgramData payload including zero padding, and a recovery-receipt
commitment. Existing proposal creation, three distinct approvals, execution
delay and expiry apply without alteration. Execution permits only Loader-v3
Close on the registered target ProgramData, to the configured treasury. It
cannot close the controller or an unrelated program. The gate remains frozen.
Recovery completeness is an off-chain council attestation; the runtime cannot
enumerate accounts or prove that no external custody remains.

Instruction 18 reclaims the permanently closed target's canonical gate and
target-specific proposals to the treasury. It requires absent ProgramData and
the Loader program account's canonical linkage. It cannot reclaim controller
config, controller upgrade/policy proposals, or records for another target.
Instruction 19 closes only the retired target's canonical Otter verification
record. Otter refunds its authority PDA; the controller forwards that refund
and the PDA's remaining SOL to the configured treasury. Both cleanup routes
require permanent Loader closure first and preserve other targets' records.
Account lengths, existing instruction numbers and all existing digest bytes
remain unchanged. No arbitrary CPI or authority rotation is introduced.

The 36-byte Loader Program account is distinct from ProgramData. Its residual
rent is reported separately if the Loader leaves it as a permanent tombstone.
