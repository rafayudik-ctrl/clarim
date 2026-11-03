import {
  clearComments,
  fillVideoSelect,
  formatNumber,
  initUI,
  renderChips,
  renderCloud,
  renderComments,
  setExportBusy,
  setFiltersEnabled,
  setHint,
  setMoreBusy,
  setResultCount,
  setResultsState,
  setState,
  setSummary,
  setQuota,
  showResultsLoading
} from "./modules/ui.js";
import { registerServiceWorker } from "./modules/cache.js";
import { describeQuota } from "./modules/quota.js";
import { createQueryClient } from "./modules/worker-client.js";

const RETRY_EVENT = "clarim:retry";
const STORAGE_KEY = "clarim.filters.v1";
const MAX_KEYWORDS = 12;
const PAGE_SIZE = 30;
const DEBOUNCE_MS = 250;

const state = {
  keywords: [],
  mode: "any",
  video: "",
  author: "",
  from: "",
  to: "",
  sort: "recent",
  ready: false,
  seq: 0,
  total: 0,
  rendered: 0,
  resultKey: "",
  timer: 0
};

const form = document.querySelector("#filters");
const keywordInput = document.querySelector("[data-keyword-input]");
const client = createQueryClient({ onProgress: handleProgress });

initUI();
registerServiceWorker();
restoreSaved();
renderChips(state.keywords);
applyControls();
bindEvents();

setState("loading", "Preparando a leitura local dos dados…");
scheduleAfterFirstPaint(loadData);

function scheduleAfterFirstPaint(callback) {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout: 1800 });
    return;
  }

  window.setTimeout(callback, 80);
}

/* ---------- carregamento ---------- */

function handleProgress(info) {
  if (info?.phase === "data" && info.total > 1) {
    setState("loading", `Carregando dados… ${info.done}/${info.total}`);
  }
}

async function loadData() {
  state.ready = false;
  setFiltersEnabled(false);
  setState("loading", "Carregando manifesto de dados…");

  try {
    const info = await client.request("init", { base: document.baseURI });

    setSummary(info.counts, info.generatedAt);
    setQuota(describeQuota(info.quota, info.generatedAt, new Date(), formatNumber));

    if (info.mode === "empty") {
      setResultsState({ total: 0, rendered: 0, hasData: false });
      setResultCount(0);
      renderCloud([]);
      setState(
        "empty",
        "Nenhum dado publicado ainda. Configure config/collection.json e execute a coleta " +
        "(ou use npm run sample para dados de demonstração)."
      );
      return;
    }

    state.video = fillVideoSelect(info.videos, state.video);
    applyControls();
    state.ready = true;
    setFiltersEnabled(true);

    setState(
      "ready",
      `${formatNumber(info.counts.comments)} comentários de ` +
      `${formatNumber(info.counts.videos)} vídeo(s) prontos para filtrar.`
    );

    await runFilter();
  } catch (error) {
    if (error?.name === "AbortError") return;

    console.error("[Clarim] Falha ao carregar dados.", error);
    setState(
      "error",
      "Não foi possível ler os dados locais. Verifique a conexão e tente novamente.",
      { canRetry: true }
    );
  }
}

/* ---------- filtro ---------- */

function buildQuery() {
  return {
    keywords: state.keywords,
    mode: state.mode,
    video: state.video,
    author: state.author,
    from: dayStart(state.from),
    to: dayEnd(state.to),
    sort: state.sort
  };
}

async function runFilter() {
  if (!state.ready) return;

  const seq = ++state.seq;
  showResultsLoading();

  try {
    const result = await client.request("filter", buildQuery());

    if (seq !== state.seq) return; // resposta obsoleta

    state.total = result.total;
    state.rendered = result.page.length;
    state.resultKey = result.key;

    clearComments();
    renderComments(result.page);
    setResultCount(result.total);
    setResultsState({ total: result.total, rendered: state.rendered });
    renderCloud(result.wordcloud);
  } catch (error) {
    if (seq !== state.seq) return;

    console.error("[Clarim] Falha ao filtrar.", error);
    setState("error", `Erro ao filtrar: ${error.message}`, { canRetry: true });
  }
}

function scheduleFilter(delay = 0) {
  window.clearTimeout(state.timer);

  if (delay > 0) {
    state.timer = window.setTimeout(runFilter, delay);
  } else {
    void runFilter();
  }
}

async function loadMore() {
  if (state.rendered >= state.total) return;

  const seq = state.seq;
  setMoreBusy(true);

  try {
    const result = await client.request("page", {
      offset: state.rendered,
      limit: PAGE_SIZE,
      key: state.resultKey
    });

    if (seq !== state.seq) return;

    renderComments(result.page);
    state.rendered += result.page.length;
    setResultsState({ total: state.total, rendered: state.rendered });
  } catch (error) {
    if (error.code === "stale") {
      scheduleFilter();
    } else {
      setHint(`Erro ao carregar mais: ${error.message}`);
    }
  } finally {
    setMoreBusy(false);
  }
}

