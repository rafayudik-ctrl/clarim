export const CONTRACT_VERSION = 1;
export const MANIFEST_VERSION = 1;

export function decodeManifest(raw) {
  if (!isRecord(raw)) {
    throw new TypeError("manifest: objeto raiz esperado.");
  }

  if (!Number.isInteger(raw.mv) || raw.mv !== MANIFEST_VERSION) {
    throw new TypeError(
      `manifest: versão de manifesto não suportada (${String(raw.mv)}).`
    );
  }

  if (!Number.isInteger(raw.v) || raw.v !== CONTRACT_VERSION) {
    throw new TypeError(
      `manifest: versão de contrato não suportada (${String(raw.v)}).`
    );
  }

  if (typeof raw.g !== "string" || Number.isNaN(Date.parse(raw.g))) {
    throw new TypeError("manifest.g: data de geração inválida.");
  }

  if (raw.mode !== "full" && raw.mode !== "sharded" && raw.mode !== "empty") {
    throw new TypeError("manifest.mode: valor inválido.");
  }

  const counts = decodeCounts(raw.counts, "manifest.counts");
  const rawFiles = ensureArray(raw.files ?? [], "manifest.files");
  const rawShards = ensureArray(raw.shards ?? [], "manifest.shards");

  const files = rawFiles.map((entry, index) =>
    decodeFileEntry(entry, `manifest.files[${index}]`)
  );
  const shards = rawShards.map((entry, index) =>
    decodeShardEntry(entry, `manifest.shards[${index}]`)
  );

  // `ch` (hash do conteúdo, sem a data de geração) é opcional.
  const contentHash =
    raw.ch === undefined ? "" : readSha256(raw.ch, "manifest.ch");

  // `q` (opcional): estimativa de cota da YouTube Data API usada na coleta.
  let quota = null;
  if (raw.q !== undefined) {
    if (
      !isRecord(raw.q) ||
      !Number.isInteger(raw.q.used) || raw.q.used < 0 ||
      !Number.isInteger(raw.q.limit) || raw.q.limit < 1
    ) {
      throw new TypeError("manifest.q: { used, limit } inteiros esperados.");
    }
    quota = { used: raw.q.used, limit: raw.q.limit };
  }

  if (raw.mode === "empty") {
    if (files.length !== 0 || shards.length !== 0) {
      throw new TypeError("manifest: modo empty não deve ter arquivos.");
    }

    if (counts.videos !== 0 || counts.authors !== 0 || counts.comments !== 0) {
      throw new TypeError("manifest: modo empty deve ter contagens zero.");
    }
  }

  if (raw.mode === "full" && (files.length !== 1 || shards.length !== 0)) {
    throw new TypeError(
      "manifest: modo full deve ter exatamente um arquivo e nenhum shard."
    );
  }

  if (raw.mode === "sharded") {
    if (files.length !== 0 || shards.length === 0) {
      throw new TypeError(
        "manifest: modo sharded deve ter shards e nenhum arquivo full."
      );
    }

    const totalComments = shards.reduce(
      (sum, shard) => sum + shard.counts.comments,
      0
    );

    if (totalComments !== counts.comments) {
      throw new TypeError(
        "manifest: soma de comentários dos shards diverge das contagens."
      );
    }
  }

  return {
    manifestVersion: raw.mv,
    version: raw.v,
    generatedAt: raw.g,
    quota,
    mode: raw.mode,
    contentHash,
    counts,
    files,
    shards
  };
}

