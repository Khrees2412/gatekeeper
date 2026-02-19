use anchor_lang::prelude::*;

use crate::constants::{GLOBAL_STATE_SEED, PLAN_SEED};
use crate::helpers::assert_authority;
use crate::state::{GlobalState, UsagePlan};

#[derive(Accounts)]
#[instruction(plan_id: u64)]
pub struct TogglePlan<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [GLOBAL_STATE_SEED],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        mut,
        seeds = [PLAN_SEED, &plan_id.to_le_bytes()],
        bump
    )]
    pub usage_plan: Account<'info, UsagePlan>,
}

pub fn handler(ctx: Context<TogglePlan>, _plan_id: u64) -> Result<()> {
    assert_authority(&ctx.accounts.global_state, &ctx.accounts.authority)?;

    let usage_plan = &mut ctx.accounts.usage_plan;
    usage_plan.is_active = !usage_plan.is_active;

    Ok(())
}
