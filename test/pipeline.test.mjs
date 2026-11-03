import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createYouTubeClient, YouTubeApiError } from "../scripts/lib/youtube.mjs";
import { collectConfiguredVideos } from "../scripts/lib/collector.mjs";
import { buildCompactDataset } from "../scripts/lib/compact.mjs";
import { createOutputBundle } from "../scripts/lib/output.mjs";
import { publishOutputs } from "../scripts/lib/publish.mjs";
import { validateArtifact } from "../scripts/validate-artifact.mjs";

const KEY = "AIzaSyDUMMYKEYDUMMYKEYDUMMYKEYDUMMYKEY12";
const silent = { warn() {}, log() {} };

function jsonResponse(status, body) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => text };
}

function apiError(status, reason, message = "erro") {
  return jsonResponse(status, { error: { code: status, message, errors: [{ reason }] } });
}

test("cliente: retry com backoff em 503 e sucesso depois", async () => {
  const sleeps = [];
  let calls = 0;

  const client = createYouTubeClient({
    apiKey: KEY,
    retries: 3,
    retryBaseDelayMs: 10,
    sleep: async (ms) => sleeps.push(ms),
    logger: silent,
    fetchImpl: async () => {
      calls += 1;
      return calls < 3 ? apiError(503, "backendError") : jsonResponse(200, { items: [] });
    }
  });

  await client.listVideos(["dQw4w9WgXcQ"]);

  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [10, 20]);
});

test("cliente: cota excedida é fatal, sem retry, e a chave não vaza", async () => {
  let calls = 0;

  const client = createYouTubeClient({
    apiKey: KEY,
    logger: silent,
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return apiError(403, "quotaExceeded", `cota estourada para key=${KEY}`);
    }
  });

  await assert.rejects(client.listVideos(["dQw4w9WgXcQ"]), (error) => {
    assert.ok(error instanceof YouTubeApiError);
    assert.equal(error.fatal, true);
    assert.ok(!error.message.includes(KEY));
    return true;
  });
  assert.equal(calls, 1);
});

test("cliente: erro de rede esgota as tentativas", async () => {
  let calls = 0;

  const client = createYouTubeClient({
    apiKey: KEY,
    retries: 2,
    logger: silent,
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      throw new Error(`falha em https://x?key=${KEY}`);
    }
  });

  await assert.rejects(client.listVideos(["dQw4w9WgXcQ"]), (error) => {
    assert.ok(!error.message.includes(KEY));
    return true;
  });
  assert.equal(calls, 3);
});

function fakeClient({ videos, threads }) {
  return {
    listVideos: async () => new Map(videos.map((v) => [v.id, v])),
    listCommentThreads: async (videoId, options) => {
      const handler = threads[videoId];
      if (handler instanceof Error) throw handler;
      return handler(options);
    }
  };
}

function thread(id, text, time, replies = []) {
  return {
    snippet: {
      topLevelComment: {
        id,
        snippet: {
          textOriginal: text,
          publishedAt: new Date(time * 1000).toISOString(),
          likeCount: 3,
          authorDisplayName: "Ana",
          authorChannelId: { value: "UCana" }
        }
      }
    },
    replies: {
      comments: replies.map((r) => ({
        id: r.id,
        snippet: {
          textOriginal: r.text,
          publishedAt: new Date((time + 10) * 1000).toISOString(),
          likeCount: 0,
          authorDisplayName: "Bruno"
        }
      }))
    }
  };
}

const BASE_CONFIG = {
  videos: ["AAAAAAAAAAA", "BBBBBBBBBBB", "CCCCCCCCCCC", "DDDDDDDDDDD"],
  maxCommentsPerVideo: 100,
  maxPagesPerVideo: 5,
  pageSize: 100,
  includeReplies: true
};

