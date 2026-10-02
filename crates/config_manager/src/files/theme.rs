use crate::branding::theme;
use crate::utils;
use crate::{dom::Tag, files::OutputFile, fs::Fs};
use std::path::Path;

pub struct Theme;

impl OutputFile for Theme {
	fn generate(
		&self,
		fs: &dyn Fs,
		schema_dir: &Path,
		source_dir: &Path,
		dest_dir: &Path,
		config: &crate::config::Config,
		branding_hash: &str,
	) -> Vec<(String, Tag)> {
		let css = theme::generate_theme_css(
			fs,
			theme::GenerateThemeOptions {
				schema_dir: schema_dir.to_path_buf(),
				source_dir: source_dir.to_path_buf(),
			},
		);

		fs.write(&dest_dir.join("theme.css"), css.as_bytes())
			.unwrap();

		vec![
			(
				"theme-css".to_string(),
				Tag::link().attr("rel", "stylesheet").attr(
					"href",
					utils::path_with_base(
						config.base_path(),
						&utils::path_with_hash_suffix("theme.css", branding_hash),
					),
				),
			),
			(
				"theme-color-light".to_string(),
				Tag::meta()
					.attr("name", "theme-color")
					.attr("media", "(prefers-color-scheme: light)")
					.attr("content", "#f8f9f9"),
			),
			(
				"theme-color-dark".to_string(),
				Tag::meta()
					.attr("name", "theme-color")
					.attr("media", "(prefers-color-scheme: dark)")
					.attr("content", "#0c0e11"),
			),
		]
	}
}
