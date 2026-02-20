use anchor_lang::prelude::*;

use crate::constants::GLOBAL_STATE_SEED;
use crate::state::GlobalState;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = GlobalState::SPACE,
        seeds = [GLOBAL_STATE_SEED],
        bump
    )]
    pub global_state: Account<'info, GlobalState>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let global_state = &mut ctx.accounts.global_state;
    global_state.authority = ctx.accounts.authority.key();
    global_state.bump = ctx.bumps.global_state;

    Ok(())
}
