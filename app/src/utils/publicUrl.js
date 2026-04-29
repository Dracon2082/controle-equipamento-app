export const PUBLIC_URL_STORAGE_KEY = "publicBaseUrl";

export const isProbablyPublicOrigin = (origin) => {
  const o = String(origin || "").toLowerCase();
  if (!o) return false;
  // Quick Tunnel / ambiente publico
  if (o.includes("trycloudflare.com")) return true;
  return false;
};

export const rememberPublicOriginIfAny = () => {
  try {
    const origin = String(window.location.origin || "").trim();
    if (!origin) return;
    if (!isProbablyPublicOrigin(origin)) return;
    localStorage.setItem(PUBLIC_URL_STORAGE_KEY, origin);
  } catch {
    // noop
  }
};

export const getPreferredPublicOrigin = () => {
  const originAtual = String(window.location.origin || "").trim();
  try {
    const armazenado = String(localStorage.getItem(PUBLIC_URL_STORAGE_KEY) || "").trim();

    // Se estivermos no publico (trycloudflare), usa o atual e atualiza cache.
    if (isProbablyPublicOrigin(originAtual)) {
      try {
        localStorage.setItem(PUBLIC_URL_STORAGE_KEY, originAtual);
      } catch {}
      return originAtual;
    }

    // Se estivermos em localhost, preferimos o ultimo publico armazenado.
    const host = String(window.location.hostname || "").toLowerCase();
    const isLocal =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      originAtual.toLowerCase().includes("localhost");

    if (isLocal && armazenado) return armazenado;
    return originAtual;
  } catch {
    return originAtual;
  }
};

