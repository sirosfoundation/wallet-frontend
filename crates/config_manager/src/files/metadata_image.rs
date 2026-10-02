use crate::{
	branding::metadata_image, dom::Tag, files::OutputFile, fs::Fs, utils,
};

pub struct MetadataImage;

impl OutputFile for MetadataImage {
	fn generate(
		&self,
		fs: &dyn Fs,
		schema_dir: &std::path::Path,
		source_dir: &std::path::Path,
		dest_dir: &std::path::Path,
		config: &crate::config::Config,
		branding_hash: &str,
	) -> Vec<(String, Tag)> {
		let title = config.static_name();

		let result = metadata_image::generate_metadata_image(
			fs,
			metadata_image::MetadataImageOptions {
				schema_dir: schema_dir.to_path_buf(),
				source_dir: source_dir.to_path_buf(),
				title: title.to_string(),
			},
		)
		.expect("Metadata image generation failed");

		fs.write(&dest_dir.join("image.png"), &result.png_buffer)
			.unwrap();

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
				Tag::meta()
					.attr("property", "og:image")
					.attr("content", &url),
			),
			(
				"twitter-image".to_string(),
				Tag::meta()
					.attr("name", "twitter:image")
					.attr("content", &url),
			),
		]
	}
}
