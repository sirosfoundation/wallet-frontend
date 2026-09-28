use std::path::{Path, PathBuf};

use js_sys::{Array, Object, Uint8Array};
use wasm_bindgen::{JsCast, JsValue, prelude::*};

#[derive(Debug)]
pub struct FsError(pub String);

impl std::fmt::Display for FsError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "{}", self.0)
	}
}
impl std::error::Error for FsError {}

/// Minimal filesystem surface the config generator needs.
pub trait Fs {
	fn read(&self, path: &Path) -> Result<Vec<u8>, FsError>;
	fn read_to_string(&self, path: &Path) -> Result<String, FsError>;
	fn write(&self, path: &Path, data: &[u8]) -> Result<(), FsError>;
	fn read_dir(&self, path: &Path) -> Result<Vec<PathBuf>, FsError>;
	fn create_dir_all(&self, path: &Path) -> Result<(), FsError>;
	fn exists(&self, path: &Path) -> bool;
	fn is_dir(&self, path: &Path) -> bool;
	fn remove_dir_all(&self, path: &Path) -> Result<(), FsError>;

	fn is_file(&self, path: &Path) -> bool {
		self.exists(path) && !self.is_dir(path)
	}
	fn copy(&self, from: &Path, to: &Path) -> Result<(), FsError> {
		let data = self.read(from)?;
		self.write(to, &data)
	}
}

fn s(p: &Path) -> String {
	p.to_string_lossy().into_owned()
}

pub struct StdFs;

impl Fs for StdFs {
	fn read(&self, path: &Path) -> Result<Vec<u8>, FsError> {
		std::fs::read(path).map_err(|e| FsError(e.to_string()))
	}
	fn read_to_string(&self, path: &Path) -> Result<String, FsError> {
		std::fs::read_to_string(path).map_err(|e| FsError(e.to_string()))
	}
	fn write(&self, path: &Path, data: &[u8]) -> Result<(), FsError> {
		std::fs::write(path, data).map_err(|e| FsError(e.to_string()))
	}
	fn read_dir(&self, path: &Path) -> Result<Vec<PathBuf>, FsError> {
		std::fs::read_dir(path)
			.map_err(|e| FsError(e.to_string()))?
			.map(|e| e.map(|e| e.path()).map_err(|e| FsError(e.to_string())))
			.collect()
	}
	fn create_dir_all(&self, path: &Path) -> Result<(), FsError> {
		std::fs::create_dir_all(path).map_err(|e| FsError(e.to_string()))
	}
	fn exists(&self, path: &Path) -> bool {
		path.exists()
	}
	fn is_dir(&self, path: &Path) -> bool {
		path.is_dir()
	}
	fn remove_dir_all(&self, path: &Path) -> Result<(), FsError> {
		std::fs::remove_dir_all(path).map_err(|e| FsError(e.to_string()))
	}
}

#[wasm_bindgen]
extern "C" {
	type NodeFs;

	#[wasm_bindgen(method, catch, js_name = readFileSync)]
	fn read_file_sync(this: &NodeFs, path: &str) -> Result<Uint8Array, JsValue>;

	#[wasm_bindgen(method, catch, js_name = writeFileSync)]
	fn write_file_sync(this: &NodeFs, path: &str, data: &Uint8Array) -> Result<(), JsValue>;

	#[wasm_bindgen(method, catch, js_name = readdirSync)]
	fn readdir_sync(this: &NodeFs, path: &str) -> Result<Array, JsValue>;

	#[wasm_bindgen(method, catch, js_name = mkdirSync)]
	fn mkdir_sync(this: &NodeFs, path: &str, opts: &JsValue) -> Result<JsValue, JsValue>;

	#[wasm_bindgen(method, js_name = existsSync)]
	fn exists_sync(this: &NodeFs, path: &str) -> bool;

	#[wasm_bindgen(method, catch, js_name = statSync)]
	fn stat_sync(this: &NodeFs, path: &str) -> Result<Stats, JsValue>;

	#[wasm_bindgen(method, catch, js_name = rmSync)]
	fn rm_sync(this: &NodeFs, path: &str, opts: &JsValue) -> Result<(), JsValue>;

	type Stats;
	#[wasm_bindgen(method, js_name = isDirectory)]
	fn is_directory(this: &Stats) -> bool;
}

#[wasm_bindgen]
pub struct JsFs {
	sys: NodeFs,
}

#[wasm_bindgen]
impl JsFs {
	#[wasm_bindgen(constructor)]
	pub fn new(fs: JsValue) -> Result<JsFs, JsValue> {
		Ok(Self {
			sys: fs.unchecked_into(),
		})
	}
}

fn err(e: JsValue) -> FsError {
	FsError(e.as_string().unwrap_or_else(|| format!("{e:?}")))
}

impl Fs for JsFs {
	fn read(&self, path: &Path) -> Result<Vec<u8>, FsError> {
		self.sys
			.read_file_sync(&s(path))
			.map(|a| a.to_vec())
			.map_err(err)
	}
	fn read_to_string(&self, path: &Path) -> Result<String, FsError> {
		let bytes = self.read(path)?;
		String::from_utf8(bytes).map_err(|e| FsError(e.to_string()))
	}
	fn write(&self, path: &Path, data: &[u8]) -> Result<(), FsError> {
		self.sys
			.write_file_sync(&s(path), &Uint8Array::from(data))
			.map_err(err)
	}
	fn read_dir(&self, path: &Path) -> Result<Vec<PathBuf>, FsError> {
		let names = self.sys.readdir_sync(&s(path)).map_err(err)?;
		Ok(names
			.iter()
			.filter_map(|v| v.as_string())
			.map(|name| path.join(name))
			.collect())
	}
	fn create_dir_all(&self, path: &Path) -> Result<(), FsError> {
		let opts = Object::new();
		js_sys::Reflect::set(&opts, &"recursive".into(), &true.into()).ok();
		self.sys
			.mkdir_sync(&s(path), &opts.into())
			.map(|_| ())
			.map_err(err)
	}
	fn exists(&self, path: &Path) -> bool {
		self.sys.exists_sync(&s(path))
	}
	fn is_dir(&self, path: &Path) -> bool {
		self.sys
			.stat_sync(&s(path))
			.map(|st| st.is_directory())
			.unwrap_or(false)
	}
	fn remove_dir_all(&self, path: &Path) -> Result<(), FsError> {
		let opts = Object::new();
		js_sys::Reflect::set(&opts, &"recursive".into(), &true.into()).ok();
		js_sys::Reflect::set(&opts, &"force".into(), &true.into()).ok();
		self.sys
			.rm_sync(&s(path), &opts.into())
			.map_err(err)
	}
}
