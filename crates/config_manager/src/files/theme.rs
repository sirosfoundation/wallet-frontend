use crate::{branding, files::{BASE_PATH_ENV, OutputFile}};
use std::{collections::HashMap, fs, path::Path};
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
				utils::Tag {
					kind: utils::TagKind::Link,
					props: Some(HashMap::from([
						("rel".to_string(), "stylesheet".to_string()),
						(
							"href".to_string(),
							utils::path_with_base(
								config.get_str(BASE_PATH_ENV).unwrap_or(""),
								&utils::path_with_hash_suffix(
									"theme.css",
									branding_hash,
								),
							),
						),
					])),
					text_content: None,
				},
			),
			(
				"theme-color-light".to_string(),
				utils::Tag {
					kind: utils::TagKind::Meta,
					props: Some(HashMap::from([
						("name".to_string(), "theme-color".to_string()),
						("media".to_string(), "(prefers-color-scheme: light)".to_string()),
						("content".to_string(), "#f8f9f9".to_string()),
					])),
					text_content: None,
				},
			),
			(
				"theme-color-dark".to_string(),
				utils::Tag {
					kind: utils::TagKind::Meta,
					props: Some(HashMap::from([
						("name".to_string(), "theme-color".to_string()),
						("media".to_string(), "(prefers-color-scheme: dark)".to_string()),
						("content".to_string(), "#0c0e11".to_string()),
					])),
					text_content: None,
				},
			)
		]
	}
}
