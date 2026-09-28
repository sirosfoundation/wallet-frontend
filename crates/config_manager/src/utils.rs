use std::{collections::HashMap, error::Error, fs::read_to_string, path::{Path, PathBuf}};
use serde::{Deserialize};

pub fn path_with_base(base_path: &str, path: &str) -> String {
	if base_path.is_empty() {
		return path.to_string();
	}

	if path.is_empty() {
		return base_path.to_string();
	}

	format!("{}/{}", base_path.trim_end_matches('/'), path.trim_start_matches('/'))
}

pub fn path_with_hash_suffix(path: &str, hash: &str) -> String {
	if hash.is_empty() {
		path.to_string()
	} else {
		format!("{}?v={}", path, hash)
	}
}

pub struct FileToWrite<T> {
	/// The filename to write the content to.
	filename: String,
	/// The finished data.
	data: Option<T>,
	/// The content to write to the file as a string.
	content: String,
}

#[derive(Debug)]
pub enum TagKind {
	Meta,
	Link,
	Title,
}

#[derive(Debug)]
pub struct Tag {
	pub kind: TagKind,
	pub props: Option<HashMap<String, String>>,
	pub text_content: Option<String>,
}

pub type TagsMap = HashMap<String, Tag>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViteManifestEntry {
	file: String,
	src: Option<String>,
	is_entry: Option<bool>,
	css: Option<Vec<String>>,
	assets: Option<Vec<String>>,
}

pub type ViteManifest = HashMap<String, Option<ViteManifestEntry>>;

pub fn read_vite_manifest(base_path: &str) -> Result<ViteManifest, Box<dyn Error>> {
	let manifest_path: PathBuf = Path::new(base_path)
		.join(".vite")
		.join("manifest.json");

	let manifest_content: String = read_to_string(manifest_path)?;

	let manifest: ViteManifest = serde_json::from_str(&manifest_content)?;

	Ok(manifest)
}

/// Parses a configuration string into a `HashMap<String, String>`.
///
/// The input string should have key-value pairs separated by commas,
/// with each key and value separated by `::`.
/// If `strict` is `true`, the function will return an error if no
/// valid key-value pairs are found.
pub fn parse_config_string_map(
	input: &str,
	strict: bool,
) -> Result<HashMap<String, String>, Box<dyn Error>> {
	let mut map = HashMap::new();

	if input.is_empty() {
		return Err("Input string is empty".into());
	}

	for pkg in input.split(',') {
		if let Some((key, value)) = pkg.split_once("::") {
			map.insert(key.to_string(), value.to_string());
		}
	}

	if strict && map.is_empty() {
		return Err("No valid key-value pairs found".into());
	}

	Ok(map)
}

/// Parses a configuration string into a `Vec<String>`.
///
/// The input string should have items separated by commas.
/// If `strict` is `true`, the function will return an error
/// if no valid items are found.
pub fn parse_config_string_vec(
	input: &str,
	strict: bool,
) -> Result<Vec<String>, Box<dyn Error>> {
	let mut vec = Vec::new();

	if input.is_empty() {
		return Err("Input string is empty".into());
	}

	for item in input.split(',') {
		if !item.is_empty() {
			vec.push(item.to_string());
		}
	}

	if strict && vec.is_empty() {
		return Err("No valid items found".into());
	}

	Ok(vec)
}

pub fn camel_to_kebab(s: &str) -> String {
	let mut out = String::new();
	for c in s.chars() {
		if c.is_uppercase() {
			out.push('-');
			out.extend(c.to_lowercase());  // to_lowercase yields an iterator (some chars map to many)
		} else {
			out.push(c);
		}
	}
	out
}
