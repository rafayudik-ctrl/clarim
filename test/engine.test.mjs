import test from "node:test";
import assert from "node:assert/strict";
import {
  createEngine,
  mergeRawDatasets,
  normalizeQuery,
  normalizeText,
  parseStopwords
} from "../assets/js/modules/query-engine.js";

const DAY = 86400;
const T0 = 1_700_000_000;

function makeEngine(extra = {}) {
  const engine = createEngine({ stopwords: ["que", "para", "the", "and"], ...extra });

  engine.setData({
    videos: [
      ["AAAAAAAAAAA", "Vídeo A", "Canal", 0],
      ["BBBBBBBBBBB", "Vídeo B", "Canal", 0]
    ],
    authors: [
      ["U1", "Ana"],
      ["U2", "João Silva"]
    ],
    comments: [
      [0, 0, 5, T0, "Adorei o café da manhã!", -1],
      [0, 1, 10, T0 + DAY, "CAFÉ é ótimo, mas o pão não", -1],
      [1, 1, 0, T0 + 2 * DAY, "Resposta sobre pão de queijo https://x.com/a @Ana kkkkk", -1],
      [1, 0, 2, T0 + 3 * DAY, "The coffee and the bread are great", 2]
    ]
  });

  return engine;
}

test("normalizeText remove acentos e caixa", () => {
  assert.equal(normalizeText("CAFÉ Açaí"), "cafe acai");
});

test("busca ignora acentos e caixa", () => {
  const engine = makeEngine();
  const result = engine.filter({ keywords: ["cafe"] });

  assert.equal(result.total, 2);
});

test("modo any × all", () => {
  const engine = makeEngine();

  assert.equal(engine.filter({ keywords: ["cafe", "pao"], mode: "any" }).total, 3);
  assert.equal(engine.filter({ keywords: ["cafe", "pao"], mode: "all" }).total, 1);
});

test("sem palavras-chave retorna tudo", () => {
  assert.equal(makeEngine().filter({}).total, 4);
});

test("filtros de vídeo, autor e período", () => {
  const engine = makeEngine();

  assert.equal(engine.filter({ video: "BBBBBBBBBBB" }).total, 2);
  assert.equal(engine.filter({ video: "ZZZZZZZZZZZ" }).total, 0);
  assert.equal(engine.filter({ author: "joao" }).total, 2);
  assert.equal(engine.filter({ from: T0 + DAY, to: T0 + 2 * DAY }).total, 2);
  assert.equal(engine.filter({ from: T0 + 10 * DAY }).total, 0);
});

test("ordenação: recentes, antigos e curtidos", () => {
  const engine = makeEngine();

  const dates = (sort) =>
    engine.filter({ sort }).page.map((item) => item.date);

  assert.deepEqual(dates("recent"), [T0 + 3 * DAY, T0 + 2 * DAY, T0 + DAY, T0]);
  assert.deepEqual(dates("oldest"), [T0, T0 + DAY, T0 + 2 * DAY, T0 + 3 * DAY]);
  assert.deepEqual(
    engine.filter({ sort: "likes" }).page.map((item) => item.likes),
    [10, 5, 2, 0]
  );
});

test("paginação por offset", () => {
  const engine = makeEngine();
  const first = engine.filter({ sort: "oldest" }, { pageSize: 2 });

  assert.equal(first.page.length, 2);

  const second = engine.getPage(2, 2, first.key);

  assert.equal(second.page.length, 2);
  assert.equal(second.total, 4);
  assert.equal(second.page[0].date, T0 + 2 * DAY);
});

test("resposta é marcada como reply", () => {
  const items = makeEngine().filter({ sort: "oldest" }).page;

  assert.equal(items[3].reply, true);
  assert.equal(items[0].reply, false);
});

test("nuvem ignora stopwords, links, menções, risadas e palavras curtas", () => {
  const engine = makeEngine();
  const words = engine.filter({}).wordcloud.map((item) => item.word);

  assert.ok(words.includes("café") || words.includes("cafe"));
  assert.ok(words.includes("pão") || words.includes("pao"));
  assert.ok(!words.includes("the"));
  assert.ok(!words.includes("and"));
  assert.ok(!words.includes("kkkkk"));
  assert.ok(!words.includes("ana")); // menção removida
  assert.ok(!words.includes("https"));
  assert.ok(!words.some((word) => word.length < 3));
});

