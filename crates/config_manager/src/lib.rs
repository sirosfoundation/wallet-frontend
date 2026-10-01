use crate::{fs::Fs, utils::TagsMap};
use std::{collections::HashMap, error::Error, path::PathBuf};
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
use tsify::Tsify;

pub mod branding;
pub mod config;
pub mod files;
pub mod fs;
pub mod inject;
pub mod utils;

#[wasm_bindgen]
pub struct ConfigManager {
	fs: Box<dyn Fs>,
	schema_dir: PathBuf,
	branding_dir: PathBuf,
	dest_dir: PathBuf,
	env: HashMap<String, String>,
	config: config::Config,
}

impl ConfigManager {
	pub fn bootstrap(
		fs: Box<dyn Fs>,
		schema_dir: PathBuf,
		branding_dir: PathBuf,
		dest_dir: PathBuf,
		env: HashMap<String, String>,
	) -> ConfigManager {
		let config = config::load_and_parse_config(&schema_dir, &env)
			.unwrap_or_else(|_| panic!("Failed to load and parse config"));

		ConfigManager {
			fs,
			schema_dir,
			branding_dir,
			dest_dir,
			env,
			config,
		}
	}

	fn get_hash_core(&self) -> String {
		branding::get_branding_hash(&self.branding_dir)
	}

	fn inject_config_files_core(&self) -> TagsMap {
		files::write_all(
			&self.branding_dir,
			&self.dest_dir,
			&self.config,
			&self.get_hash_core(),
		)
	}

	fn inject_html_core(
		&self,
		html: &str,
		tags: &TagsMap,
	) -> Result<String, Box<dyn Error>> {
		inject::inject_html(html, &self.config, tags)
	}
}

// wasm: built from the JS node:fs module
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
impl ConfigManager {
	#[wasm_bindgen(constructor)]
	pub fn new(
		fs: crate::fs::JsFs,
		#[wasm_bindgen(js_name = "schemaDir")] schema_dir: &str,
		#[wasm_bindgen(js_name = "brandingDir")] branding_dir: &str,
		#[wasm_bindgen(js_name = "destDir")] dest_dir: &str,
		env: JsValue,
	) -> ConfigManager {
		let env: HashMap<String, String> =
			serde_wasm_bindgen::from_value(env).unwrap();

		ConfigManager::bootstrap(
			Box::new(fs),
			PathBuf::from(schema_dir),
			PathBuf::from(branding_dir),
			PathBuf::from(dest_dir),
			env,
		)
	}

	#[wasm_bindgen(js_name = "getHash")]
	pub fn get_hash(&self) -> String {
		self.get_hash_core()
	}

	#[wasm_bindgen(js_name = "injectConfigFiles")]
	pub fn inject_config_files(&self) -> Result<tsify::Ts<utils::Tags>, JsError> {
		Ok(utils::Tags(self.inject_config_files_core()).into_ts()?)
	}

	#[wasm_bindgen(js_name = "injectHtml")]
	pub fn inject_html(
		&self,
		html: &str,
		tags: &tsify::Ts<utils::Tags>,
	) -> Result<String, JsError> {
		let tags = tags.to_rust()?.0;

		Ok(
			self
				.inject_html_core(html, &tags)
				.map_err(|e| JsError::new(&e.to_string()))?,
		)
	}
}

// native: built from std::fs
#[cfg(not(target_arch = "wasm32"))]
impl ConfigManager {
	pub fn new(
		schema_dir: PathBuf,
		branding_dir: PathBuf,
		dest_dir: PathBuf,
		env: HashMap<String, String>,
	) -> ConfigManager {
		use crate::fs::StdFs;

		ConfigManager::bootstrap(
			Box::new(StdFs),
			schema_dir,
			branding_dir,
			dest_dir,
			env,
		)
	}

	pub fn get_hash(&self) -> String {
		self.get_hash_core()
	}

	pub fn inject_config_files(&self) -> TagsMap {
		self.inject_config_files_core()
	}

	pub fn inject_html(
		&self,
		html: &str,
		tags: &TagsMap,
	) -> Result<String, Box<dyn Error>> {
		self.inject_html_core(html, tags)
	}
}
