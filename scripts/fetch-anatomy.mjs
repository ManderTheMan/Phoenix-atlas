// Downloads the Z-Anatomy-based anatomy data release (CC BY-SA 4.0) used to
// build public/atlas/*.bin. Only needed when regenerating the model:
//   npm run anatomy:fetch && npm run model
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const DATA_PACKAGE = '@authorod/svitylo-3d-anatomy-data';
export const DATA_VERSION = '1.1.0';
const dir = join(process.cwd(), '.cache', 'anatomy');
const release = join(dir, 'package', 'releases', DATA_VERSION, 'manifest.json');

if (existsSync(release)) {
  console.log(`anatomy data ${DATA_VERSION} already present in ${dir}`);
} else {
  mkdirSync(dir, { recursive: true });
  console.log(`fetching ${DATA_PACKAGE}@${DATA_VERSION} (~70 MB)…`);
  // npm verifies the tarball against the registry's integrity hash
  execFileSync('npm', ['pack', `${DATA_PACKAGE}@${DATA_VERSION}`, '--pack-destination', dir, '--silent'], { stdio: 'inherit' });
  const tgz = readdirSync(dir).find((f) => f.endsWith('.tgz'));
  if (!tgz) throw new Error('npm pack produced no tarball');
  execFileSync('tar', ['-xzf', join(dir, tgz), '-C', dir], { stdio: 'inherit' });
  console.log(`extracted to ${dir}`);
}
