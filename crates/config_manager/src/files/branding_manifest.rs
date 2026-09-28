use serde::Serialize;

use std::{collections::HashMap, fs, path::Path};
use crate::{
	branding::{
		self,
		Icons,
		Screenshot,
		Screenshots
	},
	files::{
		BASE_PATH_ENV,
		STATIC_NAME_ENV,
		STATIC_NAME_FALLBACK,
		OutputFile
	},
	utils::{
		self,
		Tag,
		TagKind
	}
};

pub struct BrandingManifest;

impl OutputFile for BrandingManifest {
	fn generate(
			&self,
			source_dir: &Path,
			dest_dir: &Path,
			config: &crate::config::Config,
			branding_hash: &str,
		) -> Vec<(String, crate::utils::Tag)>
	{
		let hash_suffix = if branding_hash.is_empty() {
			"".to_string()
		} else {
			format!("?v={}", branding_hash)
		};

		let icons = branding::generate_all_icons(branding::GenerateAllIconsOptions {
			source_dir: source_dir.to_path_buf(),
			destination_dir: dest_dir.to_path_buf(),
			branding_hash: branding_hash.to_string(),
			manifest_icon_sizes: vec![16, 32, 64, 192, 512],
			apple_touch_icon: Some(true),
			copy_source: Some(true),
		});

		let manifest = self.generate_manifest(
			branding_hash,
			config.get_str(STATIC_NAME_ENV)
				.unwrap_or(STATIC_NAME_FALLBACK),
			icons,
		);

		let manifest_json = serde_json::to_string_pretty(&manifest).unwrap();
		fs::write(dest_dir.join("manifest.json"), manifest_json).unwrap();

		branding::copy_screenshots(&source_dir, &dest_dir);

		vec![
			(
				"manifest".to_string(),
				Tag {
					kind: TagKind::Link,
					props: Some(HashMap::from([
						("rel".to_string(), "manifest".to_string()),
						(
							"href".to_string(),
							utils::path_with_base(
								config.get_str(BASE_PATH_ENV).unwrap_or(""),
								format!("manifest.json{hash_suffix}").as_str(),
							)
						),
					])),
					text_content: None,
				}
			),
			(
				"apple-touch-icon".to_string(),
				Tag {
					kind: TagKind::Link,
					props: Some(HashMap::from([
						("rel".to_string(), "apple-touch-icon".to_string()),
						(
							"href".to_string(),
							utils::path_with_base(
								config.get_str(BASE_PATH_ENV).unwrap_or(""),
								format!("apple-touch-icon.png{hash_suffix}").as_str(),
							)
						),
					])),
					text_content: None,
				}
			),
			(
				"favicon".to_string(),
				Tag {
					kind: TagKind::Link,
					props: Some(HashMap::from([
						("rel".to_string(), "icon".to_string()),
						(
							"href".to_string(),
							utils::path_with_base(
								config.get_str(BASE_PATH_ENV).unwrap_or(""),
								format!("favicon.ico{hash_suffix}").as_str(),
							)
						),
					])),
					text_content: None,
				}
			)
		]
	}
}

impl BrandingManifest {
	fn generate_manifest(
		&self,
		hash: &str,
		name: &str,
		icons: Icons,
	) -> Manifest {
		let hash_suffix = if hash.is_empty() {
			"".to_string()
		} else {
			format!("?v={}", hash)
		};

		let screenshots = vec![
			Screenshot {
				src: format!("screenshots/screen_mobile_1.png{hash_suffix}"),
				sizes: "828x1792".to_string(),
				typ: "image/png".to_string(),
				form_factor: "narrow".to_string(),
				label: "Home screen showing navigation and a credential".to_string(),
			},
			Screenshot {
				src: format!("screenshots/screen_mobile_2.png{hash_suffix}"),
				sizes: "828x1792".to_string(),
				typ: "image/png".to_string(),
				form_factor: "narrow".to_string(),
				label: "Credential selection view".to_string(),
			},
			Screenshot {
				src: format!("screenshots/screen_tablet_1.png{hash_suffix}"),
				sizes: "2160x1620".to_string(),
				typ: "image/png".to_string(),
				form_factor: "wide".to_string(),
				label: "Home screen showing navigation and a credential".to_string(),
			},
			Screenshot {
				src: format!("screenshots/screen_tablet_2.png{hash_suffix}"),
				sizes: "2160x1620".to_string(),
				typ: "image/png".to_string(),
				form_factor: "wide".to_string(),
				label: "Credential selection view".to_string(),
			},
		];

		Manifest {
			short_name: name.to_string(),
			name: name.to_string(),
			icons: icons,
			screenshots: screenshots,
			start_url: "/".to_string(),
			display: "standalone".to_string(),
			theme_color: "#111827".to_string(),
			background_color: "#ffffff".to_string(),
			description: format!(
				"{} enables secure storage and management of verifiable credentials.",
				name,
			),
			scope: "/".to_string(),
			dir: "ltr".to_string(),
			lang: "en".to_string(),
		}
	}
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "snake_case")]
struct Manifest {
	short_name: String,
	name: String,
	icons: Icons,
	screenshots: Screenshots,
	start_url: String,
	display: String,
	theme_color: String,
	background_color: String,
	description: String,
	scope: String,
	dir: String,
	lang: String,
}
