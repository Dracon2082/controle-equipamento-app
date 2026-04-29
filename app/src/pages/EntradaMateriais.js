import { useMemo, useState } from "react";
import Almoxarifado from "./Almoxarifado";
import Lubrificantes from "./Lubrificantes";

// Centraliza a ENTRADA administrativa de materiais para reduzir telas:
// - Materiais (almoxarifado): ferramentas/insumos/pecas/EPI + registros + estoque
// - Diesel/Lubrificantes: entrada e estoque (baixa no abastecimento / manutencao)
function EntradaMateriais({ setTela, abaInicial = "MATERIAIS" }) {
  const isMobile = window.innerWidth <= 700;
  const [aba, setAba] = useState(String(abaInicial || "MATERIAIS").toUpperCase());

  const card = useMemo(
    () => ({
      background: "#fff",
      border: "1px solid #e3e7ef",
      borderRadius: 10,
      padding: isMobile ? 12 : 14,
      boxShadow: "0 2px 10px rgba(16,36,62,0.08)",
      marginBottom: 12
    }),
    [isMobile]
  );
  const btn = useMemo(
    () => ({
      border: "none",
      borderRadius: 10,
      padding: "10px 14px",
      fontWeight: 800,
      cursor: "pointer"
    }),
    []
  );
  const tabBtn = (key) => ({
    ...btn,
    background: aba === key ? "#0b5ed7" : "#dee2e6",
    color: aba === key ? "#fff" : "#10243e"
  });

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: isMobile ? 10 : 18, background: "#f3f5f8", minHeight: "100vh" }}>
      <h2 style={{ marginTop: 0, color: "#10243e" }}>Entrada de Materiais (Central)</h2>

      <div style={{ ...card, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" style={tabBtn("MATERIAIS")} onClick={() => setAba("MATERIAIS")}>
          Almoxarifado (Materiais)
        </button>
        <button type="button" style={tabBtn("DIESEL")} onClick={() => setAba("DIESEL")}>
          Diesel / Lubrificantes
        </button>
        <div style={{ marginLeft: "auto", color: "#5b6f8a", fontWeight: 700, fontSize: 13 }}>
          Entrada unica no administrativo. Baixas acontecem no operacional (saidas/abastecimento/manutencao).
        </div>
      </div>

      {aba === "MATERIAIS" ? (
        <Almoxarifado setTela={setTela} modo="entrada" embed />
      ) : (
        <Lubrificantes setTela={setTela} embed />
      )}
    </div>
  );
}

export default EntradaMateriais;

