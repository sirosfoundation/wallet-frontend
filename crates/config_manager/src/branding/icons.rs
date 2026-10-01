use crate::branding::files::{Logofiles, find_branding_file, find_logo_files};
use crate::fs::Fs;
use image::imageops::FilterType;
use image::{Rgba, RgbaImage, imageops};
use resvg::tiny_skia;
use resvg::usvg;
use resvg::usvg::Tree;
use serde::Serialize;
use std::path::Path;
use std::path::PathBuf;

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
	_Any,
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
pub fn generate_all_icons(
	fs: &dyn Fs,
	options: GenerateAllIconsOptions,
) -> Icons {
	let hash_suffix: String = if options.branding_hash.is_empty() {
		"".to_string()
	} else {
		format!("?v={}", options.branding_hash)
	};

	let favicon = find_branding_file(
		fs,
		&options.source_dir,
		&Path::new("favicon.ico").to_path_buf(),
	);

	if favicon.is_none() {
		panic!("Favicon not found");
	}

	let Logofiles {
		logo_light,
		logo_dark,
	} = find_logo_files(fs, &options.source_dir);

	if options.copy_source.unwrap_or(true) {
		fs.copy(
			&Path::new(&logo_light.pathname),
			&options.destination_dir.join(&logo_light.filename),
		)
		.unwrap();
		fs.copy(
			&Path::new(&logo_dark.pathname),
			&options.destination_dir.join(&logo_dark.filename),
		)
		.unwrap();
		fs.copy(
			&Path::new(&favicon.unwrap().pathname),
			&options.destination_dir.join("favicon.ico"),
		)
		.unwrap();
	}

	let icons_dir: PathBuf = options.destination_dir.join("icons");
	fs.create_dir_all(&icons_dir).unwrap();

	if options.apple_touch_icon.unwrap_or(true) {
		const ICON_SIZE: u32 = 180;
		const PADDING: u32 = 20;

		let input = Path::new(&logo_light.pathname);

		let logo = load_logo(fs, input, ICON_SIZE - PADDING * 2);

		let mut canvas =
			RgbaImage::from_pixel(ICON_SIZE, ICON_SIZE, Rgba([255, 255, 255, 255]));

		imageops::overlay(&mut canvas, &logo, PADDING as i64, PADDING as i64);

		let out = canvas.into_raw();

		fs.write(&icons_dir.join("apple-touch-icon.png"), &out)
			.unwrap();
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
				let logo = load_logo(fs, manifest_logo_path, logo_size);

				let mut circle =
					RgbaImage::from_pixel(size, size, Rgba([255, 255, 255, 255]));
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

				imageops::overlay(&mut circle, &logo, logo_offset, logo_offset);

				let out = circle.into_raw();
				fs.write(&icons_dir.join(&no_purpose_file), &out).unwrap();

				icons.push(Icon {
					src: format!("icons/{no_purpose_file}{hash_suffix}"),
					sizes: Some(size_str.clone()),
					kind: Some("image/png".to_string()),
					purpose: None,
				});

				let mut maskable =
					RgbaImage::from_pixel(size, size, Rgba([255, 255, 255, 255]));

				imageops::overlay(&mut maskable, &logo, logo_offset, logo_offset);

				let out = maskable.into_raw();
				fs.write(&icons_dir.join(&maskable_file), &out).unwrap();

				icons.push(Icon {
					src: format!("icons/{maskable_file}{hash_suffix}"),
					sizes: Some(size_str.clone()),
					kind: Some("image/png".to_string()),
					purpose: Some(IconPurpose::Maskable),
				});
			}
			_ => {
				// ---- small icons: just the resized logo, transparent bg ----
				let logo = load_logo(fs, manifest_logo_path, size);
				let out = logo.into_raw();
				fs.write(&icons_dir.join(&no_purpose_file), &out).unwrap();

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
pub fn load_logo(fs: &dyn Fs, path: &Path, size: u32) -> RgbaImage {
	match path.extension().and_then(|e| e.to_str()) {
		Some("svg") => {
			let svg_data = fs.read(path).unwrap();

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
		_ => {
			let data = fs.read(path).unwrap();
			image::load_from_memory(&data)
				.unwrap()
				.resize(size, size, FilterType::Lanczos3)
				.to_rgba8()
		}
	}
}