test("nuvem mantém a forma acentuada e agrupa variantes", () => {
  const engine = makeEngine();
  const cloud = engine.filter({ keywords: ["cafe"] }).wordcloud;
  const entry = cloud.find((item) => normalizeText(item.word) === "cafe");

  assert.ok(entry);
  assert.equal(entry.count, 2);
  assert.equal(entry.word, "café");
});

test("voltar a um filtro em cache restaura o conjunto ativo (regressão)", () => {
  const engine = makeEngine();

  const a = engine.filter({ keywords: ["cafe"], sort: "oldest" });
  const b = engine.filter({ keywords: ["pao"], sort: "oldest" });
  const again = engine.filter({ keywords: ["cafe"], sort: "oldest" });

  assert.equal(again.key, a.key);
  assert.notEqual(a.key, b.key);

  const page = engine.getPage(0, 10);
  assert.equal(page.total, a.total);

  const exported = engine.exportText();
  assert.equal(exported.split("\n\n\n\n").length, a.total);
});

test("página e exportação por chave obsoleta falham com code=stale", () => {
  const engine = makeEngine({ cacheSize: 1 });
  const a = engine.filter({ keywords: ["cafe"] });

  engine.filter({ keywords: ["pao"] }); // expulsa o filtro A do cache

  assert.throws(() => engine.getPage(0, 10, a.key), { code: "stale" });
  assert.throws(() => engine.exportText(a.key), { code: "stale" });
});

test("exportação: formato e três linhas em branco entre comentários", () => {
  const engine = makeEngine();

  engine.filter({ keywords: ["cafe"], sort: "oldest" });

  const text = engine.exportText();
  const blocks = text.split("\n\n\n\n");

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0], `Ana (Vídeo A, ${new Date(T0 * 1000).toISOString().slice(0, 10)})\nAdorei o café da manhã!`);
  assert.ok(!text.endsWith("\n"));
});

test("exportação sem resultados é vazia", () => {
  const engine = makeEngine();

  engine.filter({ keywords: ["inexistente"] });
  assert.equal(engine.exportText(), "");
});

test("normalizeQuery limita e deduplica palavras-chave", () => {
  const many = Array.from({ length: 30 }, (_, i) => `palavra${i}`);
  const q = normalizeQuery({ keywords: ["Café", "cafe", "  ", ...many], mode: "x", sort: "?" });

  assert.equal(q.keywords.length, 12);
  assert.equal(q.keywords[0], "cafe");
  assert.equal(q.mode, "any");
  assert.equal(q.sort, "recent");
});

test("parseStopwords aceita lista e objeto por idioma", () => {
  assert.deepEqual(parseStopwords(["a", "b"]), ["a", "b"]);
  assert.deepEqual(parseStopwords({ pt: ["a"], en: ["b", 3] }), ["a", "b"]);
  assert.deepEqual(parseStopwords(null), []);
});

test("mergeRawDatasets deduplica vídeos/autores e remapeia pais", () => {
  const first = {
    videos: [["AAAAAAAAAAA", "A", "", 0]],
    authors: [["U1", "Ana"]],
    comments: [
      [0, 0, 0, 1, "raiz", -1],
      [0, 0, 0, 2, "resposta", 0]
    ]
  };
  const second = {
    videos: [["AAAAAAAAAAA", "A", "", 0], ["BBBBBBBBBBB", "B", "", 0]],
    authors: [["", "Sem id"], ["U1", "Ana"]],
    comments: [
      [1, 0, 0, 3, "outra raiz", -1],
      [1, 1, 0, 4, "outra resposta", 0]
    ]
  };

  const merged = mergeRawDatasets([first, second]);

  assert.equal(merged.videos.length, 2);
  assert.equal(merged.authors.length, 2);
  assert.deepEqual(merged.comments[1].slice(5), [0]);
  assert.deepEqual(merged.comments[3].slice(5), [2]);
  assert.equal(merged.comments[3][1], 0); // Ana reaproveitada
});
