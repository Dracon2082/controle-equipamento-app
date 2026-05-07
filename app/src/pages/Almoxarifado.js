import { useEffect, useMemo, useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import { addDoc, collection, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { belongsToTenant, getConfigDocId, getTenantId, withTenant } from "../utils/tenant";
import { registrarHistorico } from "../utils/historico";
import { parseDecimalInput } from "../utils/number";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const ITENS_PADRAO_ALMOX = [
  "PA",
  "ENXADA",
  "PICARETA",
  "MARRETA",
  "CARRINHO DE MAO",
  "VASSOURA",
  "CHAVE DE BOCA",
  "CHAVE INGLESA",
  "FURADEIRA",
  "ESMERILHADEIRA",
  "TRENA",
  "NIVEL"
];

const INSUMOS_PADRAO = [
  "CIMENTO",
  "AREIA",
  "BRITA",
  "TIJOLO",
  "CAL",
  "PEDRA",
  "TUBO",
  "FERRO"
];

const ITENS_PADRAO_EPI = [
  "LUVA PIGMENTADA",
  "OCULOS DE PROTECAO",
  "PROTETOR AURICULAR",
  "MASCARA PFF2",
  "CAPACETE",
  "BOTINA DE SEGURANCA",
  "UNIFORME",
  "COLETE REFLETIVO",
  "PERNEIRA",
  "PROTETOR SOLAR"
];

const UNIDADES_PADRAO = ["SC", "M3", "UN", "KG", "T"];
const normalizarBaseValor = (valor) => String(valor || "").trim().toUpperCase();
const gerarChaveBase = (cidade, estado) => `${normalizarBaseValor(cidade)}__${normalizarBaseValor(estado)}`;

function Almoxarifado({ setTela, modo = "completo", embed = false }) {
  const tenantId = getTenantId();
  const sessaoOperacional = (() => {
    try {
      return JSON.parse(localStorage.getItem("sessaoOperacional") || "{}");
    } catch {
      return {};
    }
  })();
  const perfilSessao = String(sessaoOperacional?.perfilAcesso || "").trim().toUpperCase();
  const usuarioChaveSessao = Boolean(sessaoOperacional?.usuarioChave);
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
  const isMobile = window.innerWidth <= 700;
  const assinaturaWidth = Math.min(460, Math.max(280, window.innerWidth - 56));
  const sigRetiradaRef = useRef(null);
  const sigBaixaRef = useRef(null);
  const sigSaidaInsumoRef = useRef(null);

  const [funcionarios, setFuncionarios] = useState([]);
  const [obras, setObras] = useState([]);
  const [configEmpresa, setConfigEmpresa] = useState(null);
  const [logoDataUrl, setLogoDataUrl] = useState("");
  const [obraBaseId, setObraBaseId] = useState("");
  const [movimentacoes, setMovimentacoes] = useState([]);
  const [estoqueFerramentas, setEstoqueFerramentas] = useState([]);
  const [estoqueInsumos, setEstoqueInsumos] = useState([]);
  const [estoqueEpi, setEstoqueEpi] = useState([]);
  const [estoquePecas, setEstoquePecas] = useState([]);
  const [movInsumos, setMovInsumos] = useState([]);
  const [entradasMateriais, setEntradasMateriais] = useState([]);
  const modoTela = String(modo || "completo").toLowerCase();
  const somenteEntrada = modoTela === "entrada";
  const somenteSaidas = modoTela === "saidas";
  const [abaAtiva, setAbaAtiva] = useState(somenteSaidas ? "FERRAMENTAS" : "ENTRADA");

  // Entrada unica (Ferramenta/Insumo/EPI/Peca de equipamento)
  const [categoriaEntrada, setCategoriaEntrada] = useState("FERRAMENTA");
  const [materialPadrao, setMaterialPadrao] = useState("");
  const [materialManual, setMaterialManual] = useState("");
  const [materialCA, setMaterialCA] = useState("");
  const [materialUnidade, setMaterialUnidade] = useState("UN");
  const [materialQtd, setMaterialQtd] = useState("0");
  const [materialNota, setMaterialNota] = useState("");
  const [materialPrecoUnit, setMaterialPrecoUnit] = useState("");
  const [materialData, setMaterialData] = useState(new Date().toISOString().split("T")[0]);
  const [materialFornecedor, setMaterialFornecedor] = useState("");
  const [materialValorFrete, setMaterialValorFrete] = useState("");
  const [materialTransportador, setMaterialTransportador] = useState("");
  const [materialVeiculoFrete, setMaterialVeiculoFrete] = useState("");
  const [materialPlacaFrete, setMaterialPlacaFrete] = useState("");
  const [materialMotoristaFrete, setMaterialMotoristaFrete] = useState("");
  const [materialObs, setMaterialObs] = useState("");
  const [materialNumeroSerie, setMaterialNumeroSerie] = useState("");
  const [nomeTravado, setNomeTravado] = useState(false);
  const [serieTravada, setSerieTravada] = useState(false);
  const [filtroNotaEntrada, setFiltroNotaEntrada] = useState("");
  const [filtroCategoriaEntrada, setFiltroCategoriaEntrada] = useState("");
  const [filtroSerieEntrada, setFiltroSerieEntrada] = useState("");
  const [filtroDataIniEntrada, setFiltroDataIniEntrada] = useState("");
  const [filtroDataFimEntrada, setFiltroDataFimEntrada] = useState("");

  // Ferramentas (emprestimo/devolucao)
  const [ferramentaEntradaPadrao, setFerramentaEntradaPadrao] = useState("");
  const [ferramentaEntradaManual, setFerramentaEntradaManual] = useState("");
  const [qtdEntradaFerramenta, setQtdEntradaFerramenta] = useState("0");
  const [dataEntradaFerramenta, setDataEntradaFerramenta] = useState(new Date().toISOString().split("T")[0]);
  const [fornecedorFerramenta, setFornecedorFerramenta] = useState("");
  const [obsEntradaFerramenta, setObsEntradaFerramenta] = useState("");

  const [funcionario, setFuncionario] = useState("");
  const [obra, setObra] = useState("");
  const [itemPadrao, setItemPadrao] = useState("");
  const [itemManual, setItemManual] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [observacao, setObservacao] = useState("");
  const [dataRetirada, setDataRetirada] = useState(new Date().toISOString().split("T")[0]);

  const [registroBaixa, setRegistroBaixa] = useState(null);
  const [dataBaixa, setDataBaixa] = useState(new Date().toISOString().split("T")[0]);
  const [obsBaixa, setObsBaixa] = useState("");

  // Insumos (entrada/saida de estoque)
  const [insumoPadrao, setInsumoPadrao] = useState("");
  const [insumoManual, setInsumoManual] = useState("");
  const [unidadeInsumo, setUnidadeInsumo] = useState("SC");
  const [qtdEntrada, setQtdEntrada] = useState("0");
  const [dataEntrada, setDataEntrada] = useState(new Date().toISOString().split("T")[0]);
  const [fornecedorEntrada, setFornecedorEntrada] = useState("");
  const [obsEntrada, setObsEntrada] = useState("");

  const [insumoSaidaNome, setInsumoSaidaNome] = useState("");
  const [obraSaida, setObraSaida] = useState("");
  const [funcionarioSaida, setFuncionarioSaida] = useState("");
  const [qtdSaida, setQtdSaida] = useState("0");
  const [dataSaida, setDataSaida] = useState(new Date().toISOString().split("T")[0]);
  const [obsSaida, setObsSaida] = useState("");
  const [filtroDataIniInsumo, setFiltroDataIniInsumo] = useState("");
  const [filtroDataFimInsumo, setFiltroDataFimInsumo] = useState("");
  const [filtroFuncionarioInsumo, setFiltroFuncionarioInsumo] = useState("");
  const [filtroTipoMovInsumo, setFiltroTipoMovInsumo] = useState("TODOS");
  const [filtroNomeInsumo, setFiltroNomeInsumo] = useState("");

  // Pecas: controladas por estoque/entradas e consumidas na Manutenção (itens trocados).

  const inputStyle = {
    width: "100%",
    height: 42,
    borderRadius: 8,
    border: "1px solid #cfd7e3",
    padding: "0 10px",
    boxSizing: "border-box"
  };

  const card = {
    background: "#fff",
    border: "1px solid #e3e7ef",
    borderRadius: 8,
    padding: 14,
    marginBottom: 12
  };

  const btn = {
    border: "none",
    borderRadius: 8,
    padding: "10px 14px",
    fontWeight: "bold",
    cursor: "pointer"
  };

  const normalizarNome = (v) => String(v || "").trim().toUpperCase();
  const baseSelecionada = useMemo(
    () => obras.find((item) => item.id === obraBaseId) || null,
    [obras, obraBaseId]
  );
  const basesUnicasNaTela = useMemo(() => {
    const set = new Set(
      obras
        .map((o) => gerarChaveBase(o.cidade, o.estado))
        .map((k) => String(k || "").trim().toUpperCase())
        .filter(Boolean)
    );
    return Array.from(set.values());
  }, [obras]);
  const baseTravadaUnica = basesUnicasNaTela.length === 1;
  const baseTravadaTexto = useMemo(() => {
    if (!baseTravadaUnica) return "";
    const chave = String(basesUnicasNaTela[0] || "");
    const [cidade, estado] = chave.split("__");
    const c = String(cidade || "").trim().toUpperCase();
    const e = String(estado || "").trim().toUpperCase();
    if (!c && !e) return "";
    return e ? `${c}/${e}` : c;
  }, [baseTravadaUnica, basesUnicasNaTela]);

  const basesDisponiveis = useMemo(() => {
    const mapa = new Map();
    obras.forEach((o) => {
      const chave = gerarChaveBase(o.cidade, o.estado);
      const key = String(chave || "").trim().toUpperCase();
      if (!key) return;
      if (mapa.has(key)) return;
      mapa.set(key, {
        baseChave: key,
        cidade: normalizarNome(o.cidade),
        estado: normalizarNome(o.estado),
        obraIdReferencia: o.id
      });
    });
    return Array.from(mapa.values()).sort((a, b) => String(a.cidade || "").localeCompare(String(b.cidade || "")));
  }, [obras]);

  const baseChaveSelecionada = useMemo(() => {
    if (baseSelecionada?.cidade || baseSelecionada?.estado) {
      return gerarChaveBase(baseSelecionada.cidade, baseSelecionada.estado);
    }
    if (baseTravadaUnica && basesUnicasNaTela[0]) return String(basesUnicasNaTela[0]);
    return "";
  }, [baseSelecionada, baseTravadaUnica, basesUnicasNaTela]);
  const obrasDaBase = useMemo(() => {
    if (!baseSelecionada) return [];
    const chave = gerarChaveBase(baseSelecionada.cidade, baseSelecionada.estado);
    return obras.filter((item) => gerarChaveBase(item.cidade, item.estado) === chave);
  }, [obras, baseSelecionada]);

  const obterBaseAtiva = () => {
    if (!baseSelecionada?.cidade || !baseSelecionada?.estado) {
      alert("Selecione a base operacional (obra de referencia) antes de continuar.");
      return null;
    }
    return {
      baseCidade: normalizarNome(baseSelecionada.cidade),
      baseEstado: normalizarNome(baseSelecionada.estado),
      baseChave: gerarChaveBase(baseSelecionada.cidade, baseSelecionada.estado)
    };
  };

  const formatarDataBR = (dataIso) => {
    if (!dataIso) return "-";
    return new Date(`${dataIso}T00:00:00`).toLocaleDateString("pt-BR");
  };

  const urlParaDataUrl = async (url) => {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const formatoImagem = (src) => {
    const s = String(src || "").toLowerCase();
    if (s.includes("image/jpeg") || s.includes("image/jpg") || s.includes(".jpg") || s.includes(".jpeg")) return "JPEG";
    return "PNG";
  };

  const gerarPdfTabela = (titulo, cabecalho, linhas, nomeArquivo) => {
    const pdf = new jsPDF("landscape");
    const largura = pdf.internal.pageSize.getWidth();
    const altura = pdf.internal.pageSize.getHeight();
    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");

    // Logo (se houver) + titulo centralizado
    const logo = String(logoDataUrl || configEmpresa?.logoBase64 || "").trim();
    if (logo && logo.startsWith("data:")) {
      try {
        pdf.addImage(logo, formatoImagem(logo), 12, 8, 18, 12);
      } catch {
        // sem logo se falhar
      }
    }
    pdf.text(titulo, largura / 2, 14, { align: "center" });
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    const usuario =
      String(sessaoOperacional?.nome || localStorage.getItem("usuarioLogado") || "USUARIO").trim().toUpperCase();
    pdf.text(`Gerado por: ${usuario}`, largura / 2, 19, { align: "center" });
    pdf.text(`Emitido em: ${new Date().toLocaleString("pt-BR")}`, largura / 2, 23, { align: "center" });

    autoTable(pdf, {
      startY: 26,
      margin: { left: 12, right: 12 },
      head: [cabecalho],
      body: linhas.length ? linhas : [["Sem registros para o filtro informado."]],
      theme: "grid",
      styles: { fontSize: 8, halign: "center" },
      headStyles: { fillColor: [11, 61, 145], textColor: 255, halign: "center" }
    });

    // Footer simples
    pdf.setFontSize(8);
    pdf.setTextColor(60);
    pdf.text("Equipamento Gestao", 12, altura - 8);
    pdf.save(nomeArquivo);
  };

  const carregar = async () => {
    const [
      snapFunc,
      snapObras,
      snapMov,
      snapEstFerramenta,
      snapEstInsumo,
      snapMovInsumo,
      snapEstEpi,
      snapEstPecas,
      snapEntradas,
      cfgSnap
    ] = await Promise.all([
      getDocs(collection(db, "funcionarios")),
      getDocs(collection(db, "obras")),
      getDocs(collection(db, "almoxarifado_movimentacoes")),
      getDocs(collection(db, "almoxarifado_estoque_ferramentas")),
      getDocs(collection(db, "almoxarifado_estoque_insumos")),
      getDocs(collection(db, "almoxarifado_movimentacoes_insumos")),
      getDocs(collection(db, "almoxarifado_estoque_epi")),
      getDocs(collection(db, "almoxarifado_estoque_pecas")),
      getDocs(collection(db, "almoxarifado_entradas_materiais")),
      getDoc(doc(db, "configuracoes", getConfigDocId(tenantId)))
    ]);

    const obrasTenant = snapObras.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId))
      .filter((item) =>
        acessoTotalBases || (
          basesPermitidas.length > 0 && (
            basesPermitidas.includes(gerarChaveBase(item.cidade, item.estado))
            || cidadesPermitidas.has(normalizarBaseValor(item.cidade))
          )
        )
      );
    const baseEscolhida = obrasTenant.find((item) => item.id === obraBaseId);
    const baseChaveSelecionada = baseEscolhida
      ? gerarChaveBase(baseEscolhida.cidade, baseEscolhida.estado)
      : "";
    const mesmaBase = (item) =>
      Boolean(baseChaveSelecionada) &&
      normalizarNome(item?.baseChave) === normalizarNome(baseChaveSelecionada);

    setFuncionarios(snapFunc.docs.map((d) => d.data()).filter((item) => belongsToTenant(item, tenantId)));
    setObras(obrasTenant);
    setConfigEmpresa(cfgSnap.exists() ? cfgSnap.data() : null);

    // Logo: converte URL em dataURL para garantir no PDF
    try {
      const cfg = cfgSnap.exists() ? cfgSnap.data() : null;
      const logoBase64 = String(cfg?.logoBase64 || "").trim();
      const logoUrl = String(cfg?.logo || "").trim();
      if (logoBase64 && logoBase64.startsWith("data:")) {
        setLogoDataUrl(logoBase64);
      } else if (logoUrl && !logoUrl.startsWith("data:") && /^https?:\/\//i.test(logoUrl)) {
        const data = await urlParaDataUrl(logoUrl);
        setLogoDataUrl(String(data || ""));
      } else {
        setLogoDataUrl("");
      }
    } catch {
      setLogoDataUrl("");
    }
    setMovimentacoes(
      snapMov.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((item) => belongsToTenant(item, tenantId))
        .filter(mesmaBase)
        .sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")))
    );
    setEstoqueFerramentas(
      snapEstFerramenta.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((item) => belongsToTenant(item, tenantId))
        .filter(mesmaBase)
        .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")))
    );
    setEstoqueInsumos(
      snapEstInsumo.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((item) => belongsToTenant(item, tenantId))
        .filter(mesmaBase)
        .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")))
    );
    setEstoqueEpi(
      snapEstEpi.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((item) => belongsToTenant(item, tenantId))
        .filter(mesmaBase)
        .sort((a, b) => {
          const ka = `${String(a.nome || "")} ${String(a.caEpi || "")}`.trim();
          const kb = `${String(b.nome || "")} ${String(b.caEpi || "")}`.trim();
          return ka.localeCompare(kb);
        })
    );
    setMovInsumos(
      snapMovInsumo.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((item) => belongsToTenant(item, tenantId))
        .filter(mesmaBase)
        .sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")))
    );
    setEstoquePecas(
      snapEstPecas.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((item) => belongsToTenant(item, tenantId))
        .filter(mesmaBase)
        .sort((a, b) => {
          const ka = `${String(a.numeroSerie || a.equipamentoCodigo || "")} ${String(a.nome || "")}`.trim();
          const kb = `${String(b.numeroSerie || b.equipamentoCodigo || "")} ${String(b.nome || "")}`.trim();
          return ka.localeCompare(kb);
        })
    );
    setEntradasMateriais(
      snapEntradas.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((item) => belongsToTenant(item, tenantId))
        .filter(mesmaBase)
        .sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")))
    );
  };

  useEffect(() => {
    setObra("");
    setObraSaida("");
    setRegistroBaixa(null);
    carregar();
  }, [obraBaseId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Se o usuario so tem uma base/cidade visivel, nao precisa escolher a obra de referencia.
  // Travamos automaticamente na primeira obra disponivel dessa base.
  useEffect(() => {
    if (!obraBaseId && obras.length > 0 && baseTravadaUnica) {
      setObraBaseId(obras[0].id);
      return;
    }
    if (!obraBaseId && obras.length === 1) {
      setObraBaseId(obras[0].id);
    }
  }, [obraBaseId, obras, baseTravadaUnica]);

  const obraNumero = (nomeObra) => {
    const n = String(nomeObra || "").trim();
    const m = n.match(/^\s*(\d{1,4})\s*[-â€“]/);
    if (m?.[1]) return m[1].padStart(3, "0");
    const m2 = n.match(/\b(\d{1,4})\b/);
    if (m2?.[1]) return m2[1].padStart(3, "0");
    return n;
  };

  const salvarEntradaMaterialUnica = async () => {
    const usuario = localStorage.getItem("usuarioLogado") || "USUARIO";
    const base = obterBaseAtiva();
    if (!base) return;

    const categoria = normalizarNome(categoriaEntrada);
    const nome = normalizarNome(materialManual || materialPadrao);
    const numeroSerie = String(materialNumeroSerie || "").trim().toUpperCase();
    const qtd = Number(materialQtd || 0);
    const unidade = normalizarNome(materialUnidade || "UN");
    const fornecedor = normalizarNome(materialFornecedor);
    const observacao = normalizarNome(materialObs);
    const ca = normalizarNome(materialCA);
    const notaFiscal = String(materialNota || "").trim();
    const precoUnitario = parseDecimalInput(materialPrecoUnit);
    const totalEntrada = (Number(qtd || 0) || 0) * (Number(precoUnitario || 0) || 0);
    const valorFrete = parseDecimalInput(materialValorFrete);
    const totalGeralEntrada = totalEntrada + (Number(valorFrete || 0) || 0);

    if (!categoria || !nome || qtd <= 0) {
      return alert("Preencha categoria, material e quantidade.");
    }
    if (categoria === "EPI" && !ca) {
      return alert("Para EPI, informe o CA.");
    }
    if (categoria === "PECA_EQUIPAMENTO" && !numeroSerie) {
      return alert("Para Peca de equipamento, informe o numero de serie / numero do item.");
    }

    // Atualiza estoque conforme categoria
    if (categoria === "FERRAMENTA") {
      const existente = estoqueFerramentas.find((item) => normalizarNome(item.nome) === nome);
      if (existente) {
        await updateDoc(doc(db, "almoxarifado_estoque_ferramentas", existente.id), {
          quantidade: Number(existente.quantidade || 0) + qtd,
          atualizadoEm: new Date().toISOString()
        });
      } else {
        await addDoc(
          collection(db, "almoxarifado_estoque_ferramentas"),
          withTenant(
            {
              nome,
              quantidade: qtd,
              baseCidade: base.baseCidade,
              baseEstado: base.baseEstado,
              baseChave: base.baseChave,
              criadoEm: new Date().toISOString()
            },
            tenantId
          )
        );
      }

      await addDoc(
        collection(db, "almoxarifado_movimentacoes_ferramentas"),
        withTenant(
          {
            tipoMov: "ENTRADA",
            nome,
            quantidade: qtd,
            dataMov: materialData,
            fornecedor,
            observacao,
            obra: "",
            funcionario: "",
            baseCidade: base.baseCidade,
            baseEstado: base.baseEstado,
            baseChave: base.baseChave,
            assinatura: "",
            criadoPor: usuario,
            criadoEm: new Date().toISOString()
          },
          tenantId
        )
      );
    } else if (categoria === "INSUMO") {
      const existente = estoqueInsumos.find((i) => normalizarNome(i.nome) === nome);
      if (existente) {
        await updateDoc(doc(db, "almoxarifado_estoque_insumos", existente.id), {
          quantidade: Number(existente.quantidade || 0) + qtd,
          unidade,
          atualizadoEm: new Date().toISOString()
        });
      } else {
        await addDoc(
          collection(db, "almoxarifado_estoque_insumos"),
          withTenant(
            {
              nome,
              quantidade: qtd,
              unidade,
              baseCidade: base.baseCidade,
              baseEstado: base.baseEstado,
              baseChave: base.baseChave,
              criadoEm: new Date().toISOString()
            },
            tenantId
          )
        );
      }

      await addDoc(
        collection(db, "almoxarifado_movimentacoes_insumos"),
        withTenant(
          {
            tipoMov: "ENTRADA",
            nome,
            quantidade: qtd,
            unidade,
            dataMov: materialData,
            fornecedor,
            observacao,
            baseCidade: base.baseCidade,
            baseEstado: base.baseEstado,
            baseChave: base.baseChave,
            obra: "",
            funcionario: "",
            assinatura: "",
            criadoPor: usuario,
            criadoEm: new Date().toISOString()
          },
          tenantId
        )
      );
    } else if (categoria === "EPI") {
      const existente = estoqueEpi.find(
        (i) => normalizarNome(i.nome) === nome && normalizarNome(i.caEpi) === ca
      );
      if (existente) {
        await updateDoc(doc(db, "almoxarifado_estoque_epi", existente.id), {
          quantidade: Number(existente.quantidade || 0) + qtd,
          atualizadoEm: new Date().toISOString()
        });
      } else {
        await addDoc(
          collection(db, "almoxarifado_estoque_epi"),
          withTenant(
            {
              nome,
              caEpi: ca,
              quantidade: qtd,
              unidade: "UN",
              baseCidade: base.baseCidade,
              baseEstado: base.baseEstado,
              baseChave: base.baseChave,
              criadoEm: new Date().toISOString()
            },
            tenantId
          )
        );
      }
    } else if (categoria === "PECA_EQUIPAMENTO") {
      const existente = estoquePecas.find(
        (i) =>
          normalizarNome(i.nome) === nome &&
          normalizarNome(i.numeroSerie || i.equipamentoCodigo) === normalizarNome(numeroSerie)
      );
      if (existente) {
        await updateDoc(doc(db, "almoxarifado_estoque_pecas", existente.id), {
          quantidade: Number(existente.quantidade || 0) + qtd,
          unidade: unidade || "UN",
          numeroSerie: String(existente.numeroSerie || existente.equipamentoCodigo || numeroSerie || "").trim().toUpperCase(),
          precoUnitario: Number(precoUnitario || 0) || 0,
          atualizadoEm: new Date().toISOString()
        });
      } else {
        await addDoc(
          collection(db, "almoxarifado_estoque_pecas"),
          withTenant(
            {
              nome,
              numeroSerie,
              quantidade: qtd,
              unidade: unidade || "UN",
              precoUnitario: Number(precoUnitario || 0) || 0,
              baseCidade: base.baseCidade,
              baseEstado: base.baseEstado,
              baseChave: base.baseChave,
              criadoEm: new Date().toISOString()
            },
            tenantId
          )
        );
      }

      await addDoc(
        collection(db, "almoxarifado_movimentacoes_pecas"),
        withTenant(
          {
            tipoMov: "ENTRADA",
            nome,
            numeroSerie,
            quantidade: qtd,
            unidade: unidade || "UN",
            dataMov: materialData,
            fornecedor,
            observacao,
            baseCidade: base.baseCidade,
            baseEstado: base.baseEstado,
            baseChave: base.baseChave,
            valorUnitario: Number(precoUnitario || 0) || 0,
            total: (Number(qtd || 0) || 0) * (Number(precoUnitario || 0) || 0),
            funcionario: "",
            assinatura: "",
            criadoPor: usuario,
            criadoEm: new Date().toISOString()
          },
          tenantId
        )
      );
    } else {
      return alert("Categoria invalida.");
    }

    // Registro de entrada (nao baixa)
    const refEntrada = await addDoc(
      collection(db, "almoxarifado_entradas_materiais"),
      withTenant(
        {
          categoria,
          nome,
          caEpi: categoria === "EPI" ? ca : "",
          numeroSerie: categoria === "PECA_EQUIPAMENTO" ? numeroSerie : "",
          quantidade: qtd,
          unidade: categoria === "INSUMO" || categoria === "PECA_EQUIPAMENTO" ? (unidade || "UN") : "UN",
          notaFiscal,
          precoUnitario,
          totalEntrada,
          valorFrete,
          totalGeralEntrada,
          dataEntrada: materialData,
          fornecedor,
          transportador: normalizarNome(materialTransportador),
          veiculoFrete: normalizarNome(materialVeiculoFrete),
          placaFrete: String(materialPlacaFrete || "").trim().toUpperCase(),
          motoristaFrete: normalizarNome(materialMotoristaFrete),
          observacao,
          baseCidade: base.baseCidade,
          baseEstado: base.baseEstado,
          baseChave: base.baseChave,
          criadoPor: usuario,
          criadoEm: new Date().toISOString()
        },
        tenantId
      )
    );

    await registrarHistorico({
      modulo: "ALMOXARIFADO",
      acao: "CRIOU",
      entidade: "ENTRADA_MATERIAL",
      registroId: refEntrada.id,
      usuario,
      descricao:
        categoria === "PECA_EQUIPAMENTO"
          ? `Entrada PECA: ${qtd} ${unidade || "UN"} de ${nome} (item/serie ${numeroSerie}).`
          : `Entrada ${categoria}: ${qtd} ${categoria === "INSUMO" ? unidade : "UN"} de ${nome}.`
    });

    setMaterialPadrao("");
    setMaterialManual("");
    setMaterialCA("");
    setMaterialQtd("0");
    setMaterialNota("");
    setMaterialPrecoUnit("");
    setMaterialFornecedor("");
    setMaterialValorFrete("");
    setMaterialTransportador("");
    setMaterialVeiculoFrete("");
    setMaterialPlacaFrete("");
    setMaterialMotoristaFrete("");
    setMaterialObs("");
    setMaterialNumeroSerie("");
    setNomeTravado(false);
    setSerieTravada(false);
    await carregar();
    alert("Entrada registrada.");
  };

  // --- Ferramentas ---
  const salvarEntradaFerramenta = async () => {
    const usuario = localStorage.getItem("usuarioLogado") || "USUARIO";
    const base = obterBaseAtiva();
    if (!base) return;
    const nome = normalizarNome(ferramentaEntradaManual || ferramentaEntradaPadrao);
    const qtd = Number(qtdEntradaFerramenta || 0);

    if (!nome || qtd <= 0) {
      alert("Preencha ferramenta e quantidade de entrada.");
      return;
    }

    const existente = estoqueFerramentas.find((item) => normalizarNome(item.nome) === nome);

    if (existente) {
      const novaQtd = Number(existente.quantidade || 0) + qtd;
      await updateDoc(doc(db, "almoxarifado_estoque_ferramentas", existente.id), {
        quantidade: novaQtd,
        atualizadoEm: new Date().toISOString()
      });
    } else {
      await addDoc(
        collection(db, "almoxarifado_estoque_ferramentas"),
        withTenant(
          {
            nome,
            quantidade: qtd,
            baseCidade: base.baseCidade,
            baseEstado: base.baseEstado,
            baseChave: base.baseChave,
            criadoEm: new Date().toISOString()
          },
          tenantId
        )
      );
    }

    const refMov = await addDoc(
      collection(db, "almoxarifado_movimentacoes_ferramentas"),
      withTenant(
        {
          tipoMov: "ENTRADA",
          nome,
          quantidade: qtd,
          dataMov: dataEntradaFerramenta,
          fornecedor: normalizarNome(fornecedorFerramenta),
          observacao: normalizarNome(obsEntradaFerramenta),
          obra: "",
          funcionario: "",
          baseCidade: base.baseCidade,
          baseEstado: base.baseEstado,
          baseChave: base.baseChave,
          assinatura: "",
          criadoPor: usuario,
          criadoEm: new Date().toISOString()
        },
        tenantId
      )
    );

    await registrarHistorico({
      modulo: "ALMOXARIFADO",
      acao: "CRIOU",
      entidade: "ENTRADA_FERRAMENTA",
      registroId: refMov.id,
      usuario,
      descricao: `Entrada de ${qtd}x ${nome} no almoxarifado.`
    });

    setFerramentaEntradaPadrao("");
    setFerramentaEntradaManual("");
    setQtdEntradaFerramenta("0");
    setFornecedorFerramenta("");
    setObsEntradaFerramenta("");
    await carregar();
    alert("Entrada de ferramenta registrada.");
  };

  const salvarRetirada = async () => {
    const usuario = localStorage.getItem("usuarioLogado") || "USUARIO";
    const base = obterBaseAtiva();
    if (!base) return;
    const item = normalizarNome(itemManual || itemPadrao);
    const qtd = Number(quantidade || 0);
    const assinatura =
      sigRetiradaRef.current && !sigRetiradaRef.current.isEmpty()
        ? sigRetiradaRef.current.getCanvas().toDataURL("image/png")
        : "";

    if (!funcionario || !obra || !item || qtd <= 0) {
      alert("Preencha funcionario, obra, item e quantidade.");
      return;
    }
    if (!assinatura) {
      alert("A assinatura de retirada e obrigatoria.");
      return;
    }

    const itemEstoque = estoqueFerramentas.find((registro) => normalizarNome(registro.nome) === item);
    if (!itemEstoque) {
      alert("Ferramenta nao encontrada no estoque. Registre a entrada primeiro.");
      return;
    }
    const saldoAtual = Number(itemEstoque.quantidade || 0);
    if (saldoAtual < qtd) {
      alert("Estoque de ferramenta insuficiente para essa retirada.");
      return;
    }

    await updateDoc(doc(db, "almoxarifado_estoque_ferramentas", itemEstoque.id), {
      quantidade: saldoAtual - qtd,
      atualizadoEm: new Date().toISOString()
    });

    const ref = await addDoc(
      collection(db, "almoxarifado_movimentacoes"),
      withTenant(
        {
          funcionario,
          obra,
          item,
          quantidade: qtd,
          dataRetirada,
          observacaoRetirada: normalizarNome(observacao),
          assinaturaRetirada: assinatura,
          baseCidade: base.baseCidade,
          baseEstado: base.baseEstado,
          baseChave: base.baseChave,
          status: "EM_USO",
          dataDevolucao: "",
          observacaoDevolucao: "",
          assinaturaDevolucao: "",
          retiradoPor: usuario,
          criadoEm: new Date().toISOString()
        },
        tenantId
      )
    );

    await registrarHistorico({
      modulo: "ALMOXARIFADO",
      acao: "CRIOU",
      entidade: "RETIRADA_FERRAMENTA",
      registroId: ref.id,
      usuario,
      descricao: `${funcionario} retirou ${qtd}x ${item}.`
    });

    setFuncionario("");
    setObra("");
    setItemPadrao("");
    setItemManual("");
    setQuantidade("1");
    setObservacao("");
    if (sigRetiradaRef.current) sigRetiradaRef.current.clear();
    await carregar();
    alert("Retirada registrada com sucesso.");
  };

  const confirmarBaixa = async () => {
    const usuario = localStorage.getItem("usuarioLogado") || "USUARIO";
    const base = obterBaseAtiva();
    if (!base) return;
    const assinatura =
      sigBaixaRef.current && !sigBaixaRef.current.isEmpty()
        ? sigBaixaRef.current.getCanvas().toDataURL("image/png")
        : "";

    if (!registroBaixa?.id) return;
    if (!assinatura) {
      alert("A assinatura de devolucao e obrigatoria.");
      return;
    }

    const itemDevolvido = normalizarNome(registroBaixa.item);
    const qtdDevolvida = Number(registroBaixa.quantidade || 0);
    const existente = estoqueFerramentas.find((item) => normalizarNome(item.nome) === itemDevolvido);

    if (existente) {
      await updateDoc(doc(db, "almoxarifado_estoque_ferramentas", existente.id), {
        quantidade: Number(existente.quantidade || 0) + qtdDevolvida,
        atualizadoEm: new Date().toISOString()
      });
    } else {
      await addDoc(
        collection(db, "almoxarifado_estoque_ferramentas"),
        withTenant(
          {
            nome: itemDevolvido,
            quantidade: qtdDevolvida,
            baseCidade: base.baseCidade,
            baseEstado: base.baseEstado,
            baseChave: base.baseChave,
            criadoEm: new Date().toISOString()
          },
          tenantId
        )
      );
    }

    await updateDoc(doc(db, "almoxarifado_movimentacoes", registroBaixa.id), {
      status: "DEVOLVIDO",
      dataDevolucao: dataBaixa,
      observacaoDevolucao: normalizarNome(obsBaixa),
      assinaturaDevolucao: assinatura,
      devolvidoPor: usuario,
      atualizadoEm: new Date().toISOString()
    });

    await registrarHistorico({
      modulo: "ALMOXARIFADO",
      acao: "EDITOU",
      entidade: "DEVOLUCAO_FERRAMENTA",
      registroId: registroBaixa.id,
      usuario,
      descricao: `${registroBaixa.funcionario} devolveu ${registroBaixa.item}.`
    });

    setRegistroBaixa(null);
    setObsBaixa("");
    if (sigBaixaRef.current) sigBaixaRef.current.clear();
    await carregar();
    alert("Baixa registrada.");
  };

  // --- Insumos ---
  const salvarEntradaInsumo = async () => {
    const usuario = localStorage.getItem("usuarioLogado") || "USUARIO";
    const base = obterBaseAtiva();
    if (!base) return;
    const nome = normalizarNome(insumoManual || insumoPadrao);
    const qtd = Number(qtdEntrada || 0);
    if (!nome || qtd <= 0) {
      alert("Preencha insumo e quantidade de entrada.");
      return;
    }

    const existente = estoqueInsumos.find((i) => normalizarNome(i.nome) === nome);

    if (existente) {
      const novaQtd = Number(existente.quantidade || 0) + qtd;
      await updateDoc(doc(db, "almoxarifado_estoque_insumos", existente.id), {
        quantidade: novaQtd,
        unidade: unidadeInsumo,
        atualizadoEm: new Date().toISOString()
      });
    } else {
      await addDoc(
        collection(db, "almoxarifado_estoque_insumos"),
        withTenant(
          {
            nome,
            quantidade: qtd,
            unidade: unidadeInsumo,
            baseCidade: base.baseCidade,
            baseEstado: base.baseEstado,
            baseChave: base.baseChave,
            criadoEm: new Date().toISOString()
          },
          tenantId
        )
      );
    }

    const refMov = await addDoc(
      collection(db, "almoxarifado_movimentacoes_insumos"),
      withTenant(
        {
          tipoMov: "ENTRADA",
          nome,
          quantidade: qtd,
          unidade: unidadeInsumo,
          dataMov: dataEntrada,
          fornecedor: normalizarNome(fornecedorEntrada),
          observacao: normalizarNome(obsEntrada),
          baseCidade: base.baseCidade,
          baseEstado: base.baseEstado,
          baseChave: base.baseChave,
          obra: "",
          funcionario: "",
          assinatura: "",
          criadoPor: usuario,
          criadoEm: new Date().toISOString()
        },
        tenantId
      )
    );

    await registrarHistorico({
      modulo: "ALMOXARIFADO",
      acao: "CRIOU",
      entidade: "ENTRADA_INSUMO",
      registroId: refMov.id,
      usuario,
      descricao: `Entrada de ${qtd} ${unidadeInsumo} de ${nome}.`
    });

    setInsumoPadrao("");
    setInsumoManual("");
    setQtdEntrada("0");
    setFornecedorEntrada("");
    setObsEntrada("");
    await carregar();
    alert("Entrada de insumo registrada.");
  };

  const salvarSaidaInsumo = async () => {
    const usuario = localStorage.getItem("usuarioLogado") || "USUARIO";
    const base = obterBaseAtiva();
    if (!base) return;
    const nome = normalizarNome(insumoSaidaNome);
    const qtd = Number(qtdSaida || 0);
    const assinatura =
      sigSaidaInsumoRef.current && !sigSaidaInsumoRef.current.isEmpty()
        ? sigSaidaInsumoRef.current.getCanvas().toDataURL("image/png")
        : "";

    if (!nome || !obraSaida || !funcionarioSaida || qtd <= 0) {
      alert("Preencha insumo, obra, funcionario e quantidade de saida.");
      return;
    }
    if (!assinatura) {
      alert("A assinatura da retirada de insumo e obrigatoria.");
      return;
    }

    const existente = estoqueInsumos.find((i) => normalizarNome(i.nome) === nome);
    if (!existente) {
      alert("Insumo nao encontrado no estoque.");
      return;
    }
    const saldoAtual = Number(existente.quantidade || 0);
    if (saldoAtual < qtd) {
      alert("Estoque insuficiente para essa saida.");
      return;
    }

    await updateDoc(doc(db, "almoxarifado_estoque_insumos", existente.id), {
      quantidade: saldoAtual - qtd,
      atualizadoEm: new Date().toISOString()
    });

    const refMov = await addDoc(
      collection(db, "almoxarifado_movimentacoes_insumos"),
      withTenant(
        {
          tipoMov: "SAIDA",
          nome,
          quantidade: qtd,
          unidade: existente.unidade || unidadeInsumo || "UN",
          dataMov: dataSaida,
          fornecedor: "",
          observacao: normalizarNome(obsSaida),
          baseCidade: base.baseCidade,
          baseEstado: base.baseEstado,
          baseChave: base.baseChave,
          obra: obraSaida,
          funcionario: funcionarioSaida,
          assinatura,
          criadoPor: usuario,
          criadoEm: new Date().toISOString()
        },
        tenantId
      )
    );

    await registrarHistorico({
      modulo: "ALMOXARIFADO",
      acao: "CRIOU",
      entidade: "SAIDA_INSUMO",
      registroId: refMov.id,
      usuario,
      descricao: `Saida de ${qtd} ${existente.unidade || ""} de ${nome} para ${obraSaida}.`
    });

    setInsumoSaidaNome("");
    setObraSaida("");
    setFuncionarioSaida("");
    setQtdSaida("0");
    setObsSaida("");
    if (sigSaidaInsumoRef.current) sigSaidaInsumoRef.current.clear();
    await carregar();
    alert("Saida de insumo registrada.");
  };

  const pendentes = movimentacoes.filter((m) => m.status === "EM_USO");

  const opcoesFerramenta = useMemo(() => {
    const nomesEstoque = estoqueFerramentas.map((item) => normalizarNome(item.nome));
    return [...new Set([...ITENS_PADRAO_ALMOX, ...nomesEstoque])].sort();
  }, [estoqueFerramentas]);

  const opcoesFerramentasCadastradas = useMemo(() => {
    return estoqueFerramentas
      .map((f) => ({
        id: f.id,
        nome: normalizarNome(f.nome),
        quantidade: Number(f.quantidade || 0) || 0
      }))
      .filter((f) => f.nome)
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [estoqueFerramentas]);

  const opcoesInsumo = useMemo(() => {
    const nomesEstoque = estoqueInsumos.map((i) => normalizarNome(i.nome));
    return [...new Set([...INSUMOS_PADRAO, ...nomesEstoque])].sort();
  }, [estoqueInsumos]);

  const opcoesInsumosCadastrados = useMemo(() => {
    return estoqueInsumos
      .map((i) => ({
        id: i.id,
        nome: normalizarNome(i.nome),
        quantidade: Number(i.quantidade || 0) || 0,
        unidade: normalizarNome(i.unidade || "UN")
      }))
      .filter((i) => i.nome)
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [estoqueInsumos]);

  const opcoesEpi = useMemo(() => {
    const nomesEstoque = estoqueEpi.map((i) => normalizarNome(i.nome));
    return [...new Set([...ITENS_PADRAO_EPI, ...nomesEstoque])].sort();
  }, [estoqueEpi]);

  const opcoesPecasCadastradas = useMemo(() => {
    return estoquePecas
      .map((p) => ({
        id: p.id,
        nome: normalizarNome(p.nome),
        numeroSerie: String(p.numeroSerie || p.equipamentoCodigo || "").trim().toUpperCase(),
        unidade: normalizarNome(p.unidade || "UN"),
        precoUnitario: Number(p.precoUnitario || 0) || 0,
        quantidade: Number(p.quantidade || 0) || 0
      }))
      .filter((p) => p.nome && p.numeroSerie)
      .sort((a, b) => {
        const ka = `${a.nome} ${a.numeroSerie}`.trim();
        const kb = `${b.nome} ${b.numeroSerie}`.trim();
        return ka.localeCompare(kb);
      });
  }, [estoquePecas]);

  const estoqueConsolidado = useMemo(() => {
    const ferr = estoqueFerramentas.map((i) => ({
      categoria: "FERRAMENTA",
      nome: i.nome,
      caEpi: "",
      numeroSerie: "",
      quantidade: Number(i.quantidade || 0),
      unidade: "UN"
    }));
    const ins = estoqueInsumos.map((i) => ({
      categoria: "INSUMO",
      nome: i.nome,
      caEpi: "",
      numeroSerie: "",
      quantidade: Number(i.quantidade || 0),
      unidade: i.unidade || "UN"
    }));
    const epi = estoqueEpi.map((i) => ({
      categoria: "EPI",
      nome: i.nome,
      caEpi: i.caEpi || "",
      numeroSerie: "",
      quantidade: Number(i.quantidade || 0),
      unidade: "UN"
    }));
    const pec = estoquePecas.map((i) => ({
      categoria: "PECA_EQUIPAMENTO",
      nome: i.nome,
      caEpi: "",
      numeroSerie: i.numeroSerie || i.equipamentoCodigo || "",
      quantidade: Number(i.quantidade || 0),
      unidade: i.unidade || "UN"
    }));
    return [...ferr, ...ins, ...epi, ...pec].sort((a, b) => {
      const ka = `${a.categoria} ${a.numeroSerie || ""} ${a.nome} ${a.caEpi}`.trim();
      const kb = `${b.categoria} ${b.numeroSerie || ""} ${b.nome} ${b.caEpi}`.trim();
      return ka.localeCompare(kb);
    });
  }, [estoqueFerramentas, estoqueInsumos, estoqueEpi, estoquePecas]);

  const totalEntradaPreview = useMemo(() => {
    const qtdNum = parseDecimalInput(materialQtd);
    const precoNum = parseDecimalInput(materialPrecoUnit);
    if (!qtdNum || !precoNum) return 0;
    return qtdNum * precoNum;
  }, [materialQtd, materialPrecoUnit]);

  const totalGeralEntradaPreview = useMemo(() => {
    const freteNum = parseDecimalInput(materialValorFrete);
    return Number(totalEntradaPreview || 0) + (Number(freteNum || 0) || 0);
  }, [totalEntradaPreview, materialValorFrete]);

  const entradasFiltradas = useMemo(() => {
    const nota = String(filtroNotaEntrada || "").trim().toUpperCase();
    const ini = String(filtroDataIniEntrada || "").trim();
    const fim = String(filtroDataFimEntrada || "").trim();
    const categoria = String(filtroCategoriaEntrada || "").trim().toUpperCase();
    const serie = String(filtroSerieEntrada || "").trim().toUpperCase();

    const dentroPeriodo = (dataIso) => {
      const d = String(dataIso || "").trim();
      if (!d) return false;
      if (ini && d < ini) return false;
      if (fim && d > fim) return false;
      return true;
    };

    return entradasMateriais.filter((r) => {
      if (nota && String(r.notaFiscal || "").trim().toUpperCase() !== nota) return false;
      if ((ini || fim) && !dentroPeriodo(r.dataEntrada)) return false;
      if (categoria && String(r.categoria || "").trim().toUpperCase() !== categoria) return false;
      if (serie) {
        const s = String(r.numeroSerie || r.equipamentoCodigo || "").trim().toUpperCase();
        if (s !== serie) return false;
      }
      return true;
    });
  }, [
    entradasMateriais,
    filtroNotaEntrada,
    filtroDataIniEntrada,
    filtroDataFimEntrada,
    filtroCategoriaEntrada,
    filtroSerieEntrada
  ]);

  const gerarRelatorioEstoqueMateriais = () => {
    gerarPdfTabela(
      "RELATORIO - ESTOQUE DE MATERIAIS",
      ["Categoria", "Material", "N Serie/Item", "CA", "Qtd", "Unid"],
      estoqueConsolidado.map((i) => [
        i.categoria,
        i.nome,
        i.numeroSerie || "-",
        i.caEpi || "-",
        Number(i.quantidade || 0),
        i.unidade || "UN"
      ]),
      "relatorio_estoque_materiais.pdf"
    );
  };

  const gerarRelatorioEntradasMateriais = () => {
    const moeda = (v) =>
      `R$ ${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const pdf = new jsPDF("landscape");
    const largura = pdf.internal.pageSize.getWidth();
    const altura = pdf.internal.pageSize.getHeight();
    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");

    const logo = String(logoDataUrl || configEmpresa?.logoBase64 || "").trim();
    if (logo && logo.startsWith("data:")) {
      try {
        pdf.addImage(logo, formatoImagem(logo), 12, 8, 18, 12);
      } catch {
        // segue sem logo
      }
    }

    pdf.text("RELATÓRIO - ENTRADAS DE MATERIAIS", largura / 2, 14, { align: "center" });
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    const usuario =
      String(sessaoOperacional?.nome || localStorage.getItem("usuarioLogado") || "USUARIO").trim().toUpperCase();
    pdf.text(`Gerado por: ${usuario}`, largura / 2, 19, { align: "center" });
    pdf.text(`Emitido em: ${new Date().toLocaleString("pt-BR")}`, largura / 2, 23, { align: "center" });

    autoTable(pdf, {
      startY: 26,
      margin: { left: 8, right: 8 },
      head: [[
        "Data",
        "NF",
        "Cat.",
        "Material",
        "N Série/Item",
        "CA",
        "Qtd",
        "Un.",
        "Unit.",
        "Total Nota",
        "Frete",
        "Total Geral",
        "Transportador",
        "Veículo",
        "Placa",
        "Motorista",
        "Fornecedor",
        "Entrada por"
      ]],
      body: entradasFiltradas.length
        ? entradasFiltradas.map((r) => [
            formatarDataBR(r.dataEntrada),
            r.notaFiscal || "-",
            r.categoria || "-",
            r.nome || "-",
            r.numeroSerie || r.equipamentoCodigo || "-",
            r.caEpi || "-",
            Number(r.quantidade || 0),
            r.unidade || "UN",
            moeda(r.precoUnitario || 0),
            moeda(r.totalEntrada || 0),
            moeda(r.valorFrete || 0),
            moeda(r.totalGeralEntrada || ((Number(r.totalEntrada || 0) || 0) + (Number(r.valorFrete || 0) || 0))),
            r.transportador || "-",
            r.veiculoFrete || "-",
            r.placaFrete || "-",
            r.motoristaFrete || "-",
            r.fornecedor || "-",
            String(r.criadoPor || r.criado_por || r.usuario || "-").toUpperCase()
          ])
        : [["Sem registros para o filtro informado."]],
      theme: "grid",
      styles: {
        fontSize: 6.6,
        cellPadding: 2,
        halign: "center",
        valign: "middle",
        overflow: "linebreak"
      },
      headStyles: {
        fillColor: [11, 61, 145],
        textColor: 255,
        halign: "center",
        fontSize: 6.5
      },
      columnStyles: {
        0: { cellWidth: 18 },
        1: { cellWidth: 14 },
        2: { cellWidth: 22 },
        3: { cellWidth: 28 },
        4: { cellWidth: 20 },
        5: { cellWidth: 8 },
        6: { cellWidth: 10 },
        7: { cellWidth: 10 },
        8: { cellWidth: 16 },
        9: { cellWidth: 18 },
        10: { cellWidth: 15 },
        11: { cellWidth: 18 },
        12: { cellWidth: 24 },
        13: { cellWidth: 14 },
        14: { cellWidth: 18 },
        15: { cellWidth: 18 },
        16: { cellWidth: 20 },
        17: { cellWidth: 18 }
      }
    });

    pdf.setFontSize(8);
    pdf.setTextColor(60);
    pdf.text("Equipamento Gestao", 8, altura - 8);
    pdf.save("relatorio_entradas_materiais.pdf");
  };

  const funcionariosNoHistoricoInsumo = useMemo(() => {
    const nomes = movInsumos.map((item) => normalizarNome(item.funcionario)).filter(Boolean);
    return [...new Set(nomes)].sort();
  }, [movInsumos]);

  const historicoInsumosFiltrado = useMemo(() => {
    const nomeFiltro = normalizarNome(filtroNomeInsumo);
    const funcionarioFiltro = normalizarNome(filtroFuncionarioInsumo);

    return movInsumos.filter((item) => {
      const dataMov = String(item.dataMov || "");
      if (filtroDataIniInsumo && dataMov < filtroDataIniInsumo) return false;
      if (filtroDataFimInsumo && dataMov > filtroDataFimInsumo) return false;
      if (filtroTipoMovInsumo !== "TODOS" && item.tipoMov !== filtroTipoMovInsumo) return false;
      if (funcionarioFiltro && normalizarNome(item.funcionario) !== funcionarioFiltro) return false;
      if (nomeFiltro && !normalizarNome(item.nome).includes(nomeFiltro)) return false;
      return true;
    });
  }, [movInsumos, filtroDataIniInsumo, filtroDataFimInsumo, filtroTipoMovInsumo, filtroFuncionarioInsumo, filtroNomeInsumo]);

  const gerarRelatorioPendentesFerramentas = () => {
    gerarPdfTabela(
      "RELATORIO - FERRAMENTAS PENDENTES",
      ["Data", "Funcionario", "Obra", "Ferramenta", "Quantidade", "Status"],
      pendentes.map((item) => [
        formatarDataBR(item.dataRetirada),
        item.funcionario || "-",
        item.obra || "-",
        item.item || "-",
        Number(item.quantidade || 0),
        item.status || "-"
      ]),
      "relatorio_ferramentas_pendentes.pdf"
    );
  };

  const gerarRelatorioEstoqueFerramentas = () => {
    gerarPdfTabela(
      "RELATORIO - ESTOQUE DE FERRAMENTAS",
      ["Ferramenta", "Quantidade Atual"],
      estoqueFerramentas.map((item) => [
        item.nome || "-",
        Number(item.quantidade || 0)
      ]),
      "relatorio_estoque_ferramentas.pdf"
    );
  };

  const gerarRelatorioEstoqueInsumos = () => {
    gerarPdfTabela(
      "RELATORIO - ESTOQUE DE INSUMOS",
      ["Insumo", "Quantidade Atual", "Unidade"],
      estoqueInsumos.map((item) => [
        item.nome || "-",
        Number(item.quantidade || 0),
        item.unidade || "UN"
      ]),
      "relatorio_estoque_insumos.pdf"
    );
  };

  const gerarRelatorioHistoricoInsumos = () => {
    gerarPdfTabela(
      "RELATORIO - HISTORICO DE INSUMOS (FILTRADO)",
      ["Data", "Tipo", "Insumo", "Qtd", "Unidade", "Obra", "Funcionario"],
      historicoInsumosFiltrado.map((item) => [
        formatarDataBR(item.dataMov),
        item.tipoMov || "-",
        item.nome || "-",
        Number(item.quantidade || 0),
        item.unidade || "UN",
        item.obra || "-",
        item.funcionario || "-"
      ]),
      "relatorio_historico_insumos_filtrado.pdf"
    );
  };

  const pageStyle = embed
    ? { maxWidth: 1200, margin: "0 auto", padding: 0, background: "transparent", minHeight: "unset" }
    : { maxWidth: 1240, margin: "0 auto", padding: isMobile ? 10 : 18, background: "#f3f5f8", minHeight: "100vh" };

  return (
    <div style={pageStyle}>
      {!embed && <h2 style={{ marginTop: 0, color: "#10243e" }}>Controle de Almoxarifado</h2>}

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>{somenteSaidas ? "Base ativa operacional" : "Base operacional"}</h3>
        {baseTravadaUnica ? (
          <div style={{ color: "#1b3e8a", fontWeight: "bold" }}>
            Base ativa: {baseTravadaTexto || "BASE"}
          </div>
        ) : (
          <select
            style={inputStyle}
            value={String(baseChaveSelecionada || "").trim().toUpperCase()}
            onChange={(e) => {
              const chave = String(e.target.value || "").trim().toUpperCase();
              const ref = basesDisponiveis.find((b) => b.baseChave === chave);
              if (ref?.obraIdReferencia) setObraBaseId(ref.obraIdReferencia);
            }}
          >
            <option value="">Selecione a base</option>
            {basesDisponiveis.map((b) => (
              <option key={b.baseChave} value={b.baseChave}>
                {b.cidade}/{b.estado}
              </option>
            ))}
          </select>
        )}
        {!baseTravadaUnica && baseSelecionada && (
          <div style={{ marginTop: 4, color: "#1b3e8a", fontWeight: "bold" }}>
            Base ativa: {baseSelecionada.cidade}/{baseSelecionada.estado}
          </div>
        )}
      </div>

      {!somenteEntrada && (
        <div style={{ ...card, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            style={{
              ...btn,
              background: abaAtiva === "FERRAMENTAS" ? "#0b5ed7" : "#dee2e6",
              color: abaAtiva === "FERRAMENTAS" ? "#fff" : "#10243e"
            }}
            onClick={() => setAbaAtiva("FERRAMENTAS")}
          >
            Ferramentas
          </button>
          <button
            style={{
              ...btn,
              background: abaAtiva === "INSUMOS" ? "#0b5ed7" : "#dee2e6",
              color: abaAtiva === "INSUMOS" ? "#fff" : "#10243e"
            }}
            onClick={() => setAbaAtiva("INSUMOS")}
          >
            Insumos
          </button>
        </div>
      )}

      {abaAtiva === "ENTRADA" && !somenteSaidas && (
        <>
          <div style={card}>
            <h3 style={{ marginTop: 0 }}>Entrada de material (unica)</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              <select
                style={inputStyle}
                value={categoriaEntrada}
                onChange={(e) => {
                  const v = String(e.target.value || "FERRAMENTA");
                  setCategoriaEntrada(v);
                  const up = normalizarNome(v);
                  setMaterialPadrao("");
                  setMaterialManual("");
                  setMaterialCA("");
                  setMaterialNumeroSerie("");
                  setNomeTravado(false);
                  setSerieTravada(false);
                  setMaterialUnidade(up === "INSUMO" ? "SC" : "UN");
                }}
              >
                <option value="FERRAMENTA">Ferramenta</option>
                <option value="INSUMO">Insumo</option>
                <option value="EPI">EPI</option>
                <option value="PECA_EQUIPAMENTO">Peca de equipamento</option>
              </select>

              {normalizarNome(categoriaEntrada) === "FERRAMENTA" && (
                <>
                  <select
                    style={inputStyle}
                    value=""
                    onChange={(e) => {
                      const id = String(e.target.value || "").trim();
                      if (!id) return;
                      const sel = opcoesFerramentasCadastradas.find((f) => f.id === id);
                      if (!sel) return;
                      setMaterialPadrao("");
                      setMaterialManual(sel.nome);
                      setMaterialUnidade("UN");
                      setNomeTravado(true);
                      setSerieTravada(false);
                      setMaterialNumeroSerie("");
                      // reseta o select
                      setTimeout(() => {
                        try {
                          e.target.value = "";
                        } catch {
                          // ignore
                        }
                      }, 0);
                    }}
                  >
                    <option value="">Selecionar ferramenta do estoque (evita digitar)</option>
                    {opcoesFerramentasCadastradas.map((f) => (
                      <option key={f.id} value={f.id}>
                        {`${f.nome} | ${f.quantidade} UN`}
                      </option>
                    ))}
                  </select>

                  <select style={inputStyle} value={materialPadrao} onChange={(e) => setMaterialPadrao(e.target.value)}>
                    <option value="">Ferramenta padrao</option>
                    {opcoesFerramenta.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </>
              )}

              {normalizarNome(categoriaEntrada) === "INSUMO" && (
                <>
                  <select
                    style={inputStyle}
                    value=""
                    onChange={(e) => {
                      const id = String(e.target.value || "").trim();
                      if (!id) return;
                      const sel = opcoesInsumosCadastrados.find((i) => i.id === id);
                      if (!sel) return;
                      setMaterialPadrao("");
                      setMaterialManual(sel.nome);
                      setMaterialUnidade(sel.unidade || "UN");
                      setNomeTravado(true);
                      setSerieTravada(false);
                      setMaterialNumeroSerie("");
                      // reseta o select
                      setTimeout(() => {
                        try {
                          e.target.value = "";
                        } catch {
                          // ignore
                        }
                      }, 0);
                    }}
                  >
                    <option value="">Selecionar insumo do estoque (evita digitar)</option>
                    {opcoesInsumosCadastrados.map((i) => (
                      <option key={i.id} value={i.id}>
                        {`${i.nome} | ${i.quantidade} ${i.unidade}`}
                      </option>
                    ))}
                  </select>

                  <select style={inputStyle} value={materialPadrao} onChange={(e) => setMaterialPadrao(e.target.value)}>
                    <option value="">Insumo padrao</option>
                    {opcoesInsumo.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </>
              )}

              {normalizarNome(categoriaEntrada) === "EPI" && (
                <select style={inputStyle} value={materialPadrao} onChange={(e) => setMaterialPadrao(e.target.value)}>
                  <option value="">EPI padrao</option>
                  {opcoesEpi.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              )}

              {normalizarNome(categoriaEntrada) === "PECA_EQUIPAMENTO" && (
                <>
                  <select
                    style={inputStyle}
                    value=""
                    onChange={(e) => {
                      const id = String(e.target.value || "").trim();
                      if (!id) return;
                      const sel = opcoesPecasCadastradas.find((p) => p.id === id);
                      if (!sel) return;
                      // Preenche para evitar erro de digitacao: nome + serie/item (+ unidade e ultimo preco).
                      setMaterialManual(sel.nome);
                      setMaterialNumeroSerie(sel.numeroSerie);
                      setMaterialUnidade(sel.unidade || "UN");
                      if (sel.precoUnitario) setMaterialPrecoUnit(String(sel.precoUnitario));
                      setNomeTravado(true);
                      setSerieTravada(true);
                      // Reseta o select para permitir escolher novamente.
                      setTimeout(() => {
                        try {
                          e.target.value = "";
                        } catch {
                          // ignore
                        }
                      }, 0);
                    }}
                  >
                    <option value="">Selecionar peca ja cadastrada (evita digitar)</option>
                    {opcoesPecasCadastradas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {`${p.nome} | ${p.numeroSerie} | ${p.quantidade} ${p.unidade}`}
                      </option>
                    ))}
                  </select>

                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      style={{ ...inputStyle, marginBottom: 0, flex: 1, background: serieTravada ? "#f3f5f8" : "#fff" }}
                      placeholder="Número de serie / Número do item"
                      value={materialNumeroSerie}
                      onChange={(e) => {
                        setMaterialNumeroSerie(e.target.value);
                        setSerieTravada(false);
                      }}
                      disabled={serieTravada}
                    />
                    {serieTravada && (
                      <button
                        type="button"
                        style={{ ...btn, background: "#6c757d", color: "#fff", padding: "10px 12px" }}
                        onClick={() => setSerieTravada(false)}
                      >
                        Editar
                      </button>
                    )}
                  </div>
                </>
              )}

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  style={{ ...inputStyle, marginBottom: 0, flex: 1, background: nomeTravado ? "#f3f5f8" : "#fff" }}
                  placeholder={
                  normalizarNome(categoriaEntrada) === "FERRAMENTA"
                    ? "Nome da ferramenta"
                    : normalizarNome(categoriaEntrada) === "INSUMO"
                      ? "Nome do insumo"
                      : normalizarNome(categoriaEntrada) === "EPI"
                        ? "Nome do EPI"
                        : normalizarNome(categoriaEntrada) === "PECA_EQUIPAMENTO"
                          ? "Nome da peca/item (ex: FILTRO DE OLEO)"
                          : "Nome do material"
                  }
                  value={materialManual}
                  onChange={(e) => {
                    setMaterialManual(e.target.value);
                    setNomeTravado(false);
                  }}
                  disabled={nomeTravado}
                />
                {nomeTravado && (
                  <button
                    type="button"
                    style={{ ...btn, background: "#6c757d", color: "#fff", padding: "10px 12px" }}
                    onClick={() => setNomeTravado(false)}
                  >
                    Editar
                  </button>
                )}
              </div>

              {normalizarNome(categoriaEntrada) === "EPI" ? (
                <input
                  style={inputStyle}
                  placeholder="CA do EPI"
                  value={materialCA}
                  onChange={(e) => setMaterialCA(normalizarNome(e.target.value))}
                />
              ) : (
                <select style={inputStyle} value={materialUnidade} onChange={(e) => setMaterialUnidade(e.target.value)}>
                  {UNIDADES_PADRAO.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              )}

              <input
                style={inputStyle}
                type="number"
                min="0"
                placeholder="Quantidade de entrada"
                value={materialQtd}
                onChange={(e) => setMaterialQtd(e.target.value)}
              />

              <input
                style={inputStyle}
                placeholder="Preco unitario (R$)"
                value={materialPrecoUnit}
                onChange={(e) => setMaterialPrecoUnit(e.target.value)}
              />

              <div style={{
                background: "#f1f6ff",
                border: "1px solid #d7e4ff",
                borderRadius: 8,
                padding: "10px 12px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                minHeight: 42,
                boxSizing: "border-box"
              }}>
                <div style={{ fontWeight: "bold", color: "#10243e" }}>Total (auto)</div>
                <div style={{ fontWeight: "bold", color: "#0b3d91", whiteSpace: "nowrap" }}>
                  {`R$ ${Number(totalEntradaPreview || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </div>
              </div>

              <input
                style={inputStyle}
                placeholder="Valor do frete (R$)"
                value={materialValorFrete}
                onChange={(e) => setMaterialValorFrete(e.target.value)}
              />

              <div style={{
                background: "#eefaf3",
                border: "1px solid #cfe8d8",
                borderRadius: 8,
                padding: "10px 12px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                minHeight: 42,
                boxSizing: "border-box"
              }}>
                <div style={{ fontWeight: "bold", color: "#10243e" }}>Total geral</div>
                <div style={{ fontWeight: "bold", color: "#198754", whiteSpace: "nowrap" }}>
                  {`R$ ${Number(totalGeralEntradaPreview || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </div>
              </div>

              <input style={inputStyle} type="date" value={materialData} onChange={(e) => setMaterialData(e.target.value)} />

              <input
                style={inputStyle}
                placeholder="Número da Nota Fiscal"
                value={materialNota}
                onChange={(e) => setMaterialNota(e.target.value)}
              />

              <input style={inputStyle} placeholder="Fornecedor (opcional)" value={materialFornecedor} onChange={(e) => setMaterialFornecedor(e.target.value)} />
              <input style={inputStyle} placeholder="Transportador / proprietario" value={materialTransportador} onChange={(e) => setMaterialTransportador(e.target.value)} />
              <input style={inputStyle} placeholder="Veiculo" value={materialVeiculoFrete} onChange={(e) => setMaterialVeiculoFrete(e.target.value)} />
              <input style={inputStyle} placeholder="Placa" value={materialPlacaFrete} onChange={(e) => setMaterialPlacaFrete(e.target.value)} />
              <input style={inputStyle} placeholder="Motorista" value={materialMotoristaFrete} onChange={(e) => setMaterialMotoristaFrete(e.target.value)} />
            </div>

            <textarea
              style={{ ...inputStyle, height: 70, paddingTop: 10, marginTop: 10 }}
              placeholder="Observação da entrada"
              value={materialObs}
              onChange={(e) => setMaterialObs(e.target.value)}
            />

            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button style={{ ...btn, background: "#0b5ed7", color: "#fff" }} onClick={salvarEntradaMaterialUnica}>
                Salvar entrada
              </button>
            </div>

            <div style={{ marginTop: 10, color: "#5b6f8a", fontSize: 13 }}>
              Dica: o registro de entrada não baixa. Quem baixa é o estoque (quando houver retirada/saída/entrega).
            </div>
          </div>

          <div style={card}>
            <h3 style={{ marginTop: 0 }}>Estoque atual (baixa nas saídas)</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <button style={{ ...btn, background: "#0b5ed7", color: "#fff" }} onClick={gerarRelatorioEstoqueMateriais}>
                Imprimir relatorio do estoque
              </button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                <thead>
                  <tr style={{ background: "#0b3d91", color: "#fff" }}>
                    <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Categoria</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Material</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8 }}>N Serie/Item</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8 }}>CA</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Qtd</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Unid</th>
                  </tr>
                </thead>
                <tbody>
                  {estoqueConsolidado.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ border: "1px solid #d4dce9", padding: 10, textAlign: "center" }}>
                        Sem estoque cadastrado para a base.
                      </td>
                    </tr>
                  )}
                  {estoqueConsolidado.map((item, idx) => (
                    <tr key={idx}>
                      <td style={{ border: "1px solid #d4dce9", padding: 8, fontWeight: "bold" }}>{item.categoria}</td>
                      <td style={{ border: "1px solid #d4dce9", padding: 8 }}>{item.nome}</td>
                      <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center" }}>
                        {item.numeroSerie || "-"}
                      </td>
                      <td style={{ border: "1px solid #d4dce9", padding: 8 }}>{item.caEpi || "-"}</td>
                      <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center" }}>{item.quantidade}</td>
                      <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center" }}>{item.unidade || "UN"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={card}>
            <h3 style={{ marginTop: 0 }}>Registros de entrada (nao baixa)</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 10 }}>
              <input
                style={inputStyle}
                placeholder="Filtrar por Nota Fiscal (ex: 65232)"
                value={filtroNotaEntrada}
                onChange={(e) => setFiltroNotaEntrada(e.target.value)}
              />
              <select
                style={inputStyle}
                value={filtroCategoriaEntrada}
                onChange={(e) => setFiltroCategoriaEntrada(e.target.value)}
              >
                <option value="">Todas as categorias</option>
                <option value="FERRAMENTA">Ferramenta</option>
                <option value="INSUMO">Insumo</option>
                <option value="EPI">EPI</option>
                <option value="PECA_EQUIPAMENTO">Peca de equipamento</option>
              </select>
              <input
                style={inputStyle}
                placeholder="Filtrar por N serie / N item"
                value={filtroSerieEntrada}
                onChange={(e) => setFiltroSerieEntrada(e.target.value)}
              />
              <input style={inputStyle} type="date" value={filtroDataIniEntrada} onChange={(e) => setFiltroDataIniEntrada(e.target.value)} />
              <input style={inputStyle} type="date" value={filtroDataFimEntrada} onChange={(e) => setFiltroDataFimEntrada(e.target.value)} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <button style={{ ...btn, background: "#0b5ed7", color: "#fff" }} onClick={gerarRelatorioEntradasMateriais}>
                Imprimir relatorio de entradas
              </button>
              <button
                style={{ ...btn, background: "#6c757d", color: "#fff" }}
                onClick={() => {
                  setFiltroNotaEntrada("");
                  setFiltroCategoriaEntrada("");
                  setFiltroSerieEntrada("");
                  setFiltroDataIniEntrada("");
                  setFiltroDataFimEntrada("");
                }}
              >
                Limpar filtro
              </button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  tableLayout: "fixed",
                  minWidth: 1950
                }}
              >
                <thead>
                  <tr style={{ background: "#0b3d91", color: "#fff" }}>
                    <th style={{ border: "1px solid #d4dce9", padding: 8, width: 90, textAlign: "center" }}>Data</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8, width: 110, textAlign: "center" }}>Nota Fiscal</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8, width: 120, textAlign: "center" }}>Categoria</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8, width: 230, textAlign: "center" }}>Material</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8, width: 120, textAlign: "center" }}>N Serie/Item</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8, width: 80, textAlign: "center" }}>CA</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8, width: 70, textAlign: "center" }}>Qtd</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8, width: 70, textAlign: "center" }}>Unid</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8, width: 110, textAlign: "center" }}>Preco Unit.</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8, width: 120, textAlign: "center" }}>Total Nota</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8, width: 100, textAlign: "center" }}>Frete</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8, width: 130, textAlign: "center" }}>Total Geral</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8, width: 210, textAlign: "center" }}>Transportador</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8, width: 160, textAlign: "center" }}>Veiculo</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8, width: 100, textAlign: "center" }}>Placa</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8, width: 160, textAlign: "center" }}>Motorista</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8, width: 180, textAlign: "center" }}>Fornecedor</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8, width: 150, textAlign: "center" }}>Entrada por</th>
                    <th style={{ border: "1px solid #d4dce9", padding: 8, width: 160, textAlign: "center" }}>Obs</th>
                  </tr>
                </thead>
                <tbody>
                  {entradasFiltradas.length === 0 && (
                    <tr>
                      <td colSpan={18} style={{ border: "1px solid #d4dce9", padding: 10, textAlign: "center" }}>
                        Sem registros de entrada.
                      </td>
                    </tr>
                  )}
                  {entradasFiltradas.map((r) => (
                    <tr key={r.id}>
                        <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", verticalAlign: "middle", lineHeight: 1.25 }}>{formatarDataBR(r.dataEntrada)}</td>
                        <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", verticalAlign: "middle", lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis" }}>{r.notaFiscal || "-"}</td>
                        <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", verticalAlign: "middle", lineHeight: 1.25, fontWeight: "bold", overflow: "hidden", textOverflow: "ellipsis" }}>{r.categoria || "-"}</td>
                        <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", verticalAlign: "middle", lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis" }}>{r.nome || "-"}</td>
                        <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", verticalAlign: "middle", lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {r.numeroSerie || r.equipamentoCodigo || "-"}
                        </td>
                        <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", verticalAlign: "middle", lineHeight: 1.25 }}>{r.caEpi || "-"}</td>
                      <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", verticalAlign: "middle", lineHeight: 1.25 }}>{Number(r.quantidade || 0)}</td>
                      <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", verticalAlign: "middle", lineHeight: 1.25 }}>{r.unidade || "UN"}</td>
                      <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", verticalAlign: "middle", lineHeight: 1.25, whiteSpace: "nowrap", fontWeight: "bold" }}>
                        {`R$ ${Number(r.precoUnitario || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </td>
                        <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", verticalAlign: "middle", lineHeight: 1.25, whiteSpace: "nowrap", fontWeight: "bold" }}>
                          {`R$ ${Number(r.totalEntrada || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        </td>
                        <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", verticalAlign: "middle", lineHeight: 1.25, whiteSpace: "nowrap", fontWeight: "bold" }}>
                          {`R$ ${Number(r.valorFrete || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        </td>
                        <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", verticalAlign: "middle", lineHeight: 1.25, whiteSpace: "nowrap", fontWeight: "bold", color: "#198754" }}>
                          {`R$ ${Number(r.totalGeralEntrada || ((Number(r.totalEntrada || 0) || 0) + (Number(r.valorFrete || 0) || 0))).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        </td>
                        <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", verticalAlign: "middle", lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis" }}>{r.transportador || "-"}</td>
                        <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", verticalAlign: "middle", lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis" }}>{r.veiculoFrete || "-"}</td>
                        <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", verticalAlign: "middle", lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis" }}>{r.placaFrete || "-"}</td>
                        <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", verticalAlign: "middle", lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis" }}>{r.motoristaFrete || "-"}</td>
                        <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", verticalAlign: "middle", lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis" }}>{r.fornecedor || "-"}</td>
                        <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", verticalAlign: "middle", lineHeight: 1.25, fontWeight: "bold" }}>
                          {String(r.criadoPor || r.criado_por || r.usuario || "-").toUpperCase()}
                        </td>
                        <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", verticalAlign: "middle", lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis" }}>{r.observacao || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {abaAtiva === "FERRAMENTAS" && !somenteEntrada && (
      <>
      {!somenteSaidas && (
        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Ferramentas - entrada no almoxarifado</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <select style={inputStyle} value={ferramentaEntradaPadrao} onChange={(e) => setFerramentaEntradaPadrao(e.target.value)}>
              <option value="">Ferramenta padrao</option>
              {opcoesFerramenta.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <input
              style={inputStyle}
              placeholder="Ou digite outra ferramenta"
              value={ferramentaEntradaManual}
              onChange={(e) => setFerramentaEntradaManual(e.target.value)}
            />
            <input
              style={inputStyle}
              type="number"
              min="0"
              placeholder="Quantidade de entrada"
              value={qtdEntradaFerramenta}
              onChange={(e) => setQtdEntradaFerramenta(e.target.value)}
            />
            <input style={inputStyle} type="date" value={dataEntradaFerramenta} onChange={(e) => setDataEntradaFerramenta(e.target.value)} />
            <input style={inputStyle} placeholder="Fornecedor (opcional)" value={fornecedorFerramenta} onChange={(e) => setFornecedorFerramenta(e.target.value)} />
          </div>

          <textarea
            style={{ ...inputStyle, height: 70, paddingTop: 10, marginTop: 10 }}
            placeholder="Observação da entrada de ferramenta"
            value={obsEntradaFerramenta}
            onChange={(e) => setObsEntradaFerramenta(e.target.value)}
          />

          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button style={{ ...btn, background: "#0b5ed7", color: "#fff" }} onClick={salvarEntradaFerramenta}>Salvar entrada</button>
          </div>
        </div>
      )}

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Ferramentas - nova retirada</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <select style={inputStyle} value={funcionario} onChange={(e) => setFuncionario(e.target.value)}>
            <option value="">Selecione o funcionario</option>
            {funcionarios.map((f, i) => (
              <option key={i} value={f.nome}>{f.nome}</option>
            ))}
          </select>
          <select style={inputStyle} value={obra} onChange={(e) => setObra(e.target.value)}>
            <option value="">Obra destino (numero)</option>
            {obrasDaBase.map((o) => (
              <option key={o.id} value={o.nome}>{obraNumero(o.nome)}</option>
            ))}
          </select>
          <select style={inputStyle} value={itemPadrao} onChange={(e) => setItemPadrao(e.target.value)}>
            <option value="">Ferramenta padrao</option>
            {opcoesFerramenta.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <input style={inputStyle} placeholder="Ou digite outra ferramenta" value={itemManual} onChange={(e) => setItemManual(e.target.value)} />
          <input style={inputStyle} type="number" min="1" placeholder="Quantidade" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
          <input style={inputStyle} type="date" value={dataRetirada} onChange={(e) => setDataRetirada(e.target.value)} />
        </div>

        <textarea
          style={{ ...inputStyle, height: 80, paddingTop: 10, marginTop: 10 }}
          placeholder="Observação da retirada"
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
        />

        <p style={{ marginBottom: 6, fontWeight: "bold" }}>Assinatura de retirada da ferramenta</p>
        <SignatureCanvas
          ref={sigRetiradaRef}
          penColor="black"
          canvasProps={{ width: assinaturaWidth, height: 130, style: { border: "1px dashed #95a5bf", borderRadius: 8, background: "#fff" } }}
        />

        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button style={{ ...btn, background: "#0b5ed7", color: "#fff" }} onClick={salvarRetirada}>Salvar retirada</button>
          <button style={{ ...btn, background: "#6c757d", color: "#fff" }} onClick={() => sigRetiradaRef.current && sigRetiradaRef.current.clear()}>
            Limpar assinatura
          </button>
        </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Ferramentas pendentes de devolução</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <button style={{ ...btn, background: "#0b5ed7", color: "#fff" }} onClick={gerarRelatorioPendentesFerramentas}>
            Imprimir relatorio de pendencias
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr style={{ background: "#0b3d91", color: "#fff" }}>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Data</th>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Funcionario</th>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Obra</th>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Item</th>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Qtd</th>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Status</th>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Acao</th>
            </tr>
          </thead>
          <tbody>
            {pendentes.length === 0 && (
              <tr>
                <td colSpan={7} style={{ border: "1px solid #d4dce9", padding: 10, textAlign: "center" }}>Nenhuma pendencia.</td>
              </tr>
            )}
            {pendentes.map((m, i) => (
              <tr key={m.id} style={{ background: i % 2 === 0 ? "#f8fafe" : "#fff" }}>
                <td style={{ border: "1px solid #d4dce9", padding: 8 }}>{formatarDataBR(m.dataRetirada)}</td>
                <td style={{ border: "1px solid #d4dce9", padding: 8 }}>{m.funcionario}</td>
                <td style={{ border: "1px solid #d4dce9", padding: 8 }}>{m.obra}</td>
                <td style={{ border: "1px solid #d4dce9", padding: 8 }}>{m.item}</td>
                <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center" }}>{m.quantidade}</td>
                <td style={{ border: "1px solid #d4dce9", padding: 8, color: "#a10000", fontWeight: "bold" }}>{m.status}</td>
                <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center" }}>
                  <button style={{ ...btn, background: "#198754", color: "#fff", padding: "6px 10px" }} onClick={() => setRegistroBaixa(m)}>
                    Dar baixa
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {!somenteSaidas && (
        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Estoque atual de ferramentas</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <button style={{ ...btn, background: "#0b5ed7", color: "#fff" }} onClick={gerarRelatorioEstoqueFerramentas}>
              Imprimir relatorio de estoque de ferramentas
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr style={{ background: "#0b3d91", color: "#fff" }}>
                <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Ferramenta</th>
                <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Quantidade</th>
              </tr>
            </thead>
            <tbody>
              {estoqueFerramentas.length === 0 && (
                <tr>
                  <td colSpan={2} style={{ border: "1px solid #d4dce9", padding: 10, textAlign: "center" }}>Sem ferramentas cadastradas em estoque.</td>
                </tr>
              )}
              {estoqueFerramentas.map((item, i) => (
                <tr key={item.id} style={{ background: i % 2 === 0 ? "#f8fafe" : "#fff" }}>
                  <td style={{ border: "1px solid #d4dce9", padding: 8 }}>{item.nome}</td>
                  <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", fontWeight: "bold" }}>{Number(item.quantidade || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
      </>
      )}

      {abaAtiva === "FERRAMENTAS" && registroBaixa && (
        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Baixa da ferramenta</h3>
          <p style={{ marginTop: 0 }}>
            <strong>{registroBaixa.funcionario}</strong> - {registroBaixa.item} ({registroBaixa.quantidade})
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <input style={inputStyle} type="date" value={dataBaixa} onChange={(e) => setDataBaixa(e.target.value)} />
            <input style={inputStyle} placeholder="Observação da devolução" value={obsBaixa} onChange={(e) => setObsBaixa(e.target.value)} />
          </div>
          <p style={{ marginBottom: 6, marginTop: 10, fontWeight: "bold" }}>Assinatura de devolução</p>
          <SignatureCanvas
            ref={sigBaixaRef}
            penColor="black"
            canvasProps={{ width: assinaturaWidth, height: 130, style: { border: "1px dashed #95a5bf", borderRadius: 8, background: "#fff" } }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button style={{ ...btn, background: "#198754", color: "#fff" }} onClick={confirmarBaixa}>Confirmar baixa</button>
            <button style={{ ...btn, background: "#6c757d", color: "#fff" }} onClick={() => sigBaixaRef.current && sigBaixaRef.current.clear()}>
              Limpar assinatura
            </button>
            <button style={{ ...btn, background: "#dc3545", color: "#fff" }} onClick={() => setRegistroBaixa(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {abaAtiva === "INSUMOS" && !somenteEntrada && (
      <>
      {!somenteSaidas && (
        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Insumos - entrada de material</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <select style={inputStyle} value={insumoPadrao} onChange={(e) => setInsumoPadrao(e.target.value)}>
              <option value="">Insumo padrao</option>
              {opcoesInsumo.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
            <input style={inputStyle} placeholder="Ou digite outro insumo" value={insumoManual} onChange={(e) => setInsumoManual(e.target.value)} />
            <select style={inputStyle} value={unidadeInsumo} onChange={(e) => setUnidadeInsumo(e.target.value)}>
              {UNIDADES_PADRAO.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
            <input style={inputStyle} type="number" min="0" placeholder="Quantidade entrada" value={qtdEntrada} onChange={(e) => setQtdEntrada(e.target.value)} />
            <input style={inputStyle} type="date" value={dataEntrada} onChange={(e) => setDataEntrada(e.target.value)} />
            <input style={inputStyle} placeholder="Fornecedor" value={fornecedorEntrada} onChange={(e) => setFornecedorEntrada(e.target.value)} />
          </div>
          <textarea style={{ ...inputStyle, height: 70, paddingTop: 10, marginTop: 10 }} placeholder="Observação da entrada" value={obsEntrada} onChange={(e) => setObsEntrada(e.target.value)} />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button style={{ ...btn, background: "#0b5ed7", color: "#fff" }} onClick={salvarEntradaInsumo}>Salvar entrada</button>
          </div>
        </div>
      )}

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Insumos - saída para obra</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <select style={inputStyle} value={insumoSaidaNome} onChange={(e) => setInsumoSaidaNome(e.target.value)}>
            <option value="">Selecione o insumo</option>
            {estoqueInsumos.map((item) => (
              <option key={item.id} value={item.nome}>{item.nome} ({Number(item.quantidade || 0)} {item.unidade || "UN"})</option>
            ))}
          </select>
          <select style={inputStyle} value={obraSaida} onChange={(e) => setObraSaida(e.target.value)}>
            <option value="">Obra destino (número)</option>
            {obrasDaBase.map((o) => (
              <option key={o.id} value={o.nome}>{obraNumero(o.nome)}</option>
            ))}
          </select>
          <select style={inputStyle} value={funcionarioSaida} onChange={(e) => setFuncionarioSaida(e.target.value)}>
            <option value="">Funcionário que retirou</option>
            {funcionarios.map((f, i) => (
              <option key={i} value={f.nome}>{f.nome}</option>
            ))}
          </select>
          <input style={inputStyle} type="number" min="0" placeholder="Quantidade saída" value={qtdSaida} onChange={(e) => setQtdSaida(e.target.value)} />
          <input style={inputStyle} type="date" value={dataSaida} onChange={(e) => setDataSaida(e.target.value)} />
          <input style={inputStyle} placeholder="Observação da saída" value={obsSaida} onChange={(e) => setObsSaida(e.target.value)} />
        </div>
        <p style={{ marginBottom: 6, marginTop: 10, fontWeight: "bold" }}>Assinatura de retirada do insumo</p>
        <SignatureCanvas
          ref={sigSaidaInsumoRef}
          penColor="black"
          canvasProps={{ width: assinaturaWidth, height: 130, style: { border: "1px dashed #95a5bf", borderRadius: 8, background: "#fff" } }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button style={{ ...btn, background: "#198754", color: "#fff" }} onClick={salvarSaidaInsumo}>Salvar saída</button>
          <button style={{ ...btn, background: "#6c757d", color: "#fff" }} onClick={() => sigSaidaInsumoRef.current && sigSaidaInsumoRef.current.clear()}>
            Limpar assinatura
          </button>
        </div>
      </div>

      {!somenteSaidas && (
        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Estoque atual de insumos</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <button style={{ ...btn, background: "#0b5ed7", color: "#fff" }} onClick={gerarRelatorioEstoqueInsumos}>
              Imprimir relatorio de estoque de insumos
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr style={{ background: "#0b3d91", color: "#fff" }}>
                <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Insumo</th>
                <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Quantidade</th>
                <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Unidade</th>
              </tr>
            </thead>
            <tbody>
              {estoqueInsumos.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ border: "1px solid #d4dce9", padding: 10, textAlign: "center" }}>Sem estoque cadastrado.</td>
                </tr>
              )}
              {estoqueInsumos.map((item, i) => (
                <tr key={item.id} style={{ background: i % 2 === 0 ? "#f8fafe" : "#fff" }}>
                  <td style={{ border: "1px solid #d4dce9", padding: 8 }}>{item.nome}</td>
                  <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", fontWeight: "bold" }}>{Number(item.quantidade || 0)}</td>
                  <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center" }}>{item.unidade || "UN"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
      </>
      )}

      {abaAtiva === "INSUMOS" && !somenteSaidas && (
      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Histórico de insumos</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 10 }}>
          <input style={inputStyle} type="date" value={filtroDataIniInsumo} onChange={(e) => setFiltroDataIniInsumo(e.target.value)} />
          <input style={inputStyle} type="date" value={filtroDataFimInsumo} onChange={(e) => setFiltroDataFimInsumo(e.target.value)} />
          <select style={inputStyle} value={filtroFuncionarioInsumo} onChange={(e) => setFiltroFuncionarioInsumo(e.target.value)}>
            <option value="">Todos os funcionarios</option>
            {funcionariosNoHistoricoInsumo.map((nome) => (
              <option key={nome} value={nome}>{nome}</option>
            ))}
          </select>
          <select style={inputStyle} value={filtroTipoMovInsumo} onChange={(e) => setFiltroTipoMovInsumo(e.target.value)}>
            <option value="TODOS">Todos os tipos</option>
            <option value="ENTRADA">ENTRADA</option>
            <option value="SAIDA">SAIDA</option>
          </select>
          <input
            style={inputStyle}
            placeholder="Filtrar por nome do material"
            value={filtroNomeInsumo}
            onChange={(e) => setFiltroNomeInsumo(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <button style={{ ...btn, background: "#0b5ed7", color: "#fff" }} onClick={gerarRelatorioHistoricoInsumos}>
            Imprimir histórico filtrado
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr style={{ background: "#0b3d91", color: "#fff" }}>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Data</th>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Tipo</th>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Insumo</th>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Qtd</th>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Obra</th>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Funcionario</th>
            </tr>
          </thead>
          <tbody>
            {historicoInsumosFiltrado.length === 0 && (
              <tr>
                <td colSpan={6} style={{ border: "1px solid #d4dce9", padding: 10, textAlign: "center" }}>Sem movimentacao para o filtro informado.</td>
              </tr>
            )}
            {historicoInsumosFiltrado.map((m, i) => (
              <tr key={m.id} style={{ background: i % 2 === 0 ? "#f8fafe" : "#fff" }}>
                <td style={{ border: "1px solid #d4dce9", padding: 8 }}>{formatarDataBR(m.dataMov)}</td>
                <td style={{ border: "1px solid #d4dce9", padding: 8, fontWeight: "bold" }}>{m.tipoMov}</td>
                <td style={{ border: "1px solid #d4dce9", padding: 8 }}>{m.nome}</td>
                <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center" }}>{m.quantidade} {m.unidade || ""}</td>
                <td style={{ border: "1px solid #d4dce9", padding: 8 }}>{m.obra || "-"}</td>
                <td style={{ border: "1px solid #d4dce9", padding: 8 }}>{m.funcionario || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        </div>
    </div>
  );
}

export default Almoxarifado;


