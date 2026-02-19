use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod helpers;
pub mod instructions;
pub mod state;

pub use instructions::*;
pub use state::*;

declare_id!("9E2niqsSRf2GspkTvFE927shX6D1V27TRdxB4cA2YJaj");

#[program]
pub mod gatekeeper {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, authority: Pubkey) -> Result<()> {
        crate::instructions::initialize::handler(ctx, authority)
    }

    pub fn create_plan(
        ctx: Context<CreatePlan>,
        plan_id: u64,
        window_seconds: u64,
        max_per_window: u64,
        is_active: bool,
    ) -> Result<()> {
        crate::instructions::create_plan::handler(ctx, plan_id, window_seconds, max_per_window, is_active)
    }

    pub fn toggle_plan(ctx: Context<TogglePlan>, plan_id: u64) -> Result<()> {
        crate::instructions::toggle_plan::handler(ctx, plan_id)
    }

    pub fn upsert_role(
        ctx: Context<UpsertRole>,
        role_id: u64,
        name: String,
        scopes_bitmask: u64,
    ) -> Result<()> {
        crate::instructions::upsert_role::handler(ctx, role_id, name, scopes_bitmask)
    }

    pub fn issue_key(
        ctx: Context<IssueKey>,
        owner: Pubkey,
        plan_id: u64,
        role_id: u64,
    ) -> Result<()> {
        crate::instructions::issue_key::handler(ctx, owner, plan_id, role_id)
    }

    pub fn revoke_key(ctx: Context<RevokeKey>, owner: Pubkey) -> Result<()> {
        crate::instructions::revoke_key::handler(ctx, owner)
    }

    pub fn consume(ctx: Context<Consume>, required_scopes_mask: u64) -> Result<()> {
        crate::instructions::consume::handler(ctx, required_scopes_mask)
    }
}
