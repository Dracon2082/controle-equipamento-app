import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { getTenantId } from "../utils/tenant";
import { obterRefMesAtual } from "../utils/clienteSistema";
import { obterLimitesPlanoCliente } from "../utils/planos";

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
  const [faturas, setFaturas] = useState([]);
  const [faturaAberta, setFaturaAberta] = useState(null);
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

  useEffect(() => {
    if (aba !== "faturas") return;
    let ativo = true;

    const carregarFaturas = async () => {
      try {
        const snap = await getDocs(collection(db, "faturasSistema"));
        const lista = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((i) => String(i?.tenantId || "").toLowerCase() === String(tenantId || "").toLowerCase())
          .sort((a, b) => String(b?.refMes || "").localeCompare(String(a?.refMes || ""), "pt-BR"));
        if (ativo) setFaturas(lista);
      } catch {
        if (ativo) setFaturas([]);
      }
    };

    carregarFaturas();
    return () => {
      ativo = false;
    };
  }, [aba, tenantId]);

  const faturasFiltradas = useMemo(() => {
    const ano = Number(anoFiltro);
    const hoje = new Date();
    const refHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;

    return (Array.isArray(faturas) ? faturas : [])
      .filter((f) => {
        const ref = String(f?.refMes || "").trim(); // YYYY-MM
        const y = Number(ref.split("-")[0] || 0);
        return y === ano;
      })
      .map((f) => {
        const ref = String(f?.refMes || "").trim();
        const [y, m] = ref.split("-").map((x) => Number(x || 0));
        const referencia = y && m ? `${String(m).padStart(2, "0")}/${y}` : ref || "-";
        return {
          ...f,
          referencia,
          hojeMes: ref === refHoje
        };
      });
  }, [faturas, anoFiltro]);

  const planoNome = cliente?.planoNome || cliente?.planoId || "Plano nao definido";
  const valorPlano = Number(cliente?.valorMensal || 0);
  const formaPagamento = String(cliente?.formaPagamento || "PIX").toUpperCase();
  const statusCliente = String(cliente?.status || "ATIVO").toUpperCase();
  const diaVenc = Number(cliente?.diaVencimento || 0);
  const pagoAteRef = String(cliente?.pagoAteRef || "").trim();
  const refAtual = obterRefMesAtual();
  const limitesPlano = obterLimitesPlanoCliente(cliente || {});
  const limiteGestores = Number(limitesPlano.limiteGestores || 0);
  const limiteAdmins = Number(limitesPlano.limiteAdmins || 0);
  const limiteOperadoresRaw = limitesPlano.limiteOperadores;
  const limiteOperadoresIlimitado = limiteOperadoresRaw === null || Number(limiteOperadoresRaw) <= 0;
  const limiteOperadores = limiteOperadoresIlimitado ? 0 : Number(limiteOperadoresRaw || 20);
  const limiteUsuarios = Number(limitesPlano.maxUsuariosNoPlano || 0);

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

  const montarMensagemCobranca = (fatura) => {
    const razao = String(cliente?.razaoSocial || cliente?.nomeFantasia || "CLIENTE").trim();
    const ref = String(fatura?.refMes || "").trim();
    const valor = Number(fatura?.valor || 0);
    const venc = String(fatura?.vencimentoISO || "").trim();
    const pix = String(fatura?.pixChave || cliente?.pixChave || "").trim();
    const link = String(fatura?.linkPagamento || cliente?.linkPagamento || "").trim();

    const partes = [];
    partes.push(`COBRANCA - ${razao}`);
    if (ref) partes.push(`Referencia: ${ref}`);
    if (venc) {
      try {
        partes.push(`Vencimento: ${new Date(venc).toLocaleDateString("pt-BR")}`);
      } catch {
        partes.push(`Vencimento: ${venc}`);
      }
    }
    partes.push(`Valor: R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
    if (pix) partes.push(`PIX (chave): ${pix}`);
    if (link) partes.push(`Link: ${link}`);
    partes.push("Obrigado!");
    return partes.join("\n");
  };

  const abrirWhatsApp = (fatura) => {
    const tel = String(cliente?.telefone || "").replace(/\D/g, "");
    if (!tel) {
      alert("Telefone do cliente nao cadastrado. Cadastre em 'Empresa/Cliente' no Master.");
      return;
    }
    const msg = montarMensagemCobranca(fatura);
    const url = `https://wa.me/55${tel}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const abrirEmail = (fatura) => {
    const email = String(cliente?.emailEmpresa || cliente?.email || "").trim();
    if (!email) {
      alert("E-mail do cliente nao cadastrado.");
      return;
    }
    const assunto = `Fatura ${String(fatura?.refMes || "").trim() || ""}`.trim();
    const corpo = montarMensagemCobranca(fatura);
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
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
              <div style={{ marginBottom: 12, fontSize: 12, color: "#5b6d84" }}>
                Observação: as faturas são geradas pelo Master (gestão comercial). Aqui você apenas consulta e abre a cobrança.
              </div>
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
                    {faturasFiltradas.map((item) => (
                      <tr key={String(item.id)} style={{ background: item.hojeMes ? "#fbfdff" : "#fff" }}>
                        <td style={{ padding: 12, borderBottom: "1px solid #eef2f8" }}>{item.referencia}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #eef2f8" }}>
                          {item.vencimentoISO ? new Date(item.vencimentoISO).toLocaleDateString("pt-BR") : "-"}
                        </td>
                        <td style={{ padding: 12, borderBottom: "1px solid #eef2f8" }}>{badgeStatus(item.status)}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #eef2f8" }}>
                          {`R$ ${Number(item.valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
                        </td>
                        <td style={{ padding: 12, borderBottom: "1px solid #eef2f8" }}>
                          {item.notaFiscalUrl ? (
                            <a href={String(item.notaFiscalUrl)} target="_blank" rel="noreferrer" style={{ color: "#1d61e7" }}>
                              Visualizar nota
                            </a>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td style={{ padding: 12, borderBottom: "1px solid #eef2f8" }}>
                          <button
                            type="button"
                            onClick={() => setFaturaAberta(item)}
                            style={{ border: "none", background: "#1d61e7", color: "#fff", borderRadius: 8, padding: "8px 12px", fontWeight: "bold", cursor: "pointer" }}
                          >
                            Abrir
                          </button>
                        </td>
                      </tr>
                    ))}
                    {faturasFiltradas.length === 0 && (
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

        {faturaAberta && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.45)",
              zIndex: 20000,
              display: "grid",
              placeItems: "center",
              padding: 14
            }}
            onClick={() => setFaturaAberta(null)}
            role="presentation"
          >
            <div
              style={{
                width: "min(720px, 96vw)",
                background: "#fff",
                borderRadius: 12,
                border: "1px solid #dbe3ee",
                boxShadow: "0 18px 40px rgba(15, 36, 64, 0.25)",
                padding: 16
              }}
              onClick={(e) => e.stopPropagation()}
              role="presentation"
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: "#10243e" }}>Fatura</div>
                  <div style={{ marginTop: 2, color: "#546a84", fontSize: 13 }}>
                    Ref: <strong>{String(faturaAberta?.refMes || "-")}</strong>{" "}
                    {faturaAberta?.status ? <>| {badgeStatus(String(faturaAberta.status).toUpperCase())}</> : null}
                  </div>
                </div>
                <button
                  type="button"
                  style={{ border: "none", background: "#e9eef6", color: "#10243e", borderRadius: 8, padding: "8px 12px", fontWeight: "bold", cursor: "pointer" }}
                  onClick={() => setFaturaAberta(null)}
                >
                  Fechar
                </button>
              </div>

              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                {linhaPlano("Valor", `R$ ${Number(faturaAberta?.valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`)}
                {linhaPlano("Vencimento", faturaAberta?.vencimentoISO ? new Date(faturaAberta.vencimentoISO).toLocaleDateString("pt-BR") : "-")}
                {linhaPlano("Forma", String(faturaAberta?.formaPagamento || formaPagamento || "PIX").toUpperCase())}
              </div>

              <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                {(() => {
                  const pix = String(faturaAberta?.pixChave || cliente?.pixChave || "").trim();
                  const link = String(faturaAberta?.linkPagamento || cliente?.linkPagamento || "").trim();
                  return (
                    <>
                      {pix ? (
                        <div style={{ border: "1px solid #e6ecf5", borderRadius: 10, padding: 12, background: "#fbfdff" }}>
                          <div style={{ fontSize: 12, color: "#5b6d84", marginBottom: 6 }}>PIX (chave)</div>
                          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                            <code style={{ padding: "6px 10px", background: "#eef4ff", border: "1px solid #cfe0ff", borderRadius: 8 }}>{pix}</code>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(pix);
                                  alert("Chave PIX copiada.");
                                } catch {
                                  alert("Nao foi possivel copiar automaticamente. Copie manualmente.");
                                }
                              }}
                              style={{ border: "none", background: "#1d61e7", color: "#fff", borderRadius: 8, padding: "8px 12px", fontWeight: "bold", cursor: "pointer" }}
                            >
                              Copiar PIX
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {link ? (
                        <div style={{ border: "1px solid #e6ecf5", borderRadius: 10, padding: 12, background: "#fbfdff" }}>
                          <div style={{ fontSize: 12, color: "#5b6d84", marginBottom: 6 }}>Link de pagamento</div>
                          <a href={link} target="_blank" rel="noreferrer" style={{ color: "#1d61e7", wordBreak: "break-all" }}>
                            {link}
                          </a>
                        </div>
                      ) : null}
                    </>
                  );
                })()}
              </div>

              <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => abrirWhatsApp(faturaAberta)}
                  style={{ border: "none", background: "#25D366", color: "#0b1a12", borderRadius: 8, padding: "10px 14px", fontWeight: "bold", cursor: "pointer" }}
                >
                  WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => abrirEmail(faturaAberta)}
                  style={{ border: "none", background: "#10243e", color: "#fff", borderRadius: 8, padding: "10px 14px", fontWeight: "bold", cursor: "pointer" }}
                >
                  E-mail
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default FinanceiroCliente;


