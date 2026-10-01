use kuchikiki::{NodeRef, traits::*};
use std::{error::Error, vec};

use crate::{
	config::Config,
	dom::{self, Tag, TagsMap},
	utils,
};

pub fn inject_html(
	html: &str,
	config: &Config,
	tags: &TagsMap,
) -> Result<String, Box<dyn Error>> {
	let document = kuchikiki::parse_html().one(html);
	let head = document
		.select_first("head")
		.map_err(|_| "no <head>")?
		.as_node()
		.clone();

	let mut social_meta_tags: Vec<Tag> = vec![
		Tag::title(config.static_name()),
		Tag::meta()
			.attr("name", "description")
			.attr("content", format!("{} is a secure web wallet for storing and managing verifiable credentials.", config.static_name())),
		Tag::meta()
			.attr("name", "keywords")
			.attr("content", "wwWallet, web wallet, wallet, secure storage, verifiable credentials, digital credentials, credentials management"),
		Tag::meta()
			.attr("property", "og:title")
			.attr("content", config.static_name()),
		Tag::meta()
			.attr("property", "og:description")
			.attr("content", format!("{} is a secure web wallet for storing and managing verifiable credentials.", config.static_name())),
		Tag::meta()
			.attr("property", "og:type")
			.attr("content", "website"),
		Tag::meta()
			.attr("name", "twitter:title")
			.attr("content", config.static_name()),
		Tag::meta()
			.attr("name", "twitter:description")
			.attr("content", format!("{} is a secure web wallet for storing and managing verifiable credentials.", config.static_name())),
		Tag::meta()
			.attr("name", "twitter:card")
			.attr("content", "summary_large_image"),
	];

	if let Some(static_public_url) = config.static_public_url() {
		social_meta_tags.push(
			Tag::meta()
				.attr("property", "og:url")
				.attr("content", static_public_url),
		)
	}

	for tag in social_meta_tags {
		dom::insert_tag(&head, &tag);
	}

	for tag in tags.values() {
		dom::insert_tag(&head, &tag);
	}

	let config_str = config.to_json_string(None)?;

	let www_config_tag = Tag::meta()
		.attr("name", "www:config")
		.attr("content", config_str);

	dom::insert_tag(&head, &www_config_tag);

	sort_head(&head, &config);

	Ok(document.to_string())
}

pub fn sort_head(head: &NodeRef, config: &Config) {
	let base_path = config.base_path();

	let all: Vec<NodeRef> = head.children().collect();

	let mut elements: Vec<NodeRef> = all
		.iter()
		.filter(|n| n.as_element().is_some())
		.cloned()
		.collect();

	elements.sort_by(|a, b| {
		dom::get_tag_sorting_priority(a)
			.cmp(&dom::get_tag_sorting_priority(b))
			.then_with(|| sort_key(a).cmp(&sort_key(b)))
	});

	for child in all {
		child.detach();
	}

	for child in elements {
		if !base_path.is_empty() {
			if let Some(el) = child.as_element() {
				let mut attrs = el.attributes.borrow_mut();

				for attr in ["href", "src"] {
					if let Some(value) = attrs.get_mut(attr) {
						if !value.is_empty() && !value.starts_with(&base_path) {
							*value = utils::path_with_base(&base_path, value);
						}
					}
				}
			}
		}

		head.append(child);
	}
}

fn sort_key(node: &NodeRef) -> String {
	node
		.as_element()
		.map(|el| {
			let a = el.attributes.borrow();

			a.get("href")
				.or_else(|| a.get("src"))
				.or_else(|| a.get("name"))
				.unwrap_or("")
				.to_string()
		})
		.unwrap_or_default()
}
