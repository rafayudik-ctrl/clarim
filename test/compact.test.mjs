import test from "node:test";
import assert from "node:assert/strict";
import { buildCompactDataset } from "../scripts/lib/compact.mjs";
import { contentHash, createOutputBundle } from "../scripts/lib/output.mjs";
import { mergeRawDatasets } from "../assets/js/modules/query-engine.js";
import { decodeCompactDataset, decodeManifest } from "../assets/js/modules/data.js";

const BASE_CONFIG = {
  forceShards: false,
  maxFullCompressedBytes: 1_000_000,
  maxShardCompressedBytes: 1_000_000
};

function comment(id, overrides = {}) {
  return {
    id,
    parentId: null,
    text: `Texto ${id}`,
    publishedAt: 1_700_000_000,
    likeCount: 1,
    authorId: "UC12345678901234567890",
    authorName: "Ana",
    ...overrides
  };
}

function videoResult(id, groups, meta = {}) {
  return {
    videoId: id,
    status: "ok",
    meta: {
      id,
      title: `Vídeo ${id}`,
      channelTitle: "Canal",
      publishedAt: 1_690_000_000,
      ...meta
    },
    groups
  };
}

const FIXED_DATE = new Date("2025-01-01T00:00:00.000Z");

test("compacta, preserva texto e valida parentesco", () => {
  const dataset = buildCompactDataset(
    [
      videoResult("dQw4w9WgXcQ", [
        {
          top: comment("c1", { text: "<b>Olá</b> & teste" }),
          replies: [comment("c2", { parentId: "c1", publishedAt: 1_700_000_100 })]
        }
      ])
    ],
    FIXED_DATE
  );

  assert.equal(dataset.videos.length, 1);
  assert.equal(dataset.authors.length, 1);
  assert.equal(dataset.comments.length, 2);
  assert.equal(dataset.comments[0][4], "<b>Olá</b> & teste");
  assert.equal(dataset.comments[1][5], 0);
  decodeCompactDataset(dataset);
});

test("modo full gera arquivo hasheado e manifesto full", () => {
  const dataset = buildCompactDataset(
    [videoResult("dQw4w9WgXcQ", [{ top: comment("c1"), replies: [] }])],
    FIXED_DATE
  );

  const bundle = createOutputBundle(dataset, BASE_CONFIG);

  assert.equal(bundle.manifest.mode, "full");
  assert.equal(bundle.manifest.files.length, 1);
  assert.equal(bundle.files.length, 1);
  assert.match(bundle.manifest.files[0].path, /^data\/datasets\/[a-f0-9]{16}\.json$/);
  assert.match(bundle.manifest.ch, /^[a-f0-9]{64}$/);

  decodeManifest(bundle.manifest);
  decodeCompactDataset(JSON.parse(bundle.files[0].content));
});

test("hash de conteúdo ignora a data de geração", () => {
  const groups = [{ top: comment("c1"), replies: [] }];
  const a = buildCompactDataset([videoResult("dQw4w9WgXcQ", groups)], FIXED_DATE);
  const b = buildCompactDataset(
    [videoResult("dQw4w9WgXcQ", groups)],
    new Date("2026-06-01T00:00:00.000Z")
  );
  const c = buildCompactDataset(
    [videoResult("dQw4w9WgXcQ", [{ top: comment("c1", { text: "outro" }), replies: [] }])],
    FIXED_DATE
  );

  assert.equal(contentHash(a), contentHash(b));
  assert.notEqual(contentHash(a), contentHash(c));
});

test("forceShards gera shards válidos e contagem global", () => {
  const groups = [0, 1, 2].map((i) => ({
    top: comment(`top${i}`, { authorId: `UC${i}` }),
    replies: []
  }));

  const dataset = buildCompactDataset([videoResult("dQw4w9WgXcQ", groups)], FIXED_DATE);
  const bundle = createOutputBundle(dataset, { ...BASE_CONFIG, forceShards: true });

  assert.equal(bundle.manifest.mode, "sharded");
  assert.equal(bundle.manifest.shards.length, 1);
  assert.equal(bundle.manifest.counts.comments, dataset.comments.length);

  decodeManifest(bundle.manifest);
  assert.equal(decodeCompactDataset(JSON.parse(bundle.files[0].content)).comments.length, 3);
});

