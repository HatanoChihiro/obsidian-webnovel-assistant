import * as fs from 'fs';
import * as path from 'path';

console.log('🔍 Running i18n Translation Completeness Audit...');

const i18nDir = path.join(__dirname, '../src/i18n');
const zhPath = path.join(i18nDir, 'zh-CN.json');
const enPath = path.join(i18nDir, 'en.json');

if (!fs.existsSync(zhPath) || !fs.existsSync(enPath)) {
	console.error('❌ i18n JSON files missing!');
	process.exit(1);
}

const zhData = JSON.parse(fs.readFileSync(zhPath, 'utf8') as string) as Record<string, string>;
const enData = JSON.parse(fs.readFileSync(enPath, 'utf8') as string) as Record<string, string>;

const zhKeys = new Set(Object.keys(zhData));
const enKeys = new Set(Object.keys(enData));

const missingInEn: string[] = [];
const missingInZh: string[] = [];

zhKeys.forEach(key => {
	if (!enKeys.has(key)) {
		missingInEn.push(key);
	}
});

enKeys.forEach(key => {
	if (!zhKeys.has(key)) {
		missingInZh.push(key);
	}
});

let hasErrors = false;

if (missingInEn.length > 0) {
	console.error(`❌ [Error] ${missingInEn.length} keys present in zh-CN.json but missing in en.json:`);
	missingInEn.forEach(k => console.error(`  - ${k}`));
	hasErrors = true;
}

if (missingInZh.length > 0) {
	console.error(`❌ [Error] ${missingInZh.length} keys present in en.json but missing in zh-CN.json:`);
	missingInZh.forEach(k => console.error(`  - ${k}`));
	hasErrors = true;
}

if (hasErrors) {
	console.error('💥 i18n Audit failed! Key count mismatch between zh-CN and en.');
	process.exit(1);
} else {
	console.log(`✅ i18n Audit passed! (${zhKeys.size} keys synchronized in zh-CN and en)`);
}
