use anchor_lang::prelude::*;

use crate::constants::KEY_STATUS_REVOKED;
use crate::errors::GatekeeperError;
use crate::state::{ApiKey, Role, UsagePlan};

#[derive(Accounts)]
pub struct Consume<'info> {
    #[account(mut)]
    pub api_key: Account<'info, ApiKey>,
    pub usage_plan: Account<'info, UsagePlan>,
    pub role: Account<'info, Role>,
}

pub fn handler(ctx: Context<Consume>, required_scopes_mask: u64) -> Result<()> {
    let api_key = &mut ctx.accounts.api_key;
    let usage_plan = &ctx.accounts.usage_plan;
    let role = &ctx.accounts.role;

    require!(
        api_key.status != KEY_STATUS_REVOKED,
        GatekeeperError::KeyRevoked
    );
    require!(usage_plan.is_active, GatekeeperError::PlanInactive);

    require_keys_eq!(
        api_key.plan,
        usage_plan.key(),
        GatekeeperError::InvalidPlanOrRole
    );
    require_keys_eq!(
        api_key.role,
        role.key(),
        GatekeeperError::InvalidPlanOrRole
    );

    require!(
        role.scopes_bitmask & required_scopes_mask == required_scopes_mask,
        GatekeeperError::InsufficientScopes
    );

    let now = Clock::get()?.unix_timestamp;

    if api_key.window_start == 0 {
        api_key.window_start = now;
    }

    if now >= api_key.window_start.saturating_add(usage_plan.window_seconds as i64) {
        api_key.window_start = now;
        api_key.count = 0;
    }

    require!(
        api_key.count < usage_plan.max_per_window,
        GatekeeperError::RateLimitExceeded
    );
    api_key.count += 1;

    Ok(())
}