function bigDataset(videoCount = 1, perVideo = 80) {
  const results = [];

  for (let v = 0; v < videoCount; v += 1) {
    const groups = [];

    for (let i = 0; i < perVideo; i += 1) {
      const topId = `v${v}top${i}`;
      groups.push({
        top: comment(topId, {
          text: `${"x".repeat(200)} ${i} ${(i * 7919) % 1013}`,
          authorId: `UC${i % 9}`,
          authorName: `Autor ${i % 9}`
        }),
        replies: [
          comment(`v${v}reply${i}a`, {
            parentId: topId,
            text: `${"y".repeat(200)} ${i} ${(i * 104729) % 997}`
          }),
          comment(`v${v}reply${i}b`, {
            parentId: topId,
            text: `${"z".repeat(200)} ${i} ${(i * 1299709) % 991}`
          })
        ]
      });
    }

    results.push(videoResult(`VIDEO${String(v).padStart(6, "0")}`, groups));
  }

  return buildCompactDataset(results, FIXED_DATE);
}

test("split mantém grupos inteiros e parentesco dentro de cada shard", () => {
  const dataset = bigDataset(1, 80);

  const bundle = createOutputBundle(dataset, {
    ...BASE_CONFIG,
    forceShards: true,
    maxShardCompressedBytes: 900
  });

  assert.equal(bundle.manifest.mode, "sharded");
  assert.ok(bundle.manifest.shards.length > 1);
  assert.equal(
    bundle.manifest.shards.reduce((sum, shard) => sum + shard.counts.comments, 0),
    dataset.comments.length
  );

  for (const file of bundle.files) {
    const decoded = decodeCompactDataset(JSON.parse(file.content));

    for (const row of decoded.comments) {
      if (row.parentIndex !== -1) {
        assert.ok(row.parentIndex < row.index);
        // resposta e raiz sempre na mesma parte
        assert.equal(decoded.comments[row.parentIndex].parentIndex, -1);
      }
    }
  }

  decodeManifest(bundle.manifest);
});

test("shards + merge reproduzem o dataset original", () => {
  const dataset = bigDataset(3, 30);

  const bundle = createOutputBundle(dataset, {
    ...BASE_CONFIG,
    forceShards: true,
    maxShardCompressedBytes: 1500
  });

  const merged = mergeRawDatasets(bundle.files.map((file) => JSON.parse(file.content)));

  assert.equal(merged.videos.length, dataset.videos.length);
  assert.equal(merged.authors.length, dataset.authors.length);
  assert.equal(merged.comments.length, dataset.comments.length);

  const signature = (data) =>
    data.comments
      .map((row) => {
        const parent = row[5] >= 0 ? data.comments[row[5]][4] : "";
        return [
          data.videos[row[0]][0],
          data.authors[row[1]][1],
          row[2],
          row[3],
          row[4],
          parent
        ].join("|");
      })
      .sort();

  assert.deepEqual(signature(merged), signature(dataset));
  decodeCompactDataset({ v: 1, g: dataset.g, ...merged });
});

test("manifesto rejeita caminho inseguro", () => {
  assert.throws(() =>
    decodeManifest({
      mv: 1,
      v: 1,
      g: "2025-01-01T00:00:00.000Z",
      mode: "full",
      counts: { videos: 0, authors: 0, comments: 0 },
      files: [
        {
          path: "data/../secret.json",
          sha256: "a".repeat(64),
          bytes: 1,
          gzipBytes: 1
        }
      ],
      shards: []
    })
  );
});

test("compactação é determinística", () => {
  const make = () =>
    buildCompactDataset(
      [videoResult("dQw4w9WgXcQ", [{ top: comment("c1"), replies: [] }])],
      FIXED_DATE
    );

  assert.equal(JSON.stringify(make()), JSON.stringify(make()));
});
