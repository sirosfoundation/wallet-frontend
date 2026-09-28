use std::{collections::HashMap, path::{Path, PathBuf}};

use config_manager::{branding, files};

fn main() {
	let mut env = HashMap::new();
	env.insert(
		"WELLKNOWN_APPLE_APPIDS".to_string(),
		"com.example.app1,com.example.app2".to_string(),
	);
	env.insert(
		"STATIC_PUBLIC_URL".to_string(),
		"http://localhost:3000".to_string(),
	);
	env.insert(
		"WALLET_BACKEND_URL".to_string(),
		"http://localhost:3000".to_string(),
	);

	let env_schema_temp = Path::new(env!("CARGO_MANIFEST_DIR"))
		.join("../../config/.schemas/env.schema.json");
	let branding_dir: PathBuf = Path::new(env!("CARGO_MANIFEST_DIR"))
		.join("../../branding");

	let config = config_manager::config::load_and_parse_config(
		&env_schema_temp,
		&env
	).unwrap();

	println!("Parsed environment: {:?}", config);

	println!("config json: {}", config.to_json_string(None).unwrap());

	println!("Branding directory: {:?}", branding_dir);

	let hash = branding::get_branding_hash(&branding_dir);
	println!("Branding hash: {:?}", hash);

	let tags = files::write_all(
		&branding_dir,
		&Path::new(env!("CARGO_MANIFEST_DIR")).join("../../public"),
		&config,
		&hash,
	);

	println!("Generated tags: {:?}", tags);
}
