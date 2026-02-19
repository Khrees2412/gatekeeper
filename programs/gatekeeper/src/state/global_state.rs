use anchor_lang::prelude::*;

use crate::constants::ACCOUNT_DISCRIMINATOR_LEN;

#[account]
pub struct GlobalState {
    pub authority: Pubkey,
    pub bump: u8,
}

impl GlobalState {
    pub const SPACE: usize = ACCOUNT_DISCRIMINATOR_LEN + 32 + 1;
}
