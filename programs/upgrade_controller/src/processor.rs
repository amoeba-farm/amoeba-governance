//! Release 1 instruction dispatcher.
//!
//! The historical tag-0 approval codec remains decodable for regression
//! vectors, but it is deliberately non-executable. Tags 1-25 dispatch only to
//! typed non-custodial lifecycle processors. Reserved tag 26 remains closed.
//! Tags 27-38 atomically expose the typed, rehearsed buffer, Loader-v3,
//! verification, rollback, and terminal custody lifecycle.

use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::{
    instruction::{self, MAX_CONTROLLER_INSTRUCTION_DATA_LEN},
    release1_processor_buffer::{
        process_adopt_buffer_v1, process_finalize_buffer_verification_v1,
        process_verify_buffer_chunk_v1,
    },
    release1_processor_checkpoint::{
        process_activate_council_rotation_v1, process_approve_council_rotation_v1,
        process_cancel_council_rotation_v1, process_create_candidate_council_set_v1,
        process_create_checkpoint_attestation_v1, process_create_council_rotation_v1,
        process_expire_council_rotation_v1, process_expire_emergency_resolution_v1,
        process_finalize_checkpoint_v1, process_queue_council_rotation_v1,
        process_recast_checkpoint_attestation_v1,
    },
    release1_processor_initialize::process_initialize_controller_v1,
    release1_processor_loader::{
        process_execute_upgrade_v1, process_extend_target_v1,
        process_finalize_programdata_verification_v1, process_verify_programdata_chunk_v1,
    },
    release1_processor_proposal::{
        process_approve_emergency_resolution_v1, process_approve_proposal_v2,
        process_cancel_proposal_v2, process_convert_emergency_freeze_v2,
        process_create_emergency_resolution_v1, process_create_proposal_v2,
        process_execute_emergency_resolution_v1, process_expire_proposal_v2,
        process_finalize_governance_v2, process_freeze_proposal_v2, process_guardian_freeze_v1,
        process_queue_emergency_resolution_v1, process_queue_proposal_v2,
    },
    release1_processor_terminal::{
        process_activate_rollback_v1, process_approve_unfreeze_v1,
        process_close_abandoned_buffer_v1, process_execute_unfreeze_v1,
        process_observe_programdata_failure_v1,
    },
};

pub use crate::pda::UPGRADEABLE_LOADER_ID;

