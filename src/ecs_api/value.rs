use std::collections::BTreeMap;

/// A language-neutral value stored in script-defined ECS components and resources.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum EcsValue {
    /// No value.
    #[default]
    Null,
    /// A boolean value.
    Bool(bool),
    /// A finite numeric value.
    Number(f64),
    /// A UTF-8 string.
    String(String),
    /// An ordered sequence.
    Array(Vec<Self>),
    /// A string-keyed record.
    Object(BTreeMap<String, Self>),
}

impl EcsValue {
    /// Returns an object field.
    pub fn field(&self, name: &str) -> Option<&Self> {
        match self {
            Self::Object(fields) => fields.get(name),
            _ => None,
        }
    }

    /// Returns this value as a number.
    pub const fn as_number(&self) -> Option<f64> {
        match self {
            Self::Number(value) => Some(*value),
            _ => None,
        }
    }

    /// Returns this value as a string.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::String(value) => Some(value),
            _ => None,
        }
    }
}
