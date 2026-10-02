use crate::{
	config,
	files::{ANDROID_ASSETLINKS_FILE, APPLE_APPIDS_FILE},
};
use std::{collections::HashMap, error::Error, path::Path};

use serde::Serialize;

use crate::dom::Tag;
use crate::files::OutputFile;
use crate::fs::Fs;

pub struct WellKnown;

impl OutputFile for WellKnown {
	fn generate(
		&self,
		fs: &dyn Fs,
		_schema_dir: &Path,
		_source_dir: &Path,
		dest_dir: &Path,
		config: &crate::config::Config,
		_branding_hash: &str,
	) -> Vec<(String, Tag)> {
		if !self.should_run(config) {
			return Vec::new();
		}

		let well_known_dir = dest_dir.join(".well-known");
		if fs.exists(&well_known_dir) {
			fs.remove_dir_all(&well_known_dir).unwrap();
		}

		let generators: [(
			&str,
			&str,
			fn(&WellKnown, &crate::config::Config) -> Result<String, Box<dyn Error>>,
		); 2] = [
			(
				config::keys::WELLKNOWN_ANDROID,
				ANDROID_ASSETLINKS_FILE,
				Self::generate_android_assetlinks,
			),
			(
				config::keys::WELLKNOWN_APPLE_APPIDS,
				APPLE_APPIDS_FILE,
				Self::generate_apple_appids,
			),
		];

		for (env_key, filename, generator) in generators {
			if config.get(env_key).is_some() {
				if let Ok(content) = generator(self, config) {
					fs.create_dir_all(&well_known_dir).unwrap();
					fs.write(&well_known_dir.join(filename), content.as_bytes())
						.unwrap();
				}
			}
		}

		Vec::new()
	}
}

impl WellKnown {
	/// Determines whether the WellKnown file generation should run
	/// based on the provided config.
	fn should_run(&self, config: &crate::config::Config) -> bool {
		config.wellknown_android().is_some()
			|| config.wellknown_apple_appids().is_some()
	}

	/// Generates the Android assetlinks.json content from the provided
	/// source string.
	fn generate_android_assetlinks(
		&self,
		config: &crate::config::Config,
	) -> Result<String, Box<dyn Error>> {
		let source = config.wellknown_android().unwrap_or("");
		let mut grouped: HashMap<String, Vec<String>> = HashMap::new();

		for pkg in source.split(',') {
			if let Some((name, fingerprints)) = pkg.split_once("::") {
				let name = name.trim();
				let fingerprints = fingerprints.trim();
				if name.is_empty() || fingerprints.is_empty() {
					continue;
				}

				grouped
					.entry(name.to_string())
					.or_default()
					.push(fingerprints.to_string());
			}
		}

		if grouped.is_empty() {
			return Err("No valid package/fingerprint pairs".into());
		}

		let template: Vec<AssetLink> = grouped
			.into_iter()
			.map(|(key, fingerprints)| AssetLink {
				relation: vec![
					"delegate_permission/common.handle_all_urls".to_string(),
					"delegate_permission/common.get_login_creds".to_string(),
				],
				target: AssetTarget {
					namespace: "android_app".to_string(),
					package_name: key.to_string(),
					sha256_cert_fingerprints: fingerprints,
				},
			})
			.collect();

		Ok(serde_json::to_string_pretty(&template)?)
	}

	/// Generates the Apple appids content from the provided source string.
	fn generate_apple_appids(
		&self,
		config: &crate::config::Config,
	) -> Result<String, Box<dyn Error>> {
		let app_ids: Vec<String> = config
			.wellknown_apple_appids()
			.map(|arr| {
				arr
					.iter()
					.filter_map(|v| v.as_str())
					.map(String::from)
					.collect()
			})
			.unwrap_or_default();

		if app_ids.is_empty() {
			return Err("App ID list is empty, skipping generation".into())
		}

		let template = AppleAppSiteAssociation {
			applinks: AppleAppLinks {
				details: vec![AppleAppId {
					app_ids: app_ids.clone(),
					components: vec![AppleAppIdComponent {
						path: "/*".to_string(),
						comment: "Matches any URL with a path that starts with /."
							.to_string(),
					}],
				}],
			},
			webcredentials: AppleWebCredentials { apps: app_ids },
		};

		Ok(serde_json::to_string_pretty(&template)?)
	}
}

#[derive(Serialize)]
struct AssetLink {
	relation: Vec<String>,
	target: AssetTarget,
}

#[derive(Serialize)]
struct AssetTarget {
	namespace: String,
	package_name: String,
	sha256_cert_fingerprints: Vec<String>,
}

#[derive(Serialize)]
struct AppleAppSiteAssociation {
	applinks: AppleAppLinks,
	webcredentials: AppleWebCredentials,
}

#[derive(Serialize)]
struct AppleAppLinks {
	details: Vec<AppleAppId>,
}

#[derive(Serialize)]
struct AppleWebCredentials {
	apps: Vec<String>,
}

#[derive(Serialize)]
struct AppleAppId {
	#[serde(rename = "appIDs")]
	app_ids: Vec<String>,
	components: Vec<AppleAppIdComponent>,
}

#[derive(Serialize)]
struct AppleAppIdComponent {
	#[serde(rename = "/")]
	path: String,
	comment: String,
}
