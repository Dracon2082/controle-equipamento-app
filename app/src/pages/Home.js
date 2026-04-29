import { useEffect, useMemo, useState } from "react";
import logoSistema from "../assets/logo-sistema.png";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { belongsToTenant, getTenantId } from "../utils/tenant";
import {
  avaliarBloqueioInadimplencia,
  avaliarBloqueioTeste,
  avaliarInadimplenciaAutomatica,
  carregarClienteSistema
} from "../utils/clienteSistema";

function Home({ setTela, onSair }) {
  const tenantId = getTenantId();
  const PERFIL_GESTOR_GERAL = "GESTOR_GERAL";
  const PERFIL_ADMIN_UNIDADE = "ADMIN_UNIDADE";
  const PERMISSAO_ADMIN_RELATORIOS = "admin_relatorios";
  const PERMISSAO_ADMIN_CADASTROS = "admin_cadastros";
  const PERMISSAO_ADMIN_CONTROLE = "admin_controle";
  const PERMISSAO_ADMIN_FINANCEIRO = "admin_financeiro";

  const sessaoOperacional = (() => {
    try {
      return JSON.parse(localStorage.getItem("sessaoOperacional") || "{}");
    } catch {
      return {};
    }
  })();
  const inferirPerfilAcesso = () => {
    const perfilDireto = String(sessaoOperacional?.perfilAcesso || "").trim().toUpperCase();
    if (perfilDireto) return perfilDireto;

    const perfilLegado = String(sessaoOperacional?.perfil || "").trim().toUpperCase();
    if (perfilLegado.includes("GESTOR")) return PERFIL_GESTOR_GERAL;

    const permissoes = Array.isArray(sessaoOperacional?.permissoes)
      ? sessaoOperacional.permissoes.map((p) => String(p || "").trim())
      : [];
    if (
      permissoes.includes(PERMISSAO_ADMIN_RELATORIOS) ||
      permissoes.includes(PERMISSAO_ADMIN_CADASTROS) ||
      permissoes.includes(PERMISSAO_ADMIN_CONTROLE) ||
      permissoes.includes(PERMISSAO_ADMIN_FINANCEIRO)
    ) {
      return PERFIL_ADMIN_UNIDADE;
    }
    return "";
  };
  const perfilAcesso = inferirPerfilAcesso();
  const usuarioChave = Boolean(sessaoOperacional?.usuarioChave);
  const permissoesUsuario = Array.isArray(sessaoOperacional?.permissoes)
    ? sessaoOperacional.permissoes.map((p) => String(p || "").trim())
    : [];

  const acessoTotalBases = perfilAcesso === PERFIL_GESTOR_GERAL || usuarioChave;
  const basesPermitidas = Array.isArray(sessaoOperacional?.basesPermitidas)
    ? sessaoOperacional.basesPermitidas.map((b) => String(b || "").trim().toUpperCase()).filter(Boolean)
    : [];
  const cidadesPermitidas = new Set(
    basesPermitidas
      .map((b) => String(b || "").split("__")[0])
      .map((c) => String(c || "").trim().toUpperCase())
      .filter(Boolean)
  );
  const basePermitida = (baseChave) => {
    const chave = String(baseChave || "").trim().toUpperCase();
    if (!chave) return true;
    if (acessoTotalBases) return true;
    if (basesPermitidas.length > 0 && basesPermitidas.includes(chave)) return true;
    const cidade = chave.split("__")[0];
    if (cidade && cidadesPermitidas.has(cidade)) return true;
    // Se o usuario nao tem bases configuradas, nao bloqueia (evita sumir tudo).
    if (basesPermitidas.length === 0) return true;
    return false;
  };

  const [alertasManutencao, setAlertasManutencao] = useState([]);
  const alertasAbertosCount = useMemo(() => alertasManutencao.length, [alertasManutencao]);
  const [clienteSistema, setClienteSistema] = useState(null);
  const [testeBloqueado, setTesteBloqueado] = useState(false);
  const [testeExpiraEmMs, setTesteExpiraEmMs] = useState(null);
  const [inadimplente, setInadimplente] = useState(false);
  const [inadimplenciaRef, setInadimplenciaRef] = useState("");

  useEffect(() => {
    let ativo = true;
    const carregar = async () => {
      try {
        const cliente = await carregarClienteSistema(tenantId);
        if (!ativo) return;
        setClienteSistema(cliente);
        const avaliacao = avaliarBloqueioTeste(cliente);
        setTesteBloqueado(Boolean(avaliacao?.bloqueado));
        setTesteExpiraEmMs(avaliacao?.expiraEmMs || null);
        const inad = avaliarBloqueioInadimplencia(cliente);
        const inadAuto = avaliarInadimplenciaAutomatica(cliente, { carenciaDias: 10 });
        const bloqueado = Boolean(inad?.bloqueado) || Boolean(inadAuto?.bloqueado);
        setInadimplente(bloqueado);
        setInadimplenciaRef(String(inadAuto?.refDevida || ""));
      } catch {
        if (!ativo) return;
        setClienteSistema(null);
        setTesteBloqueado(false);
        setTesteExpiraEmMs(null);
        setInadimplente(false);
        setInadimplenciaRef("");
      }
    };
    carregar();
    const timer = setInterval(carregar, 60 * 1000);
    return () => {
      ativo = false;
      clearInterval(timer);
    };
  }, [tenantId]);

  useEffect(() => {
    if (!podeAcessarTela("manutencao")) return;

    let ativo = true;
    const carregar = async () => {
      try {
        const snap = await getDocs(collection(db, "alertas_manutencao"));
        const lista = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((i) => belongsToTenant(i, tenantId))
          .filter((i) => String(i.status || "").trim().toUpperCase() === "ABERTO")
          .filter((i) => basePermitida(i.baseChave))
          .sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")));
        if (ativo) setAlertasManutencao(lista);
      } catch {
        // ignora falha de rede/permissao
      }
    };

    carregar();
    const timer = setInterval(carregar, 30000);
    return () => {
      ativo = false;
      clearInterval(timer);
    };
  }, [tenantId, perfilAcesso, usuarioChave]); // eslint-disable-line react-hooks/exhaustive-deps
  const [menuContaAberto, setMenuContaAberto] = useState(false);

  const nomeUsuarioLogado = String(sessaoOperacional?.nome || localStorage.getItem("usuarioLogado") || "USUARIO").trim();
  const nomeUsuarioCurto = (() => {
    const primeiro = nomeUsuarioLogado.split(" ").filter(Boolean)[0] || "USUARIO";
    return primeiro.toUpperCase();
  })();
  const iniciaisUsuario = (() => {
    const partes = nomeUsuarioLogado.split(" ").filter(Boolean);
    if (!partes.length) return "US";
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return `${partes[0].slice(0, 1)}${partes[partes.length - 1].slice(0, 1)}`.toUpperCase();
  })();

  const podeAcessarTela = (tela) => {
  const telasAdminRelatorios = new Set(["relatorio", "relatorioAbastecimento", "relatorioTransferencias", "relatorioManutencao", "relatorioProducaoCampo", "relatorioDiarioObra", "historico"]);
    const telasAdminCadastros = new Set(["equipamentos", "funcionarios", "obras", "bases", "frentistas", "empresas", "configEmpresa"]);
    const telasAdminControle = new Set(["lubrificantes", "almoxarifado", "transferencias"]);
    const telasAdminFinanceiro = new Set(["financeiro"]);
    const telasExclusivasUsuarioChave = new Set(["configEmpresa"]);
  const telasOperacionais = new Set(["lancamento", "diarioObra", "abastecimento", "producaoCampo", "manutencao", "materiaisSaidas", "receberTransferencia"]);

    // TESTE 10 dias expirado: bloqueia operacao/cadastros/controle.
    // Mantemos relatorios e financeiro liberados para o cliente visualizar e escolher um plano.
    if (testeBloqueado || inadimplente) {
      const telasBloqueadas = new Set([
        ...Array.from(telasOperacionais),
        ...Array.from(telasAdminCadastros),
        ...Array.from(telasAdminControle)
      ]);
      if (telasBloqueadas.has(tela)) return false;
    }

    if (telasExclusivasUsuarioChave.has(tela) && !usuarioChave) return false;
    if (perfilAcesso === PERFIL_GESTOR_GERAL) return true;
    if (perfilAcesso === PERFIL_ADMIN_UNIDADE) return true;

    if (telasAdminFinanceiro.has(tela)) return permissoesUsuario.includes(PERMISSAO_ADMIN_FINANCEIRO);
    if (telasAdminRelatorios.has(tela)) return permissoesUsuario.includes(PERMISSAO_ADMIN_RELATORIOS);
    if (telasAdminCadastros.has(tela)) return permissoesUsuario.includes(PERMISSAO_ADMIN_CADASTROS);
    if (telasAdminControle.has(tela)) return permissoesUsuario.includes(PERMISSAO_ADMIN_CONTROLE);
    if (telasOperacionais.has(tela)) {
      if (perfilAcesso === PERFIL_ADMIN_UNIDADE) return true;
      if (tela === "materiaisSaidas") {
        return permissoesUsuario.includes("materiaisSaidas") || permissoesUsuario.includes("almoxarifado") || permissoesUsuario.includes("epi");
      }
      // ReceberTransferencia (QR) segue permissao propria (ou legado "transferencias").
      if (tela === "receberTransferencia") {
        return permissoesUsuario.includes("receberTransferencia") || permissoesUsuario.includes("transferencias");
      }
      return permissoesUsuario.includes(tela);
    }

    return true;
  };

  const isMobileDevice = (() => {
    const ua = String(window.navigator?.userAgent || "").toLowerCase();
    const mobileUA = /android|iphone|ipad|ipod|mobile|opera mini|iemobile/.test(ua);
    return mobileUA || window.innerWidth <= 900;
  })();
  const [modoPainel, setModoPainel] = useState(() => {
    try {
      const salvo = String(localStorage.getItem("modoPainelHome") || "").toLowerCase();
      if (salvo === "administrativo" || salvo === "operacional") return salvo;
    } catch {
      // ignora erro de storage e usa padrao
    }
    return "operacional";
  });
  const [navHover, setNavHover] = useState("");

  const alterarModoPainel = (modo) => {
    setModoPainel(modo);
    try {
      localStorage.setItem("modoPainelHome", modo);
    } catch {
      // ignora erro de storage
    }
  };
  const page = {
    minHeight: "100vh",
    background: "#eef2f7",
    display: "grid",
    gridTemplateColumns: isMobileDevice ? "1fr" : "108px 1fr"
  };

  const sidebar = {
    background: "#0b5ed7",
    color: "#fff",
    padding: isMobileDevice ? "8px" : "10px 10px",
    borderRight: isMobileDevice ? "none" : "1px solid rgba(255,255,255,0.25)",
    display: isMobileDevice ? "flex" : "block",
    gap: isMobileDevice ? 8 : 0,
    overflowX: isMobileDevice ? "auto" : "visible",
    alignItems: "center"
  };

  const brand = {
    width: 98,
    height: 98,
    borderRadius: 0,
    background: "transparent",
    margin: isMobileDevice ? "0 4px 0 0" : "0 auto 10px",
    flex: "0 0 auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  };

  const navButton = {
    width: isMobileDevice ? "auto" : "100%",
    border: "none",
    background: "rgba(255,255,255,0.12)",
    color: "#fff",
    borderRadius: 8,
    padding: "10px 8px",
    fontSize: 11,
    lineHeight: "14px",
    fontWeight: "bold",
    cursor: "pointer",
    textAlign: "center",
    marginBottom: isMobileDevice ? 0 : 8,
    minHeight: 40,
    boxSizing: "border-box",
    // No painel operacional: preferimos quebrar linha do que abreviar com "...".
    whiteSpace: "normal",
    flex: isMobileDevice ? "0 0 auto" : "none",
    minWidth: isMobileDevice ? 88 : "unset",
    outline: "none",
    transition: "transform 120ms ease, background 120ms ease, box-shadow 120ms ease"
  };

  const badge = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 18,
    height: 18,
    padding: "0 6px",
    borderRadius: 999,
    background: "#dc3545",
    color: "#fff",
    fontSize: 11,
    fontWeight: 900,
    lineHeight: 1
  };

  const alertaPill = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 999,
    background: "#fff1f1",
    border: "1px solid #ffd1d1",
    color: "#8a1f1f",
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 2px 10px rgba(16,36,62,0.08)"
  };

  const navButtonStyle = (key, isActive = false) => {
    const isHover = navHover === key;
    const bg = isActive
      ? "rgba(255,255,255,0.22)"
      : (isHover ? "rgba(255,255,255,0.18)" : navButton.background);
    return {
      ...navButton,
      background: bg,
      boxShadow: isActive
        ? "0 6px 16px rgba(0,0,0,0.12)"
        : (isHover ? "0 4px 12px rgba(0,0,0,0.10)" : "none"),
      transform: isHover ? "translateY(-1px)" : "none",
      border: isActive ? "1px solid rgba(255,255,255,0.55)" : "1px solid rgba(255,255,255,0.0)"
    };
  };

  const main = {
    padding: isMobileDevice ? 10 : 14
  };

  const topbar = {
    background: "#fff",
    borderRadius: 8,
    border: "1px solid #dbe3ef",
    padding: isMobileDevice ? "10px" : "12px 14px",
    display: "flex",
    flexDirection: isMobileDevice ? "column" : "row",
    justifyContent: "space-between",
    alignItems: isMobileDevice ? "flex-start" : "center",
    marginBottom: 12
  };

  const titleBox = {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
    flex: 1,
    textAlign: "left"
  };

  const titulo = {
    margin: "6px 0 0",
    fontSize: isMobileDevice ? 24 : 28,
    color: "#163256"
  };

  const subtitulo = { margin: 0, color: "#6b7c93", fontSize: isMobileDevice ? 12 : 13 };

  const contaButton = {
    border: "1px solid #dbe3ef",
    background: "#fff",
    borderRadius: 999,
    padding: "6px 10px 6px 8px",
    display: "flex",
    alignItems: "center",
    gap: 8,
    cursor: "pointer"
  };
  const avatar = {
    width: 30,
    height: 30,
    borderRadius: "50%",
    background: "#0b5ed7",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    fontSize: 12,
    fontWeight: "bold"
  };
  const menuConta = {
    position: "absolute",
    right: 0,
    top: "calc(100% + 6px)",
    minWidth: 190,
    background: "#fff",
    border: "1px solid #dbe3ef",
    borderRadius: 10,
    boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
    overflow: "hidden",
    zIndex: 20
  };
  const menuContaItem = {
    width: "100%",
    border: "none",
    background: "#fff",
    padding: "11px 12px",
    textAlign: "left",
    cursor: "pointer",
    color: "#173454",
    fontWeight: 600
  };

  const sections = {
    display: "grid",
    // Auto-ajuste: evita setores estreitos demais (que deixam os tiles pequenos).
    // Em telas grandes, isso tende a ficar em 3-4 colunas em vez de 5.
    gridTemplateColumns: isMobileDevice ? "1fr" : "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 12
  };

  const section = {
    background: "#fff",
    border: "1px solid #e3e7ef",
    borderRadius: 8,
    padding: 14,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)"
  };

  const sectionTitle = {
    margin: "0 0 12px",
    fontSize: 18,
    color: "#10243e"
  };

  const buttonList = {
    display: "grid",
    // Tiles se ajustam automaticamente: quando o setor estiver estreito vira 1 coluna;
    // quando tiver espaco suficiente vira 2.
    gridTemplateColumns: isMobileDevice ? "1fr" : "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 10
  };

  const actionButton = {
    width: "100%",
    border: "1px solid #e3e7ef",
    background: "#f1f6ff",
    color: "#10243e",
    borderRadius: 8,
    borderColor: "#d7e4ff",
    padding: "12px 12px",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer",
    textAlign: "left",
    boxSizing: "border-box",
    boxShadow: "0 1px 3px rgba(16,36,62,0.08)",
    transition: "transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease",
    // Mantem os tiles com altura consistente (evita parecer desalinhado).
    minHeight: 92,
    // Importante: nao cortar texto com "...". Deixe o tile crescer.
    overflow: "visible"
  };
  const tileInner = {
    display: "grid",
    gridTemplateColumns: "36px 1fr",
    gap: 10,
    alignItems: "flex-start"
  };
  // Compat: se o navegador ainda estiver com um hot-update antigo em cache,
  // pode existir referencia a `tileIcon` / `iconeTela`. Mantemos definidos (e ocultos)
  // para evitar erro em runtime durante o refresh.
  // eslint-disable-next-line no-unused-vars
  const tileIcon = { display: "none" };
  const tileTitle = {
    fontWeight: 800,
    color: "#10243e",
    lineHeight: 1.2,
    whiteSpace: "normal",
    wordBreak: "break-word"
  };
  const tileDesc = {
    marginTop: 2,
    fontSize: 12,
    fontWeight: 600,
    color: "#4a5c74",
    lineHeight: 1.2,
    whiteSpace: "normal",
    wordBreak: "break-word"
  };
  const resumoTela = (tela) => {
    const t = String(tela || "").toLowerCase();
    if (t === "lancamento") return "Lancamento diario (equipamento e producao)";
    if (t === "diarioobra") return "RDO: diario de obra (modelo)";
    if (t === "abastecimento") return "Diesel: litros e cupom";
    if (t === "producaocampo") return "Croqui + pontos (RP/TB/RC)";
    if (t === "manutencao") return "Ordens, custos e historico";
    if (t === "almoxarifado") return "Entrada central: almox + diesel/lubrificantes";
    if (t === "materiaissaidas") return "Saidas: ferramentas + insumos + EPI";
    if (t === "transferencias") return "Boletim e movimentacoes";
    if (t === "recebertransferencia") return "Leitura QR + assinatura no destino";
    if (t === "relatorio") return "Mensal de equipamento";
    if (t === "relatorioabastecimento") return "Relatorio de diesel";
    if (t === "relatoriotransferencias") return "Relatorio de transferencias";
    if (t === "relatoriomanutencao") return "Relatorio de manutencao";
    if (t === "relatorioproducaocampo") return "PDF do croqui e itens";
    if (t === "relatoriodiarioobra") return "RDO: relatorio de diario de obra";
    if (t === "equipamentos") return "Cadastro e controle";
    if (t === "funcionarios") return "Operadores e perfis";
    if (t === "obras") return "Obras, bases e locais";
    if (t === "frentistas") return "Usuarios operacionais";
    if (t === "empresas") return "Requisitantes";
    if (t === "configempresa") return "Dados da empresa";
    if (t === "financeiro") return "Planos e cobranca";
    if (t === "historico") return "Auditoria do sistema";
    if (t === "lubrificantes") return "Entrada central (aba diesel/lubrificantes)";
    return "";
  };
  // eslint-disable-next-line no-unused-vars
  const iconeTela = () => "";

  const metaTela = (tela) => {
    const t = String(tela || "").toLowerCase();
    if (t === "lancamento") return { accent: "#0b5ed7", bg: "#eaf2ff", icon: "clipboard" };
    if (t === "diarioobra") return { accent: "#3b5bdb", bg: "#eef2ff", icon: "file" };
    if (t === "abastecimento") return { accent: "#198754", bg: "#eafaf1", icon: "droplet" };
    if (t === "producaocampo") return { accent: "#d63384", bg: "#fff0f6", icon: "map" };
    if (t === "manutencao") return { accent: "#fd7e14", bg: "#fff4e6", icon: "wrench" };
    if (t === "almoxarifado") return { accent: "#4c6ef5", bg: "#eef2ff", icon: "box" };
    if (t === "materiaissaidas") return { accent: "#0b7285", bg: "#e7f5ff", icon: "box" };
    if (t === "transferencias") return { accent: "#495057", bg: "#f1f3f5", icon: "arrows" };
    if (t === "recebertransferencia") return { accent: "#0b5ed7", bg: "#eaf2ff", icon: "arrows" };

    // Admin
    if (t === "relatorio") return { accent: "#5c7cfa", bg: "#eef2ff", icon: "chart" };
    if (t === "relatorioabastecimento") return { accent: "#2f9e44", bg: "#eafaf1", icon: "file" };
    if (t === "relatoriotransferencias") return { accent: "#868e96", bg: "#f1f3f5", icon: "file" };
    if (t === "relatoriomanutencao") return { accent: "#fd7e14", bg: "#fff4e6", icon: "file" };
    if (t === "relatorioproducaocampo") return { accent: "#d63384", bg: "#fff0f6", icon: "file" };
    if (t === "relatoriodiarioobra") return { accent: "#3b5bdb", bg: "#eef2ff", icon: "file" };
    if (t === "equipamentos") return { accent: "#364fc7", bg: "#eef2ff", icon: "gear" };
    if (t === "funcionarios") return { accent: "#0b7285", bg: "#e7f5ff", icon: "users" };
    if (t === "obras") return { accent: "#1971c2", bg: "#eaf2ff", icon: "pin" };
    if (t === "frentistas") return { accent: "#2b8a3e", bg: "#eafaf1", icon: "id" };
    if (t === "empresas") return { accent: "#495057", bg: "#f1f3f5", icon: "building" };
    if (t === "configempresa") return { accent: "#0b5ed7", bg: "#eaf2ff", icon: "settings" };
    if (t === "financeiro") return { accent: "#0ca678", bg: "#eafaf1", icon: "money" };
    if (t === "historico") return { accent: "#868e96", bg: "#f1f3f5", icon: "clock" };
    if (t === "lubrificantes") return { accent: "#198754", bg: "#eafaf1", icon: "truck" };

    return { accent: "#0b5ed7", bg: "#f1f6ff", icon: "dot" };
  };

  const iconSvg = (name, color) => {
    const common = {
      width: 18,
      height: 18,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: color,
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round"
    };
    if (name === "droplet") return (
      <svg {...common}><path d="M12 2s6 7 6 12a6 6 0 0 1-12 0c0-5 6-12 6-12z" /></svg>
    );
    if (name === "wrench") return (
      <svg {...common}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-6.6 6.6 2 2 6.6-6.6a4 4 0 0 0 5.4-5.4l-2 2-2-2 2-2z" /></svg>
    );
    if (name === "box") return (
      <svg {...common}><path d="M21 8l-9 5-9-5" /><path d="M3 8v10l9 5 9-5V8" /><path d="M12 13v10" /></svg>
    );
    if (name === "shield") return (
      <svg {...common}><path d="M12 2l8 4v6c0 5-3.5 9.5-8 10-4.5-.5-8-5-8-10V6l8-4z" /></svg>
    );
    if (name === "arrows") return (
      <svg {...common}><path d="M7 7h14v14" /><path d="M21 7l-7 7" /><path d="M17 3H3v14" /><path d="M3 17l7-7" /></svg>
    );
    if (name === "clipboard") return (
      <svg {...common}><path d="M9 4h6l1 2h3v16H5V6h3l1-2z" /><path d="M9 4v2h6V4" /></svg>
    );
    if (name === "map") return (
      <svg {...common}><path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3z" /><path d="M9 3v15" /><path d="M15 6v15" /></svg>
    );
    if (name === "chart") return (
      <svg {...common}><path d="M4 19V5" /><path d="M4 19h16" /><path d="M8 16v-6" /><path d="M12 16V8" /><path d="M16 16v-3" /></svg>
    );
    if (name === "gear") return (
      <svg {...common}><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" /><path d="M19.4 15a7.9 7.9 0 0 0 .1-2l2-1.5-2-3.5-2.4.8a7.7 7.7 0 0 0-1.7-1L15 5h-6l-.4 2.8a7.7 7.7 0 0 0-1.7 1L4.5 8 2.5 11.5 4.5 13a7.9 7.9 0 0 0 .1 2l-2 1.5 2 3.5 2.4-.8a7.7 7.7 0 0 0 1.7 1L9 23h6l.4-2.8a7.7 7.7 0 0 0 1.7-1l2.4.8 2-3.5-2.1-1.5z" /></svg>
    );
    if (name === "users") return (
      <svg {...common}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
    );
    if (name === "pin") return (
      <svg {...common}><path d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
    );
    if (name === "id") return (
      <svg {...common}><path d="M4 7h16v14H4z" /><path d="M4 7l3-4h10l3 4" /><path d="M8 14h4" /><path d="M8 17h6" /><circle cx="16.5" cy="14.5" r="1.5" /></svg>
    );
    if (name === "building") return (
      <svg {...common}><path d="M3 21V7l9-4 9 4v14" /><path d="M9 21v-8h6v8" /><path d="M7 10h.01" /><path d="M17 10h.01" /><path d="M7 13h.01" /><path d="M17 13h.01" /></svg>
    );
    if (name === "settings") return (
      <svg {...common}><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" /><path d="M19.4 15a7.9 7.9 0 0 0 .1-2l2-1.5-2-3.5-2.4.8a7.7 7.7 0 0 0-1.7-1L15 5h-6l-.4 2.8a7.7 7.7 0 0 0-1.7 1L4.5 8 2.5 11.5 4.5 13a7.9 7.9 0 0 0 .1 2l-2 1.5 2 3.5 2.4-.8a7.7 7.7 0 0 0 1.7 1L9 23h6l.4-2.8a7.7 7.7 0 0 0 1.7-1l2.4.8 2-3.5-2.1-1.5z" /></svg>
    );
    if (name === "money") return (
      <svg {...common}><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" /></svg>
    );
    if (name === "clock") return (
      <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v6l4 2" /></svg>
    );
    if (name === "truck") return (
      <svg {...common}><path d="M3 7h11v10H3z" /><path d="M14 10h4l3 3v4h-7" /><circle cx="7" cy="19" r="2" /><circle cx="18" cy="19" r="2" /></svg>
    );
    if (name === "file") return (
      <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
    );
    return (
      <svg {...common}><circle cx="12" cy="12" r="3" /></svg>
    );
  };

  const tileIconWrap = (accent) => ({
    width: 36,
    height: 36,
    borderRadius: 10,
    background: "rgba(255,255,255,0.75)",
    border: `1px solid ${accent}33`,
    display: "grid",
    placeItems: "center"
  });

  const tileButtonStyle = (tela) => {
    const meta = metaTela(tela);
    return {
      ...actionButton,
      background: meta.bg,
      borderColor: `${meta.accent}33`,
      boxShadow: "0 2px 10px rgba(16,36,62,0.08)",
      borderLeft: `5px solid ${meta.accent}`
    };
  };

  const secoesOperacionais = [
    {
      titulo: "Operacao",
      itens: [
        { texto: "Lancamento Diario de Equipamento", tela: "lancamento" },
        { texto: "Diario de Obra (RDO)", tela: "diarioObra" },
        { texto: "Abastecimento", tela: "abastecimento" },
        // No computador, evitamos expor "lancamento/croqui" (sem GPS). O uso principal fica no celular.
        ...(isMobileDevice ? [{ texto: "Producao de Campo / Croqui", tela: "producaoCampo" }] : []),
        { texto: "Manutencao de Equipamentos", tela: "manutencao" },
        { texto: "Saidas de Materiais (Almox/EPI)", tela: "materiaisSaidas" },
        // No destino (celular), o recebimento e feito via QR + assinatura.
        { texto: "Receber Transferencia (QR)", tela: "receberTransferencia" }
      ]
    }
  ];

  // Painel Administrativo separado por setores (mais facil de entender no dia a dia).
  const secoesAdministrativas = [
    {
      titulo: "Engenharia",
      itens: [
        { texto: "Relatorio Producao de Campo / Croqui", tela: "relatorioProducaoCampo" },
        { texto: "Relatorio Diario de Obra (RDO)", tela: "relatorioDiarioObra" }
      ]
    },
    {
      titulo: "Manutencao",
      itens: [
        { texto: "Relatorio Mensal de Equipamento", tela: "relatorio" },
        { texto: "Relatorio de Manutencao", tela: "relatorioManutencao" }
      ]
    },
    {
      titulo: "Transporte",
      itens: [
        { texto: "Boletim de Transferencia", tela: "transferencias" },
        { texto: "Relatorio de Transferencias", tela: "relatorioTransferencias" },
        { texto: "Relatorio de Abastecimento", tela: "relatorioAbastecimento" }
      ]
    },
    {
      titulo: "Almoxarifado",
      itens: [
        { texto: "Entrada de Materiais (Central)", tela: "almoxarifado" }
      ]
    },
    {
      titulo: "Administrativo (Cadastros)",
      itens: [
        { texto: "Bases (UF/Cidades)", tela: "bases" },
        { texto: "Obras", tela: "obras" },
        { texto: "Equipamentos", tela: "equipamentos" },
        { texto: "Usuarios Operacionais", tela: "frentistas" },
        { texto: "Funcionarios", tela: "funcionarios" },
        { texto: "Empresas Requisitantes", tela: "empresas" },
        { texto: "Cadastro da Empresa", tela: "configEmpresa" }
      ]
    },
    {
      titulo: "Administrativo (Financeiro/Auditoria)",
      itens: [
        { texto: "Configuracoes Financeiras", tela: "financeiro" },
        { texto: "Historico", tela: "historico" }
      ]
    }
  ];

  const acessoAdmin = podeAcessarTela("relatorio")
    || podeAcessarTela("equipamentos")
    || podeAcessarTela("frentistas")
    || podeAcessarTela("almoxarifado")
    || podeAcessarTela("financeiro");
  const acessoOperacional = podeAcessarTela("lancamento")
    || podeAcessarTela("diarioObra")
    || podeAcessarTela("abastecimento")
    || podeAcessarTela("producaoCampo")
    || podeAcessarTela("manutencao")
    || podeAcessarTela("materiaisSaidas")
    || podeAcessarTela("receberTransferencia");

  const modoAtivo = isMobileDevice
    ? "operacional"
    : (!acessoOperacional && acessoAdmin
        ? "administrativo"
        : (modoPainel === "administrativo" && !acessoAdmin ? "operacional" : modoPainel));
  const secoesOriginais = modoAtivo === "operacional" ? secoesOperacionais : secoesAdministrativas;
  const secoes = secoesOriginais
    .map((secao) => ({
      ...secao,
      itens: secao.itens.filter((item) => podeAcessarTela(item.tela))
    }))
    .filter((secao) => secao.itens.length > 0);

  return (
    <div style={page}>
      <aside style={sidebar}>
        <div style={{ ...brand, cursor: "pointer" }} onClick={() => setTela("home")} role="button" tabIndex={0}>
          <img src={logoSistema} alt="Logo" style={{ width: 106, height: 106, objectFit: "contain" }} />
        </div>
        {!isMobileDevice && (
          <button
            style={navButtonStyle("home", true)}
            onMouseEnter={() => setNavHover("home")}
            onMouseLeave={() => setNavHover("")}
            onClick={() => setTela("home")}
            type="button"
          >
            Painel
          </button>
        )}
        {podeAcessarTela("lancamento") && (
          <button
            style={navButtonStyle("lancamento", false)}
            onMouseEnter={() => setNavHover("lancamento")}
            onMouseLeave={() => setNavHover("")}
            onClick={() => setTela("lancamento")}
            type="button"
          >
            Diario
          </button>
        )}
        {podeAcessarTela("diarioObra") && (
          <button
            style={navButtonStyle("diarioObra", false)}
            onMouseEnter={() => setNavHover("diarioObra")}
            onMouseLeave={() => setNavHover("")}
            onClick={() => setTela("diarioObra")}
            type="button"
          >
            RDO
          </button>
        )}
        {podeAcessarTela("abastecimento") && (
          <button
            style={navButtonStyle("abastecimento", false)}
            onMouseEnter={() => setNavHover("abastecimento")}
            onMouseLeave={() => setNavHover("")}
            onClick={() => setTela("abastecimento")}
            type="button"
          >
            Diesel
          </button>
        )}
        {podeAcessarTela("producaoCampo") && isMobileDevice && (
          <button
            style={navButtonStyle("producaoCampo", false)}
            onMouseEnter={() => setNavHover("producaoCampo")}
            onMouseLeave={() => setNavHover("")}
            onClick={() => setTela("producaoCampo")}
            type="button"
          >
            Croqui
          </button>
        )}
        {podeAcessarTela("manutencao") && (
          <button
            style={navButtonStyle("manutencao", false)}
            onMouseEnter={() => setNavHover("manutencao")}
            onMouseLeave={() => setNavHover("")}
            onClick={() => setTela("manutencao")}
            type="button"
          >
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <span>Manutencao</span>
              {alertasAbertosCount > 0 && <span style={badge}>{alertasAbertosCount}</span>}
            </span>
          </button>
        )}
        {podeAcessarTela("materiaisSaidas") && (
          <button
            style={navButtonStyle("materiaisSaidas", false)}
            onMouseEnter={() => setNavHover("materiaisSaidas")}
            onMouseLeave={() => setNavHover("")}
            onClick={() => setTela("materiaisSaidas")}
            type="button"
          >
            Materiais
          </button>
        )}
        {podeAcessarTela("transferencias") && (
          <button
            style={navButtonStyle("transferencias", false)}
            onMouseEnter={() => setNavHover("transferencias")}
            onMouseLeave={() => setNavHover("")}
            onClick={() => setTela("transferencias")}
            type="button"
          >
            Transf
          </button>
        )}
      </aside>

      <main style={main}>
        <header style={topbar}>
          <div style={titleBox}>
            <div>
              <h1 style={titulo}>Equipamento Gestao</h1>
              <p style={subtitulo}>
                {modoAtivo === "operacional"
                  ? "Controle operacional de obras e equipamentos"
                  : "Relatorios, cadastros e controles administrativos"}
              </p>
            </div>
          </div>
          {alertasAbertosCount > 0 && (
            <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setTela("manutencao")}
                onKeyDown={(e) => (e.key === "Enter" ? setTela("manutencao") : null)}
                style={alertaPill}
                title="Abrir Manutencao para ver os alertas"
              >
                <span>ALERTA MECANICA</span>
                <span style={badge}>{alertasAbertosCount}</span>
              </div>
            </div>
          )}
          {testeBloqueado && (
            <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  borderRadius: 999,
                  background: "#fff2f2",
                  border: "1px solid #ffc9c9",
                  color: "#8a1f1f",
                  fontWeight: 900,
                  boxShadow: "0 2px 10px rgba(16,36,62,0.08)",
                  cursor: "pointer",
                  maxWidth: 620
                }}
                role="button"
                tabIndex={0}
                onClick={() => setTela("financeiro")}
                onKeyDown={(e) => (e.key === "Enter" ? setTela("financeiro") : null)}
                title={`Clique para escolher um plano${clienteSistema?.razaoSocial ? ` (${String(clienteSistema.razaoSocial).trim()})` : ""}`}
              >
                <span>TESTE EXPIRADO</span>
                <span style={{ fontWeight: 700, color: "#6b1a1a", whiteSpace: "nowrap" }}>
                  {testeExpiraEmMs ? `Expirou em ${new Date(testeExpiraEmMs).toLocaleDateString("pt-BR")}` : ""}
                </span>
                <span style={{ fontWeight: 900, textDecoration: "underline" }}>Escolher plano</span>
              </div>
            </div>
          )}
          {!testeBloqueado && inadimplente && (
            <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  borderRadius: 999,
                  background: "#fff7e6",
                  border: "1px solid #ffe1a3",
                  color: "#7a4a00",
                  fontWeight: 900,
                  boxShadow: "0 2px 10px rgba(16,36,62,0.08)",
                  cursor: "pointer",
                  maxWidth: 720
                }}
                role="button"
                tabIndex={0}
                onClick={() => setTela("financeiro")}
                onKeyDown={(e) => (e.key === "Enter" ? setTela("financeiro") : null)}
                title="Acesso parcial: regularize o pagamento para liberar operacoes."
              >
                <span>INADIMPLENTE</span>
                <span style={{ fontWeight: 800, color: "#5d3600" }}>
                  Bloqueio parcial (operacoes/cadastros){inadimplenciaRef ? ` | Mes devido: ${inadimplenciaRef}` : ""}
                </span>
                <span style={{ fontWeight: 900, textDecoration: "underline" }}>Ver pagamentos</span>
              </div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: isMobileDevice ? "column" : "row", alignItems: isMobileDevice ? "flex-start" : "center", gap: 8 }}>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setMenuContaAberto((v) => !v)}
                style={contaButton}
              >
                <span style={avatar}>{iniciaisUsuario}</span>
                <span style={{ fontWeight: 700, color: "#173454" }}>{nomeUsuarioCurto}</span>
              </button>
              {menuContaAberto && (
                <div style={menuConta}>
                  <button
                    type="button"
                    style={menuContaItem}
                    onClick={() => {
                      setMenuContaAberto(false);
                      setTela("minhaConta");
                    }}
                  >
                    Minha Conta
                  </button>
                  <button
                    type="button"
                    onClick={onSair}
                    style={{ ...menuContaItem, color: "#b02a37", borderTop: "1px solid #eef2f7" }}
                  >
                    Sair
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {!isMobileDevice && (
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => alterarModoPainel("operacional")}
              disabled={!acessoOperacional}
              style={{
                ...actionButton,
                width: "auto",
                padding: "9px 14px",
                background: modoAtivo === "operacional" ? "#0b5ed7" : "#6c757d",
                textAlign: "center",
                opacity: acessoOperacional ? 1 : 0.5,
                cursor: acessoOperacional ? "pointer" : "not-allowed"
              }}
            >
              Painel Operacional
            </button>
            <button
              type="button"
              onClick={() => alterarModoPainel("administrativo")}
              disabled={!acessoAdmin}
              style={{
                ...actionButton,
                width: "auto",
                padding: "9px 14px",
                background: modoAtivo === "administrativo" ? "#0b5ed7" : "#6c757d",
                textAlign: "center",
                opacity: acessoAdmin ? 1 : 0.5,
                cursor: acessoAdmin ? "pointer" : "not-allowed"
              }}
            >
              Painel Administrativo
            </button>
          </div>
        )}

        <div style={sections}>
          {secoes.map((secao) => (
            <section key={secao.titulo} style={section}>
              <h2 style={sectionTitle}>{secao.titulo}</h2>
              <div style={buttonList}>
                {secao.itens.map((item) => (
                  <button
                    key={item.tela}
                    style={tileButtonStyle(item.tela)}
                    onClick={() => setTela(item.tela)}
                    type="button"
                  >
                    <div style={tileInner}>
                      {(() => {
                        const meta = metaTela(item.tela);
                        return (
                          <div style={tileIconWrap(meta.accent)}>
                            {iconSvg(meta.icon, meta.accent)}
                          </div>
                        );
                      })()}
                      <div>
                        <div style={tileTitle}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span>{item.texto}</span>
                            {item.tela === "manutencao" && alertasAbertosCount > 0 && (
                              <span style={badge}>{alertasAbertosCount}</span>
                            )}
                          </span>
                        </div>
                        {!!resumoTela(item.tela) && <div style={tileDesc}>{resumoTela(item.tela)}</div>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

export default Home;
