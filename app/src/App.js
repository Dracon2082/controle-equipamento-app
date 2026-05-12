import { useEffect, useMemo, useState } from "react";
import Frentistas from "./pages/Frentista";
import Login from "./pages/Login";
import RelatorioAbastecimento from "./pages/RelatorioAbastecimento";
import ConfigEmpresa from "./pages/ConfigEmpresa";
import Manutencao from "./pages/Manutencao";
import ProducaoCampo from "./pages/ProducaoCampo";
import Home from "./pages/Home";
import Equipamentos from "./pages/Equipamentos";
import Lancamento from "./pages/Lancamento";
import DiarioObra from "./pages/DiarioObra";
import Funcionarios from "./pages/Funcionarios";
import Relatorio from "./pages/Relatorio";
import RelatorioDiarioObra from "./pages/RelatorioDiarioObra";
import Obras from "./pages/Obras";
import Historico from "./pages/Historico";
import Abastecimento from "./pages/Abastecimento";
import Empresas from "./pages/Empresas";
import FinanceiroCliente from "./pages/FinanceiroCliente";
import BoletimMedicao from "./pages/BoletimMedicao";
import MemorandoInterno from "./pages/MemorandoInterno";
import MasterClientes from "./pages/MasterClientes";
import MasterLogin from "./pages/MasterLogin";
import EPI from "./pages/EPI";
import SaidasMateriais from "./pages/SaidasMateriais";
import MinhaConta from "./pages/MinhaConta";
import Transferencias from "./pages/Transferencias";
import RelatorioTransferencias from "./pages/RelatorioTransferencias";
import ReceberTransferencia from "./pages/ReceberTransferencia";
import Transportes from "./pages/Transportes";
import ReceberTransporte from "./pages/ReceberTransporte";
import RelatorioTransportes from "./pages/RelatorioTransportes";
import EntradaMateriais from "./pages/EntradaMateriais";
import Bases from "./pages/Bases";
import { isMasterAutenticado } from "./utils/masterAuth";
import logoSistema from "./assets/logo-sistema.png";
import { rememberPublicOriginIfAny } from "./utils/publicUrl";

