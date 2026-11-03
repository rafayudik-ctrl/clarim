import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export async function loadConfig(root = process.cwd()) {
  const file = resolve(root, "config/collection.json");
  const raw = JSON.parse(await readFile(file, "utf8"));
  return validateConfig(raw);
}

/**
 * Aceita um ID de 11 caracteres ou uma URL comum do YouTube
 * (watch, youtu.be, shorts, embed, live). Retorna null se inválido.
 */
export function extractVideoId(value) {
  if (typeof value !== "string") return null;

  const text = value.trim();
  if (VIDEO_ID_RE.test(text)) return text;

  let url;
  try {
    url = new URL(text.includes("://") ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^(www|m)\./, "");
  let id = null;

  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] || null;
  } else if (host === "youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") {
      id = url.searchParams.get("v");
    } else {
      id = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?]+)/)?.[1] ?? null;
    }
  }

  return id && VIDEO_ID_RE.test(id) ? id : null;
}

export function validateConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("config/collection.json: objeto raiz esperado.");
  }

  if (!Array.isArray(raw.videos) || raw.videos.length === 0) {
    throw new Error(
      "config.videos: informe ao menos um vídeo em config/collection.json " +
      "(ID de 11 caracteres ou URL do YouTube)."
    );
  }

  const videos = [];
  const seen = new Set();

  for (const value of raw.videos) {
    const id = extractVideoId(value);

    if (!id) {
      throw new Error(
        `config.videos: ID inválido "${String(value)}". ` +
        "Use 11 caracteres [A-Za-z0-9_-] ou uma URL do YouTube."
      );
    }

    if (!seen.has(id)) {
      seen.add(id);
      videos.push(id);
    }
  }

  return {
    videos,
    maxCommentsPerVideo: intRange(raw.maxCommentsPerVideo, 1000, 1, 5000, "maxCommentsPerVideo"),
    maxPagesPerVideo: intRange(raw.maxPagesPerVideo, 10, 1, 100, "maxPagesPerVideo"),
    pageSize: intRange(raw.pageSize, 100, 1, 100, "pageSize"),
    includeReplies: boolValue(raw.includeReplies, false, "includeReplies"),
    minCommentChars: intRange(raw.minCommentChars, 0, 0, 10000, "minCommentChars"),
    minTotalComments: intMin(raw.minTotalComments, 1, 0, "minTotalComments"),
    minVideosWithComments: intMin(raw.minVideosWithComments, 1, 0, "minVideosWithComments"),
    allowPartial: boolValue(raw.allowPartial, false, "allowPartial"),
    maxFullCompressedBytes: intMin(raw.maxFullCompressedBytes, 307200, 1, "maxFullCompressedBytes"),
    maxShardCompressedBytes: intMin(raw.maxShardCompressedBytes, 204800, 1, "maxShardCompressedBytes"),
    forceShards: boolValue(raw.forceShards, false, "forceShards"),
    retries: intMin(raw.retries, 3, 0, "retries"),
    retryBaseDelayMs: intMin(raw.retryBaseDelayMs, 500, 0, "retryBaseDelayMs")
  };
}

function intRange(value, fallback, min, max, name) {
  const n = value === undefined ? fallback : value;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`config.${name}: inteiro entre ${min} e ${max} esperado.`);
  }
  return n;
}

function intMin(value, fallback, min, name) {
  const n = value === undefined ? fallback : value;
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`config.${name}: inteiro >= ${min} esperado.`);
  }
  return n;
}

function boolValue(value, fallback, name) {
  const v = value === undefined ? fallback : value;
  if (typeof v !== "boolean") {
    throw new Error(`config.${name}: booleano esperado.`);
  }
  return v;
}
