import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { decodeCompactDataset, decodeManifest } from "../assets/js/modules/data.js";

const API_KEY_RE = /AIza[0-9A-Za-z_-]{35}/;
const IMAGE_HOST_RE = /https?:\/\/(?:[^\s/]*\.)?(?:ytimg\.com|ggpht\.com|googleusercontent\.com)/i;

/**
 * Valida integridade e segurança de `data/` (hashes, contagens, arquivos órfãos,
 * chaves de API e URLs de imagem). Lança Error na primeira inconsistência.
 */
export async function validateArtifact({ root = process.cwd(), apiKey = "" } = {}) {
  const dataDir = resolve(root, "data");
  const manifestPath = resolve(dataDir, "manifest.json");
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = decodeManifest(JSON.parse(manifestText));
  const referenced = new Set([manifestPath]);
  const entries = [];

  checkManifestStrings(manifest);
  checkKey(manifestText, "data/manifest.json", apiKey);

  for (const entry of manifest.files) await inspectEntry(entry, "file");
  for (const entry of manifest.shards) await inspectEntry(entry, "shard");

  validateCounts();
  await validateNoUnreferencedFiles();

  return { mode: manifest.mode, counts: manifest.counts, files: entries.length };

  async function inspectEntry(entry, kind) {
    const fullPath = resolve(root, entry.path);

    if (!fullPath.startsWith(dataDir + sep)) {
      throw new Error(`${kind} ${entry.path}: caminho fora de data/.`);
    }

    referenced.add(fullPath);

    const content = await readFile(fullPath, "utf8");
    checkKey(content, entry.path, apiKey);
    verifyFile(entry, content);

    const raw = JSON.parse(content);
    const dataset = decodeCompactDataset(raw);

    checkNoImageUrlsInDataset(raw);

    if (
      kind === "shard" &&
      (dataset.videos.length !== entry.counts.videos ||
        dataset.authors.length !== entry.counts.authors ||
        dataset.comments.length !== entry.counts.comments)
    ) {
      throw new Error(`${entry.path}: contagens do shard divergem do manifesto.`);
    }

    entries.push({ kind, entry, dataset });
  }

  function validateCounts() {
    if (manifest.mode === "empty") {
      if (entries.length !== 0) {
        throw new Error("manifesto empty não deve referenciar arquivos.");
      }
      return;
    }

    if (manifest.mode === "full") {
      const dataset = entries[0].dataset;

      if (
        dataset.videos.length !== manifest.counts.videos ||
        dataset.authors.length !== manifest.counts.authors ||
        dataset.comments.length !== manifest.counts.comments
      ) {
        throw new Error("Contagens do dataset full divergem do manifesto.");
      }
      return;
    }

    const totalComments = entries.reduce((sum, item) => sum + item.dataset.comments.length, 0);

    if (totalComments !== manifest.counts.comments) {
      throw new Error(
        `Soma de comentários dos shards (${totalComments}) ` +
        `diverge do manifesto (${manifest.counts.comments}).`
      );
    }

    const videoIds = new Set();
    for (const item of entries) {
      for (const video of item.dataset.videos) videoIds.add(video.id);
    }

    if (videoIds.size !== manifest.counts.videos) {
      throw new Error(
        `Vídeos únicos nos shards (${videoIds.size}) ` +
        `divergem do manifesto (${manifest.counts.videos}).`
      );
    }
  }

  async function validateNoUnreferencedFiles() {
    for (const file of await walk(dataDir)) {
      if (!referenced.has(file)) {
        throw new Error(`Arquivo não referenciado no manifesto: ${file}`);
      }
    }
  }
}

function verifyFile(entry, content) {
  const buffer = Buffer.from(content, "utf8");

  if (entry.sha256 !== createHash("sha256").update(buffer).digest("hex")) {
    throw new Error(`${entry.path}: sha256 divergente.`);
  }

  if (entry.bytes !== buffer.byteLength) {
    throw new Error(`${entry.path}: bytes divergentes.`);
  }

  if (entry.gzipBytes !== gzipSync(buffer).byteLength) {
    throw new Error(`${entry.path}: gzipBytes divergentes.`);
  }
}

async function walk(dir) {
  const out = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }

  return out;
}

function checkNoImageUrlsInDataset(dataset) {
  for (const video of dataset.videos) {
    checkString(video[1], "video.title");
    checkString(video[2], "video.channelTitle");
  }

  for (const author of dataset.authors) {
    checkString(author[0], "author.id");
    checkString(author[1], "author.name");
  }
}

function checkString(value, context) {
  if (typeof value !== "string") return;

  if (IMAGE_HOST_RE.test(value)) {
    throw new Error(`${context}: URL de imagem detectada.`);
  }

  if (/data:image\//i.test(value)) {
    throw new Error(`${context}: data URL de imagem detectada.`);
  }

  if (API_KEY_RE.test(value)) {
    throw new Error(`${context}: possível chave de API detectada.`);
  }
}

function checkManifestStrings(value, path = "manifest") {
  if (typeof value === "string") {
    if (value.includes("://")) throw new Error(`${path}: URL absoluta no manifesto.`);
    if (API_KEY_RE.test(value)) throw new Error(`${path}: possível chave de API no manifesto.`);
    if (IMAGE_HOST_RE.test(value)) throw new Error(`${path}: URL de imagem no manifesto.`);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => checkManifestStrings(item, `${path}[${index}]`));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      checkManifestStrings(item, `${path}.${key}`);
    }
  }
}

function checkKey(content, path, apiKey) {
  if (apiKey && content.includes(apiKey)) {
    throw new Error(`${path}: chave da API encontrada no artefato.`);
  }
}

const isCli =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCli) {
  try {
    const result = await validateArtifact({
      root: process.cwd(),
      apiKey: process.env.YOUTUBE_API_KEY || ""
    });
    console.log(
      `Artefato válido: modo=${result.mode} vídeos=${result.counts.videos} ` +
      `comentários=${result.counts.comments} arquivos=${result.files}.`
    );
  } catch (error) {
    console.error(`Validação falhou: ${error?.message || String(error)}`);
    process.exitCode = 1;
  }
}
