import { ConfigManager, JsFs } from './npm/dist';
import * as fs from 'node:fs';

const jsFs = new JsFs(fs);

const cm = new ConfigManager(jsFs);
