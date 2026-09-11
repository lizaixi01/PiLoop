import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Exercise the packed consumer install, without the checkout's devDependencies.
const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'piloop-package-'));
const npm = (args, cwd = temp) => {
  const options = { cwd, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 };
  if (process.platform !== 'win32') return execFileSync('npm', args, options);
  const npmCmd = execFileSync('where.exe', ['npm.cmd'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
  const npmCli = path.join(path.dirname(npmCmd), 'node_modules/npm/bin/npm-cli.js');
  return execFileSync(process.execPath, [npmCli, ...args], options);
};
try {
  const pack = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temp], root))[0];
  const shipped = pack.files.map(f => f.path);
  assert.deepEqual(shipped.filter(f => f.startsWith('lib/')).sort(), [
    'cli', 'native-memory', 'scope', 'tui', 'updates', 'web-check', 'pi-sdk',
  ].map(f => `lib/server/${f}.js`).sort());
  assert.ok(!shipped.some(f => /^(dist|examples|src|shared)\//.test(f)));
  const prefix = path.join(temp, 'installed');
  npm(['install', '--global', '--prefix', prefix, path.join(temp, pack.filename), '--no-audit', '--no-fund']);
  const modules = path.join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules');
  const installed = path.join(modules, 'piloop');
  const pkg = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
  for (const name of ['playwright', 'playwright-core', 'react', 'react-dom', 'express', 'vite']) {
    assert.ok(!fs.existsSync(path.join(installed, 'node_modules', name)), `${name} shipped to consumer`);
  }
  const launcher = path.join(installed, 'bin/piloop.mjs');
  const env = { ...process.env, PILOOP_DATA_DIR: path.join(temp, 'data'), PILOOP_NO_UPDATE_CHECK: '1' };
  delete env.PILOOP_AUTH_FILE;
  delete env.PILOOP_MODELS_FILE;
  const run = args => execFileSync(process.execPath, [launcher, ...args], {
    cwd: temp, env, input: '', encoding: 'utf8', timeout: 120000,
  });
  assert.equal(run(['--version']).trim(), pkg.version);
  assert.match(run(['--help']), /piloop update/);
  run([]); // Initializes the real Pi runtime with empty stdin and no credentials.
  console.log(`Packed CLI ${pkg.version}: clean install, help, version, runtime startup passed; ${shipped.length} files, ${pack.size} bytes.`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
