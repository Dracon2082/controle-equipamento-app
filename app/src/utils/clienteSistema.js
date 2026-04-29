import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";

const CACHE_KEY = "clienteSistemaCache_v1";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

const normalizarTenant = (valor) =>
  String(valor || "")
    .trim()
    .toLowerCase();

export function avaliarBloqueioTeste(cliente) {
  const status = String(cliente?.status || "").trim().toUpperCase();
  if (status !== "TESTE") return { bloqueado: false };

  const expiraEmRaw = cliente?.testeExpiraEm || cliente?.testeExpiraEmISO || cliente?.testeExpiraEmMs;
  if (!expiraEmRaw) return { bloqueado: false };

  let expiraMs = null;
  if (typeof expiraEmRaw === "number") expiraMs = expiraEmRaw;
  if (typeof expiraEmRaw === "string") {
    const parsed = Date.parse(expiraEmRaw);
    if (!Number.isNaN(parsed)) expiraMs = parsed;
  }

  if (!expiraMs) return { bloqueado: false };
  const agora = Date.now();
  if (agora <= expiraMs) return { bloqueado: false, expiraEmMs: expiraMs };
  return { bloqueado: true, expiraEmMs: expiraMs };
}

export function avaliarBloqueioInadimplencia(cliente) {
  const status = String(cliente?.status || "").trim().toUpperCase();
  if (status !== "INADIMPLENTE") return { bloqueado: false };
  return { bloqueado: true };
}

const pad2 = (n) => String(n).padStart(2, "0");
const refMes = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const refMesAnterior = (d = new Date()) => {
  const x = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return refMes(x);
};
const cmpRef = (a, b) => String(a || "").localeCompare(String(b || ""), "pt-BR");

export function avaliarInadimplenciaAutomatica(cliente, opts = {}) {
  const status = String(cliente?.status || "").trim().toUpperCase();
  // INATIVO e TESTE ja possuem regras especificas em outras camadas.
  if (status === "INATIVO") return { bloqueado: false };

  // Durante o periodo de TESTE, nao aplicamos bloqueio por inadimplencia automatica.
  // O bloqueio do teste e controlado por avaliarBloqueioTeste (testeExpiraEm).
  if (status === "TESTE") return { bloqueado: false };

  const carenciaDias = Math.max(0, Number(opts?.carenciaDias ?? 10));
  const diaVenc = Number(cliente?.diaVencimento || 0);
  if (!Number.isFinite(diaVenc) || diaVenc < 1 || diaVenc > 28) return { bloqueado: false };

  const pagoAte = String(cliente?.pagoAteRef || "").trim();
  const agora = new Date();

  const refAtual = refMes(agora);
  const refAnterior = refMesAnterior(agora);

  const vencAtual = new Date(agora.getFullYear(), agora.getMonth(), diaVenc);
  const limiteAtual = new Date(vencAtual.getTime() + carenciaDias * 24 * 60 * 60 * 1000);

  // Se ja passou da carencia do vencimento deste mes, o mes devido e o atual.
  // Caso contrario, o mes devido e o anterior.
  const refDevida = agora > limiteAtual ? refAtual : refAnterior;

  if (!refDevida) return { bloqueado: false };
  if (pagoAte && cmpRef(pagoAte, refDevida) >= 0) return { bloqueado: false };

  // Nao bloqueia antes do vencimento+carencia do mes devido.
  // Ex: no comeco do mes, se ainda nao venceu o mes atual, mas o anterior esta devido, ja pode bloquear.
  const [anoDev, mesDev] = String(refDevida).split("-").map((x) => Number(x));
  if (!anoDev || !mesDev) return { bloqueado: false };
  const vencDev = new Date(anoDev, mesDev - 1, diaVenc);
  const limiteDev = new Date(vencDev.getTime() + carenciaDias * 24 * 60 * 60 * 1000);
  if (agora <= limiteDev) return { bloqueado: false, refDevida };

  return { bloqueado: true, refDevida };
}

export function obterRefMesAtual() {
  return refMes(new Date());
}

export function obterRefMesAnterior() {
  return refMesAnterior(new Date());
}

export async function carregarClienteSistema(tenantId) {
  const tenant = normalizarTenant(tenantId);
  if (!tenant) return null;

  // Cache (evita bater no Firestore toda hora).
  try {
    const bruto = localStorage.getItem(CACHE_KEY);
    if (bruto) {
      const cache = JSON.parse(bruto);
      if (cache?.tenantId === tenant && cache?.timestamp && cache?.dados) {
        const idade = Date.now() - Number(cache.timestamp || 0);
        if (idade >= 0 && idade <= CACHE_TTL_MS) return cache.dados;
      }
    }
  } catch {
    // ignora cache corrompido
  }

  const snap = await getDocs(collection(db, "clientesSistema"));
  const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const alvo =
    lista.find((item) => normalizarTenant(item?.tenantId) === tenant) ||
    lista.find((item) => String(item?.cnpj || "").trim() === tenant) ||
    null;

  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        tenantId: tenant,
        timestamp: Date.now(),
        dados: alvo
      })
    );
  } catch {
    // ignora falha de storage
  }

  return alvo;
}

export function limparCacheClienteSistema() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // noop
  }
}
