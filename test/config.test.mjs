import test from "node:test";
import assert from "node:assert/strict";
import { extractVideoId, validateConfig } from "../scripts/lib/config.mjs";

test("rejeita vídeos vazios", () => {
  assert.throws(() => validateConfig({ videos: [] }), /ao menos um vídeo/);
});

test("rejeita ID inválido", () => {
  assert.throws(() => validateConfig({ videos: ["curto"] }), /ID inválido/);
});

test("normaliza limites e remove duplicados", () => {
  const config = validateConfig({
    videos: ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    pageSize: 50,
    maxCommentsPerVideo: 10
  });

  assert.deepEqual(config.videos, ["dQw4w9WgXcQ"]);
  assert.equal(config.pageSize, 50);
  assert.equal(config.maxCommentsPerVideo, 10);
  assert.equal(config.maxPagesPerVideo, 10);
  assert.equal(config.allowPartial, false);
});

test("aceita URLs do YouTube e extrai o ID", () => {
  const id = "dQw4w9WgXcQ";

  assert.equal(extractVideoId(id), id);
  assert.equal(extractVideoId(`https://www.youtube.com/watch?v=${id}&t=3s`), id);
  assert.equal(extractVideoId(`https://youtu.be/${id}?si=abc`), id);
  assert.equal(extractVideoId(`youtube.com/shorts/${id}`), id);
  assert.equal(extractVideoId(`https://m.youtube.com/embed/${id}`), id);
  assert.equal(extractVideoId("https://exemplo.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(extractVideoId("curto"), null);
  assert.equal(extractVideoId(42), null);

  const config = validateConfig({ videos: [`https://youtu.be/${id}`, id] });
  assert.deepEqual(config.videos, [id]);
});

test("rejeita limites fora do intervalo", () => {
  assert.throws(
    () => validateConfig({ videos: ["dQw4w9WgXcQ"], pageSize: 500 }),
    /pageSize/
  );
});

test("minCommentChars: padrão 0, aceita valor e rejeita inválido", () => {
  const base = { videos: ["dQw4w9WgXcQ"] };
  assert.equal(validateConfig(base).minCommentChars, 0);
  assert.equal(validateConfig({ ...base, minCommentChars: 80 }).minCommentChars, 80);
  assert.throws(() => validateConfig({ ...base, minCommentChars: -1 }), /minCommentChars/);
  assert.throws(() => validateConfig({ ...base, minCommentChars: "50" }), /minCommentChars/);
});