async function exportText() {
  setExportBusy(true, state.total);

  try {
    const text = await client.request("export", { key: state.resultKey });
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `clarim-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.append(link);
    link.click();
    link.remove();

    // Revogar logo após o clique pode cancelar o download em alguns navegadores.
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    setHint(`Exportados ${formatNumber(state.total)} comentários.`);
  } catch (error) {
    if (error.code === "stale") {
      setHint("O filtro mudou durante a exportação. Tente novamente.");
      scheduleFilter();
    } else {
      setHint(`Erro na exportação: ${error.message}`);
    }
  } finally {
    setExportBusy(false, state.total);
  }
}

/* ---------- palavras-chave ---------- */

function addKeyword(raw) {
  const word = String(raw).trim().replace(/\s+/g, " ").toLowerCase().slice(0, 40);

  if (word.length < 2) {
    setHint("Use ao menos 2 caracteres.");
    return false;
  }

  if (state.keywords.includes(word)) {
    setHint(`"${word}" já está nos filtros.`);
    return false;
  }

  if (state.keywords.length >= MAX_KEYWORDS) {
    setHint(`Limite de ${MAX_KEYWORDS} palavras-chave atingido.`);
    return false;
  }

  state.keywords.push(word);
  setHint("");
  persist();
  renderChips(state.keywords);
  scheduleFilter();
  return true;
}

function removeKeyword(word) {
  state.keywords = state.keywords.filter((item) => item !== word);
  setHint("");
  persist();
  renderChips(state.keywords);
  scheduleFilter();
}

/* ---------- eventos ---------- */

function bindEvents() {
  form.addEventListener("submit", (event) => {
    event.preventDefault();

    if (keywordInput.value.trim() === "") return;

    if (addKeyword(keywordInput.value)) keywordInput.value = "";
  });

  document.querySelector("[data-chips]").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-word]");
    if (button) removeKeyword(button.dataset.word);
  });

  document.querySelector("[data-cloud]").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-word]");
    if (button) addKeyword(button.dataset.word);
  });

  for (const radio of form.querySelectorAll('input[name="mode"]')) {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      state.mode = radio.value;
      persist();
      scheduleFilter();
    });
  }

  form.querySelector("[data-video-select]").addEventListener("change", (event) => {
    state.video = event.target.value;
    scheduleFilter();
  });

  form.querySelector("[data-author]").addEventListener("input", (event) => {
    state.author = event.target.value;
    scheduleFilter(DEBOUNCE_MS);
  });

  form.querySelector("[data-from]").addEventListener("change", (event) => {
    state.from = event.target.value;
    scheduleFilter();
  });

  form.querySelector("[data-to]").addEventListener("change", (event) => {
    state.to = event.target.value;
    scheduleFilter();
  });

  form.querySelector("[data-sort]").addEventListener("change", (event) => {
    state.sort = event.target.value;
    persist();
    scheduleFilter();
  });

  form.querySelector("[data-clear]").addEventListener("click", () => {
    Object.assign(state, {
      keywords: [],
      mode: "any",
      video: "",
      author: "",
      from: "",
      to: "",
      sort: "recent"
    });
    keywordInput.value = "";
    setHint("");
    persist();
    renderChips(state.keywords);
    applyControls();
    scheduleFilter();
  });

  document.querySelector("[data-more]").addEventListener("click", loadMore);
  document.querySelector("[data-export]").addEventListener("click", exportText);

  window.addEventListener(RETRY_EVENT, () => {
    void loadData();
  });
}

function applyControls() {
  for (const radio of form.querySelectorAll('input[name="mode"]')) {
    radio.checked = radio.value === state.mode;
  }

  form.querySelector("[data-video-select]").value = state.video;
  form.querySelector("[data-author]").value = state.author;
  form.querySelector("[data-from]").value = state.from;
  form.querySelector("[data-to]").value = state.to;
  form.querySelector("[data-sort]").value = state.sort;
}

/* ---------- persistência (apenas no navegador) ---------- */

function restoreSaved() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");

    if (Array.isArray(saved.keywords)) {
      state.keywords = saved.keywords
        .filter((word) => typeof word === "string" && word.trim().length >= 2)
        .map((word) => word.trim().toLowerCase().slice(0, 40))
        .slice(0, MAX_KEYWORDS);
    }

    if (saved.mode === "all") state.mode = "all";
    if (["recent", "oldest", "likes"].includes(saved.sort)) state.sort = saved.sort;
  } catch {
    // armazenamento indisponível ou corrompido: segue com os padrões
  }
}

function persist() {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ keywords: state.keywords, mode: state.mode, sort: state.sort })
    );
  } catch {
    // modo privado ou cota cheia: ignora
  }
}

/* ---------- datas (fuso local) ---------- */

function dayStart(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  return Math.floor(new Date(+match[1], +match[2] - 1, +match[3]).getTime() / 1000);
}

function dayEnd(value) {
  const start = dayStart(value);
  return start === null ? null : start + 86399;
}
