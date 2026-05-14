import { parseDecimalInput } from "./number";

export const TIPOS_DIESEL_MELOSA = ["S-10", "S-500"];

export const normalizarTextoMelosa = (valor) =>
  String(valor || "").replace(/\s+/g, " ").trim().toUpperCase();

export const chaveBaseMelosa = (cidade, estado) =>
  `${normalizarTextoMelosa(cidade)}__${normalizarTextoMelosa(estado)}`;

export const criarSaldosMelosa = (origem = {}) => ({
  "S-10": parseDecimalInput(origem?.["S-10"] ?? origem?.S10 ?? 0),
  "S-500": parseDecimalInput(origem?.["S-500"] ?? origem?.S500 ?? 0)
});

export const obterSaldoMelosa = (melosa, tipoDiesel) => {
  const tipo = normalizarTextoMelosa(tipoDiesel);
  const saldos = criarSaldosMelosa(melosa?.saldos);
  return tipo === "S-500" ? saldos["S-500"] : saldos["S-10"];
};

export const totalDieselMelosa = (melosa) => {
  const saldos = criarSaldosMelosa(melosa?.saldos);
  return saldos["S-10"] + saldos["S-500"];
};
