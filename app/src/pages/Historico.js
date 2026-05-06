/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { belongsToTenant, getTenantId } from "../utils/tenant";

function Historico() {
  const tenantId = getTenantId();
  const [dados, setDados] = useState([]);
  const [filtroModulo, setFiltroModulo] = useState("");
  const [filtroAcao, setFiltroAcao] = useState("");
  const [filtroData, setFiltroData] = useState("");

  const card = {
    background: "#fff",
    border: "1px solid #e3e7ef",
    borderRadius: 8,
    padding: 14,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)"
  };

  const inputBase = {
    width: "100%",
    height: 40,
    borderRadius: 8,
    border: "1px solid #cfd7e3",
    padding: "0 10px",
    boxSizing: "border-box"
  };

  const thBase = {
    padding: 8,
    border: "1px solid #d8e0ea",
    textAlign: "center",
    whiteSpace: "nowrap"
  };

  const tdBase = {
    padding: 8,
    border: "1px solid #e5ebf3",
    verticalAlign: "top",
    whiteSpace: "normal",
    overflowWrap: "break-word",
    wordBreak: "normal",
    lineHeight: 1.35
  };

  const textoChaveAmigavel = (valor) => String(valor || "").replace(/_/g, " ");

  const resumirRegistro = (valor) => {
    const txt = String(valor || "");
    if (!txt) return "-";
    if (txt.length <= 18) return txt;
    return `${txt.slice(0, 18)}...`;
  };

  const corrigirTextoQuebrado = (valor) => {
    const texto = String(valor || "");
    if (!texto) return "";
    if (!/[ÃƒÃ‚Ã¢]/.test(texto)) return texto;

    try {
      const bytes = Uint8Array.from(Array.from(texto).map((ch) => ch.charCodeAt(0) & 0xff));
      const corrigido = new TextDecoder("utf-8").decode(bytes);
      return /ï¿½/.test(corrigido) ? texto : corrigido;
    } catch {
      return texto;
    }
  };

  useEffect(() => {
    buscar();
  }, []);

  const buscar = async () => {
    const snap = await getDocs(collection(db, "historico_operacoes"));
    const lista = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId));
    lista.sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")));
    setDados(lista);
  };

  const formatarDataHora = (iso) => {
    if (!iso) return "-";
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return iso;
    return dt.toLocaleString("pt-BR");
  };

  const modulos = useMemo(
    () => Array.from(new Set(dados.map((d) => d.modulo).filter(Boolean))).sort(),
    [dados]
  );

  const acoes = useMemo(
    () => Array.from(new Set(dados.map((d) => d.acao).filter(Boolean))).sort(),
    [dados]
  );

  const listaFiltrada = useMemo(() => {
    return dados.filter((item) => {
      if (filtroModulo && item.modulo !== filtroModulo) return false;
      if (filtroAcao && item.acao !== filtroAcao) return false;
      if (filtroData && !String(item.criadoEm || "").startsWith(filtroData)) return false;
      return true;
    });
  }, [dados, filtroModulo, filtroAcao, filtroData]);

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "18px 10px 28px", background: "#f3f5f8" }}>
      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, color: "#0f2440" }}>Histórico de Operacoes</h2>
        </div>
        <p style={{ margin: "8px 0 0", color: "#4a5c74" }}>
          Registro imutavel de tudo que foi criado, alterado, excluido ou gerado no sistema.
        </p>
      </div>

      <div style={{ ...card, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0, color: "#10243e" }}>Filtros</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <input style={inputBase} type="date" value={filtroData} onChange={(e) => setFiltroData(e.target.value)} />
          <select style={inputBase} value={filtroModulo} onChange={(e) => setFiltroModulo(e.target.value)}>
            <option value="">Todos os modulos</option>
            {modulos.map((m) => (
              <option key={m} value={m}>{corrigirTextoQuebrado(m)}</option>
            ))}
          </select>
          <select style={inputBase} value={filtroAcao} onChange={(e) => setFiltroAcao(e.target.value)}>
            <option value="">Todas as acoes</option>
            {acoes.map((a) => (
              <option key={a} value={a}>{corrigirTextoQuebrado(a)}</option>
            ))}
          </select>
          <button
            onClick={() => {
              setFiltroData("");
              setFiltroModulo("");
              setFiltroAcao("");
            }}
            style={{
              background: "#6c757d",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "10px 14px",
              fontWeight: "bold",
              cursor: "pointer"
            }}
          >
            Limpar filtros
          </button>
        </div>
      </div>

      <div style={{ ...card }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 12 }}>
          <colgroup>
            <col style={{ width: "10%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "17%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "28%" }} />
          </colgroup>
          <thead style={{ background: "#0b5ed7", color: "#fff" }}>
            <tr>
              {["Data/hora", "Modulo", "Acao", "Entidade", "Registro", "Usuario", "Descrição"].map((h) => (
                <th key={h} style={thBase}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {listaFiltrada.map((item, idx) => (
              <tr key={item.id} style={{ background: idx % 2 === 0 ? "#f8fbff" : "#fff" }}>
                <td style={{ ...tdBase, textAlign: "center" }}>{formatarDataHora(item.criadoEm)}</td>
                <td style={{ ...tdBase, textAlign: "center", whiteSpace: "nowrap" }}>{corrigirTextoQuebrado(item.modulo) || "-"}</td>
                <td style={{ ...tdBase, textAlign: "center", whiteSpace: "nowrap", fontWeight: "bold" }}>{corrigirTextoQuebrado(item.acao) || "-"}</td>
                <td style={{ ...tdBase, textAlign: "center" }}>{textoChaveAmigavel(corrigirTextoQuebrado(item.entidade)) || "-"}</td>
                <td
                  title={String(item.registroId || "-")}
                  style={{ ...tdBase, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "monospace" }}
                >
                  {resumirRegistro(item.registroId)}
                </td>
                <td style={{ ...tdBase, textAlign: "center" }}>{corrigirTextoQuebrado(item.usuario) || "-"}</td>
                <td style={{ ...tdBase, textAlign: "left" }}>{corrigirTextoQuebrado(item.descricao) || "-"}</td>
              </tr>
            ))}
            {!listaFiltrada.length && (
              <tr>
                <td colSpan={7} style={{ padding: 12, textAlign: "center", color: "#6c757d" }}>
                  Nenhum registro encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Historico;


