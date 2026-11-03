import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "./lib/config.mjs";
import { createYouTubeClient } from "./lib/youtube.mjs";
import { collectConfiguredVideos } from "./lib/collector.mjs";
import { buildCompactDataset } from "./lib/compact.mjs";
import { createOutputBundle } from "./lib/output.mjs";
import { publishOutputs } from "./lib/publish.mjs";
import { decodeCompactDataset, decodeManifest } from "../assets/js/modules/data.js";

const DAILY_QUOTA_LIMIT = 10000;
const root = process.cwd();
const apiKey = process.env.YOUTUBE_API_KEY;
const forcePublish = process.env.FORCE_PUBLISH === "1" || process.env.FORCE_PUBLISH === "true";

try {
  if (!apiKey) {
    throw new Error(
      "YOUTUBE_API_KEY não definida. Configure GitHub Secrets ou variável local."
    );
  }

  const config = await loadConfig(root);
  const client = createYouTubeClient({
    apiKey,
    retries: config.retries,
    retryBaseDelayMs: config.retryBaseDelayMs
  });

  console.log(`Coletando ${config.videos.length} vídeo(s) configurado(s).`);

  const { videoResults, warnings } = await collectConfiguredVideos({ client, config });

  const failed = videoResults.filter((result) => result.status === "failed");

  if (failed.length > 0 && !config.allowPartial) {
    throw new Error(
      `${failed.length} vídeo(s) falharam e allowPartial=false ` +
      `(${failed.map((f) => f.videoId).join(", ")}). Última versão válida preservada.`
    );
  }

  const okResults = videoResults.filter((result) => result.status === "ok");

  const totalComments = okResults.reduce(
    (sum, result) =>
      sum + result.groups.reduce((acc, group) => acc + 1 + group.replies.length, 0),
    0
  );

  const videosWithComments = okResults.filter((result) => result.groups.length > 0).length;

  if (totalComments < config.minTotalComments) {
    throw new Error(
      `Comentários insuficientes: ${totalComments} < ${config.minTotalComments}. ` +
      "Última versão válida preservada."
    );
  }

  if (videosWithComments < config.minVideosWithComments) {
    throw new Error(
      `Vídeos com comentários insuficientes: ${videosWithComments} < ` +
      `${config.minVideosWithComments}. Última versão válida preservada.`
    );
  }

  const dataset = buildCompactDataset(okResults, new Date());
  decodeCompactDataset(dataset);

  const bundle = createOutputBundle(dataset, config);

  // Estimativa de cota gasta nesta coleta (a API não informa a cota restante).
  // Fica fora do hash de conteúdo `ch`.
  bundle.manifest.q = { used: client.getUsage().units, limit: DAILY_QUOTA_LIMIT };
  decodeManifest(bundle.manifest);

  for (const warning of warnings) {
    console.warn(`Aviso: ${warning.videoId} ${warning.status} ${warning.message || ""}`.trim());
  }

  for (const warning of bundle.warnings) {
    console.warn(`Aviso: ${warning}`);
  }

  const previous = await readPreviousManifest(root);

  if (
    !forcePublish &&
    previous &&
    previous.mode !== "empty" &&
    previous.contentHash &&
    previous.contentHash === bundle.manifest.ch
  ) {
    console.log("Sem mudanças no conteúdo desde a última coleta. Nada a publicar.");
    process.exit(0);
  }

  await publishOutputs({ root, manifest: bundle.manifest, files: bundle.files });

  console.log(
    `Publicado: modo=${bundle.manifest.mode} vídeos=${dataset.videos.length} ` +
    `autores=${dataset.authors.length} comentários=${dataset.comments.length}`
  );
  console.log(`Cota estimada usada nesta coleta: ${bundle.manifest.q.used} de ${DAILY_QUOTA_LIMIT} unidades.`);
  console.log(
    `Tamanho full: ${bundle.stats.fullBytes}B JSON / ${bundle.stats.fullGzipBytes}B gzip; ` +
    `limite=${config.maxFullCompressedBytes}B.`
  );

  if (bundle.stats.mode === "sharded") {
    console.log(
      `Shards: ${bundle.stats.shardCount}; maior gzip=${bundle.stats.maxShardGzipBytes}B; ` +
      `limite por shard=${config.maxShardCompressedBytes}B.`
    );
  }
} catch (error) {
  console.error(`Falha na coleta: ${error?.message || String(error)}`);
  process.exitCode = 1;
}

async function readPreviousManifest(rootDir) {
  try {
    const text = await readFile(resolve(rootDir, "data/manifest.json"), "utf8");
    return decodeManifest(JSON.parse(text));
  } catch {
    return null;
  }
}
