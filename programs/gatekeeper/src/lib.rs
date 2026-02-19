use anchor_lang::prelude::*;

declare_id!("9E2niqsSRf2GspkTvFE927shX6D1V27TRdxB4cA2YJaj");

const ACCOUNT_DISCRIMINATOR_LEN: usize = 8;
const GLOBAL_STATE_SEED: &[u8] = b"global_state";
const PLAN_SEED: &[u8] = b"plan";
const ROLE_SEED: &[u8] = b"role";
const KEY_SEED: &[u8] = b"key";

const KEY_STATUS_ACTIVE: u8 = 0;
const KEY_STATUS_REVOKED: u8 = 1;

#[program]
pub mod gatekeeper {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, authority: Pubkey) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.authority.key(),
            authority,
            GatekeeperError::Unauthorized
        );

        let global_state = &mut ctx.accounts.global_state;
        global_state.authority = authority;
        global_state.bump = ctx.bumps.global_state;

        Ok(())
    }

    pub fn create_plan(
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

    pub fn toggle_plan(ctx: Context<TogglePlan>, _plan_id: u64) -> Result<()> {
        assert_authority(&ctx.accounts.global_state, &ctx.accounts.authority)?;

        let usage_plan = &mut ctx.accounts.usage_plan;
        usage_plan.is_active = !usage_plan.is_active;

        Ok(())
    }

    pub fn upsert_role(
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

    pub fn issue_key(
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

    pub fn revoke_key(ctx: Context<RevokeKey>, _owner: Pubkey) -> Result<()> {
        assert_authority(&ctx.accounts.global_state, &ctx.accounts.authority)?;
        ctx.accounts.api_key.status = KEY_STATUS_REVOKED;
        Ok(())
    }

    pub fn consume(ctx: Context<Consume>, required_scopes_mask: u64) -> Result<()> {
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
}

#[derive(Accounts)]
#[instruction(authority: Pubkey)]
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

#[derive(Accounts)]
pub struct Consume<'info> {
    #[account(mut)]
    pub api_key: Account<'info, ApiKey>,
    pub usage_plan: Account<'info, UsagePlan>,
    pub role: Account<'info, Role>,
}

#[account]
pub struct GlobalState {
    pub authority: Pubkey,
    pub bump: u8,
}

impl GlobalState {
    pub const SPACE: usize = ACCOUNT_DISCRIMINATOR_LEN + 32 + 1;
}

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

#[account]
pub struct Role {
    pub role_id: u64,
    pub name: [u8; 32],
    pub scopes_bitmask: u64,
}

impl Role {
    pub const SPACE: usize = ACCOUNT_DISCRIMINATOR_LEN + 8 + 32 + 8;
}

#[account]
pub struct ApiKey {
    pub owner: Pubkey,
    pub plan: Pubkey,
    pub role: Pubkey,
    pub status: u8,
    pub window_start: i64,
    pub count: u64,
    pub created_at: i64,
}

impl ApiKey {
    pub const SPACE: usize = ACCOUNT_DISCRIMINATOR_LEN + 32 + 32 + 32 + 1 + 8 + 8 + 8;
}

#[error_code]
pub enum GatekeeperError {
    #[msg("Caller is not the authority")]
    Unauthorized,
    #[msg("API key has been revoked")]
    KeyRevoked,
    #[msg("Usage plan is inactive")]
    PlanInactive,
    #[msg("Missing required scope bits")]
    InsufficientScopes,
    #[msg("Rate limit exceeded for current window")]
    RateLimitExceeded,
    #[msg("Referenced plan or role is invalid")]
    InvalidPlanOrRole,
}

fn assert_authority(global_state: &Account<GlobalState>, authority: &Signer) -> Result<()> {
    require_keys_eq!(
        global_state.authority,
        authority.key(),
        GatekeeperError::Unauthorized
    );
    Ok(())
}

fn to_fixed_name(name: String) -> [u8; 32] {
    let mut out = [0u8; 32];
    let bytes = name.as_bytes();
    let len = bytes.len().min(32);
    out[..len].copy_from_slice(&bytes[..len]);
    out
}
