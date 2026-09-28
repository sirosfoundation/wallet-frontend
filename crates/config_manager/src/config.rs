use serde_json::Value;
use std::collections::HashMap;
use std::{error::Error, path};

use crate::utils;

pub mod keys {
	pub const WALLET_BACKEND_URL: &str = "WALLET_BACKEND_URL";
	pub const BASE_PATH: &str = "BASE_PATH";
	pub const STATIC_NAME: &str = "STATIC_NAME";
	pub const STATIC_PUBLIC_URL: &str = "STATIC_PUBLIC_URL";
	pub const WELLKNOWN_APPLE_APPIDS: &str = "WELLKNOWN_APPLE_APPIDS";
	pub const WELLKNOWN_ANDROID: &str =
		"WELLKNOWN_ANDROID_PACKAGE_NAMES_AND_FINGERPRINTS";
}

pub enum Presence {
	/// Missing: crash.
	Required,
	/// Missing: use this fallback.
	Default(&'static str),
	/// Missing: callers handle `None`.
	Optional,
}

/// Required environment variables and their presence requirements.
/// These variables are used internally and must be dealt with according
/// to their presence requirements.
pub const ENV_SPEC: &[(&str, Presence)] = &[
	(keys::WALLET_BACKEND_URL, Presence::Required),
	(keys::BASE_PATH, Presence::Default("/")),
	(keys::STATIC_NAME, Presence::Default("Wallet")),
	(keys::STATIC_PUBLIC_URL, Presence::Optional),
	(keys::WELLKNOWN_APPLE_APPIDS, Presence::Optional),
	(keys::WELLKNOWN_ANDROID, Presence::Optional),
];

#[derive(Debug, Clone)]
pub struct Config(pub HashMap<String, Value>);

impl Config {
	pub fn get_str(&self, key: &str) -> Option<&str> {
		self.0.get(key).and_then(|v| v.as_str())
	}
	pub fn get_array(&self, key: &str) -> Option<&Vec<Value>> {
		self.0.get(key).and_then(|v| v.as_array())
	}
	pub fn get_bool(&self, key: &str) -> Option<bool> {
		self.0.get(key).and_then(|v| v.as_bool())
	}
	pub fn get_number(&self, key: &str) -> Option<serde_json::Number> {
		self
			.0
			.get(key)
			.and_then(|v| v.as_i64().map(serde_json::Number::from))
	}
	pub fn get(&self, key: &str) -> Option<&Value> {
		self.0.get(key)
	}
	pub fn insert(&mut self, key: &str, value: Value) {
		self.0.insert(key.to_string(), value);
	}
	pub fn to_json_string(
		&self,
		additional_keys: Option<&HashMap<String, Value>>,
	) -> Result<String, Box<dyn Error>> {
		let mut with_lowercase_keys = self
			.0
			.iter()
			.map(|(k, v)| (k.to_lowercase(), v.clone()))
			.collect::<serde_json::Map<String, Value>>();

		if let Some(additional) = additional_keys {
			for (k, v) in additional {
				with_lowercase_keys.insert(k.to_lowercase(), v.clone());
			}
		}

		Ok(serde_json::to_string(&with_lowercase_keys)?)
	}

	pub fn wallet_backend_url(&self) -> &str {
		self
			.get_str(keys::WALLET_BACKEND_URL)
			.expect("WALLET_BACKEND_URL is required")
	}
	pub fn base_path(&self) -> &str {
		self.get_str(keys::BASE_PATH).unwrap_or("/")
	}
	pub fn static_name(&self) -> &str {
		self.get_str(keys::STATIC_NAME).unwrap_or("Wallet")
	}
	pub fn static_public_url(&self) -> Option<&str> {
		self.get_str(keys::STATIC_PUBLIC_URL)
	}
	pub fn wellknown_apple_appids(&self) -> Option<&Vec<Value>> {
		self.get_array(keys::WELLKNOWN_APPLE_APPIDS)
	}
	pub fn wellknown_android(&self) -> Option<&str> {
		self.get_str(keys::WELLKNOWN_ANDROID)
	}
}

pub fn load_and_parse_config(
	schema_path: &path::Path,
	env: &HashMap<String, String>,
) -> Result<Config, Box<dyn Error>> {
	let schema = load_env_schema(schema_path)?;
	let parsed_env = parse_env(&schema, env)?;
	Ok(parsed_env)
}

fn load_env_schema(path: &path::Path) -> Result<Value, Box<dyn Error>> {
	let file_content = std::fs::read_to_string(path)?;
	let json_value: Value = serde_json::from_str(&file_content)?;
	Ok(json_value)
}

fn parse_env(
	schema: &Value,
	env: &HashMap<String, String>,
) -> Result<Config, Box<dyn Error>> {
	let required = schema["required"].as_array();
	let properties = schema
		.get("properties")
		.ok_or("Missing 'properties' in schema")?;

	let mut object = Value::Object(serde_json::Map::new());

	for (key, prop) in properties
		.as_object()
		.ok_or("Properties is not an object")?
	{
		// Check if the environment variable exists for this key
		if !env.contains_key(key) {
			if required.map_or(false, |arr| arr.iter().any(|v| v == key)) {
				return Err(
					format!("Missing required environment variable: {key}").into(),
				);
			}
			if let Some(default) = prop.get("default") {
				if !default.is_null() {
					if let Value::Object(ref mut map) = object {
						map.insert(key.clone(), default.clone());
					}
				}
			}
			continue;
		}

		// attempt to parse the environment variable according to the schema type
		let value = env.get(key).unwrap().clone();
		let desired_type =
			prop.get("type").and_then(Value::as_str).unwrap_or("string");
		let value = match desired_type {
			"string" => Value::String(value),
			"number" => Value::Number(value.parse::<serde_json::Number>()?),
			"boolean" => Value::Bool(value.parse::<bool>()?),
			"array" => Value::Array(
				utils::parse_config_string_vec(&value, true)?
					.into_iter()
					.map(Value::String)
					.collect(),
			),
			_ => Value::String(value),
		};

		if let Value::Object(ref mut map) = object {
			map.insert(key.clone(), value);
		}
	}

	// finally, validate the constructed object against the schema
	let validator =
		jsonschema::validator_for(&schema).expect("invalid environment schema");

	if !validator.is_valid(&object) {
		let errors: Vec<String> = validator
			.iter_errors(&object)
			.map(|e| format!("{e} (at {})", e.instance_path()))
			.collect();
		panic!(
			"environment failed schema validation:\n{}",
			errors.join("\n")
		);
	}

	// Convert the validated JSON object into a HashMap for easier usage
	let mut output = Config(
		object
			.as_object()
			.unwrap()
			.iter()
			.map(|(k, v)| (k.clone(), v.clone()))
			.collect(),
	);

	// enforce the Rust-side presence policy
	for (key, presence) in ENV_SPEC.iter() {
		match presence {
			Presence::Required => {
				if !output.0.contains_key(*key) {
					panic!("Missing required environment variable: {key}");
				}
			}
			Presence::Default(fallback) => {
				output
					.0
					.entry(key.to_string())
					.or_insert_with(|| Value::String(fallback.to_string()));
			}
			Presence::Optional => {}
		}
	}

	Ok(output)
}
