import { resolve } from "node:path";
import { buildCompactDataset } from "../scripts/lib/compact.mjs";
import { createOutputBundle } from "../scripts/lib/output.mjs";
import { publishOutputs } from "../scripts/lib/publish.mjs";

/**
 * Gera dados 100% FICTÍCIOS em data/ para visualizar a interface sem chave de API.
 * Uso: npm run sample [-- --shards]
 * Para voltar aos dados reais, rode a coleta (npm run collect).
 */

const root = process.cwd();
const useShards = process.argv.includes("--shards");

const rng = mulberry32(20260101);
const pick = (list) => list[Math.floor(rng() * list.length)];

const AUTHORS = ["Ana Souza", "Bruno Lima", "Carla Dias", "Diego Rocha", "Elisa Prado", "Fábio Neves", "Gabi Torres", "Heitor Alves"];
const SUBJECTS = ["O café", "A trilha sonora", "O roteiro", "A edição", "Esse tutorial", "A explicação", "O final", "A câmera"];
const OPINIONS = [
  "ficou incrível, parabéns pelo trabalho",
  "poderia ter mais exemplos práticos",
  "me ajudou muito, obrigado por compartilhar",
  "está muito acima da média dos canais da área",
  "não achei tão claro, preciso rever com calma",
  "merece muito mais visualizações",
  "me lembrou das aulas de música da escola",
  "foi a melhor parte do vídeo, sem dúvida"
];
const EXTRAS = ["kkkk", "Já assisti três vezes!", "Quem mais está vendo em 2026?", "Aguardando o próximo vídeo.", ""];
const REPLIES = ["Concordo totalmente!", "Também achei, ótimo ponto.", "Verdade, não tinha pensado nisso.", "Obrigada pelo comentário!"];

const VIDEOS = [
  { id: "SAMPLE00001", title: "Exemplo fictício: aprendendo música do zero" },
  { id: "SAMPLE00002", title: "Exemplo fictício: o guia do café perfeito" },
  { id: "SAMPLE00003", title: "Exemplo fictício: bastidores da edição" }
];

const BASE_TIME = Math.floor(Date.parse("2026-03-01T12:00:00Z") / 1000);
let commentId = 0;

function makeComment(parentId, time) {
  const author = pick(AUTHORS);
  commentId += 1;

  const text = parentId
    ? pick(REPLIES)
    : `${pick(SUBJECTS)} ${pick(OPINIONS)}. ${pick(EXTRAS)}`.trim();

  return {
    id: `sample-${commentId}`,
    parentId,
    text,
    publishedAt: time,
    likeCount: Math.floor(rng() * rng() * 60),
    authorId: `UCsample${AUTHORS.indexOf(author)}`,
    authorName: author
  };
}

const videoResults = VIDEOS.map((video, videoIndex) => {
  const groups = [];

  for (let i = 0; i < 120; i += 1) {
    const time = BASE_TIME + videoIndex * 86400 * 3 + i * 5400;
    const top = makeComment(null, time);
    const replies = [];

    if (rng() < 0.3) {
      replies.push(makeComment(top.id, time + 600));
    }

    groups.push({ top, replies });
  }

  return {
    videoId: video.id,
    status: "ok",
    meta: {
      id: video.id,
      title: video.title,
      channelTitle: "Canal Fictício",
      publishedAt: BASE_TIME - 86400 * 5
    },
    groups
  };
});

const dataset = buildCompactDataset(videoResults, new Date("2026-03-15T12:00:00Z"));

const bundle = createOutputBundle(dataset, {
  forceShards: useShards,
  maxFullCompressedBytes: 307200,
  maxShardCompressedBytes: 204800
});

await publishOutputs({ root: resolve(root), manifest: bundle.manifest, files: bundle.files });

console.log(
  `Dados de exemplo (fictícios) publicados em data/: modo=${bundle.manifest.mode}, ` +
  `${dataset.videos.length} vídeos, ${dataset.comments.length} comentários.`
);
console.log("Para voltar aos dados reais, configure config/collection.json e rode `npm run collect`.");

function mulberry32(seed) {
  let a = seed;

  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