test("coletor: pagina, ordena e trata vídeos indisponíveis", async () => {
  const meta = (id) => ({ id, title: `T ${id}`, channelTitle: "C", publishedAt: 1 });

  const client = fakeClient({
    videos: [meta("AAAAAAAAAAA"), meta("BBBBBBBBBBB"), meta("CCCCCCCCCCC")],
    threads: {
      AAAAAAAAAAA: (options) =>
        options.pageToken
          ? { items: [thread("a2", "primeiro", 100)] }
          : {
              items: [thread("a1", "segundo", 200, [{ id: "r1", text: "resp" }])],
              nextPageToken: "p2"
            },
      BBBBBBBBBBB: new YouTubeApiError("desabilitado", { status: 403, reason: "commentsDisabled" }),
      CCCCCCCCCCC: new YouTubeApiError("boom", { status: 500, reason: "backendError", retryable: true })
    }
  });

  const { videoResults, warnings } = await collectConfiguredVideos({ client, config: BASE_CONFIG });
  const status = Object.fromEntries(videoResults.map((r) => [r.videoId, r.status]));

  assert.deepEqual(status, {
    AAAAAAAAAAA: "ok",
    BBBBBBBBBBB: "commentsDisabled",
    CCCCCCCCCCC: "failed",
    DDDDDDDDDDD: "videoNotFound"
  });
  assert.equal(warnings.length, 3);

  const ok = videoResults[0];
  assert.deepEqual(ok.groups.map((g) => g.top.id), ["a2", "a1"]); // por data
  assert.equal(ok.groups[1].replies.length, 1);

  const dataset = buildCompactDataset(videoResults, new Date("2025-01-01T00:00:00.000Z"));
  assert.equal(dataset.comments.length, 3);
});

test("coletor: erro fatal propaga e limites de comentários são respeitados", async () => {
  const meta = { id: "AAAAAAAAAAA", title: "T", channelTitle: "C", publishedAt: 1 };

  await assert.rejects(
    collectConfiguredVideos({
      config: BASE_CONFIG,
      client: fakeClient({
        videos: [meta],
        threads: {
          AAAAAAAAAAA: new YouTubeApiError("cota", { status: 403, reason: "quotaExceeded", fatal: true })
        }
      })
    }),
    /cota/
  );

  const many = Array.from({ length: 50 }, (_, i) => thread(`c${i}`, `t${i}`, i));
  const { videoResults } = await collectConfiguredVideos({
    config: { ...BASE_CONFIG, videos: ["AAAAAAAAAAA"], maxCommentsPerVideo: 10 },
    client: fakeClient({ videos: [meta], threads: { AAAAAAAAAAA: () => ({ items: many }) } })
  });

  assert.equal(videoResults[0].groups.length, 10);
});

test("coletor: minCommentChars filtra comentários curtos e promove respostas longas", async () => {
  const meta = { id: "AAAAAAAAAAA", title: "T", channelTitle: "C", publishedAt: 1 };
  const longText = "x".repeat(20);
  const items = [
    thread("curto", "oi", 1),
    thread("longo", longText, 2, [{ id: "r-curta", text: "ok" }, { id: "r-longa", text: longText }]),
    thread("curto2", "tchau", 3, [{ id: "r-promovida", text: longText }]),
    thread("emoji", "😀".repeat(19), 4)
  ];

  const { videoResults } = await collectConfiguredVideos({
    config: { ...BASE_CONFIG, videos: ["AAAAAAAAAAA"], minCommentChars: 20 },
    client: fakeClient({ videos: [meta], threads: { AAAAAAAAAAA: () => ({ items }) } })
  });

  const groups = videoResults[0].groups;
  assert.deepEqual(groups.map((g) => g.top.id), ["longo", "r-promovida"]);
  assert.deepEqual(groups[0].replies.map((r) => r.id), ["r-longa"]);
  assert.equal(groups[1].top.parentId, null);

  const dataset = buildCompactDataset(videoResults, new Date("2025-01-01T00:00:00.000Z"));
  assert.equal(dataset.comments.length, 3);
  assert.ok(dataset.comments.every((c) => [...c[4]].length >= 20));
});

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "clarim-test-"));
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(join(root, "data/manifest.json"), "{}");
  await writeFile(join(root, "data/velho.json"), "{}");
  return root;
}