// Keep the root dispatcher as a tag router only. Decoding the complete
// `UpgradeControllerInstruction` enum here makes the largest fixed-wire variant
// live across every match arm under SBPF-v0, inflating the entry frame even for
// small lifecycle instructions. Each non-inlined thunk owns exactly one codec
// and one processor call, so unrelated instruction values never share a frame.
macro_rules! typed_dispatch {
    ($name:ident, $instruction:ident, $processor:ident) => {
        #[inline(never)]
        fn $name(
            program_id: &Pubkey,
            accounts: &[AccountInfo<'_>],
            instruction_data: &[u8],
        ) -> ProgramResult {
            let instruction = instruction::$instruction::unpack(instruction_data)?;
            $processor(program_id, accounts, instruction)
        }
    };
}

typed_dispatch!(
    dispatch_initialize_controller_v1,
    InitializeControllerV1,
    process_initialize_controller_v1
);
typed_dispatch!(
    dispatch_create_proposal_v2,
    CreateProposalV2,
    process_create_proposal_v2
);
typed_dispatch!(
    dispatch_approve_proposal_v2,
    ApproveProposalV2,
    process_approve_proposal_v2
);
typed_dispatch!(
    dispatch_finalize_governance_v2,
    FinalizeGovernanceV2,
    process_finalize_governance_v2
);
typed_dispatch!(
    dispatch_queue_proposal_v2,
    QueueProposalV2,
    process_queue_proposal_v2
);
typed_dispatch!(
    dispatch_freeze_proposal_v2,
    FreezeProposalV2,
    process_freeze_proposal_v2
);
typed_dispatch!(
    dispatch_cancel_proposal_v2,
    CancelProposalV2,
    process_cancel_proposal_v2
);
typed_dispatch!(
    dispatch_expire_proposal_v2,
    ExpireProposalV2,
    process_expire_proposal_v2
);
typed_dispatch!(
    dispatch_guardian_freeze_v1,
    GuardianFreezeV1,
    process_guardian_freeze_v1
);
typed_dispatch!(
    dispatch_create_emergency_resolution_v1,
    CreateEmergencyResolutionV1,
    process_create_emergency_resolution_v1
);
typed_dispatch!(
    dispatch_approve_emergency_resolution_v1,
    ApproveEmergencyResolutionV1,
    process_approve_emergency_resolution_v1
);
typed_dispatch!(
    dispatch_queue_emergency_resolution_v1,
    QueueEmergencyResolutionV1,
    process_queue_emergency_resolution_v1
);
typed_dispatch!(
    dispatch_execute_emergency_resolution_v1,
    ExecuteEmergencyResolutionV1,
    process_execute_emergency_resolution_v1
);
typed_dispatch!(
    dispatch_convert_emergency_freeze_v2,
    ConvertEmergencyFreezeV2,
    process_convert_emergency_freeze_v2
);
typed_dispatch!(
    dispatch_create_checkpoint_attestation_v1,
    CreateCheckpointAttestationV1,
    process_create_checkpoint_attestation_v1
);
typed_dispatch!(
    dispatch_recast_checkpoint_attestation_v1,
    RecastCheckpointAttestationV1,
    process_recast_checkpoint_attestation_v1
);
typed_dispatch!(
    dispatch_finalize_checkpoint_v1,
    FinalizeCheckpointV1,
    process_finalize_checkpoint_v1
);
typed_dispatch!(
    dispatch_create_candidate_council_set_v1,
    CreateCandidateCouncilSetV1,
    process_create_candidate_council_set_v1
);
typed_dispatch!(
    dispatch_create_council_rotation_v1,
    CreateCouncilRotationV1,
    process_create_council_rotation_v1
);
typed_dispatch!(
    dispatch_approve_council_rotation_v1,
    ApproveCouncilRotationV1,
    process_approve_council_rotation_v1
);
typed_dispatch!(
    dispatch_activate_council_rotation_v1,
    ActivateCouncilRotationV1,
    process_activate_council_rotation_v1
);
typed_dispatch!(
    dispatch_queue_council_rotation_v1,
    QueueCouncilRotationV1,
    process_queue_council_rotation_v1
);
typed_dispatch!(
    dispatch_expire_emergency_resolution_v1,
    ExpireEmergencyResolutionV1,
    process_expire_emergency_resolution_v1
);
typed_dispatch!(
    dispatch_cancel_council_rotation_v1,
    CancelCouncilRotationV1,
    process_cancel_council_rotation_v1
);
typed_dispatch!(
    dispatch_expire_council_rotation_v1,
    ExpireCouncilRotationV1,
    process_expire_council_rotation_v1
);
typed_dispatch!(
    dispatch_adopt_buffer_v1,
    AdoptBufferV1,
    process_adopt_buffer_v1
);
typed_dispatch!(
    dispatch_verify_buffer_chunk_v1,
    VerifyBufferChunkV1,
    process_verify_buffer_chunk_v1
);
typed_dispatch!(
    dispatch_finalize_buffer_verification_v1,
    FinalizeBufferVerificationV1,
    process_finalize_buffer_verification_v1
);
typed_dispatch!(
    dispatch_extend_target_v1,
    ExtendTargetV1,
    process_extend_target_v1
);
typed_dispatch!(
    dispatch_execute_upgrade_v1,
    ExecuteUpgradeV1,
    process_execute_upgrade_v1
);
typed_dispatch!(
    dispatch_verify_programdata_chunk_v1,
    VerifyProgramDataChunkV1,
    process_verify_programdata_chunk_v1
);
typed_dispatch!(
    dispatch_finalize_programdata_verification_v1,
    FinalizeProgramDataVerificationV1,
    process_finalize_programdata_verification_v1
);
typed_dispatch!(
    dispatch_approve_unfreeze_v1,
    ApproveUnfreezeV1,
    process_approve_unfreeze_v1
);
typed_dispatch!(
    dispatch_execute_unfreeze_v1,
    ExecuteUnfreezeV1,
    process_execute_unfreeze_v1
);
typed_dispatch!(
    dispatch_close_abandoned_buffer_v1,
    CloseAbandonedBufferV1,
    process_close_abandoned_buffer_v1
);
typed_dispatch!(
    dispatch_activate_rollback_v1,
    ActivateRollbackV1,
    process_activate_rollback_v1
);
typed_dispatch!(
    dispatch_observe_programdata_failure_v1,
    ObserveProgramDataFailureV1,
    process_observe_programdata_failure_v1
);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.is_empty() || instruction_data.len() > MAX_CONTROLLER_INSTRUCTION_DATA_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }
    match instruction_data[0] {
        // Frozen historical scaffold: Release 1 must never expose the timeless
        // V1 approval kernel as an executable path.
        instruction::RECORD_PROPOSAL_APPROVAL_V1_TAG => Err(ProgramError::InvalidInstructionData),
        instruction::INITIALIZE_CONTROLLER_V1_TAG => {
            dispatch_initialize_controller_v1(program_id, accounts, instruction_data)
        }
        instruction::CREATE_PROPOSAL_V2_TAG => {
            dispatch_create_proposal_v2(program_id, accounts, instruction_data)
        }
        instruction::APPROVE_PROPOSAL_V2_TAG => {
            dispatch_approve_proposal_v2(program_id, accounts, instruction_data)
        }
        instruction::FINALIZE_GOVERNANCE_V2_TAG => {
            dispatch_finalize_governance_v2(program_id, accounts, instruction_data)
        }
        instruction::QUEUE_PROPOSAL_V2_TAG => {
            dispatch_queue_proposal_v2(program_id, accounts, instruction_data)
        }
        instruction::FREEZE_PROPOSAL_V2_TAG => {
            dispatch_freeze_proposal_v2(program_id, accounts, instruction_data)
        }
        instruction::CANCEL_PROPOSAL_V2_TAG => {
            dispatch_cancel_proposal_v2(program_id, accounts, instruction_data)
        }
        instruction::EXPIRE_PROPOSAL_V2_TAG => {
            dispatch_expire_proposal_v2(program_id, accounts, instruction_data)
        }
        instruction::GUARDIAN_FREEZE_V1_TAG => {
            dispatch_guardian_freeze_v1(program_id, accounts, instruction_data)
        }
        instruction::CREATE_EMERGENCY_RESOLUTION_V1_TAG => {
            dispatch_create_emergency_resolution_v1(program_id, accounts, instruction_data)
        }
        instruction::APPROVE_EMERGENCY_RESOLUTION_V1_TAG => {
            dispatch_approve_emergency_resolution_v1(program_id, accounts, instruction_data)
        }
        instruction::QUEUE_EMERGENCY_RESOLUTION_V1_TAG => {
            dispatch_queue_emergency_resolution_v1(program_id, accounts, instruction_data)
        }
        instruction::EXECUTE_EMERGENCY_RESOLUTION_V1_TAG => {
            dispatch_execute_emergency_resolution_v1(program_id, accounts, instruction_data)
        }
        instruction::CONVERT_EMERGENCY_FREEZE_V2_TAG => {
            dispatch_convert_emergency_freeze_v2(program_id, accounts, instruction_data)
        }
        instruction::CREATE_CHECKPOINT_ATTESTATION_V1_TAG => {
            dispatch_create_checkpoint_attestation_v1(program_id, accounts, instruction_data)
        }
        instruction::RECAST_CHECKPOINT_ATTESTATION_V1_TAG => {
            dispatch_recast_checkpoint_attestation_v1(program_id, accounts, instruction_data)
        }
        instruction::FINALIZE_CHECKPOINT_V1_TAG => {
            dispatch_finalize_checkpoint_v1(program_id, accounts, instruction_data)
        }
        instruction::CREATE_CANDIDATE_COUNCIL_SET_V1_TAG => {
            dispatch_create_candidate_council_set_v1(program_id, accounts, instruction_data)
        }
        instruction::CREATE_COUNCIL_ROTATION_V1_TAG => {
            dispatch_create_council_rotation_v1(program_id, accounts, instruction_data)
        }
        instruction::APPROVE_COUNCIL_ROTATION_V1_TAG => {
            dispatch_approve_council_rotation_v1(program_id, accounts, instruction_data)
        }
        instruction::ACTIVATE_COUNCIL_ROTATION_V1_TAG => {
            dispatch_activate_council_rotation_v1(program_id, accounts, instruction_data)
        }
        instruction::QUEUE_COUNCIL_ROTATION_V1_TAG => {
            dispatch_queue_council_rotation_v1(program_id, accounts, instruction_data)
        }
        instruction::EXPIRE_EMERGENCY_RESOLUTION_V1_TAG => {
            dispatch_expire_emergency_resolution_v1(program_id, accounts, instruction_data)
        }
        instruction::CANCEL_COUNCIL_ROTATION_V1_TAG => {
            dispatch_cancel_council_rotation_v1(program_id, accounts, instruction_data)
        }
        instruction::EXPIRE_COUNCIL_ROTATION_V1_TAG => {
            dispatch_expire_council_rotation_v1(program_id, accounts, instruction_data)
        }
        instruction::ADOPT_BUFFER_V1_TAG => {
            dispatch_adopt_buffer_v1(program_id, accounts, instruction_data)
        }
        instruction::VERIFY_BUFFER_CHUNK_V1_TAG => {
            dispatch_verify_buffer_chunk_v1(program_id, accounts, instruction_data)
        }
        instruction::FINALIZE_BUFFER_VERIFICATION_V1_TAG => {
            dispatch_finalize_buffer_verification_v1(program_id, accounts, instruction_data)
        }
        instruction::EXTEND_TARGET_V1_TAG => {
            dispatch_extend_target_v1(program_id, accounts, instruction_data)
        }
        instruction::EXECUTE_UPGRADE_V1_TAG => {
            dispatch_execute_upgrade_v1(program_id, accounts, instruction_data)
        }
        instruction::VERIFY_PROGRAMDATA_CHUNK_V1_TAG => {
            dispatch_verify_programdata_chunk_v1(program_id, accounts, instruction_data)
        }
        instruction::FINALIZE_PROGRAMDATA_VERIFICATION_V1_TAG => {
            dispatch_finalize_programdata_verification_v1(program_id, accounts, instruction_data)
        }
        instruction::APPROVE_UNFREEZE_V1_TAG => {
            dispatch_approve_unfreeze_v1(program_id, accounts, instruction_data)
        }
        instruction::EXECUTE_UNFREEZE_V1_TAG => {
            dispatch_execute_unfreeze_v1(program_id, accounts, instruction_data)
        }
        instruction::CLOSE_ABANDONED_BUFFER_V1_TAG => {
            dispatch_close_abandoned_buffer_v1(program_id, accounts, instruction_data)
        }
        instruction::ACTIVATE_ROLLBACK_V1_TAG => {
            dispatch_activate_rollback_v1(program_id, accounts, instruction_data)
        }
        instruction::OBSERVE_PROGRAMDATA_FAILURE_V1_TAG => {
            dispatch_observe_programdata_failure_v1(program_id, accounts, instruction_data)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instruction::{
        ActivateRollbackV1, AdoptBufferV1, ApproveUnfreezeV1, CloseAbandonedBufferV1,
        EnvelopeExpectationV1, ExecuteUnfreezeV1, ExecuteUpgradeV1, ExtendTargetV1,
        FinalizeBufferVerificationV1, FinalizeProgramDataVerificationV1, FixedMerkleProofV1,
        ObserveProgramDataFailureV1, OptionalInstructionPubkeyV1, ProgramDataChunkPhaseV1,
        ProposalExpectationV2, RecordProposalApprovalV1, UnfreezeExpectationV1,
        VerifyBufferChunkV1, VerifyProgramDataChunkV1, MAX_FIXED_MERKLE_PROOF_NODES_V1,
    };
    use crate::release1_state::{
        BufferVerificationStatusV1, ProgramDataMismatchClassV1, ProgramDataVerificationStatusV1,
        ProposalStateV2, VERIFICATION_BITMAP_BYTES_V1,
    };
    use crate::state::GateStatusV1;
    use crate::GovernanceError;

    const fn bytes(value: u8) -> [u8; 32] {
        [value; 32]
    }

    fn key(value: u8) -> Pubkey {
        Pubkey::new_from_array([value; 32])
    }

    fn proposal_expectation() -> ProposalExpectationV2 {
        ProposalExpectationV2 {
            expected_proposal_digest: bytes(1),
            expected_policy_version: 2,
            expected_policy_hash: bytes(3),
            expected_council_version: 4,
            expected_council_hash: bytes(5),
            expected_gate_status: GateStatusV1::FrozenForUpgrade,
            expected_gate_epoch: 6,
            expected_target_nonce: 7,
            expected_state: ProposalStateV2::Timelocked,
            expected_review_start_slot: 8,
            expected_review_end_slot: 9,
            expected_not_before_slot: 10,
            expected_expiry_slot: 11,
        }
    }

    fn unfreeze_expectation() -> UnfreezeExpectationV1 {
        UnfreezeExpectationV1 {
            expected_proposal_digest: bytes(12),
            expected_policy_version: 13,
            expected_policy_hash: bytes(14),
            expected_current_council_version: 15,
            expected_current_council_hash: bytes(16),
            expected_frozen_gate_epoch: 17,
            expected_target_nonce: 18,
            expected_proposal_state: ProposalStateV2::PoststateAccepted,
            expected_poststate_checkpoint_digest: bytes(19),
            expected_programdata_authority: key(20),
            expected_programdata_deployed_slot: 21,
            expected_programdata_capacity: 22,
            expected_raw_programdata_hash: bytes(23),
            expected_unfreeze_approval_bitset: 0b0_0011,
            expected_unfreeze_approval_count: 2,
            expected_programdata_verification_finalized_slot: 24,
        }
    }

    fn envelope() -> EnvelopeExpectationV1 {
        EnvelopeExpectationV1 {
            compute_unit_limit: 1_200_000,
            compute_unit_price_micro_lamports: 17,
            durable_nonce_account: OptionalInstructionPubkeyV1::some(key(25)).unwrap(),
            durable_nonce_authority: OptionalInstructionPubkeyV1::some(key(26)).unwrap(),
        }
    }

    fn merkle_proof() -> FixedMerkleProofV1 {
        let mut nodes = [[0; 32]; MAX_FIXED_MERKLE_PROOF_NODES_V1];
        nodes[0] = bytes(27);
        nodes[1] = bytes(28);
        FixedMerkleProofV1 {
            proof_len: 2,
            nodes,
        }
    }

    fn bitmap(value: u8) -> [u8; VERIFICATION_BITMAP_BYTES_V1] {
        [value; VERIFICATION_BITMAP_BYTES_V1]
    }

    fn custody_instruction_packets() -> Vec<Vec<u8>> {
        vec![
            AdoptBufferV1 {
                expected: proposal_expectation(),
            }
            .pack()
            .to_vec(),
            VerifyBufferChunkV1 {
                expected: proposal_expectation(),
                chunk_index: 1,
                proof: merkle_proof(),
                expected_verification_status: BufferVerificationStatusV1::Verifying,
                expected_verified_chunk_bitmap: bitmap(1),
                expected_verified_chunk_count: 2,
            }
            .pack()
            .to_vec(),
            FinalizeBufferVerificationV1 {
                expected: proposal_expectation(),
                expected_verification_status: BufferVerificationStatusV1::ReadyToFinalize,
                expected_verified_chunk_bitmap: bitmap(0xff),
                expected_verified_chunk_count: 128,
            }
            .pack()
            .to_vec(),
            ExtendTargetV1 {
                expected: proposal_expectation(),
                expected_prestate_checkpoint_digest: bytes(29),
                expected_current_capacity: 1_000,
                expected_extension_delta: 200,
                expected_post_capacity: 1_200,
                envelope: envelope(),
            }
            .pack()
            .to_vec(),
            ExecuteUpgradeV1 {
                expected: proposal_expectation(),
                expected_prestate_checkpoint_digest: bytes(30),
                expected_current_raw_programdata_hash: bytes(31),
                expected_sealed_buffer_header_hash: bytes(32),
                expected_counterpart_proposal_digest: bytes(33),
                expected_programdata_slot: 34,
                expected_capacity: 35,
                expected_verified_chunk_count: 128,
                expected_buffer_verification_status: BufferVerificationStatusV1::Verified,
                expected_counterpart_buffer_verification_status:
                    BufferVerificationStatusV1::Verified,
                envelope: envelope(),
            }
            .pack()
            .to_vec(),
            VerifyProgramDataChunkV1 {
                expected: proposal_expectation(),
                phase: ProgramDataChunkPhaseV1::Payload,
                chunk_index: 2,
                proof: merkle_proof(),
                expected_verification_status: ProgramDataVerificationStatusV1::Verifying,
                expected_verified_payload_chunk_bitmap: bitmap(2),
                expected_verified_payload_chunk_count: 3,
                expected_verified_tail_chunk_bitmap: bitmap(0),
                expected_verified_tail_chunk_count: 0,
            }
            .pack()
            .to_vec(),
            FinalizeProgramDataVerificationV1 {
                expected: proposal_expectation(),
                expected_verification_status: ProgramDataVerificationStatusV1::ReadyToFinalize,
                expected_verified_payload_chunk_bitmap: bitmap(0xff),
                expected_verified_payload_chunk_count: 128,
                expected_verified_tail_chunk_bitmap: bitmap(0),
                expected_verified_tail_chunk_count: 0,
                expected_deployed_slot: 36,
                expected_capacity: 37,
            }
            .pack()
            .to_vec(),
            ApproveUnfreezeV1 {
                expected: unfreeze_expectation(),
            }
            .pack()
            .to_vec(),
            ExecuteUnfreezeV1 {
                expected: unfreeze_expectation(),
                linked_proposal: key(38),
                envelope: envelope(),
            }
            .pack()
            .to_vec(),
            CloseAbandonedBufferV1 {
                expected: proposal_expectation(),
                expected_verification_status: BufferVerificationStatusV1::Verified,
                expected_verified_chunk_bitmap: bitmap(0xff),
                expected_verified_chunk_count: 128,
                expected_buffer_verification_finalized_slot: 39,
            }
            .pack()
            .to_vec(),
            ActivateRollbackV1 {
                expected_primary: proposal_expectation(),
                expected_rollback: proposal_expectation(),
                expected_failure_evidence_digest: bytes(40),
                expected_primary_programdata_verification_status:
                    ProgramDataVerificationStatusV1::Verifying,
                expected_primary_programdata_verification_finalized_slot: 0,
                expected_rollback_buffer_verification_status: BufferVerificationStatusV1::Verified,
                expected_rollback_verified_chunk_bitmap: bitmap(0xff),
                expected_rollback_verified_chunk_count: 128,
            }
            .pack()
            .to_vec(),
            ObserveProgramDataFailureV1 {
                expected: proposal_expectation(),
                expected_program_owner: key(41),
                expected_program_executable: true,
                expected_program_data_length: 36,
                expected_program_header_present: true,
                expected_linked_programdata: OptionalInstructionPubkeyV1::some(key(42)).unwrap(),
                expected_programdata_owner: key(43),
                expected_programdata_executable: false,
                expected_programdata_data_length: 4_141,
                expected_programdata_header_present: true,
                expected_programdata_slot: 44,
                expected_raw_hash_complete: true,
                expected_raw_programdata_hash: bytes(45),
                expected_capacity: 4_096,
                expected_programdata_authority: OptionalInstructionPubkeyV1::some(key(46)).unwrap(),
                mismatch_class: ProgramDataMismatchClassV1::PayloadLeaf,
                failing_chunk_index: 3,
                expected_leaf_hash: bytes(47),
                proof: merkle_proof(),
            }
            .pack()
            .to_vec(),
        ]
    }

    #[test]
    fn historical_approval_remains_non_executable() {
        let program_id = Pubkey::new_unique();
        let legacy = RecordProposalApprovalV1 {
            expected_proposal_digest: [7; 32],
            expected_council_version: 1,
        }
        .pack();
        assert_eq!(
            process_instruction(&program_id, &[], &legacy),
            Err(ProgramError::InvalidInstructionData)
        );
    }

    #[test]
    fn complete_custody_surface_routes_all_known_typed_codecs() {
        let program_id = Pubkey::new_unique();
        let packets = custody_instruction_packets();
        assert_eq!(packets.len(), 12);
        for (offset, packet) in packets.iter().enumerate() {
            let expected_tag = instruction::ADOPT_BUFFER_V1_TAG + offset as u8;
            assert_eq!(packet[0], expected_tag);
            assert_eq!(
                process_instruction(&program_id, &[], packet),
                Err(GovernanceError::InvalidAccountCount.into()),
                "tag {expected_tag} did not route through its typed processor"
            );
        }
    }

    #[test]
    fn unknown_tag_retains_generic_early_rejection() {
        assert_eq!(
            process_instruction(&Pubkey::new_unique(), &[], &[26]),
            Err(ProgramError::InvalidInstructionData)
        );
        assert_eq!(
            process_instruction(&Pubkey::new_unique(), &[], &[255]),
            Err(ProgramError::InvalidInstructionData)
        );
    }
}
