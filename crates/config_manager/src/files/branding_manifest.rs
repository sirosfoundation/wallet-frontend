use serde::Serialize;

use crate::{
	branding::{
		files::{self, Screenshot, Screenshots},
		icons::{self, Icons},
	},
	dom::Tag,
	files::OutputFile,
	fs::Fs,
	utils::{self},
};
use std::path::Path;

pub struct BrandingManifest;

impl OutputFile for BrandingManifest {
	fn generate(
		&self,
		fs: &dyn Fs,
		source_dir: &Path,
		dest_dir: &Path,
		config: &crate::config::Config,
		branding_hash: &str,
	) -> Vec<(String, Tag)> {
		let hash_suffix = if branding_hash.is_empty() {
			"".to_string()
		} else {
			format!("?v={}", branding_hash)
		};

		let icons = icons::generate_all_icons(
			fs,
			icons::GenerateAllIconsOptions {
				source_dir: source_dir.to_path_buf(),
				destination_dir: dest_dir.to_path_buf(),
				branding_hash: branding_hash.to_string(),
				manifest_icon_sizes: vec![16, 32, 64, 192, 512],
				apple_touch_icon: Some(true),
				copy_source: Some(true),
			},
		);

		let manifest =
			self.generate_manifest(branding_hash, config.static_name(), icons);

		let manifest_json = serde_json::to_string_pretty(&manifest).unwrap();
		fs.write(&dest_dir.join("manifest.json"), manifest_json.as_bytes())
			.unwrap();

		files::copy_screenshots(fs, &source_dir, &dest_dir);

		let make_href = |href: &str| {
			utils::path_with_hash_suffix(
				&utils::path_with_base(config.base_path(), href),
				&hash_suffix,
			)
		};

		vec![
			(
				"manifest".to_string(),
				Tag::link()
					.attr("rel", "manifest")
					.attr("href", make_href("manifest.json")),
			),
			(
				"apple-touch-icon".to_string(),
				Tag::link()
					.attr("rel", "apple-touch-icon")
					.attr("href", make_href("apple-touch-icon.png")),
			),
			(
				"favicon".to_string(),
				Tag::link()
					.attr("rel", "icon")
					.attr("href", make_href("favicon.ico")),
			),
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
