use solana_program::{
    instruction::{AccountMeta, Instruction},
    program_error::ProgramError,
    pubkey::Pubkey,
};

pub const RECORD_PROPOSAL_APPROVAL_V1_TAG: u8 = 0;
pub const RECORD_PROPOSAL_APPROVAL_V1_LEN: usize = 1 + 32 + 8;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RecordProposalApprovalV1 {
    pub expected_proposal_digest: [u8; 32],
    pub expected_council_version: u64,
}

impl RecordProposalApprovalV1 {
    pub fn unpack(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() != RECORD_PROPOSAL_APPROVAL_V1_LEN
            || data[0] != RECORD_PROPOSAL_APPROVAL_V1_TAG
        {
            return Err(ProgramError::InvalidInstructionData);
        }
        let mut expected_proposal_digest = [0u8; 32];
        expected_proposal_digest.copy_from_slice(&data[1..33]);
        let mut version = [0u8; 8];
        version.copy_from_slice(&data[33..41]);
        Ok(Self {
            expected_proposal_digest,
            expected_council_version: u64::from_le_bytes(version),
        })
    }

    pub fn pack(self) -> [u8; RECORD_PROPOSAL_APPROVAL_V1_LEN] {
        let mut data = [0u8; RECORD_PROPOSAL_APPROVAL_V1_LEN];
        data[0] = RECORD_PROPOSAL_APPROVAL_V1_TAG;
        data[1..33].copy_from_slice(&self.expected_proposal_digest);
        data[33..41].copy_from_slice(&self.expected_council_version.to_le_bytes());
        data
    }
}

#[allow(clippy::too_many_arguments)]
pub fn record_proposal_approval_instruction(
    controller_program: Pubkey,
    controller_config: Pubkey,
    policy: Pubkey,
    council: Pubkey,
    proposal: Pubkey,
    seat_authority: Pubkey,
    expected_proposal_digest: [u8; 32],
    expected_council_version: u64,
) -> Instruction {
    Instruction {
        program_id: controller_program,
        accounts: vec![
            AccountMeta::new_readonly(controller_config, false),
            AccountMeta::new_readonly(policy, false),
            AccountMeta::new_readonly(council, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(seat_authority, true),
        ],
        data: RecordProposalApprovalV1 {
            expected_proposal_digest,
            expected_council_version,
        }
        .pack()
        .to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_width_codec_rejects_unknown_truncated_and_trailing_data() {
        let value = RecordProposalApprovalV1 {
            expected_proposal_digest: [7; 32],
            expected_council_version: 0x0102_0304_0506_0708,
        };
        let bytes = value.pack();
        assert_eq!(bytes.len(), RECORD_PROPOSAL_APPROVAL_V1_LEN);
        assert_eq!(RecordProposalApprovalV1::unpack(&bytes), Ok(value));
        assert_eq!(&bytes[33..], &value.expected_council_version.to_le_bytes());
        assert_eq!(
            RecordProposalApprovalV1::unpack(&bytes[..40]),
            Err(ProgramError::InvalidInstructionData)
        );
        let mut trailing = bytes.to_vec();
        trailing.push(0);
        assert_eq!(
            RecordProposalApprovalV1::unpack(&trailing),
            Err(ProgramError::InvalidInstructionData)
        );
        let mut unknown = bytes;
        unknown[0] = 1;
        assert_eq!(
            RecordProposalApprovalV1::unpack(&unknown),
            Err(ProgramError::InvalidInstructionData)
        );
    }
}
