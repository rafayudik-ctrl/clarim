import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSite } from "../tools/build-site.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("todo arquivo do shell listado no Service Worker existe", async () => {
  const sw = await readFile(join(ROOT, "sw.js"), "utf8");
  const block = sw.match(/const SHELL_PATHS = \[([\s\S]*?)\];/)[1];
  const paths = [...block.matchAll(/"(\.\/[^"]*)"/g)].map((m) => m[1]);

  assert.ok(paths.length > 10);

  for (const path of paths) {
    const file = path === "./" ? "index.html" : path.slice(2);
    assert.ok(await exists(join(ROOT, file)), `${path} listado no SW mas ausente`);
  }
});

test("todo módulo importado pelo front-end está no cache do shell", async () => {
  const sw = await readFile(join(ROOT, "sw.js"), "utf8");
  const files = [
    "assets/js/app.js",
    "assets/js/modules/query-service.js",
    "assets/js/modules/query-engine.js",
    "assets/js/modules/worker-client.js",
    "assets/js/modules/ui.js",
    "assets/js/modules/cache.js",
    "assets/js/workers/query-worker.js"
  ];

  for (const file of files) {
    const source = await readFile(join(ROOT, file), "utf8");
    const imports = [...source.matchAll(/from\s+"(\.[^"]+)"/g)].map((m) => m[1]);

    for (const spec of imports) {
      const target = resolve(dirname(join(ROOT, file)), spec);
      const rel = target.slice(ROOT.length + 1);
      assert.ok(sw.includes(`"./${rel}"`), `${rel} (importado por ${file}) falta no SW`);
    }
  }
});

test("build do site: copia só o necessário e injeta o hash no sw.js", async () => {
  const out = await mkdtemp(join(tmpdir(), "clarim-dist-"));

  try {
    const { buildHash } = await buildSite({ root: ROOT, out });

    assert.match(buildHash, /^[a-f0-9]{12}$/);

    const sw = await readFile(join(out, "sw.js"), "utf8");
    assert.ok(sw.includes(`const BUILD_HASH = '${buildHash}';`));

    for (const present of ["index.html", "_headers", "data/manifest.json", "assets/js/app.js"]) {
      assert.ok(await exists(join(out, present)), `${present} deveria estar em dist`);
    }

    for (const absent of ["scripts", "test", "config", "docs", "package.json", ".github"]) {
      assert.ok(!(await exists(join(out, absent))), `${absent} não deveria estar em dist`);
    }

    // O sw.js da raiz continua em modo dev.
    assert.ok((await readFile(join(ROOT, "sw.js"), "utf8")).includes("BUILD_HASH = 'dev'"));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
