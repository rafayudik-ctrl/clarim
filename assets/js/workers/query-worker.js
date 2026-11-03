import { createQueryService } from "../modules/query-service.js";

const service = createQueryService({
  onProgress: (payload) => self.postMessage({ type: "progress", payload })
});

self.addEventListener("message", async (event) => {
  const { id, type, payload } = event.data || {};

  try {
    const result = await service.handle(type, payload || {});
    self.postMessage({ id, type: "result", payload: result });
  } catch (error) {
    self.postMessage({
      id,
      type: "error",
      error: error?.message || String(error),
      code: error?.code || ""
    });
  }
});
