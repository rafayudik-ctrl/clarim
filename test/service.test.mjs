import test from "node:test";
import assert from "node:assert/strict";
import { buildCompactDataset } from "../scripts/lib/compact.mjs";
import { createOutputBundle } from "../scripts/lib/output.mjs";
import { createQueryService } from "../assets/js/modules/query-service.js";

const BASE = "https://exemplo.test/app/";

function makeDataset(videoCount = 2, perVideo = 20) {
  const results = [];

  for (let v = 0; v < videoCount; v += 1) {
    const groups = [];

    for (let i = 0; i < perVideo; i += 1) {
      groups.push({
        top: {
          id: `v${v}c${i}`,
          parentId: null,
          text: i % 2 === 0 ? `Adorei o café número ${i}` : `Gostei do pão número ${i}`,
          publishedAt: 1_700_000_000 + i * 60,
          likeCount: i,
          authorId: `UC${i % 4}`,
          authorName: `Autor ${i % 4}`
        },
        replies: []
      });
    }

    results.push({
      videoId: `VIDEO${v}AAAAA`,
      status: "ok",
      meta: { id: `VIDEO${v}AAAAA`, title: `Vídeo ${v}`, channelTitle: "Canal", publishedAt: 0 },
      groups
    });
  }

  return buildCompactDataset(results, new Date("2025-01-01T00:00:00.000Z"));
}

function makeFetch(files, { failPath } = {}) {
  const calls = [];

  const fetchImpl = async (url) => {
    const { pathname } = new URL(url);
    const key = pathname.replace(/^\/app\//, "");
    calls.push(key);

    if (failPath && key === failPath) {
      return { ok: false, status: 500, json: async () => ({}) };
    }

    if (!(key in files)) return { ok: false, status: 404, json: async () => ({}) };

    return { ok: true, status: 200, json: async () => JSON.parse(files[key]) };
  };

  return { fetchImpl, calls };
}

function filesFor(bundle, extra = {}) {
  const files = { "data/manifest.json": JSON.stringify(bundle.manifest), ...extra };
  for (const file of bundle.files) files[file.path] = file.content;
  return files;
}

const CONFIG = { forceShards: false, maxFullCompressedBytes: 1e6, maxShardCompressedBytes: 1e6 };

test("modo full: carrega, filtra, pagina e exporta", async () => {
  const dataset = makeDataset(2, 20);
  const bundle = createOutputBundle(dataset, CONFIG);
  const { fetchImpl } = makeFetch(
    filesFor(bundle, { "assets/stopwords.json": JSON.stringify({ pt: ["número"] }) })
  );
  const progress = [];
  const service = createQueryService({ fetchImpl, onProgress: (p) => progress.push(p) });

  const info = await service.handle("init", { base: BASE });

  assert.equal(info.mode, "full");
  assert.equal(info.counts.comments, 40);
  assert.equal(info.videos.length, 2);
  assert.ok(progress.some((p) => p.phase === "data" && p.done === 1));

  const result = await service.handle("filter", { keywords: ["cafe"], sort: "oldest" });

  assert.equal(result.total, 20);
  assert.ok(!result.wordcloud.some((item) => item.word === "número")); // stopword do JSON por idioma
  assert.ok(result.wordcloud.some((item) => item.word === "café"));

  const page = await service.handle("page", { offset: 10, limit: 5, key: result.key });
  assert.equal(page.page.length, 5);

  const text = await service.handle("export", { key: result.key });
  assert.equal(text.split("\n\n\n\n").length, 20);
});

test("modo sharded: carrega todos os shards na ordem do manifesto", async () => {
  const dataset = makeDataset(3, 40);
  const bundle = createOutputBundle(dataset, { ...CONFIG, forceShards: true, maxShardCompressedBytes: 300 });

  assert.ok(bundle.manifest.shards.length > 3);
  assert.ok(bundle.manifest.shards.every((shard) => shard.gzipBytes <= 300));

  const { fetchImpl, calls } = makeFetch(filesFor(bundle));
  const service = createQueryService({ fetchImpl, concurrency: 2 });
  const info = await service.handle("init", { base: BASE });

  assert.equal(info.mode, "sharded");
  assert.equal(info.counts.comments, 120);
  assert.equal((await service.handle("filter", {})).total, 120);
  assert.equal(calls.filter((c) => c.startsWith("data/shards/")).length, bundle.manifest.shards.length);
});

test("modo empty: não baixa dados", async () => {
  const empty = buildCompactDataset([], new Date("2025-01-01T00:00:00.000Z"));
  const bundle = createOutputBundle(empty, CONFIG);
  const { fetchImpl, calls } = makeFetch(filesFor(bundle));
  const service = createQueryService({ fetchImpl });
  const info = await service.handle("init", { base: BASE });

  assert.equal(info.mode, "empty");
  assert.equal(info.counts.comments, 0);
  assert.equal(calls.filter((c) => c.startsWith("data/datasets/")).length, 0);
});

test("falha de rede em um shard rejeita o init", async () => {
  const bundle = createOutputBundle(makeDataset(2, 30), {
    ...CONFIG,
    forceShards: true,
    maxShardCompressedBytes: 700
  });
  const failPath = bundle.manifest.shards[1].path;
  const { fetchImpl } = makeFetch(filesFor(bundle), { failPath });
  const service = createQueryService({ fetchImpl });

  await assert.rejects(service.handle("init", { base: BASE }), /HTTP 500/);
  await assert.rejects(service.handle("filter", {}), /não carregados/);
});

test("contagens divergentes do manifesto são recusadas", async () => {
  const bundle = createOutputBundle(makeDataset(1, 10), CONFIG);
  const manifest = JSON.parse(JSON.stringify(bundle.manifest));

  manifest.counts.comments += 1;

  const { fetchImpl } = makeFetch({
    ...filesFor(bundle),
    "data/manifest.json": JSON.stringify(manifest)
  });
  const service = createQueryService({ fetchImpl });

  await assert.rejects(service.handle("init", { base: BASE }), /divergem/);
});

test("stopwords ausentes usam a lista embutida e não quebram", async () => {
  const bundle = createOutputBundle(makeDataset(1, 10), CONFIG);
  const { fetchImpl } = makeFetch(filesFor(bundle));
  const service = createQueryService({ fetchImpl });

  await service.handle("init", { base: BASE });
  assert.equal((await service.handle("filter", {})).total, 10);
});

test("mensagem desconhecida e uso antes do init", async () => {
  const service = createQueryService({ fetchImpl: async () => ({ ok: false, status: 404 }) });

  await assert.rejects(service.handle("filter", {}), /não carregados/);
});
