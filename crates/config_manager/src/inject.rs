use std::{error::Error};
use kuchikiki::traits::*;

use crate::{config::Config, utils::TagsMap};

pub fn inject_html(
	html: &str,
	config: &Config,
	tags: &TagsMap,
	hash: &str
) -> Result<String, Box<dyn Error>> {
	let document = kuchikiki::parse_html().one(html);
	let head = document.select_first("head")
		.map_err(|_| "no <head>")?
		.as_node()
		.clone();

	// 1. social meta tags — fixed Vec<Tag> from config, insert_tag each
	// 2. general tags — for (_, tag) in tags { insert_tag(&head, tag); }
	// 3. www:config — merged meta config + branding{logo_light,logo_dark}, one <meta name="www:config">
	// 4. sortHead — collect head children, sort, detach all, rewrite href/src w/ BASE_PATH, re-append

	Ok("()".into())
}
