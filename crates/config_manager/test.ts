import { ConfigManager, JsFs } from './npm/dist';
import * as fs from 'node:fs';

const cm = new ConfigManager(
	new JsFs(fs),
	'schema_dir',
	'branding_dir',
	'dest_dir',
	process.env,
);
