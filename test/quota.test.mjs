import test from "node:test";
import assert from "node:assert/strict";
import { estimateQuota, describeQuota } from "../assets/js/modules/quota.js";
import { decodeManifest } from "../assets/js/modules/data.js";
import { createYouTubeClient } from "../scripts/lib/youtube.mjs";

const quota = { used: 123, limit: 10000 };

test("cota: mesmo dia no fuso do Pacífico desconta o uso", () => {
  const e = estimateQuota(quota, "2026-11-03T15:00:00.000Z", new Date("2026-11-03T20:00:00.000Z"));
  assert.deepEqual(e, { remaining: 9877, limit: 10000, used: 123, renewed: false });
});

test("cota: dia anterior no Pacífico = cota renovada", () => {
  // 03/11 03:17 UTC ainda é 02/11 no Pacífico; 03/11 12:00 UTC já é 03/11 no Pacífico
  const e = estimateQuota(quota, "2026-11-03T03:17:00.000Z", new Date("2026-11-03T12:00:00.000Z"));
  assert.equal(e.renewed, true);
  assert.equal(e.remaining, 10000);
});

test("cota: sem dado ou data inválida não mostra nada; uso acima do limite satura", () => {
  assert.equal(describeQuota(null, "2026-11-03T00:00:00Z"), "");
  assert.equal(describeQuota(quota, "lixo"), "");
  assert.equal(estimateQuota({ used: 99999, limit: 10000 }, "2026-11-03T15:00:00Z", new Date("2026-11-03T16:00:00Z")).remaining, 0);
  assert.match(describeQuota(quota, "2026-11-03T15:00:00Z", new Date("2026-11-03T16:00:00Z")), /9877 de 10000/);
});

test("manifesto: q opcional é validado", () => {
  const base = { mv: 1, v: 1, g: "2026-01-01T00:00:00.000Z", mode: "empty", counts: { videos: 0, authors: 0, comments: 0 }, files: [], shards: [] };
  assert.equal(decodeManifest(base).quota, null);
  assert.deepEqual(decodeManifest({ ...base, q: { used: 5, limit: 10000 } }).quota, { used: 5, limit: 10000 });
  assert.throws(() => decodeManifest({ ...base, q: { used: -1, limit: 10000 } }), /manifest\.q/);
  assert.throws(() => decodeManifest({ ...base, q: "x" }), /manifest\.q/);
});

test("cliente: conta unidades de cota por chamada recebida, inclusive erros", async () => {
  let n = 0;
  const client = createYouTubeClient({
    apiKey: "AIzaSyDUMMYKEYDUMMYKEYDUMMYKEYDUMMYKEY12",
    retries: 2,
    retryBaseDelayMs: 0,
    sleep: async () => {},
    logger: { warn() {}, log() {} },
    fetchImpl: async () => {
      n += 1;
      const body = n === 1 ? { error: { code: 503, errors: [{ reason: "backendError" }] } } : { items: [] };
      return { ok: n !== 1, status: n === 1 ? 503 : 200, json: async () => body, text: async () => JSON.stringify(body) };
    }
  });
  assert.deepEqual(client.getUsage(), { units: 0 });
  await client.listVideos(["dQw4w9WgXcQ"]);
  assert.deepEqual(client.getUsage(), { units: 2 });
});
