use std::{error::Error, fs, path::{Path, PathBuf}, str::FromStr};

use ab_glyph::{FontRef, PxScale};
use csscolorparser::Color;
use image::{ImageFormat, Rgba, RgbaImage, imageops::{self, FilterType}};
use imageproc::drawing::draw_text_mut;
use resvg::{tiny_skia, usvg::{self, Tree}};
use serde::{Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::utils;

#[derive(Debug)]
pub struct BrandingFile {
	/// Full path to the branding file.
	pathname: String,
	/// Filename of the branding file.
	filename: String,
	/// Wether this file is the default branding file.
	_is_default: bool,
	/// Wether this file is the custom branding file.
	is_custom: bool,
}

#[derive(Serialize)]
pub struct BrandingMeta {
	logo_light: String,
	logo_dark: String,
}

#[derive(Debug)]
pub struct Logofiles {
	logo_light: BrandingFile,
	logo_dark: BrandingFile,
}

/// Finds a branding file, preferring custom over default.
pub fn find_branding_file(base_dir: &Path, file_path: &PathBuf) -> Option<BrandingFile> {
	let default_file_path: PathBuf = Path::new(base_dir)
		.join("default")
		.join(file_path);
	let custom_file_path: PathBuf = Path::new(base_dir)
		.join("custom")
		.join(file_path);

	let has_default: bool = default_file_path.exists();
	let has_custom: bool = custom_file_path.exists();

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
pub fn find_logo_file(base_dir: &Path, name: &str) -> Option<BrandingFile> {
	let svg_file: Option<BrandingFile> = find_branding_file(
		base_dir,
		&Path::new("logo").join(format!("{}.svg", name)),
	);
	let png_file: Option<BrandingFile> = find_branding_file(
		base_dir,
		&Path::new("logo").join(format!("{}.png", name)),
	);

	if svg_file.as_ref().is_some_and(|f: &BrandingFile| f.is_custom) { return svg_file; }
	if png_file.as_ref().is_some_and(|f: &BrandingFile| f.is_custom) { return png_file; }
	if svg_file.is_some() { return svg_file; }
	if png_file.is_some() { return png_file; }

	None
}

/// Find both light and dark logo files
pub fn find_logo_files(source_dir: &Path) -> Logofiles {
	let [
		logo_light,
		logo_dark,
	] = ["logo_light", "logo_dark"]
		.map(|file| {
			let logo = find_logo_file(source_dir, file);

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
pub fn get_branding_hash(branding_dir: &Path) -> String {
	let mut hasher = Sha256::new();

	fn walk_dir(dir: &Path, hasher: &mut Sha256) {
		let mut entries: Vec<PathBuf> = fs::read_dir(dir).unwrap()
			.map(|entry| entry.unwrap().path())
			.collect();
		entries.sort();

		for path in entries {
			if path.is_dir() {
				walk_dir(&path, hasher);
			} else if path.is_file() {
				let content = fs::read(&path).unwrap();
				hasher.update(&content);
			}
		}
	}
	walk_dir(branding_dir, &mut hasher);

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
pub fn find_screenshot_file(base_dir: &Path, filename: &str) -> PathBuf {
	let custom_file_path: PathBuf = base_dir.join("custom").join("screenshots").join(filename);
	let default_file_path: PathBuf = base_dir.join("default").join("screenshots").join(filename);

	if custom_file_path.exists() { return custom_file_path; }
	if default_file_path.exists() { return default_file_path; }

	panic!("Screenshot file not found: {}", filename);
}

/// Copies all screenshots from branding to public directory
pub fn copy_screenshots(source_dir: &Path, destination_dir: &Path) {
	let files = [
		"screen_mobile_1.png",
		"screen_mobile_2.png",
		"screen_tablet_1.png",
		"screen_tablet_2.png",
	];

	let screenshots_dir = destination_dir.join("screenshots");
	fs::create_dir_all(&screenshots_dir).unwrap();

	for file in files {
		let source_file = find_screenshot_file(source_dir, file);
		let destination_file = screenshots_dir.join(file);
		fs::copy(&source_file, &destination_file).unwrap();
	}
}

// ============================================
// ICONS
// ============================================

pub struct GenerateAllIconsOptions {
	/// Source branding directory.
	pub source_dir: PathBuf,
	/// Destination directory for generated icons.
	pub destination_dir: PathBuf,
	/// Whether to copy the source logo and favicon files to the public directory.
	pub copy_source: Option<bool>,
	/// Whether to generate the Apple touch icon.
	pub apple_touch_icon: Option<bool>,
	/// Sizes of the manifest icons to generate.
	pub manifest_icon_sizes: Vec<u32>,
	/// Optional branding hash to append to icon URLs for cache busting.
	pub branding_hash: String,
}

#[derive(Serialize, Debug)]
pub enum IconPurpose {
	#[serde(rename = "monochrome")]
	_Monochrome,
	#[serde(rename = "maskable")]
	Maskable,
	#[serde(rename = "any")]
	_Any
}

#[derive(Serialize, Debug)]
pub struct Icon {
	src: String,

	#[serde(skip_serializing_if = "Option::is_none")]
	sizes: Option<String>,

	#[serde(rename = "type", skip_serializing_if = "Option::is_none")]
	kind: Option<String>,

	#[serde(skip_serializing_if = "Option::is_none")]
	purpose: Option<IconPurpose>,
}

pub type Icons = Vec<Icon>;

/// Generates all icons (favicon, apple touch icon, manifest icons).
pub fn generate_all_icons(options: GenerateAllIconsOptions) -> Icons {
	let hash_suffix: String = if options.branding_hash.is_empty() {
		"".to_string()
	} else {
		format!("?v={}", options.branding_hash)
	};

	let favicon = find_branding_file(
		&options.source_dir,
		&Path::new("favicon.ico").to_path_buf()
	);

	if favicon.is_none() {
		panic!("Favicon not found");
	}

	let Logofiles {
		logo_light,
		logo_dark,
	} = find_logo_files(&options.source_dir);

	if options.copy_source.unwrap_or(true) {
		fs::copy(&logo_light.pathname, &options.destination_dir.join(&logo_light.filename)).unwrap();
		fs::copy(&logo_dark.pathname, &options.destination_dir.join(&logo_dark.filename)).unwrap();
		fs::copy(&favicon.unwrap().pathname, &options.destination_dir.join("favicon.ico")).unwrap();
	}

	let icons_dir: PathBuf = options.destination_dir.join("icons");
	fs::create_dir_all(&icons_dir).unwrap();

	if options.apple_touch_icon.unwrap_or(true) {
		const ICON_SIZE: u32 = 180;
		const PADDING: u32 = 20;

		let input = Path::new(&logo_light.pathname);

		let logo = load_logo(input, ICON_SIZE - PADDING * 2);

		let mut canvas = RgbaImage::from_pixel(
			ICON_SIZE,
			ICON_SIZE,
			Rgba([255, 255, 255, 255]),
		);

		imageops::overlay(
			&mut canvas,
			&logo,
			PADDING as i64,
			PADDING as i64,
		);

		canvas.save(icons_dir.join("apple-touch-icon.png")).unwrap();
	}

	// Generate manifest icons
	let mut icons: Icons = Vec::new();

	let manifest_logo_path = Path::new(&logo_dark.pathname);

	for &size in &options.manifest_icon_sizes {
		let size_str = format!("{}x{}", size, size);
		let no_purpose_file = format!("icon-{}.png", size_str);
		let maskable_file = format!("icon-{}-maskable.png", size_str);

		const LOGO_SCALE: f32 = 0.75;

		let logo_size = (size as f32 * LOGO_SCALE).round() as u32;
		let logo_offset = ((size - logo_size) / 2) as i64;

		match size {
			192 | 512 => {
				let logo = load_logo(manifest_logo_path, logo_size);

				let mut circle = RgbaImage::from_pixel(
					size,
					size,
					Rgba([255, 255, 255, 255]),
				);
				let center = size as f32 / 2.0;
				let radius = size as f32 / 2.0;

				for y in 0..size {
					for x in 0..size {
						let dx = x as f32 - center;
						let dy = y as f32 - center;
						if dx * dx + dy * dy > radius * radius {
							circle.put_pixel(x, y, Rgba([0, 0, 0, 0]));
						}
					}
				}

				imageops::overlay(
					&mut circle,
					&logo,
					logo_offset,
					logo_offset,
				);

				circle.save(icons_dir.join(&no_purpose_file)).unwrap();

				icons.push(Icon {
					src: format!("icons/{no_purpose_file}{hash_suffix}"),
					sizes: Some(size_str.clone()),
					kind: Some("image/png".to_string()),
					purpose: None,
				});

				let mut maskable = RgbaImage::from_pixel(
					size,
					size,
					Rgba([255, 255, 255, 255]),
				);

				imageops::overlay(
					&mut maskable,
					&logo,
					logo_offset,
					logo_offset,
				);

				maskable.save(icons_dir.join(&maskable_file)).unwrap();

				icons.push(Icon {
					src: format!("icons/{maskable_file}{hash_suffix}"),
					sizes: Some(size_str.clone()),
					kind: Some("image/png".to_string()),
					purpose: Some(IconPurpose::Maskable),
				});
			}
			_ => {
				// ---- small icons: just the resized logo, transparent bg ----
				let logo = load_logo(manifest_logo_path, size);
				logo.save(icons_dir.join(&no_purpose_file)).unwrap();

				icons.push(Icon {
					src: format!("icons/{no_purpose_file}{hash_suffix}"),
					sizes: Some(size_str.clone()),
					kind: Some("image/png".to_string()),
					purpose: None,
				});
			}
		}
	}

	icons
}

/// Load a logo from the given path and resize it to the specified size.
/// supports both SVG and raster image formats.
fn load_logo(path: &Path, size: u32) -> RgbaImage {
	match path.extension().and_then(|e| e.to_str()) {
		Some("svg") => {
			let svg_data = fs::read(path).unwrap();

			let tree = Tree::from_data(&svg_data, &usvg::Options::default()).unwrap();

			let inner = size;

			let svg_size = tree.size();
			let scale = inner as f32 / svg_size.width().max(svg_size.height());

			let mut pixmap = tiny_skia::Pixmap::new(inner, inner).unwrap();
			resvg::render(
					&tree,
					tiny_skia::Transform::from_scale(scale, scale),
					&mut pixmap.as_mut(),
			);

			// pixmap → PNG bytes → image::RgbaImage
			let png_bytes = pixmap.encode_png().unwrap();

			return image::load_from_memory(&png_bytes).unwrap().to_rgba8();
		}
		_ => image::open(path)
			.unwrap()
			.resize(size, size, FilterType::Lanczos3)
			.to_rgba8(),
	}
}

// ============================================
// THEME
// ============================================

pub struct ThemeConfigPaths {
	custom_path: PathBuf,
	default_path: PathBuf,
}

pub fn all_theme_config_paths(source_dir: &Path) -> ThemeConfigPaths {
	return ThemeConfigPaths {
		custom_path: source_dir.join("custom").join("theme.json"),
		default_path: source_dir.join("default").join("theme.json"),
	};
}

pub fn load_theme(source_dir: &Path) -> Result<Value, Box<dyn Error>> {
	let paths = all_theme_config_paths(source_dir);

	let config_path = if paths.custom_path.exists() {
		paths.custom_path
	} else if paths.default_path.exists() {
		paths.default_path
	} else {
		return Err("No theme.json found".into());
	};

	let raw = fs::read_to_string(&config_path).unwrap();
	let theme: Value = serde_json::from_str(&raw).unwrap();

	let schema_path = source_dir.join(".schemas").join("theme.json");

	if schema_path.exists() {
		let schema_raw = fs::read_to_string(&schema_path).unwrap();
		let schema: Value = serde_json::from_str(&schema_raw).unwrap();

		let validator = jsonschema::validator_for(&schema)
			.expect("invalid theme schema");

		if !validator.is_valid(&theme) {
			let errors: Vec<String> = validator
				.iter_errors(&theme)
				.map(|e| format!("{e} (at {})", e.instance_path()))
				.collect();
			panic!("theme.json failed schema validation:\n{}", errors.join("\n"));
		}
	} else {
		eprintln!("No theme schema found. Skipping schema validation.");
	}

	Ok(theme)
}

/// Attempts to retrieve the primary brand color from the theme configuration.
/// Since the theme schema can change, we need to be able to fall back to multiple
/// possible locations within the theme configuration.
pub fn get_primary_brand_color(theme: &Value) -> Result<String, Box<dyn Error>> {
	let candidates = [
		["brand", "color"],
		["brand", "primary"],
		["brand", "background"],
		["primary", "color"]
	];

	for candidate in candidates {
		let mut current = theme;
		for key in candidate {
			if let Some(next) = current.get(key) {
				current = next;
			} else {
				current = &Value::Null;
				break;
			}
		}
		if let Some(color) = current.as_str() {
			return Ok(color.to_string());
		}
	}

	Err("No suitable primary brand color found".into())
}

pub struct GenerateThemeOptions {
	pub source_dir: PathBuf,
}

pub fn generate_theme_css(options: GenerateThemeOptions) -> String {
	let theme = load_theme(&options.source_dir).unwrap();

	let brand = theme["brand"].as_object().unwrap();

	let mut css = String::from(":root {\n");

	for (key, value) in brand {
		let var = utils::camel_to_kebab(key);
		css.push_str(&format!(
			"  --theme-brand-{var}: {};\n",
			value.as_str().unwrap_or("")),
		);
	}

	css.push('}');

	css
}

// ============================================
// COLOR UTILITIES
// ============================================

/// Determines the optimal foreground color (black or white) for readability
/// against the given background color.
pub fn get_optimal_text_color(
	background: &str,
) -> Result<String, csscolorparser::ParseColorError> {
	let bg_color: Color = Color::from_str(background)?;

	let linear = |c: u8| {
		let c = c as f32 / 255.0;
		if c <= 0.03928 {
			c / 12.92
		} else {
			((c + 0.055) / 1.055).powf(2.4)
		}
	};

	let [r, g, b, _a] = bg_color.to_rgba8();

	let luminance =
		0.2126 * linear(r)
		+ 0.7152 * linear(g)
		+ 0.0722 * linear(b);

	let contrast_black = (luminance + 0.05) / (0.0 + 0.05);
	let contrast_white = (1.0 + 0.05) / (luminance + 0.05);

	if contrast_black > contrast_white {
		Ok("#000000".to_string())
	} else {
		Ok("#FFFFFF".to_string())
	}
}

// ============================================
// METADATA IMAGE
// ============================================

pub struct MetadataImageOptions {
	pub source_dir: PathBuf,
	pub title: String,
}

pub struct MetadataImage {
	pub png_buffer: Vec<u8>,
}

const IMAGE_WIDTH: u32 = 1200;
const IMAGE_HEIGHT: u32 = 628;
const LOGO_SIZE: u32 = 250;
const MARGIN: u32 = 100;

const BASE_FONT_SIZE: u32 = 100;
const LARGE_FONT_SIZE: u32 = 150;
const LINE_MARGIN: u32 = 20;
const MAX_TITLE_LENGTH: u32 = 12;
const SHORT_TITLE_THRESHOLD: u32 = 8;

const INTER_FONT: &[u8] = include_bytes!("../assets/Inter-SemiBold.ttf");

pub fn generate_metadata_image(
	options: MetadataImageOptions,
) -> Result<MetadataImage, Box<dyn Error>> {

	if options.title.is_empty() {
		return Err("Title cannot be empty".into());
	}

	let theme = load_theme(&options.source_dir)?;
	let background_color = get_primary_brand_color(&theme)
		.unwrap_or("#FFFFFF".to_string());
	let text_color = get_optimal_text_color(&background_color)
		.unwrap_or("#000000".to_string());
	let logo_file = find_logo_file(&options.source_dir, "logo_dark")
		.expect("Logo not found");

	let [bg_r, bg_g, bg_b, _] = Color::from_str(&background_color)?.to_rgba8();

	let mut canvas = RgbaImage::from_pixel(
		IMAGE_WIDTH,
		IMAGE_HEIGHT,
		Rgba([bg_r, bg_g, bg_b, 255]),
	);

	let logo = load_logo(Path::new(&logo_file.pathname), LOGO_SIZE);
	let logo_x = (IMAGE_WIDTH - MARGIN - LOGO_SIZE) as i64;
	let logo_y = ((IMAGE_HEIGHT - LOGO_SIZE) / 2) as i64;
	imageops::overlay(&mut canvas, &logo, logo_x, logo_y);

	let font = FontRef::try_from_slice(INTER_FONT)?;
	let [txt_r, txt_g, txt_b, _] = Color::from_str(&text_color)?.to_rgba8();
	let text_rgba = Rgba([txt_r, txt_g, txt_b, 255]);

	let font_size = if options.title.len() <= SHORT_TITLE_THRESHOLD as usize {
		LARGE_FONT_SIZE
	} else {
		BASE_FONT_SIZE
	};
	let scale = PxScale::from(font_size as f32);

	let lines = wrap_text_to_lines(&options.title, MAX_TITLE_LENGTH as usize);
	let line_height = (font_size as f32 * 0.8) + LINE_MARGIN as f32;
	let title_height = (line_height * lines.len() as f32) - LINE_MARGIN as f32;

	let mut y = (IMAGE_HEIGHT as f32 - title_height) / 2.0;
	for line in &lines {
		draw_text_mut(
			&mut canvas,
			text_rgba,
			MARGIN as i32,
			y as i32,
			scale,
			&font,
			line
		);
		y += line_height;
	}

	let image_format = ImageFormat::Png;

	let mut buffer = Vec::new();

	canvas.write_to(
		&mut std::io::Cursor::new(&mut buffer),
		image_format,
	)?;

	Ok(MetadataImage {
		png_buffer: buffer,
	})
}

pub fn wrap_text_to_lines(text: &str, max_line_length: usize) -> Vec<String> {
	let mut lines: Vec<String> = Vec::new();
	let mut remaining_text = text;

	while !remaining_text.is_empty() {
		if remaining_text.len() <= max_line_length {
			lines.push(remaining_text.to_string());
			break;
		}

		let last_space = remaining_text[..max_line_length].rfind(' ');
		let split_index = last_space.unwrap_or(max_line_length);

		lines.push(remaining_text[..split_index].to_string());
		remaining_text = &remaining_text[split_index + if last_space.is_none() { 0 } else { 1 }..];
	}

	lines
}
