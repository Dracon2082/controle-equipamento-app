import { addDoc, collection } from "firebase/firestore";
import { db } from "../firebase";
import { getTenantId } from "./tenant";

export async function registrarHistorico({
  modulo = "",
  acao = "",
  entidade = "",
  registroId = "",
  descricao = "",
  usuario = "",
  detalhes = {}
}) {
  try {
    const tenantId = getTenantId();
    await addDoc(collection(db, "historico_operacoes"), {
      tenantId,
      modulo: String(modulo || "").toUpperCase(),
      acao: String(acao || "").toUpperCase(),
      entidade: String(entidade || "").toUpperCase(),
      registroId: String(registroId || ""),
      descricao: String(descricao || "").trim(),
      usuario: String(usuario || "").trim().toUpperCase(),
      detalhes,
      criadoEm: new Date().toISOString()
    });
  } catch (e) {
    console.log("Falha ao registrar historico:", e);
  }
}
