export const parseDecimalInput = (valor) => {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;

  const bruto = String(valor ?? "").trim().replace(/\s+/g, "");
  if (!bruto) return 0;

  const temVirgula = bruto.includes(",");
  const temPonto = bruto.includes(".");
  let normalizado = bruto;

  if (temVirgula && temPonto) {
    const ultimaVirgula = bruto.lastIndexOf(",");
    const ultimoPonto = bruto.lastIndexOf(".");
    // Considera o separador mais a direita como decimal.
    normalizado = ultimaVirgula > ultimoPonto
      ? bruto.replace(/\./g, "").replace(",", ".")
      : bruto.replace(/,/g, "");
  } else if (temVirgula) {
    normalizado = bruto.replace(",", ".");
  }

  const convertido = Number(normalizado);
  return Number.isFinite(convertido) ? convertido : 0;
};