function ClientApp() {
  const STORAGE_ULTIMA_TELA = "ultimaTelaClientApp";
  const PERFIL_GESTOR_GERAL = "GESTOR_GERAL";
  const PERFIL_ADMIN_UNIDADE = "ADMIN_UNIDADE";
  const PERMISSAO_TRANSPORTE_LEGADA = "transportes";
  const PERMISSAO_INFORMAR_MEIO_TRANSPORTE = "informarMeioTransporte";
  const PERMISSAO_RECEBER_TRANSPORTE = "receberTransporte";
  const PERMISSAO_ADMIN_RELATORIOS = "admin_relatorios";
  const PERMISSAO_ADMIN_CADASTROS = "admin_cadastros";
  const PERMISSAO_ADMIN_CONTROLE = "admin_controle";
  const PERMISSAO_ADMIN_FINANCEIRO = "admin_financeiro";

  const inferirPerfilAcesso = (sessao) => {
    const perfilDireto = String(sessao?.perfilAcesso || "").trim().toUpperCase();
    if (perfilDireto) return perfilDireto;

    const perfilLegado = String(sessao?.perfil || "").trim().toUpperCase();
    const permissoes = Array.isArray(sessao?.permissoes)
      ? sessao.permissoes.map((p) => String(p || "").trim())
      : [];

    if (perfilLegado.includes("GESTOR")) return PERFIL_GESTOR_GERAL;
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

  const possuiSessaoAtiva = () => {
    try {
      const sessao = JSON.parse(localStorage.getItem("sessaoOperacional") || "null");
      return Boolean(sessao && (sessao.nome || sessao.email || sessao.cpf));
    } catch {
      return false;
    }
  };

  const [tela, setTela] = useState(() => (possuiSessaoAtiva() ? "home" : "login"));
  const [authContext, setAuthContext] = useState({ destino: "" });
  const isMobileDevice = useMemo(() => {
    const ua = String(window.navigator?.userAgent || "").toLowerCase();
    const mobileUA = /android|iphone|ipad|ipod|mobile|opera mini|iemobile/.test(ua);
    return mobileUA || window.innerWidth <= 900;
  }, []);
  const maxWidthPorTela = {
    configEmpresa: 600,
    obras: 900,
    lubrificantes: 900,
    empresas: 950,
    equipamentos: 950,
    funcionarios: 950,
    frentistas: 980,
    historico: 1240,
    relatorio: 1240,
    relatorioAbastecimento: 1200,
    relatorioTransferencias: 1240,
    relatorioDiarioObra: 1240,
    financeiro: 1060,
    abastecimento: 1040,
    lancamento: 1080,
    diarioObra: 1160,
    producaoCampo: 1260,
    manutencao: 1240,
    almoxarifado: 1240,
    epi: 1080,
    transferencias: 1120,
    receberTransferencia: 980,
    transportes: 1120,
    receberTransporte: 980,
    relatorioTransportes: 1240,
    bases: 900
  };
  const maxWidthTopo = Number(maxWidthPorTela[tela] || 1240);

  const appContainer = {
    padding: isMobileDevice ? 0 : 20,
    fontFamily: "Arial"
  };
  const topBar = {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    alignItems: "center",
    width: "100%",
    maxWidth: maxWidthTopo,
    boxSizing: "border-box",
    padding: isMobileDevice ? "0 8px" : 0,
    margin: "0 auto 8px"
  };
  const topBackButton = {
    border: "none",
    borderRadius: 8,
    padding: "10px 14px",
    background: "#6c757d",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer"
  };
  const topBarBrand = {
    display: "flex",
    alignItems: "center",
    gap: 1,
    justifySelf: "center"
  };
  const topBarBrandText = {
    margin: 0,
    color: "#173454",
    fontSize: isMobileDevice ? 16 : 18,
    fontWeight: 700
  };
  const topBarBrandSubText = {
    margin: 0,
    color: "#173454",
    fontSize: isMobileDevice ? 14 : 18,
    fontWeight: 700,
    lineHeight: 1.05
  };

  const telasOperacaoProtegidas = new Set([
    "abastecimento",
    "lancamento",
    "diarioObra",
    "producaoCampo",
    "manutencao",
    "materiaisSaidas",
    "receberTransferencia",
    "transportes",
    "receberTransporte"
  ]);

  const telasAdministrativas = new Set([
    "configEmpresa",
    "equipamentos",
    "funcionarios",
    "frentistas",
    "relatorio",
    "relatorioAbastecimento",
    "relatorioTransferencias",
    "relatorioTransportes",
    "relatorioManutencao",
    "relatorioDiarioObra",
    "obras",
    "historico",
    "empresas",
    "financeiro",
    "boletimMedicao",
    "memorandoInterno",
    "lubrificantes",
    "almoxarifado",
    "transferencias",
    "bases"
  ]);

  const telasAdminRelatorios = new Set([
    "relatorio",
    "relatorioAbastecimento",
    "relatorioTransferencias",
    "relatorioTransportes",
    "relatorioManutencao",
    "historico"
  ]);
  const telasAdminCadastros = new Set([
    "configEmpresa",
    "equipamentos",
    "funcionarios",
    "frentistas",
    "obras",
    "bases",
    "empresas"
  ]);
  const telasExclusivasUsuarioChave = new Set([
    "configEmpresa",
    // Cadastro de bases (UF/Cidades) e sensivel: so gestor-chave deve definir as bases do cliente.
    "bases"
  ]);
  const telasAdminControle = new Set([
    "lubrificantes",
    "almoxarifado",
    "transferencias",
    "transportes"
  ]);
  const telasAdminFinanceiro = new Set([
    "financeiro",
    "boletimMedicao",
    "memorandoInterno"
  ]);

  const obterSessao = () => {
    try {
      return JSON.parse(localStorage.getItem("sessaoOperacional") || "null");
    } catch {
      return null;
    }
  };

  // Deep link do QR do Boletim:
  // - QR aponta para uma URL (lida por qualquer camera/Google Lens).
  // - Ao abrir no celular, direcionamos para a tela "ReceberTransferencia" automaticamente.
  // Obs: evitamos hash (#...) porque iPhone/Safari (camera) pode falhar com fragment.
  useEffect(() => {
    // Guarda o ultimo dominio publico (trycloudflare) para usar nos QRs gerados no localhost.
    rememberPublicOriginIfAny();
    try {
      const url = new URL(window.location.href);
      const hash = String(url.hash || "").replace("#", "").trim().toLowerCase();
      const screen = String(url.searchParams.get("screen") || "").trim().toLowerCase();

      // Preferido (QR curto): /qr/<tenant>/<boletimId>
      const pathParts = String(url.pathname || "")
        .split("/")
        .map((p) => p.trim())
        .filter(Boolean);
      const isQrPath = pathParts.length >= 3 && String(pathParts[0]).toLowerCase() === "qr";

      const destinoHash = hash === "recebertransferencia" ? "receberTransferencia" : "";
      const destinoScreen = screen === "recebertransferencia" ? "receberTransferencia" : "";

      // Aceita links como:
      // - https://<dominio>/qr/<tenant>/<boletimId> (novo, curto)
      // - https://<dominio>/?t=<tenant>&id=<boletimId>&screen=receberTransferencia (antigo)
      // - https://<dominio>/?t=<tenant>&id=<boletimId>#receberTransferencia (antigo)
      const temQrParams =
        (Boolean(url.searchParams.get("id")) && Boolean(url.searchParams.get("t") || url.searchParams.get("tenant"))) ||
        (isQrPath && Boolean(pathParts?.[1]) && Boolean(pathParts?.[2]));

      if ((destinoHash || destinoScreen || isQrPath) && temQrParams) {
        // Navega para a tela (se o usuario nao estiver logado, a tela pedira login antes).
        setTela((prev) => (prev === "receberTransferencia" ? prev : "receberTransferencia"));
      }
    } catch {
      // noop
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const podeAcessarTelaAdministrativa = (destino, sessao) => {
    if (!telasAdministrativas.has(destino)) return true;
    const usuarioChave = Boolean(sessao?.usuarioChave);
    if (telasExclusivasUsuarioChave.has(destino) && !usuarioChave) return false;
    const perfil = inferirPerfilAcesso(sessao);
    const permissoes = Array.isArray(sessao?.permissoes)
      ? sessao.permissoes.map((p) => String(p || "").trim())
      : [];

    if (perfil === PERFIL_GESTOR_GERAL) return true;

    const permissaoAdminMap = [];
    if (telasAdminRelatorios.has(destino)) permissaoAdminMap.push(PERMISSAO_ADMIN_RELATORIOS);
    if (telasAdminCadastros.has(destino)) permissaoAdminMap.push(PERMISSAO_ADMIN_CADASTROS);
    if (telasAdminControle.has(destino)) permissaoAdminMap.push(PERMISSAO_ADMIN_CONTROLE);
    if (telasAdminFinanceiro.has(destino)) permissaoAdminMap.push(PERMISSAO_ADMIN_FINANCEIRO);

    if (perfil === PERFIL_ADMIN_UNIDADE) return true;
    if (!permissaoAdminMap.length) return false;
    return permissaoAdminMap.every((perm) => permissoes.includes(perm));
  };

  const temAcesso = (destino) => {
    const sessao = obterSessao();
    const permitidas = Array.isArray(sessao?.permissoes)
      ? sessao.permissoes.map((p) => String(p || "").trim())
      : [];

    if (telasAdministrativas.has(destino)) {
      return podeAcessarTelaAdministrativa(destino, sessao);
    }

    if (!telasOperacaoProtegidas.has(destino)) return true;

    const perfil = inferirPerfilAcesso(sessao);
    if (perfil === PERFIL_GESTOR_GERAL || perfil === PERFIL_ADMIN_UNIDADE) return true;
    if (destino === "materiaisSaidas") {
      return permitidas.includes("materiaisSaidas") || permitidas.includes("almoxarifado") || permitidas.includes("epi");
    }
    // ReceberTransferencia e uma permissao operacional propria (QR + assinatura).
    if (destino === "receberTransferencia") {
      return permitidas.includes("receberTransferencia") || permitidas.includes("transferencias");
    }
    if (destino === "receberTransporte") {
      return (
        permitidas.includes(PERMISSAO_RECEBER_TRANSPORTE) ||
        permitidas.includes(PERMISSAO_TRANSPORTE_LEGADA) ||
        permitidas.includes("transferencias")
      );
    }
    if (destino === "transportes") {
      return (
        permitidas.includes(PERMISSAO_INFORMAR_MEIO_TRANSPORTE) ||
        permitidas.includes(PERMISSAO_TRANSPORTE_LEGADA) ||
        permitidas.includes("transferencias")
      );
    }
    return permitidas.includes(destino);
  };

  const navegar = (destino) => {
    if (destino !== "login" && !possuiSessaoAtiva()) {
      setAuthContext({ destino });
      setTela("login");
      return;
    }

    if (isMobileDevice && telasAdministrativas.has(destino)) {
      alert("No celular o acesso e somente ao painel operacional.");
      setTela("home");
      return;
    }

    if (!temAcesso(destino)) {
      setAuthContext({ destino });
      setTela("login");
      return;
    }
    setTela(destino);
  };

  const loginSucesso = (destino) => {
    setTela(destino || authContext.destino || "home");
  };

  const sairPainel = () => {
    localStorage.removeItem("sessaoOperacional");
    localStorage.removeItem("usuarioLogado");
    localStorage.removeItem(STORAGE_ULTIMA_TELA);
    setAuthContext({ destino: "" });
    setTela("login");
  };

  useEffect(() => {
    if (!possuiSessaoAtiva()) return;
    try {
      const ultimaTela = String(localStorage.getItem(STORAGE_ULTIMA_TELA) || "").trim();
      if (!ultimaTela || ultimaTela === "home" || ultimaTela === "login") return;
      if (isMobileDevice && telasAdministrativas.has(ultimaTela)) return;
      if (!temAcesso(ultimaTela)) return;
      setTela((atual) => (atual === "home" ? ultimaTela : atual));
    } catch {
      // noop
    }
  }, [isMobileDevice]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!tela || tela === "login") return;
    try {
      localStorage.setItem(STORAGE_ULTIMA_TELA, tela);
    } catch {
      // noop
    }
  }, [tela]);

  const nomeUsuarioLogado = (() => {
    const sessao = obterSessao();
    const nome = String(sessao?.nome || localStorage.getItem("usuarioLogado") || "").trim();
    return nome || "USUARIO";
  })();
  const iniciaisUsuario = (() => {
    const partes = nomeUsuarioLogado.split(" ").filter(Boolean);
    if (!partes.length) return "EG";
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return `${partes[0].slice(0, 1)}${partes[partes.length - 1].slice(0, 1)}`.toUpperCase();
  })();

  const userChip = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    background: "#ffffff",
    border: "1px solid #d7e4ff",
    borderRadius: 999,
    padding: isMobileDevice ? "4px 6px" : "6px 10px",
    boxShadow: "0 1px 3px rgba(16,36,62,0.10)",
    color: "#173454",
    fontWeight: 800,
    justifySelf: "end"
  };
  const userAvatar = {
    width: isMobileDevice ? 32 : 34,
    height: isMobileDevice ? 32 : 34,
    borderRadius: "50%",
    background: "#0b5ed7",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    fontSize: 13,
    fontWeight: 900,
    border: "3px solid #eaf2ff",
    flex: "0 0 auto"
  };

  const mostrarVoltarTopo = tela !== "home" && tela !== "login";

  return (
    <div style={appContainer}>
      {mostrarVoltarTopo && (
        <div style={topBar}>
          <button style={topBackButton} onClick={() => navegar("home")}>Voltar</button>
          <div style={topBarBrand}>
            <img
              src={logoSistema}
              alt="Logo do sistema"
              style={{ width: isMobileDevice ? 74 : 98, height: isMobileDevice ? 74 : 98, objectFit: "contain" }}
            />
            {!isMobileDevice && (
              <div style={{ display: "grid", gap: 0, marginLeft: -4 }}>
                <p style={{ ...topBarBrandText, fontSize: 20, lineHeight: 1.05 }}>Equipamentos</p>
                <p style={topBarBrandSubText}>Gestão</p>
              </div>
            )}
          </div>
          <div style={userChip} title={nomeUsuarioLogado}>
            <span style={userAvatar}>{iniciaisUsuario}</span>
            {!isMobileDevice && <span>{nomeUsuarioLogado}</span>}
          </div>
        </div>
      )}
      {tela === "home" && <Home setTela={navegar} onSair={sairPainel} />}
      {tela === "configEmpresa" && <ConfigEmpresa setTela={navegar} />}
      {tela === "equipamentos" && <Equipamentos setTela={navegar} />}
      {tela === "lancamento" && <Lancamento setTela={navegar} />}
      {tela === "diarioObra" && <DiarioObra setTela={navegar} />}
      {tela === "funcionarios" && <Funcionarios setTela={navegar} />}
      {tela === "frentistas" && <Frentistas setTela={navegar} />}
      {tela === "relatorio" && <Relatorio setTela={navegar} />}
      {tela === "relatorioAbastecimento" && <RelatorioAbastecimento setTela={navegar} />}
      {tela === "relatorioTransferencias" && <RelatorioTransferencias setTela={navegar} />}
      {tela === "relatorioTransportes" && <RelatorioTransportes setTela={navegar} />}
      {tela === "relatorioManutencao" && <Manutencao setTela={navegar} modoRelatorio />}
      {tela === "relatorioDiarioObra" && <RelatorioDiarioObra setTela={navegar} />}
      {tela === "obras" && <Obras setTela={navegar} />}
      {tela === "bases" && <Bases setTela={navegar} />}
      {tela === "historico" && <Historico setTela={navegar} />}
      {tela === "abastecimento" && <Abastecimento setTela={navegar} />}
  {tela === "producaoCampo" && <ProducaoCampo setTela={navegar} modo="operacional" />}
  {tela === "relatorioProducaoCampo" && <ProducaoCampo setTela={navegar} modo="relatorio" />}
      {tela === "manutencao" && <Manutencao setTela={navegar} />}
      {tela === "empresas" && <Empresas setTela={navegar} />}
      {tela === "financeiro" && <FinanceiroCliente setTela={navegar} />}
      {tela === "boletimMedicao" && <BoletimMedicao setTela={navegar} />}
      {tela === "memorandoInterno" && <MemorandoInterno setTela={navegar} />}
      {tela === "almoxarifado" && <EntradaMateriais setTela={navegar} abaInicial="MATERIAIS" />}
      {tela === "epi" && <EPI setTela={navegar} />}
      {tela === "materiaisSaidas" && <SaidasMateriais setTela={navegar} />}
  {tela === "transferencias" && <Transferencias setTela={navegar} />}
  {tela === "receberTransferencia" && <ReceberTransferencia setTela={navegar} />}
  {tela === "transportes" && <Transportes setTela={navegar} />}
  {tela === "receberTransporte" && <ReceberTransporte setTela={navegar} />}
  {tela === "lubrificantes" && <EntradaMateriais setTela={navegar} abaInicial="DIESEL" />}
      {tela === "login" && <Login setTela={navegar} authContext={authContext} onLoginSucesso={loginSucesso} />}
      {tela === "minhaConta" && <MinhaConta setTela={navegar} />}
    </div>
  );
}

function AdminApp() {
  const [tela, setTela] = useState(isMasterAutenticado() ? "masterClientes" : "masterLogin");
  const topBar = {
    display: "flex",
    justifyContent: "flex-start",
    width: "100%",
    maxWidth: 1240,
    boxSizing: "border-box",
    padding: 0,
    margin: "0 auto 8px"
  };
  const topBackButton = {
    border: "none",
    borderRadius: 8,
    padding: "10px 14px",
    background: "#6c757d",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer"
  };

  return (
    <div style={{ padding: 20, fontFamily: "Arial" }}>
      {tela === "masterClientes" && (
        <div style={topBar}>
          <button style={topBackButton} onClick={() => setTela("masterLogin")}>Voltar</button>
        </div>
      )}
      {tela === "masterLogin" && <MasterLogin setTela={setTela} />}
      {tela === "masterClientes" && <MasterClientes setTela={setTela} />}
    </div>
  );
}

function App() {
  const isAdminPath = useMemo(() => {
    const path = String(window.location.pathname || "").toLowerCase();
    return path.startsWith("/admin");
  }, []);

  return isAdminPath ? <AdminApp /> : <ClientApp />;
}

export default App;


