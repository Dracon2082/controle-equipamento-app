import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { getTenantId } from "../utils/tenant";
import { obterRefMesAtual } from "../utils/clienteSistema";

const STATUS_CORES = {
  PENDENTE: { fundo: "#eef4ff", borda: "#b8ccff", texto: "#2457d6" },
  PAGO: { fundo: "#eaf9ef", borda: "#aadfb8", texto: "#1c8f43" },
  CANCELADO: { fundo: "#fdeff0", borda: "#f2b8bd", texto: "#d33d4f" }
};

function FinanceiroCliente({ setTela }) {
  const [aba, setAba] = useState("plano");
  const [cliente, setCliente] = useState(null);
  const [usuariosAtivos, setUsuariosAtivos] = useState(0);
  const [anoFiltro, setAnoFiltro] = useState(new Date().getFullYear());
  const tenantId = getTenantId();

  useEffect(() => {
    const carregar = async () => {
      const [snapClientes, snapUsuarios] = await Promise.all([
        getDocs(collection(db, "clientesSistema")),
        getDocs(collection(db, "frentistas"))
      ]);
      const lista = snapClientes.docs.map((d) => ({ id: d.id, ...d.data() }));
      const alvo =
        lista.find((item) => String(item.tenantId || "").toLowerCase() === tenantId) ||
        lista.find((item) => String(item.cnpj || "") === tenantId) ||
        null;
      setCliente(alvo);

      const totalUsuarios = snapUsuarios.docs
        .map((d) => d.data())
        .filter((item) => String(item.tenantId || "").toLowerCase() === tenantId)
        .length;
      setUsuariosAtivos(totalUsuarios);
    };
    carregar();
  }, [tenantId]);

  const faturamentoSimulado = useMemo(() => {
    const valor = Number(cliente?.valorMensal || 0);
    const ano = Number(anoFiltro);
    const hoje = new Date();
    const base = [
      { mes: 4, status: "PENDENTE", vencimento: `${ano}-04-17` },
      { mes: 3, status: "PAGO", vencimento: `${ano}-03-16` },
      { mes: 1, status: "CANCELADO", vencimento: `${ano}-01-04` }
    ];
    return base
      .filter((item) => item.mes <= 12)
      .map((item) => ({
        ...item,
        referencia: `${String(item.mes).padStart(2, "0")}/${ano}`,
        valor,
        notaFiscal: item.status === "PAGO" ? "Visualizar nota" : "-",
        hojeMes: hoje.getMonth() + 1 === item.mes && hoje.getFullYear() === ano
      }));
  }, [cliente?.valorMensal, anoFiltro]);

  const planoNome = cliente?.planoNome || cliente?.planoId || "Plano nao definido";
  const valorPlano = Number(cliente?.valorMensal || 0);
  const formaPagamento = String(cliente?.formaPagamento || "PIX").toUpperCase();
  const statusCliente = String(cliente?.status || "ATIVO").toUpperCase();
  const diaVenc = Number(cliente?.diaVencimento || 0);
  const pagoAteRef = String(cliente?.pagoAteRef || "").trim();
  const refAtual = obterRefMesAtual();
  const limiteGestores = Number(cliente?.limiteGestoresPlano || 1);
  const limiteAdmins = Number(cliente?.limiteAdminsPlano || 2);
  const limiteOperadoresRaw = cliente?.limiteOperadoresPlano;
  const limiteOperadoresIlimitado = limiteOperadoresRaw === null || Number(limiteOperadoresRaw) <= 0;
  const limiteOperadores = limiteOperadoresIlimitado ? 0 : Number(limiteOperadoresRaw || 20);
  const limiteUsuarios = Number(cliente?.maxUsuariosNoPlano || 0);

  const caixa = {
    maxWidth: 1060,
    margin: "0 auto",
    background: "#fff",
    border: "1px solid #e4e9f2",
    borderRadius: 8,
    padding: 24
  };

  const botaoTab = (ativo) => ({
    border: "none",
    background: "transparent",
    color: ativo ? "#1d61e7" : "#24364d",
    fontWeight: "bold",
    fontSize: 16,
    padding: "10px 0",
    marginRight: 24,
    borderBottom: ativo ? "3px solid #1d61e7" : "3px solid transparent",
    cursor: "pointer"
  });

  const linhaPlano = (titulo, valor) => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, padding: "12px 0", borderBottom: "1px solid #edf1f7" }}>
      <div style={{ color: "#30465f" }}>{titulo}</div>
      <strong style={{ color: "#17293d", whiteSpace: "nowrap" }}>{valor}</strong>
    </div>
  );

  const badgeStatus = (status) => {
    const mapa = STATUS_CORES[status] || STATUS_CORES.PENDENTE;
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: mapa.fundo,
          color: mapa.texto,
          border: `1px solid ${mapa.borda}`,
          borderRadius: 999,
          padding: "2px 10px",
          fontWeight: "bold",
          fontSize: 12
        }}
      >
        {status}
      </span>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f4f6fb", padding: 20 }}>
      <div style={{ maxWidth: 1060, margin: "0 auto 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, color: "#1b2f47", fontSize: 34 }}>Pagamentos</h2>
        </div>

      <section style={caixa}>
        <div style={{ display: "flex", borderBottom: "1px solid #e9eef6", marginBottom: 18 }}>
          <button type="button" onClick={() => setAba("plano")} style={botaoTab(aba === "plano")}>Meu plano</button>
          <button type="button" onClick={() => setAba("faturas")} style={botaoTab(aba === "faturas")}>Faturas</button>
        </div>

        {aba === "plano" && (
          <div style={{ border: "1px solid #e3e9f2", borderRadius: 8 }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #e9eef6", fontWeight: "bold", color: "#223650" }}>Meu plano</div>
            <div style={{ padding: 16 }}>
              <div style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 8, background: "#fffbe9", border: "1px solid #f0d88a", color: "#5c4a14" }}>
                Para duvidas sobre plano e financeiro, fale com o suporte da sua empresa.
              </div>
              <div style={{ display: "inline-flex", gap: 8, marginBottom: 14 }}>
                <span style={{ background: "#1d61e7", color: "#fff", borderRadius: 999, padding: "8px 14px", fontWeight: "bold" }}>{planoNome}</span>
                <span style={{ border: "1px solid #1d61e7", color: "#1d61e7", borderRadius: 999, padding: "8px 14px", fontWeight: "bold" }}>Mensal</span>
              </div>

              <div style={{ border: "1px solid #e8edf6", borderRadius: 8, padding: "0 14px" }}>
                {linhaPlano("Valor do plano", valorPlano ? `R$ ${valorPlano.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "-")}
                {linhaPlano("Limite de gestores", `${limiteGestores}`)}
                {linhaPlano("Limite de ADM", `${limiteAdmins}`)}
                {linhaPlano("Limite de operadores", limiteOperadoresIlimitado ? "Sem limite" : `${limiteOperadores}`)}
                {linhaPlano("Limite total do plano", limiteUsuarios > 0 ? `${limiteUsuarios}` : "Sem limite")}
                {linhaPlano("Usuarios ativos agora", `${usuariosAtivos}`)}
                {linhaPlano("Forma de pagamento", formaPagamento)}
                {linhaPlano("Status do cliente", statusCliente)}
                {linhaPlano("Dia do vencimento", diaVenc >= 1 && diaVenc <= 28 ? `${diaVenc}` : "-")}
                {linhaPlano("Pago ate (YYYY-MM)", pagoAteRef || "-")}
                {linhaPlano("Mes atual (ref)", refAtual)}
                {linhaPlano("Tenant atual", tenantId)}
              </div>
            </div>
          </div>
        )}

        {aba === "faturas" && (
          <div style={{ border: "1px solid #e3e9f2", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #e9eef6", fontWeight: "bold", color: "#223650" }}>Minhas faturas</div>
            <div style={{ padding: 16 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "end", marginBottom: 14, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12, color: "#5b6d84", marginBottom: 4 }}>Ano</div>
                  <input
                    value={anoFiltro}
                    onChange={(e) => setAnoFiltro(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    style={{ height: 40, width: 120, border: "1px solid #cdd7e6", borderRadius: 8, padding: "0 10px", boxSizing: "border-box" }}
                  />
                </div>
                <button
                  type="button"
                  style={{ border: "none", background: "#1d61e7", color: "#fff", borderRadius: 8, padding: "10px 16px", fontWeight: "bold", cursor: "pointer" }}
                >
                  Pesquisar
                </button>
              </div>

              <div style={{ border: "1px solid #e8edf6", borderRadius: 8, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                  <thead>
                    <tr style={{ background: "#f8fafe", textAlign: "left" }}>
                      <th style={{ padding: 12, borderBottom: "1px solid #e8edf6" }}>Mes de referencia</th>
                      <th style={{ padding: 12, borderBottom: "1px solid #e8edf6" }}>Data de vencimento</th>
                      <th style={{ padding: 12, borderBottom: "1px solid #e8edf6" }}>Situacao</th>
                      <th style={{ padding: 12, borderBottom: "1px solid #e8edf6" }}>Valor da fatura</th>
                      <th style={{ padding: 12, borderBottom: "1px solid #e8edf6" }}>Nota fiscal</th>
                      <th style={{ padding: 12, borderBottom: "1px solid #e8edf6" }}>Fatura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {faturamentoSimulado.map((item) => (
                      <tr key={`${item.referencia}-${item.status}`} style={{ background: item.hojeMes ? "#fbfdff" : "#fff" }}>
                        <td style={{ padding: 12, borderBottom: "1px solid #eef2f8" }}>{item.referencia}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #eef2f8" }}>
                          {new Date(item.vencimento).toLocaleDateString("pt-BR")}
                        </td>
                        <td style={{ padding: 12, borderBottom: "1px solid #eef2f8" }}>{badgeStatus(item.status)}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #eef2f8" }}>
                          {`R$ ${Number(item.valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
                        </td>
                        <td style={{ padding: 12, borderBottom: "1px solid #eef2f8" }}>
                          {item.notaFiscal === "-" ? "-" : <span style={{ color: "#1d61e7", cursor: "pointer" }}>{item.notaFiscal}</span>}
                        </td>
                        <td style={{ padding: 12, borderBottom: "1px solid #eef2f8", color: "#1d61e7", cursor: "pointer" }}>Abrir fatura</td>
                      </tr>
                    ))}
                    {faturamentoSimulado.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ padding: 14, textAlign: "center", color: "#5f7186" }}>
                          Nenhuma fatura para o ano selecionado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default FinanceiroCliente;

