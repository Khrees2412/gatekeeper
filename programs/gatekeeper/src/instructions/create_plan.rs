use anchor_lang::prelude::*;

use crate::constants::{GLOBAL_STATE_SEED, PLAN_SEED};
use crate::helpers::assert_authority;
use crate::state::{GlobalState, UsagePlan};

#[derive(Accounts)]
#[instruction(plan_id: u64)]
pub struct CreatePlan<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [GLOBAL_STATE_SEED],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        init,
        payer = authority,
        space = UsagePlan::SPACE,
        seeds = [PLAN_SEED, &plan_id.to_le_bytes()],
        bump
    )]
    pub usage_plan: Account<'info, UsagePlan>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreatePlan>,
    plan_id: u64,
    window_seconds: u64,
    max_per_window: u64,
    is_active: bool,
) -> Result<()> {
    assert_authority(&ctx.accounts.global_state, &ctx.accounts.authority)?;

    let usage_plan = &mut ctx.accounts.usage_plan;
    usage_plan.plan_id = plan_id;
    usage_plan.window_seconds = window_seconds;
    usage_plan.max_per_window = max_per_window;
    usage_plan.is_active = is_active;

    Ok(())
}
