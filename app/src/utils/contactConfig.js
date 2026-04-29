const STORAGE_KEY = "contatoComercialConfig";

const padrao = {
  vendasWhatsappUrl: "https://wa.me/5568999999999",
  suporteWhatsappUrl: "https://wa.me/5568999999999"
};

const normalizarWhatsapp = (valor, fallback) => {
  const raw = String(valor || "").trim();
  if (!raw) return fallback;
  if (/^https?:\/\//i.test(raw)) return raw;
  const numero = raw.replace(/\D/g, "");
  if (!numero) return fallback;
  return `https://wa.me/${numero}`;
};

export const getContatoComercialConfig = () => {
  try {
    const bruto = localStorage.getItem(STORAGE_KEY);
    if (!bruto) return { ...padrao };
    const parsed = JSON.parse(bruto);
    return {
      vendasWhatsappUrl: normalizarWhatsapp(parsed?.vendasWhatsappUrl, padrao.vendasWhatsappUrl),
      suporteWhatsappUrl: normalizarWhatsapp(parsed?.suporteWhatsappUrl, padrao.suporteWhatsappUrl)
    };
  } catch {
    return { ...padrao };
  }
};

export const salvarContatoComercialConfig = (config) => {
  const atual = getContatoComercialConfig();
  const atualizado = {
    vendasWhatsappUrl: normalizarWhatsapp(config?.vendasWhatsappUrl, atual.vendasWhatsappUrl),
    suporteWhatsappUrl: normalizarWhatsapp(config?.suporteWhatsappUrl, atual.suporteWhatsappUrl)
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(atualizado));
  return atualizado;
};
