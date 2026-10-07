use std::{collections::HashMap, error::Error};

pub fn path_with_base(base_path: &str, path: &str) -> String {
	if base_path.is_empty() {
		return path.to_string();
	}

	if path.is_empty() {
		return base_path.to_string();
	}

	format!(
		"{}/{}",
		base_path.trim_end_matches('/'),
		path.trim_start_matches('/')
	)
}

pub fn path_with_hash_suffix(path: &str, hash: &str) -> String {
	if hash.is_empty() {
		path.to_string()
	} else {
		format!("{}?v={}", path, hash)
	}
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

	for (i, c) in s.chars().enumerate() {
		if c.is_uppercase() {
			if i != 0 {
				out.push('-');
			}

			out.extend(c.to_lowercase());
		} else {
			out.push(c);
		}
	}
	out
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_path_with_base() {
		assert_eq!(path_with_base("", "path"), "path");
		assert_eq!(path_with_base("base", ""), "base");
		assert_eq!(path_with_base("base", "path"), "base/path");
	}

	#[test]
	fn test_path_with_hash_suffix() {
		assert_eq!(path_with_hash_suffix("path", ""), "path");
		assert_eq!(path_with_hash_suffix("path", "hash"), "path?v=hash");
	}

	#[test]
	fn test_parse_config_string_map() {
		let input = "key1::value1,key2::value2";
		let map = parse_config_string_map(input, true).unwrap();
		assert_eq!(map.get("key1").unwrap(), "value1");
		assert_eq!(map.get("key2").unwrap(), "value2");
	}

	#[test]
	fn test_parse_config_string_vec() {
		let input = "item1,item2";
		let vec = parse_config_string_vec(input, true).unwrap();
		assert_eq!(vec, vec!["item1", "item2"]);
	}

	#[test]
	fn test_camel_to_kebab() {
		assert_eq!(camel_to_kebab("CamelCase"), "camel-case");
		assert_eq!(camel_to_kebab("camelCase"), "camel-case");
	}
}
