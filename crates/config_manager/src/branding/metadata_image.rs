use crate::branding::colors;
use crate::branding::files;
use crate::branding::icons;
use crate::branding::theme;
use crate::fs::Fs;
use ab_glyph::FontRef;
use ab_glyph::PxScale;
use csscolorparser::Color;
use image::ImageFormat;
use image::{Rgba, RgbaImage, imageops};
use imageproc::drawing::draw_text_mut;
use std::error::Error;
use std::path::Path;
use std::path::PathBuf;
use std::str::FromStr;

pub struct MetadataImageOptions {
	pub schema_dir: PathBuf,
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

const INTER_FONT: &[u8] = include_bytes!("../../assets/Inter-SemiBold.ttf");

pub fn generate_metadata_image(
	fs: &dyn Fs,
	options: MetadataImageOptions,
) -> Result<MetadataImage, Box<dyn Error>> {
	if options.title.is_empty() {
		return Err("Title cannot be empty".into());
	}

	let theme = theme::load_theme(fs, &options.schema_dir, &options.source_dir)?;
	let background_color =
		theme::get_primary_brand_color(&theme).unwrap_or("#FFFFFF".to_string());
	let text_color = colors::get_optimal_text_color(&background_color)
		.unwrap_or("#000000".to_string());
	let logo_file = files::find_logo_file(fs, &options.source_dir, "logo_dark")
		.expect("Logo not found");

	let [bg_r, bg_g, bg_b, _] = Color::from_str(&background_color)?.to_rgba8();

	let mut canvas = RgbaImage::from_pixel(
		IMAGE_WIDTH,
		IMAGE_HEIGHT,
		Rgba([bg_r, bg_g, bg_b, 255]),
	);

	let logo = icons::load_logo(fs, Path::new(&logo_file.pathname), LOGO_SIZE);
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
			line,
		);
		y += line_height;
	}

	let image_format = ImageFormat::Png;

	let mut buffer = Vec::new();

	canvas.write_to(&mut std::io::Cursor::new(&mut buffer), image_format)?;

	Ok(MetadataImage { png_buffer: buffer })
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
		remaining_text =
			&remaining_text[split_index + if last_space.is_none() { 0 } else { 1 }..];
	}

	lines
}
