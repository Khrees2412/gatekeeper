use anchor_lang::prelude::*;

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
