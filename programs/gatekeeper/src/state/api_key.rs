use anchor_lang::prelude::*;

use crate::constants::ACCOUNT_DISCRIMINATOR_LEN;

#[account]
pub struct ApiKey {
    pub owner: Pubkey,
    pub plan: Pubkey,
    pub role: Pubkey,
    pub status: u8,
    pub window_start: i64,
    pub count: u64,
    pub created_at: i64,
}

impl ApiKey {
    pub const SPACE: usize = ACCOUNT_DISCRIMINATOR_LEN + 32 + 32 + 32 + 1 + 8 + 8 + 8;
}
