use anchor_lang::prelude::*;

use crate::constants::ACCOUNT_DISCRIMINATOR_LEN;

#[account]
pub struct Role {
    pub role_id: u64,
    pub name: [u8; 32],
    pub scopes_bitmask: u64,
}

impl Role {
    pub const SPACE: usize = ACCOUNT_DISCRIMINATOR_LEN + 8 + 32 + 8;
}
