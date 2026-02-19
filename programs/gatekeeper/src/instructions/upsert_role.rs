use anchor_lang::prelude::*;

use crate::constants::{GLOBAL_STATE_SEED, ROLE_SEED};
use crate::helpers::{assert_authority, to_fixed_name};
use crate::state::{GlobalState, Role};

#[derive(Accounts)]
#[instruction(role_id: u64)]
pub struct UpsertRole<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [GLOBAL_STATE_SEED],
        bump = global_state.bump
    )]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        init_if_needed,
        payer = authority,
        space = Role::SPACE,
        seeds = [ROLE_SEED, &role_id.to_le_bytes()],
        bump
    )]
    pub role: Account<'info, Role>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<UpsertRole>,
    role_id: u64,
    name: String,
    scopes_bitmask: u64,
) -> Result<()> {
    assert_authority(&ctx.accounts.global_state, &ctx.accounts.authority)?;

    let role = &mut ctx.accounts.role;
    role.role_id = role_id;
    role.name = to_fixed_name(name);
    role.scopes_bitmask = scopes_bitmask;

    Ok(())
}
