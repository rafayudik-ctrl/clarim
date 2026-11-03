import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  CONTRACT_VERSION,
  MANIFEST_VERSION,
  decodeCompactDataset,
  decodeManifest
} from "../../assets/js/modules/data.js";
import { authorKey } from "./compact.mjs";

/**
 * Hash do conteúdo do dataset ignorando a data de geração (`g`).
 * Permite detectar coletas sem mudança real e evitar commits inúteis.
 */
export function contentHash(dataset) {
  return hashContent(
    JSON.stringify({
      v: dataset.v,
      videos: dataset.videos,
      authors: dataset.authors,
      comments: dataset.comments
    })
  );
}

export function createOutputBundle(dataset, config) {
  decodeCompactDataset(dataset);

  const ch = contentHash(dataset);
  const fullJson = JSON.stringify(dataset);
  const fullBytes = Buffer.byteLength(fullJson, "utf8");
  const fullGzipBytes = gzipSize(fullJson);

  if (dataset.videos.length === 0) {
    const manifest = {
      mv: MANIFEST_VERSION,
      v: CONTRACT_VERSION,
      g: dataset.g,
      ch,
      mode: "empty",
      counts: countsOf(dataset),
      files: [],
      shards: []
    };
    decodeManifest(manifest);

    return {
      manifest,
      files: [],
      warnings: [],
      stats: { fullBytes, fullGzipBytes, mode: "empty", shardCount: 0, maxShardGzipBytes: 0 }
    };
  }

  if (!config.forceShards && fullGzipBytes <= config.maxFullCompressedBytes) {
    const sha256 = hashContent(fullJson);
    const path = `data/datasets/${sha256.slice(0, 16)}.json`;

    const manifest = {
      mv: MANIFEST_VERSION,
      v: CONTRACT_VERSION,
      g: dataset.g,
      ch,
      mode: "full",
      counts: countsOf(dataset),
      files: [{ path, sha256, bytes: fullBytes, gzipBytes: fullGzipBytes }],
      shards: []
    };
    decodeManifest(manifest);

    return {
      manifest,
      files: [{ path, content: fullJson }],
      warnings: [],
      stats: { fullBytes, fullGzipBytes, mode: "full", shardCount: 0, maxShardGzipBytes: 0 }
    };
  }

  const { shards, warnings } = buildShards(dataset, config);

  const manifest = {
    mv: MANIFEST_VERSION,
    v: CONTRACT_VERSION,
    g: dataset.g,
    ch,
    mode: "sharded",
    counts: countsOf(dataset),
    files: [],
    shards: shards.map((shard) => shard.entry)
  };
  decodeManifest(manifest);

  return {
    manifest,
    files: shards.map((shard) => ({ path: shard.entry.path, content: shard.content })),
    warnings,
    stats: {
      fullBytes,
      fullGzipBytes,
      mode: "sharded",
      shardCount: shards.length,
      maxShardGzipBytes: shards.reduce((max, s) => Math.max(max, s.entry.gzipBytes), 0)
    }
  };
}

function buildShards(dataset, config) {
  const shards = [];
  const warnings = [];
  const perVideo = splitByVideo(dataset);

  for (let videoIndex = 0; videoIndex < dataset.videos.length; videoIndex += 1) {
    const videoEntry = dataset.videos[videoIndex];
    const videoId = videoEntry[0];
    const videoComments = perVideo[videoIndex];
    const groups = buildGroups(videoComments);

    const measure = (indices) =>
      gzipSize(
        JSON.stringify(buildShardDataset({ dataset, videoEntry, videoComments, commentIndices: indices }))
      );

    const parts = splitGroupsIntoParts(groups, measure, config.maxShardCompressedBytes);

    for (let part = 0; part < parts.length; part += 1) {
      const shardDataset = buildShardDataset({
        dataset,
        videoEntry,
        videoComments,
        commentIndices: parts[part]
      });

      const content = JSON.stringify(shardDataset);
      const gzipBytes = gzipSize(content);

      if (gzipBytes > config.maxShardCompressedBytes) {
        warnings.push(
          `Shard ${videoId} parte ${part} excede o orçamento: ` +
          `${gzipBytes}B > ${config.maxShardCompressedBytes}B.`
        );
      }

      const sha256 = hashContent(content);
      const path = `data/shards/${videoId}-${part}-${sha256.slice(0, 16)}.json`;

      shards.push({
        entry: {
          id: `${videoId}:${part}`,
          videoId,
          part,
          path,
          sha256,
          bytes: Buffer.byteLength(content, "utf8"),
          gzipBytes,
          counts: {
            videos: 1,
            authors: shardDataset.authors.length,
            comments: shardDataset.comments.length
          }
        },
        content
      });
    }
  }

  return { shards, warnings };
}

