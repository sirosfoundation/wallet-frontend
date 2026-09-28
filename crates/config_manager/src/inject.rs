use std::{collections::HashMap, error::Error, hash::Hash, vec};
use kuchikiki::{NodeRef, traits::*};

use crate::{config::Config, utils::{self, Tag, TagsMap}};

pub fn inject_html(
	html: &str,
	config: &Config,
	tags: &TagsMap,
) -> Result<String, Box<dyn Error>> {
	let document = kuchikiki::parse_html().one(html);
	let head = document.select_first("head")
		.map_err(|_| "no <head>")?
		.as_node()
		.clone();

	let social_meta_tags: Vec<Tag> = vec![
		Tag::title(config.get_str("STATIC_NAME").unwrap_or_default()),
		Tag::meta()
			.attr("name", "description")
			.attr("content", format!("{} is a secure web wallet for storing and managing verifiable credentials.", config.get_str("STATIC_NAME").unwrap_or_default())),
		Tag::meta()
			.attr("name", "keywords")
			.attr("content", "wwWallet, web wallet, wallet, secure storage, verifiable credentials, digital credentials, credentials management"),
		Tag::meta()
			.attr("property", "og:title")
			.attr("content", config.get_str("STATIC_NAME").unwrap_or_default()),
		Tag::meta()
			.attr("property", "og:description")
			.attr("content", format!("{} is a secure web wallet for storing and managing verifiable credentials.", config.get_str("STATIC_NAME").unwrap_or_default())),
		Tag::meta()
			.attr("property", "og:type")
			.attr("content", "website"),
		Tag::meta()
			.attr("property", "og:url")
			.attr("content", config.get_str("STATIC_PUBLIC_URL").unwrap_or_default()),
		Tag::meta()
			.attr("name", "twitter:title")
			.attr("content", config.get_str("STATIC_NAME").unwrap_or_default()),
		Tag::meta()
			.attr("name", "twitter:description")
			.attr("content", format!("{} is a secure web wallet for storing and managing verifiable credentials.", config.get_str("STATIC_NAME").unwrap_or_default())),
		Tag::meta()
			.attr("name", "twitter:card")
			.attr("content", "summary_large_image"),
	];

	for tag in social_meta_tags {
		utils::insert_tag(&head, &tag);
	}

	for tag in tags.values() {
		utils::insert_tag(&head, &tag);
	}

	let config_str = config.to_json_string(None)?;

	let www_config_tag = Tag::meta()
		.attr("name", "www:config")
		.attr("content", config_str);

	utils::insert_tag(&head, &www_config_tag);

	sort_head(&head, &config);

	Ok(document.to_string())
}

pub fn sort_head(head: &NodeRef, config: &Config) {
	let base_path = config.get_str("BASE_PATH").unwrap_or_default().to_string();

	let all: Vec<NodeRef> = head.children().collect();

	let mut elements: Vec<NodeRef> =
		all.iter().filter(|n| n.as_element().is_some()).cloned().collect();

	elements.sort_by(|a, b| {
		utils::get_tag_sorting_priority(a)
			.cmp(&utils::get_tag_sorting_priority(b))
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
	node.as_element()
		.map(|el| {
			let a = el.attributes.borrow();

			a.get("href").or_else(|| a.get("src")).or_else(|| a.get("name"))
				.unwrap_or("")
				.to_string()
		}).unwrap_or_default()
}