export function decodeCompactDataset(raw) {
  if (!isRecord(raw)) {
    throw new TypeError("dataset: objeto raiz esperado.");
  }

  if (!Number.isInteger(raw.v) || raw.v !== CONTRACT_VERSION) {
    throw new TypeError(
      `dataset: versão de contrato não suportada (${String(raw.v)}).`
    );
  }

  if (typeof raw.g !== "string" || Number.isNaN(Date.parse(raw.g))) {
    throw new TypeError("dataset.g: data de geração inválida.");
  }

  const rawVideos = ensureArray(raw.videos, "dataset.videos");
  const rawAuthors = ensureArray(raw.authors, "dataset.authors");
  const rawComments = ensureArray(raw.comments, "dataset.comments");

  const videos = rawVideos.map((row, index) => {
    const path = `dataset.videos[${index}]`;

    if (!Array.isArray(row) || row.length < 4) {
      throw new TypeError(`${path}: array com 4 campos esperado.`);
    }

    const [id, title, channelTitle, publishedAt] = row;

    return {
      index,
      id: readString(id, `${path}[0]`, { allowEmpty: false }),
      title: readString(title, `${path}[1]`, { allowEmpty: true }),
      channelTitle: readString(channelTitle, `${path}[2]`, { allowEmpty: true }),
      publishedAt: readNonNegativeInteger(publishedAt, `${path}[3]`)
    };
  });

  const authors = rawAuthors.map((row, index) => {
    const path = `dataset.authors[${index}]`;

    if (!Array.isArray(row) || row.length < 2) {
      throw new TypeError(`${path}: array com 2 campos esperado.`);
    }

    const [id, displayName] = row;

    return {
      index,
      id: readString(id, `${path}[0]`, { allowEmpty: true }),
      displayName: readString(displayName, `${path}[1]`, { allowEmpty: false })
    };
  });

  const comments = rawComments.map((row, index) => {
    const path = `dataset.comments[${index}]`;

    if (!Array.isArray(row) || row.length < 6) {
      throw new TypeError(`${path}: array com 6 campos esperado.`);
    }

    const [videoIndex, authorIndex, likeCount, publishedAt, text, parentIndex] = row;

    assertIndex(videoIndex, videos.length, `${path}[0]`);
    assertIndex(authorIndex, authors.length, `${path}[1]`);
    readNonNegativeInteger(likeCount, `${path}[2]`);
    readNonNegativeInteger(publishedAt, `${path}[3]`);

    if (typeof text !== "string") {
      throw new TypeError(`${path}[4]: texto deve ser string.`);
    }

    if (!Number.isInteger(parentIndex) || parentIndex < -1) {
      throw new TypeError(
        `${path}[5]: comentário pai deve ser -1 ou índice válido.`
      );
    }

    if (parentIndex >= index) {
      throw new TypeError(
        `${path}[5]: o comentário pai deve aparecer antes do filho. ` +
        `Recebido ${parentIndex}.`
      );
    }

    return {
      index,
      videoIndex,
      authorIndex,
      likeCount,
      publishedAt,
      text,
      parentIndex
    };
  });

  return {
    version: raw.v,
    generatedAt: raw.g,
    videos,
    authors,
    comments
  };
}

function decodeCounts(value, path) {
  if (!isRecord(value)) {
    throw new TypeError(`${path}: objeto esperado.`);
  }

  return {
    videos: readNonNegativeInteger(value.videos, `${path}.videos`),
    authors: readNonNegativeInteger(value.authors, `${path}.authors`),
    comments: readNonNegativeInteger(value.comments, `${path}.comments`)
  };
}

function decodeFileEntry(value, path) {
  if (!isRecord(value)) {
    throw new TypeError(`${path}: objeto esperado.`);
  }

  return {
    path: readSafeRelativePath(value.path, `${path}.path`),
    sha256: readSha256(value.sha256, `${path}.sha256`),
    bytes: readNonNegativeInteger(value.bytes, `${path}.bytes`),
    gzipBytes: readNonNegativeInteger(value.gzipBytes, `${path}.gzipBytes`)
  };
}

function decodeShardEntry(value, path) {
  if (!isRecord(value)) {
    throw new TypeError(`${path}: objeto esperado.`);
  }

  return {
    id: readString(value.id, `${path}.id`, { allowEmpty: false }),
    videoId: readString(value.videoId, `${path}.videoId`, { allowEmpty: false }),
    part: readNonNegativeInteger(value.part, `${path}.part`),
    path: readSafeRelativePath(value.path, `${path}.path`),
    sha256: readSha256(value.sha256, `${path}.sha256`),
    bytes: readNonNegativeInteger(value.bytes, `${path}.bytes`),
    gzipBytes: readNonNegativeInteger(value.gzipBytes, `${path}.gzipBytes`),
    counts: decodeCounts(value.counts, `${path}.counts`)
  };
}

function readSafeRelativePath(value, path) {
  const str = readString(value, path, { allowEmpty: false });

  if (
    !str.startsWith("data/") ||
    str.startsWith("/") ||
    str.includes("\\") ||
    str.includes("://")
  ) {
    throw new TypeError(`${path}: caminho relativo sob data/ esperado.`);
  }

  const parts = str.split("/");

  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new TypeError(`${path}: caminho inseguro.`);
  }

  return str;
}

function readSha256(value, path) {
  const str = readString(value, path, { allowEmpty: false });

  if (!/^[a-f0-9]{64}$/.test(str)) {
    throw new TypeError(
      `${path}: sha256 hexadecimal de 64 caracteres esperado.`
    );
  }

  return str;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ensureArray(value, path) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path}: array esperado.`);
  }

  return value;
}

function readString(value, path, { allowEmpty }) {
  if (typeof value !== "string") {
    throw new TypeError(`${path}: string esperada.`);
  }

  if (!allowEmpty && value.trim() === "") {
    throw new TypeError(`${path}: string não vazia esperada.`);
  }

  return value;
}

function readNonNegativeInteger(value, path) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${path}: inteiro não negativo esperado.`);
  }

  return value;
}

function assertIndex(value, length, path) {
  if (!Number.isInteger(value) || value < 0 || value >= length) {
    throw new TypeError(`${path}: índice numérico fora do intervalo.`);
  }
}
