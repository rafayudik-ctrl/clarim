export class YouTubeApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "YouTubeApiError";
    this.status = options.status ?? 0;
    this.reason = options.reason ?? "";
    this.retryable = options.retryable ?? false;
    this.fatal = options.fatal ?? false;
  }
}

// Erros que invalidam a execução inteira (chave, cota, API desativada).
// `forbidden` NÃO entra aqui: costuma ser restrição de um vídeo específico.
const FATAL_REASONS = new Set([
  "quotaExceeded",
  "dailyLimitExceeded",
  "keyInvalid",
  "accessNotConfigured",
  "ipRefererBlocked"
]);

const RETRYABLE_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "backendError",
  "internalError",
  "serviceUnavailable"
]);

const REQUEST_TIMEOUT_MS = 30_000;

export function createYouTubeClient({
  apiKey,
  fetchImpl = globalThis.fetch,
  retries = 3,
  retryBaseDelayMs = 500,
  sleep = defaultSleep,
  logger = console
} = {}) {
  if (!apiKey) throw new Error("YOUTUBE_API_KEY ausente.");
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch nativo indisponível. Use Node 18+.");
  }

  const base = "https://www.googleapis.com/youtube/v3/";

  async function request(endpoint, params) {
    const url = new URL(endpoint, base);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    url.searchParams.set("key", apiKey);

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      let errorToRetry = null;

      try {
        const response = await fetchImpl(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });

        if (response.ok) {
          return await response.json();
        }

        const apiError = await readYouTubeError(response, apiKey);
        if (apiError.fatal || !apiError.retryable) throw apiError;
        errorToRetry = apiError;
      } catch (caught) {
        if (caught instanceof YouTubeApiError) {
          if (caught.fatal || !caught.retryable) throw caught;
          errorToRetry = caught;
        } else {
          errorToRetry = normalizeNetworkError(caught, apiKey);
        }
      }

      if (attempt === retries) throw errorToRetry;

      const delay = retryBaseDelayMs * 2 ** attempt;
      logger.warn(
        `YouTube API: tentativa ${attempt + 1}/${retries + 1} falhou ` +
        `(${errorToRetry.reason || errorToRetry.name}). Nova tentativa em ${delay}ms.`
      );
      await sleep(delay);
    }

    throw new Error("Falha desconhecida na YouTube API.");
  }

  return {
    async listVideos(ids) {
      const map = new Map();

      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const data = await request("videos", {
          part: "snippet",
          id: chunk.join(","),
          maxResults: 50
        });

        for (const item of data.items || []) {
          const snippet = item.snippet || {};
          map.set(item.id, {
            id: item.id,
            title: typeof snippet.title === "string" ? snippet.title : "",
            channelTitle:
              typeof snippet.channelTitle === "string" ? snippet.channelTitle : "",
            publishedAt: toEpochSeconds(snippet.publishedAt)
          });
        }
      }

      return map;
    },

    async listCommentThreads(videoId, { pageSize = 100, pageToken, includeReplies = false } = {}) {
      return request("commentThreads", {
        part: includeReplies ? "snippet,replies" : "snippet",
        videoId,
        maxResults: pageSize,
        order: "time",
        textFormat: "plainText",
        pageToken
      });
    }
  };
}

async function readYouTubeError(response, apiKey) {
  let reason = "";
  let message = "";

  try {
    const body = await response.text();
    try {
      const data = JSON.parse(body);
      const error = data.error || {};
      reason = error.errors?.[0]?.reason || error.status || "";
      message = error.message || "";
    } catch {
      message = body.slice(0, 300);
    }
  } catch {
    message = response.statusText || "";
  }

  const status = response.status;
  const fatal = FATAL_REASONS.has(reason) || status === 401;
  const retryable =
    !fatal && (status === 429 || status >= 500 || RETRYABLE_REASONS.has(reason));

  const safeMessage = sanitize(
    `YouTube API ${status}${reason ? ` (${reason})` : ""}${message ? `: ${message}` : ""}`,
    apiKey
  );

  return new YouTubeApiError(safeMessage, { status, reason, retryable, fatal });
}

function normalizeNetworkError(error, apiKey) {
  const message = sanitize(error?.message || String(error), apiKey);
  return new YouTubeApiError(`Falha de rede: ${message}`, {
    retryable: true,
    fatal: false
  });
}

function sanitize(value, apiKey) {
  let out = String(value);
  if (apiKey) {
    out = out.split(apiKey).join("[REDACTED]");
    out = out.split(encodeURIComponent(apiKey)).join("[REDACTED]");
  }
  return out;
}

function toEpochSeconds(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms >= 0 ? Math.floor(ms / 1000) : 0;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
