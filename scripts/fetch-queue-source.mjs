// Download current, public WaniKani source for the optional integration test.
// Files stay outside the repository; this script does not execute them.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const directory = process.argv[2] || join(tmpdir(), 'wanikani-ios-research');
const home = await fetch('https://www.wanikani.com');
if (!home.ok) throw new Error(`WaniKani HTTP ${home.status}`);
const html = await home.text();
const match = html.match(/<script type="importmap"[^>]*>([\s\S]*?)<\/script>/);
if (!match) throw new Error('WaniKani import map not found');
const { imports } = JSON.parse(match[1]);
await mkdir(directory, { recursive: true });
const modules = ['queue', 'cached_stats', 'wrap_up_manager', 'srs_manager'].map(name => `controllers/quiz_queue/${name}`);
modules.push('controllers/quiz_input_controller', 'lib/answer_checker/utils/helpers');
for (const module of modules) {
  const url = imports[module];
  if (!url || new URL(url).origin !== 'https://assets.wanikani.com') throw new Error('Unexpected source URL');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
  await writeFile(join(directory, `${module.replaceAll('/', '_')}.js`), await response.text());
  console.log(`${module}: ${url}`);
}
console.log(`Set WK_QUEUE_SOURCE_DIR to ${directory} and run npm test.`);
