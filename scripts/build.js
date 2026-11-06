import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirs = ['src', 'public'];

async function findJavaScript(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findJavaScript(path);
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : [];
  }));
  return files.flat();
}

const files = (await Promise.all(sourceDirs.map((dir) => findJavaScript(join(root, dir))))).flat();
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
}

console.log(`Build check passed: ${files.length} JavaScript files parse successfully (this app serves them directly; no bundling is needed).`);
