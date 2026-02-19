use anchor_lang::prelude::*;

use crate::constants::ACCOUNT_DISCRIMINATOR_LEN;

#[account]
pub struct UsagePlan {
    pub plan_id: u64,
    pub window_seconds: u64,
    pub max_per_window: u64,
    pub is_active: bool,
}

impl UsagePlan {
    pub const SPACE: usize = ACCOUNT_DISCRIMINATOR_LEN + 8 + 8 + 8 + 1;
}
