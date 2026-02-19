use anchor_lang::prelude::*;

declare_id!("9E2niqsSRf2GspkTvFE927shX6D1V27TRdxB4cA2YJaj");

#[program]
pub mod gatekeeper {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
