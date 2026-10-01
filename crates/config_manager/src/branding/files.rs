use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::path::PathBuf;

use crate::fs::Fs;

#[derive(Debug)]
pub struct BrandingFile {
	/// Full path to the branding file.
	pub pathname: String,
	/// Filename of the branding file.
	pub filename: String,
	/// Wether this file is the default branding file.
	pub _is_default: bool,
	/// Wether this file is the custom branding file.
	pub is_custom: bool,
}

#[derive(Serialize)]
pub struct BrandingMeta {
	logo_light: String,
	logo_dark: String,
}

#[derive(Debug)]
pub struct Logofiles {
	pub logo_light: BrandingFile,
	pub logo_dark: BrandingFile,
}

/// Finds a branding file, preferring custom over default.
pub fn find_branding_file(
	fs: &dyn Fs,
	base_dir: &Path,
	file_path: &PathBuf,
) -> Option<BrandingFile> {
	let default_file_path: PathBuf =
		Path::new(base_dir).join("default").join(file_path);
	let custom_file_path: PathBuf =
		Path::new(base_dir).join("custom").join(file_path);

	let has_default: bool = fs.exists(&default_file_path);
	let has_custom: bool = fs.exists(&custom_file_path);

	if !has_default && !has_custom {
		return None;
	}

	let pathname: String = if has_custom {
		custom_file_path.to_string_lossy().into_owned()
	} else {
		default_file_path.to_string_lossy().into_owned()
	};

	let filename: String = Path::new(&pathname)
		.file_name()
		.unwrap()
		.to_string_lossy()
		.into_owned();

	let is_default: bool = has_default && !has_custom;
	let is_custom: bool = has_custom;

	return Some(BrandingFile {
		pathname,
		filename,
		is_custom,
		_is_default: is_default,
	});
}

/// Finds a logo file (svg or png), preferring custom over default, svg over png.
pub fn find_logo_file(
	fs: &dyn Fs,
	base_dir: &Path,
	name: &str,
) -> Option<BrandingFile> {
	let svg_file: Option<BrandingFile> = find_branding_file(
		fs,
		base_dir,
		&Path::new("logo").join(format!("{}.svg", name)),
	);
	let png_file: Option<BrandingFile> = find_branding_file(
		fs,
		base_dir,
		&Path::new("logo").join(format!("{}.png", name)),
	);

	if svg_file
		.as_ref()
		.is_some_and(|f: &BrandingFile| f.is_custom)
	{
		return svg_file;
	}
	if png_file
		.as_ref()
		.is_some_and(|f: &BrandingFile| f.is_custom)
	{
		return png_file;
	}
	if svg_file.is_some() {
		return svg_file;
	}
	if png_file.is_some() {
		return png_file;
	}

	None
}

/// Find both light and dark logo files
pub fn find_logo_files(fs: &dyn Fs, source_dir: &Path) -> Logofiles {
	let [logo_light, logo_dark] = ["logo_light", "logo_dark"].map(|file| {
		let logo = find_logo_file(fs, source_dir, file);

		if !logo.is_some() {
			// since this is from ts, throw/catch is the default error handling mechanism
			// explore using Result or Option for better error handling in Rust.
			panic!("Logo file not found: {}", file);
		}

		logo.unwrap()
	});

	Logofiles {
		logo_light,
		logo_dark,
	}
}

/// Computes a stable hash from all branding inputs.
/// Changes ONLY when branding files change.
pub fn get_branding_hash(fs: &dyn Fs, branding_dir: &Path) -> String {
	let mut hasher = Sha256::new();

	fn walk_dir(fs: &dyn Fs, dir: &Path, hasher: &mut Sha256) {
		let mut entries: Vec<PathBuf> = fs.read_dir(dir).unwrap();
		entries.sort();

		for path in entries {
			if path.is_dir() {
				walk_dir(fs, &path, hasher);
			} else if path.is_file() {
				let content = fs.read(&path).unwrap();
				hasher.update(&content);
			}
		}
	}
	walk_dir(fs, branding_dir, &mut hasher);

	let result = hasher.finalize();
	let hex: String = result.iter().map(|b| format!("{:02x}", b)).collect();
	hex[..10].to_string()
}

pub type Screenshots = Vec<Screenshot>;

#[derive(Serialize, Debug)]
#[serde(rename_all = "snake_case")]
pub struct Screenshot {
	pub src: String,
	pub sizes: String,
	#[serde(rename = "type")]
	pub typ: String,
	pub form_factor: String,
	pub label: String,
}

/// Finds a screenshot file, preferring custom over default.
pub fn find_screenshot_file(
	fs: &dyn Fs,
	base_dir: &Path,
	filename: &str,
) -> PathBuf {
	let custom_file_path: PathBuf =
		base_dir.join("custom").join("screenshots").join(filename);
	let default_file_path: PathBuf =
		base_dir.join("default").join("screenshots").join(filename);

	if fs.exists(&custom_file_path) {
		return custom_file_path;
	}
	if fs.exists(&default_file_path) {
		return default_file_path;
	}

	panic!("Screenshot file not found: {}", filename);
}

/// Copies all screenshots from branding to public directory
pub fn copy_screenshots(
	fs: &dyn Fs,
	source_dir: &Path,
	destination_dir: &Path,
) {
	let files = [
		"screen_mobile_1.png",
		"screen_mobile_2.png",
		"screen_tablet_1.png",
		"screen_tablet_2.png",
	];

	let screenshots_dir = destination_dir.join("screenshots");
	fs.create_dir_all(&screenshots_dir).unwrap();

	for file in files {
		let source_file = find_screenshot_file(fs, source_dir, file);
		let destination_file = screenshots_dir.join(file);
		fs.copy(&source_file, &destination_file).unwrap();
	}
}
