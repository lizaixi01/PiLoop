import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv[2] === '--child') {
  const root = process.argv[3];
  const started = performance.now();
  const sdk = await import('../lib/server/pi-sdk.js');
  const sdkMs = performance.now() - started;
  const { nativeRuntimeFactory } = await import('../lib/server/tui.js');
  const importsMs = performance.now() - started;
  const runtime = await sdk.ModelRuntime.create({
    authPath: path.join(root, 'auth.json'), modelsPath: null,
    modelsStorePath: path.join(root, 'models.json'), refreshOnCreate: false, allowModelNetwork: false,
  });
  const modelMs = performance.now() - started - importsMs;
  const host = await sdk.createAgentSessionRuntime(nativeRuntimeFactory(runtime, root), {
    cwd: root, agentDir: root, sessionManager: sdk.SessionManager.create(root, path.join(root, 'sessions')),
  });
  const readyMs = performance.now() - started;
  await host.dispose();
  console.log(JSON.stringify({ sdkMs, importsMs, modelMs, readyMs }));
} else {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'piloop-startup-bench-'));
  const runs = [];
  try {
    for (let round = 0; round < 3; round++) {
      for (const mode of (round % 2 ? ['bundled', 'public'] : ['public', 'bundled'])) {
        const dir = path.join(root, `${round}-${mode}`); await fs.mkdir(dir);
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', dir], {
          env: { ...process.env, PILOOP_UNBUNDLED_SDK: mode === 'public' ? '1' : '0', PILOOP_NO_UPDATE_CHECK: '1' },
          encoding: 'utf8', timeout: 90000,
        });
        if (child.status !== 0) throw new Error(child.stderr || String(child.error));
        const result = { mode, round, ...JSON.parse(child.stdout.trim()) };
        runs.push(result); console.log(JSON.stringify(result));
      }
    }
    for (const mode of ['public', 'bundled']) {
      const values = runs.filter(r => r.mode === mode).map(r => r.readyMs).sort((a,b)=>a-b);
      console.log(`${mode} median runtime-ready: ${Math.round(values[1])} ms`);
    }
    console.log('Fresh processes and isolated empty configuration; OS disk caches not cleared. Does not measure first TUI paint or model response.');
  } finally {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('piloop-startup-bench-')) throw Error('unsafe cleanup');
    await fs.rm(root, { recursive: true, force: true });
  }
}
