pub const ACCOUNT_DISCRIMINATOR_LEN: usize = 8;
pub const GLOBAL_STATE_SEED: &[u8] = b"global_state";
pub const PLAN_SEED: &[u8] = b"plan";
pub const ROLE_SEED: &[u8] = b"role";
pub const KEY_SEED: &[u8] = b"key";

pub const KEY_STATUS_ACTIVE: u8 = 0;
pub const KEY_STATUS_REVOKED: u8 = 1;
