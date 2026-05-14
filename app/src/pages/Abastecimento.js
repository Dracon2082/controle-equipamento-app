/* eslint-disable react-hooks/exhaustive-deps */
import { useRef } from "react";
import jsPDF from "jspdf";
import SignatureCanvas from "react-signature-canvas";
import { useState, useEffect } from "react";
import { db } from "../firebase";
import { input } from "../styles";
import { registrarHistorico } from "../utils/historico";
import { parseDecimalInput } from "../utils/number";
import {
  atualizarAbastecimentoPendente,
  listarAbastecimentosPendentes,
  removerAbastecimentoPendente,
  salvarAbastecimentoPendente
} from "../utils/offlineAbastecimento";
import { criarSaldosMelosa, obterSaldoMelosa, totalDieselMelosa } from "../utils/melosas";
import { formatoLogoPdf, resolverLogoPdf } from "../utils/pdfLogo";
import { belongsToTenant, getConfigDocId, getTenantId, withTenant } from "../utils/tenant";

import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";

function Abastecimento({ setTela }) {
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

  const isMobile = window.innerWidth <= 700;
  const assinaturaWidth = Math.min(460, Math.max(280, window.innerWidth - 56));
  const [tipoDiesel, setTipoDiesel] = useState("S-10");
  const [equipamento, setEquipamento] = useState("");
  const [cidadeBase, setCidadeBase] = useState("");
  const [obraId, setObraId] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [horimetro, setHorimetro] = useState("");
  const [horimetroQuebrado, setHorimetroQuebrado] = useState(false);
  const [operadores, setOperadores] = useState([]);
  const [operador, setOperador] = useState("");
  const sigPad = useRef(null);

  const [data, setData] = useState(
    new Date().toISOString().split("T")[0]
  );

  const [litros, setLitros] = useState("");
  const [buscaReq, setBuscaReq] = useState("");

  const [req, setReq] = useState("");
  const [codigo, setCodigo] = useState("");
  const [placa, setPlaca] = useState("");

  const [equipamentos, setEquipamentos] = useState([]);
  const [empresas, setEmpresas] = useState([]);
  const [obras, setObras] = useState([]);

  const [estoque, setEstoque] = useState(0);
  const [estoqueTotalDiesel, setEstoqueTotalDiesel] = useState(0);
  const [estoqueBaseDiesel, setEstoqueBaseDiesel] = useState(0);
  const [lubrificantes, setLubrificantes] = useState([]);
  const [melosas, setMelosas] = useState([]);
  const [tipoLubrificante, setTipoLubrificante] = useState("");
  const [produtoLubrificante, setProdutoLubrificante] = useState("");
  const [quantidadeLubrificante, setQuantidadeLubrificante] = useState("");
  const [itensLubrificacao, setItensLubrificacao] = useState([]);


  const [observacao, setObservacao] = useState("");

  const [ultimoCupomDados, setUltimoCupomDados] = useState(null);
  const [cupomBlob, setCupomBlob] = useState(null);
  const [cupomUrl, setCupomUrl] = useState("");
  const [cupomNomeArquivo, setCupomNomeArquivo] = useState("cupom_abastecimento.pdf");


  const [config, setConfig] = useState(null);
  const [isOnline, setIsOnline] = useState(() => window.navigator.onLine);
  const [pendenciasOffline, setPendenciasOffline] = useState([]);
  const [sincronizandoPendencias, setSincronizandoPendencias] = useState(false);
  const [mensagemSincronizacao, setMensagemSincronizacao] = useState("");

  const [lista, setLista] = useState([]);
  const [aberto, setAberto] = useState(null);
  const [mostrarHistorico, setMostrarHistorico] = useState(false);
  const melosaIdSessao = String(sessaoOperacional?.melosaId || "").trim();

  // Observação: em abastecimento, o frentista registra a leitura atual (mesmo quebrado).
  // As horas trabalhadas (quando necessario) ficam no Lancamento Diario.

  // ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¥ CARREGAR DADOS
  useEffect(() => {
    const usuario = localStorage.getItem("usuarioLogado");

    if (!usuario) {
      alert("Acesso n\u00e3o autorizado!");
      setTela("login");
      return;
    }

    buscarTudo();
    carregarHistorico();
    atualizarPendencias();
  }, []);

  useEffect(() => {
    const atualizarStatusConexao = () => {
      setIsOnline(window.navigator.onLine);
    };

    window.addEventListener("online", atualizarStatusConexao);
    window.addEventListener("offline", atualizarStatusConexao);

    return () => {
      window.removeEventListener("online", atualizarStatusConexao);
      window.removeEventListener("offline", atualizarStatusConexao);
    };
  }, []);

  useEffect(() => {
    if (isOnline) {
      sincronizarPendencias();
    }
  }, [isOnline]); // eslint-disable-line react-hooks/exhaustive-deps

  const buscarTudo = async () => {
    const snapEq = await getDocs(collection(db, "equipamentos"));
    setEquipamentos(snapEq.docs.map((d) => d.data()).filter((item) => belongsToTenant(item, tenantId)));

    const snapEmp = await getDocs(collection(db, "empresas"));
    setEmpresas(
      snapEmp.docs.map((d) => d.data())
        .filter((item) => belongsToTenant(item, tenantId))
        .map((item) => item.nome)
    );

    const snapObras = await getDocs(collection(db, "obras"));
    setObras(
      snapObras.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })).filter((item) => belongsToTenant(item, tenantId)).filter(basePermitida)
    );

    setTimeout(() => {
      if (obraId) {
        buscarEstoque();
      }
    }, 500);

    const snapLub = await getDocs(collection(db, "lubrificantes"));
    setLubrificantes(
      snapLub.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })).filter((item) => belongsToTenant(item, tenantId))
    );
    const snapMelosas = await getDocs(collection(db, "melosas"));
    setMelosas(
      snapMelosas.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })).filter((item) => belongsToTenant(item, tenantId)).filter((item) => item.ativo !== false)
    );

    // ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¥ BUSCAR OPERADORES
    const snapOp = await getDocs(collection(db, "funcionarios"));
    setOperadores(snapOp.docs.map((d) => d.data()).filter((item) => belongsToTenant(item, tenantId)));

  // ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¥ COLOCA AQUI
  const docRef = doc(db, "configuracoes", getConfigDocId(tenantId));
  const snap = await getDoc(docRef);

  if (snap.exists()) {
    setConfig(snap.data());
  }  
  
};

  // ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¥ REQUISIÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢O MAIS SEGURA
  const gerarReq = async (cidadeParam = cidadeBase) => {
    const cidadeReq = normalizarCidade(cidadeParam);
    const hoje = new Date();
    const dataBase = `${hoje.getFullYear()}${String(hoje.getMonth() + 1).padStart(2, "0")}${String(hoje.getDate()).padStart(2, "0")}`;

    if (!window.navigator.onLine) {
      await gerarReqOffline(cidadeParam);
      return;
    }

    if (!cidadeReq) {
      setReq(`RQ-${dataBase}-001`);
      return;
    }

    const snap = await getDocs(collection(db, "abastecimentos"));
    const maiorAtual = snap.docs
      .map((d) => d.data())
      .filter((item) => belongsToTenant(item, tenantId))
      .filter((item) => normalizarCidade(item.obraCidade) === cidadeReq)
      .map((item) => {
        const reqTexto = String(item.req || "").trim().toUpperCase();
        const match = reqTexto.match(/(\d{3})$/);
        return match ? Number(match[1]) : 0;
      })
      .filter((num) => Number.isFinite(num) && num > 0)
      .reduce((max, atual) => (atual > max ? atual : max), 0);

    const proximo = maiorAtual + 1;
    setReq(`RQ-${dataBase}-${String(proximo).padStart(3, "0")}`);
  };

  // ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¥ BUSCAR ESTOQUE
  const buscarEstoque = async () => {
    const obraSelecionada = obras.find((o) => o.id === obraId);
    const cidadeSelecionada = melosaAtiva?.baseCidade || cidadeBase || obraSelecionada?.cidade;
    const obraDaCidade = obras.find(
      (o) => normalizarCidade(o.cidade) === normalizarCidade(cidadeSelecionada)
    );
    const cidade = cidadeSelecionada;
    const estado = melosaAtiva?.baseEstado || obraSelecionada?.estado || obraDaCidade?.estado;

    if (!cidade) {
      setEstoque(0);
      setEstoqueTotalDiesel(0);
      setEstoqueBaseDiesel(0);
      return;
    }

    const [snapEstoque, snapLub] = await Promise.all([
      getDocs(collection(db, "estoque")),
      // Compat: algumas bases usam esta colecao para DIESEL (S-10 / S-500)
      getDocs(collection(db, "lubrificantes"))
    ]);

    const produtos = [
      ...snapEstoque.docs.map((d) => ({ id: d.id, __collection: "estoque", ...d.data() })),
      ...snapLub.docs.map((d) => ({ id: d.id, __collection: "lubrificantes", ...d.data() }))
    ].filter((item) => belongsToTenant(item, tenantId));

    const estoqueDiesel = produtos
      .filter((item) => mesmoProduto(item.nome, tipoDiesel) && mesmoLocal(item, cidade, estado))
      .reduce((total, item) => total + parseDecimalInput(item.quantidade || 0), 0);

    const totalDieselCidade = produtos
      .filter(
        (item) =>
          (mesmoProduto(item.nome, "S-10") || mesmoProduto(item.nome, "S-500")) &&
          mesmoLocal(item, cidade, estado)
      )
      .reduce((total, item) => total + parseDecimalInput(item.quantidade || 0), 0);

    setEstoqueBaseDiesel(totalDieselCidade);
    if (melosaAtiva) {
      setEstoque(obterSaldoMelosa(melosaAtiva, tipoDiesel));
      setEstoqueTotalDiesel(totalDieselMelosa(melosaAtiva));
      return;
    }

    setEstoque(estoqueDiesel);
    setEstoqueTotalDiesel(totalDieselCidade);
  };

  const normalizarTexto = (valor) =>
    String(valor || "").toUpperCase().trim();
  const normalizarCidade = (valor) =>
    String(valor || "").replace(/\s+/g, " ").trim().toUpperCase();
  const nomeObraExibicao = (obra) => {
    const nomeOriginal = String(obra?.nome || "").replace(/\s+/g, " ").trim();
    const cidade = normalizarTexto(obra?.cidade);
    const estado = normalizarTexto(obra?.estado);
    if (!nomeOriginal || !cidade) return nomeOriginal;

    let nome = nomeOriginal;
    const nomeUpper = normalizarTexto(nome);
    const sufixos = [
      ` - ${cidade}/${estado}`,
      ` - ${cidade}`,
      ` ${cidade}/${estado}`
    ];

    for (const sufixo of sufixos) {
      if (sufixo.trim() && nomeUpper.endsWith(sufixo)) {
        nome = nome.slice(0, Math.max(0, nome.length - sufixo.length)).trim();
        break;
      }
    }

    const limparToken = (texto, token) => {
      if (!token) return texto;
      const tokenEscapado = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return texto
        .replace(new RegExp(`\\s*-\\s*${tokenEscapado}(?:\\/[A-Z]{2})?`, "ig"), "")
        .replace(new RegExp(`\\s*,\\s*${tokenEscapado}(?:\\/[A-Z]{2})?`, "ig"), "")
        .replace(new RegExp(`\\b${tokenEscapado}\\b`, "ig"), "")
        .replace(/\s{2,}/g, " ")
        .trim();
    };

    nome = limparToken(nome, cidade);
    nome = limparToken(nome, `${cidade}/${estado}`);

    if (estado) {
      nome = nome
        .replace(new RegExp(`\\/${estado}\\b`, "ig"), "")
        .replace(/\s{2,}/g, " ")
        .trim();
    }

    if (nome.includes(" - ")) {
      nome = nome.split(" - ")[0].trim();
    }

    return nome || nomeOriginal;
  };

  const identificarNumeroObra = (obraTexto) => {
    const texto = String(obraTexto || "").trim();
    if (!texto) return "-";
    const matchNumero = texto.match(/\d{3}/);
    if (matchNumero) return matchNumero[0];
    return texto.replace(/\s+/g, " ").trim().toUpperCase().slice(0, 14);
  };

  const normalizarChave = (valor) =>
    normalizarTexto(valor)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Z0-9]/g, "");

  const mesmoLocal = (item, cidade, estado) =>
    normalizarChave(item.cidade) === normalizarChave(cidade) &&
    (!estado || !item.estado || normalizarChave(item.estado) === normalizarChave(estado));

  const mesmoProduto = (itemNome, nome) => {
    const item = normalizarChave(itemNome);
    const busca = normalizarChave(nome);

    if (!item || !busca) return false;
    if (item === busca) return true;

    return busca === "S10" || busca === "S500"
      ? item.includes(busca)
      : false;
  };

  const mesmoTipoLubrificante = (item, tipoSelecionado) => {
    const tipo = normalizarChave(item.tipo);
    const categoria = normalizarChave(item.categoria);
    const selecionado = normalizarChave(tipoSelecionado);

    if (!selecionado) return false;
    if (selecionado === "GRAXA") return tipo.includes("GRAXA");
    if (selecionado.includes("LEO")) {
      return tipo.includes("LEO") && !categoria.includes("COMBUST");
    }

    return tipo === selecionado;
  };

  const filtrarEstoqueProduto = (produtos, nome, cidade, estado) =>
    produtos.filter(
      (item) =>
        mesmoProduto(item.nome, nome) &&
        mesmoLocal(item, cidade, estado)
    );

  const baixarEstoqueProduto = async (produtos, quantidade, colecao = "estoque") => {
    let restante = Number(quantidade || 0);

    for (const produto of produtos) {
      if (restante <= 0) break;

      const quantidadeAtual = Number(produto.quantidade || 0);
      const quantidadeBaixada = Math.min(quantidadeAtual, restante);
      const novaQuantidade = quantidadeAtual - quantidadeBaixada;

      await updateDoc(doc(db, produto.__collection || colecao, produto.id), {
        quantidade: novaQuantidade,
        total: novaQuantidade * parseDecimalInput(produto.preco || 0)
      });

      restante -= quantidadeBaixada;
    }

    return restante <= 0;
  };

  const criarErroValidacao = (mensagem) => {
    const erro = new Error(mensagem);
    erro.userMessage = mensagem;
    return erro;
  };

  const montarDadosCupom = (payload) => ({
    data: payload.data,
    dataHora: payload.dataHora,
    equipamento: payload.equipamento,
    obra: payload.obra || "",
    empresa: payload.empresa,
    frentista: payload.frentista,
    melosaNome: payload.melosaNome || "",
    operador: payload.operador,
    litros: payload.litros,
    tipo: payload.tipo,
    lubrificacoes: payload.lubrificacoes || [],
    observacao: payload.observacao || "",
    assinatura: payload.assinatura,
    req: payload.req,
    obraNumero: identificarNumeroObra(payload.obra || "")
  });

  const limparFormulario = () => {
    setLitros("");
    setEquipamento("");
    setEmpresa("");
    setObraId("");
    setObservacao("");
    setOperador("");
    setTipoLubrificante("");
    setProdutoLubrificante("");
    setQuantidadeLubrificante("");
    setItensLubrificacao([]);
    setBuscaReq("");

    if (sigPad.current) {
      sigPad.current.clear();
    }
  };

  const atualizarPendencias = async () => {
    const pendentes = await listarAbastecimentosPendentes(tenantId);
    setPendenciasOffline(pendentes);
    return pendentes;
  };

  const montarPayloadAbastecimento = ({ assinaturaAtual, frentista, litrosNum, horimetroTxt }) => {
    const obraAtual = obras.find((o) => o.id === obraId);

    return {
      data,
      equipamento,
      obra: obraAtual?.nome || "",
      obraId,
      obraCidade: obraAtual?.cidade || "",
      obraEstado: obraAtual?.estado || "",
      codigo,
      placa,
      litros: litrosNum,
      tipo: tipoDiesel,
      lubrificacoes: itensLubrificacao,
      empresa,
      frentista,
      operador,
      horimetro: horimetroTxt,
      horimetroQuebrado: Boolean(horimetroQuebrado),
      horaInicioTurno: "",
      horaFimTurno: "",
      horasTrabalhadas: 0,
      req,
      observacao,
      melosaId: melosaAtiva?.id || "",
      melosaNome: melosaAtiva?.nome || melosaAtiva?.codigo || "",
      assinatura: assinaturaAtual,
      criadoEm: new Date().toISOString(),
      dataHora: new Date().toLocaleString("pt-BR"),
    };
  };

  const gerarReqOffline = async (cidadeParam = cidadeBase) => {
    const cidadeReq = normalizarCidade(cidadeParam);
    const hoje = new Date();
    const dataBase = `${hoje.getFullYear()}${String(hoje.getMonth() + 1).padStart(2, "0")}${String(hoje.getDate()).padStart(2, "0")}`;
    const pendentes = await listarAbastecimentosPendentes(tenantId);

    const maiorAtual = pendentes
      .map((item) => item.payload)
      .filter((item) => normalizarCidade(item?.obraCidade) === cidadeReq)
      .map((item) => {
        const reqTexto = String(item?.req || "").trim().toUpperCase();
        const match = reqTexto.match(/(\d{3})$/);
        return match ? Number(match[1]) : 900;
      })
      .filter((num) => Number.isFinite(num))
      .reduce((max, atual) => (atual > max ? atual : max), 900);

    setReq(`RQ-${dataBase}-${String(maiorAtual + 1).padStart(3, "0")}`);
  };

  const persistirAbastecimentoRemoto = async (payload) => {
    const cidade = payload?.obraCidade;
    const estado = payload?.obraEstado;
    const litrosNum = parseDecimalInput(payload?.litros || 0);
    const melosaId = String(payload?.melosaId || "").trim();

    if (!cidade || !estado) {
      throw criarErroValidacao("Obra sem cidade/estado cadastrados.");
    }

    const [estoqueSnap, lubSnap] = await Promise.all([
      getDocs(collection(db, "estoque")),
      getDocs(collection(db, "lubrificantes"))
    ]);

    const produtosEstoque = estoqueSnap.docs.map((d) => ({
      id: d.id,
      __collection: "estoque",
      ...d.data()
    })).filter((item) => belongsToTenant(item, tenantId));

    const produtosLub = lubSnap.docs.map((d) => ({
      id: d.id,
      __collection: "lubrificantes",
      ...d.data()
    })).filter((item) => belongsToTenant(item, tenantId));

    const produtosDiesel = [...produtosEstoque, ...produtosLub];

    let melosaDoc = null;
    if (melosaId) {
      const snapMelosa = await getDoc(doc(db, "melosas", melosaId));
      if (!snapMelosa.exists()) {
        throw criarErroValidacao("A melosa vinculada ao frentista nao foi encontrada.");
      }
      const dadosMelosa = snapMelosa.data();
      if (!belongsToTenant(dadosMelosa, tenantId)) {
        throw criarErroValidacao("Melosa fora da empresa atual.");
      }
      melosaDoc = { id: snapMelosa.id, ...dadosMelosa };
      if (normalizarCidade(melosaDoc.baseCidade) !== normalizarCidade(cidade)) {
        throw criarErroValidacao("A obra selecionada nao pertence a base da melosa do frentista.");
      }
      if (payload?.litros && obterSaldoMelosa(melosaDoc, payload.tipo) < litrosNum) {
        throw criarErroValidacao("Saldo insuficiente na melosa para sincronizar este abastecimento.");
      }
    } else if (payload?.litros) {
      const dieselItens = filtrarEstoqueProduto(
        produtosDiesel,
        payload.tipo,
        cidade,
        estado
      );

      const totalDiesel = dieselItens.reduce(
        (total, item) => total + parseDecimalInput(item.quantidade || 0),
        0
      );

      if (totalDiesel < litrosNum) {
        throw criarErroValidacao("Estoque de diesel insuficiente para sincronizar este abastecimento.");
      }
    }

    const totaisLubrificacao = (payload?.lubrificacoes || []).reduce((totais, item) => {
      totais[item.produto] =
        (totais[item.produto] || 0) + parseDecimalInput(item.quantidade || 0);
      return totais;
    }, {});

    for (const [produto, quantidade] of Object.entries(totaisLubrificacao)) {
      const produtos = filtrarEstoqueProduto(
        produtosLub,
        produto,
        cidade,
        estado
      );

      const totalEstoque = produtos.reduce(
        (total, item) => total + parseDecimalInput(item.quantidade || 0),
        0
      );

      if (totalEstoque < quantidade) {
        throw criarErroValidacao(`Estoque insuficiente para ${produto}.`);
      }
    }

    if (payload?.litros) {
      if (melosaDoc) {
        const saldosMelosa = criarSaldosMelosa(melosaDoc.saldos);
        const novosSaldos = {
          ...saldosMelosa,
          [payload.tipo]: parseDecimalInput(saldosMelosa[payload.tipo] || 0) - litrosNum
        };
        await updateDoc(doc(db, "melosas", melosaDoc.id), {
          saldos: novosSaldos,
          atualizadoEm: new Date().toISOString()
        });
      } else {
        await baixarEstoqueProduto(
          filtrarEstoqueProduto(produtosDiesel, payload.tipo, cidade, estado),
          litrosNum
        );
      }
    }

    for (const [produto, quantidade] of Object.entries(totaisLubrificacao)) {
      await baixarEstoqueProduto(
        filtrarEstoqueProduto(produtosLub, produto, cidade, estado),
        quantidade,
        "lubrificantes"
      );
    }

    const ref = await addDoc(collection(db, "abastecimentos"), withTenant(payload, tenantId));

    await registrarHistorico({
      modulo: "ABASTECIMENTO",
      acao: "CRIOU",
      entidade: "ABASTECIMENTO",
      registroId: ref.id,
      usuario: payload.frentista,
      descricao: `Abastecimento de ${payload.equipamento} (${payload.tipo}) na obra ${payload.obra || "-"}.`,
      detalhes: {
        litros: litrosNum,
        operador: payload.operador,
        melosa: payload.melosaNome || ""
      }
    });

    return ref;
  };

  const sincronizarPendencias = async () => {
    if (!window.navigator.onLine || sincronizandoPendencias) {
      return;
    }

    setSincronizandoPendencias(true);

    try {
      const pendentes = await listarAbastecimentosPendentes(tenantId);
      let sincronizados = 0;
      let comErro = 0;

      for (const item of pendentes) {
        try {
          await persistirAbastecimentoRemoto(item.payload);
          await removerAbastecimentoPendente(item.id);
          sincronizados += 1;
        } catch (error) {
          comErro += 1;
          await atualizarAbastecimentoPendente(item.id, {
            status: "erro",
            ultimoErro: error?.userMessage || error?.message || "Falha na sincronização.",
            ultimaTentativaEm: new Date().toISOString()
          });
        }
      }

      await atualizarPendencias();
      await carregarHistorico();
      await buscarEstoque();
      await gerarReq(cidadeBase);

      if (sincronizados > 0 || comErro > 0) {
        setMensagemSincronizacao(
          comErro > 0
            ? `${sincronizados} sincronizado(s) e ${comErro} pendência(s) ainda precisam de revisão.`
            : `${sincronizados} abastecimento(s) sincronizado(s) com sucesso.`
        );
      }
    } finally {
      setSincronizandoPendencias(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    buscarEstoque();
  }, [tipoDiesel, obraId, cidadeBase, obras, config, melosas]);

  useEffect(() => {
    // Libera URL do blob anterior (evita vazamento de memoria)
    return () => {
      try {
        if (cupomUrl) URL.revokeObjectURL(cupomUrl);
      } catch {}
    };
  }, [cupomUrl]);

  useEffect(() => {
    if (!obras.length) return;
    if (cidadeBase) return;
    const primeiraCidade = Array.from(
      new Set(obras.map((o) => normalizarCidade(o.cidade)).filter(Boolean))
    )[0];
    if (primeiraCidade) setCidadeBase(primeiraCidade);
  }, [obras, cidadeBase]);

  useEffect(() => {
    const melosaSessao = melosas.find((item) => item.id === melosaIdSessao) || null;
    if (!melosaSessao) return;
    const cidadeMelosa = normalizarCidade(melosaSessao.baseCidade);
    if (!cidadeMelosa) return;
    setCidadeBase(cidadeMelosa);
  }, [melosaIdSessao, melosas]);

  useEffect(() => {
    gerarReq(cidadeBase);
  }, [cidadeBase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¥ CALCULAR TOTAL
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¥ SALVAR
  const salvar = async () => {
    const frentista = localStorage.getItem("usuarioLogado");
    const assinaturaAtual =
      sigPad.current && !sigPad.current.isEmpty()
        ? sigPad.current.getCanvas().toDataURL("image/png")
        : null;

    if (!frentista) {
      alert("Fa\u00e7a login para abastecer!");
      return;
    }

    if (!assinaturaAtual) {
      alert("Assinatura do operador \u00e9 obrigat\u00f3ria!");
      return;
    }

    if (!operador) {
      alert("Selecione o operador!");
      return;
    }
    const litrosNum = parseDecimalInput(litros);
    const horimetroTxt = String(horimetro || "").trim();

    if (!horimetroTxt) {
      alert("Informe o Horimetro / KM (mesmo quando estiver quebrado).");
      return;
    }


    // ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ VALIDAÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ES
    if (!equipamento || !empresa || !obraId) {
      const faltando = [];
      if (!equipamento) faltando.push("Equipamento");
      if (!obraId) faltando.push("Obra");
      if (!empresa) faltando.push("Empresa requisitante");
      alert(`Campos obrigatorios faltando: ${faltando.join(", ")}`);
      return;
    }

    if (!litros && itensLubrificacao.length === 0) {
      alert("Informe litros ou adicione lubrificante.");
      return;
    }

    if (litros && (isNaN(litrosNum) || litrosNum <= 0)) {
      alert("Litros inv\u00e1lidos!");
      return;
    }

    if (litros && isOnline && estoque < litrosNum) {
      alert("Estoque insuficiente!");
      return;
    }

    try {
      const obraSelecionada = obras.find((o) => o.id === obraId);
      const cidadeAtual = obraSelecionada?.cidade || cidadeBase;

      if (!obraSelecionada?.cidade || !obraSelecionada?.estado) {
        alert("Obra sem cidade/estado cadastrados.");
        return;
      }

      if (!isOnline) {
        const payloadOffline = montarPayloadAbastecimento({
          assinaturaAtual,
          frentista,
          litrosNum,
          horimetroTxt
        });

        await salvarAbastecimentoPendente(payloadOffline, tenantId);
        setUltimoCupomDados(montarDadosCupom(payloadOffline));
        await atualizarPendencias();
        await carregarHistorico();
        limparFormulario();
        await gerarReq(cidadeAtual);
        setMensagemSincronizacao("Abastecimento salvo no aparelho e aguardando sincronização.");
        alert("Sem internet: o abastecimento foi salvo no celular e será enviado quando a conexão voltar.");
        return;
      }

      const cidade = obraSelecionada?.cidade;
      const estado = obraSelecionada?.estado;

      if (!cidade || !estado) {
        alert("Obra sem cidade/estado cadastrados.");
        return;
      }

      const [estoqueSnap, lubSnap] = await Promise.all([
        getDocs(collection(db, "estoque")),
        getDocs(collection(db, "lubrificantes"))
      ]);
      const produtosEstoque = estoqueSnap.docs.map(d => ({
        id: d.id,
        __collection: "estoque",
        ...d.data()
      })).filter((item) => belongsToTenant(item, tenantId));
      const produtosLub = lubSnap.docs.map(d => ({
        id: d.id,
        __collection: "lubrificantes",
        ...d.data()
      })).filter((item) => belongsToTenant(item, tenantId));
      const produtosDiesel = [...produtosEstoque, ...produtosLub];

    if (litros) {
      const dieselItens = filtrarEstoqueProduto(
        produtosDiesel,
        tipoDiesel,
        cidade,
        estado
      );

      const totalDiesel = dieselItens.reduce(
        (total, item) => total + parseDecimalInput(item.quantidade || 0),
        0
      );

      if (totalDiesel < litrosNum) {
        alert("Estoque de diesel insuficiente!");
        return;
      }
    }

      const totaisLubrificacao = itensLubrificacao.reduce((totais, item) => {
        totais[item.produto] =
          (totais[item.produto] || 0) + parseDecimalInput(item.quantidade || 0);
        return totais;
      }, {});

      for (let [produto, quantidade] of Object.entries(totaisLubrificacao)) {
        const produtos = filtrarEstoqueProduto(
          produtosLub,
          produto,
          cidade,
          estado
        );

        const totalEstoque = produtos.reduce(
          (total, p) => total + parseDecimalInput(p.quantidade || 0),
          0
        );

        if (totalEstoque < quantidade) {
          alert(`Estoque insuficiente para ${produto}.`);
          return;
        }
      }

      if (litros) {
        await baixarEstoqueProduto(
          filtrarEstoqueProduto(produtosDiesel, tipoDiesel, cidade, estado),
          litrosNum
        );
      }

      for (let [produto, quantidade] of Object.entries(totaisLubrificacao)) {
        await baixarEstoqueProduto(
          filtrarEstoqueProduto(produtosLub, produto, cidade, estado),
          quantidade,
          "lubrificantes"
        );
      }
      
      // ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¥ SALVA ABASTECIMENTO
      const ref = await addDoc(collection(db, "abastecimentos"), withTenant({
        data,
        equipamento,
        obra: obraSelecionada?.nome || "",
        obraId,
        obraCidade: cidade,
        obraEstado: estado,
        codigo,
        placa,
        litros: litrosNum,
        tipo: tipoDiesel,
        lubrificacoes: itensLubrificacao,
        empresa,
        frentista,
        operador,
        horimetro: horimetroTxt,
        horimetroQuebrado: Boolean(horimetroQuebrado),
        // Em abastecimento nao pedimos horario de inicio/fim do turno.
        horaInicioTurno: "",
        horaFimTurno: "",
        horasTrabalhadas: 0,
        req,
        observacao,
        assinatura: assinaturaAtual,
        criadoEm: new Date().toISOString(),
        dataHora: new Date().toLocaleString("pt-BR"),
      }, tenantId));

      await registrarHistorico({
        modulo: "ABASTECIMENTO",
        acao: "CRIOU",
        entidade: "ABASTECIMENTO",
        registroId: ref.id,
        usuario: frentista,
        descricao: `Abastecimento de ${equipamento} (${tipoDiesel}) na obra ${obraSelecionada?.nome || "-"}.`,
        detalhes: {
          litros: litrosNum,
          operador
        }
      });

      alert("\u2705 Abastecimento salvo com sucesso!");

      const cupomDados = {
        data,
        dataHora: new Date().toLocaleString("pt-BR"),
        equipamento,
        obra: obraSelecionada?.nome || "",
        empresa,
        frentista,
        operador,
        litros: litrosNum,
        tipo: tipoDiesel,
        lubrificacoes: itensLubrificacao,
        observacao,
        assinatura: assinaturaAtual,
        req,
        obraNumero: identificarNumeroObra(obraSelecionada?.nome || "")
      };
      setUltimoCupomDados(cupomDados);

      // LIMPAR
      setLitros("");
      setEquipamento("");
      setEmpresa("");
      setObraId("");
      setObservacao("");
      setOperador("");
      setTipoLubrificante("");
      setProdutoLubrificante("");
      setQuantidadeLubrificante("");
      setItensLubrificacao([]);
      if (sigPad) sigPad.current.clear();
      setBuscaReq("");
      

      gerarReq();
      buscarEstoque();
      carregarHistorico();
      atualizarPendencias();

    } catch (error) {
      console.error(error);
      alert("Erro ao salvar abastecimento!");
    }
  };

  const nomeArquivoCupom = (dados) => {
    const reqTxt = String(dados?.req || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "");
    const obraNum = String(dados?.obraNumero || identificarNumeroObra(dados?.obra) || "").replace(/\D/g, "");
    const dataTxt = String(dados?.data || "").replace(/[^\d]/g, "");
    const pedacos = ["cupom", dataTxt, obraNum ? `obra${obraNum}` : "", reqTxt ? `req${reqTxt}` : ""].filter(Boolean);
    return `${pedacos.join("_")}.pdf`;
  };

  const gerarCupomBlob = async (dados) => {
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: [80, 200]
    });

    const base64 = await resolverLogoPdf(config);

    if (base64) {
      try {
        doc.addImage(base64, formatoLogoPdf(base64), 30, 5, 20, 8);
      } catch (e) {
        console.log("Erro na logo");
      }
    }

    let y = 20;

    doc.setFontSize(10);

   doc.setFontSize(9);
   doc.text(config?.nome || "", 40, y, { align: "center" });
   y += 4;

   doc.text(`CNPJ: ${config?.cnpj || ""}`, 40, y, { align: "center" });
   y += 4;

   const endereco = config?.endereco || "";
   const linhasEndereco = doc.splitTextToSize(endereco, 70);

   doc.text(linhasEndereco, 40, y, { align: "center" });
   y += linhasEndereco.length * 4;
   y += 6;

   doc.setFontSize(10);
   doc.text("COMPROVANTE", 40, y, { align: "center" });
   y += 5;

    doc.text("-----------------------------", 10, y);
    y += 5;

    doc.text(`Data/Hora: ${dados.dataHora || "-"}`, 10, y);
    y += 5;

    doc.text(`Req: ${dados.req}`, 10, y);
    y += 5;

    const equipTexto = doc.splitTextToSize(
      `Equip: ${dados.equipamento}`,
      60
    );

    doc.text(equipTexto, 10, y);
    y += equipTexto.length * 5;

    const empresaTexto = doc.splitTextToSize(
      `Empresa: ${dados.empresa || "-"}`,
      60
    );
    doc.text(empresaTexto, 10, y);
    y += empresaTexto.length * 5;

    const obraTexto = doc.splitTextToSize(`Obra: ${dados.obraNumero || identificarNumeroObra(dados.obra)}`, 60);
    doc.text(obraTexto, 10, y);
    y += obraTexto.length * 5;

    const nomeFrentista = dados.frentista?.split(" ")[0] || "";

    doc.text(`Frentista: ${nomeFrentista}`, 10, y);
    y += 5;
    if (dados.melosaNome) {
      doc.text(`Melosa: ${dados.melosaNome}`, 10, y);
      y += 5;
    }

    const operadorTexto = doc.splitTextToSize(
      `Operador: ${dados.operador || "-"}`,
      60
    );
    doc.text(operadorTexto, 10, y);
    y += operadorTexto.length * 5;

    doc.text("-----------------------------", 10, y);
    y += 5;

    doc.text(`Litros (${dados.tipo || "-"}) : ${Number(dados.litros || 0).toFixed(2)} L`, 10, y);
    y += 5;

    if (dados.lubrificacoes && dados.lubrificacoes.length > 0) {
      doc.text("Lubrificação:", 10, y);
      y += 5;

      dados.lubrificacoes.forEach((l) => {
        doc.text(
          `${l.tipo} - ${l.produto} (${Number(l.quantidade || 0).toFixed(2)} ${l.unidade || ""})`,
          10,
          y
        );
        y += 5;
      });
      y += 2;
    }

    if (dados.observacao) {
      doc.text(`Obs: ${dados.observacao}`, 10, y);
      y += 7;
    }

    doc.setDrawColor(0);
    doc.line(10, y, 70, y);
    y += 5;

    if (dados.assinatura) {
      doc.text("Assinatura do Operador:", 10, y);
      y += 3;

      doc.addImage(dados.assinatura, "PNG", 10, y, 60, 20);
      y += 25;
    }

    doc.text("Via do Operador", 40, y, { align: "center" });

    return doc.output("blob");
  };

  const prepararCupom = async (dados, abrirEmNovaAba = false) => {
    try {
      if (!dados) return;
      const blob = await gerarCupomBlob(dados);
      const url = URL.createObjectURL(blob);
      setCupomBlob(blob);
      setCupomNomeArquivo(nomeArquivoCupom(dados));
      setCupomUrl(url);
      if (abrirEmNovaAba) window.open(url);
    } catch (e) {
      console.error(e);
      alert("Erro ao gerar cupom.");
    }
  };

  const baixarCupom = () => {
    if (!cupomUrl) return;
    const a = document.createElement("a");
    a.href = cupomUrl;
    a.download = cupomNomeArquivo || "cupom_abastecimento.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const compartilharCupom = async () => {
    if (!cupomBlob || !cupomUrl) return;
    const file = new File([cupomBlob], cupomNomeArquivo || "cupom_abastecimento.pdf", {
      type: "application/pdf"
    });

    if (navigator.share) {
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: "Cupom de Abastecimento"
          });
          return;
        }
        await navigator.share({
          title: "Cupom de Abastecimento",
          url: cupomUrl
        });
        return;
      } catch (e) {
        // cancelado ou nao suportado - cai no fallback abaixo
      }
    }

    alert("Compartilhamento não suportado neste aparelho. Use Abrir/baixar e compartilhe pelo WhatsApp/e-mail.");
  };

  const page = {
    maxWidth: 1040,
    margin: "0 auto",
    padding: isMobile ? "12px 8px 24px" : "18px 10px 32px",
    background: "#f3f5f8"
  };

  const card = {
    background: "#fff",
    padding: 14,
    borderRadius: 8,
    border: "1px solid #e3e7ef",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    marginBottom: 12
  };

  const cardTitle = {
    marginTop: 0,
    marginBottom: 10,
    color: "#10243e"
  };

  const inputField = {
    ...input,
    marginBottom: 0,
    borderRadius: 8,
    border: "1px solid #cfd7e3",
    minHeight: 40,
    boxSizing: "border-box"
  };

  const grid2 = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 10
  };

  const topButton = {
    border: "none",
    borderRadius: 8,
    padding: "9px 12px",
    fontWeight: "bold",
    cursor: "pointer"
  };

  const primaryButton = {
    ...topButton,
    background: "#0b5ed7",
    color: "#fff"
  };

  const secondaryButton = {
    ...topButton,
    background: "#6c757d",
    color: "#fff"
  };

  const dangerButton = {
    ...topButton,
    background: "#cc0000",
    color: "#fff"
  };

  const infoChip = {
    background: "#fff",
    border: "1px solid #dbe3ef",
    borderRadius: 8,
    padding: "8px 10px",
    fontWeight: "bold",
    color: "#2a3f5a"
  };

  // eslint-disable-next-line no-unused-vars
  const buscarSegundaVia = async () => {
    if (!buscaReq) {
      alert("Informe o n\u00famero da requisi\u00e7\u00e3o!");
      return;
    }

    try {
      const snap = await getDocs(collection(db, "abastecimentos"));
      const pendentes = await listarAbastecimentosPendentes(tenantId);

      const cidadeBusca = normalizarCidade(cidadeBase);
      const encontrado = snap.docs.find((docSnap) => {
        const dados = docSnap.data();
        return (
          String(dados.req) === String(buscaReq) &&
          belongsToTenant(dados, tenantId) &&
          (!cidadeBusca || normalizarCidade(dados.obraCidade) === cidadeBusca)
        );
      });

      if (!encontrado) {
        const pendente = pendentes.find((item) => {
          const dados = item.payload || {};
          return (
            String(dados.req) === String(buscaReq) &&
            (!cidadeBusca || normalizarCidade(dados.obraCidade) === cidadeBusca)
          );
        });

        if (pendente) {
          prepararCupom(pendente.payload, true);
          setBuscaReq("");
          return;
        }

        alert("Requisi\u00e7\u00e3o n\u00e3o encontrada!");
        return;
      }

      const dados = encontrado.data();

      prepararCupom(dados, true);

      setBuscaReq("");

    } catch (error) {
      console.error(error);
      alert("Erro ao buscar segunda via!");
    }
  };

  const carregarHistorico = async () => {
    try {
      const snap = await getDocs(collection(db, "abastecimentos"));
      const pendentes = await listarAbastecimentosPendentes(tenantId);

      const dados = snap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));

      // ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¥ ordena do mais recente
      const dadosPendentes = pendentes.map((item) => ({
        id: item.id,
        ...item.payload,
        offlinePendente: true,
        statusOffline: item.status || "pendente",
        ultimoErroOffline: item.ultimoErro || ""
      }));

      const dadosTenant = dados
        .filter((item) => belongsToTenant(item, tenantId))
        .sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")));

      setLista(
        [...dadosPendentes, ...dadosTenant]
          .sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")))
      );

    } catch (error) {
      console.error(error);
      alert("Erro ao carregar hist\u00f3rico!");
    }
  };
  
  const sair = () => {
    localStorage.removeItem("usuarioLogado");
    setTela("login");
  };

  const melosaAtiva = melosas.find((item) => item.id === melosaIdSessao) || null;
  const obraSelecionada = obras.find((o) => o.id === obraId);
  const obrasDaCidade = obras.filter(
    (o) => normalizarCidade(o.cidade) === normalizarCidade(cidadeBase)
  );
  const obraReferenciaCidade = obrasDaCidade[0] || null;
  const cidadeEstoque = cidadeBase || obraSelecionada?.cidade || "";
  const estadoEstoque = obraSelecionada?.estado || obraReferenciaCidade?.estado || "";
  const cidadesDisponiveis = Array.from(
    new Set(obras.map((o) => normalizarCidade(o.cidade)).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
  const baseUnicaTravada = cidadesDisponiveis.length === 1;
  const nomeObraSelecionada = obraSelecionada ? nomeObraExibicao(obraSelecionada) : "";
  const pendenciasComErro = pendenciasOffline.filter((item) => item.status === "erro").length;
  const pendenciasAguardando = pendenciasOffline.length - pendenciasComErro;

  return (
    <div style={page}>
      <h2 style={{
        textAlign: "center",
        marginBottom: 12,
        marginTop: 0,
        color: "#10243e",
        fontSize: 30
      }}>
        Abastecimento
      </h2>

      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 10
      }}>
        <span style={{
          fontWeight: "bold",
          color: "#0066cc"
        }}>
          Responsável pelo abastecimento
        </span>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={dangerButton} onClick={sair}>
            Sair
          </button>
        </div>
      </div>

      <div
        style={{
          ...card,
          marginTop: 0,
          background: isOnline ? "#eef9f1" : "#fff4d8",
          borderColor: isOnline ? "#b9e2c3" : "#f1d38a",
          color: "#234",
          fontWeight: "bold"
        }}
      >
        <strong>{isOnline ? "Celular online" : "Celular offline"}</strong>
        {" - "}
        {isOnline
          ? "os novos abastecimentos podem sincronizar automaticamente."
          : "os novos abastecimentos serão guardados no aparelho até a internet voltar."}
        <br />
        <span>
          Pendências no aparelho: {pendenciasOffline.length}
          {pendenciasAguardando > 0 ? ` | aguardando envio: ${pendenciasAguardando}` : ""}
          {pendenciasComErro > 0 ? ` | com revisão pendente: ${pendenciasComErro}` : ""}
          {sincronizandoPendencias ? " | sincronizando agora..." : ""}
        </span>
        {mensagemSincronizacao && (
          <>
            <br />
            <span>{mensagemSincronizacao}</span>
          </>
        )}
      </div>

      <p style={{
        ...card,
        marginTop: 0,
        background: estoqueTotalDiesel <= 500 ? "#ffe7e7" : "#e8f2ff",
        borderColor: estoqueTotalDiesel <= 500 ? "#f0b4b4" : "#b9d3ff",
        color: estoqueTotalDiesel <= 500 ? "#a10000" : "#003366",
        fontWeight: "bold"
      }}>
        <strong>{melosaAtiva ? "Saldo diesel da melosa:" : "Estoque Diesel da cidade:"}</strong> {estoqueTotalDiesel} L
        <br />
        <span>
          {melosaAtiva
            ? `Melosa ativa: ${melosaAtiva.nome || melosaAtiva.codigo || "-"}`
            : `Cidade do estoque: ${cidadeEstoque || "selecione uma cidade"}`}
        </span>
        <br />
        <span>Selecionado ({tipoDiesel}): {estoque} L</span>
        {melosaAtiva && (
          <>
            <br />
            <span>Saldo restante da base: {estoqueBaseDiesel} L</span>
          </>
        )}

        {estoqueTotalDiesel <= 500 && " - ESTOQUE BAIXO"}
      </p>

      <div style={card}>
        <h3 style={cardTitle}>Dados do abastecimento</h3>

      {/* TIPO */}
      <select
        style={inputField}
        value={tipoDiesel}
        onChange={(e) => setTipoDiesel(e.target.value)}
      >
        <option>S-10</option>
        <option>S-500</option>
      </select>

      {/* CIDADE BASE */}
      {melosaAtiva ? (
        <div
          style={{
            ...inputField,
            display: "flex",
            alignItems: "center",
            fontWeight: "bold",
            color: "#0b3d91",
            background: "#eef5ff"
          }}
        >
          Base da melosa: {melosaAtiva.baseCidade}
        </div>
      ) : baseUnicaTravada && cidadeBase ? (
        <div
          style={{
            ...inputField,
            display: "flex",
            alignItems: "center",
            fontWeight: "bold",
            color: "#0b3d91",
            background: "#eef5ff"
          }}
        >
          Base da unidade: {cidadeBase}
        </div>
      ) : (
        <select
          style={inputField}
          value={cidadeBase}
          onChange={(e) => {
            setCidadeBase(e.target.value);
            setObraId("");
          }}
        >
          <option value="">Selecione a cidade base</option>
          {cidadesDisponiveis.map((cidade) => (
            <option key={cidade} value={cidade}>
              {cidade}
            </option>
          ))}
        </select>
      )}

      {/* OBRA */}
      <select
        style={{ ...inputField, fontSize: 13 }}
        value={obraId}
        onChange={(e) => setObraId(e.target.value)}
        disabled={!cidadeBase}
      >
        <option value="">{cidadeBase ? "Selecione a obra" : "Selecione a cidade primeiro"}</option>
        {obrasDaCidade.map((o) => (
          <option key={o.id} value={o.id} title={o.nome}>
            {nomeObraExibicao(o)}
          </option>
        ))}
      </select>

      {obraId && (
        <div style={{ marginTop: 4, marginBottom: 10, fontSize: 14, fontWeight: "bold", color: "#1b3e8a" }}>
          Obra selecionada: {nomeObraSelecionada}
        </div>
      )}

      {/* EQUIPAMENTO */}
      <select
        style={inputField}
        value={equipamento}
        onChange={(e) => {
          const nomeSelecionado = e.target.value;

          setEquipamento(nomeSelecionado);

          // ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¥ ACHA O EQUIPAMENTO COMPLETO
          const eq = equipamentos.find(
            (item) => item.nome === nomeSelecionado
          );

          if (eq) {
            setCodigo(eq.codigo || "");
            setPlaca(eq.placa || "");
          }
        }}
      >
        <option value="">Selecione equipamento</option>
        {equipamentos.map((eq, i) => (
          <option key={i}>{eq.nome}</option>
        ))}
      </select>

      <div style={grid2}>
        <input
          style={inputField}
          type="date"
          value={data}
          onChange={(e) => setData(e.target.value)}
        />

        <input
          style={inputField}
          placeholder="Litros"
          value={litros}
          onChange={(e) => setLitros(e.target.value)}
        />
      </div>

      <div style={{ marginTop: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: "bold" }}>
          <input
            type="checkbox"
            checked={horimetroQuebrado}
            onChange={(e) => {
              const marcado = e.target.checked;
              setHorimetroQuebrado(marcado);
            }}
          />
          Horimetro do equipamento quebrado
        </label>

        <input
          style={{ ...inputField, marginTop: 10 }}
          placeholder={horimetroQuebrado ? "Leitura do Horimetro/KM (quebrado)" : "Horimetro / KM"}
          value={horimetro}
          onChange={(e) => setHorimetro(e.target.value)}
        />
      </div>

      </div>

      <div style={card}>
        <h3 style={cardTitle}>Lubrificação</h3>

      <select
        style={inputField}
        value={tipoLubrificante}
        onChange={(e) => setTipoLubrificante(e.target.value)}
      >
        <option value="">Tipo</option>
        <option>Oleo</option>
        <option>Graxa</option>
      </select>

      <div style={grid2}>
        <select
          style={inputField}
          value={produtoLubrificante}
          onChange={(e) => setProdutoLubrificante(e.target.value)}
        >
          <option value="">Produto</option>
          {[...new Set(
            lubrificantes
              .filter(
                (l) =>
                  mesmoTipoLubrificante(l, tipoLubrificante) &&
                  mesmoLocal(l, cidadeEstoque, estadoEstoque)
              )
              .map((l) => l.nome)
          )].map((nome, i) => (
            <option key={i}>{nome}</option>
          ))}
        </select>

        <input
          style={inputField}
          placeholder="Quantidade"
          value={quantidadeLubrificante}
          onChange={(e) => setQuantidadeLubrificante(e.target.value)}
        />
      </div>

      <button
        style={primaryButton}
        onClick={() => {
          if (!produtoLubrificante || !quantidadeLubrificante) return;

          const unidade =
            normalizarChave(tipoLubrificante).includes("LEO") ? "L" : "KG";
          const quantidadeNum = parseDecimalInput(quantidadeLubrificante);

          if (quantidadeNum <= 0) {
            alert("Quantidade de lubrificante invalida.");
            return;
          }

          setItensLubrificacao([
            ...itensLubrificacao,
            {
              tipo: tipoLubrificante,
              produto: produtoLubrificante,
              quantidade: quantidadeNum,
              unidade
            }
          ]);
          setProdutoLubrificante("");
          setQuantidadeLubrificante("");

        }}
      >
        Adicionar Lubrificante
      </button>

      {itensLubrificacao.map((item, i) => (
        <p key={i}>
          {item.tipo} - {item.produto} ({item.quantidade} {item.unidade})
        </p>
      ))}
      
      </div>

      <div style={card}>
        <h3 style={cardTitle}>Responsável</h3>

      {melosaAtiva && (
        <div style={{ marginBottom: 10, background: "#eef4ff", border: "1px solid #c9dafd", borderRadius: 8, padding: "8px 10px", color: "#1b3e8a", fontWeight: "bold" }}>
          Frentista vinculado à melosa: {melosaAtiva.nome || melosaAtiva.codigo || "-"}
        </div>
      )}

      {/* EMPRESA */}
      <select
        style={inputField}
        value={empresa}
        onChange={(e) => setEmpresa(e.target.value)}
      >

        <option value="">Requisitante</option>
        {empresas.map((emp, i) => (
          <option key={i}>{emp}</option>
        ))}
      </select>

      {/* OPERADOR */}
      <select
        style={inputField}
        value={operador}
        onChange={(e) => setOperador(e.target.value)}
      >  

        <option value="">Selecione o operador</option>

        {operadores.map((op, i) => (
          <option key={i}>{op.nome}</option>
        ))}
      </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, marginBottom: 8 }}>
        <div style={infoChip}>Requisição: {req}</div>
        <div style={infoChip}>Código: {codigo || "-"}</div>
        <div style={infoChip}>Placa: {placa || "-"}</div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <button
          style={secondaryButton}
          onClick={() => setMostrarHistorico(!mostrarHistorico)}
        >
          {mostrarHistorico ? "Ocultar Histórico" : "Ver Histórico"}
        </button>
        <button
          style={{ ...primaryButton, opacity: isOnline && pendenciasOffline.length > 0 ? 1 : 0.7 }}
          onClick={sincronizarPendencias}
          disabled={!isOnline || pendenciasOffline.length === 0 || sincronizandoPendencias}
        >
          {sincronizandoPendencias ? "Sincronizando..." : "Sincronizar pendências"}
        </button>
      </div>


      <div style={card}>
        <h3 style={cardTitle}>Observação</h3>

        <textarea
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 8,
            border: "1px solid #cfd7e3",
            minHeight: 90,
            resize: "vertical",
            boxSizing: "border-box"
          }}
          placeholder="Observação"
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
        />
      </div>

      <div style={card}>
        <h3 style={cardTitle}>Assinatura</h3>

        <p style={{ fontSize: 12, color: "#666", marginBottom: 5 }}>
          Assine com o dedo ou caneta no campo abaixo.
        </p>

        <div style={{ display: "flex", justifyContent: "center" }}>
          <SignatureCanvas
            penColor="black"
            canvasProps={{
              width: assinaturaWidth,
              height: 150,
              className: "sigCanvas",
              style: {
                border: "2px dashed #97a7bf",
                borderRadius: 8,
                background: "#fafcff"
              }
            }}
            ref={sigPad}
          />
        </div> 

        <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
          <button
            style={secondaryButton}
            onClick={() => sigPad.current && sigPad.current.clear()}
          >
            Limpar assinatura
          </button>
        </div>
      </div>

      {/* ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¥ HISTÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œRICO */}
      {mostrarHistorico && (
        <div style={card}>
          <h3 style={cardTitle}>Hist\u00f3rico de abastecimento</h3>

          {lista.map((item) => (
            <div
              key={item.id}
              style={{
                borderBottom: "1px solid #ccc",
                padding: "8px 0"
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  cursor: "pointer"
                }}
                onClick={() =>
                  setAberto(aberto === item.id ? null : item.id)
                }
              >
                <span>
                  <strong>Req:</strong> {item.req}
                  {item.offlinePendente && (
                    <span style={{ marginLeft: 8, color: item.statusOffline === "erro" ? "#c0392b" : "#b06b00" }}>
                      {item.statusOffline === "erro" ? "Pendente com revisão" : "Pendente no aparelho"}
                    </span>
                  )}
                </span>
                <span>{item.equipamento}</span>
              </div>

              {aberto === item.id && (
                <div style={{ marginTop: 8 }}>
                  <p><strong>Frentista:</strong> {item.frentista}</p>
                  {item.melosaNome ? <p><strong>Melosa:</strong> {item.melosaNome}</p> : null}
                  <p><strong>Litros:</strong> {item.litros}</p>
                  <p><strong>Data/Hora:</strong> {item.dataHora}</p>
                  <p><strong>Operador:</strong> {item.operador}</p>
                  {item.offlinePendente && item.ultimoErroOffline && (
                    <p><strong>Último erro:</strong> {item.ultimoErroOffline}</p>
                  )}

                  <button
                    style={primaryButton}
                      onClick={() => prepararCupom(item, true)}
                    >
                      Gerar cupom
                    </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 15, flexWrap: "wrap" }}>
        <button style={primaryButton} onClick={salvar}>
          Salvar abastecimento
        </button>
        {ultimoCupomDados && (
          <button
            style={{ ...secondaryButton, background: "#0b5ed7", color: "#fff" }}
            onClick={() => prepararCupom(ultimoCupomDados, true)}
          >
            Gerar cupom
          </button>
        )}
      </div>

      {cupomUrl && (
        <div
          style={{
            ...card,
            marginTop: 10,
            borderColor: "#d7e4ff",
            background: "#f1f6ff"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <strong style={{ color: "#10243e" }}>Cupom pronto</strong>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={secondaryButton} onClick={() => window.open(cupomUrl)}>
                Abrir
              </button>
              <button style={secondaryButton} onClick={baixarCupom}>
                Baixar
              </button>
              <button style={secondaryButton} onClick={compartilharCupom}>
                Compartilhar
              </button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#4a5c74", marginTop: 6 }}>
            No celular, "Compartilhar" abre WhatsApp/e-mail (se suportado). No PC, use Abrir/Baixar.
          </div>
        </div>
      )}
      </div>
  );
}

export default Abastecimento;










