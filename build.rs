use std::{env, error::Error, fs};

const SCRIPT_KEY_NAME: &str = "RUNEWEAVE_SCRIPT_KEY";

fn dotenv_value(contents: &str, name: &str) -> Option<String> {
    contents.lines().find_map(|line| {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            return None;
        }
        let value = line.strip_prefix(name)?.strip_prefix('=')?.trim();
        Some(value.trim_matches(['\"', '\'']).to_owned())
    })
}

fn valid_key(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn main() -> Result<(), Box<dyn Error>> {
    println!("cargo:rerun-if-env-changed={SCRIPT_KEY_NAME}");
    println!("cargo:rerun-if-changed=.env");

    let key = env::var(SCRIPT_KEY_NAME)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            fs::read_to_string(".env")
                .ok()
                .and_then(|contents| dotenv_value(&contents, SCRIPT_KEY_NAME))
                .filter(|value| !value.is_empty())
        });
    if let Some(key) = key {
        if !valid_key(&key) {
            return Err(format!(
                "{SCRIPT_KEY_NAME} must contain exactly 64 hexadecimal characters"
            )
            .into());
        }
        println!("cargo:rustc-env={SCRIPT_KEY_NAME}={key}");
    }
    Ok(())
}
