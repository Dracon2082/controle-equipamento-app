export const formatoLogoPdf = (src) => {
  const valor = String(src || "").toLowerCase();
  if (valor.includes("image/jpeg") || valor.includes("image/jpg") || valor.includes(".jpg") || valor.includes(".jpeg")) {
    return "JPEG";
  }
  return "PNG";
};

const urlParaDataUrl = async (url) => {
  const resposta = await fetch(url);
  const blob = await resposta.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export async function resolverLogoPdf(configuracao) {
  const logoBase64 = String(configuracao?.logoBase64 || "");
  if (logoBase64.startsWith("data:")) return logoBase64;

  const logo = String(configuracao?.logo || "");
  if (!logo) return "";
  if (logo.startsWith("data:")) return logo;

  try {
    return await urlParaDataUrl(logo);
  } catch {
    return "";
  }
}

