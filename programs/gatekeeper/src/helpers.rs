use anchor_lang::prelude::*;

use crate::errors::GatekeeperError;
use crate::state::GlobalState;

pub fn assert_authority(global_state: &Account<GlobalState>, authority: &Signer) -> Result<()> {
    require_keys_eq!(
        global_state.authority,
        authority.key(),
        GatekeeperError::Unauthorized
    );
    Ok(())
}

pub fn to_fixed_name(name: String) -> [u8; 32] {
    let mut out = [0u8; 32];
    let bytes = name.as_bytes();
    let len = bytes.len().min(32);
    out[..len].copy_from_slice(&bytes[..len]);
    out
}
