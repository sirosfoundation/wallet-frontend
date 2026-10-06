#!/usr/bin/env node

import * as fs from 'node:fs'
import { Command } from 'commander';
import { ConfigManager, JsFs } from '../dist/config_manager.js';
import pkg from '../package.json' with { type: 'json' };

const program = new Command();

/**
 * @type {ConfigManager}
 */
let configManager;

program.hook('preAction', (_, actionCommand) => {
	const { schemaDir, sourceDir, destDir } = actionCommand.optsWithGlobals();

	configManager = new ConfigManager(
		new JsFs(fs),
		schemaDir,
		sourceDir,
		destDir,
		process.env,
	);
});

program
	.name('wallet-frontend-config-manager')
	.description('CLI for managing wallet frontend configuration')
	.version(pkg.version);

program
	.requiredOption(
		'--schema-dir <schemaDir>',
		'Directory containing schema files (required)',
	)
	.requiredOption(
		'--source-dir <sourceDir>',
		'Directory containing source files (required)',
	)
	.requiredOption(
		'--dest-dir <destDir>',
		'Directory to output generated files (required)',
	);

program
	.command('generate')
	.description('Generate configuration files')
	.action(async (_, /** @type {Command} */ command) => {
		await generate(command.optsWithGlobals().destDir);
	});

program
	.command('docs')
	.description('Insert environment documentation into the specified target file')
	.argument('<targetFile>', 'Target file to insert environment documentation into')
	.action(async (targetFile) => {
		await docs(targetFile);
	});

program.parse(process.argv);

/**
 * Injects configuration files into the specified destination directory.
 *
 * @param {string} destDir
 * @returns {Promise<void>}
 */
async function generate(destDir) {
	const inputHtml = fs.readFileSync(`${destDir}/index.html`, 'utf-8');
	const tags = configManager.injectConfigFiles();
	const html = configManager.injectHtml(inputHtml, tags);
	fs.writeFileSync(`${destDir}/index.html`, html, 'utf-8');
	console.info(`Configuration files injected into ${destDir}`);
}

async function docs(target_file) {
	try {
		configManager.insertEnvDocs(target_file);
		console.info(`Environment documentation inserted into ${target_file}`);
	} catch (error) {
		console.error(`Failed to insert environment documentation: ${error}`);
	}
}
