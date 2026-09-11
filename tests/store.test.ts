import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  Store,
  within,
  scopePath,
  recall,
  copyProject,
  diff,
  now,
} from "../server/store.js";
import type { Feedback, Task } from "../shared/types.js";

async function cleanup(root: string) {
  assert.ok(
    path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
  );
  assert.ok(path.basename(root).startsWith("piloop-"));
  await fs.rm(root, { recursive: true, force: true });
}

test("rejects escaping paths and normalizes Windows scope separators", () => {
  const root = path.resolve("fixture");
  assert.throws(() => within(root, "../outside"));
  assert.throws(() => within(root, path.resolve("outside")));
  assert.throws(() => scopePath("styles/../secrets"));
  assert.throws(() => scopePath("C:/secrets"));
  assert.equal(scopePath("styles\\menu.css"), "styles/menu.css");
});
test("recall respects exact file, directory boundary, deactivation and budget", () => {
  const f = (id: string, scope: string, active = true): Feedback => ({
    id,
    scope,
    active,
    text: "keep this",
    createdAt: now(),
  });
  const feedback = [
    f("global", "*"),
    f("directory", "styles"),
    f("wrong", "style"),
    f("old", "styles/menu.css", false),
    f("exact", "styles/menu.css"),
  ];
  assert.deepEqual(
    recall(feedback, "styles/menu.css").map((f) => f.id),
    ["exact", "directory", "global"],
  );
  assert.deepEqual(
    recall(feedback, "styles-v2/menu.css").map((f) => f.id),
    ["global"],
  );
  assert.equal(recall(feedback, "styles/menu.css", 9).length, 1);
});
test("feedback persists across restart while unfinished execution is marked interrupted", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "piloop-store-"));
  try {
    const store = new Store(root);
    await store.init();
    store.state.projects.push({
      id: "p",
      name: "test",
      source: "fixture",
      entry: "index.html",
      activeRevision: "base",
      createdAt: now(),
      feedback: [
        {
          id: "f",
          text: "Keep escape dismissal",
          scope: "index.html",
          active: true,
          createdAt: now(),
        },
      ],
    });
    store.state.tasks.push({
      id: "task",
      projectId: "p",
      prompt: "test",
      provider: "test",
      modelId: "test",
      status: "running",
      baseRevision: "base",
      revision: "next",
      createdAt: now(),
      recalled: [],
      events: [],
      evidence: [],
      changes: [],
      result: "",
    });
    await store.save();
    const restarted = new Store(root);
    await restarted.init();
    assert.equal(restarted.state.tasks[0].status, "interrupted");
    assert.equal(
      recall(restarted.project("p").feedback, "index.html")[0].text,
      "Keep escape dismissal",
    );
  } finally {
    await cleanup(root);
  }
});
test("adoption rejects stale candidates and does not mutate on rejection", () => {
  const store = new Store();
  store.state.projects.push({
    id: "p",
    name: "p",
    source: "",
    entry: "index.html",
    activeRevision: "newer",
    createdAt: now(),
    feedback: [],
  });
  store.state.tasks.push({
    id: "t",
    projectId: "p",
    prompt: "",
    provider: "",
    modelId: "",
    status: "ready",
    baseRevision: "old",
    revision: "candidate",
    createdAt: now(),
    recalled: [],
    events: [],
    evidence: [],
    changes: [],
    result: "",
  });
  assert.throws(() => store.adopt("t"), /当前版本已变化/);
  assert.equal(store.project("p").activeRevision, "newer");
  store.project("p").activeRevision = "old";
  store.adopt("t");
  assert.equal(store.project("p").activeRevision, "candidate");
});
test("copy isolates source, excludes secrets and dependency trees; diff reflects actual changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "piloop-copy-"));
  try {
    const source = path.join(root, "source"),
      target = path.join(root, "copy");
    await fs.mkdir(path.join(source, "node_modules"), { recursive: true });
    await fs.writeFile(path.join(source, "index.html"), "<h1>before</h1>");
    await fs.writeFile(path.join(source, ".env"), "SECRET=never-copy");
    await fs.writeFile(
      path.join(source, "node_modules", "private.js"),
      "private",
    );
    await copyProject(source, target);
    await fs.writeFile(path.join(target, "index.html"), "<h1>after</h1>");
    assert.equal(
      await fs.readFile(path.join(source, "index.html"), "utf8"),
      "<h1>before</h1>",
    );
    await assert.rejects(fs.access(path.join(target, ".env")));
    await assert.rejects(fs.access(path.join(target, "node_modules")));
    const changes = await diff(source, target);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].kind, "modified");
    assert.equal(changes[0].after, "<h1>after</h1>");
  } finally {
    await cleanup(root);
  }
});
test("invalid entry is rejected without registering a project", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "piloop-entry-"));
  try {
    const s = new Store(path.join(root, "data"));
    await s.init();
    await assert.rejects(s.import(root, "bad", "../escape.html"));
    assert.equal(s.state.projects.length, 0);
  } finally {
    await cleanup(root);
  }
});
