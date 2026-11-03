const RETRY_EVENT = "clarim:retry";
const numberFormatter = new Intl.NumberFormat("pt-BR");
const dateFormatter = new Intl.DateTimeFormat("pt-BR");
const LONG_TEXT_CHARS = 240;
const LONG_TEXT_LINES = 4;

const els = {};

export function initUI() {
  const q = (selector) => document.querySelector(selector);

  Object.assign(els, {
    statusText: q("[data-app-state-text]"),
    retry: q("[data-retry]"),
    previewPanel: q("[data-preview-panel]"),
    currentYear: q("[data-current-year]"),
    summaryComments: q("[data-summary-comments]"),
    summaryVideos: q("[data-summary-videos]"),
    summaryAuthors: q("[data-summary-authors]"),
    summaryDate: q("[data-summary-date]"),
    quota: q("[data-quota-text]"),
    fieldset: q("[data-filters-fieldset]"),
    chips: q("[data-chips]"),
    hint: q("[data-hint]"),
    videoSelect: q("[data-video-select]"),
    resultCount: q("[data-result-count]"),
    skeletons: q("[data-skeletons]"),
    comments: q("[data-comments]"),
    empty: q("[data-empty]"),
    more: q("[data-more]"),
    exportButton: q("[data-export]"),
    cloud: q("[data-cloud]"),
    cloudEmpty: q("[data-cloud-empty]")
  });

  if (els.currentYear) {
    els.currentYear.textContent = String(new Date().getFullYear());
  }

  els.retry?.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent(RETRY_EVENT));
  });
}

export function setState(state, message, { canRetry = false } = {}) {
  document.documentElement.dataset.appState = state;

  if (els.statusText) els.statusText.textContent = message;
  if (els.retry) els.retry.hidden = !canRetry;
  if (els.previewPanel) els.previewPanel.setAttribute("aria-busy", String(state === "loading"));
}

export function formatNumber(value) {
  return numberFormatter.format(value);
}

export function setSummary(counts, generatedAt) {
  setText(els.summaryComments, formatNumber(counts.comments || 0));
  setText(els.summaryVideos, formatNumber(counts.videos || 0));
  setText(els.summaryAuthors, formatNumber(counts.authors || 0));

  if (els.summaryDate) {
    const time = generatedAt ? Date.parse(generatedAt) : 0;
    els.summaryDate.textContent =
      time > 0 ? `Dados gerados em ${dateFormatter.format(new Date(time))}.` : "";
  }
}

export function setQuota(text) {
  if (!els.quota) return;
  els.quota.textContent = text || "";
  els.quota.hidden = !text;
}

export function setFiltersEnabled(enabled) {
  if (els.fieldset) els.fieldset.disabled = !enabled;
}

export function setHint(message) {
  setText(els.hint, message || "");
}

export function fillVideoSelect(videos, selectedId) {
  if (!els.videoSelect) return "";

  const select = els.videoSelect;
  select.replaceChildren(new Option("Todos os vídeos", ""));

  for (const video of videos) {
    select.append(new Option(video.title, video.id));
  }

  const valid = videos.some((video) => video.id === selectedId) ? selectedId : "";
  select.value = valid;
  return valid;
}

export function renderChips(keywords) {
  if (!els.chips) return;

  const fragment = document.createDocumentFragment();

  for (const word of keywords) {
    const item = document.createElement("li");
    item.className = "chip chip--keyword";

    const label = document.createElement("span");
    label.textContent = word;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chip__remove";
    remove.dataset.word = word;
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remover ${word}`);

    item.append(label, remove);
    fragment.append(item);
  }

  els.chips.replaceChildren(fragment);
}

export function setResultCount(total, label = "") {
  if (!els.resultCount) return;

  els.resultCount.textContent =
    `${formatNumber(total)} comentário${total === 1 ? "" : "s"} ` +
    `encontrado${total === 1 ? "" : "s"}${label}`;
}

export function showResultsLoading() {
  if (els.skeletons) els.skeletons.hidden = false;
}

export function clearComments() {
  els.comments?.replaceChildren();
}

export function renderComments(items) {
  if (!els.comments) return;

  const fragment = document.createDocumentFragment();

  for (const item of items) {
    fragment.append(buildComment(item));
  }

  els.comments.append(fragment);
}

function buildComment(item) {
  const article = document.createElement("article");
  article.className = item.reply ? "comment comment--reply" : "comment";

  const head = document.createElement("div");
  head.className = "comment__head";

  const author = document.createElement("strong");
  author.textContent = item.author;

  const meta = document.createElement("span");
  meta.className = "comment__meta";

  const parts = [item.video, formatDate(item.date)];
  if (item.likes > 0) parts.push(`${formatNumber(item.likes)} curtida${item.likes === 1 ? "" : "s"}`);
  if (item.reply) parts.push("resposta");
  meta.textContent = parts.join(" · ");

  head.append(author, meta);

  const text = document.createElement("p");
  text.className = "comment__text";
  text.textContent = item.text;

  article.append(head, text);

  if (item.text.length > LONG_TEXT_CHARS || item.text.split("\n").length > LONG_TEXT_LINES) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "link-button";
    toggle.textContent = "Expandir";
    toggle.setAttribute("aria-expanded", "false");

    toggle.addEventListener("click", () => {
      const expanded = text.toggleAttribute("data-expanded");
      toggle.textContent = expanded ? "Recolher" : "Expandir";
      toggle.setAttribute("aria-expanded", String(expanded));
    });

    article.append(toggle);
  }

  return article;
}

export function setResultsState({ total, rendered, hasData = true }) {
  if (els.skeletons) els.skeletons.hidden = true;
  if (els.empty) els.empty.hidden = !hasData || total > 0;
  if (els.more) els.more.hidden = rendered >= total;
  if (els.exportButton) els.exportButton.disabled = total === 0;
}

export function setMoreBusy(busy) {
  if (els.more) els.more.disabled = busy;
}

export function setExportBusy(busy, total) {
  if (els.exportButton) els.exportButton.disabled = busy || total === 0;
}

export function renderCloud(items) {
  if (!els.cloud) return;

  const fragment = document.createDocumentFragment();

  if (items.length > 0) {
    const max = items[0].count;
    const min = items[items.length - 1].count;

    for (const { word, count } of items) {
      const ratio = max === min ? 0.5 : (count - min) / (max - min);
      const button = document.createElement("button");

      button.type = "button";
      button.className = "cloud-word";
      button.dataset.word = word;
      button.dataset.tier = String(Math.min(3, Math.floor(ratio * 4)));
      button.style.setProperty("--cloud-size", `${(0.9 + ratio * 1.9).toFixed(2)}rem`);
      button.textContent = word;
      button.title = `${formatNumber(count)} ocorrência${count === 1 ? "" : "s"}`;
      button.setAttribute(
        "aria-label",
        `${word}, ${count} ocorrência${count === 1 ? "" : "s"}. Adicionar ao filtro.`
      );

      fragment.append(button);
    }
  }

  els.cloud.replaceChildren(fragment);

  if (els.cloudEmpty) els.cloudEmpty.hidden = items.length > 0;
}

function formatDate(seconds) {
  return seconds > 0 ? dateFormatter.format(new Date(seconds * 1000)) : "data desconhecida";
}

function setText(element, value) {
  if (element) element.textContent = value;
}