// Uma única passada: agrupa comentários por vídeo com índice de pai local.
function splitByVideo(dataset) {
  const perVideo = dataset.videos.map(() => []);
  const localIndex = new Array(dataset.comments.length);

  for (let global = 0; global < dataset.comments.length; global += 1) {
    const [videoIndex, authorIndex, likeCount, publishedAt, text, parent] =
      dataset.comments[global];
    const list = perVideo[videoIndex];

    localIndex[global] = list.length;

    const parentLocalIndex =
      parent !== -1 && dataset.comments[parent][0] === videoIndex
        ? localIndex[parent]
        : -1;

    list.push({ authorIndex, likeCount, publishedAt, text, parentLocalIndex });
  }

  return perVideo;
}

// Grupo = comentário raiz + respostas. Nunca separa um grupo entre shards.
function buildGroups(videoComments) {
  const root = new Array(videoComments.length);
  const groups = new Map();

  for (let i = 0; i < videoComments.length; i += 1) {
    const parent = videoComments[i].parentLocalIndex;
    root[i] = parent === -1 ? i : root[parent];

    if (!groups.has(root[i])) groups.set(root[i], []);
    groups.get(root[i]).push(i);
  }

  return [...groups.values()];
}

// Busca binária pelo maior prefixo de grupos que cabe no orçamento.
function splitGroupsIntoParts(groups, measure, maxBytes) {
  if (groups.length === 0) return [[]];

  const parts = [];
  let start = 0;

  while (start < groups.length) {
    const remaining = groups.length - start;
    const take = (count) => flattenGroups(groups.slice(start, start + count));
    let best;

    if (measure(take(remaining)) <= maxBytes) {
      best = remaining;
    } else {
      // Um grupo isolado sempre é aceito, mesmo acima do orçamento (gera aviso).
      best = 1;
      let lo = 2;
      let hi = remaining - 1;

      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (measure(take(mid)) <= maxBytes) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
    }

    parts.push(take(best));
    start += best;
  }

  return parts;
}

function flattenGroups(groups) {
  const out = [];
  for (const group of groups) {
    for (const index of group) out.push(index);
  }
  return out;
}

function buildShardDataset({ dataset, videoEntry, videoComments, commentIndices }) {
  const authors = [];
  const authorMap = new Map();
  const localIndexMap = new Map();
  const comments = [];

  for (const localIndex of commentIndices) {
    const comment = videoComments[localIndex];

    const parentOut =
      comment.parentLocalIndex !== -1
        ? (localIndexMap.get(comment.parentLocalIndex) ?? -1)
        : -1;

    const globalAuthor = dataset.authors[comment.authorIndex];
    const key = authorKey(globalAuthor[0], globalAuthor[1]);
    let authorIndex = authorMap.get(key);

    if (authorIndex === undefined) {
      authorIndex = authors.length;
      authorMap.set(key, authorIndex);
      authors.push([globalAuthor[0], globalAuthor[1]]);
    }

    localIndexMap.set(localIndex, comments.length);

    comments.push([
      0,
      authorIndex,
      comment.likeCount,
      comment.publishedAt,
      comment.text,
      parentOut
    ]);
  }

  const shard = {
    v: CONTRACT_VERSION,
    g: dataset.g,
    videos: [videoEntry.slice()],
    authors,
    comments
  };

  decodeCompactDataset(shard);
  return shard;
}

function countsOf(dataset) {
  return {
    videos: dataset.videos.length,
    authors: dataset.authors.length,
    comments: dataset.comments.length
  };
}

function hashContent(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function gzipSize(content) {
  return gzipSync(Buffer.from(content, "utf8")).byteLength;
}
