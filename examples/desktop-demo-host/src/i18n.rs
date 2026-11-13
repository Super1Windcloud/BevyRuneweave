use std::sync::OnceLock;

pub(super) fn is_chinese() -> bool {
    static LANGUAGE: OnceLock<bool> = OnceLock::new();
    *LANGUAGE.get_or_init(|| chinese_locale(sys_locale::get_locale().as_deref().unwrap_or("en")))
}

fn chinese_locale(locale: &str) -> bool {
    locale
        .split(['-', '_', '.', '@'])
        .next()
        .is_some_and(|language| language.eq_ignore_ascii_case("zh"))
}

pub(super) fn text(key: &str) -> &str {
    text_for(is_chinese(), key)
}

fn text_for(chinese: bool, key: &str) -> &str {
    if chinese {
        let messages = crate::localized_messages::MESSAGES;
        if let Ok(index) = messages.binary_search_by(|(english, _)| english.cmp(&key)) {
            return messages[index].1;
        }
    }
    key
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn formatting_keeps_untrusted_values_as_data_in_selected_language() {
        let error = "a {name} %s / path";
        let actual = host_format!(
            "Could not inspect resource directory: {error}",
            error = error
        );
        let expected = if is_chinese() {
            format!("无法检查资源目录：{error}")
        } else {
            format!("Could not inspect resource directory: {error}")
        };
        assert_eq!(actual, expected);
    }

    #[test]
    fn system_chinese_variants_and_unsupported_languages_have_explicit_fallbacks() {
        for locale in ["zh", "zh-CN", "zh_Hans_CN", "zh-Hant-TW", "ZH-cn.UTF-8"] {
            assert!(chinese_locale(locale));
        }
        for locale in ["en-US", "fr-FR", "ja-JP", "", "zho"] {
            assert!(!chinese_locale(locale));
        }
        assert_eq!(text_for(true, "Home"), "首页");
        assert_eq!(text_for(false, "Home"), "Home");
        assert_eq!(
            text_for(true, "external package name"),
            "external package name"
        );
    }
}
