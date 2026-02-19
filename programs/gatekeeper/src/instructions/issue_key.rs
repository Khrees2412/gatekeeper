use anchor_lang::prelude::*;

use crate::constants::{GLOBAL_STATE_SEED, KEY_SEED, KEY_STATUS_ACTIVE, PLAN_SEED, ROLE_SEED};
use crate::errors::GatekeeperError;
use crate::helpers::assert_authority;
use crate::state::{ApiKey, GlobalState, Role, UsagePlan};

#[derive(Accounts)]
#[instruction(owner: Pubkey)]
pub struct IssueKey<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [GLOBAL_STATE_SEED],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,
    pub usage_plan: Account<'info, UsagePlan>,
    pub role: Account<'info, Role>,
    #[account(
        init,
        payer = authority,
        space = ApiKey::SPACE,
        seeds = [KEY_SEED, owner.as_ref()],
        bump
    )]
    pub api_key: Account<'info, ApiKey>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<IssueKey>,
    owner: Pubkey,
    plan_id: u64,
    role_id: u64,
) -> Result<()> {
    assert_authority(&ctx.accounts.global_state, &ctx.accounts.authority)?;

    let expected_plan = Pubkey::find_program_address(
        &[PLAN_SEED, &plan_id.to_le_bytes()],
        &crate::id(),
    )
    .0;
    require_keys_eq!(
        ctx.accounts.usage_plan.key(),
        expected_plan,
        GatekeeperError::InvalidPlanOrRole
    );

    let expected_role = Pubkey::find_program_address(
        &[ROLE_SEED, &role_id.to_le_bytes()],
        &crate::id(),
    )
    .0;
    require_keys_eq!(
        ctx.accounts.role.key(),
        expected_role,
        GatekeeperError::InvalidPlanOrRole
    );

    let api_key = &mut ctx.accounts.api_key;
    api_key.owner = owner;
    api_key.plan = ctx.accounts.usage_plan.key();
    api_key.role = ctx.accounts.role.key();
    api_key.status = KEY_STATUS_ACTIVE;
    api_key.window_start = 0;
    api_key.count = 0;
    api_key.created_at = Clock::get()?.unix_timestamp;

    Ok(())
}
