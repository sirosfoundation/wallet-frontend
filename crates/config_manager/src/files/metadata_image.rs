use std::fs;

use crate::{branding, files::{OutputFile, STATIC_NAME_ENV, STATIC_NAME_FALLBACK}, utils};

pub struct MetadataImage;

impl OutputFile for MetadataImage {
	fn generate(
		&self,
		source_dir: &std::path::Path,
		dest_dir: &std::path::Path,
		config: &crate::config::Config,
		branding_hash: &str,
	) -> Vec<(String, crate::utils::Tag)> {
		let title = config
			.get_str(STATIC_NAME_ENV)
			.unwrap_or(STATIC_NAME_FALLBACK)
			.to_string();

		let result = branding::generate_metadata_image(
			branding::MetadataImageOptions {
				source_dir: source_dir.to_path_buf(),
				title: title,
			}
		).expect("Metadata image generation failed");

		fs::write(
			dest_dir.join("image.png"),
			&result.png_buffer
		).unwrap();

		let base = config
			.get_str("STATIC_PUBLIC_URL")
			.unwrap_or("http://localhost:3000");

		let url = utils::path_with_hash_suffix(
			&utils::path_with_base(base, "image.png"),
			branding_hash,
		);

		vec![
			(
				"og-image".to_string(),
				utils::Tag::meta()
					.attr("property", "og:image")
					.attr("content", &url),
			),
			(
				"twitter-image".to_string(),
				utils::Tag::meta()
					.attr("name", "twitter:image")
					.attr("content", &url),
			)
		]
	}
}
