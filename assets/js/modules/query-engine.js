import { formatCommentsExport } from "./export-format.js";

export const MAX_KEYWORDS = 12;
export const CLOUD_SIZE = 80;
export const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const SORTS = ["recent", "oldest", "likes"];

const FALLBACK_STOPWORDS = [
  "a", "o", "e", "de", "do", "da", "em", "um", "uma", "para", "com", "não", "os",
  "as", "dos", "das", "no", "na", "por", "se", "que", "é", "mas", "mais", "como",
  "the", "an", "and", "or", "of", "to", "in", "for", "with", "on", "at", "by",
  "is", "are", "was", "were", "be", "been", "it", "this", "that"
];

const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
const MENTION_RE = /@[\p{L}\p{N}_.-]+/gu;
const TOKEN_RE = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
// Risadas e repetições ("kkkk", "hahaha", "rsrs", "aaaa") não são palavras úteis.
const NOISE_RE = /^(?:(.)\1+|(?:ha|he|hi|ah|eh|rs|ks)+h?)$/;

export function normalizeText(value) {
  return String(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Aceita lista simples ou objeto { idioma: [palavras] }. */
export function parseStopwords(json) {
  const out = [];
  const add = (list) => {
    if (Array.isArray(list)) {
      for (const word of list) if (typeof word === "string") out.push(word);
    }
  };

  if (Array.isArray(json)) add(json);
  else if (json && typeof json === "object") Object.values(json).forEach(add);

  return out;
}

/**
 * Junta vários datasets compactos (já validados) em um só, deduplicando
 * vídeos e autores e remapeando os índices de comentários e de pais.
 */
export function mergeRawDatasets(list) {
  const videos = [];
  const authors = [];
  const comments = [];
  const videoIndexById = new Map();
  const authorIndexByKey = new Map();

  for (const dataset of list) {
    const videoMap = dataset.videos.map((video) => {
      let index = videoIndexById.get(video[0]);
      if (index === undefined) {
        index = videos.length;
        videoIndexById.set(video[0], index);
        videos.push(video);
      }
      return index;
    });

    const authorMap = dataset.authors.map((author) => {
      const key = author[0] || `name:${author[1]}`;
      let index = authorIndexByKey.get(key);
      if (index === undefined) {
        index = authors.length;
        authorIndexByKey.set(key, index);
        authors.push(author);
      }
      return index;
    });

    const offset = comments.length;

    for (const row of dataset.comments) {
      comments.push([
        videoMap[row[0]],
        authorMap[row[1]],
        row[2],
        row[3],
        row[4],
        row[5] >= 0 ? offset + row[5] : -1
      ]);
    }
  }

  return { videos, authors, comments };
}

export function normalizeQuery(query = {}) {
  const keywords = [];
  const seen = new Set();

  for (const item of Array.isArray(query.keywords) ? query.keywords : []) {
    const normalized = normalizeText(item).replace(/\s+/g, " ").trim();

    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      keywords.push(normalized);
      if (keywords.length >= MAX_KEYWORDS) break;
    }
  }

  return {
    keywords,
    mode: query.mode === "all" ? "all" : "any",
    video: typeof query.video === "string" ? query.video : "",
    author: normalizeText(query.author ?? "").trim(),
    from: toIntOrNull(query.from),
    to: toIntOrNull(query.to),
    sort: SORTS.includes(query.sort) ? query.sort : "recent"
  };
}

export function createEngine({ stopwords = null, cacheSize = 8 } = {}) {
  const stop = new Set(
    [...(stopwords ?? FALLBACK_STOPWORDS)].map((word) => normalizeText(word))
  );

  let videos = [];
  let authors = [];
  let comments = [];
  let normalizedText = null;
  let normalizedAuthors = null;
  let active = null;
  const cache = new Map();

  function setData(data) {
    videos = data.videos;
    authors = data.authors;
    comments = data.comments;
    normalizedText = null;
    normalizedAuthors = null;
    active = null;
    cache.clear();
  }

  function ensureIndex() {
    if (normalizedText) return;
    normalizedText = comments.map((row) => normalizeText(row[4]));
    normalizedAuthors = authors.map((row) => normalizeText(row[1]));
  }

  function compute(q, key) {
    ensureIndex();

    let videoIndex = -2;

    if (q.video) {
      videoIndex = videos.findIndex((video) => video[0] === q.video);
      if (videoIndex === -1) return { key, indices: new Int32Array(0), wordcloud: [] };
    }

    const authorMatch = q.author
      ? normalizedAuthors.map((name) => name.includes(q.author))
      : null;

    const keywordCount = q.keywords.length;
    const matchAll = q.mode === "all";
    const matched = [];
    const counts = new Map();
    const display = new Map();

    for (let i = 0; i < comments.length; i += 1) {
      const row = comments[i];

      if (videoIndex >= 0 && row[0] !== videoIndex) continue;
      if (q.from !== null && row[3] < q.from) continue;
      if (q.to !== null && row[3] > q.to) continue;
      if (authorMatch && !authorMatch[row[1]]) continue;

      if (keywordCount > 0) {
        const text = normalizedText[i];
        let ok = matchAll;

        if (matchAll) {
          for (let k = 0; k < keywordCount; k += 1) {
            if (!text.includes(q.keywords[k])) {
              ok = false;
              break;
            }
          }
        } else {
          for (let k = 0; k < keywordCount; k += 1) {
            if (text.includes(q.keywords[k])) {
              ok = true;
              break;
            }
          }
        }

        if (!ok) continue;
      }

      matched.push(i);
      countWords(row[4], counts, display);
    }

    const indices = Int32Array.from(matched);
    indices.sort(comparatorFor(q.sort));

    const wordcloud = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .slice(0, CLOUD_SIZE)
      .map(([word, count]) => ({ word: display.get(word), count }));

    return { key, indices, wordcloud };
  }

  function countWords(text, counts, display) {
    const tokens = text.replace(URL_RE, " ").replace(MENTION_RE, " ").match(TOKEN_RE);
    if (!tokens) return;

    for (const raw of tokens) {
      if (raw.length < 3 || raw.includes("'") || raw.includes("’")) continue;

      const lower = raw.toLowerCase();
      const word = normalizeText(lower);

      if (word.length < 3 || stop.has(word) || NOISE_RE.test(word)) continue;

      counts.set(word, (counts.get(word) || 0) + 1);
      if (!display.has(word)) display.set(word, lower);
    }
  }

  function comparatorFor(sort) {
    if (sort === "oldest") {
      return (a, b) => comments[a][3] - comments[b][3] || a - b;
    }

    if (sort === "likes") {
      return (a, b) =>
        comments[b][2] - comments[a][2] || comments[b][3] - comments[a][3] || b - a;
    }

    return (a, b) => comments[b][3] - comments[a][3] || b - a;
  }

  function resolve(key) {
    const result = key ? cache.get(key) : active;

    if (!result) {
      const error = new Error("O filtro mudou. Refaça a consulta.");
      error.code = "stale";
      throw error;
    }

    return result;
  }

  function pageOf(result, offset, limit) {
    const start = Math.max(0, Math.trunc(offset) || 0);
    const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(limit) || DEFAULT_PAGE_SIZE));
    const end = Math.min(start + size, result.indices.length);
    const page = [];

    for (let i = start; i < end; i += 1) {
      const index = result.indices[i];
      const row = comments[index];
      const video = videos[row[0]];
      const author = authors[row[1]];

      page.push({
        i: index,
        videoId: video[0],
        video: video[1] || video[0],
        author: author[1],
        likes: row[2],
        date: row[3],
        reply: row[5] >= 0,
        text: row[4]
      });
    }

    return page;
  }

  function filter(rawQuery, { pageSize = DEFAULT_PAGE_SIZE } = {}) {
    const q = normalizeQuery(rawQuery);
    const key = JSON.stringify(q);
    let result = cache.get(key);

    if (result) {
      cache.delete(key); // reinsere para manter a ordem LRU
    } else {
      result = compute(q, key);
    }

    cache.set(key, result);

    while (cache.size > cacheSize) {
      cache.delete(cache.keys().next().value);
    }

    active = result;

    return {
      key,
      total: result.indices.length,
      page: pageOf(result, 0, pageSize),
      wordcloud: result.wordcloud
    };
  }

  function getPage(offset, limit, key) {
    const result = resolve(key);
    return {
      key: result.key,
      offset,
      total: result.indices.length,
      page: pageOf(result, offset, limit)
    };
  }

  function exportText(key) {
    const result = resolve(key);
    const blocks = [];

    for (let i = 0; i < result.indices.length; i += 1) {
      const row = comments[result.indices[i]];
      const video = videos[row[0]];
      const author = authors[row[1]];
      const date = row[3]
        ? new Date(row[3] * 1000).toISOString().slice(0, 10)
        : "data desconhecida";

      blocks.push(`${author[1]} (${video[1] || video[0]}, ${date})\n${row[4]}`);
    }

    return formatCommentsExport(blocks);
  }

  return {
    setData,
    filter,
    getPage,
    exportText,
    videoList: () => videos.map((video) => ({ id: video[0], title: video[1] || video[0] })),
    counts: () => ({
      videos: videos.length,
      authors: authors.length,
      comments: comments.length
    })
  };
}

function toIntOrNull(value) {
  return Number.isInteger(value) ? value : null;
}
