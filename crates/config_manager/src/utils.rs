use html5ever::{LocalName, QualName, namespace_url, ns};
use kuchikiki::{Attribute, ExpandedName, NodeRef};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, error::Error};
use tsify::Tsify;

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

#[derive(Serialize, Deserialize, Tsify)]
pub struct Tags(pub std::collections::HashMap<String, Tag>);

#[derive(Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "lowercase")]
pub enum TagKind {
	Meta,
	Link,
	Title,
}

#[derive(Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
	#[serde(rename = "tag")]
	pub kind: TagKind,
	pub props: Option<HashMap<String, String>>,
	pub text_content: Option<String>, // → textContent in TS
}

impl Tag {
	fn tag_name(&self) -> &'static str {
		match self.kind {
			TagKind::Meta => "meta",
			TagKind::Link => "link",
			TagKind::Title => "title",
		}
	}
	pub fn meta() -> Self {
		Self {
			kind: TagKind::Meta,
			props: None,
			text_content: None,
		}
	}
	pub fn link() -> Self {
		Self {
			kind: TagKind::Link,
			props: None,
			text_content: None,
		}
	}
	pub fn title(text: impl Into<String>) -> Self {
		Self {
			kind: TagKind::Title,
			props: None,
			text_content: Some(text.into()),
		}
	}

	/// Add/overwrite an attribute; chainable.
	pub fn attr(
		mut self,
		key: impl Into<String>,
		value: impl Into<String>,
	) -> Self {
		self
			.props
			.get_or_insert_with(HashMap::new)
			.insert(key.into(), value.into());
		self
	}

	/// Render a Tag to valid HTML node.
	pub fn to_node(&self) -> NodeRef {
		let name = match self.kind {
			TagKind::Meta => "meta",
			TagKind::Link => "link",
			TagKind::Title => "title",
		};

		// props (Option<HashMap>) → (ExpandedName, Attribute) pairs
		let attrs = self.props.iter().flatten().map(|(k, v)| {
			(
				ExpandedName::new(ns!(), k.as_str()),
				Attribute {
					prefix: None,
					value: v.clone(),
				},
			)
		});

		let el = NodeRef::new_element(
			QualName::new(None, ns!(html), LocalName::from(name)),
			attrs,
		);

		if let Some(text) = &self.text_content {
			el.append(NodeRef::new_text(text.as_str()));
		}

		el
	}

	/// Render a Tag to a HTML string.
	pub fn to_string(&self) -> String {
		let node = self.to_node();

		node.to_string()
	}
}

pub fn insert_tag(head: &NodeRef, tag: &Tag) {
	let element = tag.to_node();

	// selector from identifying attributes only
	const IDENTIFYING: [&str; 4] = ["name", "rel", "property", "media"];
	let selector_props: String = tag
		.props
		.iter()
		.flatten()
		.filter(|(k, _)| IDENTIFYING.contains(&k.as_str()))
		.map(|(k, v)| format!("[{k}=\"{v}\"]"))
		.collect();

	let selector = format!("{}{}", tag.tag_name(), selector_props);

	match head.select_first(&selector) {
		Ok(existing) => {
			// replaceWith: put new node before the old, then detach the old
			let node = existing.as_node();
			node.insert_before(element);
			node.detach();
		}
		Err(_) => head.append(element),
	}
}

pub fn get_tag_sorting_priority(node: &NodeRef) -> i32 {
	let el = match node.as_element() {
		Some(el) => el,
		None => return 0,
	};

	let tag_name = el.name.local.to_string();
	let attrs = el.attributes.borrow();
	let get = |k: &str| attrs.get(k).unwrap_or("");
	let (rel, name, property, href) =
		(get("rel"), get("name"), get("property"), get("href"));

	if tag_name == "meta" && attrs.contains("charset") {
		return 1;
	}

	if tag_name == "meta" && name == "viewport" {
		return 2;
	}

	if tag_name == "title" {
		return 3;
	}

	if tag_name == "link" && rel.to_lowercase().contains("icon")
		|| tag_name == "link" && rel == "manifest"
		|| tag_name == "link" && href.to_lowercase().contains("theme.css")
		|| tag_name == "meta" && name == "theme-color"
	{
		return 4;
	}

	if tag_name == "meta"
		&& (name == "description"
			|| name == "keywords"
			|| name.starts_with("og:")
			|| name.starts_with("twitter:")
			|| property.starts_with("og:"))
	{
		return 5;
	}

	if (tag_name == "link" && rel == "stylesheet")
		|| tag_name == "style"
		|| tag_name == "script"
	{
		return 6;
	}

	if tag_name == "meta" && name == "www:config" {
		return 7;
	}

	8
}

pub type TagsMap = HashMap<String, Tag>;

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
			out.extend(c.to_lowercase()); // to_lowercase yields an iterator (some chars map to many)
		} else {
			out.push(c);
		}
	}
	out
}
