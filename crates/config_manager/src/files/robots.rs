use std::path::Path;

use crate::{files::OutputFile, fs::Fs, utils::Tag};

pub struct RobotsTxt;

impl OutputFile for RobotsTxt {
	fn generate(
		&self,
		fs: &dyn Fs,
		_source_dir: &Path,
		dest_dir: &Path,
		config: &crate::config::Config,
		_branding_hash: &str,
	) -> Vec<(String, Tag)> {
		let Some(url) = config.static_public_url() else {
			println!(
				"robots.txt generation skipped: STATIC_PUBLIC_URL not found in config"
			);
			return Vec::new();
		};

		let content = self.content(url);
		let path = dest_dir.join("robots.txt");

		fs.write(&path, content.to_string().as_bytes()).unwrap();

		Vec::new()
	}
}

impl RobotsTxt {
	fn content(&self, url: &str) -> String {
		format!(
			"User-agent: *
Disallow: /settings
Disallow: /credential/
Disallow: /history
Disallow: /add
Disallow: /send
Allow: /login

Allow: /
Sitemap: {url}/sitemap.xml",
		)
	}
}
