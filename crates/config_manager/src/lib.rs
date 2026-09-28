use crate::fs::Fs;
use wasm_bindgen::prelude::*;

pub mod branding;
pub mod config;
pub mod files;
pub mod fs;
pub mod inject;
pub mod utils;

#[wasm_bindgen]
pub struct ConfigManager {
	fs: Box<dyn Fs>,
}

impl ConfigManager {}

// wasm: built from the JS node:fs module
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
impl ConfigManager {
	#[wasm_bindgen(constructor)]
	pub fn new(fs: crate::fs::JsFs) -> ConfigManager {
		ConfigManager { fs: Box::new(fs) }
	}
}

// native: built from std::fs
#[cfg(not(target_arch = "wasm32"))]
impl ConfigManager {
	pub fn new() -> ConfigManager {
		use crate::fs::StdFs;
		ConfigManager {
			fs: Box::new(StdFs),
		}
	}
}
