import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// These identifiers belong only to server-side scenario hydration/grading. A
// match proves that a private runtime scenario shape crossed into the browser
// bundle; no real answer text is embedded in this scanner itself.
const forbiddenTokens = [
  'hiddenChartState',
  'gradingContext',
  'scoringNotes',
  'callQaScenariosPrivate',
  'callerCaseFile',
  'scenarioSnapshot',
];

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(target) : [target];
  }))).flat();
}

const leaks = [];
for (const file of await filesUnder('dist')) {
  const body = await readFile(file);
  for (const token of forbiddenTokens) {
    if (body.includes(Buffer.from(token))) leaks.push({ file, token });
  }
}

if (leaks.length) {
  for (const leak of leaks) console.error(`Private Call QA runtime token found in ${leak.file}: ${leak.token}`);
  process.exitCode = 1;
} else {
  console.log('Call QA client-bundle private-runtime scan passed.');
}
