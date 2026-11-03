import { createQueryService } from "./query-service.js";

/**
 * Cliente de consulta: usa um Web Worker de módulo; se o navegador não
 * suportar (falha na inicialização), cai para o mesmo serviço na thread principal.
 */
export function createQueryClient({ onProgress = () => {} } = {}) {
  let usingLocal = false;
  let backend;

  try {
    backend = createRemote(onProgress);
  } catch {
    backend = createLocal(onProgress);
    usingLocal = true;
  }

  return {
    get usingWorker() {
      return !usingLocal;
    },

    async request(type, payload = {}) {
      try {
        return await backend.request(type, payload);
      } catch (error) {
        if (error.workerCrash && !usingLocal && type === "init") {
          backend.terminate();
          backend = createLocal(onProgress);
          usingLocal = true;
          return backend.request(type, payload);
        }

        throw error;
      }
    }
  };
}

function createRemote(onProgress) {
  const worker = new Worker(new URL("../workers/query-worker.js", import.meta.url), {
    type: "module"
  });

  let sequence = 0;
  let dead = null;
  const pending = new Map();

  const failAll = (error) => {
    dead = error;
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };

  worker.addEventListener("message", (event) => {
    const message = event.data || {};

    if (message.type === "progress") {
      onProgress(message.payload);
      return;
    }

    const entry = pending.get(message.id);
    if (!entry) return;

    pending.delete(message.id);

    if (message.type === "error") {
      const error = new Error(message.error || "Falha no worker.");
      error.code = message.code || "";
      entry.reject(error);
    } else {
      entry.resolve(message.payload);
    }
  });

  worker.addEventListener("error", (event) => {
    const error = new Error(event.message || "Falha ao iniciar o worker.");
    error.workerCrash = true;
    failAll(error);
  });

  worker.addEventListener("messageerror", () => {
    const error = new Error("Mensagem do worker inválida.");
    error.workerCrash = true;
    failAll(error);
  });

  return {
    request(type, payload) {
      if (dead) return Promise.reject(dead);

      return new Promise((resolve, reject) => {
        sequence += 1;
        pending.set(sequence, { resolve, reject });
        worker.postMessage({ id: sequence, type, payload });
      });
    },
    terminate() {
      worker.terminate();
    }
  };
}

function createLocal(onProgress) {
  const service = createQueryService({ onProgress });

  return {
    request: (type, payload) => service.handle(type, payload),
    terminate() {}
  };
}
