/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { db } from "../firebase";
import { registrarHistorico } from "../utils/historico";
import { formatoLogoPdf, resolverLogoPdf } from "../utils/pdfLogo";
import { belongsToTenant, getConfigDocId, getTenantId, withTenant } from "../utils/tenant";

function RelatorioDiarioObra({ setTela }) {
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
  const podeEditar = perfilSessao === "GESTOR_GERAL" || perfilSessao === "ADMIN_UNIDADE" || usuarioChaveSessao;
  // Importante: ADMIN_UNIDADE nao e acesso total de bases.
  // Ele deve respeitar basesPermitidas (cidade/estado) como qualquer operacional.
  const acessoTotalBases = perfilSessao === "GESTOR_GERAL" || usuarioChaveSessao;
  const basesPermitidas = Array.isArray(sessaoOperacional?.basesPermitidas)
    ? sessaoOperacional.basesPermitidas.map((b) => String(b || "").trim().toUpperCase()).filter(Boolean)
    : [];
  const cidadesPermitidas = new Set(
    basesPermitidas
      .map((b) => String(b || "").split("__")[0])
      .map((c) => String(c || "").trim().toUpperCase())
      .filter(Boolean)
  );
  const chaveBase = (cidade, estado) =>
    `${String(cidade || "").trim().toUpperCase()}__${String(estado || "").trim().toUpperCase()}`;
  const basePermitida = (obra) =>
    acessoTotalBases || (
      basesPermitidas.length > 0 && (
        basesPermitidas.includes(chaveBase(obra?.cidade, obra?.estado))
        || cidadesPermitidas.has(String(obra?.cidade || "").trim().toUpperCase())
      )
    );

  const [empresaSistema, setEmpresaSistema] = useState(null);
  const [dados, setDados] = useState([]);
  const [filtrado, setFiltrado] = useState([]);
  const [obras, setObras] = useState([]);

  const [data, setData] = useState("");
  const [obraNumero, setObraNumero] = useState("");
  const [apontador, setApontador] = useState("");
  const [selecionados, setSelecionados] = useState(() => new Set());
  const [editando, setEditando] = useState(null); // rdo atual
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  // Campos de edicao
  const [edData, setEdData] = useState("");
  const [edLogradouro, setEdLogradouro] = useState("");
  const [edBairro, setEdBairro] = useState("");
  const [edDiasDec, setEdDiasDec] = useState("");
  const [edClimaManha, setEdClimaManha] = useState("sol");
  const [edClimaTarde, setEdClimaTarde] = useState("sol");
  const [edObjeto, setEdObjeto] = useState("");
  const [edAtividades, setEdAtividades] = useState("");
  const [edOcorrencias, setEdOcorrencias] = useState("");
  const [edAcidentes, setEdAcidentes] = useState("");
  const [edEquipe, setEdEquipe] = useState([]);
  const [edEquip, setEdEquip] = useState([]);

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
    boxSizing: "border-box",
    background: "#fff"
  };
  const textArea = {
    width: "100%",
    borderRadius: 8,
    border: "1px solid #cfd7e3",
    padding: 10,
    boxSizing: "border-box",
    minHeight: 90,
    resize: "vertical",
    background: "#fff"
  };

  useEffect(() => {
    buscarEmpresa();
    buscarDados();
    buscarObras();
  }, []);

  useEffect(() => {
    aplicarFiltros();
  }, [data, obraNumero, apontador, dados, obras]);

  useEffect(() => {
    // Quando o filtro muda, remove selecoes que nao estao mais visiveis.
    setSelecionados((prev) => {
      if (!prev || prev.size === 0) return prev;
      const visiveis = new Set(filtrado.map((r) => String(r.id)));
      const novo = new Set();
      prev.forEach((id) => {
        if (visiveis.has(String(id))) novo.add(String(id));
      });
      return novo;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrado]);

  const buscarEmpresa = async () => {
    try {
      const ref = doc(db, "configuracoes", getConfigDocId(tenantId));
      const snap = await getDoc(ref);
      if (snap.exists()) setEmpresaSistema(snap.data());
    } catch {
      // ignora
    }
  };

  const buscarDados = async () => {
    const snap = await getDocs(collection(db, "rdo"));
    const lista = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((r) => belongsToTenant(r, tenantId));
    lista.sort((a, b) => (String(a.data || "") > String(b.data || "") ? -1 : 1));
    setDados(lista);
    setFiltrado(lista);
  };

  const parseObraNumero = (obra) => {
    const nome = String(obra?.nome || "").trim();
    const m = nome.match(/^\s*([0-9]{1,6})\s*[-â€“â€”]\s*(.+)\s*$/);
    if (m) return m[1];
    const m2 = nome.match(/^\s*([0-9]{1,6})\s+(.+)\s*$/);
    if (m2) return m2[1];
    return String(obra?.numero || obra?.codigo || obra?.id || nome || "").trim();
  };

  const buscarObras = async () => {
    const snap = await getDocs(collection(db, "obras"));
    const lista = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((o) => belongsToTenant(o, tenantId) || (!o?.tenantId && String(tenantId) !== "tenant_local"))
      // Admin/operacional pode ver apenas obras da(s) base(s) permitida(s).
      .filter((o) => basePermitida(o))
      .map((o) => ({ ...o, numeroCurto: parseObraNumero(o) }))
      .filter((o) => String(o.numeroCurto || "").trim())
      .sort((a, b) => String(a.numeroCurto).localeCompare(String(b.numeroCurto), "pt-BR"));
    setObras(lista);
  };

  const normalizar = (v) =>
    String(v || "")
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const obraKey = (valor) => {
    const dig = String(valor || "").replace(/\D/g, "");
    const semZeros = dig.replace(/^0+/, "");
    return semZeros || (dig ? "0" : "");
  };

  const obrasMap = useMemo(() => {
    const m = new Map();
    (obras || []).forEach((o) => m.set(String(o.id), o));
    return m;
  }, [obras]);

  const dadosPermitidos = useMemo(() => {
    if (acessoTotalBases) return dados;
    // Se nao houver obras carregadas ainda, nao filtra para nao "sumir" antes do carregamento.
    if (!obrasMap.size) return dados;
    return (dados || []).filter((r) => {
      const obra = obrasMap.get(String(r.obraId || ""));
      if (!obra) return false;
      return basePermitida(obra);
    });
  }, [dados, acessoTotalBases, obrasMap]);

  const mesmoDia = (dataISO) => {
    const d = String(dataISO || "").trim();
    if (!d) return false;
    if (!data) return true;
    return d === String(data).trim();
  };

  const aplicarFiltros = () => {
    let lista = [...dadosPermitidos];
    if (data) lista = lista.filter((r) => mesmoDia(r.data));
    if (obraNumero) {
      const alvo = obraKey(obraNumero);
      lista = lista.filter((r) => obraKey(r.obraNumero) === alvo);
    }
    if (apontador) {
      const alvo = normalizar(apontador);
      lista = lista.filter((r) => normalizar(r.apontadorNome).includes(alvo) || normalizar(r.apontadorEmail).includes(alvo));
    }
    setFiltrado(lista);
  };

  // Mostrar TODAS as obras cadastradas no filtro (nao so as que ja tem RDO).
  const opcoesObras = useMemo(
    () => [...new Set(obras.map((o) => String(o.numeroCurto || "").trim()).filter(Boolean))].sort(),
    [obras]
  );

  const opcoesApontadores = useMemo(
    () => {
      const alvo = obraNumero ? obraKey(obraNumero) : "";
      const base = alvo ? dadosPermitidos.filter((r) => obraKey(r.obraNumero) === alvo) : dadosPermitidos;
      return [...new Set(base.map((r) => String(r.apontadorNome || r.apontadorEmail || "").trim()).filter(Boolean))].sort();
    },
    [dadosPermitidos, obraNumero]
  );

  // Se o usuario trocou a obra, e o apontador atual nao existe mais nas opcoes,
  // limpa para evitar "travar" o filtro.
  useEffect(() => {
    if (!apontador) return;
    const alvo = String(apontador || "").trim();
    const existe = opcoesApontadores.some((n) => String(n || "").trim() === alvo);
    if (!existe) setApontador("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obraNumero, dadosPermitidos]);

  const formatarDataBR = (dataISO) => {
    const texto = String(dataISO || "").trim();
    const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!iso) return texto || "-";
    return `${iso[3]}/${iso[2]}/${iso[1]}`;
  };

  const diaSemana = (dataISO) => {
    const texto = String(dataISO || "").trim();
    const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!iso) return "";
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const nomes = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];
    return nomes[d.getDay()] || "";
  };

  const CLIMA_LABEL = { sol: "SOL", nublado: "NUBLADO", chuva: "CHUVA", impraticavel: "IMPRAT." };
  const labelClima = (id) => CLIMA_LABEL[String(id || "").toLowerCase()] || String(id || "").toUpperCase() || "-";
  const CLIMAS = [
    { id: "sol", label: "SOL" },
    { id: "nublado", label: "NUBLADO" },
    { id: "chuva", label: "CHUVA" },
    { id: "impraticavel", label: "IMPRAT." }
  ];

  const textoPdf = (valor) =>
    String(valor ?? "")
      .trim()
      .toUpperCase();

  const salvarPdf = (docPdf, nomeArquivo = "RDO.pdf") => {
    try {
      docPdf.save(nomeArquivo);
    } catch {
      try {
        docPdf.output("dataurlnewwindow");
      } catch {
        // ignora
      }
    }
  };

  const dataNomeArquivo = (dataISO) => {
    const iso = String(dataISO || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
    return String(dataISO || "").trim().replaceAll("/", "-") || "SEM-DATA";
  };

  const limitarLinhas = (docPdf, texto, maxWidth, maxLines) => {
    const base = textoPdf(texto || "") || "-";
    const linhas = docPdf.splitTextToSize(base, maxWidth);
    if (linhas.length <= maxLines) return linhas;
    return [...linhas.slice(0, Math.max(1, maxLines - 1)), "..."];
  };

  const gerarPdfRdo = async (rdo) => {
    const docPdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = docPdf.internal.pageSize.getWidth();
    const pageHeight = docPdf.internal.pageSize.getHeight();
    const margemX = 12;
    const larguraConteudo = pageWidth - margemX * 2;
    const gapCol = 6;
    const colW = (larguraConteudo - gapCol) / 2;
    const xLeft = margemX;
    const xRight = margemX + colW + gapCol;

    const logoDataUrl = await resolverLogoPdf(empresaSistema || {});
    if (logoDataUrl) {
      const fmt = formatoLogoPdf(logoDataUrl);
      docPdf.addImage(logoDataUrl, fmt, margemX, 10, 26, 12);
    }

    docPdf.setFont("helvetica", "bold");
    docPdf.setFontSize(14);
    docPdf.text("RELATORIO DIARIO DE OBRA (RDO)", pageWidth / 2, 18, { align: "center" });

    docPdf.setFont("helvetica", "normal");
    docPdf.setFontSize(10);

    const headerRows = [
      ["RDO", textoPdf(rdo.numeroRdo || "-"), "DATA", formatarDataBR(rdo.data)],
      ["DIA", diaSemana(rdo.data) || "-", "OBRA", textoPdf(rdo.obraNumero || "-")],
      ["APONTADOR", textoPdf(rdo.apontadorNome || rdo.apontadorEmail || "-"), "CLIMA", `MANHA: ${labelClima(rdo.climaManha)} | TARDE: ${labelClima(rdo.climaTarde)}`],
      ["LOGRADOURO", textoPdf(rdo.logradouro || rdo.rua || "-"), "BAIRRO", textoPdf(rdo.bairro || "-")],
      ["DIAS DEC.", textoPdf(rdo.diasDecorridos || "-"), "", ""]
    ];

    autoTable(docPdf, {
      startY: 24,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 1.4, lineColor: [190, 200, 215], lineWidth: 0.2 },
      headStyles: { fillColor: [11, 94, 215], textColor: 255, fontStyle: "bold", halign: "center", valign: "middle" },
      bodyStyles: { textColor: [20, 40, 70] },
      margin: { left: margemX, right: margemX },
      body: headerRows.map((r) => [
        { content: r[0], styles: { fontStyle: "bold" } },
        r[1],
        { content: r[2], styles: { fontStyle: "bold" } },
        r[3]
      ]),
      columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 72 }, 2: { cellWidth: 28 }, 3: { cellWidth: 62 } }
    });

    let y = (docPdf.lastAutoTable?.finalY || 24) + 3;

    docPdf.setFont("helvetica", "bold");
    docPdf.setFontSize(10);
    docPdf.text("OBJETO / DESCRIÇÃO", margemX, y + 6);
    docPdf.setFont("helvetica", "normal");
    docPdf.setFontSize(9);
    const boxObjH = 18; // fixo para manter 1 pagina
    docPdf.rect(margemX, y + 8, larguraConteudo, boxObjH);
    const linhasObjeto = limitarLinhas(docPdf, rdo.objeto, larguraConteudo - 4, 3);
    docPdf.text(linhasObjeto, margemX + 2, y + 13);
    y = y + 8 + boxObjH + 4;

    const padRows = (rows, total) => {
      const base = Array.isArray(rows) ? rows : [];
      if (base.length > total) {
        const cortado = base.slice(0, total - 1);
        return [...cortado, ["...", "..."]];
      }
      const faltam = total - base.length;
      return [...base, ...Array.from({ length: faltam }, () => ["", ""])];
    };

    const equipeRowsRaw = (rdo.equipe || [])
      .filter((l) => String(l.funcao || "").trim())
      .map((l) => [textoPdf(l.funcao || "-"), textoPdf(l.quantidade || "-")]);
    const equipRowsRaw = (rdo.equipamentos || [])
      .filter((l) => String(l.descricao || "").trim())
      .map((l) => [textoPdf(l.descricao || "-"), textoPdf(l.quantidade || "-")]);

    const totalLinhas = 12;
    const equipeRows = padRows(equipeRowsRaw, totalLinhas);
    const equipRows = padRows(equipRowsRaw, totalLinhas);

    // Titulos acima de cada quadro (mais claro do que titulo vertical).
    docPdf.setFont("helvetica", "bold");
    docPdf.setFontSize(10);

    const titleY = y + 6; // linha do titulo
    const tableTopY = y + 10; // deixa espaco para os titulos antes das tabelas
    docPdf.text("MAO DE OBRA", xLeft + colW / 2, titleY, { align: "center" });
    docPdf.text("EQUIPAMENTOS", xRight + colW / 2, titleY, { align: "center" });

    autoTable(docPdf, {
      startY: tableTopY,
      theme: "grid",
      tableWidth: colW,
      styles: { fontSize: 9, cellPadding: 1.2, lineColor: [0, 0, 0], lineWidth: 0.2, textColor: 0, fillColor: 255 },
      bodyStyles: { textColor: 0, fillColor: 255 },
      alternateRowStyles: { fillColor: 255, textColor: 0 },
      headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: "bold", halign: "center", valign: "middle" },
      // Importante: para posicionar corretamente lado a lado, use apenas margin.left.
      // margin.right pode fazer o plugin recalcular o startX e "empurrar" a tabela.
      margin: { left: xLeft },
      head: [["FUNCAO", "QUANT."]],
      body: equipeRows,
      columnStyles: { 0: { cellWidth: colW - 24 }, 1: { cellWidth: 24, halign: "right" } }
    });

    const yLeftBottom = docPdf.lastAutoTable?.finalY || tableTopY;

    autoTable(docPdf, {
      startY: tableTopY,
      theme: "grid",
      tableWidth: colW,
      styles: { fontSize: 9, cellPadding: 1.2, lineColor: [0, 0, 0], lineWidth: 0.2, textColor: 0, fillColor: 255 },
      bodyStyles: { textColor: 0, fillColor: 255 },
      alternateRowStyles: { fillColor: 255, textColor: 0 },
      headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: "bold", halign: "center", valign: "middle" },
      margin: { left: xRight },
      head: [["EQUIPAMENTO", "QUANT."]],
      body: equipRows,
      columnStyles: { 0: { cellWidth: colW - 24 }, 1: { cellWidth: 24, halign: "right" } }
    });

    const yRightBottom = docPdf.lastAutoTable?.finalY || tableTopY;
    y = Math.max(yLeftBottom, yRightBottom) + 4;

    const blocoTexto = (titulo, texto) => {
      docPdf.setFont("helvetica", "bold");
      docPdf.setFontSize(10);
      docPdf.text(textoPdf(titulo), margemX, y + 6);
      docPdf.setFont("helvetica", "normal");
      docPdf.setFontSize(9);
      const h = 18; // fixo para manter 1 pagina
      docPdf.rect(margemX, y + 8, larguraConteudo, h);
      const linhas = limitarLinhas(docPdf, texto, larguraConteudo - 4, 3);
      docPdf.text(linhas, margemX + 2, y + 13);
      y += h + 14;
    };

    blocoTexto("Atividades Executadas", rdo.atividades);
    blocoTexto("Ocorrencias / Observações", rdo.ocorrencias);
    // Se estiver muito embaixo, ainda cabe (fixo). Se nao, corta.
    if (y < pageHeight - 28) blocoTexto("Acidentes", rdo.acidentes);

    const agora = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    const geradoEm = `${pad2(agora.getDate())}/${pad2(agora.getMonth() + 1)}/${agora.getFullYear()} ${pad2(agora.getHours())}:${pad2(agora.getMinutes())}`;
    docPdf.setFont("helvetica", "normal");
    docPdf.setFontSize(8);
    docPdf.text(`Gerado em: ${geradoEm}`, pageWidth - 12, pageHeight - 8, { align: "right" });

    const nomeNum = String(rdo.numeroRdo || "").trim();
    const prefixo = nomeNum ? `RDO ${textoPdf(nomeNum)} - ` : "RDO - ";
    salvarPdf(docPdf, `${prefixo}OBRA ${textoPdf(rdo.obraNumero || "OBRA")} - ${dataNomeArquivo(rdo.data)}.pdf`);
  };

  const abrirEdicao = (rdo) => {
    setEditando(rdo);
    setEdData(String(rdo?.data || "").trim());
    setEdLogradouro(String(rdo?.logradouro || rdo?.rua || "").trim());
    setEdBairro(String(rdo?.bairro || "").trim());
    setEdDiasDec(String(rdo?.diasDecorridos || "").trim());
    setEdClimaManha(String(rdo?.climaManha || "sol").trim());
    setEdClimaTarde(String(rdo?.climaTarde || "sol").trim());
    setEdObjeto(String(rdo?.objeto || "").trim());
    setEdAtividades(String(rdo?.atividades || "").trim());
    setEdOcorrencias(String(rdo?.ocorrencias || "").trim());
    setEdAcidentes(String(rdo?.acidentes || "").trim());
    setEdEquipe(Array.isArray(rdo?.equipe) ? rdo.equipe.map((e) => ({ funcao: String(e?.funcao || ""), quantidade: String(e?.quantidade || "") })) : []);
    setEdEquip(Array.isArray(rdo?.equipamentos) ? rdo.equipamentos.map((e) => ({ descricao: String(e?.descricao || ""), quantidade: String(e?.quantidade || "") })) : []);
  };

  const cancelarEdicao = () => {
    setEditando(null);
    setSalvandoEdicao(false);
  };

  const salvarEdicao = async () => {
    if (!editando?.id) return;
    if (!edData) return alert("Informe a data do RDO.");
    if (!String(edLogradouro || "").trim()) return alert("Informe o logradouro.");

    setSalvandoEdicao(true);
    try {
      const payload = withTenant({
        data: String(edData || "").trim(),
        logradouro: String(edLogradouro || "").trim(),
        rua: "", // legado: manter vazio e usar logradouro
        bairro: String(edBairro || "").trim(),
        diasDecorridos: String(edDiasDec || "").trim(),
        climaManha: String(edClimaManha || "sol").trim(),
        climaTarde: String(edClimaTarde || "sol").trim(),
        objeto: String(edObjeto || "").trim(),
        atividades: String(edAtividades || "").trim(),
        ocorrencias: String(edOcorrencias || "").trim(),
        acidentes: String(edAcidentes || "").trim(),
        equipe: Array.isArray(edEquipe) ? edEquipe : [],
        equipamentos: Array.isArray(edEquip) ? edEquip : [],
        atualizadoEm: new Date().toISOString(),
        atualizadoPor: String(sessaoOperacional?.nome || sessaoOperacional?.email || sessaoOperacional?.cpf || "").trim()
      }, tenantId);

      await updateDoc(doc(db, "rdo", editando.id), payload);

      await registrarHistorico({
        modulo: "RDO",
        acao: "EDITOU",
        entidade: "RDO",
        registroId: editando.id,
        usuario: String(sessaoOperacional?.nome || "-").trim().toUpperCase(),
        descricao: `Editou RDO ${String(editando.numeroRdo || editando.sequencia || "-")}.`
      });

      alert("Edicao salva com sucesso.");
      cancelarEdicao();
      await buscarDados();
    } catch (e) {
      alert(`Falha ao salvar edicao. Detalhes: ${String(e?.message || e || "")}`);
    } finally {
      setSalvandoEdicao(false);
    }
  };

  const excluirRdoSilencioso = async (rdoId, label = "-") => {
    if (!rdoId) return;
    await deleteDoc(doc(db, "rdo", rdoId));
    await registrarHistorico({
      modulo: "RDO",
      acao: "EXCLUIU",
      entidade: "RDO",
      registroId: rdoId,
      usuario: String(sessaoOperacional?.nome || "-").trim().toUpperCase(),
      descricao: `Excluiu RDO ${String(label || "-").trim()}.`
    });
  };

  const alternarSelecionado = (id) => {
    const chave = String(id || "");
    if (!chave) return;
    setSelecionados((prev) => {
      const novo = new Set(prev || []);
      if (novo.has(chave)) novo.delete(chave);
      else novo.add(chave);
      return novo;
    });
  };

  const selecionarTodosVisiveis = () => {
    setSelecionados(new Set(filtrado.map((r) => String(r.id))));
  };

  const limparSelecao = () => setSelecionados(new Set());

  const editarSelecionado = () => {
    const ids = Array.from(selecionados || []);
    if (ids.length !== 1) {
      alert("Selecione somente 1 RDO para editar.");
      return;
    }
    const r = filtrado.find((x) => String(x.id) === String(ids[0]));
    if (!r) {
      alert("RDO selecionado nao esta mais disponivel na lista.");
      return;
    }
    abrirEdicao(r);
  };

  const excluirSelecionados = async () => {
    const ids = Array.from(selecionados || []);
    if (!ids.length) return;
    if (!window.confirm(`Excluir ${ids.length} RDO(s) selecionado(s)? Esta acao nao pode ser desfeita.`)) return;

    try {
      for (const id of ids) {
        const r = dados.find((x) => String(x.id) === String(id)) || filtrado.find((x) => String(x.id) === String(id));
        const label = r ? String(r.numeroRdo || r.sequencia || "-") : "-";
        // eslint-disable-next-line no-await-in-loop
        await excluirRdoSilencioso(String(id), label);
      }
      if (editando?.id && ids.some((x) => String(x) === String(editando.id))) cancelarEdicao();
      alert("RDO(s) excluido(s) com sucesso.");
      limparSelecao();
      await buscarDados();
    } catch (e) {
      alert(`Falha ao excluir selecionados. Detalhes: ${String(e?.message || e || "")}`);
    }
  };

  return (
    <div style={{ padding: 20, maxWidth: 1240, margin: "0 auto", fontFamily: "Arial" }}>
      <div style={{ ...card, marginBottom: 12, borderLeft: "5px solid #0b5ed7" }}>
        <h2 style={{ margin: 0, color: "#10243e" }}>Relatório Diario de Obra (RDO)</h2>
        <div style={{ marginTop: 6, color: "#4a5c74", fontWeight: 700, fontSize: 13 }}>
          Aqui aparecem os RDOs salvos, com identificacao de obra, data e quem fez.
        </div>
      </div>

      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Data</div>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={inputBase} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Obra</div>
            <select value={obraNumero} onChange={(e) => setObraNumero(e.target.value)} style={inputBase}>
              <option value="">Todas</option>
              {opcoesObras.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Apontador</div>
            <select value={apontador} onChange={(e) => setApontador(e.target.value)} style={inputBase}>
              <option value="">Todos</option>
              {opcoesApontadores.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {editando && (
        <div style={{ ...card, marginBottom: 12, borderLeft: "5px solid #0b5ed7", background: "#f8fbff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontWeight: 900, color: "#0f2440" }}>
              Editando RDO {editando.numeroRdo || (Number(editando.sequencia) > 0 ? String(editando.sequencia).padStart(3, "0") : "-")} (Obra {editando.obraNumero || "-"})
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={salvarEdicao}
                disabled={salvandoEdicao}
                style={{ border: "none", borderRadius: 10, padding: "10px 14px", background: "#198754", color: "#fff", fontWeight: 900, cursor: salvandoEdicao ? "not-allowed" : "pointer" }}
              >
                {salvandoEdicao ? "Salvando..." : "Salvar edicao"}
              </button>
              <button
                type="button"
                onClick={cancelarEdicao}
                style={{ border: "none", borderRadius: 10, padding: "10px 14px", background: "#6c757d", color: "#fff", fontWeight: 900, cursor: "pointer" }}
              >
                Cancelar
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Data</div>
              <input type="date" value={edData} onChange={(e) => setEdData(e.target.value)} style={inputBase} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Logradouro</div>
              <input value={edLogradouro} onChange={(e) => setEdLogradouro(e.target.value)} style={inputBase} placeholder="Ex: AV. ORLEI CAMELI" />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Bairro</div>
              <input value={edBairro} onChange={(e) => setEdBairro(e.target.value)} style={inputBase} placeholder="Ex: CENTRO" />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Dias decorridos</div>
              <input value={edDiasDec} onChange={(e) => setEdDiasDec(e.target.value)} style={inputBase} placeholder="Ex: 001" />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Clima (manha)</div>
              <select value={edClimaManha} onChange={(e) => setEdClimaManha(e.target.value)} style={inputBase}>
                {CLIMAS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Clima (tarde)</div>
              <select value={edClimaTarde} onChange={(e) => setEdClimaTarde(e.target.value)} style={inputBase}>
                {CLIMAS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#173454", marginBottom: 6 }}>Objeto / Descrição</div>
            <textarea value={edObjeto} onChange={(e) => setEdObjeto(e.target.value)} style={textArea} placeholder="Objeto/descricao da obra (pode deixar vazio se nao usar)" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#173454", marginBottom: 6 }}>Mao de obra</div>
              <div style={{ display: "grid", gap: 8 }}>
                {(edEquipe || []).map((l, idx) => (
                  <div key={idx} style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 8 }}>
                    <input style={inputBase} value={l.funcao} placeholder="Funcao" onChange={(e) => setEdEquipe((prev) => prev.map((it, i) => i === idx ? { ...it, funcao: e.target.value } : it))} />
                    <input style={inputBase} value={l.quantidade} placeholder="Qtd" onChange={(e) => setEdEquipe((prev) => prev.map((it, i) => i === idx ? { ...it, quantidade: e.target.value } : it))} />
                    <button
                      type="button"
                      onClick={() => setEdEquipe((prev) => prev.filter((_, i) => i !== idx))}
                      style={{ border: "none", borderRadius: 8, padding: "0 10px", background: "#dc3545", color: "#fff", fontWeight: 900, cursor: "pointer" }}
                      title="Remover linha"
                    >
                      X
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setEdEquipe((prev) => [...prev, { funcao: "", quantidade: "" }])}
                  style={{ border: "none", borderRadius: 10, padding: "10px 12px", background: "#0b5ed7", color: "#fff", fontWeight: 900, cursor: "pointer", justifySelf: "start" }}
                >
                  + Adicionar
                </button>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#173454", marginBottom: 6 }}>Equipamentos</div>
              <div style={{ display: "grid", gap: 8 }}>
                {(edEquip || []).map((l, idx) => (
                  <div key={idx} style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 8 }}>
                    <input style={inputBase} value={l.descricao} placeholder="Equipamento" onChange={(e) => setEdEquip((prev) => prev.map((it, i) => i === idx ? { ...it, descricao: e.target.value } : it))} />
                    <input style={inputBase} value={l.quantidade} placeholder="Qtd" onChange={(e) => setEdEquip((prev) => prev.map((it, i) => i === idx ? { ...it, quantidade: e.target.value } : it))} />
                    <button
                      type="button"
                      onClick={() => setEdEquip((prev) => prev.filter((_, i) => i !== idx))}
                      style={{ border: "none", borderRadius: 8, padding: "0 10px", background: "#dc3545", color: "#fff", fontWeight: 900, cursor: "pointer" }}
                      title="Remover linha"
                    >
                      X
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setEdEquip((prev) => [...prev, { descricao: "", quantidade: "" }])}
                  style={{ border: "none", borderRadius: 10, padding: "10px 12px", background: "#0b5ed7", color: "#fff", fontWeight: 900, cursor: "pointer", justifySelf: "start" }}
                >
                  + Adicionar
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#173454", marginBottom: 6 }}>Atividades executadas</div>
              <textarea value={edAtividades} onChange={(e) => setEdAtividades(e.target.value)} style={textArea} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#173454", marginBottom: 6 }}>Ocorrencias / Observações</div>
              <textarea value={edOcorrencias} onChange={(e) => setEdOcorrencias(e.target.value)} style={textArea} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#173454", marginBottom: 6 }}>Acidentes</div>
              <textarea value={edAcidentes} onChange={(e) => setEdAcidentes(e.target.value)} style={textArea} />
            </div>
          </div>
        </div>
      )}

      <div style={{ ...card, overflowX: "auto" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 900, color: "#0f2440" }}>
            Selecionados: {Number(selecionados?.size || 0)}
          </div>
          <button
            type="button"
            onClick={selecionarTodosVisiveis}
            style={{ border: "none", borderRadius: 10, padding: "10px 12px", background: "#0b5ed7", color: "#fff", fontWeight: 900, cursor: "pointer" }}
            disabled={!filtrado.length}
            title="Selecionar todos os RDOs visiveis"
          >
            Selecionar todos
          </button>
          <button
            type="button"
            onClick={limparSelecao}
            style={{ border: "none", borderRadius: 10, padding: "10px 12px", background: "#6c757d", color: "#fff", fontWeight: 900, cursor: "pointer" }}
            disabled={!Number(selecionados?.size || 0)}
          >
            Limpar selecao
          </button>

          <div style={{ flex: "1 1 auto" }} />

          <button
            type="button"
            onClick={editarSelecionado}
            disabled={!podeEditar || Number(selecionados?.size || 0) !== 1}
            style={{
              border: "none",
              borderRadius: 10,
              padding: "10px 12px",
              background: !podeEditar || Number(selecionados?.size || 0) !== 1 ? "#cbd3dc" : "#f0ad4e",
              color: "#000",
              fontWeight: 900,
              cursor: !podeEditar || Number(selecionados?.size || 0) !== 1 ? "not-allowed" : "pointer"
            }}
            title={!podeEditar ? "Sem permissao para editar" : "Editar (somente 1 selecionado)"}
          >
            Editar
          </button>
          <button
            type="button"
            onClick={excluirSelecionados}
            disabled={!podeEditar || Number(selecionados?.size || 0) === 0}
            style={{
              border: "none",
              borderRadius: 10,
              padding: "10px 12px",
              background: !podeEditar || Number(selecionados?.size || 0) === 0 ? "#cbd3dc" : "#dc3545",
              color: "#fff",
              fontWeight: 900,
              cursor: !podeEditar || Number(selecionados?.size || 0) === 0 ? "not-allowed" : "pointer"
            }}
            title={!podeEditar ? "Sem permissao para excluir" : "Excluir selecionados"}
          >
            Excluir selecionados
          </button>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, textAlign: "center" }}>
          <thead style={{ background: "#0b5ed7", color: "#fff" }}>
            <tr>
              {["Sel.", "RDO", "Data", "Obra", "Logradouro", "Bairro", "Apontador", "Ações"].map((h) => (
                <th key={h} style={{ padding: "8px 6px", textAlign: "center" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtrado.map((r, idx) => (
              <tr key={r.id} style={{ background: idx % 2 === 0 ? "#f8fbff" : "#fff" }}>
                <td style={{ border: "1px solid #e5ebf3", padding: "7px 6px", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={selecionados.has(String(r.id))}
                    onChange={() => alternarSelecionado(r.id)}
                    aria-label={`Selecionar RDO ${r.numeroRdo || r.sequencia || ""}`}
                  />
                </td>
                <td style={{ border: "1px solid #e5ebf3", padding: "7px 6px", textAlign: "center", fontWeight: 900 }}>
                  {r.numeroRdo || (Number(r.sequencia) > 0 ? String(r.sequencia).padStart(3, "0") : "-")}
                </td>
                <td style={{ border: "1px solid #e5ebf3", padding: "7px 6px", textAlign: "center" }}>{formatarDataBR(r.data)}</td>
                <td style={{ border: "1px solid #e5ebf3", padding: "7px 6px", textAlign: "center", fontWeight: 800 }}>{r.obraNumero || "-"}</td>
                <td style={{ border: "1px solid #e5ebf3", padding: "7px 6px" }}>{r.logradouro || r.rua || "-"}</td>
                <td style={{ border: "1px solid #e5ebf3", padding: "7px 6px" }}>{r.bairro || "-"}</td>
                <td style={{ border: "1px solid #e5ebf3", padding: "7px 6px" }}>{r.apontadorNome || r.apontadorEmail || "-"}</td>
                <td style={{ border: "1px solid #e5ebf3", padding: "7px 6px", textAlign: "center" }}>
                  <button
                    type="button"
                    onClick={() => gerarPdfRdo(r)}
                    style={{ border: "none", borderRadius: 8, padding: "8px 10px", background: "#0b5ed7", color: "#fff", fontWeight: 900, cursor: "pointer" }}
                  >
                    PDF
                  </button>
                </td>
              </tr>
            ))}
            {!filtrado.length && (
              <tr>
                <td colSpan={8} style={{ padding: 14, textAlign: "center", color: "#6c757d" }}>
                  Nenhum RDO encontrado com os filtros atuais.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={() => setTela("home")}
          style={{ border: "none", borderRadius: 10, padding: "12px 16px", background: "#6c757d", color: "#fff", fontWeight: 900, cursor: "pointer" }}
        >
          Voltar ao painel
        </button>
      </div>
    </div>
  );
}

export default RelatorioDiarioObra;