function sampleBundle(forceShards = false, text = "Olá mundo") {
  const dataset = buildCompactDataset(
    [
      {
        videoId: "AAAAAAAAAAA",
        status: "ok",
        meta: { id: "AAAAAAAAAAA", title: "Título", channelTitle: "Canal", publishedAt: 1 },
        groups: [
          {
            top: {
              id: "c1",
              parentId: null,
              text,
              publishedAt: 10,
              likeCount: 1,
              authorId: "UC1",
              authorName: "Ana"
            },
            replies: []
          }
        ]
      }
    ],
    new Date("2025-01-01T00:00:00.000Z")
  );

  return createOutputBundle(dataset, {
    forceShards,
    maxFullCompressedBytes: 1e6,
    maxShardCompressedBytes: 1e6
  });
}

test("publish: troca data/ por completo e remove arquivos antigos", async () => {
  const root = await makeRoot();

  try {
    const bundle = sampleBundle();
    await publishOutputs({ root, manifest: bundle.manifest, files: bundle.files });

    const names = await readdir(join(root, "data"));
    assert.ok(names.includes("manifest.json"));
    assert.ok(!names.includes("velho.json"));

    const leftovers = (await readdir(root)).filter((n) => n.startsWith(".data-"));
    assert.deepEqual(leftovers, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publish: caminho inseguro falha e preserva a versão anterior", async () => {
  const root = await makeRoot();

  try {
    const bundle = sampleBundle();

    await assert.rejects(
      publishOutputs({
        root,
        manifest: bundle.manifest,
        files: [{ path: "data/../evil.json", content: "x" }]
      }),
      /inseguro|inválido/
    );

    assert.equal(await readFile(join(root, "data/velho.json"), "utf8"), "{}");
    assert.deepEqual((await readdir(root)).filter((n) => n.startsWith(".data-")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validate-artifact: aceita full e sharded, recusa adulteração e chave", async () => {
  for (const sharded of [false, true]) {
    const root = await makeRoot();

    try {
      const bundle = sampleBundle(sharded);
      await publishOutputs({ root, manifest: bundle.manifest, files: bundle.files });

      const result = await validateArtifact({ root });
      assert.equal(result.mode, sharded ? "sharded" : "full");

      // adulteração do conteúdo
      const file = join(root, bundle.files[0].path);
      const original = await readFile(file, "utf8");
      await writeFile(file, original.replace("Olá", "Oi!"));
      await assert.rejects(validateArtifact({ root }), /sha256 divergente/);
      await writeFile(file, original);

      // arquivo órfão
      await writeFile(join(root, "data/orfao.json"), "{}");
      await assert.rejects(validateArtifact({ root }), /não referenciado/);
      await rm(join(root, "data/orfao.json"));

      // chave de API no artefato
      await assert.rejects(validateArtifact({ root, apiKey: "Olá mundo" }), /chave da API/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("validate-artifact: recusa URL de imagem em título de vídeo", async () => {
  const root = await makeRoot();

  try {
    const dataset = buildCompactDataset(
      [
        {
          videoId: "AAAAAAAAAAA",
          status: "ok",
          meta: {
            id: "AAAAAAAAAAA",
            title: "veja https://i.ytimg.com/vi/x/hq.jpg",
            channelTitle: "Canal",
            publishedAt: 1
          },
          groups: []
        }
      ],
      new Date("2025-01-01T00:00:00.000Z")
    );
    const bundle = createOutputBundle(dataset, {
      forceShards: false,
      maxFullCompressedBytes: 1e6,
      maxShardCompressedBytes: 1e6
    });

    await publishOutputs({ root, manifest: bundle.manifest, files: bundle.files });
    await assert.rejects(validateArtifact({ root }), /URL de imagem/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
