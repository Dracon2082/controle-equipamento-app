/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { db } from "../firebase";
import { registrarHistorico } from "../utils/historico";
import { formatoLogoPdf, resolverLogoPdf } from "../utils/pdfLogo";
import { belongsToTenant, getConfigDocId, getTenantId } from "../utils/tenant";

function Relatorio({ setTela }) {
  const tenantId = getTenantId();
  const [requisitanteFiltro, setRequisitanteFiltro] = useState("");
  const [equipamento, setEquipamento] = useState("");
  const [mes, setMes] = useState("");
  const [empresaSistema, setEmpresaSistema] = useState(null);

  const [equipamentos, setEquipamentos] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [lancamentos, setLancamentos] = useState([]);
  const [abastecimentos, setAbastecimentos] = useState([]);

  const card = {
    background: "#fff",
    border: "1px solid #e3e7ef",
    borderRadius: 8,
    padding: 14,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)"
  };

  const headerCard = {
    ...card,
    padding: "10px 12px"
  };

  const inputBase = {
    width: "100%",
    height: 40,
    borderRadius: 8,
    border: "1px solid #cfd7e3",
    padding: "0 10px",
    boxSizing: "border-box"
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    carregarBase();
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (equipamento && mes) {
      carregarMovimento();
      return;
    }
    setLancamentos([]);
    setAbastecimentos([]);
  }, [equipamento, mes]);

  const numero = (valor) => {
    let texto = String(valor ?? "").trim();
    if (!texto) return 0;

    if (texto.includes(",") && texto.includes(".")) {
      if (texto.lastIndexOf(",") > texto.lastIndexOf(".")) {
        texto = texto.replace(/\./g, "").replace(",", ".");
      } else {
        texto = texto.replace(/,/g, "");
      }
    } else if (texto.includes(",")) {
      texto = texto.replace(",", ".");
    }

    const convertido = Number(texto);
    return Number.isFinite(convertido) ? convertido : 0;
  };

  // Ex: 10 -> "10", 10.5 -> "10,5", 10.25 -> "10,25"
  const formatarQuantidadeCurta = (valor) =>
    numero(valor).toLocaleString("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });

  // Ex: "OLEO MOTOR 15W40" -> "15W40", "OLEO HIDRAULICO ISO 68" -> "ISO 68"
  const abreviarProdutoLubrificante = (produto) => {
    const original = String(produto || "").trim();
    const texto = normalizarEquipamento(original);
    if (!texto) return "-";

    let tokens = texto.split(/\s+/).filter(Boolean);
    if (!tokens.length) return "-";

    // Remove prefixos genericos.
    if ((tokens[0] === "OLEO" || tokens[0] === "GRAXA") && tokens.length > 1) {
      tokens = tokens.slice(1);
    }

    // Remove categoria do oleo quando houver uma "sigla" depois.
    const categoriasOleo = new Set([
      "MOTOR",
      "DIFERENCIAL",
      "COMPRESSOR",
      "REDUTOR",
      "TRANSMISSAO",
      "HIDRAULICO"
    ]);
    if (tokens.length > 1 && categoriasOleo.has(tokens[0])) {
      tokens = tokens.slice(1);
    }

    // Preferir manter do "ISO" em diante (ISO 32/46/68/220...).
    const idxIso = tokens.indexOf("ISO");
    if (idxIso >= 0 && idxIso < tokens.length - 0) {
      const iso = tokens.slice(idxIso).join(" ").trim();
      if (iso) return iso;
    }

    const resultado = tokens.join(" ").trim();
    return resultado || texto || "-";
  };

  const normalizar = (valor) =>
    String(valor || "")
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const normalizarEquipamento = (valor) =>
    normalizar(valor).replace(/\s+/g, " ").trim();

  const primeiroNome = (nomeCompleto) => {
    const nome = String(nomeCompleto || "").trim();
    if (!nome) return "-";
    return nome.split(/\s+/)[0];
  };

  const formatarDataBR = (dataISO) => {
    const texto = String(dataISO || "").trim();
    const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return texto;
    const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    return texto || "-";
  };

  const parseDataFlex = (valor) => {
    const texto = String(valor || "").trim();
    const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
    const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return null;
  };

  const pertenceAoMes = (dataTexto, mesRef) => {
    if (!mesRef) return false;
    const [anoRef, mesNumeroRef] = String(mesRef).split("-");
    const data = parseDataFlex(dataTexto);
    if (!data) return false;
    return (
      String(data.getFullYear()) === String(anoRef) &&
      String(data.getMonth() + 1).padStart(2, "0") === String(mesNumeroRef)
    );
  };

  const formatarMoeda = (valor) =>
    Number(valor || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });

  const montarRotuloEquipamento = (eq) => {
    const nome = String(eq?.nome || "").trim() || "EQUIPAMENTO";
    const codigo = String(eq?.codigo || eq?.equipamentoCodigo || eq?.numeroFrota || "").trim().toUpperCase();
    const placa = String(eq?.placa || "").trim().toUpperCase();
    const complemento = codigo || placa;
    return complemento ? `${nome} - ${complemento}` : nome;
  };

  const formatarMesAno = (valorMes) => {
    if (!valorMes || !String(valorMes).includes("-")) return "-";
    const [ano, mesNumero] = String(valorMes).split("-");
    const meses = [
      "janeiro",
      "fevereiro",
      "marco",
      "abril",
      "maio",
      "junho",
      "julho",
      "agosto",
      "setembro",
      "outubro",
      "novembro",
      "dezembro"
    ];
    const indice = Number(mesNumero) - 1;
    if (indice < 0 || indice > 11) return valorMes;
    return `${meses[indice]} de ${ano}`;
  };

  const identificarObra = (obraTexto) => {
    const texto = String(obraTexto || "").trim();
    if (!texto) return "-";

    const matchNumero = texto.match(/\d{3}/);
    if (matchNumero) return matchNumero[0];

    const textoLimpo = texto.replace(/\s+/g, " ").trim().toUpperCase();
    if (textoLimpo.length <= 14) return textoLimpo;

    const partes = textoLimpo.split(" ").filter(Boolean);
    if (partes.length >= 2) {
      return `${partes[0].slice(0, 4)}-${partes[1].slice(0, 4)}`;
    }
    return textoLimpo.slice(0, 8);
  };

  const carregarBase = async () => {
    const [snapEquip, snapFunc, snapConfig] = await Promise.all([
      getDocs(collection(db, "equipamentos")),
      getDocs(collection(db, "funcionarios")),
      getDoc(doc(db, "configuracoes", getConfigDocId(tenantId)))
    ]);

    const listaEquip = snapEquip.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId));
    listaEquip.sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));
    setEquipamentos(listaEquip);

    setFuncionarios(snapFunc.docs.map((d) => d.data()).filter((item) => belongsToTenant(item, tenantId)));

    if (snapConfig.exists()) {
      setEmpresaSistema(snapConfig.data());
    }
  };

  const carregarMovimento = async () => {
    const equipamentoSelecionado = equipamentos.find((e) => (e.id || "") === equipamento);
    const nomeEquipamentoSelecionado = equipamentoSelecionado?.nome || "";

    if (!nomeEquipamentoSelecionado) {
      setLancamentos([]);
      setAbastecimentos([]);
      return;
    }

    const [snapLanc, snapAbast] = await Promise.all([
      getDocs(collection(db, "lancamentos")),
      getDocs(collection(db, "abastecimentos"))
    ]);

    const listaLanc = snapLanc.docs
      .map((d) => d.data())
      .filter((item) => belongsToTenant(item, tenantId))
      .filter(
        (item) =>
          normalizarEquipamento(item.equipamento) === normalizarEquipamento(nomeEquipamentoSelecionado) &&
          pertenceAoMes(item.data, mes)
      );

    const listaAbast = snapAbast.docs
      .map((d) => d.data())
      .filter((item) => belongsToTenant(item, tenantId))
      .filter(
        (item) =>
          normalizarEquipamento(item.equipamento) === normalizarEquipamento(nomeEquipamentoSelecionado) &&
          pertenceAoMes(item.data, mes)
      );

    listaLanc.sort((a, b) => {
      const da = parseDataFlex(a.data);
      const db = parseDataFlex(b.data);
      return (da?.getTime() || 0) - (db?.getTime() || 0);
    });
    listaAbast.sort((a, b) => {
      const da = parseDataFlex(a.data);
      const db = parseDataFlex(b.data);
      return (da?.getTime() || 0) - (db?.getTime() || 0);
    });

    setLancamentos(listaLanc);
    setAbastecimentos(listaAbast);
  };

  const equipamentoObj = useMemo(
    () => equipamentos.find((e) => (e.id || "") === equipamento),
    [equipamentos, equipamento]
  );

  const requisitantesDisponiveis = useMemo(() => {
    const mapa = new Map();
    equipamentos.forEach((eq) => {
      const nome = String(eq?.proprietario || eq?.empresa || eq?.nomeEmpresa || "").trim();
      if (!nome) return;
      const chave = normalizarEquipamento(nome);
      if (!mapa.has(chave)) mapa.set(chave, nome);
    });
    return Array.from(mapa.values()).sort((a, b) => String(a).localeCompare(String(b)));
  }, [equipamentos]);

  const equipamentosFiltrados = useMemo(() => {
    if (!requisitanteFiltro) return equipamentos;
    return equipamentos.filter((eq) => {
      const nome = String(eq?.proprietario || eq?.empresa || eq?.nomeEmpresa || "").trim();
      return normalizarEquipamento(nome) === normalizarEquipamento(requisitanteFiltro);
    });
  }, [equipamentos, requisitanteFiltro]);

  const requisitanteEquipamento = useMemo(
    () =>
      requisitanteFiltro ||
      equipamentoObj?.proprietario ||
      equipamentoObj?.empresa ||
      equipamentoObj?.nomeEmpresa ||
      "-",
    [equipamentoObj, requisitanteFiltro]
  );

  useEffect(() => {
    if (!equipamento) return;
    const existeNoFiltro = equipamentosFiltrados.some((eq) => (eq.id || "") === equipamento);
    if (!existeNoFiltro) setEquipamento("");
  }, [equipamento, equipamentosFiltrados]);

  const operadorCabecalho = useMemo(() => {
    const nomePrimeiroLanc = lancamentos[0]?.operador;
    if (nomePrimeiroLanc) return funcionarios.find((f) => f.nome === nomePrimeiroLanc) || null;

    const nomePrimeiroAbastecimento = abastecimentos.find((a) => a.operador)?.operador;
    if (nomePrimeiroAbastecimento) {
      return funcionarios.find((f) => f.nome === nomePrimeiroAbastecimento) || { nome: nomePrimeiroAbastecimento };
    }

    return null;
  }, [funcionarios, lancamentos, abastecimentos]);

  const resumoDias = useMemo(() => {
    const chaveData = (dataTexto) => {
      const dt = parseDataFlex(dataTexto);
      if (!dt) return String(dataTexto || "");
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      const d = String(dt.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    };

    const setStatus = (chave) =>
      new Set(
        lancamentos
          .filter((item) => normalizar(item.status).includes(chave))
          .map((item) => chaveData(item.data))
      ).size;

    return {
      trabalhados: setStatus("TRAB"),
      disposicao: setStatus("DISP"),
      chuva: setStatus("CHUVA"),
      mecanica: setStatus("MEC")
    };
  }, [lancamentos]);

  const totais = useMemo(() => {
    const horas = lancamentos.reduce((acc, item) => {
      const diferenca = numero(item.horimetroFinal) - numero(item.horimetroInicial);
      return acc + (diferenca > 0 ? diferenca : 0);
    }, 0);

    const dieselEstoque = abastecimentos.reduce((acc, item) => acc + numero(item.litros), 0);
    const dieselPosto = lancamentos.reduce((acc, item) => {
      if (!item?.postoAbasteceu) return acc;
      return acc + numero(item.postoLitros);
    }, 0);
    const dieselTotal = dieselEstoque + dieselPosto;
    const dieselS10 = abastecimentos
      .filter((item) => normalizar(item.tipo).includes("10"))
      .reduce((acc, item) => acc + numero(item.litros), 0);
    const dieselS500 = abastecimentos
      .filter((item) => normalizar(item.tipo).includes("500"))
      .reduce((acc, item) => acc + numero(item.litros), 0);

    const totalOleo = abastecimentos.reduce((acc, item) => {
      const soma = (item.lubrificacoes || [])
        .filter((l) => normalizar(l.tipo).includes("OLEO"))
        .reduce((total, l) => total + numero(l.quantidade), 0);
      return acc + soma;
    }, 0);

    const totalGraxa = abastecimentos.reduce((acc, item) => {
      const soma = (item.lubrificacoes || [])
        .filter((l) => normalizar(l.tipo).includes("GRAXA"))
        .reduce((total, l) => total + numero(l.quantidade), 0);
      return acc + soma;
    }, 0);

    const totalValor = abastecimentos.reduce((acc, item) => acc + numero(item.total), 0);
    const mediaLH = horas > 0 ? dieselTotal / horas : 0;
    const qtdAbastecimentos = abastecimentos.length;
    const valorMedioLitro = dieselTotal > 0 ? totalValor / dieselTotal : 0;

    return {
      horas,
      dieselTotal,
      dieselPosto,
      dieselS10,
      dieselS500,
      totalOleo,
      totalGraxa,
      totalValor,
      mediaLH,
      qtdAbastecimentos,
      valorMedioLitro
    };
  }, [lancamentos, abastecimentos]);

  const linhasDiarias = useMemo(() => {
    const mapa = new Map();
    const chaveData = (dataTexto) => {
      const dt = parseDataFlex(dataTexto);
      if (!dt) return String(dataTexto || "");
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      const d = String(dt.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    };
    const marcarStatus = (linha, statusTexto) => {
      const s = normalizar(statusTexto);
      if (s.includes("TRAB")) linha.trabalhando = 1;
      if (s.includes("DISP")) linha.disposicao = 1;
      if (s.includes("CHUVA")) linha.chuva = 1;
      if (s.includes("MEC")) linha.mecanica = 1;
    };

    lancamentos.forEach((item) => {
      const chave = chaveData(item.data);
      if (!mapa.has(chave)) {
        mapa.set(chave, {
          data: chave,
          obra: item.obra || "-",
          descricao: item.descricao || "-",
          hrInicial: item.horimetroInicial || "-",
          hrFinal: item.horimetroFinal || "-",
          horas: 0,
          diesel: 0,
          tipoDiesel: "",
          dieselPosto: 0,
          postoNF: "",
          oleo: [],
          graxa: [],
          trabalhando: 0,
          disposicao: 0,
          chuva: 0,
          mecanica: 0
        });
      }

      const linha = mapa.get(chave);
      const diferenca = numero(item.horimetroFinal) - numero(item.horimetroInicial);
      linha.horas += diferenca > 0 ? diferenca : 0;
      linha.obra = item.obra || linha.obra;
      linha.descricao = item.descricao || linha.descricao;
      linha.hrInicial = item.horimetroInicial || linha.hrInicial;
      linha.hrFinal = item.horimetroFinal || linha.hrFinal;
      marcarStatus(linha, item.status);

      // Abastecimento em posto (fora do estoque do sistema) - entra no relatorio mensal do equipamento.
      if (item?.postoAbasteceu) {
        const litrosPosto = numero(item.postoLitros);
        if (litrosPosto > 0) {
          linha.diesel += litrosPosto;
          linha.dieselPosto += litrosPosto;
          linha.tipoDiesel = [linha.tipoDiesel, "POSTO"].filter(Boolean).join(" / ");
          const nf = String(item.postoNotaFiscal || "").trim();
          if (nf) linha.postoNF = nf;
          // Ajuda a explicar no PDF sem criar mais colunas.
          linha.descricao = `${linha.descricao} | POSTO: ${formatarQuantidadeCurta(litrosPosto)}L${nf ? ` NF ${nf}` : ""}`;
        }
      }
    });

    abastecimentos.forEach((item) => {
      const chave = chaveData(item.data);
      if (!mapa.has(chave)) {
        mapa.set(chave, {
          data: chave,
          obra: item.obra || "-",
          descricao: "-",
          hrInicial: "-",
          hrFinal: item.horimetro || "-",
          horas: 0,
          diesel: 0,
          tipoDiesel: "",
          dieselPosto: 0,
          postoNF: "",
          oleo: [],
          graxa: [],
          trabalhando: 0,
          disposicao: 0,
          chuva: 0,
          mecanica: 0
        });
      }

      const linha = mapa.get(chave);
      linha.diesel += numero(item.litros);
      linha.tipoDiesel = [linha.tipoDiesel, item.tipo].filter(Boolean).join(" / ");

      (item.lubrificacoes || []).forEach((l) => {
        if (normalizar(l.tipo).includes("GRAXA")) {
          linha.graxa.push(`${abreviarProdutoLubrificante(l.produto)} (${formatarQuantidadeCurta(l.quantidade)} KG)`);
        } else if (normalizar(l.tipo).includes("OLEO")) {
          linha.oleo.push(`${abreviarProdutoLubrificante(l.produto)} (${formatarQuantidadeCurta(l.quantidade)} L)`);
        }
      });
    });

    return Array.from(mapa.values()).sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));
  }, [lancamentos, abastecimentos]);

  const resumoLubrificantesPorProduto = useMemo(() => {
    const mapa = new Map();
    abastecimentos.forEach((item) => {
      (item.lubrificacoes || []).forEach((l) => {
        const tipoNormal = normalizar(l.tipo);
        const tipo = tipoNormal.includes("GRAXA") ? "Graxa" : "Oleo";
        const produto = abreviarProdutoLubrificante(l.produto || "SEM PRODUTO");
        const unidade = tipo === "Graxa" ? "KG" : "L";
        const chave = `${tipo}|${produto}|${unidade}`;
        const atual = mapa.get(chave) || {
          tipo,
          produto,
          unidade,
          quantidade: 0
        };
        atual.quantidade += numero(l.quantidade);
        mapa.set(chave, atual);
      });
    });
    return Array.from(mapa.values()).sort((a, b) => String(a.produto).localeCompare(String(b.produto)));
  }, [abastecimentos]);

  const gerarPDF = async () => {
    if (!equipamento || !mes) {
      alert("Selecione equipamento e mes para gerar o PDF.");
      return;
    }

    const pdf = new jsPDF("landscape", "mm", "a4");
    const larguraPagina = pdf.internal.pageSize.getWidth();
    const alturaPagina = pdf.internal.pageSize.getHeight();
    const margem = { left: 10, right: 10, top: 10, bottom: 10 };
    const larguraUtil = larguraPagina - margem.left - margem.right;

    const logoPdf = await resolverLogoPdf(empresaSistema);
    if (logoPdf) {
      try {
        pdf.addImage(logoPdf, formatoLogoPdf(logoPdf), 10, 7, 24, 12);
      } catch (e) {
        console.log("Nao foi possivel carregar a logo no PDF.");
      }
    }

    pdf.setFontSize(14);
    pdf.setFont(undefined, "bold");
    pdf.text("RELATORIO MENSAL DE EQUIPAMENTO", larguraPagina / 2, 13, { align: "center" });

    autoTable(pdf, {
      startY: 21,
      theme: "grid",
      tableWidth: larguraUtil,
      head: [[{ content: "Identificacao", colSpan: 4, styles: { halign: "center" } }]],
      body: [
        [
          "Equipamento",
          montarRotuloEquipamento(equipamentoObj) || "-",
          "Placa",
          equipamentoObj?.placa || "-"
        ],
        [
          "Código",
          equipamentoObj?.codigo || "-",
          "Requisitante",
          requisitanteEquipamento
        ],
        [
          "Operador",
          primeiroNome(operadorCabecalho?.nome || "-"),
          "Período",
          formatarMesAno(mes)
        ],
        [
          "Gerado em",
          new Date().toLocaleString("pt-BR"),
          "Mes",
          mes || "-"
        ]
      ],
      styles: { fontSize: 6.6, cellPadding: 0.6 },
      headStyles: { fillColor: [11, 94, 215], textColor: 255, fontStyle: "bold", fontSize: 6.6, cellPadding: 0.6 },
      columnStyles: {
        0: { cellWidth: 36, fontStyle: "bold" },
        1: { cellWidth: 95 },
        2: { cellWidth: 36, fontStyle: "bold" },
        3: { cellWidth: larguraUtil - 36 - 95 - 36 }
      },
      margin: { left: margem.left, right: margem.right }
    });

    const corpoDiario = linhasDiarias.map((linha) => [
      formatarDataBR(linha.data),
      identificarObra(linha.obra),
      linha.descricao || "-",
      linha.hrInicial || "-",
      linha.hrFinal || "-",
      numero(linha.horas).toFixed(2),
      numero(linha.diesel).toFixed(2),
      linha.tipoDiesel || "-",
      linha.oleo.join(" | ") || "-",
      linha.graxa.join(" | ") || "-",
      linha.trabalhando || "",
      linha.disposicao || "",
      linha.chuva || "",
      linha.mecanica || ""
    ]);

    const col0 = 14;
    const col1 = 24;
    const col2 = 28;
    const col3 = 12;
    const col4 = 12;
    const col5 = 10;
    const col6 = 12;
    const col7 = 10;
    const col8 = 44;
    const col10 = 8;
    const col11 = 8;
    const col12 = 8;
    const col13 = 8;
    const col9 = larguraUtil - (col0 + col1 + col2 + col3 + col4 + col5 + col6 + col7 + col8 + col10 + col11 + col12 + col13);

    autoTable(pdf, {
      startY: (pdf.lastAutoTable?.finalY || 26) + 2,
      theme: "grid",
      tableWidth: larguraUtil,
      head: [[
        "Data",
        "Obra",
        "Servico",
        "Hr Inicial",
        "Hr Final",
        "Horas",
        "Diesel (L)",
        "Tipo",
        "Oleo",
        "Graxa",
        "Trab.",
        "Disp.",
        "Chuva",
        "Mec."
      ]],
      body: corpoDiario,
      styles: {
        // Importante: manter 31 linhas (meses com dia 31) em uma unica pagina sem quebrar.
        // Para isso evitamos quebra de linha e reduzimos um pouco a altura das celulas.
        fontSize: 5.6,
        cellPadding: 0.6,
        overflow: "ellipsize",
        valign: "middle"
      },
      headStyles: {
        fillColor: [11, 94, 215],
        textColor: 255,
        fontStyle: "bold",
        halign: "center",
        fontSize: 5.8,
        cellPadding: 0.7
      },
      alternateRowStyles: { fillColor: [244, 247, 252] },
      columnStyles: {
        0: { cellWidth: col0 },
        1: { cellWidth: col1 },
        2: { cellWidth: col2 },
        3: { cellWidth: col3, halign: "center" },
        4: { cellWidth: col4, halign: "center" },
        5: { cellWidth: col5, halign: "right" },
        6: { cellWidth: col6, halign: "right" },
        7: { cellWidth: col7, halign: "center" },
        8: { cellWidth: col8 },
        9: { cellWidth: col9 },
        10: { cellWidth: col10, halign: "center" },
        11: { cellWidth: col11, halign: "center" },
        12: { cellWidth: col12, halign: "center" },
        13: { cellWidth: col13, halign: "center" }
      },
      margin: { left: margem.left, right: margem.right, bottom: margem.bottom }
    });

    let y = (pdf.lastAutoTable?.finalY || 150) + 4;

    if (y > alturaPagina - 45) {
      pdf.addPage("a4", "landscape");
      y = 14;
    }

    const resumoMesPdf = [
      ["Horas trabalhadas", totais.horas.toFixed(2)],
      ["Dias trabalhados", resumoDias.trabalhados],
      ["Dias a disposicao", resumoDias.disposicao],
      ["Dias de chuva", resumoDias.chuva],
      ["Dias em mecanica", resumoDias.mecanica]
    ];

    const resumoAbastPdf = [
      ["Qtd. de abastecimentos", totais.qtdAbastecimentos],
      ["Qtd. litros abastecidos", `${totais.dieselTotal.toFixed(2)} L`],
      ["Valor medio diesel (R$/L)", formatarMoeda(totais.valorMedioLitro)],
      ["Valor total diesel (R$)", formatarMoeda(totais.totalValor)],
      ["Oleo total", `${totais.totalOleo.toFixed(2)} L`],
      ["Graxa total", `${totais.totalGraxa.toFixed(2)} KG`],
      ...resumoLubrificantesPorProduto.map((item) => [
        `${item.tipo} - ${item.produto}`,
        `${formatarQuantidadeCurta(item.quantidade)} ${item.unidade}`
      ])
    ];

    const blocoEsqW = 92;
    const blocoCentroW = 140;
    const blocoDirW = larguraUtil - blocoEsqW - blocoCentroW - 6;
    const xEsq = margem.left;
    const xCentro = xEsq + blocoEsqW + 3;
    const xDir = xCentro + blocoCentroW + 3;

    autoTable(pdf, {
      startY: y,
      theme: "grid",
      tableWidth: blocoEsqW,
      head: [["Resumo do mes", "Valor"]],
      body: resumoMesPdf,
      styles: { fontSize: 7.6, cellPadding: 1.2 },
      headStyles: { fillColor: [11, 94, 215], textColor: 255, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: blocoEsqW * 0.68 },
        1: { cellWidth: blocoEsqW * 0.32, halign: "right" }
      },
      margin: { left: xEsq, right: margem.right, bottom: margem.bottom }
    });
    const fimEsq = pdf.lastAutoTable?.finalY || y;

    autoTable(pdf, {
      startY: y,
      theme: "grid",
      tableWidth: blocoCentroW,
      head: [["Resumo dos abastecimentos", "Valor"]],
      body: resumoAbastPdf,
      styles: { fontSize: 7.2, cellPadding: 1.2, overflow: "linebreak" },
      headStyles: { fillColor: [11, 94, 215], textColor: 255, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: blocoCentroW * 0.72 },
        1: { cellWidth: blocoCentroW * 0.28, halign: "right" }
      },
      margin: { left: xCentro, right: margem.right, bottom: margem.bottom }
    });
    const fimCentro = pdf.lastAutoTable?.finalY || y;

    const alturaBloco = Math.max(26, Math.min(70, Math.max(fimEsq, fimCentro) - y));
    pdf.setFillColor(11, 94, 215);
    pdf.rect(xDir, y, blocoDirW, 8, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(9);
    pdf.setFont(undefined, "bold");
    pdf.text("Media L/H", xDir + blocoDirW / 2, y + 5.5, { align: "center" });
    pdf.setDrawColor(190, 202, 219);
    pdf.rect(xDir, y + 8, blocoDirW, alturaBloco - 8);
    pdf.setTextColor(11, 94, 215);
    pdf.setFontSize(18);
    pdf.text(totais.mediaLH.toFixed(2), xDir + blocoDirW / 2, y + 8 + (alturaBloco - 8) / 2 + 2, { align: "center" });
    pdf.setTextColor(0, 0, 0);

    const totalPaginas = pdf.getNumberOfPages();
    for (let i = 1; i <= totalPaginas; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.text(`Pagina ${i} de ${totalPaginas}`, larguraPagina - margem.right, alturaPagina - 5, {
        align: "right"
      });
    }

    // Assinaturas (somente na ultima pagina)
    pdf.setPage(totalPaginas);
    {
      const yLinha = alturaPagina - 18;
      const yTexto = yLinha + 5.5;
      const gap = 12;
      const blocoW = (larguraUtil - gap) / 2;
      const x1 = margem.left;
      const x2 = margem.left + blocoW + gap;
      const linhaMargem = 12;
      pdf.setDrawColor(80, 80, 80);
      pdf.setLineWidth(0.25);
      pdf.line(x1 + linhaMargem, yLinha, x1 + blocoW - linhaMargem, yLinha);
      pdf.line(x2 + linhaMargem, yLinha, x2 + blocoW - linhaMargem, yLinha);
      pdf.setFontSize(9);
      pdf.setTextColor(30, 30, 30);
      pdf.text("ENGENHEIRO", x1 + blocoW / 2, yTexto, { align: "center" });
      pdf.text("ENCARREGADO", x2 + blocoW / 2, yTexto, { align: "center" });
      pdf.setTextColor(0, 0, 0);
    }

    pdf.save(`relatorio_mensal_equipamento_${mes}_${normalizarEquipamento(montarRotuloEquipamento(equipamentoObj)).replace(/\s+/g, "_")}.pdf`);
    registrarHistorico({
      modulo: "RELATORIO",
      acao: "GEROU_PDF",
      entidade: "RELATORIO_MENSAL_EQUIPAMENTO",
      registroId: `${mes}-${equipamento}`,
      usuario: primeiroNome(operadorCabecalho?.nome || "-"),
      descricao: `Gerou PDF mensal do equipamento ${montarRotuloEquipamento(equipamentoObj)} (${mes}).`
    });
  };

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "18px 10px 28px", background: "#f3f5f8" }}>
      <div style={{ ...headerCard, marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <h2 style={{ margin: 0, color: "#0f2440" }}>Relatório Mensal de Equipamento</h2>
          </div>
        <p style={{ margin: "4px 0 0", color: "#4a5c74" }}>
          Relatório mensal com descricao de servico, horas, diesel, oleo, graxa e detalhamento de lubrificacao.
        </p>
        <p style={{ margin: "4px 0 0", color: "#4a5c74", fontWeight: "bold" }}>
          Requisitante: {requisitanteEquipamento}
        </p>
      </div>

      <div style={{ ...card, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0, color: "#10243e" }}>Filtros</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 10,
            marginBottom: 10
          }}
        >
          <div>
            <label style={{ fontSize: 12, color: "#5a6b82" }}>Requisitante</label>
            <select style={inputBase} value={requisitanteFiltro} onChange={(e) => setRequisitanteFiltro(e.target.value)}>
              <option value="">Selecione o requisitante</option>
              {requisitantesDisponiveis.map((req) => (
                <option key={req} value={req}>
                  {req}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#5a6b82" }}>Equipamento</label>
            <select style={inputBase} value={equipamento} onChange={(e) => setEquipamento(e.target.value)}>
              <option value="">Selecione o equipamento</option>
              {equipamentosFiltrados.map((eq) => (
                <option key={eq.id || eq.nome} value={eq.id || ""}>
                  {montarRotuloEquipamento(eq)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#5a6b82" }}>Mes de referencia</label>
            <input style={inputBase} type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
          </div>
        </div>

        <button
          onClick={gerarPDF}
          style={{
            background: "#198754",
            border: "none",
            color: "#fff",
            borderRadius: 8,
            padding: "10px 14px",
            fontWeight: "bold",
            cursor: "pointer"
          }}
        >
          Gerar PDF
        </button>
      </div>

      <div style={{ ...card, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 11 }}>
          <colgroup>
            <col style={{ width: "7%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "3%" }} />
            <col style={{ width: "3%" }} />
            <col style={{ width: "4%" }} />
            <col style={{ width: "4%" }} />
          </colgroup>
          <thead style={{ background: "#0b5ed7", color: "#fff" }}>
            <tr>
              {[
                "Data",
                "Obra",
                "Servico",
                "Hr Inicial",
                "Hr Final",
                "Horas",
                "Diesel (L)",
                "Tipo",
                "Oleo",
                "Graxa",
                "Trab.",
                "Disp.",
                "Chuva",
                "Mec."
              ].map((titulo) => (
                <th key={titulo} style={{ padding: "7px 5px", textAlign: "center", fontSize: 10 }}>
                  {titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhasDiarias.map((linha, idx) => (
              <tr key={`${linha.data}-${idx}`} style={{ background: idx % 2 === 0 ? "#f8fbff" : "#fff" }}>
                <td style={{ padding: "6px 4px", textAlign: "center", wordBreak: "break-word" }}>{formatarDataBR(linha.data)}</td>
                <td style={{ padding: "6px 4px", textAlign: "center", wordBreak: "break-word" }}>{identificarObra(linha.obra)}</td>
                <td style={{ padding: "6px 4px", wordBreak: "break-word" }}>{linha.descricao || "-"}</td>
                <td style={{ padding: "6px 4px", textAlign: "center" }}>{linha.hrInicial || "-"}</td>
                <td style={{ padding: "6px 4px", textAlign: "center" }}>{linha.hrFinal || "-"}</td>
                <td style={{ padding: "6px 4px", textAlign: "right", fontWeight: "bold" }}>{numero(linha.horas).toFixed(2)}</td>
                <td style={{ padding: "6px 4px", textAlign: "right", fontWeight: "bold", color: "#0b5ed7" }}>
                  {numero(linha.diesel).toFixed(2)}
                </td>
                <td style={{ padding: "6px 4px", textAlign: "center", wordBreak: "break-word" }}>{linha.tipoDiesel || "-"}</td>
                <td style={{ padding: "6px 4px", wordBreak: "break-word" }}>{linha.oleo.join(" | ") || "-"}</td>
                <td style={{ padding: "6px 4px", wordBreak: "break-word" }}>{linha.graxa.join(" | ") || "-"}</td>
                <td style={{ padding: "6px 4px", textAlign: "center", fontWeight: "bold" }}>
                  {linha.trabalhando || ""}
                </td>
                <td style={{ padding: "6px 4px", textAlign: "center", fontWeight: "bold" }}>{linha.disposicao || ""}</td>
                <td style={{ padding: "6px 4px", textAlign: "center", fontWeight: "bold" }}>{linha.chuva || ""}</td>
                <td style={{ padding: "6px 4px", textAlign: "center", fontWeight: "bold" }}>{linha.mecanica || ""}</td>
              </tr>
            ))}
            {!linhasDiarias.length && (
              <tr>
                <td colSpan={14} style={{ padding: 14, textAlign: "center", color: "#6c757d" }}>
                  Selecione equipamento e mes para exibir os dados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ ...card, marginTop: 12 }}>
        <h3 style={{ marginTop: 0, color: "#10243e" }}>Resumo</h3>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr", gap: 10 }}>
          <div style={{ border: "1px solid #d8e0ea", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ background: "#0b5ed7", color: "#fff", padding: "6px 8px", fontWeight: "bold" }}>Resumo do mes</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <tbody>
                {[
                  ["Horas trabalhadas", totais.horas.toFixed(2)],
                  ["Dias trabalhados", resumoDias.trabalhados],
                  ["Dias a disposicao", resumoDias.disposicao],
                  ["Dias de chuva", resumoDias.chuva],
                  ["Dias em mecanica", resumoDias.mecanica]
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ border: "1px solid #e5ebf3", padding: "6px 8px" }}>{k}</td>
                    <td style={{ border: "1px solid #e5ebf3", padding: "6px 8px", textAlign: "right", fontWeight: "bold" }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ border: "1px solid #d8e0ea", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ background: "#0b5ed7", color: "#fff", padding: "6px 8px", fontWeight: "bold" }}>Resumo dos abastecimentos</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <tbody>
                {[
                  ["Qtd. de abastecimentos", totais.qtdAbastecimentos],
                  ["Qtd. litros abastecidos", `${totais.dieselTotal.toFixed(2)} L`],
                  ["Valor medio diesel (R$/L)", formatarMoeda(totais.valorMedioLitro)],
                  ["Valor total diesel (R$)", formatarMoeda(totais.totalValor)],
                  ["Oleo total", `${totais.totalOleo.toFixed(2)} L`],
                  ["Graxa total", `${totais.totalGraxa.toFixed(2)} KG`],
                  ...resumoLubrificantesPorProduto.map((item) => [
                    `${item.tipo} - ${item.produto}`,
                    `${formatarQuantidadeCurta(item.quantidade)} ${item.unidade}`
                  ])
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ border: "1px solid #e5ebf3", padding: "6px 8px" }}>{k}</td>
                    <td style={{ border: "1px solid #e5ebf3", padding: "6px 8px", textAlign: "right", fontWeight: "bold" }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ border: "1px solid #d8e0ea", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ background: "#0b5ed7", color: "#fff", padding: "6px 8px", fontWeight: "bold", textAlign: "center" }}>Media L/H</div>
            <div style={{ padding: 20, textAlign: "center", fontSize: 28, fontWeight: "bold", color: "#0b5ed7" }}>
              {totais.mediaLH.toFixed(2)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Relatorio;


