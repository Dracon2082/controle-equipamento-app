import { useState } from "react";
import Almoxarifado from "./Almoxarifado";
import EPI from "./EPI";

function SaidasMateriais({ setTela }) {
  const isMobile = window.innerWidth <= 700;
  const [aba, setAba] = useState("MATERIAIS"); // MATERIAIS | EPI
  const sessaoOperacional = (() => {
    try {
      return JSON.parse(localStorage.getItem("sessaoOperacional") || "{}");
    } catch {
      return {};
    }
  })();
  const basesPermitidas = Array.isArray(sessaoOperacional?.basesPermitidas)
    ? sessaoOperacional.basesPermitidas.map((b) => String(b || "").trim().toUpperCase()).filter(Boolean)
    : [];
  const basesTexto = (() => {
    const cidades = Array.from(
      new Set(
        basesPermitidas
          .map((b) => String(b || "").split("__")[0])
          .map((c) => String(c || "").trim().toUpperCase())
          .filter(Boolean)
      )
    );
    if (!cidades.length) return "";
    if (cidades.length === 1) return cidades[0];
    return cidades.join(", ");
  })();

  const card = {
    background: "#fff",
    border: "1px solid #e3e7ef",
    borderRadius: 10,
    padding: isMobile ? 12 : 14,
    boxShadow: "0 2px 10px rgba(16,36,62,0.08)",
    marginBottom: 12
  };
  const btn = {
    border: "none",
    borderRadius: 10,
    padding: "10px 14px",
    fontWeight: 800,
    cursor: "pointer"
  };
  const tabBtn = (key) => ({
    ...btn,
    background: aba === key ? "#0b5ed7" : "#dee2e6",
    color: aba === key ? "#fff" : "#10243e"
  });

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: isMobile ? 10 : 18, background: "#f3f5f8", minHeight: "100vh" }}>
      <h2 style={{ marginTop: 0, color: "#10243e" }}>Saidas de Materiais</h2>

      <div style={{ ...card, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" style={tabBtn("MATERIAIS")} onClick={() => setAba("MATERIAIS")}>
          Ferramentas / Insumos
        </button>
        <button type="button" style={tabBtn("EPI")} onClick={() => setAba("EPI")}>
          EPI
        </button>
        <div style={{ marginLeft: "auto", color: "#5b6f8a", fontWeight: 700, fontSize: 13 }}>
          {basesTexto ? `Base autorizada: ${basesTexto}` : "Operacional: somente saidas/entregas (entrada fica no administrativo)"}
        </div>
      </div>

      {aba === "MATERIAIS" ? (
        <Almoxarifado setTela={setTela} modo="saidas" embed />
      ) : (
        <EPI setTela={setTela} modo="saidas" embed />
      )}
    </div>
  );
}

export default SaidasMateriais;
