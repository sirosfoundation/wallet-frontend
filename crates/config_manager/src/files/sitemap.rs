use chrono::Utc;
use std::path::Path;

use crate::{files::OutputFile, fs::Fs, dom::Tag};

pub struct SitemapXml;

impl OutputFile for SitemapXml {
	fn generate(
		&self,
		fs: &dyn Fs,
		_source_dir: &Path,
		dest_dir: &Path,
		_config: &crate::config::Config,
		_branding_hash: &str,
	) -> Vec<(String, Tag)> {
		let Some(url) = _config.static_public_url() else {
			println!(
				"sitemap.xml generation skipped: STATIC_PUBLIC_URL not found in config"
			);
			return Vec::new();
		};

		let content = self.content(url);
		let path = dest_dir.join("sitemap.xml");

		fs.write(&path, content.to_string().as_bytes()).unwrap();

		Vec::new()
	}
}

impl SitemapXml {
	fn content(&self, url: &str) -> String {
		let today = Utc::now().format("%Y-%m-%d").to_string();

		format!(
			"<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">
	<url>
		<loc>{url}/login</loc>
		<lastmod>{today}</lastmod>
		<priority>1.0</priority>
		<changefreq>monthly</changefreq>
	</url>
</urlset>",
		)
	}
}
