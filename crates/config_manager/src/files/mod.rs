use crate::{config::Config, utils};
use std::{collections::HashMap, path::Path};
pub mod branding_manifest;
pub mod metadata_image;
pub mod robots;
pub mod sitemap;
pub mod theme;
pub mod well_known;

const ANDROID_ASSETLINKS_FILE: &str = "assetlinks.json";
const APPLE_APPIDS_FILE: &str = "apple-app-site-association";

/// Module for handling various output files like robots.txt and sitemap.xml.
pub trait OutputFile {
	fn generate(
		&self,
		source_dir: &Path,
		dest_dir: &Path,
		config: &Config,
		branding_hash: &str,
	) -> Vec<(String, utils::Tag)>;
}

/// Writes all output files to the specified destination directory and
/// returns a map of tags.
pub fn write_all(
	source_dir: &Path,
	dest_dir: &Path,
	config: &Config,
	branding_hash: &str,
) -> HashMap<String, utils::Tag> {
	let files: Vec<Box<dyn OutputFile>> = vec![
		Box::new(robots::RobotsTxt),
		Box::new(sitemap::SitemapXml),
		Box::new(well_known::WellKnown),
		Box::new(branding_manifest::BrandingManifest),
		Box::new(theme::Theme),
		Box::new(metadata_image::MetadataImage),
	];

	let mut tags: HashMap<String, utils::Tag> = HashMap::new();

	for file in &files {
		tags.extend(file.generate(source_dir, dest_dir, config, branding_hash));
	}

	tags
}
