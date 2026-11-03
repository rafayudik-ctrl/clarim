import { decodeCompactDataset, decodeManifest } from "./data.js";
import { createEngine, mergeRawDatasets, parseStopwords } from "./query-engine.js";

/**
 * Serviço de consulta: carrega manifesto + dados, mantém o motor de filtro.
 * Roda dentro do Web Worker; o mesmo código serve de fallback na thread principal
 * e é testável em Node com um `fetchImpl` simulado.
 */
export function createQueryService({
  fetchImpl,
  onProgress = () => {},
  concurrency = 3
} = {}) {
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  let engine = null;
  let initPromise = null;
  let controller = null;

  async function getJSON(url, { signal, noStore = false } = {}) {
    const response = await doFetch(url, {
      signal,
      headers: { Accept: "application/json" },
      ...(noStore ? { cache: "no-store" } : {})
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ao carregar ${new URL(url).pathname}.`);
    }

    return response.json();
  }

  async function loadStopwords(base, signal) {
    try {
      const words = parseStopwords(
        await getJSON(new URL("assets/stopwords.json", base).href, { signal })
      );
      if (words.length > 0) return words;
    } catch (error) {
      if (signal.aborted) throw error;
    }
    return null; // o motor usa a lista embutida
  }

  async function runInit({ base, force = false } = {}) {
    if (!base) throw new Error("init: base ausente.");

    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    engine = null;

    onProgress({ phase: "manifest" });

    const manifest = decodeManifest(
      await getJSON(new URL("data/manifest.json", base).href, { signal, noStore: true })
    );

    const entries = manifest.mode === "full" ? manifest.files : manifest.shards;
    const results = new Array(entries.length);
    let next = 0;
    let done = 0;

    async function loadNext() {
      while (true) {
        if (signal.aborted) throw new DOMException("Cancelado", "AbortError");

        const index = next;
        next += 1;
        if (index >= entries.length) return;

        const raw = await getJSON(new URL(entries[index].path, base).href, { signal });
        decodeCompactDataset(raw); // valida; o motor usa os arrays brutos
        results[index] = raw;
        done += 1;
        onProgress({ phase: "data", done, total: entries.length });
      }
    }

    try {
      await Promise.all(
        Array.from({ length: Math.min(concurrency, entries.length) }, loadNext)
      );
    } catch (error) {
      controller.abort();
      throw error;
    }

    const merged = mergeRawDatasets(results);

    if (
      merged.videos.length !== manifest.counts.videos ||
      merged.authors.length !== manifest.counts.authors ||
      merged.comments.length !== manifest.counts.comments
    ) {
      throw new Error("Contagens dos dados divergem do manifesto.");
    }

    const stopwords = await loadStopwords(base, signal);
    const next_engine = createEngine({ stopwords });
    next_engine.setData(merged);
    engine = next_engine;

    return {
      mode: manifest.mode,
      generatedAt: manifest.generatedAt,
      quota: manifest.quota,
      counts: manifest.counts,
      videos: engine.videoList()
    };
  }

  async function handle(type, payload = {}) {
    if (type === "init") {
      initPromise = runInit(payload);
      return initPromise;
    }

    if (initPromise) {
      try {
        await initPromise;
      } catch {
        // o erro já foi entregue à chamada de init
      }
    }

    if (!engine) throw new Error("Dados ainda não carregados.");

    switch (type) {
      case "filter":
        return engine.filter(payload);
      case "page":
        return engine.getPage(payload.offset, payload.limit, payload.key);
      case "export":
        return engine.exportText(payload.key);
      default:
        throw new Error(`Mensagem desconhecida: ${String(type)}`);
    }
  }

  return { handle };
}
