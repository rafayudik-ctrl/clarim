import { decodeCompactDataset } from "../../assets/js/modules/data.js";

export function authorKey(id, name) {
  return id || `name:${name}`;
}

export function buildCompactDataset(videoResults, generatedAt = new Date()) {
  const videos = [];
  const authors = [];
  const comments = [];
  const authorIndexByKey = new Map();
  const commentIndexById = new Map();

  for (const result of videoResults) {
    if (!result || result.status !== "ok") continue;

    const meta = result.meta;
    const videoIndex = videos.length;

    videos.push([
      meta.id,
      meta.title || "",
      meta.channelTitle || "",
      meta.publishedAt || 0
    ]);

    for (const group of result.groups || []) {
      const top = group.top;
      if (!top || commentIndexById.has(top.id)) continue;

      const topIndex = addComment({
        comment: top,
        videoIndex,
        parentIndex: -1,
        authors,
        comments,
        authorIndexByKey,
        commentIndexById
      });

      if (topIndex === -1) continue;

      for (const reply of group.replies || []) {
        addComment({
          comment: reply,
          videoIndex,
          parentIndex: topIndex,
          authors,
          comments,
          authorIndexByKey,
          commentIndexById
        });
      }
    }
  }

  const raw = {
    v: 1,
    g: generatedAt.toISOString(),
    videos,
    authors,
    comments
  };

  decodeCompactDataset(raw);
  return raw;
}

function addComment({
  comment,
  videoIndex,
  parentIndex,
  authors,
  comments,
  authorIndexByKey,
  commentIndexById
}) {
  if (!comment || typeof comment.id !== "string" || comment.id === "") {
    return -1;
  }

  if (commentIndexById.has(comment.id)) {
    return commentIndexById.get(comment.id);
  }

  const name = comment.authorName || "Anônimo";
  const key = authorKey(comment.authorId, name);
  let authorIndex = authorIndexByKey.get(key);

  if (authorIndex === undefined) {
    authorIndex = authors.length;
    authorIndexByKey.set(key, authorIndex);
    authors.push([comment.authorId || "", name]);
  }

  const index = comments.length;

  comments.push([
    videoIndex,
    authorIndex,
    toNonNegativeInteger(comment.likeCount),
    toNonNegativeInteger(comment.publishedAt),
    typeof comment.text === "string" ? comment.text : "",
    parentIndex
  ]);

  commentIndexById.set(comment.id, index);
  return index;
}

function toNonNegativeInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}
