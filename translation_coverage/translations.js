import fs from 'fs';
import path from 'node:path';

const SRC_DIR = './src';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const SKIP_DIR_NAMES = new Set(['__tests__', 'node_modules']);
const I18NEXT_PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other', '_plural'];

const STATIC_T_CALL = /\b(?:t|i18n\.t)\(\s*(['"`])([A-Za-z][\w.]*)\1/g;
const I18N_KEY_ATTR = /i18nKey\s*=\s*(?:\{\s*)?(['"`])([A-Za-z][\w.]*)\1/g;
const I18N_KEY_TERNARY = /i18nKey\s*=\s*\{[^}]*?(['"`])([A-Za-z][\w.]*)\1[^}]*?(['"`])([A-Za-z][\w.]*)\3/g;
const I18N_KEY_PROP = /\w+Key\s*:\s*(['"`])([^'"`]+)\1/g;
const T_CONCAT_SUFFIX = /\bt\(\s*[A-Za-z_]\w*\s*\+\s*(['"`])(\.[^'"`]+)\1/g;
const TRANSLATION_PREFIX_PROP = /translationPrefix\s*=\s*(?:\{\s*)?(['"`])([A-Za-z]\w*)\1/g;
const DYNAMIC_PREFIX = /\b(?:t|i18n\.t|i18n\.exists)\(\s*`([A-Za-z][\w.]*\.)\$\{/g;
const I18N_TEMPLATE = /`([A-Za-z]\w*\.(?:[\w.]*))\$\{/g;

function walkSourceFiles(dir) {
	const files = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (SKIP_DIR_NAMES.has(entry.name)) continue;
			files.push(...walkSourceFiles(fullPath));
			continue;
		}
		if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
		if (/\.(?:test|spec)\.(?:ts|tsx|js|jsx)$/.test(entry.name)) continue;
		files.push(fullPath);
	}
	return files;
}

function collectMatches(regex, source, groupIndexes) {
	const keys = [];
	regex.lastIndex = 0;
	for (const match of source.matchAll(regex)) {
		for (const index of groupIndexes) {
			if (match[index]) keys.push(match[index]);
		}
	}
	return keys;
}

function addOccurrence(map, key, file) {
	if (!map.has(key)) map.set(key, new Set());
	map.get(key).add(file);
}

function addAll(map, keys, file) {
	for (const key of keys) addOccurrence(map, key, file);
}

function addFiles(map, key, files) {
	for (const file of files) addOccurrence(map, key, file);
}

function isI18nKeyPath(key) {
	return key.split('.').every((part) => /^[A-Za-z]\w*$/.test(part));
}

function extractReferencedKeys(source) {
	return {
		staticKeys: [
			...collectMatches(STATIC_T_CALL, source, [2]),
			...collectMatches(I18N_KEY_ATTR, source, [2]),
			...collectMatches(I18N_KEY_TERNARY, source, [2, 4]),
			// t(opt.labelKey) / t(step.messageKey): the key is a *Key string on an object
			...collectMatches(I18N_KEY_PROP, source, [2]).filter((key) => key.includes('.') && isI18nKeyPath(key)),
		],
		dynamicPrefixes: [
			...collectMatches(DYNAMIC_PREFIX, source, [1]),
			...collectMatches(I18N_TEMPLATE, source, [1]),
		],
		// t(translationPrefix + ".searchPlaceholder") — suffix here, namespace at call sites
		concatSuffixes: collectMatches(T_CONCAT_SUFFIX, source, [2])
			.filter((suffix) => suffix.startsWith('.') && isI18nKeyPath(suffix.slice(1))),
		translationPrefixes: collectMatches(TRANSLATION_PREFIX_PROP, source, [2]),
	};
}

function keyExists(leafNames, key) {
	if (leafNames.has(key)) return true;
	return I18NEXT_PLURAL_SUFFIXES.some((suffix) => leafNames.has(`${key}${suffix}`));
}

function prefixExists(leafNames, prefix) {
	const normalized = prefix.endsWith('.') ? prefix : `${prefix}.`;
	for (const key of leafNames) {
		if (key.startsWith(normalized)) return true;
	}
	return false;
}

function findKeysMissingFromEnglish(leafNames) {
	const staticKeys = new Map();
	const dynamicPrefixes = new Map();
	const concatSuffixes = new Map();
	const translationPrefixes = new Map();

	for (const file of walkSourceFiles(SRC_DIR)) {
		const source = fs.readFileSync(file, 'utf8');
		const extracted = extractReferencedKeys(source);
		const relative = path.relative(SRC_DIR, file);

		addAll(staticKeys, extracted.staticKeys, relative);
		addAll(dynamicPrefixes, extracted.dynamicPrefixes, relative);
		addAll(concatSuffixes, extracted.concatSuffixes, relative);
		addAll(translationPrefixes, extracted.translationPrefixes, relative);
	}

	for (const [prefix, prefixFiles] of translationPrefixes) {
		for (const [suffix, suffixFiles] of concatSuffixes) {
			const key = `${prefix}${suffix}`;
			addFiles(staticKeys, key, prefixFiles);
			addFiles(staticKeys, key, suffixFiles);
		}
	}

	const compareStrings = (a, b) => a.localeCompare(b);

	const missingKeys = [...staticKeys.entries()]
		.filter(([key]) => !keyExists(leafNames, key))
		.map(([key, files]) => `${key}  (${[...files].sort(compareStrings).join(', ')})`)
		.sort(compareStrings);

	const missingPrefixes = [...dynamicPrefixes.entries()]
		.filter(([prefix]) => !prefixExists(leafNames, prefix))
		.map(([prefix, files]) => `${prefix}*  (${[...files].sort(compareStrings).join(', ')})`)
		.sort(compareStrings);

	return { missingKeys, missingPrefixes };
}

function constructLeafNames(obj, aggrKey, mySet) {
	if (typeof obj !== 'object') {
		mySet.add(aggrKey);
	} else {
		for (const item in obj) {
			if (aggrKey !== '') {
				constructLeafNames(obj[item], `${aggrKey}.${item}`, mySet)
			} else {
				constructLeafNames(obj[item], `${item}`, mySet)
			}
		}
	}
}
console.log("Checking files in src/locales...\n");
const dir = fs.readdirSync('./src/locales');
const locales = {};
for (const locale of dir) {
	if (!locale.endsWith('.json')) continue;
	try {
		locales[locale.split(".")[0]] = JSON.parse(fs.readFileSync(`./src/locales/${locale}`));
	} catch {
		console.log(`${locale} is not valid JSON`);
	}
}

// default locale is en
const leafNames = new Set();
constructLeafNames(locales['en'], '', leafNames);

console.log("Checking source for keys missing from en.json...\n");
const { missingKeys, missingPrefixes } = findKeysMissingFromEnglish(leafNames);
if (missingKeys.length === 0 && missingPrefixes.length === 0) {
	console.log("\x1b[32mNo source keys missing from en.json\x1b[0m\n");
} else {
	if (missingKeys.length) {
		console.log("Missing from en.json:");
		for (const item of missingKeys) {
			console.log(item);
		}
		console.log('');
	}
	if (missingPrefixes.length) {
		console.log("Dynamic prefixes missing from en.json:");
		for (const item of missingPrefixes) {
			console.log(item);
		}
		console.log('');
	}
}

const coverageResults = {};

for (const lc in locales) {
	if (lc === 'en') {
		continue;
	}
	console.log(`\x1b[32m- ${lc} detected\x1b[0m`);

	console.log(`Missing for ${lc}:`);
	const lcLeafs = new Set();
	constructLeafNames(locales[lc], '', lcLeafs);
	let missingCount = 0;
	for (const item of leafNames) {
		if (!lcLeafs.has(item)) {
			console.log(item);
			missingCount++;
		}
	}
	const completion = ((1 - missingCount / leafNames.size) * 100).toFixed(2);

	console.log();
	console.log(`Extraneous for ${lc}:`);
	let extraCount = 0;
	for (const item of lcLeafs) {
		if (!leafNames.has(item)) {
			console.log(item);
			extraCount++;
		}
	}

	console.log(`${missingCount} missing entries (${(100 - (missingCount * 100.0 / lcLeafs.size)).toFixed(2)}% completion)`);
	console.log(`${extraCount} extraneous entries`);
	console.log('');
	coverageResults[lc] = Number(completion);
}

function removeExtraneousKeys(src, target) {
	if (target instanceof Object && !(target instanceof Array)) {
		return Object.keys(src).reduce(
			(result, key) => {
				result[key] = removeExtraneousKeys(src[key], target[key]);
				return result;
			},
			{},
		);
	} else {
		return target;
	}
}

function sortKeys(obj) {
	if (obj instanceof Object && !(obj instanceof Array)) {
		return Object.keys(obj).sort().reduce(
			(result, key) => {
				result[key] = sortKeys(obj[key]);
				return result;
			},
			{},
		);
	} else {
		return obj;
	}
}

console.log("Tidying keys in translation files...");
for (const loc in locales) {
	const extraneousRemoved = removeExtraneousKeys(locales['en'], locales[loc]);
	const sorted = sortKeys(extraneousRemoved);
	fs.writeFileSync(`./src/locales/${loc}.json`, JSON.stringify(sorted, null, "\t"));
}

// Save JSON files
console.log("Saving coverage reports...");

for (const [lang, percent] of Object.entries(coverageResults)) {
	const color = percent >= 100 ? "brightgreen" : percent >= 80 ? "yellow" : "red";
	const langResult = {
		schemaVersion: 1,
		label: `${lang.toUpperCase()} Coverage`,
		message: `${percent}%`,
		color: color,
	};
	const filename = `./translation_coverage/coverage_${lang}.json`
	fs.writeFileSync(filename, JSON.stringify(langResult, null, "\t") + "\n");
	console.log(`Saved ${filename}`)
}

if (missingKeys.length || missingPrefixes.length) {
	console.error(`\n${missingKeys.length + missingPrefixes.length} source key(s) missing from en.json`);
	process.exit(1);
}
