/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";
import { db } from "../firebase";
import { registrarHistorico } from "../utils/historico";
import { parseDecimalInput } from "../utils/number";
import { formatoLogoPdf, resolverLogoPdf } from "../utils/pdfLogo";
import { getPreferredPublicOrigin } from "../utils/publicUrl";
import { belongsToTenant, getConfigDocId, getTenantId, withTenant } from "../utils/tenant";

function Transferencias() {
  const tenantId = getTenantId();
  const sessaoOperacional = (() => {
    try {
      return JSON.parse(localStorage.getItem("sessaoOperacional") || "{}");
    } catch {
      return {};
    }
  })();

  const [empresaSistema, setEmpresaSistema] = useState(null);
  const [boletins, setBoletins] = useState([]);
  // QR/Link por tela foi removido para despoluir. O QR fica apenas no PDF (com QR).
  const [boletimDetalheAbertoId, setBoletimDetalheAbertoId] = useState(""); // tabela: mostra acoes sem poluir

  const [dataTransferencia, setDataTransferencia] = useState(new Date().toISOString().split("T")[0]);
  // Origem/Destino separados por Base (cidade/UF) e Obra (numero).
  // Assim fica automatico e evita erro de digitar "OBRA" errado.
  const [origemBase, setOrigemBase] = useState(""); // chave: CIDADE__UF
  const [origemObra, setOrigemObra] = useState(""); // numero (ex.: 072)
  const [destinoBase, setDestinoBase] = useState("");
  const [destinoObra, setDestinoObra] = useState("");

  // Listas para selects
  const [basesAtivas, setBasesAtivas] = useState([]); // [{ chave, cidade, estado, label }]
  const [obrasPorBase, setObrasPorBase] = useState({}); // baseChave -> obras[]
  const [motivo, setMotivo] = useState("");
  const [solicitadoPor, setSolicitadoPor] = useState("");
  const [autorizadoPor, setAutorizadoPor] = useState("");
  const [transportador, setTransportador] = useState("");
  const [placaVeiculo, setPlacaVeiculo] = useState("");
  const [codigoTransporte, setCodigoTransporte] = useState("");

  const [descricaoItem, setDescricaoItem] = useState("");
  const [codigoItem, setCodigoItem] = useState("");
  const [aplicacaoItem, setAplicacaoItem] = useState("");
  const [unidadeItem, setUnidadeItem] = useState("UND.");
  const [quantidadeItem, setQuantidadeItem] = useState("1");
  const [valorUnitarioItem, setValorUnitarioItem] = useState("");
  const [observacaoItem, setObservacaoItem] = useState("");
  const [itens, setItens] = useState([]);

  const inputStyle = {
    width: "100%",
    height: 42,
    padding: "0 10px",
    borderRadius: 6,
    border: "1px solid #ccc",
    marginBottom: 10,
    boxSizing: "border-box"
  };

  const card = {
    background: "#fff",
    padding: 20,
    borderRadius: 8,
    marginBottom: 20,
    boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
  };

  const primaryButton = {
    background: "#0066cc",
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: 8,
    fontWeight: "bold",
    cursor: "pointer"
  };

  const isMobileDevice = (() => {
    const ua = String(window.navigator?.userAgent || "").toLowerCase();
    const mobileUA = /android|iphone|ipad|ipod|mobile|opera mini|iemobile/.test(ua);
    return mobileUA || window.innerWidth <= 700;
  })();

  const normalizar = (valor) => String(valor || "").trim().toUpperCase();
  const gerarChaveBase = (cidade, estado) =>
    `${String(cidade || "").trim().toUpperCase()}__${String(estado || "").trim().toUpperCase()}`;
  const labelBase = (chaveBase) => {
    const partes = String(chaveBase || "").split("__");
    const cidade = String(partes?.[0] || "").trim();
    const uf = String(partes?.[1] || "").trim();
    if (!cidade && !uf) return "";
    if (!uf) return cidade;
    return `${cidade}/${uf}`;
  };
  const pad3 = (n) => String(n || "").replace(/\D/g, "").slice(0, 6).padStart(3, "0");
  const montarTextoBaseObra = (baseChave, obraNumero) => {
    const baseLabel = labelBase(baseChave);
    const num = pad3(obraNumero);
    if (baseLabel && num) return `${baseLabel} - OBRA ${num}`;
    if (baseLabel) return baseLabel;
    if (num) return `OBRA ${num}`;
    return "";
  };
  const primeiroNome = (nomeCompleto) => {
    const nome = String(nomeCompleto || "").trim();
    if (!nome) return "-";
    return nome.split(/\s+/)[0];
  };

  const paraNumero = (valor) => parseDecimalInput(valor);

  const moedaBR = (valor) =>
    Number(valor || 0).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

  const formatarData = (valor) => {
    const texto = String(valor || "").trim();
    const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    return texto || "-";
  };

  const extrairCentroCusto = (texto) => {
    // Aceita 1 a 6 digitos (ex.: "OBRA 72", "OBRA 081", "CONVENIO 942476/2023").
    // Mantemos apenas o numero, sem o texto (OBRA), porque e o que o usuario usa para identificar.
    const raw = String(texto || "").trim();
    const m = raw.match(/(\d{1,6})/);
    if (!m) return "---";
    const dig = String(m[1] || "");
    // Para obras (normalmente ate 3 digitos), padroniza com 3 casas: 72 -> 072.
    if (dig.length <= 3) return dig.padStart(3, "0");
    return dig;
  };

  const responsavelAtual = normalizar(sessaoOperacional?.nome || localStorage.getItem("usuarioLogado") || "");
  const identificadorLoginAtual = String(
    sessaoOperacional?.email ||
    sessaoOperacional?.cpf ||
    localStorage.getItem("usuarioLogado") ||
    ""
  )
    .trim()
    .toLowerCase();
  const perfilSessao = String(sessaoOperacional?.perfilAcesso || "").trim().toUpperCase();
  const usuarioChaveSessao = Boolean(sessaoOperacional?.usuarioChave);
  const podeDarBaixaPorPerfil =
    usuarioChaveSessao || perfilSessao === "GESTOR_GERAL" || perfilSessao === "ADMIN_UNIDADE";

  // Controle de visibilidade por base (cidade/UF).
  // - Usuario-chave / Gestor geral: ve tudo.
  // - Admin unidade / operacionais: ve apenas boletins de bases permitidas (origem OU destino).
  const basesPermitidasLabel = useMemo(() => {
    const raw = Array.isArray(sessaoOperacional?.basesPermitidas)
      ? sessaoOperacional.basesPermitidas.map((b) => String(b || "").trim()).filter(Boolean)
      : [];
    const norm = raw.map((b) => {
      const up = String(b || "").trim().toUpperCase();
      if (up.includes("__")) {
        const parts = up.split("__");
        return `${String(parts?.[0] || "").trim()}/${String(parts?.[1] || "").trim()}`;
      }
      return up;
    });
    return Array.from(new Set(norm.filter(Boolean)));
  }, [sessaoOperacional?.basesPermitidas]);
  const acessoTotalBases = usuarioChaveSessao || perfilSessao === "GESTOR_GERAL";

  const carregar = async () => {
    const [snapBoletins, snapCfg, snapBases, snapObras] = await Promise.all([
      getDocs(collection(db, "boletinsTransferencia")),
      getDoc(doc(db, "configuracoes", getConfigDocId(tenantId))),
      getDocs(collection(db, "bases_operacionais")),
      getDocs(collection(db, "obras"))
    ]);

    const listaBruta = snapBoletins.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId));

    const lista = listaBruta
      .filter((item) => {
        if (acessoTotalBases) return true;
        // Se nao tiver bases configuradas, nao filtra (evita travar o sistema em ambiente novo).
        if (!basesPermitidasLabel.length) return true;

        const ob = String(item?.origemBase || "").trim().toUpperCase();
        const db = String(item?.destinoBase || "").trim().toUpperCase();

        // Se for boleto antigo sem origemBase/destinoBase, usa texto legado.
        const legadoOrig = String(item?.origem || "").trim().toUpperCase();
        const legadoDest = String(item?.destino || "").trim().toUpperCase();

        return (
          basesPermitidasLabel.includes(ob) ||
          basesPermitidasLabel.includes(db) ||
          basesPermitidasLabel.some((b) => (b && (legadoOrig.includes(b) || legadoDest.includes(b))))
        );
      })
      .sort((a, b) => new Date(b.dataCriacao || 0) - new Date(a.dataCriacao || 0));
    setBoletins(lista);

    if (snapCfg.exists()) setEmpresaSistema(snapCfg.data());

    // Bases ativas (catalogo). Se nao tiver catalogo, inferimos pelas obras.
    const basesCatalogo = snapBases.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((b) => belongsToTenant(b, tenantId))
      .filter((b) => Boolean(b.ativo))
      .map((b) => {
        const cidade = String(b.cidade || "").trim().toUpperCase();
        const estado = String(b.estado || "").trim().toUpperCase();
        return { chave: gerarChaveBase(cidade, estado), cidade, estado, label: `${cidade}/${estado}` };
      })
      .filter((b) => Boolean(b.cidade) && Boolean(b.estado));

    const obrasLista = snapObras.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((o) => belongsToTenant(o, tenantId))
      .map((o) => {
        const cidade = String(o.cidade || "").trim().toUpperCase();
        const estado = String(o.estado || "").trim().toUpperCase();
        const baseChave = gerarChaveBase(cidade, estado);
        const numero = (() => {
          const cc = String(o.centroCusto || o.codigo || "").trim();
          if (cc) return pad3(cc);
          const nome = String(o.nome || "").trim();
          const m = nome.match(/(\d{1,6})/);
          return pad3(m?.[1] || "");
        })();
        const label = numero ? `OBRA ${numero}` : "OBRA";
        return { id: o.id, numero, cidade, estado, baseChave, label };
      })
      .filter((o) => Boolean(o.baseChave) && Boolean(o.numero));

    const basesInferidas = (() => {
      const map = new Map();
      obrasLista.forEach((o) => {
        if (!o.cidade || !o.estado) return;
        if (!map.has(o.baseChave)) map.set(o.baseChave, { chave: o.baseChave, cidade: o.cidade, estado: o.estado, label: `${o.cidade}/${o.estado}` });
      });
      return Array.from(map.values());
    })();

    const basesFinal = (basesCatalogo.length ? basesCatalogo : basesInferidas).sort((a, b) =>
      String(a.label).localeCompare(String(b.label))
    );
    setBasesAtivas(basesFinal);

    const agrupadas = {};
    obrasLista.forEach((o) => {
      if (!agrupadas[o.baseChave]) agrupadas[o.baseChave] = [];
      agrupadas[o.baseChave].push(o);
    });
    Object.keys(agrupadas).forEach((k) => {
      agrupadas[k] = agrupadas[k].sort((a, b) => String(a.numero).localeCompare(String(b.numero)));
    });
    setObrasPorBase(agrupadas);

    // Origem automatica: se o ADM tiver somente 1 base permitida, ja seleciona.
    try {
      const basesSessao = Array.isArray(sessaoOperacional?.basesPermitidas)
        ? sessaoOperacional.basesPermitidas.map((b) => String(b || "").trim().toUpperCase()).filter(Boolean)
        : [];
      if (!origemBase && basesSessao.length === 1) {
        const unica = basesSessao[0];
        const chave = unica.includes("__")
          ? unica
          : (() => {
            const parts = unica.split("/").map((p) => String(p || "").trim().toUpperCase());
            return gerarChaveBase(parts[0], parts[1]);
          })();
        setOrigemBase(chave);
      }
    } catch {
      // noop
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const proximoNumeroBoletim = useMemo(() => {
    const maior = boletins.reduce((max, item) => {
      const n = Number(String(item.numeroBoletim || "").replace(/\D/g, ""));
      return n > max ? n : max;
    }, 0);
    return String(maior + 1).padStart(6, "0");
  }, [boletins]);

  const totais = useMemo(() => {
    const total = itens.reduce((acc, item) => acc + paraNumero(item.valorTotal || 0), 0);
    const qtd = itens.reduce((acc, item) => acc + paraNumero(item.quantidade || 0), 0);
    return {
      total,
      qtd
    };
  }, [itens]);

  const limparItem = () => {
    setDescricaoItem("");
    setCodigoItem("");
    setAplicacaoItem("");
    setUnidadeItem("UND.");
    setQuantidadeItem("1");
    setValorUnitarioItem("");
    setObservacaoItem("");
  };

  const limparBoletim = () => {
    setDataTransferencia(new Date().toISOString().split("T")[0]);
    setOrigemBase("");
    setOrigemObra("");
    setDestinoBase("");
    setDestinoObra("");
    setMotivo("");
    setSolicitadoPor("");
    setAutorizadoPor("");
    setTransportador("");
    setPlacaVeiculo("");
    setCodigoTransporte("");
    setItens([]);
    limparItem();
  };

  const adicionarItem = () => {
    if (!descricaoItem.trim()) return alert("Informe a descricao do item.");
    const quantidade = paraNumero(quantidadeItem);
    const valorUnitario = paraNumero(valorUnitarioItem);
    if (quantidade <= 0) return alert("Quantidade invalida.");
    if (valorUnitario <= 0) return alert("Valor unitario invalido.");

    const novo = {
      itemNumero: itens.length + 1,
      descricao: normalizar(descricaoItem),
      codigo: normalizar(codigoItem),
      aplicacao: normalizar(aplicacaoItem),
      unidade: normalizar(unidadeItem || "UND."),
      quantidade,
      valorUnitario,
      valorTotal: quantidade * valorUnitario,
      observacao: normalizar(observacaoItem)
    };

    setItens([...itens, novo]);
    limparItem();
  };

  const removerItem = (index) => {
    const novaLista = itens.filter((_, i) => i !== index).map((item, i) => ({
      ...item,
      itemNumero: i + 1
    }));
    setItens(novaLista);
  };

  const salvarBoletim = async () => {
    if (!dataTransferencia) return alert("Informe a data.");
    if (!origemBase) return alert("Selecione a base de origem.");
    if (!origemObra) return alert("Selecione a obra de origem.");
    if (!destinoBase) return alert("Selecione a base de destino.");
    if (!destinoObra) return alert("Selecione a obra de destino.");
    if (!solicitadoPor.trim()) return alert("Informe quem solicitou.");
    if (!autorizadoPor.trim()) return alert("Informe quem autorizou.");
    if (!transportador.trim()) return alert("Informe o transportador.");
    if (!placaVeiculo.trim()) return alert("Informe a placa do veiculo.");
    if (!codigoTransporte.trim()) return alert("Informe o codigo do transporte.");
    if (!itens.length) return alert("Adicione pelo menos um item no boletim.");

    const payload = withTenant({
      data: dataTransferencia,
      numeroBoletim: proximoNumeroBoletim,
      revisao: "5",
      origemBase: normalizar(labelBase(origemBase)),
      origemObra: pad3(origemObra),
      destinoBase: normalizar(labelBase(destinoBase)),
      destinoObra: pad3(destinoObra),
      // Mantemos campos legados "origem/destino" para historicos/PDFs antigos, mas agora com formato padrao.
      origem: normalizar(montarTextoBaseObra(origemBase, origemObra)),
      destino: normalizar(montarTextoBaseObra(destinoBase, destinoObra)),
      centroCustoOrigem: pad3(origemObra),
      centroCustoDestino: pad3(destinoObra),
      motivo: normalizar(motivo),
      solicitadoPor: normalizar(solicitadoPor),
      autorizadoPor: normalizar(autorizadoPor),
      transportador: normalizar(transportador),
      placaVeiculo: normalizar(placaVeiculo),
      codigoTransporte: normalizar(codigoTransporte),
      itens,
      quantidadeItens: totais.qtd,
      valorTotalBoletim: totais.total,
      statusRecebimento: "PENDENTE",
      recebidoEm: "",
      recebidoPor: "",
      preenchidoPor: primeiroNome(responsavelAtual),
      preenchidoData: dataTransferencia,
      criadoPor: responsavelAtual,
      criadoPorLogin: identificadorLoginAtual,
      dataCriacao: new Date().toISOString()
    }, tenantId);

    const ref = await addDoc(collection(db, "boletinsTransferencia"), payload);

    await registrarHistorico({
      modulo: "TRANSFERENCIA",
      acao: "CRIOU",
      entidade: "BOLETIM_TRANSFERENCIA",
      registroId: ref.id,
      usuario: responsavelAtual,
      descricao: `Criou boletim ${payload.numeroBoletim} de ${payload.origem} para ${payload.destino}.`
    });

    alert("Boletim salvo com sucesso. Gere o PDF (com QR) para o destino ler e assinar.");
    limparBoletim();
    carregar();
  };

  const darBaixa = async (boletim) => {
    const donoLogin = String(boletim?.criadoPorLogin || "").trim().toLowerCase();
    const donoNome = String(boletim?.criadoPor || "").trim().toLowerCase();
    const nomeAtual = String(responsavelAtual || "").trim().toLowerCase();
    const podeDarBaixa =
      podeDarBaixaPorPerfil ||
      (Boolean(identificadorLoginAtual) && Boolean(donoLogin) && identificadorLoginAtual === donoLogin) ||
      (Boolean(nomeAtual) && Boolean(donoNome) && nomeAtual === donoNome);

    if (!podeDarBaixa) {
      alert("Somente o login que criou este boletim (ou o administrador) pode dar baixa.");
      return;
    }

    if (boletim.statusRecebimento === "RECEBIDO") {
      alert("Este boletim ja esta baixado.");
      return;
    }
    if (!window.confirm(`Confirmar baixa do boletim ${boletim.numeroBoletim}?`)) return;

    await updateDoc(doc(db, "boletinsTransferencia", boletim.id), {
      statusRecebimento: "RECEBIDO",
      recebidoEm: new Date().toISOString(),
      recebidoPor: responsavelAtual
    });

    await registrarHistorico({
      modulo: "TRANSFERENCIA",
      acao: "BAIXOU",
      entidade: "BOLETIM_TRANSFERENCIA",
      registroId: boletim.id,
      usuario: responsavelAtual,
      descricao: `Deu baixa no boletim ${boletim.numeroBoletim}.`
    });

    carregar();
  };

  // abrirQrDoBoletim removido (QR/Link fica apenas no PDF).

  const gerarBoletimPdf = async (boletim) => {
    // Fallback para boletins antigos: se o centro de custo nao estava gravado corretamente,
    // recalcula aqui a partir de origem/destino para o PDF sair certo.
    const ccOrig = (() => {
      const v = String(boletim?.centroCustoOrigem || "").trim();
      if (v && v !== "---") return v;
      return extrairCentroCusto(boletim?.origem);
    })();
    const ccDest = (() => {
      const v = String(boletim?.centroCustoDestino || "").trim();
      if (v && v !== "---") return v;
      return extrairCentroCusto(boletim?.destino);
    })();

    // QR do boletim: permite receber/assinar no destino lendo do papel (PDF impresso).
    const qrText = `EG_TRANSFER|${tenantId}|${String(boletim?.id || "").trim()}`;
    const basePublica = getPreferredPublicOrigin();
    const qrUrl = `${basePublica}/qr/${encodeURIComponent(tenantId)}/${encodeURIComponent(String(boletim?.id || "").trim())}`;
    let qrDataUrl = "";
    try {
      if (boletim?.id) {
        // Um QR muito "denso" fica ruim de ler no papel. Aumenta a margem (quiet zone)
        // e reduz um pouco a densidade.
        // iPhone costuma falhar quando o QR fica pequeno/denso. Aumenta quiet zone e resolucao.
        qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 8, width: 900, errorCorrectionLevel: "H" });
      }
    } catch {
      qrDataUrl = "";
    }

    const pdf = new jsPDF("landscape", "mm", "a4");
    const logo = await resolverLogoPdf(empresaSistema);
    const largura = pdf.internal.pageSize.getWidth();
    const altura = pdf.internal.pageSize.getHeight();
    const margem = 5;
    const larguraUtil = largura - margem * 2;
    const larguraCabEsq = larguraUtil * 0.72;
    const larguraCabDir = larguraUtil - larguraCabEsq;
    const xCabEsq = margem;
    const xCabDir = xCabEsq + larguraCabEsq;

    if (logo) {
      try {
        pdf.addImage(logo, formatoLogoPdf(logo), xCabEsq + 5, 4.5, 28, 11.5);
      } catch {
        // noop
      }
    }

    pdf.setDrawColor(120);
    pdf.rect(xCabEsq, 3, larguraCabEsq, 14);
    pdf.rect(xCabDir, 3, larguraCabDir, 14);

    pdf.setFontSize(12);
    pdf.setFont("helvetica", "bold");
    pdf.text("BOLETIM DE TRANSFERENCIA", xCabEsq + larguraCabEsq / 2, 11, { align: "center" });
    pdf.setFontSize(9);
    pdf.text(`Nr Boletim: ${boletim.numeroBoletim || "000001"}`, xCabDir + 4, 8);
    pdf.text(`Obra origem: ${ccOrig || "---"}`, xCabDir + 4, 13);

    // QR Code vai ficar no rodape (grande), para ficar bonito e facil de ler no papel.

    pdf.setFontSize(8);
    pdf.text(`C. Custo (Origem): ${boletim.origem || "-"}`, margem, 22);
    pdf.text(`C. Custo (Destino): ${boletim.destino || "-"}`, margem + larguraUtil * 0.58, 22);

    autoTable(pdf, {
      startY: 24,
      theme: "grid",
      head: [[
        "DATA",
        "CUSTO ORIG.",
        "NR",
        "ITEM",
        "CODIGO",
        "DESCRIÇÃO",
        "APLICACAO",
        "UND",
        "QTD",
        "VLR UNIT.",
        "VLR TOTAL",
        "OBSERVACOES",
        "CUSTO DEST.",
        "TRANSPORTE"
      ]],
      body: (boletim.itens || []).map((item) => [
        formatarData(boletim.data),
        ccOrig || "---",
        `/${boletim.numeroBoletim || "000001"}`,
        String(item.itemNumero || 1),
        item.codigo || "-",
        item.descricao || "-",
        item.aplicacao || "-",
        item.unidade || "UND.",
        String(item.quantidade || 0),
        moedaBR(item.valorUnitario || 0),
        moedaBR(item.valorTotal || 0),
        item.observacao || "-",
        ccDest || "---",
        boletim.placaVeiculo || "-"
      ]),
      styles: { fontSize: 7, cellPadding: 1.1, overflow: "linebreak", valign: "middle" },
      headStyles: { fillColor: [255, 240, 110], textColor: 0, halign: "center", fontStyle: "bold", fontSize: 8 },
      bodyStyles: { fillColor: [255, 255, 224] },
      columnStyles: {
        0: { cellWidth: larguraUtil * 0.075, halign: "center" },
        1: { cellWidth: larguraUtil * 0.055, halign: "center" },
        2: { cellWidth: larguraUtil * 0.055, halign: "center" },
        3: { cellWidth: larguraUtil * 0.035, halign: "center" },
        4: { cellWidth: larguraUtil * 0.055, halign: "center" },
        5: { cellWidth: larguraUtil * 0.145 },
        6: { cellWidth: larguraUtil * 0.085, halign: "center" },
        7: { cellWidth: larguraUtil * 0.04, halign: "center" },
        8: { cellWidth: larguraUtil * 0.04, halign: "center" },
        9: { cellWidth: larguraUtil * 0.055, halign: "right" },
        10: { cellWidth: larguraUtil * 0.055, halign: "right" },
        11: { cellWidth: larguraUtil * 0.125 },
        12: { cellWidth: larguraUtil * 0.055, halign: "center" },
        13: { cellWidth: larguraUtil * 0.125, halign: "center" }
      },
      tableWidth: larguraUtil,
      margin: { left: margem, right: margem }
    });

    let y = (pdf.lastAutoTable?.finalY || 45) + 5;

    // Se o rodape nao couber na pagina (por causa de muitos itens),
    // cria uma nova pagina para nao "sumir" transportador/placa/codigo e assinaturas.
    const alturaRodape = 7 + 10 + 12 + 16 + 20 + 6; // aproximacao do bloco abaixo
    if (y + alturaRodape > altura - 8) {
      pdf.addPage();
      y = 18;
    }
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "bold");
    const larguraBlocoAssinatura = larguraUtil / 4;
    const xBloco2 = margem + larguraBlocoAssinatura;
    const xBloco3 = margem + larguraBlocoAssinatura * 2;
    const xQtdLabel = xBloco2 + 12;
    const xQtdValor = xBloco2 + larguraBlocoAssinatura - 24;
    const xTotLabel = xBloco3 + 8;
    const xTotValor = xBloco3 + larguraBlocoAssinatura - 34;
    pdf.text("QTD. ITENS >>", xQtdLabel, y);
    pdf.text(String((boletim.itens || []).length), xQtdValor, y);
    pdf.text("VALOR TOTAL >>", xTotLabel, y);
    pdf.text(moedaBR(boletim.valorTotalBoletim || 0), xTotValor, y);

    y += 7;
    pdf.rect(margem, y - 4, largura - margem * 2, 10);
    pdf.text("TRANSPORTADOR:", margem + 1, y + 2);
    pdf.setFont("helvetica", "normal");
    pdf.text(boletim.transportador || "-", margem + 34, y + 2);
    pdf.setFont("helvetica", "bold");
    pdf.text("PLACA VEICULO:", margem + larguraUtil * 0.60, y + 2);
    pdf.setTextColor(220, 0, 0);
    pdf.text(boletim.placaVeiculo || "-", margem + larguraUtil * 0.60 + 32, y + 2);
    pdf.setTextColor(0, 0, 0);

    // Código do transporte (quando existir)
    const codigo = String(boletim.codigoTransporte || "").trim();
    if (codigo) {
      pdf.setFont("helvetica", "bold");
      pdf.text("CODIGO:", margem + larguraUtil * 0.82, y + 2);
      pdf.setFont("helvetica", "normal");
      pdf.text(codigo, margem + larguraUtil * 0.82 + 18, y + 2);
    }

    y += 12;
    const blocos = [
      "Solicitado por:",
      "Preenchido por:",
      "Autorizado por:",
      "Recebido por:"
    ];
    const wBloco = larguraUtil / 4;
    blocos.forEach((titulo, idx) => {
      const x = margem + idx * wBloco;
      pdf.rect(x, y, wBloco, 16);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.text(titulo, x + 2, y + 4);
      pdf.setFont("helvetica", "normal");
      pdf.line(x + 2, y + 10, x + wBloco - 2, y + 10);
      pdf.setFontSize(7);
      pdf.text("(Assinatura e carimbo)", x + 2, y + 14);
      pdf.text("Data", x + wBloco - 12, y + 14);

      if (idx === 1) {
        pdf.setFontSize(8);
        pdf.setFont("helvetica", "bold");
        pdf.text(primeiroNome(boletim.preenchidoPor || boletim.criadoPor || "-"), x + 2, y + 8);
        pdf.setFont("helvetica", "normal");
        pdf.text(formatarData(boletim.preenchidoData || boletim.data), x + wBloco - 24, y + 8);
      }
      if (idx === 0) {
        pdf.setFontSize(8);
        pdf.setFont("helvetica", "bold");
        pdf.text(primeiroNome(boletim.solicitadoPor || "-"), x + 2, y + 8);
      }
      if (idx === 2) {
        pdf.setFontSize(8);
        pdf.setFont("helvetica", "bold");
        pdf.text(primeiroNome(boletim.autorizadoPor || "-"), x + 2, y + 8);
      }
    });

    y += 20;
    pdf.setFontSize(7);
    pdf.text("Controle do registro", largura / 2, y, { align: "center" });
    pdf.text(`Status: ${boletim.statusRecebimento || "PENDENTE"}`, margem, y);
    if (boletim.recebidoEm) {
      pdf.text(`Baixa em: ${new Date(boletim.recebidoEm).toLocaleString("pt-BR")}`, margem, y + 4);
    }

    // QR GRANDE NO RODAPE (bem embaixo da pagina, nao no meio)
    if (qrDataUrl) {
      // Grande o suficiente para leitura no iPhone, mesmo impresso.
      const qrSize = 75;
      const blocoAltura = qrSize + 14; // titulo + codigo
      const yBloco = altura - 14 - blocoAltura;
      // Se o conteudo chegou muito perto do fim, abre nova pagina so pro rodape com QR.
      if (y > yBloco - 6) {
        pdf.addPage();
      }
      const alturaAtual = pdf.internal.pageSize.getHeight();
      const yBase = alturaAtual - 14 - blocoAltura;
      const qrX = (largura - qrSize) / 2;
      try {
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "bold");
        pdf.text("LEITURA DO QR (RECEBIMENTO NO DESTINO)", largura / 2, yBase, { align: "center" });
        pdf.setFillColor(255, 255, 255);
        // Caixa branca maior ajuda a camera a focar e evita recorte em impressoras com margem.
        pdf.rect(qrX - 4, yBase + 2, qrSize + 8, qrSize + 8, "F");
        pdf.addImage(qrDataUrl, "PNG", qrX, yBase + 6, qrSize, qrSize);
        pdf.setFontSize(8);
        pdf.setFont("helvetica", "normal");
        pdf.text(`CODIGO (fallback): ${qrText}`, largura / 2, yBase + qrSize + 10, { align: "center" });
      } catch {
        // noop
      }
    }

    const nomeArquivo = `boletim_transferencia_${String(boletim.numeroBoletim || "000001")}.pdf`;
    pdf.save(nomeArquivo.toLowerCase());
  };

  const gerarBoletimPdfAssinado = async (boletim) => {
    const assinatura = String(boletim?.assinaturaRecebedor || "").trim();
    const status = String(boletim?.statusRecebimento || "").trim().toUpperCase();
    if (status !== "RECEBIDO" || !assinatura) {
      alert("Este boletim ainda nao foi recebido com assinatura. Primeiro confirme o recebimento via QR e assinatura.");
      return;
    }

    // Gera o mesmo PDF base e adiciona a assinatura ao final.
    // Duplicamos a estrutura para manter o PDF do envio (com QR) separado do PDF assinado.
    const ccOrig = (() => {
      const v = String(boletim?.centroCustoOrigem || "").trim();
      if (v && v !== "---") return v;
      return extrairCentroCusto(boletim?.origem);
    })();
    const ccDest = (() => {
      const v = String(boletim?.centroCustoDestino || "").trim();
      if (v && v !== "---") return v;
      return extrairCentroCusto(boletim?.destino);
    })();

    const qrText = `EG_TRANSFER|${tenantId}|${String(boletim?.id || "").trim()}`;
    const basePublica = getPreferredPublicOrigin();
    const qrUrl = `${basePublica}/qr/${encodeURIComponent(tenantId)}/${encodeURIComponent(String(boletim?.id || "").trim())}`;
    let qrDataUrl = "";
    try {
      if (boletim?.id) {
        qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 8, width: 900, errorCorrectionLevel: "H" });
      }
    } catch {
      qrDataUrl = "";
    }

    const pdf = new jsPDF("landscape", "mm", "a4");
    const logo = await resolverLogoPdf(empresaSistema);
    const largura = pdf.internal.pageSize.getWidth();
    const altura = pdf.internal.pageSize.getHeight();
    const margem = 5;
    const larguraUtil = largura - margem * 2;
    const larguraCabEsq = larguraUtil * 0.72;
    const larguraCabDir = larguraUtil - larguraCabEsq;
    const xCabEsq = margem;
    const xCabDir = xCabEsq + larguraCabEsq;

    if (logo) {
      try {
        pdf.addImage(logo, formatoLogoPdf(logo), xCabEsq + 5, 4.5, 28, 11.5);
      } catch {}
    }

    pdf.setDrawColor(120);
    pdf.rect(xCabEsq, 3, larguraCabEsq, 14);
    pdf.rect(xCabDir, 3, larguraCabDir, 14);

    pdf.setFontSize(12);
    pdf.setFont("helvetica", "bold");
    pdf.text("BOLETIM DE TRANSFERENCIA (ASSINADO)", xCabEsq + larguraCabEsq / 2, 11, { align: "center" });
    pdf.setFontSize(9);
    pdf.text(`Nr Boletim: ${boletim.numeroBoletim || "000001"}`, xCabDir + 4, 8);
    pdf.text(`Obra origem: ${ccOrig || "---"}`, xCabDir + 4, 13);

    // QR tambem vai no rodape (grande). No assinado ajuda a localizar a 2a via por leitura.

    pdf.setFontSize(8);
    pdf.text(`C. Custo (Origem): ${boletim.origem || "-"}`, margem, 22);
    pdf.text(`C. Custo (Destino): ${boletim.destino || "-"}`, margem + larguraUtil * 0.58, 22);

    autoTable(pdf, {
      startY: 24,
      theme: "grid",
      head: [[
        "DATA",
        "CUSTO ORIG.",
        "NR",
        "ITEM",
        "CODIGO",
        "DESCRIÇÃO",
        "APLICACAO",
        "UND",
        "QTD",
        "VLR UNIT.",
        "VLR TOTAL",
        "OBSERVACOES",
        "CUSTO DEST.",
        "TRANSPORTE"
      ]],
      body: (boletim.itens || []).map((item) => [
        formatarData(boletim.data),
        ccOrig || "---",
        `/${boletim.numeroBoletim || "000001"}`,
        String(item.itemNumero || 1),
        item.codigo || "-",
        item.descricao || "-",
        item.aplicacao || "-",
        item.unidade || "UND.",
        String(item.quantidade || 0),
        moedaBR(item.valorUnitario || 0),
        moedaBR(item.valorTotal || 0),
        item.observacao || "-",
        ccDest || "---",
        boletim.placaVeiculo || "-"
      ]),
      styles: { fontSize: 7, cellPadding: 1.1, overflow: "linebreak", valign: "middle" },
      headStyles: { fillColor: [255, 240, 110], textColor: 0, halign: "center", fontStyle: "bold", fontSize: 8 },
      bodyStyles: { fillColor: [255, 255, 224] },
      tableWidth: larguraUtil,
      margin: { left: margem, right: margem }
    });

    let y = (pdf.lastAutoTable?.finalY || 45) + 5;
    const alturaAss = 26;
    if (y + alturaAss > altura - 8) {
      pdf.addPage();
      y = 18;
    }

    pdf.setFontSize(9);
    pdf.setFont("helvetica", "bold");
    pdf.text("ASSINATURA DO RECEBEDOR", margem, y);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    const recebidoPor = String(boletim.recebidoPor || "-").toUpperCase();
    const recebidoEm = boletim.recebidoEm ? new Date(boletim.recebidoEm).toLocaleString("pt-BR") : "-";
    pdf.text(`Recebido por: ${recebidoPor}  |  Data/hora: ${recebidoEm}`, margem, y + 5);

    try {
      const boxX = margem;
      const boxY = y + 7;
      const boxW = Math.min(90, larguraUtil * 0.42);
      const boxH = 18;
      pdf.setDrawColor(140);
      pdf.rect(boxX, boxY, boxW, boxH);
      pdf.addImage(assinatura, "PNG", boxX + 2, boxY + 2, boxW - 4, boxH - 4);
    } catch {
      // noop
    }

    // QR GRANDE NO RODAPE (bem embaixo, nao no meio)
    if (qrDataUrl) {
      const qrSize = 75;
      const blocoAltura = qrSize + 14;
      const alturaAtual = pdf.internal.pageSize.getHeight();
      const yBase = alturaAtual - 14 - blocoAltura;
      // Se assinatura ocupou o rodape, joga o QR para uma pagina extra.
      if (y + 28 > yBase - 6) {
        pdf.addPage();
      }
      const alturaFinal = pdf.internal.pageSize.getHeight();
      const yFinal = alturaFinal - 14 - blocoAltura;
      const qrX = (largura - qrSize) / 2;
      try {
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "bold");
        pdf.text("QR DO BOLETIM (REFERENCIA)", largura / 2, yFinal, { align: "center" });
        pdf.setFillColor(255, 255, 255);
        pdf.rect(qrX - 4, yFinal + 2, qrSize + 8, qrSize + 8, "F");
        pdf.addImage(qrDataUrl, "PNG", qrX, yFinal + 6, qrSize, qrSize);
        pdf.setFontSize(8);
        pdf.setFont("helvetica", "normal");
        pdf.text(`CODIGO (fallback): ${qrText}`, largura / 2, yFinal + qrSize + 10, { align: "center" });
      } catch {
        // noop
      }
    }

    const nomeArquivo = `boletim_transferencia_assinado_${String(boletim.numeroBoletim || "000001")}.pdf`;
    pdf.save(nomeArquivo.toLowerCase());
  };

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: isMobileDevice ? 10 : 20, background: "#f5f7fa", minHeight: "100vh" }}>
      <h2 style={{ textAlign: "center", marginBottom: 20 }}>Boletim de Transferencia</h2>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Novo boletim</h3>
        <div style={{ marginBottom: 8, color: "#1b3e8a", fontWeight: "bold" }}>
          Número previsto do boletim: {proximoNumeroBoletim}
        </div>

        <input
          style={inputStyle}
          type="date"
          value={dataTransferencia}
          onChange={(e) => setDataTransferencia(e.target.value)}
        />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#1b3e8a", marginBottom: 6 }}>Origem (Base)</div>
            <select
              style={inputStyle}
              value={origemBase}
              onChange={(e) => {
                const v = e.target.value;
                setOrigemBase(v);
                setOrigemObra("");
              }}
            >
              <option value="">Selecione a base de origem</option>
              {basesAtivas.map((b) => (
                <option key={b.chave} value={b.chave}>{b.label}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#1b3e8a", marginBottom: 6 }}>Origem (Obra)</div>
            <select
              style={inputStyle}
              value={origemObra}
              onChange={(e) => setOrigemObra(e.target.value)}
              disabled={!origemBase}
            >
              <option value="">{origemBase ? "Selecione a obra de origem" : "Selecione a base primeiro"}</option>
              {(obrasPorBase[origemBase] || []).map((o) => (
                <option key={o.id} value={o.numero}>{`OBRA ${o.numero}`}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#1b3e8a", marginBottom: 6 }}>Destino (Base)</div>
            <select
              style={inputStyle}
              value={destinoBase}
              onChange={(e) => {
                const v = e.target.value;
                setDestinoBase(v);
                setDestinoObra("");
              }}
            >
              <option value="">Selecione a base de destino</option>
              {basesAtivas.map((b) => (
                <option key={b.chave} value={b.chave}>{b.label}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#1b3e8a", marginBottom: 6 }}>Destino (Obra)</div>
            <select
              style={inputStyle}
              value={destinoObra}
              onChange={(e) => setDestinoObra(e.target.value)}
              disabled={!destinoBase}
            >
              <option value="">{destinoBase ? "Selecione a obra de destino" : "Selecione a base primeiro"}</option>
              {(obrasPorBase[destinoBase] || []).map((o) => (
                <option key={o.id} value={o.numero}>{`OBRA ${o.numero}`}</option>
              ))}
            </select>
          </div>
        </div>

        <input
          style={inputStyle}
          placeholder="Motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
          <input
            style={inputStyle}
            placeholder="Solicitado por"
            value={solicitadoPor}
            onChange={(e) => setSolicitadoPor(e.target.value)}
          />
          <input
            style={inputStyle}
            placeholder="Autorizado por"
            value={autorizadoPor}
            onChange={(e) => setAutorizadoPor(e.target.value)}
          />
          <input
            style={inputStyle}
            placeholder="Transportador"
            value={transportador}
            onChange={(e) => setTransportador(e.target.value)}
          />
          <input
            style={inputStyle}
            placeholder="Placa do veiculo"
            value={placaVeiculo}
            onChange={(e) => setPlacaVeiculo(e.target.value)}
          />
          <input
            style={inputStyle}
            placeholder="Código do transporte"
            value={codigoTransporte}
            onChange={(e) => setCodigoTransporte(e.target.value)}
          />
        </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Itens do boletim</h3>

        {isMobileDevice ? (
          <div style={{ display: "grid", gap: 8 }}>
            <input
              style={inputStyle}
              placeholder="Descrição do item"
              value={descricaoItem}
              onChange={(e) => setDescricaoItem(e.target.value)}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <input style={inputStyle} placeholder="Código" value={codigoItem} onChange={(e) => setCodigoItem(e.target.value)} />
              <input style={inputStyle} placeholder="Aplicacao" value={aplicacaoItem} onChange={(e) => setAplicacaoItem(e.target.value)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <input style={inputStyle} placeholder="UND" value={unidadeItem} onChange={(e) => setUnidadeItem(e.target.value)} />
              <input style={inputStyle} placeholder="Qtd" value={quantidadeItem} onChange={(e) => setQuantidadeItem(e.target.value)} />
              <input style={inputStyle} placeholder="Vlr unit." value={valorUnitarioItem} onChange={(e) => setValorUnitarioItem(e.target.value)} />
            </div>
            <input
              style={inputStyle}
              placeholder="Observação do item"
              value={observacaoItem}
              onChange={(e) => setObservacaoItem(e.target.value)}
            />
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 0.8fr 0.8fr 1fr 2fr", gap: 8 }}>
            <input style={inputStyle} placeholder="Descrição do item" value={descricaoItem} onChange={(e) => setDescricaoItem(e.target.value)} />
            <input style={inputStyle} placeholder="Código" value={codigoItem} onChange={(e) => setCodigoItem(e.target.value)} />
            <input style={inputStyle} placeholder="Aplicacao" value={aplicacaoItem} onChange={(e) => setAplicacaoItem(e.target.value)} />
            <input style={inputStyle} placeholder="UND" value={unidadeItem} onChange={(e) => setUnidadeItem(e.target.value)} />
            <input style={inputStyle} placeholder="Qtd" value={quantidadeItem} onChange={(e) => setQuantidadeItem(e.target.value)} />
            <input style={inputStyle} placeholder="Vlr unit." value={valorUnitarioItem} onChange={(e) => setValorUnitarioItem(e.target.value)} />
            <input style={inputStyle} placeholder="Observação do item" value={observacaoItem} onChange={(e) => setObservacaoItem(e.target.value)} />
          </div>
        )}
        <button style={primaryButton} onClick={adicionarItem}>Adicionar item</button>

        {isMobileDevice ? (
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {itens.map((item, idx) => (
              <div
                key={`${item.itemNumero}-${idx}`}
                style={{
                  border: "1px solid #e5ebf3",
                  borderLeft: "6px solid #0b5ed7",
                  borderRadius: 10,
                  padding: 12,
                  background: "#f8fbff"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <div style={{ fontWeight: 900, color: "#173454" }}>ITEM {item.itemNumero}</div>
                  <button
                    style={{ ...primaryButton, background: "#dc3545", padding: "6px 10px" }}
                    onClick={() => removerItem(idx)}
                  >
                    Remover
                  </button>
                </div>

                <div style={{ marginTop: 6, fontWeight: 900, fontSize: 15, color: "#10243e" }}>
                  {item.descricao}
                </div>

                <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 13, color: "#2f4665" }}>
                  <div><strong>COD:</strong> {item.codigo || "-"}</div>
                  <div><strong>APL:</strong> {item.aplicacao || "-"}</div>
                  <div><strong>UND:</strong> {item.unidade || "-"}</div>
                  <div><strong>QTD:</strong> {item.quantidade || "-"}</div>
                  <div><strong>VLR UNIT:</strong> R$ {moedaBR(item.valorUnitario)}</div>
                  <div><strong>VLR TOTAL:</strong> R$ {moedaBR(item.valorTotal)}</div>
                </div>

                <div style={{ marginTop: 8, fontSize: 13, color: "#2f4665" }}>
                  <strong>OBS:</strong> {item.observacao || "-"}
                </div>
              </div>
            ))}
            {!itens.length && (
              <div style={{ border: "1px dashed #cfd7e3", borderRadius: 10, padding: 12, color: "#6c757d", textAlign: "center" }}>
                Nenhum item adicionado.
              </div>
            )}
          </div>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            {(() => {
              const thBase = { border: "1px solid #d8e0ea", padding: 8, textAlign: "center", fontWeight: 900, fontSize: 13 };
              const tdBase = { border: "1px solid #e5ebf3", padding: 8, verticalAlign: "top", fontSize: 13 };
              const tdTexto = {
                ...tdBase,
                whiteSpace: "normal",
                overflowWrap: "anywhere",
                wordBreak: "break-word",
                lineHeight: 1.15
              };
              const cols = [
                { key: "item", label: "Item", w: "6%" },
                { key: "desc", label: "Descrição", w: "22%" },
                { key: "cod", label: "Código", w: "10%" },
                { key: "apl", label: "Aplicacao", w: "12%" },
                { key: "und", label: "UND", w: "6%" },
                { key: "qtd", label: "Qtd", w: "6%" },
                { key: "vu", label: "Vlr Unit", w: "10%" },
                { key: "vt", label: "Vlr Total", w: "10%" },
                { key: "obs", label: "Obs", w: "12%" },
                { key: "acao", label: "Acao", w: "6%" }
              ];

              return (
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1060, tableLayout: "fixed" }}>
                  <thead style={{ background: "#0b5ed7", color: "#fff" }}>
                    <tr>
                      {cols.map((c) => (
                        <th key={c.key} style={{ ...thBase, width: c.w }}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
              <tbody>
                {itens.map((item, idx) => (
                  <tr key={`${item.itemNumero}-${idx}`} style={{ background: idx % 2 === 0 ? "#f8fbff" : "#fff" }}>
                    <td style={{ ...tdBase, textAlign: "center", fontWeight: 900 }}>{item.itemNumero}</td>
                    <td style={{ ...tdTexto, fontWeight: 900 }}>{item.descricao}</td>
                    <td style={{ ...tdTexto, textAlign: "center", fontWeight: 900 }}>{item.codigo || "-"}</td>
                    <td style={{ ...tdTexto, textAlign: "center" }}>{item.aplicacao || "-"}</td>
                    <td style={{ ...tdBase, textAlign: "center", fontWeight: 900 }}>{item.unidade}</td>
                    <td style={{ ...tdBase, textAlign: "center", fontWeight: 900 }}>{item.quantidade}</td>
                    <td style={{ ...tdBase, textAlign: "right", fontWeight: 900 }}>{moedaBR(item.valorUnitario)}</td>
                    <td style={{ ...tdBase, textAlign: "right", fontWeight: 900 }}>{moedaBR(item.valorTotal)}</td>
                    <td style={{ ...tdTexto, textAlign: "center" }}>{item.observacao || "-"}</td>
                    <td style={{ ...tdBase, textAlign: "center" }}>
                      <button style={{ ...primaryButton, background: "#dc3545", padding: "6px 10px" }} onClick={() => removerItem(idx)}>Remover</button>
                    </td>
                  </tr>
                ))}
                {!itens.length && (
                  <tr>
                    <td colSpan={10} style={{ border: "1px solid #e5ebf3", padding: 12, textAlign: "center", color: "#6c757d" }}>
                      Nenhum item adicionado.
                    </td>
                  </tr>
                )}
              </tbody>
                </table>
              );
            })()}
          </div>
        )}

        <div style={{ marginTop: 10, fontWeight: "bold", color: "#173454" }}>
          Qtd. itens: {itens.length} | Quantidade total: {totais.qtd} | Valor total: R$ {moedaBR(totais.total)}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <button style={primaryButton} onClick={salvarBoletim}>Salvar boletim</button>
          <button style={{ ...primaryButton, background: "#6c757d" }} onClick={limparBoletim}>Limpar tudo</button>
        </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Histórico de boletins</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100, tableLayout: "fixed" }}>
            <thead style={{ background: "#0b5ed7", color: "#fff" }}>
              <tr>
                {["Data", "Nr", "Origem", "Destino", "Itens", "Valor Total", "Status", "Ações"].map((h) => (
                  <th key={h} style={{ border: "1px solid #d8e0ea", padding: 8, textAlign: "center" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {boletins.map((item, idx) => (
                (() => {
                  const donoLogin = String(item?.criadoPorLogin || "").trim().toLowerCase();
                  const donoNome = String(item?.criadoPor || "").trim().toLowerCase();
                  const nomeAtual = String(responsavelAtual || "").trim().toLowerCase();
                  const podeDarBaixa =
                    podeDarBaixaPorPerfil ||
                    (Boolean(identificadorLoginAtual) && Boolean(donoLogin) && identificadorLoginAtual === donoLogin) ||
                    (Boolean(nomeAtual) && Boolean(donoNome) && nomeAtual === donoNome);
                  const isAberto = String(boletimDetalheAbertoId || "") === String(item?.id || "");
                  const podePdfAssinado =
                    String(item?.statusRecebimento || "").toUpperCase() === "RECEBIDO" &&
                    Boolean(String(item?.assinaturaRecebedor || "").trim());

                  return (
                    <>
                      <tr key={item.id} style={{ background: idx % 2 === 0 ? "#f8fbff" : "#fff" }}>
                        <td style={{ border: "1px solid #e5ebf3", padding: 8, textAlign: "center" }}>{formatarData(item.data)}</td>
                        <td style={{ border: "1px solid #e5ebf3", padding: 8, textAlign: "center", fontWeight: "bold" }}>{item.numeroBoletim || "-"}</td>
                        <td style={{ border: "1px solid #e5ebf3", padding: 8, textAlign: "center" }}>{item.origem || "-"}</td>
                        <td style={{ border: "1px solid #e5ebf3", padding: 8, textAlign: "center" }}>{item.destino || "-"}</td>
                        <td style={{ border: "1px solid #e5ebf3", padding: 8, textAlign: "center" }}>{(item.itens || []).length}</td>
                        <td style={{ border: "1px solid #e5ebf3", padding: 8, textAlign: "right", fontWeight: "bold" }}>
                          R$ {moedaBR(item.valorTotalBoletim || 0)}
                        </td>
                        <td style={{ border: "1px solid #e5ebf3", padding: 8, textAlign: "center", fontWeight: "bold", color: item.statusRecebimento === "RECEBIDO" ? "#198754" : "#b02a37" }}>
                          {item.statusRecebimento || "PENDENTE"}
                        </td>
                        <td style={{ border: "1px solid #e5ebf3", padding: 8, textAlign: "center" }}>
                          <button
                            type="button"
                            style={{
                              ...primaryButton,
                              background: isAberto ? "#6c757d" : "#0b5ed7",
                              padding: "7px 12px",
                              minWidth: 92
                            }}
                            onClick={() => setBoletimDetalheAbertoId(isAberto ? "" : String(item.id))}
                          >
                            {isAberto ? "Fechar" : "Abrir"}
                          </button>
                        </td>
                      </tr>

                      {isAberto && (
                        <tr key={`${item.id}__detalhe`}>
                          <td colSpan={8} style={{ border: "1px solid #e5ebf3", padding: 10, background: "#f1f6ff" }}>
                            <div style={{ display: "grid", gap: 10 }}>
                              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                                <button
                                  type="button"
                                  style={{ ...primaryButton, background: "#198754", padding: "8px 12px" }}
                                  onClick={() => gerarBoletimPdf(item)}
                                >
                                  PDF (com QR)
                                </button>
                                <button
                                  type="button"
                                  style={{
                                    ...primaryButton,
                                    background: podePdfAssinado ? "#20c997" : "#9aa4b2",
                                    padding: "8px 12px",
                                    cursor: podePdfAssinado ? "pointer" : "not-allowed"
                                  }}
                                  disabled={!podePdfAssinado}
                                  title="So libera depois que o destino confirmar e assinar no QR"
                                  onClick={() => gerarBoletimPdfAssinado(item)}
                                >
                                  PDF assinado
                                </button>
                                <button
                                  type="button"
                                  style={{
                                    ...primaryButton,
                                    background: item.statusRecebimento === "RECEBIDO" ? "#6c757d" : (podeDarBaixa ? "#f0ad4e" : "#9aa4b2"),
                                    color: item.statusRecebimento === "RECEBIDO" ? "#fff" : "#000",
                                    padding: "8px 12px",
                                    cursor: item.statusRecebimento === "RECEBIDO" || !podeDarBaixa ? "not-allowed" : "pointer"
                                  }}
                                  onClick={() => darBaixa(item)}
                                  disabled={item.statusRecebimento === "RECEBIDO" || !podeDarBaixa}
                                  title={podeDarBaixa ? "Dar baixa no boletim" : "Somente quem criou o boletim pode dar baixa"}
                                >
                                  Dar baixa
                                </button>
                              </div>

                              <div style={{ display: "grid", gap: 4, color: "#173454", fontSize: 13 }}>
                                <div><strong>Transportador:</strong> {String(item.transportador || "-")}</div>
                                <div><strong>Placa:</strong> {String(item.placaVeiculo || "-")} <span style={{ opacity: 0.8 }}> | </span> <strong>Código:</strong> {String(item.codigoTransporte || "-")}</div>
                                {String(item.recebidoPor || "").trim() && (
                                  <div><strong>Recebido por:</strong> {String(item.recebidoPor || "-")} {item.recebidoEm ? `(${new Date(item.recebidoEm).toLocaleString("pt-BR")})` : ""}</div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })()
              ))}
              {!boletins.length && (
                <tr>
                  <td colSpan={8} style={{ border: "1px solid #e5ebf3", padding: 12, textAlign: "center", color: "#6c757d" }}>
                    Nenhum boletim encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Transferencias;

