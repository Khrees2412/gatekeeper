use anchor_lang::prelude::*;

use crate::constants::{GLOBAL_STATE_SEED, KEY_SEED, KEY_STATUS_REVOKED};
use crate::helpers::assert_authority;
use crate::state::{ApiKey, GlobalState};

#[derive(Accounts)]
#[instruction(owner: Pubkey)]
pub struct RevokeKey<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [GLOBAL_STATE_SEED],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        mut,
        seeds = [KEY_SEED, owner.as_ref()],
        bump
    )]
    pub api_key: Account<'info, ApiKey>,
}

pub fn handler(ctx: Context<RevokeKey>, _owner: Pubkey) -> Result<()> {
    assert_authority(&ctx.accounts.global_state, &ctx.accounts.authority)?;
    ctx.accounts.api_key.status = KEY_STATUS_REVOKED;
    Ok(())
}
