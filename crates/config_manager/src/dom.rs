use html5ever::{LocalName, QualName, namespace_url, ns};
use kuchikiki::{Attribute, ExpandedName, NodeRef};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tsify::Tsify;

pub type TagsMap = HashMap<String, Tag>;

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
