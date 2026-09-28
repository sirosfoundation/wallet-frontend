use crate::{branding, files::{BASE_PATH_ENV, OutputFile}};
use std::{fs, path::Path};
use crate::utils;

pub struct Theme;

impl OutputFile for Theme {
	fn generate(
		&self,
		source_dir: &Path,
		dest_dir: &Path,
		config: &crate::config::Config,
		branding_hash: &str,
	) -> Vec<(String, utils::Tag)> {
		let css = branding::generate_theme_css(branding::GenerateThemeOptions {
			source_dir: source_dir.to_path_buf(),
		});

		fs::write(dest_dir.join("theme.css"), css).unwrap();

		vec![
			(
				"theme-css".to_string(),
				utils::Tag::link()
					.attr("rel", "stylesheet")
					.attr(
						"href",
						utils::path_with_base(
							config.get_str(BASE_PATH_ENV).unwrap_or(""),
							&utils::path_with_hash_suffix(
								"theme.css",
								branding_hash,
							),
						),
					),
			),
			(
				"theme-color-light".to_string(),
				utils::Tag::meta()
					.attr("name", "theme-color")
					.attr("media", "(prefers-color-scheme: light)")
					.attr("content", "#f8f9f9"),
			),
			(
				"theme-color-dark".to_string(),
				utils::Tag::meta()
					.attr("name", "theme-color")
					.attr("media", "(prefers-color-scheme: dark)")
					.attr("content", "#0c0e11"),
			)
		]
	}
}
