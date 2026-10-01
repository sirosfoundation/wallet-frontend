use std::{env, path::PathBuf};

use clap::Parser;
use config_manager::ConfigManager;

#[derive(clap::ValueEnum, Clone)]
enum Action {
	/// Generate complete config
	Generate,
}

fn main() {
	let cli = Cli::parse();

	let dirs = [&cli.schema_dir, &cli.source_dir, &cli.dest_dir];

	for dir in &dirs {
		if !dir.exists() {
			eprintln!("Directory does not exist: {:?}", dir);
			std::process::exit(1);
		}
	}

	let [schema_dir, source_dir, dest_dir] = &dirs;

	let config_manager = ConfigManager::new(
		schema_dir.to_path_buf(),
		source_dir.to_path_buf(),
		dest_dir.to_path_buf(),
		env::vars().collect(),
	);

	match cli.action {
		Action::Generate => {
			print!("Generating configuration...\n");
			let tags = config_manager.inject_config_files();

			let html_source = &dest_dir.join("index.html");
			if !html_source.exists() {
				eprintln!("HTML source file does not exist: {:?}", html_source);
				std::process::exit(1);
			}

			let processed_html =
				config_manager.inject_html(html_source.to_str().unwrap(), &tags);

			if processed_html.is_err() {
				eprintln!("Failed to process HTML: {:?}", processed_html.err());
				std::process::exit(1);
			}

			std::fs::write(html_source, processed_html.unwrap())
				.expect("Failed to write processed HTML");
		}
	}
}

#[derive(Parser)]
#[command(name = "config-manager", version, about)]
struct Cli {
	/// Action to perform
	action: Action,

	/// Branding source directory
	#[arg(long)]
	source_dir: PathBuf,

	/// Output directory
	#[arg(long)]
	dest_dir: PathBuf,

	/// Env schema JSON path
	#[arg(long)]
	schema_dir: PathBuf,
}
