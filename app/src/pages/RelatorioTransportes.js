/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { db } from "../firebase";
import { registrarHistorico } from "../utils/historico";
import { formatoLogoPdf, resolverLogoPdf } from "../utils/pdfLogo";
import { belongsToTenant, getConfigDocId, getTenantId } from "../utils/tenant";

const COLECAO = "romaneiosTransporte";

function RelatorioTransportes({ setTela }) {
  const tenantId = getTenantId();
  const [empresaSistema, setEmpresaSistema] = useState(null);
  const [lista, setLista] = useState([]);
  const [filtroDataIni, setFiltroDataIni] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");
  const [filtroMaterial, setFiltroMaterial] = useState("");
  const [filtroCaminhao, setFiltroCaminhao] = useState("");
  const [filtroMotorista, setFiltroMotorista] = useState("");
  const [filtroOrigem, setFiltroOrigem] = useState("");
  const [filtroDestino, setFiltroDestino] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("");

  const normalizar = (valor) => String(valor || "").trim().toUpperCase();

  const parseIso = (valor) => {
    const txt = String(valor || "").trim();
    if (!txt) return null;
    const d = new Date(txt);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const dataBr = (valor) => {
    const d = parseIso(valor);
    return d ? d.toLocaleString("pt-BR") : "-";
  };

  const formatarLocalizacao = (local) => {
    const lat = Number(local?.lat);
    const lng = Number(local?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "Nao informada";
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  };

  const linkMapa = (local) => {
    const lat = Number(local?.lat);
    const lng = Number(local?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
    return `https://www.google.com/maps?q=${lat},${lng}`;
  };

  const carregar = async () => {
    const [snap, snapCfg] = await Promise.all([
      getDocs(collection(db, COLECAO)),
      getDoc(doc(db, "configuracoes", getConfigDocId(tenantId)))
    ]);
    const dados = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId))
      .sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")));
    setLista(dados);
    if (snapCfg.exists()) setEmpresaSistema(snapCfg.data());
  };

  useEffect(() => {
    carregar();
  }, []);

  const opcoesMaterial = useMemo(
    () => Array.from(new Set(lista.map((item) => String(item.materialLabel || item.material || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [lista]
  );
  const opcoesCaminhao = useMemo(
    () => Array.from(new Set(lista.map((item) => String(item.caminhaoNome || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [lista]
  );
  const opcoesMotorista = useMemo(
    () => Array.from(new Set(lista.map((item) => String(item.motorista || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [lista]
  );
  const opcoesOrigem = useMemo(
    () => Array.from(new Set(lista.map((item) => String(item.origem || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [lista]
  );
  const opcoesDestino = useMemo(
    () => Array.from(new Set(lista.map((item) => String(item.destino || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [lista]
  );

  const filtrada = useMemo(() => {
    const dtIni = filtroDataIni ? new Date(`${filtroDataIni}T00:00:00`) : null;
    const dtFim = filtroDataFim ? new Date(`${filtroDataFim}T23:59:59`) : null;

    return lista.filter((item) => {
      const d = parseIso(item.dataHoraSaida || item.criadoEm);
      if (dtIni && (!d || d < dtIni)) return false;
      if (dtFim && (!d || d > dtFim)) return false;
      if (filtroMaterial && String(item.materialLabel || item.material || "").trim() !== filtroMaterial) return false;
      if (filtroCaminhao && String(item.caminhaoNome || "").trim() !== filtroCaminhao) return false;
      if (filtroMotorista && String(item.motorista || "").trim() !== filtroMotorista) return false;
      if (filtroOrigem && String(item.origem || "").trim() !== filtroOrigem) return false;
      if (filtroDestino && String(item.destino || "").trim() !== filtroDestino) return false;
      if (filtroStatus && normalizar(item.status) !== normalizar(filtroStatus)) return false;
      return true;
    });
  }, [lista, filtroDataIni, filtroDataFim, filtroMaterial, filtroCaminhao, filtroMotorista, filtroOrigem, filtroDestino, filtroStatus]);

  const resumo = useMemo(() => {
    const porMaterial = {};
    const porCaminhao = {};

    filtrada.forEach((item) => {
      const mat = String(item.materialLabel || item.material || "-").trim() || "-";
      const cam = String(item.caminhaoNome || "-").trim() || "-";
      const qtd = Number(item.quantidade || 0);

      if (!porMaterial[mat]) porMaterial[mat] = { viagens: 0, quantidade: 0, unidade: item.unidade || "" };
      porMaterial[mat].viagens += 1;
      porMaterial[mat].quantidade += qtd;
      if (!porMaterial[mat].unidade) porMaterial[mat].unidade = item.unidade || "";

      if (!porCaminhao[cam]) porCaminhao[cam] = 0;
      porCaminhao[cam] += 1;
    });

    return {
      totalRegistros: filtrada.length,
      emTransito: filtrada.filter((item) => normalizar(item.status) === "EM_TRANSITO").length,
      recebidos: filtrada.filter((item) => normalizar(item.status) === "RECEBIDO").length,
      divergencias: filtrada.filter((item) => normalizar(item.status) === "DIVERGENCIA").length,
      saidasSimples: filtrada.filter((item) => normalizar(item.status) === "SAIDA_SIMPLES_CONCLUIDA").length,
      porMaterial,
      porCaminhao
    };
  }, [filtrada]);

  const gerarPDF = async () => {
    const pdf = new jsPDF("landscape", "mm", "a4");
    const largura = pdf.internal.pageSize.getWidth();
    const logoPdf = await resolverLogoPdf(empresaSistema);

    if (logoPdf) {
      try {
        pdf.addImage(logoPdf, formatoLogoPdf(logoPdf), 14, 8, 30, 14);
      } catch {
        // noop
      }
    }

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    pdf.text("RELATORIO DE TRANSPORTES", largura / 2, 14, { align: "center" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, largura / 2, 20, { align: "center" });

    autoTable(pdf, {
      startY: 26,
      head: [["Registros", "Em transito", "Recebidos", "Divergencias", "Saidas simples", "Periodo"]],
      body: [[
        String(resumo.totalRegistros),
        String(resumo.emTransito),
        String(resumo.recebidos),
        String(resumo.divergencias),
        String(resumo.saidasSimples),
        `${filtroDataIni || "-"} ate ${filtroDataFim || "-"}`
      ]],
      theme: "grid",
      styles: { fontSize: 8, halign: "center" },
      headStyles: { fillColor: [95, 61, 196], textColor: 255 }
    });

    autoTable(pdf, {
      startY: (pdf.lastAutoTable?.finalY || 30) + 4,
      head: [["Data/hora", "Numero", "Material", "Qtd", "Unid.", "Origem", "Destino", "Loc. saida", "Loc. receb.", "Caminhao", "Motorista", "Status"]],
      body: filtrada.map((item) => [
        dataBr(item.dataHoraSaida || item.criadoEm),
        item.numero || "-",
        item.materialLabel || item.material || "-",
        String(item.quantidade || 0),
        item.unidade || "-",
        item.origem || "-",
        item.destino || "-",
        formatarLocalizacao(item.localSaida),
        formatarLocalizacao(item.localRecebimento),
        item.caminhaoNome || "-",
        item.motorista || "-",
        item.status || "-"
      ]),
      theme: "grid",
      styles: { fontSize: 8 },
      headStyles: { fillColor: [95, 61, 196], textColor: 255 },
      alternateRowStyles: { fillColor: [247, 245, 255] }
    });

    pdf.save("relatorio_transportes.pdf");
    registrarHistorico({
      modulo: "TRANSPORTE",
      acao: "GEROU_PDF",
      entidade: "RELATORIO_TRANSPORTES",
      registroId: "pdf-relatorio-transportes",
      descricao: "Gerou relatorio PDF de transportes."
    });
  };

  const card = {
    background: "#fff",
    border: "1px solid #e3e7ef",
    borderRadius: 8,
    padding: 14,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)"
  };

  const input = {
    width: "100%",
    height: 40,
    borderRadius: 8,
    border: "1px solid #cfd7e3",
    padding: "0 10px",
    boxSizing: "border-box"
  };

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "18px 10px 28px", background: "#f3f5f8" }}>
      <div style={{ ...card, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, color: "#0f2440" }}>Relatorio de Transportes</h2>
        <button
          type="button"
          onClick={() => setTela("home")}
          style={{ background: "#6c757d", border: "none", color: "#fff", borderRadius: 8, padding: "10px 14px", fontWeight: "bold", cursor: "pointer" }}
        >
          Voltar
        </button>
      </div>

      <div style={{ ...card, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0, color: "#10243e" }}>Filtros</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 10 }}>
          <div>
            <label style={{ fontSize: 12, color: "#5a6b82" }}>Data inicio</label>
            <input style={input} type="date" value={filtroDataIni} onChange={(e) => setFiltroDataIni(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#5a6b82" }}>Data fim</label>
            <input style={input} type="date" value={filtroDataFim} onChange={(e) => setFiltroDataFim(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#5a6b82" }}>Material</label>
            <select style={input} value={filtroMaterial} onChange={(e) => setFiltroMaterial(e.target.value)}>
              <option value="">Todos</option>
              {opcoesMaterial.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#5a6b82" }}>Caminhao</label>
            <select style={input} value={filtroCaminhao} onChange={(e) => setFiltroCaminhao(e.target.value)}>
              <option value="">Todos</option>
              {opcoesCaminhao.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#5a6b82" }}>Motorista</label>
            <select style={input} value={filtroMotorista} onChange={(e) => setFiltroMotorista(e.target.value)}>
              <option value="">Todos</option>
              {opcoesMotorista.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#5a6b82" }}>Origem</label>
            <select style={input} value={filtroOrigem} onChange={(e) => setFiltroOrigem(e.target.value)}>
              <option value="">Todas</option>
              {opcoesOrigem.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#5a6b82" }}>Destino</label>
            <select style={input} value={filtroDestino} onChange={(e) => setFiltroDestino(e.target.value)}>
              <option value="">Todos</option>
              {opcoesDestino.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#5a6b82" }}>Status</label>
            <select style={input} value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
              <option value="">Todos</option>
              <option value="EM_TRANSITO">EM TRANSITO</option>
              <option value="RECEBIDO">RECEBIDO</option>
              <option value="DIVERGENCIA">DIVERGENCIA</option>
              <option value="SAIDA_SIMPLES_CONCLUIDA">SAIDA SIMPLES CONCLUIDA</option>
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            style={{ background: "#5f3dc4", border: "none", color: "#fff", borderRadius: 8, padding: "10px 14px", fontWeight: "bold", cursor: "pointer" }}
            onClick={gerarPDF}
          >
            Gerar PDF
          </button>
          <button
            style={{ background: "#6c757d", border: "none", color: "#fff", borderRadius: 8, padding: "10px 14px", fontWeight: "bold", cursor: "pointer" }}
            onClick={() => {
              setFiltroDataIni("");
              setFiltroDataFim("");
              setFiltroMaterial("");
              setFiltroCaminhao("");
              setFiltroMotorista("");
              setFiltroOrigem("");
              setFiltroDestino("");
              setFiltroStatus("");
            }}
          >
            Limpar filtros
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 12 }}>
        <div style={card}><strong>Registros:</strong> {resumo.totalRegistros}</div>
        <div style={card}><strong>Em transito:</strong> {resumo.emTransito}</div>
        <div style={card}><strong>Recebidos:</strong> {resumo.recebidos}</div>
        <div style={card}><strong>Divergencias:</strong> {resumo.divergencias}</div>
        <div style={card}><strong>Saidas simples:</strong> {resumo.saidasSimples}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 12 }}>
        <div style={card}>
          <h3 style={{ marginTop: 0, color: "#10243e" }}>Resumo por material</h3>
          {Object.keys(resumo.porMaterial).length === 0 && <div style={{ color: "#5a6b82" }}>Sem dados.</div>}
          {Object.entries(resumo.porMaterial).map(([material, dados]) => (
            <div key={material} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 0", borderBottom: "1px solid #eef1f5" }}>
              <strong>{material}</strong>
              <span>{`${dados.quantidade} ${dados.unidade || ""} | ${dados.viagens} viagem(ns)`}</span>
            </div>
          ))}
        </div>
        <div style={card}>
          <h3 style={{ marginTop: 0, color: "#10243e" }}>Resumo por caminhao</h3>
          {Object.keys(resumo.porCaminhao).length === 0 && <div style={{ color: "#5a6b82" }}>Sem dados.</div>}
          {Object.entries(resumo.porCaminhao).map(([caminhao, viagens]) => (
            <div key={caminhao} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 0", borderBottom: "1px solid #eef1f5" }}>
              <strong>{caminhao}</strong>
              <span>{`${viagens} viagem(ns)`}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0, color: "#10243e" }}>Detalhamento</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1120 }}>
            <thead style={{ background: "#5f3dc4", color: "#fff" }}>
              <tr>
                {["Data/hora", "Numero", "Material", "Qtd", "Unid.", "Origem", "Destino", "Localizacoes", "Caminhao", "Motorista", "Status", "Recebedor"].map((titulo) => (
                  <th key={titulo} style={{ padding: 8, border: "1px solid #d8e0ea", textAlign: "center", fontSize: 13 }}>{titulo}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!filtrada.length && (
                <tr>
                  <td colSpan="12" style={{ padding: 12, textAlign: "center", border: "1px solid #e5ebf3", color: "#5a6b82" }}>
                    Nenhum transporte encontrado.
                  </td>
                </tr>
              )}
              {filtrada.map((item, idx) => (
                <tr key={item.id} style={{ background: idx % 2 === 0 ? "#faf8ff" : "#fff" }}>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3" }}>{dataBr(item.dataHoraSaida || item.criadoEm)}</td>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3", fontWeight: 800 }}>{item.numero || "-"}</td>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3" }}>{item.materialLabel || item.material || "-"}</td>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3", textAlign: "center" }}>{item.quantidade || "-"}</td>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3", textAlign: "center" }}>{item.unidade || "-"}</td>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3" }}>{item.origem || "-"}</td>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3" }}>{item.destino || "-"}</td>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3", fontSize: 12 }}>
                    <div><strong>Saida:</strong> {formatarLocalizacao(item.localSaida)}</div>
                    {linkMapa(item.localSaida) && (
                      <div><a href={linkMapa(item.localSaida)} target="_blank" rel="noreferrer">Mapa saida</a></div>
                    )}
                    <div style={{ marginTop: 4 }}><strong>Receb.:</strong> {formatarLocalizacao(item.localRecebimento)}</div>
                    {linkMapa(item.localRecebimento) && (
                      <div><a href={linkMapa(item.localRecebimento)} target="_blank" rel="noreferrer">Mapa receb.</a></div>
                    )}
                  </td>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3" }}>{item.caminhaoNome || "-"}</td>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3" }}>{item.motorista || "-"}</td>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3", fontWeight: 800 }}>{item.status || "-"}</td>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3" }}>{item.recebedor || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default RelatorioTransportes;
