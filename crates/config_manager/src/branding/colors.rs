use csscolorparser::Color;
use std::str::FromStr;

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

	let luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

	let contrast_black = (luminance + 0.05) / (0.0 + 0.05);
	let contrast_white = (1.0 + 0.05) / (luminance + 0.05);

	if contrast_black > contrast_white {
		Ok("#000000".to_string())
	} else {
		Ok("#FFFFFF".to_string())
	}
}
