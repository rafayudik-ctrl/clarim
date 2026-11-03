export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  const register = () => {
    const serviceWorkerUrl = new URL("../../../sw.js", import.meta.url);

    navigator.serviceWorker.register(serviceWorkerUrl).catch((error) => {
      console.warn("[Clarim] Service Worker não registrado.", error);
    });
  };

  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
