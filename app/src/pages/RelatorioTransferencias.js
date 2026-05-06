/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";
import { db } from "../firebase";
import { registrarHistorico } from "../utils/historico";
import { formatoLogoPdf, resolverLogoPdf } from "../utils/pdfLogo";
import { getPreferredPublicOrigin } from "../utils/publicUrl";
import { belongsToTenant, getConfigDocId, getTenantId } from "../utils/tenant";

function RelatorioTransferencias() {
  const tenantId = getTenantId();
  const sessaoOperacional = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("sessaoOperacional") || "{}");
    } catch {
      return {};
    }
  }, []);
  const perfilSessao = String(sessaoOperacional?.perfilAcesso || "").trim().toUpperCase();
  const usuarioChaveSessao = Boolean(sessaoOperacional?.usuarioChave);
  const podeGerenciarStatus = perfilSessao === "GESTOR_GERAL" || perfilSessao === "ADMIN_UNIDADE" || usuarioChaveSessao;
  const usuarioNome = String(sessaoOperacional?.nome || sessaoOperacional?.email || sessaoOperacional?.cpf || "-").trim().toUpperCase();

  const [empresaSistema, setEmpresaSistema] = useState(null);
  const [boletins, setBoletins] = useState([]);
  const [linhas, setLinhas] = useState([]);
  const [itensDescricao, setItensDescricao] = useState([]);
  const [origens, setOrigens] = useState([]);
  const [destinos, setDestinos] = useState([]);
  const [filtroDataIni, setFiltroDataIni] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");
  const [filtroItem, setFiltroItem] = useState("");
  const [filtroOrigem, setFiltroOrigem] = useState("");
  const [filtroDestino, setFiltroDestino] = useState("");
  const [boletimSelecionado, setBoletimSelecionado] = useState(null);
  const [selecionados, setSelecionados] = useState(() => new Set()); // numeros de boletim
  const [processandoLote, setProcessandoLote] = useState(false);

  const normalizar = (valor) => String(valor || "").trim().toUpperCase();
  const moeda = (valor) =>
    Number(valor || 0).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

  const parseData = (valor) => {
    const txt = String(valor || "").trim();
    const br = txt.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
    const iso = txt.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return null;
  };

  const formatarData = (valor) => {
    const d = parseData(valor);
    if (!d) return String(valor || "-");
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  };
  const formatarDataFiltro = (valor) => (valor ? formatarData(valor) : "-");

  const seloStatus = (statusRaw, assinaturaRecebedor) => {
    const status = String(statusRaw || "PENDENTE").trim().toUpperCase();
    const temAss = Boolean(String(assinaturaRecebedor || "").trim());

    if (status === "RECEBIDO" && temAss) {
      return { label: "RECEBIDO + ASS.", bg: "#d1e7dd", fg: "#0f5132", border: "#badbcc" };
    }
    if (status === "RECEBIDO" && !temAss) {
      return { label: "RECEBIDO (S/ ASS.)", bg: "#fff3cd", fg: "#664d03", border: "#ffecb5" };
    }
    if (status === "CANCELADO") {
      return { label: "CANCELADO", bg: "#e9ecef", fg: "#343a40", border: "#dee2e6" };
    }
    return { label: "PENDENTE", bg: "#f8d7da", fg: "#842029", border: "#f5c2c7" };
  };

  const carregar = async () => {
    const [snapBoletins, snapCfg] = await Promise.all([
      getDocs(collection(db, "boletinsTransferencia")),
      getDoc(doc(db, "configuracoes", getConfigDocId(tenantId)))
    ]);

    const boletinsLista = snapBoletins.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId))
      .sort((a, b) => new Date(b.dataCriacao || 0) - new Date(a.dataCriacao || 0));

    setBoletins(boletinsLista);

    const linhasBoletim = boletinsLista.flatMap((boletim) =>
      (Array.isArray(boletim.itens) ? boletim.itens : []).map((item, idx) => ({
        id: `${boletim.id}-${idx + 1}`,
        numeroBoletim: boletim.numeroBoletim || "",
        data: boletim.data || "",
        origem: boletim.origem || "",
        destino: boletim.destino || "",
        motivo: boletim.motivo || "",
        statusRecebimento: boletim.statusRecebimento || "PENDENTE",
        transportador: boletim.transportador || "",
        placaVeiculo: boletim.placaVeiculo || "",
        codigoTransporte: boletim.codigoTransporte || "",
        descricaoItem: item.descricao || "",
        codigoItem: item.codigo || "",
        quantidade: Number(item.quantidade || 0),
        valorUnitario: Number(item.valorUnitario || 0),
        valorTotal: Number(item.valorTotal || 0),
        observacao: item.observacao || boletim.observacaoGeral || ""
      }))
    );

    setLinhas(linhasBoletim);
    setItensDescricao(Array.from(new Set(linhasBoletim.map((l) => l.descricaoItem).filter(Boolean))).sort((a, b) => a.localeCompare(b)));
    setOrigens(Array.from(new Set(linhasBoletim.map((l) => l.origem).filter(Boolean))).sort((a, b) => a.localeCompare(b)));
    setDestinos(Array.from(new Set(linhasBoletim.map((l) => l.destino).filter(Boolean))).sort((a, b) => a.localeCompare(b)));

    if (snapCfg.exists()) setEmpresaSistema(snapCfg.data());
  };

  useEffect(() => {
    carregar();
  }, []);

  const listaFiltrada = useMemo(() => {
    const dtIni = filtroDataIni ? new Date(`${filtroDataIni}T00:00:00`) : null;
    const dtFim = filtroDataFim ? new Date(`${filtroDataFim}T23:59:59`) : null;

    return linhas.filter((item) => {
      const data = parseData(item.data);
      if (dtIni && (!data || data < dtIni)) return false;
      if (dtFim && (!data || data > dtFim)) return false;
      if (filtroItem && item.descricaoItem !== filtroItem) return false;
      if (filtroOrigem && item.origem !== filtroOrigem) return false;
      if (filtroDestino && item.destino !== filtroDestino) return false;
      return true;
    });
  }, [linhas, filtroDataIni, filtroDataFim, filtroItem, filtroOrigem, filtroDestino]);

  const boletimPorNumero = useMemo(() => {
    const map = new Map();
    boletins.forEach((b) => {
      const num = String(b.numeroBoletim || "").trim();
      if (num) map.set(num, b);
    });
    return map;
  }, [boletins]);

  const numerosVisiveis = useMemo(() => {
    return Array.from(new Set(listaFiltrada.map((l) => String(l.numeroBoletim || "").trim()).filter(Boolean)));
  }, [listaFiltrada]);

  useEffect(() => {
    // limpa selecao de boletins que nao estao mais visiveis (por filtros)
    setSelecionados((prev) => {
      if (!prev || prev.size === 0) return prev;
      const vis = new Set(numerosVisiveis);
      const novo = new Set();
      prev.forEach((n) => {
        const key = String(n || "").trim();
        if (vis.has(key)) novo.add(key);
      });
      return novo;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numerosVisiveis]);

  const alternarSelecionado = (numero) => {
    const key = String(numero || "").trim();
    if (!key) return;
    setSelecionados((prev) => {
      const novo = new Set(prev || []);
      if (novo.has(key)) novo.delete(key);
      else novo.add(key);
      return novo;
    });
  };

  const selecionarTodos = () => setSelecionados(new Set(numerosVisiveis));
  const limparSelecao = () => setSelecionados(new Set());

  const pdfSelecionados = async () => {
    const nums = Array.from(selecionados || []);
    if (!nums.length) return;
    setProcessandoLote(true);
    try {
      for (const n of nums) {
        const b = boletimPorNumero.get(String(n));
        if (!b) continue;
        // eslint-disable-next-line no-await-in-loop
        await gerarPdfDoBoletim(b);
      }
    } finally {
      setProcessandoLote(false);
    }
  };

  const baixarSelecionados = async () => {
    const nums = Array.from(selecionados || []);
    if (!nums.length) return;
    if (!podeGerenciarStatus) {
      alert("Sem permissao para dar baixa em boletins.");
      return;
    }
    if (!window.confirm(`Dar baixa (RECEBIDO) em ${nums.length} boletim(ns) selecionado(s)?`)) return;

    setProcessandoLote(true);
    try {
      for (const n of nums) {
        const b = boletimPorNumero.get(String(n));
        if (!b?.id) continue;
        const statusAtual = String(b.statusRecebimento || "PENDENTE").trim().toUpperCase();
        if (statusAtual === "CANCELADO") continue;
        if (statusAtual === "RECEBIDO") continue;
        // eslint-disable-next-line no-await-in-loop
        await updateDoc(doc(db, "boletinsTransferencia", b.id), {
          statusRecebimento: "RECEBIDO",
          recebidoEm: new Date().toISOString(),
          recebidoPor: usuarioNome
        });
        // eslint-disable-next-line no-await-in-loop
        await registrarHistorico({
          modulo: "TRANSFERENCIA",
          acao: "BAIXOU",
          entidade: "BOLETIM_TRANSFERENCIA",
          registroId: b.id,
          usuario: usuarioNome,
          descricao: `Deu baixa no boletim ${String(b.numeroBoletim || "-")}.`
        });
      }
      alert("Baixa concluida.");
      limparSelecao();
      await carregar();
    } catch (e) {
      alert(`Falha ao dar baixa. Detalhes: ${String(e?.message || e || "")}`);
    } finally {
      setProcessandoLote(false);
    }
  };

  const cancelarSelecionados = async () => {
    const nums = Array.from(selecionados || []);
    if (!nums.length) return;
    if (!podeGerenciarStatus) {
      alert("Sem permissao para cancelar boletins.");
      return;
    }
    if (!window.confirm(`Cancelar ${nums.length} boletim(ns) selecionado(s)? (Somente PENDENTES serao cancelados)`)) return;

    setProcessandoLote(true);
    try {
      for (const n of nums) {
        const b = boletimPorNumero.get(String(n));
        if (!b?.id) continue;
        const statusAtual = String(b.statusRecebimento || "PENDENTE").trim().toUpperCase();
        if (statusAtual !== "PENDENTE") continue;
        // eslint-disable-next-line no-await-in-loop
        await updateDoc(doc(db, "boletinsTransferencia", b.id), {
          statusRecebimento: "CANCELADO",
          canceladoEm: new Date().toISOString(),
          canceladoPor: usuarioNome
        });
        // eslint-disable-next-line no-await-in-loop
        await registrarHistorico({
          modulo: "TRANSFERENCIA",
          acao: "CANCELOU",
          entidade: "BOLETIM_TRANSFERENCIA",
          registroId: b.id,
          usuario: usuarioNome,
          descricao: `Cancelou o boletim ${String(b.numeroBoletim || "-")}.`
        });
      }
      alert("Cancelamento concluido.");
      limparSelecao();
      await carregar();
    } catch (e) {
      alert(`Falha ao cancelar. Detalhes: ${String(e?.message || e || "")}`);
    } finally {
      setProcessandoLote(false);
    }
  };

  const gerarPdfDoBoletim = async (boletim) => {
    if (!boletim) return;

    const pdf = new jsPDF("portrait", "mm", "a4");
    const larguraPagina = pdf.internal.pageSize.getWidth();
    const margem = { left: 10, right: 10 };

    const logoPdf = await resolverLogoPdf(empresaSistema);
    if (logoPdf) {
      try {
        pdf.addImage(logoPdf, formatoLogoPdf(logoPdf), margem.left, 10, 28, 14);
      } catch {
        // noop
      }
    }

    pdf.setFont(undefined, "bold");
    pdf.setFontSize(14);
    pdf.text("BOLETIM DE TRANSFERENCIA", larguraPagina / 2, 18, { align: "center" });
    pdf.setFont(undefined, "normal");
    pdf.setFontSize(9);
    pdf.text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`, larguraPagina - margem.right, 24, { align: "right" });

    // QR Code no PDF (para leitura no destino pelo papel impresso).
    let qrDataUrl = "";
    const qrText = boletim?.id ? `EG_TRANSFER|${tenantId}|${String(boletim.id).trim()}` : "";
    try {
      if (boletim?.id) {
        const basePublica = getPreferredPublicOrigin();
        // QR URL curto para leitura facil em camera do iPhone.
        const qrUrl = `${basePublica}/qr/${encodeURIComponent(tenantId)}/${encodeURIComponent(String(boletim.id).trim())}`;
        qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 2, width: 800, errorCorrectionLevel: "H" });
      }
    } catch {
      qrDataUrl = "";
    }
    if (qrDataUrl) {
      try {
        const qrSize = 32;
        pdf.addImage(qrDataUrl, "PNG", larguraPagina - margem.right - qrSize, 10, qrSize, qrSize);
      } catch {
        // noop
      }
    }

    // Código manual (fallback) para colar no campo caso a camera do navegador falhe.
    if (qrText) {
      try {
        pdf.setFontSize(7.6);
        pdf.text(`COD: ${qrText}`, larguraPagina - margem.right, 28.4, { align: "right" });
        pdf.setFontSize(9);
      } catch {
        // noop
      }
    }

    const topo = 30;
    pdf.setDrawColor(200, 210, 225);
    pdf.rect(10, topo, larguraPagina - 20, 30);
    pdf.setFontSize(10);
    pdf.setFont(undefined, "bold");
    pdf.text(`Data: ${formatarData(boletim.data)}   |   Nr: ${boletim.numeroBoletim || "-"}`, 12, topo + 7);
    pdf.text(`Origem: ${normalizar(boletim.origem) || "-"}   |   Destino: ${normalizar(boletim.destino) || "-"}`, 12, topo + 14);
    pdf.setFont(undefined, "normal");
    pdf.text(`Status: ${String(boletim.statusRecebimento || "PENDENTE").toUpperCase()}   |   Motivo: ${String(boletim.motivo || "-").toUpperCase()}`, 12, topo + 20);
    pdf.text(
      `Transportador: ${String(boletim.transportador || "-").toUpperCase()}   |   Placa: ${String(boletim.placaVeiculo || "-").toUpperCase()}   |   Cod: ${String(boletim.codigoTransporte || "-").toUpperCase()}`,
      12,
      topo + 26
    );

    const itens = Array.isArray(boletim.itens) ? boletim.itens : [];
    autoTable(pdf, {
      startY: topo + 36,
      head: [["Item", "Código", "Qtd", "Vlr unit", "Vlr total", "Obs"]],
      body: itens.map((it) => ([
        String(it?.descricao || "-").toUpperCase(),
        String(it?.codigo || "-").toUpperCase(),
        String(Number(it?.quantidade || 0)),
        moeda(it?.valorUnitario || 0),
        moeda(it?.valorTotal || 0),
        String(it?.observacao || boletim.observacaoGeral || "-").toUpperCase()
      ])),
      theme: "grid",
      styles: { fontSize: 8, overflow: "linebreak" },
      headStyles: { fillColor: [11, 94, 215], textColor: 255 },
      alternateRowStyles: { fillColor: [244, 247, 252] }
    });

    // Assinatura do recebedor (se houver)
    try {
      const assinatura = String(boletim?.assinaturaRecebedor || "").trim();
      const status = String(boletim?.statusRecebimento || "").trim().toUpperCase();
      if (status === "RECEBIDO" && assinatura) {
        let y = (pdf.lastAutoTable?.finalY || (topo + 36)) + 8;
        const alturaPagina = pdf.internal.pageSize.getHeight();
        if (y + 28 > alturaPagina - 10) {
          pdf.addPage();
          y = 18;
        }
        pdf.setFont(undefined, "bold");
        pdf.setFontSize(10);
        pdf.text("ASSINATURA DO RECEBEDOR", 10, y);
        pdf.setFont(undefined, "normal");
        pdf.setFontSize(9);
        const recebidoPor = String(boletim.recebidoPor || "-").toUpperCase();
        const recebidoEm = boletim.recebidoEm ? new Date(boletim.recebidoEm).toLocaleString("pt-BR") : "-";
        pdf.text(`Recebido por: ${recebidoPor}  |  Data/hora: ${recebidoEm}`, 10, y + 5);

        const boxX = 10;
        const boxY = y + 7;
        const boxW = 90;
        const boxH = 18;
        pdf.setDrawColor(160);
        pdf.rect(boxX, boxY, boxW, boxH);
        try {
          pdf.addImage(assinatura, "PNG", boxX + 2, boxY + 2, boxW - 4, boxH - 4);
        } catch {
          // noop
        }
      }
    } catch {
      // noop
    }

    const statusNome = String(boletim.statusRecebimento || "PENDENTE").trim().toUpperCase();
    const nome = `BOLETIM_${String(boletim.numeroBoletim || "000").padStart(3, "0")}_${statusNome}_${formatarData(boletim.data).replaceAll("/", "-")}.pdf`;
    pdf.save(nome);
    registrarHistorico({
      modulo: "TRANSFERENCIA",
      acao: "GEROU_PDF",
      entidade: "BOLETIM_TRANSFERENCIA",
      registroId: boletim.id || "boletim",
      descricao: "Gerou segunda via (PDF) de um boletim de transferencia."
    });
  };

  const resumo = useMemo(() => {
    const total = listaFiltrada.reduce((acc, item) => acc + Number(item.valorTotal || 0), 0);
    return {
      totalLinhas: listaFiltrada.length,
      totalBoletins: new Set(listaFiltrada.map((item) => item.numeroBoletim)).size,
      totalValor: total
    };
  }, [listaFiltrada]);

  const thBase = {
    padding: 7,
    border: "1px solid #d8e0ea",
    textAlign: "center",
    fontSize: 13,
    letterSpacing: 0.2
  };
  const tdBase = {
    padding: 7,
    border: "1px solid #e5ebf3",
    fontSize: 13,
    verticalAlign: "middle"
  };
  const tdWrap = { ...tdBase, wordBreak: "break-word", whiteSpace: "normal" };

  const gerarPDF = async () => {
    const pdf = new jsPDF("landscape", "mm", "a4");
    const largura = pdf.internal.pageSize.getWidth();
    const logo = await resolverLogoPdf(empresaSistema);

    if (logo) {
      try {
        pdf.addImage(logo, formatoLogoPdf(logo), 14, 8, 30, 14);
      } catch {
        // noop
      }
    }

    pdf.setFontSize(15);
    pdf.setFont("helvetica", "bold");
    pdf.text("RELATORIO DE BOLETINS DE TRANSFERENCIA", largura / 2, 14, { align: "center" });
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    pdf.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, largura / 2, 20, { align: "center" });

    autoTable(pdf, {
      startY: 26,
      head: [["Linhas", "Boletins", "Valor total", "Período", "Origem", "Destino"]],
      body: [[
        String(resumo.totalLinhas),
        String(resumo.totalBoletins),
        `R$ ${moeda(resumo.totalValor)}`,
        `${formatarDataFiltro(filtroDataIni)} ate ${formatarDataFiltro(filtroDataFim)}`,
        filtroOrigem || "-",
        filtroDestino || "-"
      ]],
      theme: "grid",
      styles: { fontSize: 8, halign: "center" },
      headStyles: { fillColor: [11, 94, 215], textColor: 255 }
    });

    autoTable(pdf, {
      startY: (pdf.lastAutoTable?.finalY || 30) + 4,
      head: [[
        "Data",
        "Nr boletim",
        "Origem",
        "Destino",
        "Descrição item",
        "Código",
        "Qtd",
        "Vlr unit",
        "Vlr total",
        "Status"
      ]],
      body: listaFiltrada.map((item) => [
        formatarData(item.data),
        item.numeroBoletim || "-",
        item.origem || "-",
        item.destino || "-",
        item.descricaoItem || "-",
        item.codigoItem || "-",
        String(item.quantidade || 0),
        moeda(item.valorUnitario || 0),
        moeda(item.valorTotal || 0),
        item.statusRecebimento || "PENDENTE"
      ]),
      theme: "grid",
      styles: { fontSize: 8 },
      headStyles: { fillColor: [11, 94, 215], textColor: 255 },
      alternateRowStyles: { fillColor: [244, 247, 252] }
    });

    pdf.save("relatorio_boletins_transferencia.pdf");
    registrarHistorico({
      modulo: "TRANSFERENCIA",
      acao: "GEROU_PDF",
      entidade: "RELATORIO_TRANSFERENCIAS",
      registroId: "pdf-boletins-transferencia",
      descricao: "Gerou relatorio PDF de boletins de transferencia."
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
      <div style={{ ...card, marginBottom: 10 }}>
        <h2 style={{ margin: 0, color: "#0f2440" }}>Relatório de Boletins de Transferencia</h2>
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
            <label style={{ fontSize: 12, color: "#5a6b82" }}>Item</label>
            <select style={input} value={filtroItem} onChange={(e) => setFiltroItem(e.target.value)}>
              <option value="">Todos</option>
              {itensDescricao.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#5a6b82" }}>Origem</label>
            <select style={input} value={filtroOrigem} onChange={(e) => setFiltroOrigem(e.target.value)}>
              <option value="">Todas</option>
              {origens.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#5a6b82" }}>Destino</label>
            <select style={input} value={filtroDestino} onChange={(e) => setFiltroDestino(e.target.value)}>
              <option value="">Todos</option>
              {destinos.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            style={{ background: "#198754", border: "none", color: "#fff", borderRadius: 8, padding: "10px 14px", fontWeight: "bold", cursor: "pointer" }}
            onClick={gerarPDF}
          >
            Gerar PDF
          </button>
          <button
            style={{ background: "#6c757d", border: "none", color: "#fff", borderRadius: 8, padding: "10px 14px", fontWeight: "bold", cursor: "pointer" }}
            onClick={() => {
              setFiltroDataIni("");
              setFiltroDataFim("");
              setFiltroItem("");
              setFiltroOrigem("");
              setFiltroDestino("");
            }}
          >
            Limpar filtros
          </button>
        </div>
      </div>

      <div style={{ ...card, marginBottom: 12 }}>
        <strong>Linhas:</strong> {resumo.totalLinhas} |{" "}
        <strong>Boletins:</strong> {resumo.totalBoletins} |{" "}
        <strong>Valor total:</strong> R$ {moeda(resumo.totalValor)}
      </div>

      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontWeight: 900, color: "#0f2440" }}>
            Boletins selecionados: {Number(selecionados?.size || 0)}
          </div>
          <button
            type="button"
            onClick={selecionarTodos}
            disabled={!numerosVisiveis.length}
            style={{ background: "#0b5ed7", border: "none", color: "#fff", borderRadius: 8, padding: "10px 12px", fontWeight: 900, cursor: numerosVisiveis.length ? "pointer" : "not-allowed" }}
            title="Seleciona todos os boletins visiveis (respeita filtros)"
          >
            Selecionar todos
          </button>
          <button
            type="button"
            onClick={limparSelecao}
            disabled={!Number(selecionados?.size || 0)}
            style={{ background: "#6c757d", border: "none", color: "#fff", borderRadius: 8, padding: "10px 12px", fontWeight: 900, cursor: Number(selecionados?.size || 0) ? "pointer" : "not-allowed" }}
          >
            Limpar selecao
          </button>

          <div style={{ flex: "1 1 auto" }} />

          <button
            type="button"
            onClick={pdfSelecionados}
            disabled={!Number(selecionados?.size || 0) || processandoLote}
            style={{ background: "#198754", border: "none", color: "#fff", borderRadius: 8, padding: "10px 12px", fontWeight: 900, cursor: !Number(selecionados?.size || 0) || processandoLote ? "not-allowed" : "pointer" }}
          >
            {processandoLote ? "Processando..." : "PDF selecionados"}
          </button>
          <button
            type="button"
            onClick={baixarSelecionados}
            disabled={!podeGerenciarStatus || !Number(selecionados?.size || 0) || processandoLote}
            style={{ background: !podeGerenciarStatus ? "#cbd3dc" : "#f0ad4e", border: "none", color: "#000", borderRadius: 8, padding: "10px 12px", fontWeight: 900, cursor: !podeGerenciarStatus || !Number(selecionados?.size || 0) || processandoLote ? "not-allowed" : "pointer" }}
            title={!podeGerenciarStatus ? "Somente gestor/admin pode dar baixa" : "Marcar como RECEBIDO (em lote)"}
          >
            Dar baixa selecionados
          </button>
          <button
            type="button"
            onClick={cancelarSelecionados}
            disabled={!podeGerenciarStatus || !Number(selecionados?.size || 0) || processandoLote}
            style={{ background: !podeGerenciarStatus ? "#cbd3dc" : "#343a40", border: "none", color: "#fff", borderRadius: 8, padding: "10px 12px", fontWeight: 900, cursor: !podeGerenciarStatus || !Number(selecionados?.size || 0) || processandoLote ? "not-allowed" : "pointer" }}
            title={!podeGerenciarStatus ? "Somente gestor/admin pode cancelar" : "Cancelar (somente PENDENTES) em lote"}
          >
            Cancelar selecionados
          </button>
        </div>
      </div>

      {boletimSelecionado && (
        <div style={{ ...card, marginBottom: 12, borderColor: "#c9d7f0", background: "#f8fbff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontWeight: "bold", color: "#0f2440" }}>
              Detalhes do boletim {boletimSelecionado.numeroBoletim || "-"}
              <span
                style={(() => {
                  const s = seloStatus(boletimSelecionado.statusRecebimento, boletimSelecionado.assinaturaRecebedor);
                  return {
                    display: "inline-block",
                    marginLeft: 10,
                    padding: "6px 10px",
                    borderRadius: 999,
                    background: s.bg,
                    color: s.fg,
                    border: `1px solid ${s.border}`,
                    fontWeight: 900,
                    fontSize: 12,
                    letterSpacing: 0.2
                  };
                })()}
              >
                {seloStatus(boletimSelecionado.statusRecebimento, boletimSelecionado.assinaturaRecebedor).label}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => gerarPdfDoBoletim(boletimSelecionado)}
                style={{ background: "#198754", border: "none", color: "#fff", borderRadius: 8, padding: "10px 14px", fontWeight: "bold", cursor: "pointer" }}
              >
                PDF do boletim (2a via)
              </button>
              <button
                type="button"
                onClick={() => setBoletimSelecionado(null)}
                style={{ background: "#6c757d", border: "none", color: "#fff", borderRadius: 8, padding: "10px 14px", fontWeight: "bold", cursor: "pointer" }}
              >
                Fechar
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 10 }}>
            <div><strong>Data:</strong> {formatarData(boletimSelecionado.data)}</div>
            <div><strong>Status:</strong> {String(boletimSelecionado.statusRecebimento || "PENDENTE").toUpperCase()}</div>
            <div><strong>Origem:</strong> {normalizar(boletimSelecionado.origem) || "-"}</div>
            <div><strong>Destino:</strong> {normalizar(boletimSelecionado.destino) || "-"}</div>
            <div><strong>Motivo:</strong> {String(boletimSelecionado.motivo || "-").toUpperCase()}</div>
            <div><strong>Transportador:</strong> {String(boletimSelecionado.transportador || "-").toUpperCase()}</div>
            <div><strong>Placa:</strong> {String(boletimSelecionado.placaVeiculo || "-").toUpperCase()}</div>
            <div><strong>Código:</strong> {String(boletimSelecionado.codigoTransporte || "-").toUpperCase()}</div>
          </div>

          <div style={{ marginTop: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "46%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "12%" }} />
          </colgroup>
          <thead style={{ background: "#0b5ed7", color: "#fff" }}>
            <tr>
              {["Descrição", "Código", "Qtd", "Vlr Unit", "Vlr Total", "Obs"].map((t) => (
                <th key={t} style={{ padding: 8, border: "1px solid #d8e0ea" }}>{t}</th>
              ))}
            </tr>
          </thead>
              <tbody>
                {(Array.isArray(boletimSelecionado.itens) ? boletimSelecionado.itens : []).map((it, idx) => (
                  <tr key={idx} style={{ background: idx % 2 === 0 ? "#ffffff" : "#f3f7ff" }}>
                    <td style={tdWrap}>{String(it?.descricao || "-").toUpperCase()}</td>
                    <td style={{ ...tdWrap, textAlign: "center" }}>{String(it?.codigo || "-").toUpperCase()}</td>
                    <td style={{ ...tdBase, textAlign: "center" }}>{Number(it?.quantidade || 0)}</td>
                    <td style={{ ...tdBase, textAlign: "right" }}>{moeda(it?.valorUnitario || 0)}</td>
                    <td style={{ ...tdBase, textAlign: "right", fontWeight: "bold" }}>{moeda(it?.valorTotal || 0)}</td>
                    <td style={tdWrap}>{String(it?.observacao || boletimSelecionado.observacaoGeral || "-").toUpperCase()}</td>
                  </tr>
                ))}
                {!(Array.isArray(boletimSelecionado.itens) && boletimSelecionado.itens.length) && (
                  <tr>
                    <td colSpan={6} style={{ padding: 10, textAlign: "center", color: "#6c757d" }}>Sem itens neste boletim.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginTop: 12 }}>
            <div style={{ border: "1px solid #d8e0ea", borderRadius: 10, padding: 12, background: "#fff" }}>
              <div style={{ fontWeight: 900, color: "#0f2440", marginBottom: 8 }}>Responsaveis</div>
              <div style={{ display: "grid", gap: 6, color: "#2f4665", fontSize: 13 }}>
                <div><strong>Solicitado por:</strong> {String(boletimSelecionado.solicitadoPor || "-").toUpperCase()}</div>
                <div><strong>Autorizado por:</strong> {String(boletimSelecionado.autorizadoPor || "-").toUpperCase()}</div>
                <div><strong>Preenchido por:</strong> {String(boletimSelecionado.preenchidoPor || boletimSelecionado.criadoPor || "-").toUpperCase()}</div>
                <div><strong>Recebido por:</strong> {String(boletimSelecionado.recebidoPor || "-").toUpperCase()}</div>
                <div>
                  <strong>Recebido em:</strong>{" "}
                  {boletimSelecionado.recebidoEm
                    ? new Date(String(boletimSelecionado.recebidoEm)).toLocaleString("pt-BR")
                    : "-"}
                </div>
                <div><strong>Obs. recebimento:</strong> {String(boletimSelecionado.obsRecebimento || "-").toUpperCase()}</div>
              </div>
            </div>

            <div style={{ border: "1px solid #d8e0ea", borderRadius: 10, padding: 12, background: "#fff" }}>
              <div style={{ fontWeight: 900, color: "#0f2440", marginBottom: 8 }}>Assinatura do recebedor</div>
              {boletimSelecionado.assinaturaRecebedor ? (
                <div style={{ border: "1px solid #e5ebf3", borderRadius: 10, padding: 10, background: "#f8fbff" }}>
                  <img
                    src={boletimSelecionado.assinaturaRecebedor}
                    alt="Assinatura do recebedor"
                    style={{ width: "100%", maxWidth: 520, height: 140, objectFit: "contain", display: "block", margin: "0 auto" }}
                  />
                </div>
              ) : (
                <div style={{ color: "#6c757d", fontWeight: 700 }}>
                  Sem assinatura registrada neste boletim.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={card}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "4%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "4%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "6%" }} />
          </colgroup>
          <thead style={{ background: "#0b5ed7", color: "#fff" }}>
            <tr>
              {["Sel.", "Data", "Nr", "Origem", "Destino", "Descrição", "Código", "Qtd", "Vlr Unit", "Vlr Total", "Status", "Ações"].map((titulo) => (
                <th key={titulo} style={thBase}>{titulo}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {listaFiltrada.map((item, idx) => (
              (() => {
                const boletim = boletimPorNumero.get(String(item.numeroBoletim || "").trim());
                const podeAcoes = Boolean(boletim);
                const selo = seloStatus(item.statusRecebimento, boletim?.assinaturaRecebedor);
                const numero = String(item.numeroBoletim || "").trim();
                const marcado = Boolean(numero) && selecionados.has(numero);
                return (
              <tr key={item.id} style={{ background: idx % 2 === 0 ? "#f8fbff" : "#fff" }}>
                <td style={{ ...tdBase, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    disabled={!numero}
                    checked={marcado}
                    onChange={() => alternarSelecionado(numero)}
                    aria-label={`Selecionar boletim ${numero}`}
                  />
                </td>
                <td style={{ ...tdBase, textAlign: "center" }}>{formatarData(item.data)}</td>
                <td style={{ ...tdBase, textAlign: "center", fontWeight: "bold" }}>{item.numeroBoletim || "-"}</td>
                <td style={tdWrap}>{normalizar(item.origem) || "-"}</td>
                <td style={tdWrap}>{normalizar(item.destino) || "-"}</td>
                <td style={tdWrap}>{item.descricaoItem || "-"}</td>
                <td style={{ ...tdWrap, textAlign: "center" }}>{item.codigoItem || "-"}</td>
                <td style={{ ...tdBase, textAlign: "center" }}>{item.quantidade || 0}</td>
                <td style={{ ...tdBase, textAlign: "right" }}>{moeda(item.valorUnitario || 0)}</td>
                <td style={{ ...tdBase, textAlign: "right", fontWeight: "bold" }}>{moeda(item.valorTotal || 0)}</td>
                <td style={{ ...tdBase, textAlign: "center", overflow: "hidden" }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "6px 10px",
                      borderRadius: 999,
                      background: selo.bg,
                      color: selo.fg,
                      border: `1px solid ${selo.border}`,
                      fontWeight: 900,
                      fontSize: 12,
                      letterSpacing: 0.2,
                      whiteSpace: "nowrap",
                      maxWidth: "100%",
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis"
                    }}
                    title={podeAcoes ? "Status do boletim (considera assinatura quando houver)" : "Status do boletim"}
                  >
                    {selo.label}
                  </span>
                </td>
                <td style={{ ...tdBase, textAlign: "center" }}>
                  {podeAcoes ? (
                    <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => setBoletimSelecionado(boletim)}
                        style={{ background: "#0b5ed7", border: "none", color: "#fff", borderRadius: 8, padding: "8px 14px", fontWeight: "bold", cursor: "pointer" }}
                      >
                        Abrir
                      </button>
                    </div>
                  ) : "-"}
                </td>
              </tr>
                );
              })()
            ))}
            {!listaFiltrada.length && (
              <tr>
                <td colSpan={12} style={{ padding: 12, border: "1px solid #e5ebf3", textAlign: "center", color: "#6c757d" }}>
                  Nenhum boletim encontrado para os filtros selecionados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default RelatorioTransferencias;

