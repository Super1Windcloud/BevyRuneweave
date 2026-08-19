use aes_gcm::{Aes256Gcm, KeyInit, aead::AeadInPlace};
use bevy_mod_scripting::prelude::ScriptAssetError;
use std::io;

const MAGIC: &[u8; 4] = b"RWSC";
const VERSION: u8 = 1;
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;
const HEADER_LEN: usize = MAGIC.len() + 1 + NONCE_LEN;
const EMBEDDED_KEY: Option<&str> = option_env!("RUNEWEAVE_SCRIPT_KEY");

fn crypto_error(message: impl Into<String>) -> ScriptAssetError {
    ScriptAssetError::new(
        "decrypting AES-256-GCM source",
        None,
        Box::new(io::Error::new(io::ErrorKind::InvalidData, message.into())),
    )
}

fn decode_key(value: &str) -> Result<[u8; 32], ScriptAssetError> {
    if value.len() != 64 {
        return Err(crypto_error(
            "RUNEWEAVE_SCRIPT_KEY must contain exactly 64 hexadecimal characters",
        ));
    }
    let mut key = [0_u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        let pair =
            std::str::from_utf8(pair).map_err(|_| crypto_error("script key is not UTF-8"))?;
        key[index] = u8::from_str_radix(pair, 16)
            .map_err(|_| crypto_error("script key contains a non-hexadecimal character"))?;
    }
    Ok(key)
}

fn decrypt_with_key(content: &mut [u8], key: &[u8; 32]) -> Result<(), ScriptAssetError> {
    if !content.starts_with(MAGIC) {
        return Ok(());
    }
    if content.len() < HEADER_LEN + TAG_LEN {
        return Err(crypto_error("encrypted script envelope is truncated"));
    }
    if content[MAGIC.len()] != VERSION {
        return Err(crypto_error(format!(
            "unsupported encrypted script version: {}",
            content[MAGIC.len()]
        )));
    }

    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| crypto_error("could not initialize AES-256-GCM"))?;
    let (header, encrypted) = content.split_at_mut(HEADER_LEN);
    let ciphertext_len = encrypted.len() - TAG_LEN;
    let (ciphertext, tag) = encrypted.split_at_mut(ciphertext_len);
    let nonce = aes_gcm::Nonce::from_slice(&header[MAGIC.len() + 1..]);
    let tag = aes_gcm::Tag::from_slice(tag);
    cipher
        .decrypt_in_place_detached(nonce, header, ciphertext, tag)
        .map_err(|_| {
            crypto_error("authentication failed; the key or encrypted source is invalid")
        })?;

    content.copy_within(HEADER_LEN..HEADER_LEN + ciphertext_len, 0);
    content[ciphertext_len..].fill(b' ');
    Ok(())
}

/// Decrypts release script assets before BMS creates a Lua or QuickJS context.
pub(crate) fn decrypt_script_asset(content: &mut [u8]) -> Result<(), ScriptAssetError> {
    if !content.starts_with(MAGIC) {
        return Ok(());
    }
    let started = std::time::Instant::now();
    let key = EMBEDDED_KEY
        .ok_or_else(|| crypto_error("runtime was built without RUNEWEAVE_SCRIPT_KEY"))?;
    let result = decrypt_with_key(content, &decode_key(key)?);
    eprintln!(
        "[runtime-timing] encrypted script decrypt: {} bytes in {:?}",
        content.len(),
        started.elapsed()
    );
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_KEY: [u8; 32] = [0x5a; 32];
    const TEST_NONCE: [u8; NONCE_LEN] = [0x3c; NONCE_LEN];

    fn encrypted_fixture(plaintext: &[u8]) -> Result<Vec<u8>, ScriptAssetError> {
        let mut header = Vec::from(MAGIC.as_slice());
        header.push(VERSION);
        header.extend_from_slice(&TEST_NONCE);
        let mut ciphertext = plaintext.to_vec();
        let cipher = Aes256Gcm::new_from_slice(&TEST_KEY)
            .map_err(|_| crypto_error("could not initialize test cipher"))?;
        let tag = cipher
            .encrypt_in_place_detached(
                aes_gcm::Nonce::from_slice(&TEST_NONCE),
                &header,
                &mut ciphertext,
            )
            .map_err(|_| crypto_error("could not encrypt test fixture"))?;
        header.extend_from_slice(&ciphertext);
        header.extend_from_slice(&tag);
        Ok(header)
    }

    #[test]
    fn decrypts_authenticated_script_and_blanks_envelope_tail() -> Result<(), ScriptAssetError> {
        let plaintext = b"globalThis.on_update=function(){};";
        let mut encrypted = encrypted_fixture(plaintext)?;
        decrypt_with_key(&mut encrypted, &TEST_KEY)?;
        assert_eq!(&encrypted[..plaintext.len()], plaintext);
        assert!(
            encrypted[plaintext.len()..]
                .iter()
                .all(|byte| *byte == b' ')
        );
        Ok(())
    }

    #[test]
    fn rejects_tampered_ciphertext() -> Result<(), ScriptAssetError> {
        let mut encrypted = encrypted_fixture(b"return 42")?;
        encrypted[HEADER_LEN] ^= 1;
        assert!(decrypt_with_key(&mut encrypted, &TEST_KEY).is_err());
        Ok(())
    }

    #[test]
    fn leaves_plaintext_development_scripts_unchanged() -> Result<(), ScriptAssetError> {
        let mut source = b"return 42".to_vec();
        decrypt_with_key(&mut source, &TEST_KEY)?;
        assert_eq!(source, b"return 42");
        Ok(())
    }
}
