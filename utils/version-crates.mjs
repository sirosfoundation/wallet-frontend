#!/usr/bin/env node
'use strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { exec } from 'node:child_process';

const __dirname = new URL('.', import.meta.url).pathname;

(async () => {
	const crates = await readdir(`${__dirname}../crates`);
	for (const crate of crates) {
		const packageFile = JSON.parse(
			await readFile(`${__dirname}../crates/${crate}/package.json`, 'utf-8'),
		);

		const cargoToml = await readFile(
			`${__dirname}../crates/${crate}/Cargo.toml`,
			'utf-8',
		);

		const cargoTomlLines = cargoToml.split('\n');
		const cargoTomlVersionLine = cargoTomlLines.find((line) =>
			line.startsWith('version ='),
		);
		const cargoTomlVersionIndex = cargoTomlLines.indexOf(cargoTomlVersionLine);
		const cargoTomlVersion = cargoTomlVersionLine
			? cargoTomlVersionLine.split('=')[1].trim().replace(/"/g, '')
			: null;

		if (packageFile.version !== cargoTomlVersion) {
			cargoTomlLines[cargoTomlVersionIndex] =
				`version = "${packageFile.version}"`;

			await writeFile(
				`${__dirname}../crates/${crate}/Cargo.toml`,
				cargoTomlLines.join('\n'),
				'utf-8',
			);
			await exec(`cargo generate-lockfile --offline`, {
				cwd: `${__dirname}../crates/${crate}`,
			});
		}
	}
})();
