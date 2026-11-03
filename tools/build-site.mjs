import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Somente o que o navegador precisa. Scripts, testes, docs e config ficam de fora.
export const SITE_ENTRIES = [
  "index.html",
  "manifest.webmanifest",
  "sw.js",
  "_headers",
  "assets",
  "icons",
  "data"
];

// Arquivos do shell que entram no hash de versão (dados têm hash próprio).
export const HASH_ENTRIES = ["index.html", "manifest.webmanifest", "assets", "icons"];

const BUILD_HASH_RE = /const BUILD_HASH = (["'])[^"']*\1;/;

export async function buildSite({ root = DEFAULT_ROOT, out = resolve(root, "dist") } = {}) {
  await stat(resolve(root, "data/manifest.json")).catch(() => {
    throw new Error("data/manifest.json não encontrado. Rode a coleta ou `npm run sample`.");
  });

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  for (const entry of SITE_ENTRIES) {
    const source = resolve(root, entry);

    if (await exists(source)) {
      await cp(source, resolve(out, entry), { recursive: true });
    }
  }

  const buildHash = await hashShell(root);
  const swPath = resolve(out, "sw.js");
  const serviceWorker = await readFile(swPath, "utf8");

  if (!BUILD_HASH_RE.test(serviceWorker)) {
    throw new Error("Marcador const BUILD_HASH não encontrado em sw.js.");
  }

  await writeFile(
    swPath,
    serviceWorker.replace(BUILD_HASH_RE, `const BUILD_HASH = '${buildHash}';`),
    "utf8"
  );

  return { buildHash, out };
}

async function hashShell(root) {
  const files = [];

  for (const entry of HASH_ENTRIES) {
    await collect(resolve(root, entry), files);
  }

  const posix = (file) => relative(root, file).split(sep).join("/");
  files.sort((a, b) => (posix(a) < posix(b) ? -1 : 1));

  const hash = createHash("sha256");

  for (const file of files) {
    hash.update(posix(file));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }

  return hash.digest("hex").slice(0, 12);
}

async function collect(path, files) {
  const info = await stat(path);

  if (info.isDirectory()) {
    for (const name of await readdir(path)) {
      await collect(resolve(path, name), files);
    }
  } else {
    files.push(path);
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const isCli =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCli) {
  try {
    const outIndex = process.argv.indexOf("--out");
    const out = outIndex !== -1 ? resolve(process.argv[outIndex + 1]) : undefined;
    const { buildHash, out: target } = await buildSite(out ? { out } : {});

    console.log(`BUILD_HASH=${buildHash} injetado em ${relative(process.cwd(), target) || "."}/sw.js`);
  } catch (error) {
    console.error(`Build falhou: ${error?.message || String(error)}`);
    process.exitCode = 1;
  }
}
