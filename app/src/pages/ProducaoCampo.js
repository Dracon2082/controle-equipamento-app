/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useMemo, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { db } from "../firebase";
import { registrarHistorico } from "../utils/historico";
import { formatoLogoPdf, resolverLogoPdf } from "../utils/pdfLogo";
import { belongsToTenant, getConfigDocId, getTenantId, withTenant } from "../utils/tenant";

const TIPOS_ITEM = ["RP", "TB", "RC", "TS", "BUEIRO", "CALCADA", "MEIO_FIO", "OUTRO"];
const FERRAMENTAS = ["LIVRE", "MEIO_FIO", "CALCADA", "BUEIRO"];
const LADOS_EXECUCAO = ["DIREITO", "ESQUERDO", "EIXO", "PISTA_TODA"];
const MAX_ITENS_POR_FOLHA = 15;

function ProducaoCampo({ setTela, modo = "operacional" }) {
  // "Mobile" aqui precisa ser robusto: no celular em paisagem o innerWidth pode passar de 768.
  // Usamos pointer coarse + userAgent + media query para decidir.
  const isCoarsePointer = Boolean(window.matchMedia?.("(pointer: coarse)")?.matches);
  const isSmallScreen = Boolean(window.matchMedia?.("(max-width: 768px)")?.matches);
  const ua = String(navigator.userAgent || "");
  const isMobileUA = /Android|iPhone|iPad|iPod|Mobi/i.test(ua);
  const isMobile = isCoarsePointer || isSmallScreen || isMobileUA;
  const precisaHttpsParaGps = (isCoarsePointer || isMobileUA) && window.isSecureContext === false;
  // Respeita o modo explicitamente passado pela navegacao.
  // Se nao vier nada, no computador cai no relatorio por padrao.
  const modoNormalizado = String(modo || "").trim().toLowerCase();
  const modoRelatorio =
    modoNormalizado === "relatorio"
      ? true
      : modoNormalizado === "operacional"
        ? false
        : !isMobile;
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
  const chaveBase = (cidade, estado) =>
    `${String(cidade || "").trim().toUpperCase()}__${String(estado || "").trim().toUpperCase()}`;
  const basePermitida = (item) =>
    acessoTotalBases || (
      basesPermitidas.length > 0 && (
        basesPermitidas.includes(chaveBase(item?.cidade, item?.estado))
        || cidadesPermitidas.has(String(item?.cidade || "").trim().toUpperCase())
      )
    );

  const apontadorLogado = useMemo(() => {
    const direto = String(localStorage.getItem("usuarioLogado") || "").trim();
    if (direto) return direto;
    const nome = String(sessaoOperacional?.nome || "").trim();
    if (nome) return nome;
    const email = String(sessaoOperacional?.email || "").trim();
    if (email) return email.split("@")[0];
    const cpf = String(sessaoOperacional?.cpf || "").trim();
    if (cpf) return cpf;
    return "";
  }, []);
  const apontadorTravado = Boolean(apontadorLogado);

  const [obras, setObras] = useState([]);
  const [lista, setLista] = useState([]);
  const [empresaSistema, setEmpresaSistema] = useState(null);

  const hojeISO = new Date().toISOString().split("T")[0];
  const [data, setData] = useState(hojeISO);
  const [obra, setObra] = useState("");
  const [rua, setRua] = useState("");
  const [bairro, setBairro] = useState("");
  const [apontador, setApontador] = useState(() => apontadorLogado);

  const [tipoItem, setTipoItem] = useState("RP");
  const [ladoExecucao, setLadoExecucao] = useState("DIREITO");
  const [identificacaoPonto, setIdentificacaoPonto] = useState("");
  const [profundidade, setProfundidade] = useState("");
  const [largura, setLargura] = useState("");
  const [comprimento, setComprimento] = useState("");
  const [referenciaInicio, setReferenciaInicio] = useState("");
  const [referenciaFim, setReferenciaFim] = useState("");
  const [qtdBueiro, setQtdBueiro] = useState("");
  const [diametroBueiro, setDiametroBueiro] = useState("");
  const [observacao, setObservacao] = useState("");
  const [outroServico, setOutroServico] = useState("");
  const [editandoItemId, setEditandoItemId] = useState(null);
  const [statusGeo, setStatusGeo] = useState("");
  const [ajudaGeo, setAjudaGeo] = useState("");

  const [ferramenta, setFerramenta] = useState("LIVRE");
  const [desenhando, setDesenhando] = useState(false);
  const [linhaInicio, setLinhaInicio] = useState(null);
  const [shapes, setShapes] = useState([]);
  const [itensCroqui, setItensCroqui] = useState([]);
  const [croquiSnapshot, setCroquiSnapshot] = useState("");

  const [filtroData, setFiltroData] = useState(hojeISO);
  const [filtroObra, setFiltroObra] = useState("");
  const [editRegistroId, setEditRegistroId] = useState(null);
  const [editLogradouro, setEditLogradouro] = useState("");
  const [editBairro, setEditBairro] = useState("");
  const [editApontador, setEditApontador] = useState("");
  const [salvandoEdicaoRegistro, setSalvandoEdicaoRegistro] = useState(false);

  const canvasRef = useRef(null);
  const shapeIdRef = useRef(1);
  const itemIdRef = useRef(1);
  const snapshotTimerRef = useRef(null);
  // Manter a mesma proporcao do croqui do celular (1400x800 = 7/4).
  // Isso evita que, ao sair da tela cheia, o desenho fique "espremido" e o PDF pareca deslocado para o eixo.
  const croquiDimRef = useRef({ w: 1100, h: 628 });
  const croquiSnapshotRef = useRef("");
  const shapesRef = useRef([]);
  const editStartShapesLenRef = useRef(0);
  const editOriginalShapeIdRef = useRef(null);
  const editStartSnapshotRef = useRef("");
  const croquiRevRef = useRef(0);
  const editStartCroquiRevRef = useRef(0);
  const lastCreatedShapeIdRef = useRef(null);
  const editStartShapeSeqRef = useRef(0);
  const linhaInicioRef = useRef(null);
  // Base fixa de coordenadas do croqui para evitar "mudanca de escala" quando o celular alterna
  // entre paisagem (desenho) e retrato (vinculo). Guardamos os pontos sempre nesta base e
  // reescalamos apenas na renderizacao/geracao de imagem/PDF.
  const coordsBaseRef = useRef({ w: null, h: null });

  const page = {
    maxWidth: 1260,
    margin: "0 auto",
    padding: "18px 10px 28px",
    background: "#f3f5f8"
  };

  const card = {
    background: "#fff",
    border: "1px solid #e3e7ef",
    borderRadius: 8,
    padding: 14,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    marginBottom: 12
  };

  const inputBase = {
    width: "100%",
    height: 40,
    borderRadius: 8,
    border: "1px solid #cfd7e3",
    padding: "0 10px",
    boxSizing: "border-box"
  };

  const textArea = {
    width: "100%",
    borderRadius: 8,
    border: "1px solid #cfd7e3",
    padding: 10,
    boxSizing: "border-box",
    minHeight: 85,
    resize: "vertical"
  };

  const btn = {
    background: "#0b5ed7",
    border: "none",
    color: "#fff",
    borderRadius: 8,
    padding: "10px 14px",
    fontWeight: "bold",
    cursor: "pointer"
  };

  const btnSec = {
    ...btn,
    background: "#6c757d"
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    carregarTudo();
  }, []);

  useEffect(() => {
    // Apontador deve ser o usuario logado (campo). Se houver sessao, preenche automatico.
    if (apontadorTravado && apontadorLogado && (!apontador || apontador !== apontadorLogado)) {
      setApontador(apontadorLogado);
    }
  }, [apontadorTravado, apontadorLogado]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    desenharCanvas();
  }, [shapes, linhaInicio]);

  useEffect(() => {
    setTimeout(() => desenharCanvas(), 40);
  }, []);

  const agendarSnapshotCroqui = () => {
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    snapshotTimerRef.current = setTimeout(() => {
      try {
        const canvas = canvasRef.current;
        // Evita "deformar" o snapshot: quando nao existe canvas montado (ex.: mobile fora da tela cheia),
        // nao sobrescrevemos o snapshot capturado no momento do desenho.
        if (canvas) {
          definirSnapshotCroqui(canvas.toDataURL("image/jpeg", 0.85));
        } else {
          // No mobile, depois que fecha a tela cheia, o canvas some.
          // Mesmo assim precisamos regenerar o snapshot quando o usuario vincula/edita itens,
          // para o ID (RP001/TB001...) e medidas aparecerem no croqui e no PDF.
          const png = gerarCroquiDataUrl({ force: true });
          if (png) definirSnapshotCroqui(png);
        }
      } catch (e) {
        // ignore
      }
    }, 200);
  };

  useEffect(() => {
    // Mantem um PNG do croqui para casos em que o canvas nao esta montado.
    if (!shapes.length && !itensCroqui.length && !linhaInicio) return;
    agendarSnapshotCroqui();
  }, [shapes, itensCroqui, linhaInicio]);

  useEffect(() => {
    // Linha em andamento: manter ref sincronizado.
    // Observacao: shapesRef.current e atualizado manualmente nos eventos de desenho e nas operacoes
    // de vincular/editar/excluir para evitar "corrida" no celular.
    linhaInicioRef.current = linhaInicio;
  }, [linhaInicio]);

  const escolherShapesMaisCompleto = (...listas) => {
    const validas = listas.filter((l) => Array.isArray(l));
    if (!validas.length) return [];
    return validas.reduce((maior, atual) => (atual.length > maior.length ? atual : maior), validas[0]);
  };

  const definirSnapshotCroqui = (dataUrl) => {
    const txt = String(dataUrl || "");
    if (!txt) return;
    croquiSnapshotRef.current = txt;
    setCroquiSnapshot(txt);
  };

  const numero = (valor) => {
    // Aceita "0,55" ou "0.55" como decimal, e tambem formatos com milhar:
    // "1.234,56" ou "1,234.56". A regra: o ultimo separador (.,) e o decimal.
    const bruto = String(valor ?? "").trim();
    if (!bruto) return 0;

    const limpo = bruto.replace(/\s/g, "");
    const temVirgula = limpo.includes(",");
    const temPonto = limpo.includes(".");

    let normalizado = limpo;
    if (temVirgula && temPonto) {
      const ultimaVirgula = limpo.lastIndexOf(",");
      const ultimoPonto = limpo.lastIndexOf(".");
      const decimalSep = ultimaVirgula > ultimoPonto ? "," : ".";
      if (decimalSep === ",") {
        // "." vira milhar, "," vira decimal
        normalizado = limpo.replace(/\./g, "").replace(",", ".");
      } else {
        // "," vira milhar, "." vira decimal
        normalizado = limpo.replace(/,/g, "");
      }
    } else if (temVirgula) {
      // Apenas virgula: trata como decimal
      normalizado = limpo.replace(/\./g, "").replace(",", ".");
    } else if (temPonto) {
      // Apenas ponto: trata como decimal (mantem apenas o ultimo ponto)
      const partes = limpo.split(".");
      if (partes.length > 2) {
        const decimal = partes.pop();
        normalizado = `${partes.join("")}.${decimal}`;
      }
    }

    // Remove qualquer caractere inesperado (mantem digitos, sinal e ponto decimal).
    normalizado = normalizado.replace(/[^0-9.+-]/g, "");
    const convertido = Number(normalizado);
    return Number.isFinite(convertido) ? convertido : 0;
  };

  const formatarDataBR = (dataISO) => {
    const partes = String(dataISO || "").split("-");
    if (partes.length !== 3) return dataISO || "-";
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
  };

  const primeiroNome = (nomeCompleto) => {
    const nome = String(nomeCompleto || "").trim();
    if (!nome) return "-";
    return nome.split(/\s+/)[0];
  };
  const prefixoTipo = (tipo) => {
    const t = String(tipo || "").toUpperCase();
    if (t === "MEIO_FIO") return "MF";
    if (t === "CALCADA") return "CA";
    if (t === "BUEIRO") return "BU";
    if (t === "TB") return "TB";
    if (t === "RP") return "RP";
    if (t === "RC" || t === "EIXO") return "RC";
    if (t === "TS") return "TS";
    if (t === "OUTRO") return "OT";
    return "RP";
  };
  const formatarTipoItem = (tipo) => {
    const texto = String(tipo || "").toUpperCase();
    if (!texto) return "-";
    if (texto === "EIXO") return "RC";
    if (texto === "OUTRO") return "OT";
    return texto.replace(/_/g, " ");
  };
  const labelTipoItem = (tipo) => {
    const t = String(tipo || "").toUpperCase();
    if (t === "RP") return "Remendo profundo (RP)";
    if (t === "TB") return "Tapa buraco (TB)";
    if (t === "RC") return "Recape (RC)";
    if (t === "TS") return "Troca de solo (TS)";
    if (t === "BUEIRO") return "Bueiro (BU)";
    if (t === "CALCADA") return "Calcada (CA)";
    if (t === "MEIO_FIO") return "Meio-fio (MF)";
    if (t === "OUTRO") return "Outro (OT)";
    return formatarTipoItem(t);
  };
  const formatarLadoExecucao = (lado) => {
    const texto = String(lado || "").toUpperCase();
    if (!texto) return "-";
    if (texto === "AMBOS" || texto === "PISTA_TODA") return "PISTA TODA";
    return texto.replace(/_/g, " ");
  };
  const formatarIdentificacaoVisual = (identificacao, tipo, fallbackNumero = 1) => {
    const texto = String(identificacao || "").trim().toUpperCase();
    const prefixo = prefixoTipo(tipo);
    const numeros = texto.match(/\d+/g);
    const numero = numeros?.length ? Number(numeros.join("")) : Number(fallbackNumero || 1);
    if (!Number.isFinite(numero) || numero <= 0) return texto || `${prefixo}001`;
    return `${prefixo}${String(numero).padStart(3, "0")}`;
  };

  const formatarGeo = (geo) => {
    if (!geo) return "-";
    const lat = Number(geo.latitude);
    const lon = Number(geo.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "-";
    const acc = Number(geo.accuracyMeters);
    const accTexto = Number.isFinite(acc) && acc > 0 ? ` (±${Math.round(acc)}m)` : "";
    return `${lat.toFixed(6)}, ${lon.toFixed(6)}${accTexto}`;
  };

  const isBueiro = tipoItem === "BUEIRO";
  const isCalcada = tipoItem === "CALCADA";
  const isMeioFio = tipoItem === "MEIO_FIO";
  const isEscavacao = !isBueiro && !isCalcada && !isMeioFio;

  const detalheItem = (item) => {
    const tipo = String(item?.tipoItem || "").toUpperCase();
    if (tipo === "BUEIRO") {
      return `Qtd: ${numero(item.qtdBueiro).toFixed(0)} | Diametro: ${item.diametroBueiro || "-"}`;
    }
    if (tipo === "CALCADA") {
      return `Calcada executada: ${numero(item.comprimento).toFixed(2)} m`;
    }
    if (tipo === "MEIO_FIO") {
      return `Meio-fio executado: ${numero(item.comprimento).toFixed(2)} m`;
    }
    if (tipo === "OUTRO") {
      const nome = String(item?.outroServico || "").trim();
      return `Servico: ${nome || "-"} | P ${numero(item.profundidade).toFixed(2)} | L ${numero(item.largura).toFixed(2)} | C ${numero(item.comprimento).toFixed(2)}`;
    }
    return `P ${numero(item.profundidade).toFixed(2)} | L ${numero(item.largura).toFixed(2)} | C ${numero(item.comprimento).toFixed(2)}`;
  };
  const linhasMedidasItem = (item) => {
    const tipo = String(item?.tipoItem || "").toUpperCase();
    if (tipo === "BUEIRO") {
      return [
        `QTD ${numero(item.qtdBueiro).toFixed(0)}`,
        `DIA ${item.diametroBueiro || "-"}`
      ];
    }
    if (tipo === "CALCADA") return [`C ${numero(item.comprimento).toFixed(2)}m`];
    if (tipo === "MEIO_FIO") return [`C ${numero(item.comprimento).toFixed(2)}m`];
    return [
      `P ${numero(item.profundidade).toFixed(2)}`,
      `L ${numero(item.largura).toFixed(2)}`,
      `C ${numero(item.comprimento).toFixed(2)}`
    ];
  };

  const obterGeoAtual = () =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject({ code: "NAO_SUPORTA", message: "Geolocalizacao indisponivel." });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos),
        (err) => reject(err),
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    });

  const textoAjudaGeo = () => {
    const base = [
      "Para permitir o GPS, o navegador precisa de permissao de Localizacao.",
      "1) Toque no cadeado (ou info) ao lado do endereco do site",
      "2) Permissoes do site > Localizacao > Permitir",
      "3) Volte ao sistema e toque em 'Ativar/Testar GPS' novamente"
    ];

    // Orientacoes extras por plataforma (sem depender de deep link).
    if (/iPhone|iPad|iPod/i.test(ua)) {
      base.push("iPhone/iPad: Ajustes > Privacidade e Seguranca > Servicos de Localizacao (ligado) > Safari > Permitir.");
    } else if (/Android/i.test(ua)) {
      base.push("Android: Configuracoes > Localizacao (ligado) e no Chrome: Configuracoes > Configuracoes do site > Localizacao.");
    }

    // Observacao importante: muitos browsers bloqueiam geolocalizacao fora de HTTPS.
    if (window.isSecureContext === false) {
      base.push("Obs.: Muitos celulares exigem HTTPS (site seguro). Se estiver em HTTP, pode bloquear o GPS.");
    }

    return base.join("\n");
  };

  const tratarErroGeo = (err) => {
    const code = err?.code;
    if (code === 1) { // PERMISSION_DENIED
      setStatusGeo("GPS negado pelo navegador. Libere a permissao de Localizacao para este site.");
      setAjudaGeo(textoAjudaGeo());
      return;
    }
    if (code === 2) { // POSITION_UNAVAILABLE
      setStatusGeo("GPS indisponivel. Verifique se a Localizacao do celular esta ligada e com boa visibilidade de ceu.");
      setAjudaGeo("");
      return;
    }
    if (code === 3) { // TIMEOUT
      setStatusGeo("GPS demorou (timeout). Tente novamente com Localizacao ligada e em area aberta.");
      setAjudaGeo("");
      return;
    }
    if (code === "NAO_SUPORTA") {
      setStatusGeo("Este navegador nao suporta geolocalizacao.");
      setAjudaGeo("");
      return;
    }
    setStatusGeo("Nao foi possivel capturar o GPS. Verifique permissao e se a Localizacao esta ligada.");
    setAjudaGeo(window.isSecureContext === false ? textoAjudaGeo() : "");
  };

  const consultarPermissaoGeo = async () => {
    // Nem todo navegador suporta (Safari iOS por exemplo).
    try {
      if (!navigator.permissions?.query) return null;
      const res = await navigator.permissions.query({ name: "geolocation" });
      return res?.state || null; // "granted" | "prompt" | "denied"
    } catch {
      return null;
    }
  };

  const capturarGeoSeMobile = async () => {
    // Exigir GPS apenas em dispositivos "mobile" de verdade (coarse pointer/UA).
    // Evita falhar em desktop com janela pequena.
    if (!(isCoarsePointer || isMobileUA)) return null;
    try {
      setStatusGeo("Capturando GPS...");
      setAjudaGeo("");
      // Em varios navegadores, geolocalizacao so funciona em contexto seguro (https/localhost).
      if (window.isSecureContext === false) {
        setStatusGeo("GPS: este navegador exige HTTPS para localizar.");
      }
      const pos = await obterGeoAtual();
      const geo = {
        latitude: Number(pos?.coords?.latitude),
        longitude: Number(pos?.coords?.longitude),
        accuracyMeters: Number(pos?.coords?.accuracy),
        capturedAtISO: new Date(pos?.timestamp || Date.now()).toISOString()
      };
      setStatusGeo(`GPS OK: ${formatarGeo(geo)}`);
      return geo;
    } catch (e) {
      tratarErroGeo(e);
      return null;
    }
  };

  const testarGpsAgora = async () => {
    // Botao para o usuario acionar o popup de permissao quando estiver em "Perguntar".
    if (!(isCoarsePointer || isMobileUA)) {
      alert("Este teste de GPS e para uso no celular.");
      return;
    }
    setStatusGeo("Clique no pop-up do navegador para permitir a localizacao (se aparecer).");
    setAjudaGeo("");
    const perm = await consultarPermissaoGeo();
    if (perm === "denied") {
      setStatusGeo("Permissao de GPS esta NEGADA para este site.");
      setAjudaGeo(textoAjudaGeo());
      return;
    }
    if (perm === "granted") {
      setStatusGeo("Permissao OK. Capturando GPS...");
    }
    const geo = await capturarGeoSeMobile();
    if (!geo) return;
    // Opcional: nada a fazer aqui. O status ja aparece na tela.
  };

  const limparFormularioItem = () => {
    setIdentificacaoPonto("");
    setProfundidade("");
    setLargura("");
    setComprimento("");
    setReferenciaInicio("");
    setReferenciaFim("");
    setQtdBueiro("");
    setDiametroBueiro("");
    setObservacao("");
    setOutroServico("");
    setStatusGeo("");
    setAjudaGeo("");
    setTipoItem("RP");
    setLadoExecucao("DIREITO");
    // Mantem o ID automatico sempre pronto sem depender de efeito/tempo de render.
    setIdentificacaoPonto("RP001");
  };

  const cancelarEdicaoItem = () => {
    setEditandoItemId(null);
    editStartShapesLenRef.current = 0;
    editOriginalShapeIdRef.current = null;
    editStartSnapshotRef.current = "";
    editStartCroquiRevRef.current = croquiRevRef.current;
    lastCreatedShapeIdRef.current = null;
    editStartShapeSeqRef.current = 0;
    limparFormularioItem();
  };

  const carregarItemParaEdicao = (item) => {
    if (!item) return;
    setEditandoItemId(item.itemId);
    // Detecta se o usuario desenhou algo depois de entrar na edicao para re-vincular ao ultimo desenho.
    editStartShapesLenRef.current = Array.isArray(shapesRef.current) ? shapesRef.current.length : 0;
    editOriginalShapeIdRef.current = item.shapeId ?? null;
    editStartSnapshotRef.current = croquiSnapshotRef.current || "";
    editStartCroquiRevRef.current = croquiRevRef.current;
    lastCreatedShapeIdRef.current = null;
    editStartShapeSeqRef.current = shapeIdRef.current;
    setTipoItem(String(item.tipoItem || "RP").toUpperCase());
    setLadoExecucao(String(item.ladoExecucao || "DIREITO").toUpperCase() || "DIREITO");
    setIdentificacaoPonto(String(item.identificacaoPonto || ""));
    setProfundidade(String(item.profundidade ?? ""));
    setLargura(String(item.largura ?? ""));
    setComprimento(String(item.comprimento ?? ""));
    setReferenciaInicio(String(item.referenciaInicio || ""));
    setReferenciaFim(String(item.referenciaFim || ""));
    setQtdBueiro(String(item.qtdBueiro ?? ""));
    setDiametroBueiro(String(item.diametroBueiro || ""));
    setObservacao(String(item.observacao || ""));
    setOutroServico(String(item.outroServico || ""));
  };

  const sugestaoIdentificacao = useMemo(() => {
    const prefixo = prefixoTipo(tipoItem) || "PONTO";
    const qtd = itensCroqui.filter((i) => i.tipoItem === tipoItem).length + 1;
    const num = String(qtd).padStart(3, "0");
    return `${String(prefixo || "").toUpperCase()}${num}`;
  }, [itensCroqui, tipoItem]);

  useEffect(() => {
    // ID automatico sempre ligado: RP001, RP002, TB001...
    // Ao editar um item, mantemos o ID existente (para nao sobrescrever).
    if (editandoItemId) return;
    if (identificacaoPonto !== sugestaoIdentificacao) {
      setIdentificacaoPonto(sugestaoIdentificacao);
    }
  }, [editandoItemId, sugestaoIdentificacao]);

  useEffect(() => {
    if (String(tipoItem || "").toUpperCase() !== "OUTRO") {
      setOutroServico("");
    }
  }, [tipoItem]);

  const carregarTudo = async () => {
    const [snapObras, snapProducao, snapEmpresa] = await Promise.all([
      getDocs(collection(db, "obras")),
      getDocs(collection(db, "producaoCampo")),
      getDoc(doc(db, "configuracoes", getConfigDocId(tenantId)))
    ]);

    const listaObras = snapObras.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId))
      .filter(basePermitida);
    listaObras.sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));
    setObras(listaObras);

    const obrasPermitidas = new Set(listaObras.map((item) => String(item.nome || "").trim().toUpperCase()));
    const listaProd = snapProducao.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId))
      .filter((item) => obrasPermitidas.has(String(item.obra || "").trim().toUpperCase()));
    listaProd.sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")));
    setLista(listaProd);

    if (snapEmpresa.exists()) setEmpresaSistema(snapEmpresa.data());
    setTimeout(() => desenharCanvas(), 50);
  };

  useEffect(() => {
    if (!obra) return;
    const existe = obras.some((item) => String(item.nome || "") === String(obra || ""));
    if (!existe) setObra("");
  }, [obras, obra]);

  const ajustarParaPonto = (x, y, passo = 14, desloc = 12) => {
    const xAjustado = Math.round((x - desloc) / passo) * passo + desloc;
    const yAjustado = Math.round((y - desloc) / passo) * passo + desloc;
    return { x: xAjustado, y: yAjustado };
  };

  const obterPos = (event) => {
    const canvas = canvasRef.current;
    if (canvas) {
      // Atualiza dimensoes do croqui a partir do canvas real (especialmente no mobile 1400x800).
      croquiDimRef.current = { w: canvas.width, h: canvas.height };
    }
    // Define a base de coordenadas apenas uma vez por croqui (ate limpar).
    if (canvas && (!coordsBaseRef.current?.w || !coordsBaseRef.current?.h)) {
      coordsBaseRef.current = { w: canvas.width, h: canvas.height };
    }
    const rect = canvas.getBoundingClientRect();
    const escalaX = canvas.width / rect.width;
    const escalaY = canvas.height / rect.height;
    const xCanvas = (event.clientX - rect.left) * escalaX;
    const yCanvas = (event.clientY - rect.top) * escalaY;

    const baseW = Number(coordsBaseRef.current?.w) || canvas.width;
    const baseH = Number(coordsBaseRef.current?.h) || canvas.height;
    const xBase = xCanvas * (baseW / canvas.width);
    const yBase = yCanvas * (baseH / canvas.height);
    return ajustarParaPonto(xBase, yBase);
  };

  const centroShape = (shape) => {
    if (shape?.labelPos && typeof shape.labelPos.x === "number" && typeof shape.labelPos.y === "number") {
      return shape.labelPos;
    }
    if (shape.tipo === "BUEIRO") return { x: shape.x, y: shape.y };
    if (shape.tipo === "MEIO_FIO" || shape.tipo === "CALCADA") {
      return { x: (shape.de.x + shape.ate.x) / 2, y: (shape.de.y + shape.ate.y) / 2 };
    }

    const pts = Array.isArray(shape.pontos) ? shape.pontos : [];
    // Se por algum motivo nao houver pontos (corrida de state no mobile),
    // colocamos o texto no centro do croqui em vez do cantinho.
    if (!pts.length) {
      const w = croquiDimRef.current?.w || 1400;
      const h = croquiDimRef.current?.h || 800;
      return { x: w / 2, y: h / 2 };
    }

    // Melhor que a media dos pontos: o usuario costuma desenhar o contorno,
    // entao o centro visual fica mais fiel usando o "bounding box".
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    pts.forEach((p) => {
      if (!p) return;
      if (typeof p.x === "number") {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
      }
      if (typeof p.y === "number") {
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    });

    if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
      const x = pts.reduce((acc, p) => acc + (p?.x || 0), 0) / pts.length;
      const y = pts.reduce((acc, p) => acc + (p?.y || 0), 0) / pts.length;
      return { x, y };
    }

    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  };

  const desenharBase = (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#f8fafd";
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "#d3deea";
    for (let y = 12; y < h; y += 14) {
      for (let x = 12; x < w; x += 14) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const centroY = h / 2;
    ctx.strokeStyle = "#ffcd00";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(20, centroY);
    ctx.lineTo(w - 20, centroY);
    ctx.stroke();

    // Ponta da faixa amarela (seta) apontando para a esquerda.
    const headLen = 18;
    const setaX = 20;
    ctx.fillStyle = "#ffcd00";
    ctx.beginPath();
    ctx.moveTo(setaX, centroY); // ponta (esquerda)
    ctx.lineTo(setaX + headLen, centroY - 9);
    ctx.lineTo(setaX + headLen, centroY + 9);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#8ca0b7";
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, w - 20, h - 20);

  };

  const desenharShapes = (ctx, shapesParaDesenhar = shapes, linhaInicioParaDesenhar = linhaInicio) => {
    const baseW = Number(coordsBaseRef.current?.w) || Number(croquiDimRef.current?.w) || ctx.canvas.width || 1400;
    const baseH = Number(coordsBaseRef.current?.h) || Number(croquiDimRef.current?.h) || ctx.canvas.height || 800;
    const sx = (ctx.canvas.width || baseW) / baseW;
    const sy = (ctx.canvas.height || baseH) / baseH;
    const escalaMedia = Math.max(0.75, Math.min(1.6, (sx + sy) / 2));
    const px = (x) => Number(x || 0) * sx;
    const py = (y) => Number(y || 0) * sy;
    const p = (pt) => ({ x: px(pt?.x), y: py(pt?.y) });

    const desenharBueiro = (shape) => {
      // Simbolo simples de bueiro (grelha) para ficar mais "visual" que um circulo.
      const x = px(shape.x);
      const y = py(shape.y);
      const w = 28;
      const h = 18;
      const r = 5;

      ctx.save();
      ctx.strokeStyle = "#198754";
      ctx.fillStyle = "#e9f7ef";
      ctx.lineWidth = 2;

      // Rounded rect
      ctx.beginPath();
      ctx.moveTo(x - w / 2 + r, y - h / 2);
      ctx.lineTo(x + w / 2 - r, y - h / 2);
      ctx.quadraticCurveTo(x + w / 2, y - h / 2, x + w / 2, y - h / 2 + r);
      ctx.lineTo(x + w / 2, y + h / 2 - r);
      ctx.quadraticCurveTo(x + w / 2, y + h / 2, x + w / 2 - r, y + h / 2);
      ctx.lineTo(x - w / 2 + r, y + h / 2);
      ctx.quadraticCurveTo(x - w / 2, y + h / 2, x - w / 2, y + h / 2 - r);
      ctx.lineTo(x - w / 2, y - h / 2 + r);
      ctx.quadraticCurveTo(x - w / 2, y - h / 2, x - w / 2 + r, y - h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // "Grelha" interna
      ctx.strokeStyle = "#198754";
      ctx.lineWidth = 1.2;
      for (let i = -8; i <= 8; i += 4) {
        ctx.beginPath();
        ctx.moveTo(x + i, y - 6);
        ctx.lineTo(x + i, y + 6);
        ctx.stroke();
      }

      ctx.font = "bold 10px Arial";
      ctx.fillStyle = "#198754";
      ctx.fillText(shape.rotulo || "B", x - 5, y + 3);
      ctx.restore();
    };

    const desenharFaixaCalcada = (shape) => {
      const de = p(shape.de);
      const ate = p(shape.ate);
      const dx = ate.x - de.x;
      const dy = ate.y - de.y;
      const len = Math.hypot(dx, dy);
      if (!len) return;

      const tx = dx / len;
      const ty = dy / len;
      let nx = -ty;
      let ny = tx;

      // A calçada/meio-fio deve ficar sempre voltada para o centro da pista,
      // independentemente do sentido que o usuário desenhou (de -> até).
      const meioX = (de.x + ate.x) / 2;
      const meioY = (de.y + ate.y) / 2;
      const vx = (ctx.canvas.width / 2) - meioX;
      const vy = (ctx.canvas.height / 2) - meioY;
      const dot = (nx * vx) + (ny * vy);
      if (dot < 0) {
        nx *= -1;
        ny *= -1;
      }

      const larguraCalcada = 14 * escalaMedia;

      const p1 = { x: de.x, y: de.y };
      const p2 = { x: ate.x, y: ate.y };
      const p3 = { x: ate.x + nx * larguraCalcada, y: ate.y + ny * larguraCalcada };
      const p4 = { x: de.x + nx * larguraCalcada, y: de.y + ny * larguraCalcada };

      ctx.fillStyle = "#e7ebf2";
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.lineTo(p4.x, p4.y);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "#798ba3";
      ctx.lineWidth = 1.3;
      ctx.stroke();

      ctx.strokeStyle = "#b2bdcc";
      ctx.lineWidth = 1 * escalaMedia;
      for (let i = 0; i <= len; i += (10 * escalaMedia)) {
        const bx = de.x + tx * i;
        const by = de.y + ty * i;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + nx * larguraCalcada, by + ny * larguraCalcada);
        ctx.stroke();
      }
    };

    (shapesParaDesenhar || []).forEach((shape) => {
      if (shape.tipo === "LIVRE") {
        ctx.strokeStyle = "#c10000";
        ctx.lineWidth = 2;
        ctx.beginPath();
        shape.pontos.forEach((p, idx) => {
          const sp = { x: px(p.x), y: py(p.y) };
          if (idx === 0) ctx.moveTo(sp.x, sp.y);
          else ctx.lineTo(sp.x, sp.y);
        });
        ctx.stroke();
      }

      if (shape.tipo === "MEIO_FIO") {
        ctx.strokeStyle = "#0f9d58";
        ctx.lineWidth = 3.2 * escalaMedia;
        ctx.beginPath();
        ctx.moveTo(px(shape.de?.x), py(shape.de?.y));
        ctx.lineTo(px(shape.ate?.x), py(shape.ate?.y));
        ctx.stroke();
      }

      if (shape.tipo === "CALCADA") {
        desenharFaixaCalcada(shape);
      }

      if (shape.tipo === "BUEIRO") {
        desenharBueiro(shape);
      }

      if (shape.identificacaoPonto) {
        const centroBase = centroShape(shape);
        const centro = { x: px(centroBase.x), y: py(centroBase.y) };
        const textoId = shape.identificacaoVisual || formatarIdentificacaoVisual(shape.identificacaoPonto, shape.tipoItem, shape.itemId);

        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.font = "bold 10px Arial";
        ctx.fillStyle = "#111";
        ctx.fillText(textoId, centro.x, centro.y - 8);

        if (Array.isArray(shape.medidasLinhas) && shape.medidasLinhas.length) {
          ctx.font = "9px Arial";
          ctx.fillStyle = "#333";
          shape.medidasLinhas.forEach((linha, idx) => {
            ctx.fillText(linha, centro.x, centro.y + 8 + (idx * 11));
          });
        }

        ctx.restore();
      }
    });

    if (linhaInicioParaDesenhar) {
      ctx.fillStyle = "#1f4f99";
      ctx.beginPath();
      ctx.arc(px(linhaInicioParaDesenhar.x), py(linhaInicioParaDesenhar.y), 4, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const desenharCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    // Mantem o ultimo tamanho real do canvas onde os pontos foram capturados,
    // para renderizar o croqui com a mesma escala no PDF (mesmo quando o canvas some no mobile).
    croquiDimRef.current = { w: canvas.width, h: canvas.height };
    // Se ainda nao existe base definida (ex.: desktop abrindo antes de desenhar), define aqui.
    if (!coordsBaseRef.current?.w || !coordsBaseRef.current?.h) {
      coordsBaseRef.current = { w: canvas.width, h: canvas.height };
    }
    desenharBase(ctx, canvas.width, canvas.height);
    desenharShapes(ctx, shapes, linhaInicio);
  };

  const gerarCroquiDataUrl = ({ force = false } = {}) => {
    // Gera imagem do croqui mesmo se o canvas nao estiver montado (mobile / tela cheia fechada).
    // Importante: salva compactado (JPEG) para nao estourar limite de tamanho do Firestore.
    // Regra de ouro: se ja temos um snapshot capturado do canvas real, usamos ele (fica 1:1 com o que o apontador viu).
    if (!force) {
      if (croquiSnapshotRef.current) return croquiSnapshotRef.current;
      if (croquiSnapshot) return croquiSnapshot;
    }

    const gerarCanvasCroqui = () => {
      const w = Number(coordsBaseRef.current?.w) || Number(croquiDimRef.current?.w) || 1100;
      const h = Number(coordsBaseRef.current?.h) || Number(croquiDimRef.current?.h) || 628;
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const ctx = off.getContext("2d");
      desenharBase(ctx, w, h);
      desenharShapes(ctx, shapesRef.current || [], null);
      return off;
    };

    try {
      const canvas = canvasRef.current;
      if (canvas) {
        // Se o canvas esta na tela, usar o bitmap dele (fica igual ao que foi desenhado).
        return canvas.toDataURL("image/jpeg", 0.85);
      }
    } catch (e) {
      // segue para o offscreen
    }

    try {
      const src = gerarCanvasCroqui();
      // Reduz um pouco (principalmente quando o croqui foi feito em 1400x800 no mobile),
      // para diminuir o tamanho do base64 no banco.
      const maxW = 1100;
      const maxH = 600;
      const escala = Math.min(1, maxW / src.width, maxH / src.height);
      const dst = document.createElement("canvas");
      dst.width = Math.max(1, Math.round(src.width * escala));
      dst.height = Math.max(1, Math.round(src.height * escala));
      const dctx = dst.getContext("2d");
      dctx.drawImage(src, 0, 0, dst.width, dst.height);
      return dst.toDataURL("image/jpeg", 0.85);
    } catch (e) {
      return "";
    }
  };

  const formatoImagemDataUrl = (dataUrl) => {
    const txt = String(dataUrl || "");
    if (txt.startsWith("data:image/jpeg")) return "JPEG";
    if (txt.startsWith("data:image/jpg")) return "JPEG";
    return "PNG";
  };

  const onPointerDown = (event) => {
    const pos = obterPos(event);
    const baseShapes = (Array.isArray(shapesRef.current) && shapesRef.current.length) ? shapesRef.current : shapes;

    if (ferramenta === "BUEIRO") {
      const indice = baseShapes.filter((s) => s.tipo === "BUEIRO").length + 1;
      const novoShape = { id: shapeIdRef.current++, tipo: "BUEIRO", rotulo: `B${indice}`, ...pos };
      const novo = [...baseShapes, novoShape];
      shapesRef.current = novo;
      lastCreatedShapeIdRef.current = novoShape.id;
      croquiRevRef.current += 1;
      setShapes(novo);
      return;
    }

    if (ferramenta === "MEIO_FIO" || ferramenta === "CALCADA") {
      if (!linhaInicio) {
        linhaInicioRef.current = pos;
        setLinhaInicio(pos);
      } else {
        const novoShape = { id: shapeIdRef.current++, tipo: ferramenta, de: linhaInicioRef.current || linhaInicio, ate: pos };
        const novo = [...baseShapes, novoShape];
        shapesRef.current = novo;
        lastCreatedShapeIdRef.current = novoShape.id;
        croquiRevRef.current += 1;
        setShapes(novo);
        linhaInicioRef.current = null;
        setLinhaInicio(null);
      }
      return;
    }

    if (ferramenta === "LIVRE") {
      setDesenhando(true);
      const novoShape = { id: shapeIdRef.current++, tipo: "LIVRE", pontos: [pos] };
      const novo = [...baseShapes, novoShape];
      shapesRef.current = novo;
      lastCreatedShapeIdRef.current = novoShape.id;
      croquiRevRef.current += 1;
      setShapes(novo);
    }
  };

  const onPointerMove = (event) => {
    if (!desenhando || ferramenta !== "LIVRE") return;
    const pos = obterPos(event);
    const baseShapes = (Array.isArray(shapesRef.current) && shapesRef.current.length) ? shapesRef.current : shapes;
    const copia = [...baseShapes];
    const ultimo = copia[copia.length - 1];
    if (!ultimo || ultimo.tipo !== "LIVRE") return;
    ultimo.pontos = [...(ultimo.pontos || []), pos];
    shapesRef.current = copia;
    croquiRevRef.current += 1;
    setShapes(copia);
  };

  const onPointerUp = () => {
    if (desenhando) setDesenhando(false);
    croquiRevRef.current += 1;
    agendarSnapshotCroqui();
  };

  const restaurarOrientacaoPadrao = async () => {
    // Em alguns celulares, o lock de orientacao fica "grudado" se sair da tela sem apertar voltar.
    // Por isso fazemos cleanup em 3 etapas: sair do fullscreen e desbloquear orientacao.
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch (e) {
      // ignore
    }
    try {
      if (window.screen?.orientation?.unlock) {
        window.screen.orientation.unlock();
      }
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    // Garante que a orientacao nao fica travada quando sair desta tela (ou recarregar a pagina).
    const onHide = () => {
      restaurarOrientacaoPadrao();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      restaurarOrientacaoPadrao();
    };
  }, []);

  const limparCroqui = () => {
    setShapes([]);
    shapesRef.current = [];
    croquiRevRef.current += 1;
    setLinhaInicio(null);
    setItensCroqui([]);
    setCroquiSnapshot("");
    croquiSnapshotRef.current = "";
    lastCreatedShapeIdRef.current = null;
    coordsBaseRef.current = { w: null, h: null };
  };

  const abrirEdicaoRegistroCabecalho = (registro) => {
    if (!registro?.id) return;
    setEditRegistroId(registro.id);
    setEditLogradouro(String(registro.logradouro || registro.rua || "").trim());
    setEditBairro(String(registro.bairro || "").trim());
    setEditApontador(String(registro.apontador || "").trim());
  };

  const cancelarEdicaoRegistroCabecalho = () => {
    setEditRegistroId(null);
    setEditLogradouro("");
    setEditBairro("");
    setEditApontador("");
    setSalvandoEdicaoRegistro(false);
  };

  const salvarEdicaoRegistroCabecalho = async () => {
    if (!editRegistroId) return;
    const log = String(editLogradouro || "").trim().toUpperCase();
    const bai = String(editBairro || "").trim().toUpperCase();
    const apo = String(editApontador || "").trim().toUpperCase();
    if (!log || !bai || !apo) {
      alert("Preencha logradouro, bairro e apontador.");
      return;
    }
    setSalvandoEdicaoRegistro(true);
    try {
      await updateDoc(doc(db, "producaoCampo", editRegistroId), withTenant({
        // Mantemos os 2 campos por compatibilidade (registros antigos usam "rua").
        logradouro: log,
        rua: log,
        bairro: bai,
        localizacao: bai,
        apontador: apo,
        atualizadoEm: new Date().toISOString()
      }, tenantId));
      await registrarHistorico({
        modulo: "PRODUCAO_CAMPO",
        acao: "EDITOU",
        entidade: "PRODUCAO_CROQUI",
        registroId: editRegistroId,
        usuario: apo,
        descricao: "Editou cabecalho do registro (logradouro/bairro/apontador).",
        detalhes: { rua: log, bairro: bai }
      });
      alert("Cabecalho atualizado.");
      cancelarEdicaoRegistroCabecalho();
      carregarTudo();
    } catch (e) {
      alert(`Falha ao editar registro. Detalhes: ${String(e?.message || e || "")}`);
      setSalvandoEdicaoRegistro(false);
    }
  };

  const excluirRegistro = async (registro) => {
    if (!registro?.id) return;
    const ok = window.confirm("Excluir este registro de producao/croqui? Essa acao nao pode ser desfeita.");
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "producaoCampo", registro.id));
      await registrarHistorico({
        modulo: "PRODUCAO_CAMPO",
        acao: "EXCLUIU",
        entidade: "PRODUCAO_CROQUI",
        registroId: registro.id,
        usuario: String(apontadorLogado || registro.apontador || "").trim(),
        descricao: "Excluiu um registro de producao/croqui.",
        detalhes: { data: registro.data, obra: registro.obra, rua: registro.rua, bairro: registro.bairro }
      });
      carregarTudo();
    } catch (e) {
      alert(`Falha ao excluir. Detalhes: ${String(e?.message || e || "")}`);
    }
  };

  const desfazerCroqui = () => {
    setShapes((ant) => {
      const novo = ant.slice(0, -1);
      shapesRef.current = novo;
      croquiRevRef.current += 1;
      lastCreatedShapeIdRef.current = novo.length ? novo[novo.length - 1].id : null;
      return novo;
    });
    setLinhaInicio(null);
  };

  const vincularItemAoUltimoDesenho = async () => {
    if (editandoItemId) {
      alert("Voce esta editando um item. Use o botao 'Re-vincular ao ultimo desenho (GPS)' ou clique em 'Salvar edicao' / 'Cancelar edicao'.");
      return;
    }

    // No celular, o state de shapes pode estar 1 frame atras. Preferimos o ref atualizado pelos eventos do dedo.
    const shapesAtuais = Array.isArray(shapesRef.current) && shapesRef.current.length ? shapesRef.current : shapes;

    if (!shapesAtuais.length) {
      alert("Faca um desenho no croqui antes de vincular o item.");
      return;
    }
    if (itensCroqui.length >= MAX_ITENS_POR_FOLHA) {
      alert("Este lancamento atingiu 15 itens (somando RP/TB/RC/TS, bueiro, calcada, meio-fio, etc). Salve e abra um novo para continuar.");
      return;
    }

    // Regra de ouro: so pode vincular em um desenho que ainda NAO tem item.
    // Assim, se o usuario esquecer de desenhar, ele nao sobrescreve o RP anterior (vale ate 15 itens).
    const alvo = [...shapesAtuais].reverse().find((s) => s && (s.itemId == null) && !s.identificacaoPonto);
    if (!alvo) {
      alert("Nao existe desenho disponivel para vincular. Faca um novo desenho no croqui antes de vincular o proximo item (RP/TB/RC/TS, bueiro, calcada, meio-fio, etc).");
      return;
    }
    const idFinal = sugestaoIdentificacao;
    const tipoAtual = String(tipoItem || "").toUpperCase();
    if (tipoAtual === "OUTRO" && !String(outroServico || "").trim()) {
      alert("Informe o nome do servico quando o tipo for Outro (OT).");
      return;
    }
    const itemBueiro = tipoAtual === "BUEIRO";
    const itemCalcada = tipoAtual === "CALCADA";
    const itemMeioFio = tipoAtual === "MEIO_FIO";
    const itemEscavacao = !itemBueiro && !itemCalcada && !itemMeioFio;
    const identificacaoVisual = formatarIdentificacaoVisual(idFinal, tipoAtual, itemIdRef.current);
    const labelPos = centroShape(alvo);

    // No celular, exige GPS para garantir que o apontador esta no local do croqui.
    const geo = await capturarGeoSeMobile();
    if (isMobile && !geo) {
      alert("Nao foi possivel capturar a localizacao (GPS). Ative o GPS e permita o acesso a localizacao para vincular o item.");
      return;
    }
    const item = {
      itemId: itemIdRef.current++,
      shapeId: alvo.id,
      tipoItem: tipoAtual,
      ladoExecucao: itemBueiro ? "" : ladoExecucao,
      identificacaoPonto: idFinal,
      profundidade: itemEscavacao ? numero(profundidade) : 0,
      largura: itemEscavacao ? numero(largura) : 0,
      comprimento: itemBueiro ? 0 : numero(comprimento),
      volumeEscavado: itemEscavacao ? numero(profundidade) * numero(largura) * numero(comprimento) : 0,
      metragemExecutada: itemCalcada || itemMeioFio ? numero(comprimento) : 0,
      referenciaInicio: referenciaInicio.trim().toUpperCase(),
      referenciaFim: referenciaFim.trim().toUpperCase(),
      qtdBueiro: itemBueiro ? numero(qtdBueiro) : 0,
      diametroBueiro: itemBueiro ? String(diametroBueiro || "").trim() : "",
      observacao: observacao.trim(),
      outroServico: tipoAtual === "OUTRO" ? String(outroServico || "").trim().toUpperCase() : "",
      identificacaoVisual,
      geo
    };

    setItensCroqui((ant) => [...ant, item]);
    // IMPORTANTE (mobile): sempre partir da lista completa (ref) e cair no state apenas como fallback.
    setShapes((prev) => {
      const base = escolherShapesMaisCompleto(shapesRef.current, shapesAtuais, prev);
      const novo = base.map((shape) =>
        shape.id === alvo.id
          ? {
              ...shape,
              itemId: item.itemId,
              tipoItem: item.tipoItem,
              identificacaoPonto: item.identificacaoPonto,
              identificacaoVisual: item.identificacaoVisual,
              medidasLinhas: linhasMedidasItem(item),
              labelPos
            }
          : shape
      );
      shapesRef.current = novo;
      return novo;
    });

    limparFormularioItem();

    // Nao mexemos em orientacao aqui: o croqui fica sempre em retrato no celular.
  };

  const aplicarEdicaoNoItem = ({ atual, novoItem, shapeIdNovo, labelPosNovo, shapesAtuais }) => {
    setItensCroqui((ant) => ant.map((i) => (i.itemId === atual.itemId ? novoItem : i)));
    setShapes((prev) => {
      const base = escolherShapesMaisCompleto(shapesRef.current, shapesAtuais, prev);
      const novo = base.map((shape) => {
        if (!shape) return shape;

        // Regra de ouro: 1 item nao pode ficar marcado em 2 desenhos.
        // Se por corrida anterior o mesmo item estiver em outro shape, limpamos aqui.
        if (shape.itemId === novoItem.itemId && shape.id !== shapeIdNovo) {
          return { ...shape, itemId: null, tipoItem: null, identificacaoPonto: null, identificacaoVisual: null, medidasLinhas: null, labelPos: null };
        }

        // Se mudou o vinculo, so limpa o shape antigo se ele realmente era deste item.
        if (atual.shapeId && shape.id === atual.shapeId && atual.shapeId !== shapeIdNovo && shape.itemId === atual.itemId) {
          return { ...shape, itemId: null, tipoItem: null, identificacaoPonto: null, identificacaoVisual: null, medidasLinhas: null, labelPos: null };
        }

        if (shape.id === shapeIdNovo) {
          return {
            ...shape,
            itemId: novoItem.itemId,
            tipoItem: novoItem.tipoItem,
            identificacaoPonto: novoItem.identificacaoPonto,
            identificacaoVisual: novoItem.identificacaoVisual,
            medidasLinhas: linhasMedidasItem(novoItem),
            labelPos: labelPosNovo || shape.labelPos || null
          };
        }

        return shape;
      });

      shapesRef.current = novo;
      return novo;
    });

    // Forca redesenho/snapshot (no celular pode estar 1 frame atras).
    setTimeout(() => {
      try {
        desenharCanvas();
        const canvas = canvasRef.current;
        if (canvas) {
          definirSnapshotCroqui(canvas.toDataURL("image/jpeg", 0.85));
        } else {
          agendarSnapshotCroqui();
        }
      } catch (e) {
        // ignore
      }
    }, 80);
  };

  const salvarEdicaoItem = () => {
    if (!editandoItemId) return;
    const atual = itensCroqui.find((i) => i.itemId === editandoItemId);
    if (!atual) {
      cancelarEdicaoItem();
      return;
    }

    const idFinal = (identificacaoPonto || "").trim().toUpperCase() || atual.identificacaoPonto || sugestaoIdentificacao;
    const tipoAtual = String(tipoItem || "").toUpperCase();
    if (tipoAtual === "OUTRO" && !String(outroServico || "").trim()) {
      alert("Informe o nome do servico quando o tipo for Outro (OT).");
      return;
    }

    const itemBueiro = tipoAtual === "BUEIRO";
    const itemCalcada = tipoAtual === "CALCADA";
    const itemMeioFio = tipoAtual === "MEIO_FIO";
    const itemEscavacao = !itemBueiro && !itemCalcada && !itemMeioFio;

    const identificacaoVisual = formatarIdentificacaoVisual(idFinal, tipoAtual, atual.itemId);
    const shapesAtuais = Array.isArray(shapesRef.current) && shapesRef.current.length ? shapesRef.current : shapes;

    // Salvar edicao NORMAL: nao mexe no desenho (isso evita ir para o desenho errado).
    const shapeIdNovo = atual.shapeId;
    const shapeNovo = shapesAtuais.find((s) => s?.id === shapeIdNovo) || null;
    const labelPosNovo = shapeNovo ? centroShape(shapeNovo) : null;

    const novoItem = {
      ...atual,
      shapeId: shapeIdNovo,
      tipoItem: tipoAtual,
      ladoExecucao: itemBueiro ? "" : ladoExecucao,
      identificacaoPonto: idFinal,
      profundidade: itemEscavacao ? numero(profundidade) : 0,
      largura: itemEscavacao ? numero(largura) : 0,
      comprimento: itemBueiro ? 0 : numero(comprimento),
      volumeEscavado: itemEscavacao ? numero(profundidade) * numero(largura) * numero(comprimento) : 0,
      metragemExecutada: itemCalcada || itemMeioFio ? numero(comprimento) : 0,
      referenciaInicio: referenciaInicio.trim().toUpperCase(),
      referenciaFim: referenciaFim.trim().toUpperCase(),
      qtdBueiro: itemBueiro ? numero(qtdBueiro) : 0,
      diametroBueiro: itemBueiro ? String(diametroBueiro || "").trim() : "",
      observacao: observacao.trim(),
      outroServico: tipoAtual === "OUTRO" ? String(outroServico || "").trim().toUpperCase() : "",
      identificacaoVisual
    };

    aplicarEdicaoNoItem({ atual, novoItem, shapeIdNovo, labelPosNovo, shapesAtuais });

    cancelarEdicaoItem();
  };

  const revincularEdicaoAoUltimoDesenho = async () => {
    if (!editandoItemId) return;
    const atual = itensCroqui.find((i) => i.itemId === editandoItemId);
    if (!atual) return;

    const shapesAtuais = Array.isArray(shapesRef.current) && shapesRef.current.length ? shapesRef.current : shapes;
    if (!shapesAtuais.length) {
      alert("Faca um desenho no croqui antes de re-vincular.");
      return;
    }

    // REGRA FORTE (campo): para evitar sobrescrever itens antigos (ex.: corrigir o 7 e apagar o 6),
    // o re-vinculo so pode acontecer em um desenho NOVO, criado DURANTE esta edicao e que ainda esta sem item.
    const seqInicio = Number(editStartShapeSeqRef.current || 0);
    const criadosNaEdicao = shapesAtuais
      .filter((s) => s && typeof s.id === "number" && s.id >= seqInicio);
    const candidatos = [...criadosNaEdicao].reverse().filter((s) => (s.itemId == null) && !s.identificacaoPonto);
    const shapeNovo = candidatos.length ? candidatos[0] : null;
    if (!shapeNovo) {
      alert("Para re-vincular, faca um NOVO desenho no croqui (durante a edicao) e depois clique em Re-vincular (GPS).");
      return;
    }
    const shapeIdNovo = shapeNovo?.id;
    if (!shapeIdNovo) {
      alert("Nao foi possivel identificar o ultimo desenho.");
      return;
    }

    // Captura GPS novamente (campo): o apontador vai para cima do ponto e re-vincula.
    const geo = await capturarGeoSeMobile();
    if (isMobile && !geo) {
      alert("Nao foi possivel capturar a localizacao (GPS). Ative o GPS e permita o acesso a localizacao para re-vincular.");
      return;
    }

    // Monta o item com os valores atuais do formulario (se o usuario corrigiu numeracao/medidas etc).
    const idFinal = (identificacaoPonto || "").trim().toUpperCase() || atual.identificacaoPonto || sugestaoIdentificacao;
    const tipoAtual = String(tipoItem || "").toUpperCase();
    if (tipoAtual === "OUTRO" && !String(outroServico || "").trim()) {
      alert("Informe o nome do servico quando o tipo for Outro (OT).");
      return;
    }

    const itemBueiro = tipoAtual === "BUEIRO";
    const itemCalcada = tipoAtual === "CALCADA";
    const itemMeioFio = tipoAtual === "MEIO_FIO";
    const itemEscavacao = !itemBueiro && !itemCalcada && !itemMeioFio;

    const identificacaoVisual = formatarIdentificacaoVisual(idFinal, tipoAtual, atual.itemId);
    const novoItem = {
      ...atual,
      shapeId: shapeIdNovo,
      tipoItem: tipoAtual,
      ladoExecucao: itemBueiro ? "" : ladoExecucao,
      identificacaoPonto: idFinal,
      profundidade: itemEscavacao ? numero(profundidade) : 0,
      largura: itemEscavacao ? numero(largura) : 0,
      comprimento: itemBueiro ? 0 : numero(comprimento),
      volumeEscavado: itemEscavacao ? numero(profundidade) * numero(largura) * numero(comprimento) : 0,
      metragemExecutada: itemCalcada || itemMeioFio ? numero(comprimento) : 0,
      referenciaInicio: referenciaInicio.trim().toUpperCase(),
      referenciaFim: referenciaFim.trim().toUpperCase(),
      qtdBueiro: itemBueiro ? numero(qtdBueiro) : 0,
      diametroBueiro: itemBueiro ? String(diametroBueiro || "").trim() : "",
      observacao: observacao.trim(),
      outroServico: tipoAtual === "OUTRO" ? String(outroServico || "").trim().toUpperCase() : "",
      identificacaoVisual,
      geo
    };

    const labelPosNovo = centroShape(shapeNovo);
    aplicarEdicaoNoItem({ atual, novoItem, shapeIdNovo, labelPosNovo, shapesAtuais });
    cancelarEdicaoItem();
  };

  const excluirItem = (item) => {
    if (!item) return;
    const confirmar = window.confirm(`Excluir o item ${formatarIdentificacaoVisual(item.identificacaoPonto, item.tipoItem, item.itemId)}?`);
    if (!confirmar) return;

    setItensCroqui((ant) => ant.filter((i) => i.itemId !== item.itemId));
    setShapes((prev) => {
      const base = escolherShapesMaisCompleto(shapesRef.current, prev);
      const novo = base.map((shape) =>
        shape.id === item.shapeId
          ? { ...shape, itemId: null, tipoItem: null, identificacaoPonto: null, identificacaoVisual: null, medidasLinhas: null, labelPos: null }
          : shape
      );
      shapesRef.current = novo;
      return novo;
    });
    if (editandoItemId === item.itemId) cancelarEdicaoItem();
  };

  const removerUltimoItem = () => {
    if (!itensCroqui.length) return;
    const ultimo = itensCroqui[itensCroqui.length - 1];
    setItensCroqui((ant) => ant.slice(0, -1));
    setShapes((prev) => {
      const base = escolherShapesMaisCompleto(shapesRef.current, prev);
      const novo = base.map((shape) =>
        shape.itemId === ultimo.itemId
          ? { ...shape, itemId: null, tipoItem: null, identificacaoPonto: null, medidasTexto: null, labelPos: null }
          : shape
      );
      shapesRef.current = novo;
      return novo;
    });
  };

  const salvarProducao = async () => {
    if (!obra || !rua.trim() || !bairro.trim() || !apontador.trim()) {
      alert("Preencha obra, logradouro, bairro e apontador.");
      return;
    }
    if (!itensCroqui.length) {
      alert("Vincule pelo menos 1 item (RP/TB/RC/Meio-fio/Calcada) ao desenho antes de salvar.");
      return;
    }

    const norm = (v) => String(v || "").trim().toUpperCase();
    const folhaGrupo = `${data}|${norm(obra)}|${norm(rua)}|${norm(bairro)}|${norm(apontador)}`;
    const folhasExistentes = lista.filter((r) => {
      if (!r) return false;
      return (
        String(r.data || "") === String(data || "")
        && norm(r.obra) === norm(obra)
        && norm(r.rua) === norm(rua)
        && norm(r.bairro) === norm(bairro)
        && norm(r.apontador) === norm(apontador)
      );
    }).length;
    const folhaNumero = folhasExistentes + 1;

    // Preferir o snapshot (capturado do canvas real) para manter exatamente a escala do desenho.
    // Usar ref para evitar "corrida" de state no mobile (fechar tela cheia + salvar rapido).
    const croquiBase64 = croquiSnapshotRef.current || croquiSnapshot || gerarCroquiDataUrl() || "";

    try {
      const ref = await addDoc(collection(db, "producaoCampo"), withTenant({
        data,
        obra,
        rua: rua.trim().toUpperCase(),
        bairro: bairro.trim().toUpperCase(),
        localizacao: bairro.trim().toUpperCase(),
        apontador: apontador.trim().toUpperCase(),
        folhaGrupo,
        folhaNumero,
        itensCroqui,
        croqui: croquiBase64,
        criadoEm: new Date().toISOString()
      }, tenantId));
      await registrarHistorico({
        modulo: "PRODUCAO_CAMPO",
        acao: "CRIOU",
        entidade: "PRODUCAO_CROQUI",
        registroId: ref.id,
        usuario: apontador,
        descricao: `Lancamento de producao no logradouro ${rua} (${obra}).`,
        detalhes: { itens: itensCroqui.length, bairro }
      });

      alert("Producao de campo salva com sucesso.");
    } catch (e) {
      console.log("Falha ao salvar producao de campo:", e);
      const msg = String(e?.message || e || "");
      if (msg.toLowerCase().includes("too large") || msg.toLowerCase().includes("larger than")) {
        alert("Falha ao salvar: o croqui ficou muito grande. Tente novamente (o sistema vai compactar o croqui) ou use um desenho menor.");
      } else {
        alert(`Falha ao salvar a producao de campo. Detalhes: ${msg || "erro desconhecido"}`);
      }
      return;
    }

    setData(hojeISO);
    setObra("");
    setRua("");
    setBairro("");
    setApontador(apontadorLogado || "");
    setTipoItem("RP");
    setLadoExecucao("DIREITO");
    setIdentificacaoPonto("");
    setProfundidade("");
    setLargura("");
    setComprimento("");
    setReferenciaInicio("");
    setReferenciaFim("");
    setQtdBueiro("");
    setDiametroBueiro("");
    setObservacao("");
    limparCroqui();
    carregarTudo();
  };

  const listaFiltrada = useMemo(() => {
    return lista.filter((item) => {
      if (filtroData && item.data !== filtroData) return false;
      if (filtroObra && item.obra !== filtroObra) return false;
      return true;
    });
  }, [lista, filtroData, filtroObra]);

  const desenharCabecalhoPDF = (pdf, larguraPagina, paginaAtual, totalPaginasEstimado = "", logoPdf = "") => {
    if (logoPdf) {
      try {
        pdf.addImage(logoPdf, formatoLogoPdf(logoPdf), 10, 7, 24, 12);
      } catch (e) {
        console.log("Falha ao carregar logo");
      }
    }

    pdf.setFontSize(14);
    pdf.setFont(undefined, "bold");
    pdf.text("RELATORIO DE PRODUCAO DE CAMPO", larguraPagina / 2, 13, { align: "center" });
    if (totalPaginasEstimado) {
      pdf.setFontSize(9);
      pdf.setFont(undefined, "normal");
      pdf.text(`Folha de itens ${paginaAtual}/${totalPaginasEstimado}`, larguraPagina - 10, 18, { align: "right" });
    }
  };

  const abreviarObra = (obraTexto) => {
    const texto = String(obraTexto || "").trim();
    if (!texto) return "-";
    // Preferir o numero (ex: 072) quando existir.
    const matchNumero = texto.match(/\b\d{3}\b/);
    if (matchNumero) return matchNumero[0];
    // Senão, corta para não estourar a margem do PDF.
    const curto = texto.replace(/\s+/g, " ").trim();
    return curto.length > 28 ? `${curto.slice(0, 28)}...` : curto;
  };

  const gerarRelatorioPDFComRegistros = async (registros) => {
    const registrosParaPdf = Array.isArray(registros) ? registros : [];
    if (!registrosParaPdf.length) {
      alert("Nao ha registros para gerar o PDF.");
      return;
    }

    // Retrato: ganha altura e ajuda a manter ate 15 itens em uma unica folha.
    const pdf = new jsPDF("portrait", "mm", "a4");
    const larguraPagina = pdf.internal.pageSize.getWidth();
    const alturaPagina = pdf.internal.pageSize.getHeight();
    const geradoEmTexto = `Gerado em: ${new Date().toLocaleString("pt-BR")}`;
    const logoPdf = await resolverLogoPdf(empresaSistema);
    registrosParaPdf.forEach((registro, idx) => {
      if (idx > 0) pdf.addPage("a4", "portrait");
      desenharCabecalhoPDF(pdf, larguraPagina, idx + 1, registrosParaPdf.length, logoPdf);

      const topoInfo = 22;
      pdf.setDrawColor(200, 210, 225);
      pdf.rect(10, topoInfo, larguraPagina - 20, 22);
      pdf.setFontSize(10);
      pdf.setFont(undefined, "bold");
      pdf.text(
        `Data: ${formatarDataBR(registro.data)}  |  Obra: ${abreviarObra(registro.obra)}  |  Folha: ${String(registro.folhaNumero || 1).padStart(2, "0")}`,
        12,
        topoInfo + 7
      );
      pdf.text(`Logradouro: ${registro.logradouro || registro.rua || "-"}  |  Bairro: ${registro.bairro || "-"}`, 12, topoInfo + 13);
      pdf.text(`Apontador: ${primeiroNome(registro.apontador)}`, 12, topoInfo + 19);

      const areaX = 10;
      const areaY = topoInfo + 24;
      const areaW = larguraPagina - 20;
      // Altura do croqui no PDF (retratro):
      // - A imagem do croqui do celular (1400x800) tem proporcao ~1.75 (W/H).
      // - Se a altura do bloco ficar menor que (areaW / 1.75), o PDF reduz a imagem e ela fica "pequena".
      // - A tabela deve caber em 1 pagina (ate 15 itens). Por isso posicionamos a tabela mais pro fim da folha
      //   e damos ao croqui o maximo de altura disponivel, respeitando o minimo da proporcao.
      const itensRegistro = Array.isArray(registro.itensCroqui) ? registro.itensCroqui : [];
      const proporcaoCroqui = 1400 / 800; // 1.75

      // Altura "igual ao croqui": proporcional a largura disponivel.
      const areaHIdeal = areaW / proporcaoCroqui;

      // Garante que a tabela caiba (ate 15 itens) sem estourar a pagina.
      // Estimativa coerente com o autoTable (fontSize 7, padding pequeno).
      // Se esta estimativa for "conservadora demais", o croqui fica com pouca altura e a imagem
      // acaba sendo reduzida e centralizada, dando a sensacao de que o desenho saiu "pro meio".
      const headH = 5.0;
      const rowH = 3.9;
      const tableH = headH + (Math.max(1, itensRegistro.length) * rowH) + 4.0;
      const margemInferior = 12;
      const maxAreaH = (alturaPagina - margemInferior - tableH) - (areaY + 4);
      const areaH = Math.max(80, Math.min(areaHIdeal, maxAreaH));
      pdf.setDrawColor(180, 190, 205);
      pdf.rect(areaX, areaY, areaW, areaH);

      try {
        if (registro.croqui) {
          // IMPORTANTE: no celular o desenho pode estar bem colado no meio-fio.
          // No PDF, nao podemos CENTRALIZAR nem ESTICAR (distorce e "puxa" visualmente pro meio).
          // Regra: manter proporcao e colar no canto superior esquerdo do quadro.
          const props = pdf.getImageProperties(registro.croqui);
          const escala = Math.min(areaW / props.width, areaH / props.height);
          const imgW = props.width * escala;
          const imgH = props.height * escala;
          pdf.addImage(registro.croqui, formatoImagemDataUrl(registro.croqui), areaX, areaY, imgW, imgH);
        } else {
          pdf.setFontSize(10);
          pdf.setFont(undefined, "normal");
          pdf.text("Croqui nao anexado neste lancamento.", areaX + 4, areaY + 8);
        }
      } catch (e) {
        pdf.setFontSize(10);
        pdf.setFont(undefined, "normal");
        pdf.text("Nao foi possivel renderizar o croqui.", areaX + 4, areaY + 8);
      }

      autoTable(pdf, {
        startY: areaY + areaH + 4,
        theme: "grid",
        margin: { left: areaX, right: areaX },
        tableWidth: areaW,
        head: [["ID", "Tipo", "Lado", "Ref. inicial", "Ref. final", "Detalhes", "GPS (lat,long)", "Observacao"]],
        body: itensRegistro.length
          ? itensRegistro.map((item) => [
            formatarIdentificacaoVisual(item.identificacaoPonto, item.tipoItem, item.itemId),
            formatarTipoItem(item.tipoItem),
            formatarLadoExecucao(item.ladoExecucao),
            item.referenciaInicio || "-",
            item.referenciaFim || "-",
            detalheItem(item),
            formatarGeo(item.geo),
            item.observacao || "-"
          ])
          : [["-", "-", "-", "-", "-", "Sem itens vinculados", "-", "-"]],
        // Compacto para caber ate 15 itens em 1 pagina (especialmente no celular).
        styles: { fontSize: 7, cellPadding: 1.2, overflow: "ellipsize" },
        headStyles: { fillColor: [11, 94, 215], textColor: 255, halign: "center" },
        columnStyles: {
          0: { halign: "center", cellWidth: 18 },
          1: { halign: "center", cellWidth: 14 },
          2: { halign: "center", cellWidth: 16 },
          3: { halign: "center", cellWidth: 20 },
          4: { halign: "center", cellWidth: 20 },
          5: { halign: "left", cellWidth: 30 },
          // GPS: dar mais largura e permitir quebra de linha para mostrar lat/long completas.
          6: { halign: "left", cellWidth: 44, overflow: "linebreak" },
          7: { halign: "left" }
        }
      });
    });

    const totalPaginas = pdf.getNumberOfPages();
    for (let i = 1; i <= totalPaginas; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.text(geradoEmTexto, 10, alturaPagina - 10, { align: "left" });
      pdf.text(`Pagina ${i} de ${totalPaginas}`, larguraPagina - 10, alturaPagina - 10, { align: "right" });
    }

    pdf.save("relatorio_producao_campo.pdf");
    registrarHistorico({
      modulo: "PRODUCAO_CAMPO",
      acao: "GEROU_PDF",
      entidade: "RELATORIO_PRODUCAO",
      registroId: "pdf-producao-campo",
      usuario: apontador || "-",
      descricao: "Gerou PDF de producao de campo."
    });
  };

  const gerarRelatorioPDF = async () => gerarRelatorioPDFComRegistros(listaFiltrada);
  const gerarPdfApenasDoRegistro = async (registro) => gerarRelatorioPDFComRegistros([registro]);

  if (modoRelatorio) {
    return (
      <div style={page}>
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, color: "#10243e" }}>Relatorio - Producao de Campo / Croqui</h2>
          </div>
          <p style={{ margin: "8px 0 0", color: "#4a5c74" }}>
            Filtro de registros e geracao de PDF para impressao (uso administrativo).
          </p>
        </div>

        <div style={{ ...card, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button style={btnSec} onClick={gerarRelatorioPDF}>Gerar relatorio PDF</button>
        </div>

        <div style={card}>
          <h3 style={{ marginTop: 0, color: "#10243e" }}>Relatorio no sistema</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 10 }}>
            <input style={inputBase} type="date" value={filtroData} onChange={(e) => setFiltroData(e.target.value)} />
            <select style={inputBase} value={filtroObra} onChange={(e) => setFiltroObra(e.target.value)}>
              <option value="">Todas as obras</option>
              {obras.map((o) => (
                <option key={o.id || o.nome} value={o.nome}>{o.nome}</option>
              ))}
            </select>
            <button style={btnSec} onClick={() => { setFiltroData(""); setFiltroObra(""); }}>
              Limpar filtros
            </button>
          </div>

          {editRegistroId && (
            <div style={{ border: "1px solid #cfd7e3", borderRadius: 10, padding: 12, marginBottom: 12, background: "#fff" }}>
              <div style={{ fontWeight: 900, color: "#10243e", marginBottom: 8 }}>
                Editar cabecalho do registro
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                <input style={inputBase} value={editLogradouro} onChange={(e) => setEditLogradouro(e.target.value)} placeholder="Logradouro" />
                <input style={inputBase} value={editBairro} onChange={(e) => setEditBairro(e.target.value)} placeholder="Bairro" />
                <input style={inputBase} value={editApontador} onChange={(e) => setEditApontador(e.target.value)} placeholder="Apontador" />
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                <button style={btn} disabled={salvandoEdicaoRegistro} onClick={salvarEdicaoRegistroCabecalho}>
                  {salvandoEdicaoRegistro ? "Salvando..." : "Salvar edicao"}
                </button>
                <button style={btnSec} disabled={salvandoEdicaoRegistro} onClick={cancelarEdicaoRegistroCabecalho}>
                  Cancelar edicao
                </button>
              </div>
            </div>
          )}

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 11 }}>
              <thead style={{ background: "#0b5ed7", color: "#fff" }}>
                <tr>
                {["Data", "Folha", "Obra", "Logradouro", "Bairro", "Apontador", "Itens", "GPS", "IDs", "Croqui", "Acoes"].map((titulo) => (
                  <th key={titulo} style={{ padding: "7px 6px", textAlign: "center" }}>{titulo}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listaFiltrada.map((item, idx) => {
                  const itens = Array.isArray(item.itensCroqui) ? item.itensCroqui : [];
                  const itensComGeo = itens.filter((it) => {
                    const lat = Number(it?.geo?.latitude);
                    const lon = Number(it?.geo?.longitude);
                    return Number.isFinite(lat) && Number.isFinite(lon);
                  });
                  const geoResumo = itensComGeo.length
                    ? `${itensComGeo.length}/${itens.length} | ${formatarGeo(itensComGeo[0].geo)}`
                    : "-";
                  const ids = itens
                    .map((it) => formatarIdentificacaoVisual(it.identificacaoPonto, it.tipoItem, it.itemId))
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <tr key={item.id} style={{ background: idx % 2 === 0 ? "#f8fbff" : "#fff" }}>
                      <td style={{ padding: 6, textAlign: "center" }}>{formatarDataBR(item.data)}</td>
                      <td style={{ padding: 6, textAlign: "center", fontWeight: "bold" }}>{String(item.folhaNumero || 1).padStart(2, "0")}</td>
                      <td style={{ padding: 6, textAlign: "center", wordBreak: "break-word" }}>{item.obra || "-"}</td>
                      <td style={{ padding: 6, textAlign: "center", wordBreak: "break-word" }}>{item.logradouro || item.rua || "-"}</td>
                      <td style={{ padding: 6, textAlign: "center", wordBreak: "break-word" }}>{item.bairro || "-"}</td>
                      <td style={{ padding: 6, textAlign: "center" }}>{primeiroNome(item.apontador)}</td>
                      <td style={{ padding: 6, textAlign: "center", fontWeight: "bold" }}>{itens.length}</td>
                      <td style={{ padding: 6, textAlign: "center", fontSize: 10, wordBreak: "break-word" }}>{geoResumo}</td>
                      <td style={{ padding: 6, textAlign: "center", wordBreak: "break-word" }}>{ids || "-"}</td>
                      <td style={{ padding: 6, textAlign: "center" }}>
                        {item.croqui ? (
                          <img src={item.croqui} alt="Croqui" style={{ width: 90, borderRadius: 4, border: "1px solid #cfd7e3" }} />
                        ) : "-"}
                      </td>
                      <td style={{ padding: 6, textAlign: "center" }}>
                        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                          <button style={{ ...btnSec, padding: "6px 10px" }} onClick={() => gerarPdfApenasDoRegistro(item)}>
                            PDF deste
                          </button>
                          <button
                            style={{ ...btnSec, padding: "6px 10px", background: "#0b5ed7", color: "#fff", borderColor: "#0b5ed7" }}
                            onClick={() => abrirEdicaoRegistroCabecalho(item)}
                          >
                            Editar
                          </button>
                          <button
                            style={{ ...btnSec, padding: "6px 10px", background: "#dc3545", color: "#fff", borderColor: "#dc3545" }}
                            onClick={() => excluirRegistro(item)}
                          >
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!listaFiltrada.length && (
                  <tr>
                    <td colSpan={11} style={{ padding: 10, textAlign: "center", color: "#6c757d" }}>
                      Nenhum registro encontrado.
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

  return (
    <div style={page}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, color: "#10243e" }}>Producao de Campo e Croqui de Rua</h2>
          </div>
        <p style={{ margin: "8px 0 0", color: "#4a5c74" }}>
          Modelo no padrao do croqui manual: rua pontilhada, faixa amarela continua e identificacao RP/TB/Meio-fio.
        </p>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0, color: "#10243e" }}>Cabecalho do lancamento</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          <input style={inputBase} type="date" value={data} onChange={(e) => setData(e.target.value)} />
          <select style={inputBase} value={obra} onChange={(e) => setObra(e.target.value)}>
            <option value="">Selecione a obra</option>
            {obras.map((o) => (
              <option key={o.id || o.nome} value={o.nome}>{o.nome}</option>
            ))}
          </select>
          <input style={inputBase} value={rua} onChange={(e) => setRua(e.target.value)} placeholder="Logradouro" />
          <input style={inputBase} value={bairro} onChange={(e) => setBairro(e.target.value)} placeholder="Bairro" />
          <input
            style={{
              ...inputBase,
              ...(apontadorTravado ? { background: "#eef2f6", cursor: "not-allowed" } : null)
            }}
            value={apontador}
            onChange={apontadorTravado ? undefined : (e) => setApontador(e.target.value)}
            readOnly={apontadorTravado}
            placeholder="Apontador"
          />
        </div>
      </div>

      <div style={card}>
        <h3
          style={{
            margin: "0 0 10px",
            color: "#2f4259",
            fontFamily: "Arial, sans-serif",
            fontSize: 14,
            fontWeight: 700,
            textTransform: "uppercase"
          }}
        >
          CROQUI DA RUA
        </h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {FERRAMENTAS.map((tool) => (
            <button
              key={tool}
              style={{ ...btn, background: ferramenta === tool ? "#0b5ed7" : "#5b6d84" }}
              onClick={() => {
                setFerramenta(tool);
                if (tool === "LIVRE") setTipoItem("RP");
                if (tool === "MEIO_FIO") setTipoItem("MEIO_FIO");
                if (tool === "CALCADA") setTipoItem("CALCADA");
                if (tool === "BUEIRO") setTipoItem("BUEIRO");
              }}
            >
              {tool}
            </button>
          ))}
          <button style={btnSec} onClick={desfazerCroqui}>Desfazer</button>
          <button style={btnSec} onClick={limparCroqui}>Limpar croqui</button>
        </div>

        <div style={{ border: "1px solid #cfd7e3", borderRadius: 8, overflow: "hidden", background: "#f8fbff" }}>
          <div style={{ width: "100%", maxWidth: 1100, aspectRatio: "7 / 4" }}>
            <canvas
              ref={canvasRef}
              width={1100}
              height={628}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair", touchAction: "none" }}
            />
          </div>
        </div>

        <p style={{ fontSize: 12, color: "#4a5c74", marginTop: 8 }}>
          Desenhe primeiro no croqui e depois vincule os dados.
        </p>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0, color: "#10243e" }}>Dados do ponto desenhado (RP/TB/RC/Meio-fio/Calcada)</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
          <select style={inputBase} value={tipoItem} onChange={(e) => setTipoItem(e.target.value)}>
            {TIPOS_ITEM.map((tipo) => (
              <option key={tipo} value={tipo}>{labelTipoItem(tipo)}</option>
            ))}
          </select>
          {String(tipoItem || "").toUpperCase() === "OUTRO" && (
            <input
              style={inputBase}
              value={outroServico}
              onChange={(e) => setOutroServico(e.target.value)}
              placeholder="Informe o servico (Outro)"
            />
          )}
          {!isBueiro && (
            <select style={inputBase} value={ladoExecucao} onChange={(e) => setLadoExecucao(e.target.value)}>
              {LADOS_EXECUCAO.map((lado) => (
                <option key={lado} value={lado}>Lado: {formatarLadoExecucao(lado)}</option>
              ))}
            </select>
          )}
          <input
            style={{
              ...inputBase,
              ...(!editandoItemId ? { background: "#eef2f6", cursor: "not-allowed" } : null)
            }}
            value={identificacaoPonto}
            onChange={!editandoItemId ? undefined : (e) => setIdentificacaoPonto(e.target.value)}
            readOnly={!editandoItemId}
            placeholder={`Identificacao (ex.: ${sugestaoIdentificacao})`}
          />
          <input style={inputBase} value={referenciaInicio} onChange={(e) => setReferenciaInicio(e.target.value)} placeholder="Referencia inicial" />
          <input style={inputBase} value={referenciaFim} onChange={(e) => setReferenciaFim(e.target.value)} placeholder="Referencia final" />
          {isEscavacao && (
            <>
              <input style={inputBase} value={profundidade} onChange={(e) => setProfundidade(e.target.value)} placeholder="Profundidade (m)" />
              <input style={inputBase} value={largura} onChange={(e) => setLargura(e.target.value)} placeholder="Largura (m)" />
              <input style={inputBase} value={comprimento} onChange={(e) => setComprimento(e.target.value)} placeholder="Comprimento (m)" />
            </>
          )}
          {(isCalcada || isMeioFio) && (
            <input
              style={inputBase}
              value={comprimento}
              onChange={(e) => setComprimento(e.target.value)}
              placeholder={isCalcada ? "Comprimento da calcada executada (m)" : "Comprimento do meio-fio executado (m)"}
            />
          )}
          {isBueiro && (
            <>
              <input style={inputBase} value={qtdBueiro} onChange={(e) => setQtdBueiro(e.target.value)} placeholder="Quantidade de bueiro" />
              <input style={inputBase} value={diametroBueiro} onChange={(e) => setDiametroBueiro(e.target.value)} placeholder="Diametro do bueiro" />
            </>
          )}
        </div>

        <div style={{ marginTop: 10 }}>
          <textarea
            style={textArea}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Observacao do ponto"
          />
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          {!editandoItemId && (
            <button style={btn} onClick={vincularItemAoUltimoDesenho}>Vincular ao ultimo desenho</button>
          )}
          {editandoItemId && (
            <button style={{ ...btn, background: "#198754" }} onClick={salvarEdicaoItem}>Salvar edicao</button>
          )}
          {editandoItemId && (
            <button style={{ ...btn, background: "#fd7e14" }} onClick={revincularEdicaoAoUltimoDesenho}>
              Re-vincular ao ultimo desenho (GPS)
            </button>
          )}
          {editandoItemId && (
            <button style={btnSec} onClick={cancelarEdicaoItem}>Cancelar edicao</button>
          )}
          <button style={btnSec} onClick={removerUltimoItem}>Remover ultimo item</button>
          <span style={{ alignSelf: "center", color: "#324a67", fontWeight: "bold" }}>
            Itens vinculados: {itensCroqui.length}/{MAX_ITENS_POR_FOLHA}
          </span>
        </div>
        {!!statusGeo && (
          <div style={{ marginTop: 8, color: "#2f4259", fontSize: 12 }}>
            <strong>Status:</strong> {statusGeo}
          </div>
        )}
        {precisaHttpsParaGps && !ajudaGeo && (
          <div
            style={{
              marginTop: 8,
              background: "#fff3cd",
              border: "1px solid #ffe69c",
              padding: 10,
              borderRadius: 8,
              fontSize: 12,
              color: "#5a4b00"
            }}
          >
            <strong>GPS bloqueado:</strong> no celular, o navegador geralmente exige <strong>HTTPS</strong>.
            <div style={{ marginTop: 6 }}>
              Voce esta acessando por HTTP (ex.: <code>http://192.168.1.11:3000</code>). Use HTTPS ou um tunel (ngrok/cloudflared) para o GPS funcionar.
            </div>
          </div>
        )}
        {!!ajudaGeo && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button style={{ ...btnSec, background: "#0dcaf0", color: "#08304a" }} onClick={testarGpsAgora}>
                Tentar GPS novamente
              </button>
              <span style={{ fontSize: 12, color: "#5a4b00" }}>
                Se nao aparecer o pop-up de permissao, libere a Localizacao nas permissoes do site.
              </span>
            </div>
            <pre
              style={{
                marginTop: 8,
                background: "#fff3cd",
                border: "1px solid #ffe69c",
                padding: 10,
                borderRadius: 8,
                whiteSpace: "pre-wrap",
                fontSize: 12,
                color: "#5a4b00"
              }}
            >
              {ajudaGeo}
            </pre>
          </div>
        )}
      </div>

      <div style={{ ...card, overflowX: "auto" }}>
        <h3 style={{ marginTop: 0, color: "#10243e" }}>Itens vinculados neste lancamento</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 11 }}>
            <thead style={{ background: "#0b5ed7", color: "#fff" }}>
              <tr>
                {["ID", "Tipo", "Lado", "Ref. inicial", "Ref. final", "Detalhes", "GPS (lat,long)", "Observacao", "Acoes"].map((titulo) => (
                <th
                  key={titulo}
                  style={{
                    padding: "7px 6px",
                    textAlign: "center",
                    ...(titulo === "GPS (lat,long)" ? { minWidth: 170 } : null)
                  }}
                >
                  {titulo}
                </th>
                ))}
              </tr>
            </thead>
          <tbody>
            {itensCroqui.map((item, idx) => (
              <tr key={item.itemId} style={{ background: idx % 2 === 0 ? "#f8fbff" : "#fff" }}>
                <td style={{ padding: 6, textAlign: "center", fontWeight: "bold" }}>{formatarIdentificacaoVisual(item.identificacaoPonto, item.tipoItem, item.itemId)}</td>
                <td style={{ padding: 6, textAlign: "center" }}>{formatarTipoItem(item.tipoItem)}</td>
                <td style={{ padding: 6, textAlign: "center" }}>{formatarLadoExecucao(item.ladoExecucao)}</td>
                <td style={{ padding: 6, textAlign: "center" }}>{item.referenciaInicio || "-"}</td>
                <td style={{ padding: 6, textAlign: "center" }}>{item.referenciaFim || "-"}</td>
                <td style={{ padding: 6, textAlign: "center" }}>{detalheItem(item)}</td>
                <td style={{ padding: 6, textAlign: "center", fontSize: 10, wordBreak: "break-word", minWidth: 170 }}>{formatarGeo(item.geo)}</td>
                <td style={{ padding: 6, textAlign: "center", wordBreak: "break-word" }}>{item.observacao || "-"}</td>
                <td style={{ padding: 6, textAlign: "center" }}>
                  <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                    <button
                      style={{ ...btnSec, background: "#0b5ed7", padding: "6px 10px", borderRadius: 8 }}
                      onClick={() => carregarItemParaEdicao(item)}
                    >
                      Editar
                    </button>
                    <button
                      style={{ ...btnSec, background: "#dc3545", padding: "6px 10px", borderRadius: 8 }}
                      onClick={() => excluirItem(item)}
                    >
                      Excluir
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!itensCroqui.length && (
              <tr>
                <td colSpan={9} style={{ padding: 10, textAlign: "center", color: "#6c757d" }}>
                  Nenhum item vinculado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ ...card, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button style={btn} onClick={salvarProducao}>Salvar producao do dia</button>
      </div>
    </div>
  );
}

export default ProducaoCampo;

