use crate::{dom::TagsMap, fs::Fs};
use std::{collections::HashMap, error::Error, path::PathBuf};
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
use tsify::Tsify;

pub mod branding;
pub mod config;
pub mod dom;
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
		let config = config::load_and_parse_config(&*fs, &schema_dir, &env)
			.expect("load_and_parse_config");

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
		branding::files::get_branding_hash(&*self.fs, &self.branding_dir)
	}

	fn inject_config_files_core(&self) -> TagsMap {
		files::write_all(
			&*self.fs,
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
		console_error_panic_hook::set_once();
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
	pub fn inject_config_files(&self) -> Result<tsify::Ts<dom::Tags>, JsError> {
		Ok(dom::Tags(self.inject_config_files_core()).into_ts()?)
	}

	#[wasm_bindgen(js_name = "injectHtml")]
	pub fn inject_html(
		&self,
		html: &str,
		tags: &tsify::Ts<dom::Tags>,
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
