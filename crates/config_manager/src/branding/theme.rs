use crate::fs::Fs;
use crate::utils;
use serde_json::Value;
use std::error::Error;
use std::path::Path;
use std::path::PathBuf;

pub struct ThemeConfigPaths {
	custom_path: PathBuf,
	default_path: PathBuf,
}

pub fn all_theme_config_paths(source_dir: &Path) -> ThemeConfigPaths {
	return ThemeConfigPaths {
		custom_path: source_dir.join("custom").join("theme.json"),
		default_path: source_dir.join("default").join("theme.json"),
	};
}

pub fn load_theme(
	fs: &dyn Fs,
	source_dir: &Path,
) -> Result<Value, Box<dyn Error>> {
	let paths = all_theme_config_paths(source_dir);

	let config_path = if fs.exists(&paths.custom_path) {
		paths.custom_path
	} else if fs.exists(&paths.default_path) {
		paths.default_path
	} else {
		return Err("No theme.json found".into());
	};

	let raw = fs.read(&config_path).unwrap();
	let raw = String::from_utf8(raw).unwrap();
	let theme: Value = serde_json::from_str(&raw).unwrap();

	let schema_path = source_dir.join(".schemas").join("theme.json");

	if fs.exists(&schema_path) {
		let schema_raw = fs.read(&schema_path).unwrap();
		let schema_raw = String::from_utf8(schema_raw).unwrap();
		let schema: Value = serde_json::from_str(&schema_raw).unwrap();

		let validator =
			jsonschema::validator_for(&schema).expect("invalid theme schema");

		if !validator.is_valid(&theme) {
			let errors: Vec<String> = validator
				.iter_errors(&theme)
				.map(|e| format!("{e} (at {})", e.instance_path()))
				.collect();
			panic!(
				"theme.json failed schema validation:\n{}",
				errors.join("\n")
			);
		}
	} else {
		eprintln!("No theme schema found. Skipping schema validation.");
	}

	Ok(theme)
}

/// Attempts to retrieve the primary brand color from the theme configuration.
/// Since the theme schema can change, we need to be able to fall back to multiple
/// possible locations within the theme configuration.
pub fn get_primary_brand_color(
	theme: &Value,
) -> Result<String, Box<dyn Error>> {
	let candidates = [
		["brand", "color"],
		["brand", "primary"],
		["brand", "background"],
		["primary", "color"],
	];

	for candidate in candidates {
		let mut current = theme;
		for key in candidate {
			if let Some(next) = current.get(key) {
				current = next;
			} else {
				current = &Value::Null;
				break;
			}
		}
		if let Some(color) = current.as_str() {
			return Ok(color.to_string());
		}
	}

	Err("No suitable primary brand color found".into())
}

pub struct GenerateThemeOptions {
	pub source_dir: PathBuf,
}

pub fn generate_theme_css(
	fs: &dyn Fs,
	options: GenerateThemeOptions,
) -> String {
	let theme = load_theme(fs, &options.source_dir).unwrap();

	let brand = theme["brand"].as_object().unwrap();

	let mut css = String::from(":root {\n");

	for (key, value) in brand {
		let var = utils::camel_to_kebab(key);
		css.push_str(&format!(
			"  --theme-brand-{var}: {};\n",
			value.as_str().unwrap_or("")
		));
	}

	css.push('}');

	css
}
