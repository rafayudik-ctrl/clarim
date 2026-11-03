import { YouTubeApiError } from "./youtube.mjs";

// Motivos de erro por vídeo que devem apenas pular o vídeo, sem abortar.
const COMMENTS_UNAVAILABLE = new Set(["commentsDisabled", "forbidden"]);
const VIDEO_MISSING = new Set(["videoNotFound", "notFound"]);

export async function collectConfiguredVideos({ client, config }) {
  const warnings = [];
  const metadata = await client.listVideos(config.videos);
  const videoResults = [];

  for (const videoId of config.videos) {
    const meta = metadata.get(videoId) || null;

    if (!meta) {
      warnings.push({
        videoId,
        status: "videoNotFound",
        message: "Vídeo não encontrado, privado ou removido."
      });
      videoResults.push({ videoId, status: "videoNotFound" });
      continue;
    }

    try {
      videoResults.push(await collectVideoComments({ client, config, videoId, meta }));
    } catch (error) {
      if (error instanceof YouTubeApiError && error.fatal) throw error;

      if (error instanceof YouTubeApiError && COMMENTS_UNAVAILABLE.has(error.reason)) {
        warnings.push({
          videoId,
          status: "commentsDisabled",
          message: "Comentários desabilitados ou indisponíveis."
        });
        videoResults.push({ videoId, status: "commentsDisabled", meta });
        continue;
      }

      if (error instanceof YouTubeApiError && VIDEO_MISSING.has(error.reason)) {
        warnings.push({
          videoId,
          status: "videoNotFound",
          message: "Vídeo não encontrado."
        });
        videoResults.push({ videoId, status: "videoNotFound", meta });
        continue;
      }

      warnings.push({
        videoId,
        status: "failed",
        message: error?.message || "Falha desconhecida."
      });
      videoResults.push({ videoId, status: "failed", meta, error });
    }
  }

  return { videoResults, warnings };
}

async function collectVideoComments({ client, config, videoId, meta }) {
  const groups = [];
  let pageToken;
  let pages = 0;
  let count = 0;
  const minChars = config.minCommentChars || 0;

  while (pages < config.maxPagesPerVideo && count < config.maxCommentsPerVideo) {
    const response = await client.listCommentThreads(videoId, {
      pageSize: config.pageSize,
      pageToken,
      includeReplies: config.includeReplies
    });

    const items = Array.isArray(response.items) ? response.items : [];

    for (const item of items) {
      if (count >= config.maxCommentsPerVideo) break;

      const top = normalizeComment(item.snippet?.topLevelComment, null);
      if (!top) continue;

      const replies = [];
      if (config.includeReplies) {
        for (const replyItem of item.replies?.comments ?? []) {
          const reply = normalizeComment(replyItem, top.id);
          if (reply && meetsMinChars(reply.text, minChars)) replies.push(reply);
        }
      }

      if (meetsMinChars(top.text, minChars)) {
        const room = Math.max(0, config.maxCommentsPerVideo - count - 1);
        const kept = replies.slice(0, room);
        groups.push({ top, replies: kept });
        count += 1 + kept.length;
      } else {
        // Comentário principal curto demais: respostas longas viram comentários
        // independentes (parentId nulo) para não ficarem órfãs.
        for (const reply of replies) {
          if (count >= config.maxCommentsPerVideo) break;
          groups.push({ top: { ...reply, parentId: null }, replies: [] });
          count += 1;
        }
      }
    }

    pages += 1;
    pageToken = response.nextPageToken;
    if (!pageToken) break;
  }

  groups.sort((a, b) => compareComments(a.top, b.top));
  for (const group of groups) {
    group.replies.sort(compareComments);
  }

  return { videoId, status: "ok", meta, groups };
}

/** Conta caracteres Unicode (não unidades UTF-16) do texto sem espaços nas pontas. */
export function meetsMinChars(text, minChars) {
  if (!minChars) return true;
  return [...String(text).trim()].length >= minChars;
}

function normalizeComment(resource, parentId) {
  if (!resource || typeof resource.id !== "string" || resource.id === "") {
    return null;
  }

  const snippet = resource.snippet || {};
  const text =
    typeof snippet.textOriginal === "string"
      ? snippet.textOriginal
      : typeof snippet.textDisplay === "string"
        ? snippet.textDisplay
        : "";

  const authorId =
    snippet.authorChannelId && typeof snippet.authorChannelId.value === "string"
      ? snippet.authorChannelId.value
      : "";

  const authorName =
    typeof snippet.authorDisplayName === "string" &&
    snippet.authorDisplayName.trim() !== ""
      ? snippet.authorDisplayName
      : "Anônimo";

  return {
    id: resource.id,
    parentId: typeof parentId === "string" ? parentId : null,
    text,
    publishedAt: toEpochSeconds(snippet.publishedAt),
    likeCount: toNonNegativeInteger(snippet.likeCount),
    authorId,
    authorName
  };
}

function compareComments(a, b) {
  if (a.publishedAt !== b.publishedAt) return a.publishedAt - b.publishedAt;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function toEpochSeconds(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms >= 0 ? Math.floor(ms / 1000) : 0;
}

function toNonNegativeInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}
