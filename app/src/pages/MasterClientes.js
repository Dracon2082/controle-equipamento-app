import { useEffect, useMemo, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { getConfigDocId, getTenantId, setTenantId, withTenant } from "../utils/tenant";
import { alterarSenhaMaster, masterLogout } from "../utils/masterAuth";
import { garantirUsuarioAuth } from "../utils/authUsers";
import { getContatoComercialConfig, salvarContatoComercialConfig } from "../utils/contactConfig";
import { limparCacheClienteSistema } from "../utils/clienteSistema";
import JSZip from "jszip";
import { obterRefMesAnterior, obterRefMesAtual } from "../utils/clienteSistema";

const PLANOS = [
  {
    id: "PLANO_1",
    nome: "Plano 1",
    valor: 349,
    limiteGestores: 1,
    limiteAdmins: 7,
    limiteOperadores: 50
  },
  {
    id: "PLANO_2",
    nome: "Plano 2",
    valor: 499,
    limiteGestores: 1,
    limiteAdmins: 10,
    limiteOperadores: 80
  },
  {
    id: "PLANO_600",
    // Mantemos o ID antigo por compatibilidade com clientes ja cadastrados.
    nome: "Plano 3",
    valor: 699,
    limiteGestores: 1,
    limiteAdmins: 15,
    limiteOperadores: 120
  },
  {
    id: "PLANO_4",
    nome: "Plano 4",
    valor: 899,
    limiteGestores: 1,
    limiteAdmins: 20,
    limiteOperadores: null
  }
];

const VALOR_ADMIN_EXTRA = 20;
const VALOR_OPERADOR_EXTRA = 5;

const CICLOS_PLANOS = [
  { meses: 1, nome: "Mensal", descontoPct: 0 },
  { meses: 3, nome: "3 meses", descontoPct: 5 },
  { meses: 6, nome: "6 meses", descontoPct: 10 },
  { meses: 12, nome: "12 meses", descontoPct: 15 }
];

const PLANO_TESTE_10D = {
  id: "TESTE_10D",
  nome: "Teste 10 dias",
  valor: 0,
  limiteGestores: 1,
  limiteAdmins: 3,
  limiteOperadores: 10,
  dias: 10
};

const obterPlanoPorId = (planoId) => {
  const pid = String(planoId || "").trim();
  if (!pid) return null;
  if (pid === PLANO_TESTE_10D.id) return PLANO_TESTE_10D;
  return PLANOS.find((p) => String(p.id) === pid) || null;
};

const obterCicloPlano = (meses) => {
  const ciclo = Number(meses || 1);
  return CICLOS_PLANOS.find((item) => Number(item.meses) === ciclo) || CICLOS_PLANOS[0];
};

const arredondarMoeda = (valor) => Math.round(Number(valor || 0) * 100) / 100;

const calcularPrecoPlano = (valorBase, meses) => {
  const ciclo = obterCicloPlano(meses);
  const base = Number(valorBase || 0);
  const bruto = arredondarMoeda(base * ciclo.meses);
  const descontoValor = arredondarMoeda((bruto * Number(ciclo.descontoPct || 0)) / 100);
  const total = arredondarMoeda(bruto - descontoValor);
  const equivalenteMensal = ciclo.meses > 0 ? arredondarMoeda(total / ciclo.meses) : total;
  return {
    cicloMeses: ciclo.meses,
    descontoPct: Number(ciclo.descontoPct || 0),
    valorBase: base,
    valorBruto: bruto,
    descontoValor,
    total,
    equivalenteMensal
  };
};

const formatarMoedaBR = (valor) =>
  Number(valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

const descreverPlano = (plano) =>
  `1 Gestor, ${plano.limiteAdmins} ADM, ${
    plano.limiteOperadores === null ? "Operadores ilimitados" : `${plano.limiteOperadores} Operadores`
  }`;

const COLECOES_OPERACIONAIS = [
  "abastecimentos",
  "almoxarifado_estoque_ferramentas",
  "almoxarifado_estoque_insumos",
  "almoxarifado_movimentacoes",
  "almoxarifado_movimentacoes_ferramentas",
  "almoxarifado_movimentacoes_insumos",
  "boletinsTransferencia",
  "empresas",
  "epi_movimentacoes",
  "equipamentos",
  "frentistas",
  "funcionarios",
  "historico_operacoes",
  "lancamentos",
  "lubrificantes",
  "master_admins",
  "manutencoes",
  "obras",
  "producaoCampo"
];

const FORMAS_PAGAMENTO = ["PIX", "BOLETO"];

// Cores usadas no status das faturas (mesmas do painel do cliente).
const STATUS_CORES = {
  PENDENTE: { fundo: "#eef4ff", borda: "#b8ccff", texto: "#2457d6" },
  PAGO: { fundo: "#eaf9ef", borda: "#aadfb8", texto: "#1c8f43" },
  CANCELADO: { fundo: "#fdeff0", borda: "#f2b8bd", texto: "#d33d4f" }
};
const STATUS_CLIENTE = ["ATIVO", "INADIMPLENTE", "INATIVO", "TESTE"];
const PERMISSOES_ADMIN_PADRAO = [
  "admin_relatorios",
  "admin_cadastros",
  "admin_controle",
  "admin_financeiro"
];
const PERFIL_GESTOR_GERAL = "GESTOR_GERAL";
const PERMISSOES_OPERACIONAIS_PADRAO = [
  "abastecimento",
  "lancamento",
  "producaoCampo",
  "manutencao",
  "almoxarifado",
  "epi",
  "informarMeioTransporte",
  "receberTransporte"
];
const ASSINATURA_SIMULADA =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z2WQAAAAASUVORK5CYII=";

const confirmarTexto = (valorDigitado, esperado) =>
  String(valorDigitado || "").trim().toUpperCase() === String(esperado || "").trim().toUpperCase();

const soDigitos = (valor) => String(valor || "").replace(/\D/g, "");

const upper = (valor) => String(valor || "").trim().toUpperCase();

const formatarCep = (valor) => {
  const numeros = soDigitos(valor).slice(0, 8);
  if (numeros.length <= 5) return numeros;
  return `${numeros.slice(0, 5)}-${numeros.slice(5)}`;
};

const montarEnderecoCompleto = ({ logradouro, numero, bairro, cidade, uf, cep }) => {
  const partes = [];
  const rua = String(logradouro || "").trim();
  const num = String(numero || "").trim();
  const bairroTexto = String(bairro || "").trim();
  const cidadeTexto = String(cidade || "").trim();
  const ufTexto = String(uf || "").trim();
  const cepTexto = formatarCep(cep);

  if (rua) partes.push(num ? `${rua}, ${num}` : rua);
  if (bairroTexto) partes.push(bairroTexto);
  if (cidadeTexto || ufTexto) partes.push(`${cidadeTexto}${cidadeTexto && ufTexto ? "/" : ""}${ufTexto}`.trim());
  if (cepTexto) partes.push(`CEP ${cepTexto}`);

  return partes.join(" - ");
};

const extrairDadosCnpjApi = (dados) => {
  if (!dados || typeof dados !== "object") return null;

  if (dados?.estabelecimento) {
    const est = dados.estabelecimento || {};
    const ie = Array.isArray(est.inscricoes_estaduais) ? est.inscricoes_estaduais[0]?.inscricao_estadual || "" : "";
    const telefone = `${est.ddd1 || ""}${est.telefone1 || ""}` || `${est.ddd2 || ""}${est.telefone2 || ""}`;
    return {
      razaoSocial: dados?.razao_social || "",
      nomeFantasia: est?.nome_fantasia || "",
      inscricaoEstadual: ie,
      logradouro: est?.logradouro || "",
      numero: est?.numero || "",
      bairro: est?.bairro || "",
      cep: est?.cep || "",
      cidade: est?.cidade?.nome || "",
      uf: est?.estado?.sigla || "",
      email: est?.email || "",
      telefone
    };
  }

  return {
    razaoSocial: dados?.razao_social || dados?.nome_empresarial || dados?.legal_name || "",
    nomeFantasia: dados?.nome_fantasia || dados?.trade_name || "",
    inscricaoEstadual: dados?.inscricao_estadual || "",
    logradouro: dados?.logradouro || dados?.street || "",
    numero: dados?.numero || dados?.number || "",
    bairro: dados?.bairro || dados?.neighborhood || "",
    cep: dados?.cep || dados?.zip_code || "",
    cidade: dados?.municipio || dados?.cidade || dados?.city || "",
    uf: dados?.uf || dados?.state || "",
    email: dados?.email || "",
    telefone: dados?.ddd_telefone_1 || dados?.phone || ""
  };
};

function MasterClientes({ setTela }) {
  const [razaoSocial, setRazaoSocial] = useState("");
  const [nomeFantasia, setNomeFantasia] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [inscricaoEstadual, setInscricaoEstadual] = useState("");
  const [endereco, setEndereco] = useState("");
  const [logradouro, setLogradouro] = useState("");
  const [numero, setNumero] = useState("");
  const [bairro, setBairro] = useState("");
  const [cep, setCep] = useState("");
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("");
  const [enderecoCobranca, setEnderecoCobranca] = useState("");
  const [telefone, setTelefone] = useState("");
  const [emailContato, setEmailContato] = useState("");
  const [consultandoCnpj, setConsultandoCnpj] = useState(false);
  const [mensagemConsultaCnpj, setMensagemConsultaCnpj] = useState("");
  const [planoId, setPlanoId] = useState("PLANO_1");
  const [cicloPlanoMeses, setCicloPlanoMeses] = useState(1);
  const [valorMensal, setValorMensal] = useState(349);
  const [formaPagamento, setFormaPagamento] = useState("PIX");
  const [status, setStatus] = useState("ATIVO");
  const [nomeGestor, setNomeGestor] = useState("");
  const [emailGestor, setEmailGestor] = useState("");
  const [senhaTemporaria, setSenhaTemporaria] = useState("");
  const [lista, setLista] = useState([]);
  const [busca, setBusca] = useState("");
  const [whatsVendas, setWhatsVendas] = useState("");
  const [whatsSuporte, setWhatsSuporte] = useState("");
  const [clientePlanoEdicaoId, setClientePlanoEdicaoId] = useState("");
  const [planoEdicaoId, setPlanoEdicaoId] = useState("");
  const [cicloPlanoEdicaoMeses, setCicloPlanoEdicaoMeses] = useState(1);
  const [valorPlanoEdicao, setValorPlanoEdicao] = useState("");
  const [acoesAbertoId, setAcoesAbertoId] = useState("");
  const acoesMenuRef = useRef(null);
  const ultimoCnpjConsultadoRef = useRef("");
  const [acoesMenuPos, setAcoesMenuPos] = useState(null); // { top, left, width }
  const [acoesAnchorRect, setAcoesAnchorRect] = useState(null); // DOMRect

  const [senhaAtualMaster, setSenhaAtualMaster] = useState("");
  const [novaSenhaMaster, setNovaSenhaMaster] = useState("");
  const [novaSenhaMaster2, setNovaSenhaMaster2] = useState("");

  const [exportAbertoId, setExportAbertoId] = useState("");
  const [exportDataIni, setExportDataIni] = useState("");
  const [exportDataFim, setExportDataFim] = useState("");
  const [exportIncluiMidias, setExportIncluiMidias] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [financeiroAbertoId, setFinanceiroAbertoId] = useState("");
  const [finDiaVenc, setFinDiaVenc] = useState("10");
  const [finRefMes, setFinRefMes] = useState(obterRefMesAtual());
  const [finValorFatura, setFinValorFatura] = useState("");
  const [finFormaFatura, setFinFormaFatura] = useState("PIX");
  const [finLinkPagamento, setFinLinkPagamento] = useState("");
  const [finPixChave, setFinPixChave] = useState("");
  const [finFaturas, setFinFaturas] = useState([]);
  const [finCarregandoFaturas, setFinCarregandoFaturas] = useState(false);

  const tenantAtual = getTenantId();
  const isProd = process.env.NODE_ENV === "production";
  const isLocalhost = (() => {
    try {
      const host = String(window.location.hostname || "").toLowerCase();
      return host === "localhost" || host === "127.0.0.1";
    } catch {
      return false;
    }
  })();
  const mostrarFerramentasPerigosas = !isProd || isLocalhost;

  useEffect(() => {
    if (!acoesAbertoId) return;
    const onDown = (ev) => {
      try {
        const el = acoesMenuRef.current;
        if (el && ev?.target && !el.contains(ev.target)) {
          setAcoesAbertoId("");
          setAcoesAnchorRect(null);
        }
      } catch {}
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [acoesAbertoId]);

  useEffect(() => {
    if (!acoesAbertoId) setAcoesMenuPos(null);
  }, [acoesAbertoId]);

  useEffect(() => {
    if (!financeiroAbertoId) return;
    const item = (Array.isArray(lista) ? lista : []).find((c) => String(c?.id || "") === String(financeiroAbertoId));
    if (!item) return;
    // Carrega faturas do cliente quando abrir o modal financeiro.
    carregarFaturasCliente(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [financeiroAbertoId]);

  // Reposiciona o menu para nao ficar cortado (viewport).
  useEffect(() => {
    if (!acoesAbertoId) return;
    if (!acoesAnchorRect) return;
    const el = acoesMenuRef.current;
    if (!el) return;

    const raf = window.requestAnimationFrame(() => {
      try {
        const menuW = el.offsetWidth || 190;
        const menuH = el.offsetHeight || 240;
        const padding = 10;

        // Default: abaixo do botao
        let top = acoesAnchorRect.bottom + 6;
        // Se estourar a tela, joga pra cima do botao
        if (top + menuH > window.innerHeight - padding) {
          top = Math.max(padding, acoesAnchorRect.top - menuH - 6);
        }

        // Alinha na direita do botao, mas sem estourar
        let left = acoesAnchorRect.right - menuW;
        if (left < padding) left = padding;
        if (left + menuW > window.innerWidth - padding) left = Math.max(padding, window.innerWidth - padding - menuW);

        setAcoesMenuPos({ top, left, width: menuW });
      } catch {
        // noop
      }
    });
    return () => {
      try { window.cancelAnimationFrame(raf); } catch {}
    };
  }, [acoesAbertoId, acoesAnchorRect]);

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

  const secondaryButton = {
    ...primaryButton,
    background: "#6c757d"
  };

  const successButton = {
    ...primaryButton,
    background: "#198754",
    padding: "6px 10px"
  };

  const warningButton = {
    ...primaryButton,
    background: "#f0ad4e",
    color: "#111",
    padding: "6px 10px"
  };
  const dangerButton = {
    ...primaryButton,
    background: "#dc3545"
  };

  const formatarCnpj = (valor) => {
    const numeros = String(valor || "").replace(/\D/g, "").slice(0, 14);
    if (numeros.length <= 2) return numeros;
    if (numeros.length <= 5) return `${numeros.slice(0, 2)}.${numeros.slice(2)}`;
    if (numeros.length <= 8) return `${numeros.slice(0, 2)}.${numeros.slice(2, 5)}.${numeros.slice(5)}`;
    if (numeros.length <= 12) return `${numeros.slice(0, 2)}.${numeros.slice(2, 5)}.${numeros.slice(5, 8)}/${numeros.slice(8)}`;
    return `${numeros.slice(0, 2)}.${numeros.slice(2, 5)}.${numeros.slice(5, 8)}/${numeros.slice(8, 12)}-${numeros.slice(12)}`;
  };

  const formatarTelefone = (valor) => {
    const numeros = String(valor || "").replace(/\D/g, "").slice(0, 11);
    if (numeros.length <= 2) return numeros;
    if (numeros.length <= 6) return `(${numeros.slice(0, 2)}) ${numeros.slice(2)}`;
    if (numeros.length <= 10) return `(${numeros.slice(0, 2)}) ${numeros.slice(2, 6)}-${numeros.slice(6)}`;
    return `(${numeros.slice(0, 2)}) ${numeros.slice(2, 7)}-${numeros.slice(7)}`;
  };

  const gerarSenha = () => {
    const base = Math.random().toString(36).slice(2, 8);
    return `Obra@${base}`;
  };

  const recalcularValorCadastro = (proximoPlanoId = planoId, proximoCiclo = cicloPlanoMeses) => {
    const plano = PLANOS.find((p) => p.id === proximoPlanoId);
    if (!plano) return;
    const calc = calcularPrecoPlano(plano.valor, proximoCiclo);
    setValorMensal(String(calc.total));
  };

  const recalcularValorEdicaoPlano = (proximoPlanoId = planoEdicaoId, proximoCiclo = cicloPlanoEdicaoMeses) => {
    const plano = PLANOS.find((p) => p.id === proximoPlanoId);
    if (!plano) return;
    const calc = calcularPrecoPlano(plano.valor, proximoCiclo);
    setValorPlanoEdicao(String(calc.total));
  };

  const calcularMaxUsuariosPlano = (plano) => {
    const limiteGestores = Number(plano?.limiteGestores || 0);
    const limiteAdmins = Number(plano?.limiteAdmins || 0);
    const limiteOperadoresRaw = plano?.limiteOperadores;
    const operadoresIlimitados = limiteOperadoresRaw === null || Number(limiteOperadoresRaw) <= 0;
    if (operadoresIlimitados) return 0;
    return limiteGestores + limiteAdmins + Number(limiteOperadoresRaw || 0);
  };

  const iniciarEdicaoPlano = (item) => {
    const planoAtual = PLANOS.find((p) => p.id === item.planoId) || PLANOS.find((p) => p.nome === item.planoNome) || PLANOS[0];
    const cicloAtual = Number(item?.cicloPlanoMeses || 1);
    setClientePlanoEdicaoId(item.id);
    setPlanoEdicaoId(planoAtual?.id || PLANOS[0].id);
    setCicloPlanoEdicaoMeses(cicloAtual);
    const calc = calcularPrecoPlano(planoAtual?.valor || 0, cicloAtual);
    setValorPlanoEdicao(String(Number(item.valorMensal || calc.total || planoAtual?.valor || 0)));
  };

  const cancelarEdicaoPlano = () => {
    setClientePlanoEdicaoId("");
    setPlanoEdicaoId("");
    setCicloPlanoEdicaoMeses(1);
    setValorPlanoEdicao("");
  };

  const salvarEdicaoPlano = async (item) => {
    const planoSelecionado = PLANOS.find((p) => p.id === planoEdicaoId);
    if (!planoSelecionado) {
      alert("Selecione um plano valido.");
      return;
    }
    const calc = calcularPrecoPlano(planoSelecionado.valor, cicloPlanoEdicaoMeses);
    const limiteGestoresPlano = Number(planoSelecionado.limiteGestores || 1);
    const limiteAdminsPlano = Number(planoSelecionado.limiteAdmins || 0);
    const limiteOperadoresPlano =
      planoSelecionado.limiteOperadores === null ? null : Number(planoSelecionado.limiteOperadores || 0);
    const maxUsuariosNoPlano = calcularMaxUsuariosPlano(planoSelecionado);

    await updateDoc(doc(db, "clientesSistema", item.id), {
      planoId: planoSelecionado.id,
      planoNome: planoSelecionado.nome,
      cicloPlanoMeses: calc.cicloMeses,
      descontoPlanoPct: calc.descontoPct,
      valorMensalBase: calc.valorBase,
      valorMensalEquivalente: calc.equivalenteMensal,
      valorMensal: Number(valorPlanoEdicao || calc.total || planoSelecionado.valor || 0),
      valorAdminExtra: VALOR_ADMIN_EXTRA,
      valorOperadorExtra: VALOR_OPERADOR_EXTRA,
      maxUsuariosNoPlano,
      limiteGestoresPlano,
      limiteAdminsPlano,
      limiteOperadoresPlano,
      atualizadoEm: new Date().toISOString()
    });

    cancelarEdicaoPlano();
    await carregar();
    alert("Plano do cliente atualizado com sucesso.");
  };

  const carregar = async () => {
    const snap = await getDocs(collection(db, "clientesSistema"));
    const dados = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    dados.sort((a, b) => String(a.razaoSocial || "").localeCompare(String(b.razaoSocial || "")));
    setLista(dados);
  };

  const aplicarDadosCnpj = (dados) => {
    if (!dados) return false;

    setRazaoSocial((atual) => atual || dados.razaoSocial || "");
    setNomeFantasia((atual) => atual || dados.nomeFantasia || "");
    setInscricaoEstadual((atual) => atual || dados.inscricaoEstadual || "");
    setLogradouro((atual) => atual || dados.logradouro || "");
    setNumero((atual) => atual || dados.numero || "");
    setBairro((atual) => atual || dados.bairro || "");
    setCep((atual) => atual || formatarCep(dados.cep));
    setCidade((atual) => atual || dados.cidade || "");
    setUf((atual) => atual || upper(dados.uf));
    setEmailContato((atual) => atual || String(dados.email || "").toLowerCase());
    setTelefone((atual) => atual || formatarTelefone(dados.telefone));
    return true;
  };

  const consultarCnpj = async (forcar = false) => {
    const cnpjNumero = soDigitos(cnpj);
    if (cnpjNumero.length !== 14) {
      setMensagemConsultaCnpj("Digite um CNPJ completo com 14 numeros.");
      setConsultandoCnpj(false);
      return false;
    }

    if (!forcar && ultimoCnpjConsultadoRef.current === cnpjNumero) {
      return true;
    }

    ultimoCnpjConsultadoRef.current = cnpjNumero;
    setConsultandoCnpj(true);
    setMensagemConsultaCnpj("Buscando dados do CNPJ...");

    const endpoints = [
      `https://brasilapi.com.br/api/cnpj/v1/${cnpjNumero}`,
      `https://publica.cnpj.ws/cnpj/${cnpjNumero}`
    ];

    try {
      for (const url of endpoints) {
        try {
          const resposta = await fetch(url);
          if (!resposta.ok) continue;
          const payload = await resposta.json();
          const dados = extrairDadosCnpjApi(payload);
          const achouAlgo =
            dados?.razaoSocial || dados?.nomeFantasia || dados?.logradouro || dados?.bairro || dados?.cidade || dados?.uf || dados?.cep;
          if (!achouAlgo) continue;
          aplicarDadosCnpj(dados);
          setMensagemConsultaCnpj("Dados do CNPJ carregados. Revise e complemente se precisar.");
          setConsultandoCnpj(false);
          return true;
        } catch {
          // Tenta a proxima API publica.
        }
      }

      setMensagemConsultaCnpj("Nao consegui buscar esse CNPJ agora. Voce pode preencher manualmente e tentar novamente.");
      setConsultandoCnpj(false);
      return false;
    } catch {
      setMensagemConsultaCnpj("Nao consegui buscar esse CNPJ agora. Voce pode preencher manualmente e tentar novamente.");
      setConsultandoCnpj(false);
      return false;
    }
  };

  useEffect(() => {
    carregar();
    if (!senhaTemporaria) setSenhaTemporaria(gerarSenha());
    const contato = getContatoComercialConfig();
    setWhatsVendas(contato.vendasWhatsappUrl || "");
    setWhatsSuporte(contato.suporteWhatsappUrl || "");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setEndereco(upper(montarEnderecoCompleto({ logradouro, numero, bairro, cidade, uf, cep })));
  }, [logradouro, numero, bairro, cidade, uf, cep]);

  useEffect(() => {
    const cnpjNumero = soDigitos(cnpj);

    if (cnpjNumero.length !== 14) {
      ultimoCnpjConsultadoRef.current = "";
      setConsultandoCnpj(false);
      if (mensagemConsultaCnpj) {
        setMensagemConsultaCnpj("");
      }
      return;
    }

    if (ultimoCnpjConsultadoRef.current === cnpjNumero) return;

    consultarCnpj();
  }, [cnpj]); // eslint-disable-line react-hooks/exhaustive-deps

  const salvar = async () => {
    const cnpjNumero = soDigitos(cnpj);
    const razao = upper(razaoSocial);
    const fantasia = upper(nomeFantasia);
    const email = String(emailContato || "").trim().toLowerCase();
    const emailAdmin = String(emailGestor || emailContato || "").trim().toLowerCase();
    const nomeAdmin = upper(nomeGestor);
    const logradouroTexto = upper(logradouro);
    const numeroTexto = upper(numero);
    const bairroTexto = upper(bairro);
    const cepTexto = formatarCep(cep);
    const cidadeTexto = upper(cidade);
    const ufTexto = upper(uf);
    const enderecoMontado = upper(
      montarEnderecoCompleto({
        logradouro: logradouroTexto,
        numero: numeroTexto,
        bairro: bairroTexto,
        cidade: cidadeTexto,
        uf: ufTexto,
        cep: cepTexto
      })
    );
    const enderecoFinal = upper(endereco) || enderecoMontado;

    if (!razao) return alert("Informe a razao social.");
    if (cnpjNumero.length !== 14) return alert("CNPJ invalido.");
    if (!email) return alert("Informe o e-mail de contato da empresa.");
    if (!emailAdmin) return alert("Informe o e-mail do gestor para o primeiro acesso.");
    if (!nomeAdmin) return alert("Informe o nome do gestor.");
    if (!senhaTemporaria || senhaTemporaria.length < 6) return alert("Informe uma senha temporaria valida.");

    const existe = lista.find((item) => String(item.cnpj || "").replace(/\D/g, "") === cnpjNumero);
    if (existe) return alert("Esse CNPJ ja esta cadastrado no painel master.");

    const tenantId = cnpjNumero;
    const planoSelecionado = PLANOS.find((p) => p.id === planoId);
    const calc = calcularPrecoPlano(planoSelecionado?.valor || 0, cicloPlanoMeses);
    const limiteGestoresPlano = Number(planoSelecionado?.limiteGestores || 1);
    const limiteAdminsPlano = Number(planoSelecionado?.limiteAdmins || 2);
    const limiteOperadoresPlano = planoSelecionado?.limiteOperadores === null ? null : Number(planoSelecionado?.limiteOperadores || 20);
    const maxUsuariosNoPlano = calcularMaxUsuariosPlano(planoSelecionado);

    const clienteRef = await addDoc(collection(db, "clientesSistema"), {
      razaoSocial: razao,
      nomeFantasia: fantasia,
      cnpj: cnpjNumero,
      inscricaoEstadual: upper(inscricaoEstadual),
      endereco: enderecoFinal,
      logradouro: logradouroTexto,
      numero: numeroTexto,
      bairro: bairroTexto,
      cep: cepTexto,
      cidade: cidadeTexto,
      uf: ufTexto,
      enderecoCobranca: upper(enderecoCobranca),
      telefone: soDigitos(telefone),
      emailContato: email,
      planoId,
      planoNome: planoSelecionado?.nome || planoId,
      cicloPlanoMeses: calc.cicloMeses,
      descontoPlanoPct: calc.descontoPct,
      valorMensalBase: calc.valorBase,
      valorMensalEquivalente: calc.equivalenteMensal,
      valorMensal: Number(valorMensal || calc.total || 0),
      valorAdminExtra: VALOR_ADMIN_EXTRA,
      valorOperadorExtra: VALOR_OPERADOR_EXTRA,
      maxUsuariosNoPlano,
      limiteGestoresPlano,
      limiteAdminsPlano,
      limiteOperadoresPlano,
      formaPagamento,
      status,
      diaVencimento: 10,
      pagoAteRef: "",
      tenantId,
      criadoEm: new Date().toISOString(),
      acessoInicial: {
        nomeGestor: nomeAdmin,
        emailGestor: emailAdmin,
        senhaTemporaria
      }
    });

    await setDoc(doc(db, "configuracoes", getConfigDocId(tenantId)), {
      tenantId,
      nome: razao,
      nomeFantasia: fantasia,
      cnpj: cnpjNumero,
      telefone: soDigitos(telefone),
      endereco: enderecoFinal,
      logradouro: logradouroTexto,
      numero: numeroTexto,
      bairro: bairroTexto,
      cep: cepTexto,
      cidade: cidadeTexto,
      estado: ufTexto,
      uf: ufTexto,
      inscricaoEstadual: upper(inscricaoEstadual),
      emailContato: email
    }, { merge: true });

    const snapFrentistas = await getDocs(collection(db, "frentistas"));
    const jaExisteAcesso = snapFrentistas.docs.some((docItem) => {
      const d = docItem.data();
      return String(d.email || "").toLowerCase() === emailAdmin && String(d.tenantId || "") === tenantId;
    });

    if (!jaExisteAcesso) {
      await addDoc(collection(db, "frentistas"), {
        tenantId,
        nome: nomeAdmin,
        email: emailAdmin,
        cpf: "",
        dataNascimento: "",
        funcao: "GESTOR",
        perfilAcesso: PERFIL_GESTOR_GERAL,
        usuarioChave: true,
        permissoes: [
          ...PERMISSOES_OPERACIONAIS_PADRAO,
          ...PERMISSOES_ADMIN_PADRAO
        ],
        basesPermitidas: [],
        senha: senhaTemporaria,
        criadoEm: new Date().toISOString()
      });
      await garantirUsuarioAuth(emailAdmin, senhaTemporaria);
    }

    alert(
      `Cliente cadastrado com sucesso.\n\n` +
      `Acesso inicial do cliente:\n` +
      `- ${nomeAdmin} (GESTOR_GERAL) | ${emailAdmin} | ${senhaTemporaria}\n` +
      `\n` +
      `Use o tenant ${tenantId} para operar os dados desse cliente.`
    );

    localStorage.setItem(
      "credencialSimulacaoCliente",
      JSON.stringify({
        tenantId,
        email: emailAdmin,
        senha: senhaTemporaria
      })
    );

    setTenantId(tenantId);
    setRazaoSocial("");
    setNomeFantasia("");
    setCnpj("");
    setInscricaoEstadual("");
    setEndereco("");
    setLogradouro("");
    setNumero("");
    setBairro("");
    setCep("");
    setCidade("");
    setUf("");
    setEnderecoCobranca("");
    setTelefone("");
    setEmailContato("");
    setMensagemConsultaCnpj("");
    setConsultandoCnpj(false);
    ultimoCnpjConsultadoRef.current = "";
    setPlanoId("PLANO_1");
    setCicloPlanoMeses(1);
    setValorMensal(349);
    setFormaPagamento("PIX");
    setStatus("ATIVO");
    setNomeGestor("");
    setEmailGestor("");
    setSenhaTemporaria(gerarSenha());
    carregar();

    await updateDoc(doc(db, "clientesSistema", clienteRef.id), { atualizadoEm: new Date().toISOString() });
  };

  const alternarStatus = async (item) => {
    const novo = item.status === "ATIVO" ? "INATIVO" : "ATIVO";
    await updateDoc(doc(db, "clientesSistema", item.id), { status: novo });
    carregar();
  };

  const ativarTeste10Dias = async (item) => {
    const razao = String(item?.razaoSocial || "").trim() || "cliente";
    const confirmar = window.prompt(`Para ativar/reiniciar TESTE 10 DIAS para ${razao}, digite: TESTE`);
    if (!confirmarTexto(confirmar, "TESTE")) {
      alert("Operacao cancelada.");
      return;
    }

    const agora = new Date();
    const expira = new Date(agora.getTime() + PLANO_TESTE_10D.dias * 24 * 60 * 60 * 1000);
    const maxUsuarios = 1 + 3 + 10;

    try {
      await updateDoc(doc(db, "clientesSistema", item.id), {
        status: "TESTE",
        planoId: PLANO_TESTE_10D.id,
        planoNome: PLANO_TESTE_10D.nome,
        cicloPlanoMeses: 1,
        descontoPlanoPct: 0,
        valorMensalBase: 0,
        valorMensalEquivalente: 0,
        valorMensal: 0,
        formaPagamento: "PIX",
        limiteGestoresPlano: 1,
        limiteAdminsPlano: 3,
        limiteOperadoresPlano: 10,
        maxUsuariosNoPlano: maxUsuarios,
        testeAtivadoEm: agora.toISOString(),
        testeExpiraEm: expira.toISOString(),
        atualizadoEm: agora.toISOString()
      });
      // Forca recarregar configuracao do cliente nos navegadores (quando possivel).
      try { limparCacheClienteSistema(); } catch {}
      await carregar();
      alert(`Teste ativado ate ${expira.toLocaleDateString("pt-BR")} para ${razao}.`);
    } catch (error) {
      const detalhe = String(error?.code || error?.message || "erro-desconhecido");
      alert(`Falha ao ativar teste: ${detalhe}`);
    }
  };

  const abrirFinanceiroCliente = (item) => {
    setFinanceiroAbertoId(String(item?.id || ""));
    const dia = Number(item?.diaVencimento || 10);
    setFinDiaVenc(String(Number.isFinite(dia) && dia >= 1 && dia <= 28 ? dia : 10));

    // Defaults para gerar fatura manualmente (Mercado Pago).
    const refAtual = obterRefMesAtual();
    setFinRefMes(refAtual);
    // Puxa automaticamente o valor do plano (fallback para valorMensal do cliente, se existir).
    const planoCliente = obterPlanoPorId(item?.planoId);
    const valorPadrao = Number(item?.valorMensal || planoCliente?.valor || 0);
    setFinValorFatura(String(Number.isFinite(valorPadrao) ? valorPadrao : 0));
    setFinFormaFatura(String(item?.formaPagamento || "PIX").toUpperCase());
    // Preenche com valores padrao do cliente (se tiver), para nao precisar digitar toda vez.
    setFinLinkPagamento(String(item?.linkPagamento || "").trim());
    setFinPixChave(String(item?.pixChave || "").trim());
    setFinFaturas([]);
    setFinCarregandoFaturas(false);
  };

  const copiarTexto = async (texto) => {
    const txt = String(texto || "").trim();
    if (!txt) return;
    try {
      await navigator.clipboard.writeText(txt);
      alert("Copiado.");
    } catch {
      // Fallback (funciona mesmo sem permissao de clipboard)
      window.prompt("Copie o texto abaixo:", txt);
    }
  };

  const salvarPadraoPagamentoCliente = async (cliente) => {
    const id = String(cliente?.id || "").trim();
    if (!id) return;
    try {
      await updateDoc(doc(db, "clientesSistema", id), {
        linkPagamento: String(finLinkPagamento || "").trim(),
        pixChave: String(finPixChave || "").trim(),
        atualizadoEm: new Date().toISOString()
      });
      await carregar();
      alert("Dados de pagamento (PIX/link) salvos no cadastro do cliente.");
    } catch (e) {
      alert(`Falha ao salvar dados do cliente: ${String(e?.message || e || "")}`);
    }
  };

  const normalizarRefMes = (ref) => {
    const raw = String(ref || "").trim();
    // Aceita YYYY-MM e tambem MM/YYYY (converte).
    const mY = raw.match(/^(\d{2})\/(\d{4})$/);
    if (mY) return `${mY[2]}-${mY[1]}`;
    const yM = raw.match(/^(\d{4})-(\d{2})$/);
    if (yM) return `${yM[1]}-${yM[2]}`;
    return "";
  };

  const calcularVencimentoISO = (refMes, diaVencimento) => {
    const ref = normalizarRefMes(refMes);
    if (!ref) return "";
    const [yy, mm] = ref.split("-").map((x) => Number(x || 0));
    const dia = Number(diaVencimento || 10);
    if (!Number.isFinite(yy) || !Number.isFinite(mm) || mm < 1 || mm > 12) return "";
    if (!Number.isFinite(dia) || dia < 1 || dia > 28) return "";
    const dt = new Date(Date.UTC(yy, mm - 1, dia, 12, 0, 0));
    return dt.toISOString();
  };

  const calcularDiferencaDias = (alvo, base = new Date()) => {
    if (!(alvo instanceof Date) || Number.isNaN(alvo.getTime())) return null;
    const ref = new Date(base);
    ref.setHours(12, 0, 0, 0);
    const destino = new Date(alvo);
    destino.setHours(12, 0, 0, 0);
    return Math.ceil((destino.getTime() - ref.getTime()) / (24 * 60 * 60 * 1000));
  };

  const obterResumoPrazoCliente = (item) => {
    const statusAtual = String(item?.status || "").trim().toUpperCase();

    if (statusAtual === "TESTE") {
      const expiraTxt = String(item?.testeExpiraEm || "").trim();
      const expira = expiraTxt ? new Date(expiraTxt) : null;
      const dias = calcularDiferencaDias(expira);
      if (dias === null) return { texto: "Teste sem data definida", cor: "#6c757d" };
      if (dias < 0) return { texto: `Teste vencido ha ${Math.abs(dias)} dia(s)`, cor: "#d33d4f" };
      if (dias === 0) return { texto: "Teste vence hoje", cor: "#f08c00" };
      if (dias <= 3) return { texto: `Teste: ${dias} dia(s) restantes`, cor: "#f08c00" };
      return { texto: `Teste: ${dias} dia(s) restantes`, cor: "#1c8f43" };
    }

    const diaVencimento = Number(item?.diaVencimento || 10);
    const pagoAte = normalizarRefMes(item?.pagoAteRef || "");
    let refVencimento = obterRefMesAtual();
    if (pagoAte) {
      const [yy, mm] = pagoAte.split("-").map((x) => Number(x || 0));
      if (Number.isFinite(yy) && Number.isFinite(mm) && mm >= 1 && mm <= 12) {
        const proximo = new Date(yy, mm, 1, 12, 0, 0);
        refVencimento = `${proximo.getFullYear()}-${String(proximo.getMonth() + 1).padStart(2, "0")}`;
      }
    }
    const vencimentoISO = calcularVencimentoISO(refVencimento, diaVencimento);
    const vencimento = vencimentoISO ? new Date(vencimentoISO) : null;
    const dias = calcularDiferencaDias(vencimento);
    if (dias === null) return { texto: "Sem vencimento definido", cor: "#6c757d" };
    if (dias < 0) return { texto: `Atrasado ha ${Math.abs(dias)} dia(s)`, cor: "#d33d4f" };
    if (dias === 0) return { texto: "Vence hoje", cor: "#f08c00" };
    if (dias <= 5) return { texto: `Vence em ${dias} dia(s)`, cor: "#f08c00" };
    return { texto: `Vence em ${dias} dia(s)`, cor: "#1c8f43" };
  };

  const carregarFaturasCliente = async (item) => {
    if (!item?.tenantId) return;
    setFinCarregandoFaturas(true);
    try {
      const snap = await getDocs(collection(db, "faturasSistema"));
      const listaF = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((f) => String(f?.tenantId || "").toLowerCase() === String(item.tenantId || "").toLowerCase())
        .sort((a, b) => String(b?.refMes || "").localeCompare(String(a?.refMes || ""), "pt-BR"));
      setFinFaturas(listaF);
    } catch {
      setFinFaturas([]);
    } finally {
      setFinCarregandoFaturas(false);
    }
  };

  const montarMensagemCobranca = (cliente, fatura) => {
    const nome = String(cliente?.razaoSocial || cliente?.nomeFantasia || "cliente").trim();
    const ref = String(fatura?.refMes || "").trim();
    const valor = Number(fatura?.valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
    const venc = fatura?.vencimentoISO ? new Date(fatura.vencimentoISO).toLocaleDateString("pt-BR") : "-";
    const forma = String(fatura?.formaPagamento || cliente?.formaPagamento || "PIX").toUpperCase();
    const link = String(fatura?.linkPagamento || "").trim();
    const pix = String(fatura?.pixChave || "").trim();

    const linhas = [
      `FATURA - ${nome}`,
      `Referencia: ${ref || "-"}`,
      `Vencimento: ${venc}`,
      `Valor: R$ ${valor}`,
      `Forma: ${forma}`
    ];
    if (link) linhas.push(`Link de pagamento: ${link}`);
    if (pix) linhas.push(`PIX (chave): ${pix}`);
    linhas.push("Se ja foi pago, por favor desconsidere.");
    return linhas.join("\n");
  };

  const abrirWhatsAppCobranca = (cliente, fatura) => {
    const tel = String(cliente?.telefone || "").replace(/\D/g, "");
    if (!tel) {
      alert("Telefone do cliente nao cadastrado.");
      return;
    }
    const msg = montarMensagemCobranca(cliente, fatura);
    const url = `https://wa.me/55${tel}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const abrirEmailCobranca = (cliente, fatura) => {
    const email = String(cliente?.emailEmpresa || cliente?.emailContato || cliente?.email || "").trim();
    if (!email) {
      alert("E-mail do cliente nao cadastrado.");
      return;
    }
    const assunto = `Fatura ${String(fatura?.refMes || "").trim() || ""}`.trim();
    const corpo = montarMensagemCobranca(cliente, fatura);
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
  };

  const criarFaturaManual = async (cliente) => {
    const tenant = String(cliente?.tenantId || "").trim();
    if (!tenant) {
      alert("Cliente sem tenantId.");
      return;
    }

    const refMesOk = normalizarRefMes(finRefMes);
    if (!refMesOk) {
      alert("Mes de referencia invalido. Use YYYY-MM (ex: 2026-04).");
      return;
    }

    const valor = Number(String(finValorFatura || "").replace(",", "."));
    if (!Number.isFinite(valor) || valor < 0) {
      alert("Valor invalido.");
      return;
    }

    const forma = String(finFormaFatura || cliente?.formaPagamento || "PIX").toUpperCase();
    if (!FORMAS_PAGAMENTO.includes(forma)) {
      alert("Forma de pagamento invalida.");
      return;
    }

    const dia = Number(String(finDiaVenc || "").replace(/\D/g, ""));
    const vencISO = calcularVencimentoISO(refMesOk, dia);
    if (!vencISO) {
      alert("Dia do vencimento invalido (use 1 a 28).");
      return;
    }

    const link = String(finLinkPagamento || "").trim();
    const pix = String(finPixChave || "").trim();
    if (!link && !pix) {
      const ok = window.confirm("Voce nao informou link nem PIX. Deseja criar a fatura mesmo assim?");
      if (!ok) return;
    }

    // Evita duplicar refMes do mesmo tenant.
    const dupSnap = await getDocs(
      query(collection(db, "faturasSistema"), where("tenantId", "==", tenant), where("refMes", "==", refMesOk))
    );
    if (!dupSnap.empty) {
      alert(`Ja existe fatura para ${refMesOk}.`);
      return;
    }

    const agora = new Date().toISOString();
    const payload = {
      tenantId: tenant,
      clienteId: String(cliente?.id || ""),
      cnpj: String(cliente?.cnpj || "").trim(),
      refMes: refMesOk,
      vencimentoISO: vencISO,
      valor,
      status: "PENDENTE",
      formaPagamento: forma,
      linkPagamento: link,
      pixChave: pix,
      criadoEmISO: agora,
      atualizadoEmISO: agora
    };

    try {
      await addDoc(collection(db, "faturasSistema"), payload);
      await carregarFaturasCliente(cliente);
      alert(`Fatura criada para ${refMesOk}.`);
    } catch (e) {
      alert(`Falha ao criar fatura: ${String(e?.message || e || "")}`);
    }
  };

  const atualizarStatusFatura = async (faturaId, statusNovo, cliente) => {
    const st = String(statusNovo || "").toUpperCase();
    if (!["PENDENTE", "PAGO", "CANCELADO"].includes(st)) return;
    try {
      await updateDoc(doc(db, "faturasSistema", String(faturaId)), { status: st, atualizadoEmISO: new Date().toISOString() });
      await carregarFaturasCliente(cliente);
    } catch (e) {
      alert(`Falha ao atualizar status: ${String(e?.message || e || "")}`);
    }
  };

  const salvarDiaVencimento = async (item) => {
    const dia = Number(String(finDiaVenc || "").replace(/\D/g, ""));
    if (!Number.isFinite(dia) || dia < 1 || dia > 28) {
      alert("Dia do vencimento invalido. Use 1 a 28.");
      return;
    }
    try {
      await updateDoc(doc(db, "clientesSistema", item.id), { diaVencimento: dia, atualizadoEm: new Date().toISOString() });
      await carregar();
      alert("Dia de vencimento salvo.");
    } catch (e) {
      alert(`Falha ao salvar vencimento: ${String(e?.message || e || "")}`);
    }
  };

  const marcarPago = async (item, ref) => {
    const alvo = String(ref || "").trim();
    if (!alvo) return;
    try {
      await updateDoc(doc(db, "clientesSistema", item.id), {
        pagoAteRef: alvo,
        status: "ATIVO",
        ultimoPagamentoEm: new Date().toISOString(),
        atualizadoEm: new Date().toISOString()
      });
      await carregar();
      alert(`Marcado como PAGO ate ${alvo}.`);
    } catch (e) {
      alert(`Falha ao marcar pago: ${String(e?.message || e || "")}`);
    }
  };

  const excluirClienteMaster = async (item) => {
    const razao = String(item?.razaoSocial || "").trim() || "cliente";
    const confirmar = window.prompt(`Para excluir ${razao}, digite EXCLUIR`);
    if (!confirmarTexto(confirmar, "EXCLUIR")) {
      alert("Exclusao cancelada.");
      return;
    }

    try {
      await deleteDoc(doc(db, "clientesSistema", item.id));
      await carregar();
      alert(`Cliente ${razao} excluido do Master com sucesso.`);
    } catch (error) {
      const detalhe = String(error?.code || error?.message || "erro-desconhecido");
      alert(`Falha ao excluir ${razao} do Master: ${detalhe}`);
    }
  };

  const parseDataFlex = (valor) => {
    const txt = String(valor || "").trim();
    const br = txt.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
    const iso = txt.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return null;
  };

  const baixarBlob = (blob, nomeArquivo) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch {}
    }, 30000);
  };

  const objetosParaCsv = (linhas) => {
    const rows = Array.isArray(linhas) ? linhas : [];
    const keys = new Set();
    rows.forEach((r) => Object.keys(r || {}).forEach((k) => keys.add(k)));
    const header = Array.from(keys);

    const esc = (v) => {
      const s = v === null || v === undefined ? "" : String(v);
      const needs = /[",\n\r;]/.test(s);
      const out = s.replace(/"/g, '""');
      return needs ? `"${out}"` : out;
    };

    const line = (arr) => arr.map(esc).join(";");
    const csv = [line(header)];
    rows.forEach((r) => {
      csv.push(line(header.map((k) => {
        const v = r?.[k];
        if (typeof v === "object") return JSON.stringify(v);
        return v;
      })));
    });
    return csv.join("\n");
  };

  const removerMidiasPesadas = (obj) => {
    const o = { ...(obj || {}) };
    const chavesParaRemover = [
      "assinatura",
      "assinaturaRecebedor",
      "assinaturaResponsavel",
      "assinaturaGestor",
      "croquiImagem",
      "croqui",
      "imagem",
      "foto",
      "base64",
      "dataUrl"
    ];
    chavesParaRemover.forEach((k) => {
      if (k in o) delete o[k];
    });
    return o;
  };

  const exportarDadosTenantZip = async (clienteItem) => {
    if (exportando) return;
    const tenant = String(clienteItem?.tenantId || "").trim().toLowerCase();
    if (!tenant) return alert("Cliente sem tenantId. Nao e possivel exportar.");

    if (exportDataIni && exportDataFim && exportDataIni > exportDataFim) {
      alert("Data inicial nao pode ser maior que a data final.");
      return;
    }

    const zip = new JSZip();
    const pasta = zip.folder(`tenant_${tenant}`);
    if (!pasta) return alert("Falha ao preparar ZIP.");

    const dtIni = exportDataIni ? new Date(`${exportDataIni}T00:00:00`) : null;
    const dtFim = exportDataFim ? new Date(`${exportDataFim}T23:59:59`) : null;

    const filtraPorPeriodo = (docObj) => {
      if (!dtIni && !dtFim) return true;
      const d = parseDataFlex(docObj?.data) || parseDataFlex(docObj?.dataCriacao) || parseDataFlex(docObj?.criadoEm);
      if (!d) return true; // se nao tiver data reconhecivel, nao exclui
      if (dtIni && d < dtIni) return false;
      if (dtFim && d > dtFim) return false;
      return true;
    };

    setExportando(true);
    try {
      // Exporta colecoes operacionais + rdo + configuracoes/empresaSistema.
      const colecoes = Array.from(new Set([...COLECOES_OPERACIONAIS, "rdo", "configuracoes"]));

      for (const nomeColecao of colecoes) {
        // eslint-disable-next-line no-await-in-loop
        let snap = null;
        if (nomeColecao === "configuracoes") {
          // configuracoes usa doc id fixo por tenant, mas tambem pode haver docs gerais.
          try {
            const cfg = await getDoc(doc(db, "configuracoes", `empresaSistema_${tenant}`));
            if (cfg.exists()) {
              const linha = { id: cfg.id, ...cfg.data() };
              const linhas = [exportIncluiMidias ? linha : removerMidiasPesadas(linha)];
              pasta.file("configuracoes.csv", objetosParaCsv(linhas));
            } else {
              pasta.file("configuracoes.csv", objetosParaCsv([]));
            }
            // eslint-disable-next-line no-continue
            continue;
          } catch {
            pasta.file("configuracoes.csv", objetosParaCsv([]));
            // eslint-disable-next-line no-continue
            continue;
          }
        }

        try {
          // eslint-disable-next-line no-await-in-loop
          snap = await getDocs(query(collection(db, nomeColecao), where("tenantId", "==", tenant)));
          const lista = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter(filtraPorPeriodo)
            .map((o) => (exportIncluiMidias ? o : removerMidiasPesadas(o)));
          pasta.file(`${nomeColecao}.csv`, objetosParaCsv(lista));
        } catch (e) {
          // fallback: sem where (caso colecao legada nao tenha tenantId em todos)
          try {
            // eslint-disable-next-line no-await-in-loop
            const snapAll = await getDocs(collection(db, nomeColecao));
            const lista = snapAll.docs
              .map((d) => ({ id: d.id, ...d.data() }))
              .filter((o) => String(o?.tenantId || "").trim().toLowerCase() === tenant)
              .filter(filtraPorPeriodo)
              .map((o) => (exportIncluiMidias ? o : removerMidiasPesadas(o)));
            pasta.file(`${nomeColecao}.csv`, objetosParaCsv(lista));
          } catch {
            pasta.file(`${nomeColecao}.csv`, objetosParaCsv([]));
          }
          // eslint-disable-next-line no-console
          console.log(e);
        }
      }

      const nomePeriodo =
        exportDataIni || exportDataFim ? `${exportDataIni || "inicio"}_${exportDataFim || "fim"}` : "tudo";
      const zipBlob = await zip.generateAsync({ type: "blob" });
      baixarBlob(zipBlob, `export_${tenant}_${nomePeriodo}.zip`);
      alert("Exportacao gerada. O download deve iniciar automaticamente.");
      setExportAbertoId("");
    } catch (e) {
      console.log(e);
      alert("Falha ao exportar agora. Tente novamente.");
    } finally {
      setExportando(false);
    }
  };

  const limparColecaoPorTenant = async (nomeColecao, tenantId) => {
    const snap = await getDocs(query(collection(db, nomeColecao), where("tenantId", "==", tenantId)));
    let removidos = 0;
    let falhas = 0;
    for (const item of snap.docs) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await deleteDoc(doc(db, nomeColecao, item.id));
        removidos += 1;
      } catch {
        falhas += 1;
      }
    }
    return { total: snap.size, removidos, falhas };
  };

  const limparColecaoCompleta = async (nomeColecao) => {
    const snap = await getDocs(collection(db, nomeColecao));
    let removidos = 0;
    let falhas = 0;
    for (const item of snap.docs) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await deleteDoc(doc(db, nomeColecao, item.id));
        removidos += 1;
      } catch {
        falhas += 1;
      }
    }
    return { total: snap.size, removidos, falhas };
  };

  const resetarTenantAtual = async () => {
    const tenant = String(tenantAtual || "").trim();
    if (!tenant) {
      alert("Tenant atual invalido.");
      return;
    }

    const confirmar = window.prompt(
      `Para confirmar o reset TOTAL do tenant ${tenant}, digite exatamente: RESETAR`
    );
    if (!confirmarTexto(confirmar, "RESETAR")) {
      alert("Reset cancelado.");
      return;
    }

    try {
      const resumo = {};
      let totalFalhas = 0;

      for (const nomeColecao of COLECOES_OPERACIONAIS) {
        // eslint-disable-next-line no-await-in-loop
        const resultadoColecao = await limparColecaoPorTenant(nomeColecao, tenant);
        resumo[nomeColecao] = resultadoColecao;
        totalFalhas += resultadoColecao.falhas;
      }

      const idsClientes = new Set();
      const clientesPorTenant = await getDocs(query(collection(db, "clientesSistema"), where("tenantId", "==", tenant)));
      clientesPorTenant.docs.forEach((item) => idsClientes.add(item.id));
      if (/^\d{14}$/.test(tenant)) {
        const clientesPorCnpj = await getDocs(query(collection(db, "clientesSistema"), where("cnpj", "==", tenant)));
        clientesPorCnpj.docs.forEach((item) => idsClientes.add(item.id));
      }

      let removidosClientes = 0;
      let falhasClientes = 0;
      for (const idCliente of idsClientes) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await deleteDoc(doc(db, "clientesSistema", idCliente));
          removidosClientes += 1;
        } catch {
          falhasClientes += 1;
        }
      }
      resumo.clientesSistema = { total: idsClientes.size, removidos: removidosClientes, falhas: falhasClientes };
      totalFalhas += falhasClientes;

      localStorage.removeItem("sessaoOperacional");
      localStorage.removeItem("usuarioLogado");
      localStorage.removeItem("credencialSimulacaoCliente");

      await carregar();

      if (totalFalhas > 0) {
        alert(`Reset do tenant ${tenant} concluido com pendencias: ${totalFalhas} exclusoes falharam. Tente novamente para finalizar.`);
        return;
      }
      alert(`Reset do tenant ${tenant} concluido com sucesso.`);
    } catch {
      alert("Falha no reset do tenant. Verifique permissao/conexao e tente novamente.");
    }
  };

  const resetarBaseMasterCompleta = async () => {
    const confirmar = window.prompt(
      "Para confirmar o reset TOTAL da base master (todos os tenants), digite exatamente: RESETAR TUDO"
    );
    if (!confirmarTexto(confirmar, "RESETAR TUDO")) {
      alert("Reset geral cancelado.");
      return;
    }

    try {
      const resultado = {};
      let totalFalhas = 0;

      for (const nomeColecao of COLECOES_OPERACIONAIS) {
        // eslint-disable-next-line no-await-in-loop
        const resultadoColecao = await limparColecaoCompleta(nomeColecao);
        resultado[nomeColecao] = resultadoColecao;
        totalFalhas += resultadoColecao.falhas;
      }

      const resultadoClientes = await limparColecaoCompleta("clientesSistema");
      resultado.clientesSistema = resultadoClientes;
      totalFalhas += resultadoClientes.falhas;

      localStorage.removeItem("sessaoOperacional");
      localStorage.removeItem("usuarioLogado");
      localStorage.removeItem("credencialSimulacaoCliente");
      setTenantId("tenant_local");

      await carregar();

      if (totalFalhas > 0) {
        alert(`Reset geral executado com pendencias: ${totalFalhas} exclusoes falharam. Execute novamente para concluir.`);
        return;
      }
      alert("Reset geral da base master concluido com sucesso.");
    } catch {
      alert("Falha no reset geral. Verifique permissao/conexao e tente novamente.");
    }
  };

  const formatarDataBR = (dataRef = new Date()) => {
    const dia = String(dataRef.getDate()).padStart(2, "0");
    const mes = String(dataRef.getMonth() + 1).padStart(2, "0");
    const ano = dataRef.getFullYear();
    return `${dia}/${mes}/${ano}`;
  };

  const formatarDataISO = (dataRef = new Date()) => {
    const dia = String(dataRef.getDate()).padStart(2, "0");
    const mes = String(dataRef.getMonth() + 1).padStart(2, "0");
    const ano = dataRef.getFullYear();
    return `${ano}-${mes}-${dia}`;
  };

  const gerarSimuladoOperacional = async () => {
    const tenant = String(tenantAtual || "").trim();
    if (!tenant) {
      alert("Tenant atual invalido.");
      return;
    }

    const confirmar = window.prompt(
      `Para gerar o SIMULADO operacional completo no tenant ${tenant}, digite exatamente: SIMULAR`
    );
    if (confirmar !== "SIMULAR") {
      alert("Simulado cancelado.");
      return;
    }

    const agora = new Date();
    const ontem = new Date(agora);
    ontem.setDate(agora.getDate() - 1);
    const anteontem = new Date(agora);
    anteontem.setDate(agora.getDate() - 2);

    const baseCruzeiro = {
      cidade: "CRUZEIRO DO SUL",
      estado: "AC",
      baseChave: "CRUZEIRO DO SUL__AC"
    };
    const baseSena = {
      cidade: "SENA MADUREIRA",
      estado: "AC",
      baseChave: "SENA MADUREIRA__AC"
    };

    const obraCruzeiroPadrao = "OBRA PILOTO CRUZEIRO";
    const obraSenaPadrao = "OBRA PILOTO SENA";
    const empresaNome = "CONSTRUTORA ALFA LTDA";
    const equipamentoA = "ESCAVADEIRA HIDRAULICA 320";
    const equipamentoB = "RETROESCAVADEIRA 410";
    const equipamentoC = "MOTONIVELADORA 140K";
    const operadorA = "JOAO SILVA";
    const operadorB = "CARLOS PEREIRA";
    const operadorC = "MARCOS LIMA";
    const operadorD = "PAULO SOUZA";
    const mecanico = "OFICINA TESTE";
    const frentista = "SIMULADOR MASTER";

    // Usa obras ja existentes por cidade (se nao existir, cria uma padrao).
    const snapObras = await getDocs(query(collection(db, "obras"), where("tenantId", "==", tenant)));
    const obrasTenant = snapObras.docs.map((d) => ({ id: d.id, ...d.data() }));
    let obraCruzeiroItem = obrasTenant.find((o) => String(o.cidade || "").trim().toUpperCase() === baseCruzeiro.cidade);
    let obraSenaItem = obrasTenant.find((o) => String(o.cidade || "").trim().toUpperCase() === baseSena.cidade);

    if (!obraCruzeiroItem) {
      const ref = await addDoc(
        collection(db, "obras"),
        withTenant(
          {
            nome: obraCruzeiroPadrao,
            cidade: baseCruzeiro.cidade,
            estado: baseCruzeiro.estado
          },
          tenant
        )
      );
      obraCruzeiroItem = { id: ref.id, nome: obraCruzeiroPadrao, cidade: baseCruzeiro.cidade, estado: baseCruzeiro.estado };
    }
    if (!obraSenaItem) {
      const ref = await addDoc(
        collection(db, "obras"),
        withTenant(
          {
            nome: obraSenaPadrao,
            cidade: baseSena.cidade,
            estado: baseSena.estado
          },
          tenant
        )
      );
      obraSenaItem = { id: ref.id, nome: obraSenaPadrao, cidade: baseSena.cidade, estado: baseSena.estado };
    }

    const obraCruzeiro = obraCruzeiroItem.nome;
    const obraSena = obraSenaItem.nome;

    // Empresa requisitante.
    await addDoc(
      collection(db, "empresas"),
      withTenant(
        {
          nome: empresaNome,
          documento: "00.000.000/0001-00",
          tipoDocumento: "CNPJ",
          responsavel: "RESPONSAVEL TESTE",
          telefone: "68990000000",
          email: "contato@construtoraalfa.com",
          dataCadastro: formatarDataBR(agora)
        },
        tenant
      )
    );

    // Equipamentos simulados.
    await addDoc(
      collection(db, "equipamentos"),
      withTenant(
        {
          categoria: "LINHA AMARELA",
          nome: equipamentoA,
          placa: "QWE1A23",
          marca: "CATERPILLAR",
          codigo: "EQ-320",
          dataEntrada: formatarDataBR(anteontem),
          proprietario: empresaNome
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "equipamentos"),
      withTenant(
        {
          categoria: "LINHA AMARELA",
          nome: equipamentoC,
          placa: "UIO7C89",
          marca: "CATERPILLAR",
          codigo: "EQ-140",
          dataEntrada: formatarDataBR(agora),
          proprietario: empresaNome
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "equipamentos"),
      withTenant(
        {
          categoria: "LINHA AMARELA",
          nome: equipamentoB,
          placa: "RTY4B56",
          marca: "JCB",
          codigo: "EQ-410",
          dataEntrada: formatarDataBR(ontem),
          proprietario: empresaNome
        },
        tenant
      )
    );

    // Funcionarios para EPI e Almoxarifado.
    await addDoc(
      collection(db, "funcionarios"),
      withTenant(
        {
          nome: operadorA,
          funcao: "OPERADOR DE MAQUINA",
          cpf: "11111111111",
          dataCadastro: formatarDataBR(agora)
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "funcionarios"),
      withTenant(
        {
          nome: operadorC,
          funcao: "MECANICO",
          cpf: "33333333333",
          dataCadastro: formatarDataBR(agora)
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "funcionarios"),
      withTenant(
        {
          nome: operadorD,
          funcao: "AJUDANTE",
          cpf: "44444444444",
          dataCadastro: formatarDataBR(agora)
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "funcionarios"),
      withTenant(
        {
          nome: operadorB,
          funcao: "OPERADOR DE MAQUINA",
          cpf: "22222222222",
          dataCadastro: formatarDataBR(agora)
        },
        tenant
      )
    );

    // Estoque de lubrificantes/combustivel por base.
    await addDoc(
      collection(db, "lubrificantes"),
      withTenant(
        {
          nome: "DIESEL S-10",
          tipo: "OLEO",
          marca: "SIMULADO",
          quantidade: 12000,
          preco: 6.45,
          total: 77400,
          unidade: "L",
          data: formatarDataISO(agora),
          nota: "NF-SIM-001",
          fornecedor: "DISTRIBUIDORA TESTE",
          categoria: "COMBUSTIVEL",
          estado: baseCruzeiro.estado,
          cidade: baseCruzeiro.cidade,
          baseChave: baseCruzeiro.baseChave
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "lubrificantes"),
      withTenant(
        {
          nome: "DIESEL S-500",
          tipo: "OLEO",
          marca: "SIMULADO",
          quantidade: 9000,
          preco: 6.15,
          total: 55350,
          unidade: "L",
          data: formatarDataISO(agora),
          nota: "NF-SIM-004",
          fornecedor: "DISTRIBUIDORA TESTE",
          categoria: "COMBUSTIVEL",
          estado: baseCruzeiro.estado,
          cidade: baseCruzeiro.cidade,
          baseChave: baseCruzeiro.baseChave
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "lubrificantes"),
      withTenant(
        {
          nome: "DIESEL S-10",
          tipo: "OLEO",
          marca: "SIMULADO",
          quantidade: 8200,
          preco: 6.45,
          total: 52890,
          unidade: "L",
          data: formatarDataISO(agora),
          nota: "NF-SIM-005",
          fornecedor: "DISTRIBUIDORA TESTE",
          categoria: "COMBUSTIVEL",
          estado: baseSena.estado,
          cidade: baseSena.cidade,
          baseChave: baseSena.baseChave
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "lubrificantes"),
      withTenant(
        {
          nome: "DIESEL S-500",
          tipo: "OLEO",
          marca: "SIMULADO",
          quantidade: 7600,
          preco: 6.15,
          total: 46740,
          unidade: "L",
          data: formatarDataISO(agora),
          nota: "NF-SIM-006",
          fornecedor: "DISTRIBUIDORA TESTE",
          categoria: "COMBUSTIVEL",
          estado: baseSena.estado,
          cidade: baseSena.cidade,
          baseChave: baseSena.baseChave
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "lubrificantes"),
      withTenant(
        {
          nome: "OLEO MOTOR 10W30",
          tipo: "OLEO",
          marca: "SIMULADO",
          quantidade: 220,
          preco: 23.9,
          total: 5258,
          unidade: "L",
          data: formatarDataISO(agora),
          nota: "NF-SIM-007",
          fornecedor: "DISTRIBUIDORA TESTE",
          categoria: "MOTOR",
          estado: baseSena.estado,
          cidade: baseSena.cidade,
          baseChave: baseSena.baseChave
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "lubrificantes"),
      withTenant(
        {
          nome: "GRAXA LITHIUM NLGI 2",
          tipo: "GRAXA",
          marca: "SIMULADO",
          quantidade: 75,
          preco: 35.9,
          total: 2692.5,
          unidade: "KG",
          data: formatarDataISO(agora),
          nota: "NF-SIM-008",
          fornecedor: "DISTRIBUIDORA TESTE",
          categoria: "GRAXA",
          estado: baseSena.estado,
          cidade: baseSena.cidade,
          baseChave: baseSena.baseChave
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "lubrificantes"),
      withTenant(
        {
          nome: "OLEO HIDRAULICO ISO 68",
          tipo: "OLEO",
          marca: "SIMULADO",
          quantidade: 280,
          preco: 21.9,
          total: 6132,
          unidade: "L",
          data: formatarDataISO(agora),
          nota: "NF-SIM-002",
          fornecedor: "DISTRIBUIDORA TESTE",
          categoria: "HIDRAULICO",
          estado: baseCruzeiro.estado,
          cidade: baseCruzeiro.cidade,
          baseChave: baseCruzeiro.baseChave
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "lubrificantes"),
      withTenant(
        {
          nome: "GRAXA EP2",
          tipo: "GRAXA",
          marca: "SIMULADO",
          quantidade: 80,
          preco: 32.5,
          total: 2600,
          unidade: "KG",
          data: formatarDataISO(agora),
          nota: "NF-SIM-003",
          fornecedor: "DISTRIBUIDORA TESTE",
          categoria: "GRAXA",
          estado: baseCruzeiro.estado,
          cidade: baseCruzeiro.cidade,
          baseChave: baseCruzeiro.baseChave
        },
        tenant
      )
    );

    // Lancamentos diarios.
    const lancamentos = [
      {
        data: formatarDataBR(anteontem),
        obra: obraCruzeiro,
        equipamento: equipamentoA,
        operador: operadorA,
        horimetroInicial: "1000",
        horimetroFinal: "1008.5",
        horas: 8.5,
        status: "EM CHUVA",
        descricao: "SIMULADO - PARALISADO POR CHUVA"
      },
      {
        data: formatarDataBR(ontem),
        obra: obraCruzeiro,
        equipamento: equipamentoC,
        operador: operadorC,
        horimetroInicial: "430",
        horimetroFinal: "433.2",
        horas: 3.2,
        status: "MECANICA",
        descricao: "SIMULADO - EQUIPAMENTO NA MECANICA"
      },
      {
        data: formatarDataBR(ontem),
        obra: obraSena,
        equipamento: equipamentoB,
        operador: operadorB,
        horimetroInicial: "540",
        horimetroFinal: "547.2",
        horas: 7.2,
        status: "A DISPOSICAO",
        descricao: "SIMULADO - APOIO OPERACIONAL"
      },
      {
        data: formatarDataBR(agora),
        obra: obraSena,
        equipamento: equipamentoA,
        operador: operadorD,
        horimetroInicial: "1008.5",
        horimetroFinal: "1016.8",
        horas: 8.3,
        status: "TRABALHANDO",
        descricao: "SIMULADO - EXECUCAO NORMAL"
      }
    ];
    for (const item of lancamentos) {
      // eslint-disable-next-line no-await-in-loop
      await addDoc(collection(db, "lancamentos"), withTenant({ ...item, dataCriacao: new Date().toISOString() }, tenant));
    }

    // Abastecimentos (4) com lubrificacao.
    const abastecimentos = [
      {
        data: formatarDataBR(anteontem),
        equipamento: equipamentoA,
        obra: obraCruzeiro,
        obraId: obraCruzeiroItem.id,
        obraCidade: baseCruzeiro.cidade,
        obraEstado: baseCruzeiro.estado,
        codigo: "EQ-320",
        placa: "QWE1A23",
        litros: 180,
        valor: 6.45,
        total: 1161,
        tipo: "DIESEL S-10",
        empresa: empresaNome,
        frentista,
        operador: operadorA,
        horimetro: "1008.5",
        req: "001",
        lubrificacoes: [{ produto: "OLEO HIDRAULICO ISO 68", quantidade: 2, unidade: "L" }],
        observacao: "SIMULADO - ABASTECIMENTO 1"
      },
      {
        data: formatarDataBR(ontem),
        equipamento: equipamentoC,
        obra: obraCruzeiro,
        obraId: obraCruzeiroItem.id,
        obraCidade: baseCruzeiro.cidade,
        obraEstado: baseCruzeiro.estado,
        codigo: "EQ-140",
        placa: "UIO7C89",
        litros: 130,
        valor: 6.15,
        total: 799.5,
        tipo: "DIESEL S-500",
        empresa: empresaNome,
        frentista,
        operador: operadorC,
        horimetro: "433.2",
        req: "002",
        lubrificacoes: [{ produto: "GRAXA EP2", quantidade: 1, unidade: "KG" }],
        observacao: "SIMULADO - ABASTECIMENTO 2"
      },
      {
        data: formatarDataBR(ontem),
        equipamento: equipamentoB,
        obra: obraSena,
        obraId: obraSenaItem.id,
        obraCidade: baseSena.cidade,
        obraEstado: baseSena.estado,
        codigo: "EQ-410",
        placa: "RTY4B56",
        litros: 160,
        valor: 6.45,
        total: 1032,
        tipo: "DIESEL S-10",
        empresa: empresaNome,
        frentista,
        operador: operadorB,
        horimetro: "807.0",
        req: "001",
        lubrificacoes: [{ produto: "OLEO MOTOR 10W30", quantidade: 2, unidade: "L" }],
        observacao: "SIMULADO - ABASTECIMENTO 3"
      },
      {
        data: formatarDataBR(agora),
        equipamento: equipamentoA,
        obra: obraSena,
        obraId: obraSenaItem.id,
        obraCidade: baseSena.cidade,
        obraEstado: baseSena.estado,
        codigo: "EQ-320",
        placa: "QWE1A23",
        litros: 120,
        valor: 6.15,
        total: 738,
        tipo: "DIESEL S-500",
        empresa: empresaNome,
        frentista,
        operador: operadorD,
        horimetro: "1016.8",
        req: "002",
        lubrificacoes: [{ produto: "GRAXA LITHIUM NLGI 2", quantidade: 1, unidade: "KG" }],
        observacao: "SIMULADO - ABASTECIMENTO 4"
      }
    ];
    for (const item of abastecimentos) {
      // eslint-disable-next-line no-await-in-loop
      await addDoc(
        collection(db, "abastecimentos"),
        withTenant(
          {
            ...item,
            assinatura: ASSINATURA_SIMULADA,
            criadoEm: new Date().toISOString(),
            dataHora: new Date().toLocaleString("pt-BR")
          },
          tenant
        )
      );
    }

    // Manutenção de equipamento.
    await addDoc(
      collection(db, "manutencoes"),
      withTenant(
        {
          tipoManutencao: "PREVENTIVA",
          equipamento: equipamentoA,
          codigoEquipamento: "EQ-320",
          placaEquipamento: "QWE1A23",
          requisitante: empresaNome,
          obra: obraCruzeiro,
          mecanico,
          dataExecucao: formatarDataISO(agora),
          horimetroKm: "1016.2",
          problemaRelatado: "SIMULADO - REVISAO PERÍODO",
          servicosExecutados: "TROCA DE FILTRO E VERIFICACAO GERAL",
          proximaManutencao: formatarDataISO(new Date(agora.getTime() + 1000 * 60 * 60 * 24 * 30)),
          observacao: "SIMULADO PARA TESTE DE RELATORIO",
          itens: [
            { tipo: "FILTRO", nome: "FILTRO HIDRAULICO", serie: "FH-320", quantidade: 1, valorUnitario: 220, total: 220, observacao: "" },
            { tipo: "OLEO", nome: "OLEO HIDRAULICO ISO 68", serie: "", quantidade: 8, valorUnitario: 21.9, total: 175.2, observacao: "" }
          ],
          totalManutencao: 395.2,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "manutencoes"),
      withTenant(
        {
          tipoManutencao: "CORRETIVA",
          equipamento: equipamentoB,
          codigoEquipamento: "EQ-410",
          placaEquipamento: "RTY4B56",
          requisitante: empresaNome,
          obra: obraSena,
          mecanico,
          dataExecucao: formatarDataISO(agora),
          horimetroKm: "807.0",
          problemaRelatado: "SIMULADO - VAZAMENTO HIDRAULICO",
          servicosExecutados: "TROCA DE MANGUEIRA E COMPLEMENTO DE OLEO",
          proximaManutencao: formatarDataISO(new Date(agora.getTime() + 1000 * 60 * 60 * 24 * 20)),
          observacao: "SIMULADO PARA TESTE DE RELATORIO SENA",
          itens: [
            { tipo: "MANGUEIRA", nome: "MANGUEIRA HIDRAULICA", serie: "MH-410", quantidade: 1, valorUnitario: 280, total: 280, observacao: "" },
            { tipo: "OLEO", nome: "OLEO HIDRAULICO ISO 68", serie: "", quantidade: 4, valorUnitario: 21.9, total: 87.6, observacao: "" }
          ],
          totalManutencao: 367.6,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );

    // EPI.
    await addDoc(
      collection(db, "epi_movimentacoes"),
      withTenant(
        {
          funcionario: operadorA,
          funcaoFuncionario: "OPERADOR DE MAQUINA",
          obra: obraCruzeiro,
          item: "CAPACETE",
          caEpi: "CA-12345",
          quantidade: 1,
          dataEntrega: formatarDataISO(ontem),
          observacaoEntrega: "SIMULADO - ENTREGA EPI",
          assinaturaEntrega: ASSINATURA_SIMULADA,
          status: "EM_USO",
          dataDevolucao: "",
          observacaoDevolucao: "",
          assinaturaDevolucao: "",
          entreguePor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "epi_movimentacoes"),
      withTenant(
        {
          funcionario: operadorC,
          funcaoFuncionario: "MECANICO",
          obra: obraCruzeiro,
          item: "OCULOS DE PROTECAO",
          caEpi: "CA-55555",
          quantidade: 1,
          dataEntrega: formatarDataISO(agora),
          observacaoEntrega: "SIMULADO - ENTREGA EPI",
          assinaturaEntrega: ASSINATURA_SIMULADA,
          status: "EM_USO",
          dataDevolucao: "",
          observacaoDevolucao: "",
          assinaturaDevolucao: "",
          entreguePor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "epi_movimentacoes"),
      withTenant(
        {
          funcionario: operadorD,
          funcaoFuncionario: "AJUDANTE",
          obra: obraSena,
          item: "BOTINA",
          caEpi: "CA-99999",
          quantidade: 1,
          dataEntrega: formatarDataISO(anteontem),
          observacaoEntrega: "SIMULADO - ENTREGA EPI",
          assinaturaEntrega: ASSINATURA_SIMULADA,
          status: "DEVOLVIDO",
          dataDevolucao: formatarDataISO(ontem),
          observacaoDevolucao: "SIMULADO - DEVOLUCAO",
          assinaturaDevolucao: ASSINATURA_SIMULADA,
          entreguePor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "epi_movimentacoes"),
      withTenant(
        {
          funcionario: operadorB,
          funcaoFuncionario: "OPERADOR DE MAQUINA",
          obra: obraSena,
          item: "LUVA DE RASPA",
          caEpi: "CA-67890",
          quantidade: 2,
          dataEntrega: formatarDataISO(anteontem),
          observacaoEntrega: "SIMULADO - ENTREGA EPI",
          assinaturaEntrega: ASSINATURA_SIMULADA,
          status: "DEVOLVIDO",
          dataDevolucao: formatarDataISO(agora),
          observacaoDevolucao: "SIMULADO - DEVOLUCAO",
          assinaturaDevolucao: ASSINATURA_SIMULADA,
          entreguePor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );

    // Almoxarifado: estoque + movimentacoes.
    await addDoc(
      collection(db, "almoxarifado_estoque_ferramentas"),
      withTenant(
        {
          nome: "MARRETA 5KG",
          quantidade: 6,
          baseCidade: baseCruzeiro.cidade,
          baseEstado: baseCruzeiro.estado,
          baseChave: baseCruzeiro.baseChave,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_estoque_ferramentas"),
      withTenant(
        {
          nome: "CHAVE INGLESA 18",
          quantidade: 10,
          baseCidade: baseCruzeiro.cidade,
          baseEstado: baseCruzeiro.estado,
          baseChave: baseCruzeiro.baseChave,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_estoque_ferramentas"),
      withTenant(
        {
          nome: "JOGO CHAVE ALLEN",
          quantidade: 7,
          baseCidade: baseSena.cidade,
          baseEstado: baseSena.estado,
          baseChave: baseSena.baseChave,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_estoque_ferramentas"),
      withTenant(
        {
          nome: "ALICATE UNIVERSAL",
          quantidade: 12,
          baseCidade: baseSena.cidade,
          baseEstado: baseSena.estado,
          baseChave: baseSena.baseChave,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_movimentacoes_ferramentas"),
      withTenant(
        {
          tipoMov: "ENTRADA",
          nome: "MARRETA 5KG",
          quantidade: 6,
          dataMov: formatarDataISO(anteontem),
          fornecedor: "FORNECEDOR FERRAMENTAS TESTE",
          observacao: "SIMULADO - ENTRADA DE FERRAMENTA",
          obra: "",
          funcionario: "",
          baseCidade: baseCruzeiro.cidade,
          baseEstado: baseCruzeiro.estado,
          baseChave: baseCruzeiro.baseChave,
          assinatura: "",
          criadoPor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_movimentacoes_ferramentas"),
      withTenant(
        {
          tipoMov: "ENTRADA",
          nome: "CHAVE INGLESA 18",
          quantidade: 10,
          dataMov: formatarDataISO(anteontem),
          fornecedor: "FORNECEDOR FERRAMENTAS TESTE",
          observacao: "SIMULADO - ENTRADA DE FERRAMENTA",
          obra: "",
          funcionario: "",
          baseCidade: baseCruzeiro.cidade,
          baseEstado: baseCruzeiro.estado,
          baseChave: baseCruzeiro.baseChave,
          assinatura: "",
          criadoPor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_movimentacoes_ferramentas"),
      withTenant(
        {
          tipoMov: "ENTRADA",
          nome: "JOGO CHAVE ALLEN",
          quantidade: 7,
          dataMov: formatarDataISO(ontem),
          fornecedor: "FORNECEDOR FERRAMENTAS TESTE",
          observacao: "SIMULADO - ENTRADA DE FERRAMENTA",
          obra: "",
          funcionario: "",
          baseCidade: baseSena.cidade,
          baseEstado: baseSena.estado,
          baseChave: baseSena.baseChave,
          assinatura: "",
          criadoPor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_movimentacoes_ferramentas"),
      withTenant(
        {
          tipoMov: "ENTRADA",
          nome: "ALICATE UNIVERSAL",
          quantidade: 12,
          dataMov: formatarDataISO(agora),
          fornecedor: "FORNECEDOR FERRAMENTAS TESTE",
          observacao: "SIMULADO - ENTRADA DE FERRAMENTA",
          obra: "",
          funcionario: "",
          baseCidade: baseSena.cidade,
          baseEstado: baseSena.estado,
          baseChave: baseSena.baseChave,
          assinatura: "",
          criadoPor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_movimentacoes"),
      withTenant(
        {
          funcionario: operadorA,
          obra: obraCruzeiro,
          item: "MARRETA 5KG",
          quantidade: 1,
          dataRetirada: formatarDataISO(ontem),
          observacaoRetirada: "SIMULADO - RETIRADA",
          assinaturaRetirada: ASSINATURA_SIMULADA,
          baseCidade: baseCruzeiro.cidade,
          baseEstado: baseCruzeiro.estado,
          baseChave: baseCruzeiro.baseChave,
          status: "EM_USO",
          dataDevolucao: "",
          observacaoDevolucao: "",
          assinaturaDevolucao: "",
          retiradoPor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_movimentacoes"),
      withTenant(
        {
          funcionario: operadorC,
          obra: obraCruzeiro,
          item: "CHAVE INGLESA 18",
          quantidade: 2,
          dataRetirada: formatarDataISO(ontem),
          observacaoRetirada: "SIMULADO - RETIRADA",
          assinaturaRetirada: ASSINATURA_SIMULADA,
          baseCidade: baseCruzeiro.cidade,
          baseEstado: baseCruzeiro.estado,
          baseChave: baseCruzeiro.baseChave,
          status: "EM_USO",
          dataDevolucao: "",
          observacaoDevolucao: "",
          assinaturaDevolucao: "",
          retiradoPor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_movimentacoes"),
      withTenant(
        {
          funcionario: operadorB,
          obra: obraSena,
          item: "JOGO CHAVE ALLEN",
          quantidade: 1,
          dataRetirada: formatarDataISO(ontem),
          observacaoRetirada: "SIMULADO - RETIRADA CONCLUIDA",
          assinaturaRetirada: ASSINATURA_SIMULADA,
          baseCidade: baseSena.cidade,
          baseEstado: baseSena.estado,
          baseChave: baseSena.baseChave,
          status: "DEVOLVIDO",
          dataDevolucao: formatarDataISO(agora),
          observacaoDevolucao: "SIMULADO - DEVOLUCAO REGISTRADA",
          assinaturaDevolucao: ASSINATURA_SIMULADA,
          retiradoPor: frentista,
          devolvidoPor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_movimentacoes"),
      withTenant(
        {
          funcionario: operadorA,
          obra: obraCruzeiro,
          item: "MARRETA 5KG",
          quantidade: 1,
          dataRetirada: formatarDataISO(ontem),
          observacaoRetirada: "SIMULADO - RETIRADA CONCLUIDA",
          assinaturaRetirada: ASSINATURA_SIMULADA,
          baseCidade: baseCruzeiro.cidade,
          baseEstado: baseCruzeiro.estado,
          baseChave: baseCruzeiro.baseChave,
          status: "DEVOLVIDO",
          dataDevolucao: formatarDataISO(agora),
          observacaoDevolucao: "SIMULADO - DEVOLUCAO REGISTRADA",
          assinaturaDevolucao: ASSINATURA_SIMULADA,
          retiradoPor: frentista,
          devolvidoPor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );

    await addDoc(
      collection(db, "almoxarifado_estoque_insumos"),
      withTenant(
        {
          nome: "CIMENTO CP-II",
          quantidade: 120,
          unidade: "SC",
          baseCidade: baseCruzeiro.cidade,
          baseEstado: baseCruzeiro.estado,
          baseChave: baseCruzeiro.baseChave,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_estoque_insumos"),
      withTenant(
        {
          nome: "BRITA 1",
          quantidade: 60,
          unidade: "M3",
          baseCidade: baseCruzeiro.cidade,
          baseEstado: baseCruzeiro.estado,
          baseChave: baseCruzeiro.baseChave,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_estoque_insumos"),
      withTenant(
        {
          nome: "AREIA MEDIA",
          quantidade: 70,
          unidade: "M3",
          baseCidade: baseSena.cidade,
          baseEstado: baseSena.estado,
          baseChave: baseSena.baseChave,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_estoque_insumos"),
      withTenant(
        {
          nome: "FERRO CA-50",
          quantidade: 90,
          unidade: "BR",
          baseCidade: baseSena.cidade,
          baseEstado: baseSena.estado,
          baseChave: baseSena.baseChave,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_movimentacoes_insumos"),
      withTenant(
        {
          tipoMov: "ENTRADA",
          nome: "CIMENTO CP-II",
          quantidade: 120,
          unidade: "SC",
          dataMov: formatarDataISO(anteontem),
          fornecedor: "FORNECEDOR TESTE",
          observacao: "SIMULADO - ENTRADA",
          baseCidade: baseCruzeiro.cidade,
          baseEstado: baseCruzeiro.estado,
          baseChave: baseCruzeiro.baseChave,
          obra: "",
          funcionario: "",
          assinatura: "",
          criadoPor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_movimentacoes_insumos"),
      withTenant(
        {
          tipoMov: "ENTRADA",
          nome: "BRITA 1",
          quantidade: 60,
          unidade: "M3",
          dataMov: formatarDataISO(anteontem),
          fornecedor: "FORNECEDOR TESTE",
          observacao: "SIMULADO - ENTRADA",
          baseCidade: baseCruzeiro.cidade,
          baseEstado: baseCruzeiro.estado,
          baseChave: baseCruzeiro.baseChave,
          obra: "",
          funcionario: "",
          assinatura: "",
          criadoPor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_movimentacoes_insumos"),
      withTenant(
        {
          tipoMov: "ENTRADA",
          nome: "AREIA MEDIA",
          quantidade: 70,
          unidade: "M3",
          dataMov: formatarDataISO(ontem),
          fornecedor: "FORNECEDOR TESTE",
          observacao: "SIMULADO - ENTRADA",
          baseCidade: baseSena.cidade,
          baseEstado: baseSena.estado,
          baseChave: baseSena.baseChave,
          obra: "",
          funcionario: "",
          assinatura: "",
          criadoPor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_movimentacoes_insumos"),
      withTenant(
        {
          tipoMov: "ENTRADA",
          nome: "FERRO CA-50",
          quantidade: 90,
          unidade: "BR",
          dataMov: formatarDataISO(agora),
          fornecedor: "FORNECEDOR TESTE",
          observacao: "SIMULADO - ENTRADA",
          baseCidade: baseSena.cidade,
          baseEstado: baseSena.estado,
          baseChave: baseSena.baseChave,
          obra: "",
          funcionario: "",
          assinatura: "",
          criadoPor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_movimentacoes_insumos"),
      withTenant(
        {
          tipoMov: "SAIDA",
          nome: "CIMENTO CP-II",
          quantidade: 8,
          unidade: "SC",
          dataMov: formatarDataISO(ontem),
          fornecedor: "",
          observacao: "SIMULADO - SAIDA PARA OBRA SENA",
          baseCidade: baseCruzeiro.cidade,
          baseEstado: baseCruzeiro.estado,
          baseChave: baseCruzeiro.baseChave,
          obra: obraSena,
          funcionario: operadorB,
          assinatura: ASSINATURA_SIMULADA,
          criadoPor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_movimentacoes_insumos"),
      withTenant(
        {
          tipoMov: "SAIDA",
          nome: "BRITA 1",
          quantidade: 8,
          unidade: "M3",
          dataMov: formatarDataISO(agora),
          fornecedor: "",
          observacao: "SIMULADO - SAIDA PARA OBRA",
          baseCidade: baseCruzeiro.cidade,
          baseEstado: baseCruzeiro.estado,
          baseChave: baseCruzeiro.baseChave,
          obra: obraCruzeiro,
          funcionario: operadorC,
          assinatura: ASSINATURA_SIMULADA,
          criadoPor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_movimentacoes_insumos"),
      withTenant(
        {
          tipoMov: "SAIDA",
          nome: "AREIA MEDIA",
          quantidade: 10,
          unidade: "M3",
          dataMov: formatarDataISO(agora),
          fornecedor: "",
          observacao: "SIMULADO - SAIDA PARA OBRA SENA",
          baseCidade: baseSena.cidade,
          baseEstado: baseSena.estado,
          baseChave: baseSena.baseChave,
          obra: obraSena,
          funcionario: operadorB,
          assinatura: ASSINATURA_SIMULADA,
          criadoPor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_movimentacoes_insumos"),
      withTenant(
        {
          tipoMov: "SAIDA",
          nome: "FERRO CA-50",
          quantidade: 15,
          unidade: "BR",
          dataMov: formatarDataISO(agora),
          fornecedor: "",
          observacao: "SIMULADO - SAIDA PARA OBRA SENA",
          baseCidade: baseSena.cidade,
          baseEstado: baseSena.estado,
          baseChave: baseSena.baseChave,
          obra: obraSena,
          funcionario: operadorD,
          assinatura: ASSINATURA_SIMULADA,
          criadoPor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );
    await addDoc(
      collection(db, "almoxarifado_movimentacoes_insumos"),
      withTenant(
        {
          tipoMov: "SAIDA",
          nome: "CIMENTO CP-II",
          quantidade: 12,
          unidade: "SC",
          dataMov: formatarDataISO(agora),
          fornecedor: "",
          observacao: "SIMULADO - SAIDA PARA OBRA",
          baseCidade: baseCruzeiro.cidade,
          baseEstado: baseCruzeiro.estado,
          baseChave: baseCruzeiro.baseChave,
          obra: obraCruzeiro,
          funcionario: operadorA,
          assinatura: ASSINATURA_SIMULADA,
          criadoPor: frentista,
          criadoEm: new Date().toISOString()
        },
        tenant
      )
    );

    await carregar();
    alert(
      "Simulado criado com sucesso no tenant atual.\n\n" +
      "- 2 bases (Cruzeiro do Sul e Sena Madureira)\n" +
      "- 1 empresa requisitante\n" +
      "- 3 equipamentos\n" +
      "- 4 funcionarios\n" +
      "- 4 lancamentos (chuva, disposicao, mecanica e trabalhando)\n" +
      "- 4 abastecimentos (S-10 e S-500)\n" +
      "- entradas de diesel/lubrificantes nas 2 bases\n" +
      "- 2 manutencoes (Cruzeiro e Sena)\n" +
      "- 4 registros de EPI\n" +
      "- 4 entradas de ferramentas + retiradas\n" +
      "- 4 entradas de insumos + saidas"
    );
  };

  const usarCliente = (item) => {
    if (item.status !== "ATIVO" && item.status !== "TESTE") {
      alert("Esse cliente nao esta liberado para uso.");
      return;
    }
    const tenant = setTenantId(item.tenantId || String(item.cnpj || "").replace(/\D/g, ""));
    localStorage.removeItem("sessaoOperacional");
    localStorage.removeItem("usuarioLogado");
    alert(`Cliente ativo selecionado: ${item.razaoSocial}\nTenant: ${tenant}`);
  };

  const listaFiltrada = useMemo(() => {
    const termo = String(busca || "").toLowerCase().trim();
    if (!termo) return lista;
    return lista.filter(
      (item) =>
        String(item.razaoSocial || "").toLowerCase().includes(termo) ||
        String(item.nomeFantasia || "").toLowerCase().includes(termo) ||
        String(item.cnpj || "").includes(termo) ||
        String(item.tenantId || "").toLowerCase().includes(termo)
    );
  }, [lista, busca]);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 20, background: "#f5f7fa", minHeight: "100vh" }}>
      <h2 style={{ textAlign: "center", marginBottom: 14 }}>Painel Master - Gestao Comercial e Clientes</h2>
      <div style={{ ...card, marginBottom: 12, background: "#e9f2ff", border: "1px solid #bfd7ff" }}>
        <strong>Tenant atual em uso:</strong> {tenantAtual}
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Seguranca do Master</h3>
        <p style={{ marginTop: 0, color: "#5c6f88" }}>
          Aqui voce altera a senha do login Master (e-mail/senha). Para recuperar sem estar logado, use "Esqueci a senha" na tela de login.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8 }}>
          <input
            style={inputStyle}
            type="password"
            placeholder="Senha atual"
            value={senhaAtualMaster}
            onChange={(e) => setSenhaAtualMaster(e.target.value)}
          />
          <input
            style={inputStyle}
            type="password"
            placeholder="Nova senha"
            value={novaSenhaMaster}
            onChange={(e) => setNovaSenhaMaster(e.target.value)}
          />
          <input
            style={inputStyle}
            type="password"
            placeholder="Confirmar nova senha"
            value={novaSenhaMaster2}
            onChange={(e) => setNovaSenhaMaster2(e.target.value)}
          />
        </div>
        <button
          style={primaryButton}
          onClick={async () => {
            if (!senhaAtualMaster || !novaSenhaMaster) {
              alert("Informe a senha atual e a nova senha.");
              return;
            }
            if (novaSenhaMaster !== novaSenhaMaster2) {
              alert("A confirmacao da nova senha nao confere.");
              return;
            }
            const r = await alterarSenhaMaster({ senhaAtual: senhaAtualMaster, novaSenha: novaSenhaMaster });
            if (!r.ok) {
              alert(r.erro || "Nao foi possivel alterar a senha.");
              return;
            }
            alert("Senha do Master alterada com sucesso.");
            setSenhaAtualMaster("");
            setNovaSenhaMaster("");
            setNovaSenhaMaster2("");
          }}
        >
          ALTERAR SENHA MASTER
        </button>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Contato comercial e suporte (Login)</h3>
        <p style={{ marginTop: 0, color: "#5c6f88" }}>
          Configure os links de WhatsApp exibidos na tela de entrada para novos clientes e suporte.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 8 }}>
          <input
            style={inputStyle}
            placeholder="WhatsApp Vendas (numero ou link)"
            value={whatsVendas}
            onChange={(e) => setWhatsVendas(e.target.value)}
          />
          <input
            style={inputStyle}
            placeholder="WhatsApp Suporte (numero ou link)"
            value={whatsSuporte}
            onChange={(e) => setWhatsSuporte(e.target.value)}
          />
        </div>
        <button
          style={primaryButton}
          onClick={() => {
            const salvo = salvarContatoComercialConfig({
              vendasWhatsappUrl: whatsVendas,
              suporteWhatsappUrl: whatsSuporte
            });
            setWhatsVendas(salvo.vendasWhatsappUrl);
            setWhatsSuporte(salvo.suporteWhatsappUrl);
            alert("Contatos salvos com sucesso.");
          }}
        >
          SALVAR CONTATOS
        </button>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Cadastro completo da empresa cliente</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8 }}>
          <input style={inputStyle} placeholder="Razao social" value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} />
          <input style={inputStyle} placeholder="Nome fantasia" value={nomeFantasia} onChange={(e) => setNomeFantasia(e.target.value)} />
          <div style={{ display: "flex", gap: 8, gridColumn: "span 2", alignItems: "stretch" }}>
            <input
              style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
              placeholder="CNPJ"
              value={cnpj}
              onChange={(e) => setCnpj(formatarCnpj(e.target.value))}
              onBlur={() => consultarCnpj(true)}
            />
            <button
              type="button"
              style={{ ...primaryButton, minWidth: 140, height: 42, alignSelf: "flex-start", opacity: consultandoCnpj ? 0.7 : 1 }}
              onClick={() => consultarCnpj(true)}
              disabled={consultandoCnpj}
            >
              {consultandoCnpj ? "BUSCANDO..." : "BUSCAR CNPJ"}
            </button>
          </div>
          <input style={inputStyle} placeholder="Inscricao estadual" value={inscricaoEstadual} onChange={(e) => setInscricaoEstadual(e.target.value)} />
          <input style={inputStyle} placeholder="Logradouro" value={logradouro} onChange={(e) => setLogradouro(e.target.value)} />
          <input style={inputStyle} placeholder="Numero" value={numero} onChange={(e) => setNumero(e.target.value)} />
          <input style={inputStyle} placeholder="Bairro" value={bairro} onChange={(e) => setBairro(e.target.value)} />
          <input style={inputStyle} placeholder="CEP" value={cep} onChange={(e) => setCep(formatarCep(e.target.value))} />
          <input style={inputStyle} placeholder="Cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} />
          <input style={inputStyle} placeholder="UF" value={uf} maxLength={2} onChange={(e) => setUf(upper(e.target.value).slice(0, 2))} />
          <input
            style={inputStyle}
            placeholder="Endereco completo (montado automaticamente)"
            value={endereco}
            readOnly
          />
          <input style={inputStyle} placeholder="Endereco de cobranca" value={enderecoCobranca} onChange={(e) => setEnderecoCobranca(e.target.value)} />
          <input style={inputStyle} placeholder="Telefone" value={telefone} onChange={(e) => setTelefone(formatarTelefone(e.target.value))} />
          <input style={inputStyle} placeholder="E-mail da empresa" value={emailContato} onChange={(e) => setEmailContato(e.target.value)} />

          <select
            style={inputStyle}
            value={planoId}
            onChange={(e) => {
              const id = e.target.value;
              setPlanoId(id);
              recalcularValorCadastro(id, cicloPlanoMeses);
            }}
          >
            {PLANOS.map((plano) => (
              <option key={plano.id} value={plano.id}>
                {`${plano.nome} - R$ ${plano.valor}/mes | ${descreverPlano(plano)}`}
              </option>
            ))}
          </select>
          <select
            style={inputStyle}
            value={String(cicloPlanoMeses)}
            onChange={(e) => {
              const meses = Number(e.target.value || 1);
              setCicloPlanoMeses(meses);
              recalcularValorCadastro(planoId, meses);
            }}
          >
            {CICLOS_PLANOS.map((ciclo) => (
              <option key={ciclo.meses} value={ciclo.meses}>
                {ciclo.descontoPct > 0 ? `${ciclo.nome} - ${ciclo.descontoPct}% off` : ciclo.nome}
              </option>
            ))}
          </select>
          <input
            style={inputStyle}
            placeholder="Valor a cobrar (R$)"
            value={valorMensal}
            onChange={(e) => setValorMensal(e.target.value)}
          />
          <select style={inputStyle} value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value)}>
            {FORMAS_PAGAMENTO.map((forma) => (
              <option key={forma} value={forma}>{forma}</option>
            ))}
          </select>
          <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_CLIENTE.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
        {!!mensagemConsultaCnpj && (
          <div style={{ marginTop: 2, marginBottom: 10, fontSize: 12, color: consultandoCnpj ? "#0b5ed7" : "#43556d" }}>
            {mensagemConsultaCnpj}
          </div>
        )}
        {(() => {
          const planoAtual = PLANOS.find((p) => p.id === planoId);
          if (!planoAtual) return null;
          const calc = calcularPrecoPlano(planoAtual.valor, cicloPlanoMeses);
          return (
            <>
              <div style={{ marginTop: 4, fontSize: 13, color: "#43556d" }}>
                {calc.cicloMeses === 1 ? (
                  <span>Mensal sem desconto: <strong>R$ {formatarMoedaBR(calc.total)}</strong></span>
                ) : (
                  <span>
                    Pacote {calc.cicloMeses} meses: <strong>R$ {formatarMoedaBR(calc.total)}</strong>{" "}
                    ({calc.descontoPct}% off | equivale a R$ {formatarMoedaBR(calc.equivalenteMensal)}/mes)
                  </span>
                )}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: "#5a6b82" }}>
                Excedentes: <strong>ADM extra R$ {formatarMoedaBR(VALOR_ADMIN_EXTRA)}/mes</strong> e{" "}
                <strong>Operador extra R$ {formatarMoedaBR(VALOR_OPERADOR_EXTRA)}/mes</strong>.
              </div>
            </>
          );
        })()}

        {mostrarFerramentasPerigosas && (
          <>
            <h3 style={{ marginTop: 12 }}>Acesso inicial do cliente (simulacao)</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8 }}>
              <input style={inputStyle} placeholder="Nome do gestor" value={nomeGestor} onChange={(e) => setNomeGestor(e.target.value)} />
              <input style={inputStyle} placeholder="E-mail do gestor" value={emailGestor} onChange={(e) => setEmailGestor(e.target.value)} />
              <input style={inputStyle} placeholder="Senha temporaria" value={senhaTemporaria} onChange={(e) => setSenhaTemporaria(e.target.value)} />
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
          <button style={primaryButton} onClick={salvar}>SALVAR CLIENTE</button>
          {mostrarFerramentasPerigosas && (
            <>
              <button
                style={dangerButton}
                onClick={resetarTenantAtual}
              >
                ZERAR DADOS DO TENANT ATUAL
              </button>
              <button
                style={{ ...dangerButton, background: "#a61e2a" }}
                onClick={resetarBaseMasterCompleta}
              >
                ZERAR BASE MASTER COMPLETA
              </button>
              <button
                style={{ ...primaryButton, background: "#0b5ed7" }}
                onClick={gerarSimuladoOperacional}
              >
                GERAR SIMULADO OPERACIONAL
              </button>
            </>
          )}
          <button
            style={{ ...secondaryButton, background: "#dc3545" }}
            onClick={async () => {
              await masterLogout();
              setTela("masterLogin");
            }}
          >
            SAIR DO MASTER
          </button>
        </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Empresas clientes cadastradas</h3>
        <input
          style={{ ...inputStyle, marginBottom: 14 }}
          placeholder="Buscar cliente..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />

        <div style={{ width: "100%", overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 1080, borderCollapse: "collapse", background: "#fff", borderRadius: 8, overflow: "hidden", tableLayout: "fixed" }}>
          <thead style={{ background: "#0b3d91", color: "#fff" }}>
            <tr>
              <th style={{ border: "1px solid #ccc", padding: 8, width: "17%" }}>Razao Social</th>
              <th style={{ border: "1px solid #ccc", padding: 8, width: "14%" }}>CNPJ</th>
              <th style={{ border: "1px solid #ccc", padding: 8, width: "21%" }}>Plano</th>
              <th style={{ border: "1px solid #ccc", padding: 8, width: "9%" }}>Pagamento</th>
              <th style={{ border: "1px solid #ccc", padding: 8, width: "9%" }}>Status</th>
              <th style={{ border: "1px solid #ccc", padding: 8, width: "15%" }}>Acesso Inicial</th>
              <th style={{ border: "1px solid #ccc", padding: 8, width: "15%" }}>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {listaFiltrada.length === 0 && (
              <tr>
                <td colSpan="7" style={{ textAlign: "center", padding: 12 }}>
                  Nenhum cliente cadastrado.
                </td>
              </tr>
            )}
            {listaFiltrada.map((item, index) => (
              <tr key={item.id} style={{ background: index % 2 === 0 ? "#f2f2f2" : "#fff" }}>
                <td style={{ border: "1px solid #ccc", padding: 8, verticalAlign: "middle", wordBreak: "break-word" }}>{item.razaoSocial || "-"}</td>
                <td
                  style={{
                    border: "1px solid #ccc",
                    padding: 8,
                    textAlign: "center",
                    whiteSpace: "nowrap",
                    wordBreak: "normal",
                    overflowWrap: "normal"
                  }}
                >
                  {formatarCnpj(item.cnpj || "")}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 8, textAlign: "center", verticalAlign: "middle", overflowWrap: "anywhere" }}>
                  {clientePlanoEdicaoId === item.id ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <select
                        style={{ width: "100%", height: 34, borderRadius: 6, border: "1px solid #c9d2df", padding: "0 8px" }}
                        value={planoEdicaoId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setPlanoEdicaoId(id);
                          recalcularValorEdicaoPlano(id, cicloPlanoEdicaoMeses);
                        }}
                      >
                        {PLANOS.map((plano) => (
                          <option key={plano.id} value={plano.id}>
                            {`${plano.nome} - R$ ${plano.valor}`}
                          </option>
                        ))}
                      </select>
                      <select
                        style={{ width: "100%", height: 34, borderRadius: 6, border: "1px solid #c9d2df", padding: "0 8px" }}
                        value={String(cicloPlanoEdicaoMeses)}
                        onChange={(e) => {
                          const meses = Number(e.target.value || 1);
                          setCicloPlanoEdicaoMeses(meses);
                          recalcularValorEdicaoPlano(planoEdicaoId, meses);
                        }}
                      >
                        {CICLOS_PLANOS.map((ciclo) => (
                          <option key={ciclo.meses} value={ciclo.meses}>
                            {ciclo.descontoPct > 0 ? `${ciclo.nome} - ${ciclo.descontoPct}% off` : ciclo.nome}
                          </option>
                        ))}
                      </select>
                      <input
                        style={{ width: "100%", height: 34, borderRadius: 6, border: "1px solid #c9d2df", padding: "0 8px", boxSizing: "border-box" }}
                        value={valorPlanoEdicao}
                        onChange={(e) => setValorPlanoEdicao(e.target.value)}
                        placeholder="Valor a cobrar"
                      />
                    </div>
                  ) : (
                    <>
                      {(() => {
                        const ciclo = obterCicloPlano(item?.cicloPlanoMeses || 1);
                        const valorCobrado = Number(item?.valorMensal || 0);
                        const equivalente = Number(item?.valorMensalEquivalente || (ciclo.meses > 0 ? valorCobrado / ciclo.meses : valorCobrado));
                        return (
                          <>
                      {item.planoNome || item.planoId} <br />
                      <strong>
                        {ciclo.meses === 1
                          ? `R$ ${Number(item.valorMensal || 0).toLocaleString("pt-BR")}/mes`
                          : `R$ ${valorCobrado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} / ${ciclo.nome}`}
                      </strong>
                      {ciclo.meses > 1 && (
                        <>
                          <br />
                          <span style={{ fontSize: 12 }}>
                            {ciclo.descontoPct}% off | equivale a R$ {equivalente.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}/mes
                          </span>
                        </>
                      )}
                      <br />
                      <span style={{ fontSize: 12 }}>
                        {descreverPlano({
                          limiteAdmins: Number(item.limiteAdminsPlano || 0),
                          limiteOperadores:
                            item.limiteOperadoresPlano === null || Number(item.limiteOperadoresPlano) <= 0
                              ? null
                              : Number(item.limiteOperadoresPlano)
                        })}
                      </span>
                      <br />
                      <span style={{ fontSize: 12 }}>
                        ADM extra: R$ {formatarMoedaBR(item?.valorAdminExtra || VALOR_ADMIN_EXTRA)}/mes | Operador extra: R${" "}
                        {formatarMoedaBR(item?.valorOperadorExtra || VALOR_OPERADOR_EXTRA)}/mes
                      </span>
                          </>
                        );
                      })()}
                    </>
                  )}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 8, textAlign: "center", verticalAlign: "middle" }}>{item.formaPagamento || "-"}</td>
                <td style={{ border: "1px solid #ccc", padding: 8, textAlign: "center", fontWeight: "bold", verticalAlign: "middle" }}>
                  <div>{item.status || "-"}</div>
                  {(() => {
                    const prazo = obterResumoPrazoCliente(item);
                    return (
                      <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, color: prazo.cor || "#5f6f86", lineHeight: 1.2 }}>
                        {prazo.texto}
                      </div>
                    );
                  })()}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 8, fontSize: 12, verticalAlign: "middle", lineHeight: 1.25 }}>
                  <div
                    title={item.acessoInicial?.emailGestor || "-"}
                    style={{
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis"
                    }}
                  >
                    {item.acessoInicial?.emailGestor || "-"}
                  </div>
                  <div style={{ marginTop: 4, fontWeight: "bold" }}>
                    {item.acessoInicial?.senhaTemporaria || "-"}
                  </div>
                </td>
                <td style={{ border: "1px solid #ccc", padding: 8, verticalAlign: "middle", position: "relative" }}>
                  {(() => {
                    const isAberto = String(acoesAbertoId || "") === String(item.id || "");
                    return (
                      <div style={{ display: "grid", gap: 8, justifyItems: "center" }}>
                        <button
                          type="button"
                          style={{ ...primaryButton, padding: "7px 12px", minWidth: 110 }}
                          onClick={(ev) => {
                            const next = isAberto ? "" : String(item.id);
                            if (!next) {
                              setAcoesAbertoId("");
                              setAcoesAnchorRect(null);
                              setAcoesMenuPos(null);
                              return;
                            }
                            // Guarda o retangulo do botao; o effect vai reposicionar para nao cortar na tela.
                            try {
                              const rect = ev.currentTarget.getBoundingClientRect();
                              setAcoesAnchorRect(rect);
                              // Posicao inicial (antes de medir altura real do menu)
                              const width = 190;
                              const padding = 10;
                              const top = rect.bottom + 6;
                              let left = rect.right - width;
                              if (left < padding) left = padding;
                              if (left + width > window.innerWidth - padding) left = Math.max(padding, window.innerWidth - padding - width);
                              setAcoesMenuPos({ top, left, width });
                            } catch {
                              setAcoesAnchorRect(null);
                              setAcoesMenuPos({ top: 120, left: 40, width: 190 });
                            }
                            setAcoesAbertoId(next);
                          }}
                        >
                          Acoes
                        </button>
                      </div>
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {acoesAbertoId && acoesMenuPos && (() => {
        const item = lista.find((c) => String(c.id) === String(acoesAbertoId));
        if (!item) return null;
        const isEditandoPlano = clientePlanoEdicaoId === item.id;
        return (
          <div
            ref={acoesMenuRef}
            style={{
              position: "fixed",
              top: acoesMenuPos.top,
              left: acoesMenuPos.left,
              zIndex: 9999,
              width: acoesMenuPos.width || 190,
              background: "#fff",
              border: "1px solid #dbe3ee",
              borderRadius: 10,
              boxShadow: "0 12px 26px rgba(15, 36, 64, 0.18)",
              padding: 10,
              display: "grid",
              gap: 8,
              maxHeight: "calc(100vh - 20px)",
              overflowY: "auto"
            }}
          >
            <button
              type="button"
              style={{ ...successButton, width: "100%" }}
              onClick={() => {
                setAcoesAbertoId("");
                usarCliente(item);
              }}
            >
              Usar cliente
            </button>

            <button
              type="button"
              style={{ ...warningButton, marginLeft: 0, width: "100%" }}
              onClick={() => {
                setAcoesAbertoId("");
                alternarStatus(item);
              }}
            >
              {item.status === "ATIVO" ? "Inativar" : "Ativar"}
            </button>

            {!isEditandoPlano ? (
              <button
                type="button"
                style={{ ...primaryButton, padding: "7px 12px", width: "100%" }}
                onClick={() => {
                  setAcoesAbertoId("");
                  iniciarEdicaoPlano(item);
                }}
              >
                Alterar plano
              </button>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button
                  type="button"
                  style={{ ...successButton, width: "100%", marginLeft: 0 }}
                  onClick={() => {
                    setAcoesAbertoId("");
                    salvarEdicaoPlano(item);
                  }}
                >
                  Salvar
                </button>
                <button
                  type="button"
                  style={{ ...secondaryButton, padding: "7px 12px", width: "100%", marginLeft: 0 }}
                  onClick={() => {
                    setAcoesAbertoId("");
                    cancelarEdicaoPlano();
                  }}
                >
                  Cancelar
                </button>
              </div>
            )}

            <button
              type="button"
              style={{ ...secondaryButton, padding: "7px 12px", width: "100%", marginLeft: 0 }}
              onClick={() => {
                setAcoesAbertoId("");
                ativarTeste10Dias(item);
              }}
            >
              {String(item.status || "").toUpperCase() === "TESTE" ? "Reiniciar teste 10 dias" : "Ativar teste 10 dias"}
            </button>

            <button
              type="button"
              style={{ ...secondaryButton, padding: "7px 12px", width: "100%", marginLeft: 0, background: "#0b7285" }}
              onClick={() => {
                setAcoesAbertoId("");
                setExportAbertoId(String(item.id || ""));
                setExportDataIni("");
                setExportDataFim("");
                setExportIncluiMidias(false);
              }}
            >
              Exportar dados (ZIP)
            </button>

            <button
              type="button"
              style={{ ...secondaryButton, padding: "7px 12px", width: "100%", marginLeft: 0, background: "#6f42c1" }}
              onClick={() => {
                setAcoesAbertoId("");
                abrirFinanceiroCliente(item);
              }}
            >
              Financeiro (vencimento/pagamento)
            </button>

            <button
              type="button"
              style={{ ...dangerButton, padding: "7px 12px", marginLeft: 0, width: "100%" }}
              onClick={() => {
                setAcoesAbertoId("");
                excluirClienteMaster(item);
              }}
            >
              Excluir
            </button>
          </div>
        );
      })()}

      {exportAbertoId && (() => {
        const item = lista.find((c) => String(c.id) === String(exportAbertoId));
        if (!item) return null;
        return (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.45)",
              zIndex: 10000,
              display: "grid",
              placeItems: "center",
              padding: 14
            }}
            onClick={() => (exportando ? null : setExportAbertoId(""))}
            role="presentation"
          >
            <div
              style={{
                width: "min(780px, 96vw)",
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
                  <div style={{ fontSize: 18, fontWeight: 900, color: "#10243e" }}>Exportar dados do cliente (ZIP)</div>
                  <div style={{ marginTop: 2, color: "#546a84", fontSize: 13 }}>
                    {String(item?.razaoSocial || item?.nomeFantasia || "cliente").trim()} | tenant:{" "}
                    <strong>{String(item?.tenantId || "-").trim()}</strong>
                  </div>
                </div>
                <button
                  type="button"
                  style={{ ...secondaryButton, padding: "8px 12px" }}
                  onClick={() => (exportando ? null : setExportAbertoId(""))}
                >
                  Fechar
                </button>
              </div>

              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12, color: "#5a6b82" }}>Data inicial (opcional)</label>
                  <input
                    style={{ ...inputStyle, marginBottom: 0 }}
                    type="date"
                    value={exportDataIni}
                    onChange={(e) => setExportDataIni(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "#5a6b82" }}>Data final (opcional)</label>
                  <input
                    style={{ ...inputStyle, marginBottom: 0 }}
                    type="date"
                    value={exportDataFim}
                    onChange={(e) => setExportDataFim(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#10243e" }}>
                    <input
                      type="checkbox"
                      checked={exportIncluiMidias}
                      onChange={(e) => setExportIncluiMidias(e.target.checked)}
                    />
                    Incluir midias/base64 (pode ficar pesado)
                  </label>
                </div>
              </div>

              <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button
                  type="button"
                  style={{ ...secondaryButton, padding: "10px 14px" }}
                  onClick={() => {
                    if (exportando) return;
                    setExportDataIni("");
                    setExportDataFim("");
                    setExportIncluiMidias(false);
                  }}
                >
                  Limpar
                </button>
                <button
                  type="button"
                  style={{ ...primaryButton, padding: "10px 14px", background: "#0b7285" }}
                  onClick={() => exportarDadosTenantZip(item)}
                  disabled={exportando}
                >
                  {exportando ? "Gerando ZIP..." : "Gerar ZIP (CSV)"}
                </button>
              </div>

              <div style={{ marginTop: 10, fontSize: 12, color: "#5a6b82" }}>
                Observacao: o ZIP vem com um CSV por colecao do sistema. Se voce marcar “Incluir midias/base64”, o arquivo pode ficar bem grande.
              </div>
            </div>
          </div>
        );
      })()}

      {financeiroAbertoId && (() => {
        const item = lista.find((c) => String(c.id) === String(financeiroAbertoId));
        if (!item) return null;
        const pagoAte = String(item?.pagoAteRef || "").trim() || "-";
        const diaAtual = Number(item?.diaVencimento || 10);
        const prazoCliente = obterResumoPrazoCliente(item);
        return (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.45)",
              zIndex: 10000,
              display: "grid",
              placeItems: "center",
              padding: 14
            }}
            onClick={() => setFinanceiroAbertoId("")}
            role="presentation"
          >
            <div
              style={{
                width: "min(720px, 96vw)",
                background: "#fff",
                borderRadius: 12,
                border: "1px solid #dbe3ee",
                boxShadow: "0 18px 40px rgba(15, 36, 64, 0.25)",
                padding: 16,
                // O modal tem bastante conteudo (criacao de fatura, lista de faturas, etc.).
                // Sem scroll, a parte de "Link do Mercado Pago / PIX" fica "sumida" em telas menores.
                maxHeight: "92vh",
                overflowY: "auto",
                overflowX: "hidden"
              }}
              onClick={(e) => e.stopPropagation()}
              role="presentation"
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: "#10243e" }}>Financeiro do cliente</div>
                  <div style={{ marginTop: 2, color: "#546a84", fontSize: 13 }}>
                    {String(item?.razaoSocial || item?.nomeFantasia || "cliente").trim()} | tenant:{" "}
                    <strong>{String(item?.tenantId || "-").trim()}</strong>
                  </div>
                </div>
                <button
                  type="button"
                  style={{ ...secondaryButton, padding: "8px 12px" }}
                  onClick={() => setFinanceiroAbertoId("")}
                >
                  Fechar
                </button>
              </div>

              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#5a6b82", marginBottom: 4 }}>Dia do vencimento (1 a 28)</div>
                  <input
                    style={{ ...inputStyle, marginBottom: 0 }}
                    value={finDiaVenc}
                    onChange={(e) => setFinDiaVenc(e.target.value.replace(/\\D/g, "").slice(0, 2))}
                    placeholder="Ex: 10"
                    inputMode="numeric"
                  />
                  <div style={{ marginTop: 6, fontSize: 12, color: "#5a6b82" }}>
                    Atual: <strong>{Number.isFinite(diaAtual) ? diaAtual : 10}</strong>
                  </div>
                </div>

                <div style={{ display: "grid", alignContent: "start", gap: 8 }}>
                  <div style={{ fontSize: 12, color: "#5a6b82" }}>Pago até (YYYY-MM)</div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: "#10243e" }}>{pagoAte}</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: prazoCliente.cor || "#5a6b82" }}>{prazoCliente.texto}</div>
                </div>

                {(() => {
                  const planoCliente = obterPlanoPorId(item?.planoId);
                  const ciclo = obterCicloPlano(item?.cicloPlanoMeses || 1);
                  const nomePlano = String(planoCliente?.nome || item?.planoNome || item?.plano || "-").trim();
                  const valorPlano = Number(item?.valorMensal || planoCliente?.valor || 0);
                  const valorEquivalente = Number(item?.valorMensalEquivalente || (ciclo.meses > 0 ? valorPlano / ciclo.meses : valorPlano));
                  const valorPlanoTxt = formatarMoedaBR(valorPlano);
                  return (
                    <div style={{ display: "grid", alignContent: "start", gap: 8 }}>
                      <div style={{ fontSize: 12, color: "#5a6b82" }}>Plano / Valor</div>
                      <div style={{ fontSize: 16, fontWeight: 900, color: "#10243e" }}>{nomePlano}</div>
                      <div style={{ fontSize: 12, color: "#5a6b82" }}>
                        {ciclo.meses === 1 ? (
                          <>Valor do plano: <strong>R$ {valorPlanoTxt}/mes</strong></>
                        ) : (
                          <>Pacote {ciclo.nome}: <strong>R$ {valorPlanoTxt}</strong></>
                        )}
                      </div>
                      {ciclo.meses > 1 && (
                        <div style={{ fontSize: 12, color: "#5a6b82" }}>
                          Desconto: <strong>{ciclo.descontoPct}%</strong> | Equivalente mensal: <strong>R$ {formatarMoedaBR(valorEquivalente)}/mes</strong>
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: "#5a6b82" }}>
                        Vencimento: <strong>dia {Number.isFinite(diaAtual) ? diaAtual : 10}</strong>
                      </div>
                      <div style={{ fontSize: 12, color: "#5a6b82" }}>
                        Excedentes: <strong>ADM extra R$ {formatarMoedaBR(item?.valorAdminExtra || VALOR_ADMIN_EXTRA)}/mes</strong> e{" "}
                        <strong>Operador extra R$ {formatarMoedaBR(item?.valorOperadorExtra || VALOR_OPERADOR_EXTRA)}/mes</strong>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div style={{ marginTop: 14, borderTop: "1px solid #e9eef6", paddingTop: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 900, color: "#10243e" }}>Criar fatura (Mercado Pago)</div>
                <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#5a6b82", marginBottom: 4 }}>Mes de referencia (YYYY-MM)</div>
                    <input
                      style={{ ...inputStyle, marginBottom: 0 }}
                      value={finRefMes}
                      onChange={(e) => setFinRefMes(e.target.value)}
                      placeholder="2026-04"
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "#5a6b82", marginBottom: 4 }}>Valor da fatura (R$)</div>
                    <input
                      style={{ ...inputStyle, marginBottom: 0 }}
                      value={finValorFatura}
                      onChange={(e) => setFinValorFatura(e.target.value)}
                      placeholder="349"
                      inputMode="decimal"
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "#5a6b82", marginBottom: 4 }}>Forma</div>
                    <select
                      style={{ ...inputStyle, marginBottom: 0 }}
                      value={finFormaFatura}
                      onChange={(e) => setFinFormaFatura(String(e.target.value || "PIX").toUpperCase())}
                    >
                      {FORMAS_PAGAMENTO.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={{ fontSize: 12, color: "#5a6b82", marginBottom: 4 }}>Link do Mercado Pago (boleto/checkout)</div>
                    <input
                      style={{ ...inputStyle, marginBottom: 0 }}
                      value={finLinkPagamento}
                      onChange={(e) => setFinLinkPagamento(e.target.value)}
                      placeholder="Cole aqui o link do boleto/checkout do Mercado Pago"
                    />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={{ fontSize: 12, color: "#5a6b82", marginBottom: 4 }}>PIX (copia e cola / chave)</div>
                    <textarea
                      style={{ ...inputStyle, height: 74, padding: 10, marginBottom: 0 }}
                      value={finPixChave}
                      onChange={(e) => setFinPixChave(e.target.value)}
                      placeholder="Cole aqui o PIX copia-e-cola (ou chave PIX)"
                    />
                  </div>
                </div>

                <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    style={{ ...secondaryButton, padding: "10px 14px" }}
                    onClick={() => salvarPadraoPagamentoCliente(item)}
                  >
                    Salvar PIX/link (padrao)
                  </button>
                  <button
                    type="button"
                    style={{ ...primaryButton, padding: "10px 14px", background: "#0b7285" }}
                    onClick={() => criarFaturaManual(item)}
                  >
                    Criar fatura
                  </button>
                </div>

                <div style={{ marginTop: 12, border: "1px solid #e3e9f2", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ padding: "10px 12px", background: "#f7f9fd", borderBottom: "1px solid #e9eef6", fontWeight: 900, color: "#10243e" }}>
                    Faturas do cliente
                  </div>
                  <div style={{ padding: 12 }}>
                    {finCarregandoFaturas ? (
                      <div style={{ color: "#5a6b82" }}>Carregando...</div>
                    ) : (Array.isArray(finFaturas) ? finFaturas : []).length === 0 ? (
                      <div style={{ color: "#5a6b82" }}>Nenhuma fatura cadastrada ainda.</div>
                    ) : (
                      <div style={{ display: "grid", gap: 10 }}>
                        {(Array.isArray(finFaturas) ? finFaturas : []).slice(0, 12).map((f) => {
                          const statusF = String(f?.status || "PENDENTE").toUpperCase();
                          const cor = STATUS_CORES[statusF] || STATUS_CORES.PENDENTE;
                          const vencTxt = f?.vencimentoISO ? (() => {
                            try { return new Date(f.vencimentoISO).toLocaleDateString("pt-BR"); } catch { return String(f.vencimentoISO || "-"); }
                          })() : "-";
                          const valorTxt = Number(f?.valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
                          const link = String(f?.linkPagamento || "").trim();
                          const pix = String(f?.pixChave || "").trim();
                          return (
                            <div key={String(f?.id || Math.random())} style={{ border: "1px solid #e9eef6", borderRadius: 10, padding: 10 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                                <div style={{ display: "grid", gap: 2 }}>
                                  <div style={{ fontWeight: 900, color: "#10243e" }}>{String(f?.refMes || "-")}</div>
                                  <div style={{ fontSize: 12, color: "#5a6b82" }}>Venc: {vencTxt} | Valor: R$ {valorTxt}</div>
                                </div>
                                <span style={{ background: cor.fundo, border: `1px solid ${cor.borda}`, color: cor.texto, fontWeight: 900, borderRadius: 999, padding: "6px 10px" }}>
                                  {statusF}
                                </span>
                              </div>

                              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                                {link && (
                                  <button
                                    type="button"
                                    style={{ ...primaryButton, background: "#198754", padding: "8px 10px" }}
                                    onClick={() => window.open(link, "_blank", "noopener,noreferrer")}
                                  >
                                    Abrir link
                                  </button>
                                )}
                                {pix && (
                                  <button
                                    type="button"
                                    style={{ ...secondaryButton, padding: "8px 10px" }}
                                    onClick={() => copiarTexto(pix)}
                                  >
                                    Copiar PIX
                                  </button>
                                )}
                                <button
                                  type="button"
                                  style={{ ...secondaryButton, padding: "8px 10px" }}
                                  onClick={() => abrirWhatsAppCobranca(item, f)}
                                >
                                  WhatsApp
                                </button>
                                <button
                                  type="button"
                                  style={{ ...secondaryButton, padding: "8px 10px" }}
                                  onClick={() => abrirEmailCobranca(item, f)}
                                >
                                  E-mail
                                </button>
                                <button
                                  type="button"
                                  style={{ ...successButton, padding: "8px 10px" }}
                                  onClick={() => atualizarStatusFatura(String(f?.id || ""), "PAGO", item)}
                                >
                                  Marcar PAGO
                                </button>
                                <button
                                  type="button"
                                  style={{ ...warningButton, padding: "8px 10px" }}
                                  onClick={() => atualizarStatusFatura(String(f?.id || ""), "CANCELADO", item)}
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button
                  type="button"
                  style={{ ...primaryButton, background: "#6f42c1", padding: "10px 14px" }}
                  onClick={() => salvarDiaVencimento(item)}
                >
                  Salvar vencimento
                </button>
                <button
                  type="button"
                  style={{ ...successButton, padding: "10px 14px" }}
                  onClick={() => marcarPago(item, obterRefMesAtual())}
                >
                  Marcar PAGO (mes atual)
                </button>
                <button
                  type="button"
                  style={{ ...successButton, padding: "10px 14px", background: "#157347" }}
                  onClick={() => marcarPago(item, obterRefMesAnterior())}
                >
                  Marcar PAGO (mes passado)
                </button>
                <button
                  type="button"
                  style={{ ...warningButton, padding: "10px 14px" }}
                  onClick={async () => {
                    const confirmar = window.prompt("Para marcar INADIMPLENTE manualmente, digite: INADIMPLENTE");
                    if (!confirmarTexto(confirmar, "INADIMPLENTE")) return;
                    await updateDoc(doc(db, "clientesSistema", item.id), { status: "INADIMPLENTE", atualizadoEm: new Date().toISOString() });
                    await carregar();
                    alert("Status alterado para INADIMPLENTE.");
                  }}
                >
                  Marcar INADIMPLENTE (manual)
                </button>
              </div>

              <div style={{ marginTop: 10, fontSize: 12, color: "#5a6b82" }}>
                Observacao: mesmo se voce nao marcar INADIMPLENTE, o app calcula inadimplencia automaticamente pelo vencimento e “pago ate”.
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default MasterClientes;



