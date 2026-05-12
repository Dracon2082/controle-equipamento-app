import { useState } from "react";
import { db } from "../firebase";
import { collection, doc, getDocs, updateDoc } from "firebase/firestore";
import { getTenantId, setTenantId } from "../utils/tenant";
import { solicitarResetSenhaPorEmail, validarSenhaViaAuth } from "../utils/authUsers";
import { getContatoComercialConfig } from "../utils/contactConfig";
import logoSistema from "../assets/logo-sistema.png";

function Login({ setTela, authContext, onLoginSucesso }) {
  const PERFIL_GESTOR_GERAL = "GESTOR_GERAL";
  const PERFIL_ADMIN_UNIDADE = "ADMIN_UNIDADE";
  const PERMISSAO_TRANSPORTE_LEGADA = "transportes";
  const PERMISSAO_INFORMAR_MEIO_TRANSPORTE = "informarMeioTransporte";
  const PERMISSAO_RECEBER_TRANSPORTE = "receberTransporte";
  const PERMISSAO_ADMIN_RELATORIOS = "admin_relatorios";
  const PERMISSAO_ADMIN_CADASTROS = "admin_cadastros";
  const PERMISSAO_ADMIN_CONTROLE = "admin_controle";
  const PERMISSAO_ADMIN_FINANCEIRO = "admin_financeiro";
  const isMobile = window.innerWidth <= 700;
  const [identificador, setIdentificador] = useState("");
  const [senha, setSenha] = useState("");
  const [modoTroca, setModoTroca] = useState(() => {
    try {
      const forcar = localStorage.getItem("forcarModoTrocaSenha") === "1";
      if (forcar) localStorage.removeItem("forcarModoTrocaSenha");
      return forcar;
    } catch {
      return false;
    }
  });
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");

  const destino = authContext?.destino || "";
  const tenantId = getTenantId();
  const contatoConfig = getContatoComercialConfig();
  const SALES_WHATSAPP_URL = contatoConfig.vendasWhatsappUrl;
  const SUPPORT_WHATSAPP_URL = contatoConfig.suporteWhatsappUrl;

  const telasAdminRelatorios = new Set(["relatorio", "relatorioAbastecimento", "relatorioTransferencias", "relatorioManutencao", "historico"]);
  const telasAdminCadastros = new Set(["configEmpresa", "equipamentos", "funcionarios", "frentistas", "obras", "empresas"]);
  const telasAdminControle = new Set(["lubrificantes", "transferencias", "almoxarifado"]);
  const telasAdminFinanceiro = new Set(["financeiro", "memorandoInterno"]);
  const telasExclusivasUsuarioChave = new Set(["configEmpresa"]);

  const permissoesLegacyPorFuncao = (funcaoTexto) => {
    const funcao = String(funcaoTexto || "")
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (funcao.includes("FRENT")) return ["abastecimento"];
    if (funcao.includes("APONTADOR")) return ["producaoCampo", "lancamento"];
    if (funcao.includes("MECAN")) return ["manutencao"];
    if (funcao.includes("ALMOX")) return ["almoxarifado"];
    if (funcao.includes("EPI") || funcao.includes("SEGURAN")) return ["epi"];
    return ["lancamento"];
  };

  const validarSenhaUsuario = async (senhaDigitada, cpfLimpo, dadosUsuario) => {
    const senhaPadrao = cpfLimpo.substring(0, 6);
    const senhaCadastrada = String(dadosUsuario?.senha || dadosUsuario?.senhaInicial || "").trim();
    if (senhaCadastrada && senhaDigitada === senhaCadastrada) return true;
    const emailUsuario = String(dadosUsuario?.email || "").trim().toLowerCase();
    if (await validarSenhaViaAuth(emailUsuario, senhaDigitada)) return true;
    if (!cpfLimpo) return false;
    return senhaDigitada === senhaPadrao;
  };

  const inferirPerfilAcesso = (dadosUsuario, permissoesUsuario) => {
    const perfilDireto = String(dadosUsuario?.perfilAcesso || "").trim().toUpperCase();
    if (perfilDireto) return perfilDireto;

    const funcao = String(dadosUsuario?.funcao || "").toUpperCase();
    const permissoes = Array.isArray(permissoesUsuario) ? permissoesUsuario : [];

    if (funcao.includes("GESTOR")) return PERFIL_GESTOR_GERAL;
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

  const inferirUsuarioChave = (dadosUsuario) => {
    if (dadosUsuario?.usuarioChave === true) return true;
    const funcao = String(dadosUsuario?.funcao || "").toUpperCase();
    return funcao.includes("GESTOR");
  };

  const podeAcessarDestino = (destinoTela, perfilAcesso, permissoes, usuarioChave = false) => {
    if (!destinoTela) return true;

    const perfil = String(perfilAcesso || "").trim().toUpperCase();
    const lista = Array.isArray(permissoes) ? permissoes.map((p) => String(p || "").trim()) : [];

    if (telasExclusivasUsuarioChave.has(destinoTela) && !usuarioChave) return false;
    if (perfil === PERFIL_GESTOR_GERAL) return true;
    if (perfil === PERFIL_ADMIN_UNIDADE) return true;

    if (telasAdminRelatorios.has(destinoTela)) return lista.includes(PERMISSAO_ADMIN_RELATORIOS);
    if (telasAdminCadastros.has(destinoTela)) return lista.includes(PERMISSAO_ADMIN_CADASTROS);
    if (telasAdminControle.has(destinoTela)) return lista.includes(PERMISSAO_ADMIN_CONTROLE);
    if (telasAdminFinanceiro.has(destinoTela)) return lista.includes(PERMISSAO_ADMIN_FINANCEIRO);

    // Tela de recebimento (QR) usa permissao propria (ou legado "transferencias").
    if (destinoTela === "receberTransferencia") {
      return lista.includes("receberTransferencia") || lista.includes("transferencias");
    }
    if (destinoTela === "receberTransporte") {
      return (
        lista.includes(PERMISSAO_RECEBER_TRANSPORTE) ||
        lista.includes(PERMISSAO_TRANSPORTE_LEGADA) ||
        lista.includes("transferencias")
      );
    }
    if (destinoTela === "transportes") {
      return (
        lista.includes(PERMISSAO_INFORMAR_MEIO_TRANSPORTE) ||
        lista.includes(PERMISSAO_TRANSPORTE_LEGADA) ||
        lista.includes("transferencias")
      );
    }

    return lista.includes(destinoTela);
  };

  const localizarUsuarios = async (loginValor) => {
    const cpfLimpo = String(loginValor || "").replace(/\D/g, "");
    const email = String(loginValor || "").trim().toLowerCase();
    const buscaPorEmail = email.includes("@");

    const snapFrent = await getDocs(collection(db, "frentistas"));
    const candidatos = snapFrent.docs.filter((d) => {
      const dados = d.data();
      if (buscaPorEmail) return String(dados.email || "").trim().toLowerCase() === email;
      return String(dados.cpf || "").replace(/\D/g, "") === cpfLimpo;
    });

    if (!candidatos.length) return [];

    const normalTenant = (v) => String(v || "").trim().toLowerCase();
    const tenantAtualNorm = normalTenant(tenantId);

    const lista = candidatos.map((docItem) => {
      const dados = docItem.data();
      const permissoes = Array.isArray(dados?.permissoes) && dados.permissoes.length
        ? dados.permissoes
        : permissoesLegacyPorFuncao(dados?.funcao);
      const perfilAcesso = inferirPerfilAcesso(dados, permissoes);
      return {
        collectionName: "frentistas",
        docId: docItem.id,
        dados,
        permissoes,
        perfilAcesso,
        tenantNorm: normalTenant(dados?.tenantId)
      };
    });

    // Prioriza candidato do tenant atual, depois os demais.
    lista.sort((a, b) => {
      const aScore = a.tenantNorm && a.tenantNorm === tenantAtualNorm ? 0 : 1;
      const bScore = b.tenantNorm && b.tenantNorm === tenantAtualNorm ? 0 : 1;
      return aScore - bScore;
    });

    return lista;
  };

  const entrar = async () => {
    if (!identificador || !senha) {
      alert("Preencha CPF ou e-mail e a senha.");
      return;
    }

    const cpfLimpo = String(identificador).replace(/\D/g, "");
    const usuariosLocalizados = await localizarUsuarios(identificador);
    if (!usuariosLocalizados.length) {
      alert("Usuario nao encontrado para esta operacao.");
      return;
    }

    // Quando entra por e-mail pode existir mais de 1 cadastro com o mesmo e-mail (tenants diferentes).
    // Entao tentamos validar a senha em cada candidato ate achar o correto.
    let escolhido = null;
    for (const candidato of usuariosLocalizados) {
      const u = candidato?.dados || {};
      // Atalho: se a senha cadastrada bater exatamente, seleciona logo.
      const senhaCadastrada = String(u?.senha || u?.senhaInicial || "").trim();
      if (senhaCadastrada && senhaCadastrada === String(senha || "").trim()) {
        escolhido = candidato;
        break;
      }
      // Caso contrario, valida (pode cair no Auth ou senha padrao CPF quando houver).
      // eslint-disable-next-line no-await-in-loop
      const ok = await validarSenhaUsuario(senha, cpfLimpo, u);
      if (ok) {
        escolhido = candidato;
        break;
      }
    }

    if (!escolhido) {
      alert("Senha incorreta.");
      return;
    }

    const { dados: usuario, permissoes, perfilAcesso } = escolhido;
    const usuarioChave = inferirUsuarioChave(usuario);
    const tenantUsuario = setTenantId(usuario?.tenantId || tenantId);
    if (destino && !podeAcessarDestino(destino, perfilAcesso, permissoes, usuarioChave)) {
      alert("Usuario sem permissao para esta operacao.");
      return;
    }

    if (usuario?.trocarSenhaObrigatoria) {
      alert("Primeiro acesso detectado. Troque sua senha para continuar.");
      setModoTroca(true);
      setNovaSenha("");
      setConfirmarSenha("");
      return;
    }

    localStorage.setItem(
      "sessaoOperacional",
      JSON.stringify({
        nome: usuario.nome,
        cpf: cpfLimpo,
        email: usuario.email || "",
        perfil: usuario.funcao || "USUARIO",
        perfilAcesso: perfilAcesso || "",
        usuarioChave,
        permissoes,
        basesPermitidas: Array.isArray(usuario?.basesPermitidas) ? usuario.basesPermitidas : [],
        destino,
        tenantId: tenantUsuario,
        logadoEm: new Date().toISOString()
      })
    );
    localStorage.setItem("usuarioLogado", usuario.nome || "");

    alert("Login realizado com sucesso.");
    onLoginSucesso(destino || "home");
  };

  const trocarSenha = async () => {
    if (!identificador || !senha || !novaSenha || !confirmarSenha) {
      alert("Preencha CPF/e-mail, senha atual, nova senha e confirmacao.");
      return;
    }

    if (novaSenha.length < 4) {
      alert("A nova senha deve ter pelo menos 4 caracteres.");
      return;
    }

    if (novaSenha !== confirmarSenha) {
      alert("Nova senha e confirmacao nao conferem.");
      return;
    }

    const cpfLimpo = String(identificador).replace(/\D/g, "");
    const usuariosLocalizados = await localizarUsuarios(identificador);
    if (!usuariosLocalizados.length) {
      alert("Usuario nao encontrado para esta operacao.");
      return;
    }

    // Mesma estrategia do login: escolhe o cadastro que valida a senha.
    let escolhido = null;
    for (const candidato of usuariosLocalizados) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await validarSenhaUsuario(senha, cpfLimpo, candidato?.dados || {});
      if (ok) {
        escolhido = candidato;
        break;
      }
    }
    if (!escolhido) {
      alert("Senha atual incorreta.");
      return;
    }

    const { collectionName, docId, dados, permissoes, perfilAcesso } = escolhido;
    setTenantId(dados?.tenantId || tenantId);
    if (destino && !podeAcessarDestino(destino, perfilAcesso, permissoes, inferirUsuarioChave(dados))) {
      alert("Usuario sem permissao para esta operacao.");
      return;
    }

    await updateDoc(doc(db, collectionName, docId), {
      senha: novaSenha,
      trocarSenhaObrigatoria: false
    });

    alert("Senha alterada com sucesso.");
    setModoTroca(false);
    setNovaSenha("");
    setConfirmarSenha("");
    setSenha("");
  };

  const esqueciSenha = async () => {
    const valor = String(identificador || "").trim();
    if (!valor) {
      alert("Informe seu CPF ou e-mail no campo de login para recuperar a senha.");
      return;
    }

    let email = "";
    if (valor.includes("@")) {
      email = valor.trim().toLowerCase();
    } else {
      // Operacional costuma logar com CPF; aqui buscamos o e-mail do cadastro para enviar o reset.
      const usuarios = await localizarUsuarios(valor);
      const candidato = usuarios.find((u) => String(u?.dados?.email || "").includes("@")) || usuarios[0] || null;
      email = String(candidato?.dados?.email || "").trim().toLowerCase();
    }

    if (!email || !email.includes("@")) {
      alert("Este usuario nao tem e-mail valido cadastrado. Peca ao administrador para atualizar o cadastro.");
      return;
    }

    const resultado = await solicitarResetSenhaPorEmail(email);
    if (!resultado.ok) {
      alert(resultado.erro || "Nao foi possivel enviar o e-mail de redefinicao.");
      return;
    }
    alert(`Enviamos um e-mail com link/codigo para redefinir sua senha.\n\nDestino: ${email}`);
  };

  const caixaInput = {
    width: "100%",
    height: 44,
    borderRadius: 10,
    border: "1px solid #cfd7e3",
    padding: "0 12px",
    marginBottom: 12,
    boxSizing: "border-box",
    fontSize: 16,
    background: "#f7fbff"
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#eef1f5",
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "minmax(240px, 360px) 1fr"
      }}
    >
      {!isMobile && (
        <aside
          style={{
            background: "linear-gradient(180deg, #0b5ed7 0%, #0d4fae 100%)",
            color: "#fff",
            padding: "20px 16px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            borderRight: "1px solid rgba(255,255,255,0.2)"
          }}
        >
          <div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 20, width: "100%" }}>
              <img
                src={logoSistema}
                alt="Logo"
                style={{
                  width: 148,
                  height: 148,
                  borderRadius: 0,
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  objectFit: "contain"
                }}
              />
              <strong style={{ fontSize: 28, lineHeight: 1.15, marginTop: 4, textAlign: "center" }}>Equipamento Gestão</strong>
            </div>
            <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: 30, lineHeight: 1.2 }}>
              Gerencie toda a sua operação em um só lugar.
            </h2>
            <p style={{ marginTop: 0, color: "rgba(255,255,255,0.9)", fontSize: 15 }}>
              Assinaturas digitais, identificação rápida e localização por coordenadas
              para agilizar a operação.
            </p>
            <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
              {[
                "Pagamentos no app com mais agilidade",
                "Atendimento via WhatsApp com resposta rápida"
              ].map((texto) => (
                <div
                  key={texto}
                  style={{
                    border: "1px solid rgba(255,255,255,0.35)",
                    borderRadius: 999,
                    padding: "8px 10px",
                    background: "rgba(255,255,255,0.12)",
                    fontSize: 13
                  }}
                >
                  {texto}
                </div>
              ))}
            </div>
          </div>
          <div>
            <svg viewBox="0 0 360 150" width="100%" height="90" aria-label="Fluxo do sistema">
              <defs>
                <linearGradient id="linhaFluxo" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#b9d7ff" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0.9" />
                </linearGradient>
              </defs>
              <rect x="8" y="26" width="95" height="34" rx="10" fill="rgba(255,255,255,0.18)" />
              <rect x="132" y="10" width="95" height="34" rx="10" fill="rgba(255,255,255,0.2)" />
              <rect x="252" y="26" width="95" height="34" rx="10" fill="rgba(255,255,255,0.18)" />
              <path d="M103 43 C118 43, 118 27, 132 27" stroke="url(#linhaFluxo)" strokeWidth="3" fill="none" />
              <path d="M227 27 C240 27, 240 43, 252 43" stroke="url(#linhaFluxo)" strokeWidth="3" fill="none" />
              <text x="56" y="47" textAnchor="middle" fontSize="10" fill="#fff">Obra</text>
              <text x="180" y="31" textAnchor="middle" fontSize="10" fill="#fff">Gestão</text>
              <text x="299" y="47" textAnchor="middle" fontSize="10" fill="#fff">Relatórios</text>
            </svg>
            <div style={{ fontSize: 13, fontWeight: "bold", marginTop: 2 }}>
              Menos retrabalho, mais resultado no dia a dia.
            </div>
          </div>
        </aside>
      )}

      <main
        style={{
          padding: isMobile ? 16 : "42px 52px 26px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between"
        }}
      >
        <div style={{ maxWidth: 860 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 14 }}>
            {isMobile && (
              <img
                src={logoSistema}
                alt="Logo"
                style={{
                  width: 114,
                  height: 114,
                  borderRadius: 0,
                  border: "none",
                  padding: 0,
                  background: "transparent",
                  objectFit: "contain"
                }}
              />
            )}
            <strong style={{ color: "#173454", fontSize: isMobile ? 18 : 28 }}>Entre na sua conta</strong>
          </div>
          <p style={{ marginTop: 0, color: "#3e5f82", marginBottom: 18, fontSize: isMobile ? 13 : 16 }}>
            Gestão inteligente de obras e operações em um só lugar.
          </p>
          <p style={{ marginTop: 0, color: "#5e738e", marginBottom: 16, fontSize: isMobile ? 13 : 18 }}>
            Acesso: <strong>{destino || "operacao geral"}</strong>
          </p>

          <div style={{ marginBottom: 8, fontWeight: "bold", color: "#2f4766", fontSize: 16 }}>E-mail ou CPF</div>
          <input
            style={caixaInput}
            placeholder="Digite seu e-mail ou CPF"
            value={identificador}
            onChange={(e) => setIdentificador(e.target.value)}
          />

          <div style={{ marginBottom: 8, fontWeight: "bold", color: "#2f4766", fontSize: 16 }}>{modoTroca ? "Senha atual" : "Senha"}</div>
          <input
            style={caixaInput}
            type="password"
            placeholder={modoTroca ? "Senha atual" : "Senha"}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />

          {modoTroca && (
            <>
              <input
                style={caixaInput}
                type="password"
                placeholder="Nova senha"
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
              />
              <input
                style={caixaInput}
                type="password"
                placeholder="Confirmar nova senha"
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
              />
            </>
          )}

          <button
            onClick={modoTroca ? trocarSenha : entrar}
            style={{
              marginTop: 4,
              width: isMobile ? "100%" : 360,
              background: "#34a853",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "12px 16px",
              fontWeight: "bold",
              fontSize: 22,
              cursor: "pointer"
            }}
          >
            {modoTroca ? "Salvar nova senha" : "Entrar"}
          </button>

          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={esqueciSenha}
              style={{ background: "transparent", color: "#1d61e7", border: "none", padding: 0, fontSize: 16, cursor: "pointer" }}
            >
              Esqueci a senha
            </button>
            <button
              onClick={() => {
                if (modoTroca) {
                  setModoTroca(false);
                  setNovaSenha("");
                  setConfirmarSenha("");
                  return;
                }
                setTela("home");
              }}
              style={{ background: "transparent", color: "#6c757d", border: "none", padding: 0, fontSize: 15, cursor: "pointer" }}
            >
              {modoTroca ? "Voltar para login" : "Voltar"}
            </button>
          </div>

          <div style={{ marginTop: 14, fontSize: 14, color: "#5e738e" }}>
            No primeiro acesso, utilize a senha cadastrada pelo administrador da sua empresa ou recupere sua senha por e-mail.
          </div>
        </div>

        <footer
          style={{
            marginTop: 26,
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(280px, 1fr))",
            gap: 12
          }}
        >
          <div style={{ background: "#fff", border: "1px solid #dbe3ef", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: "#5e738e", marginBottom: 4 }}>Ainda não é cliente?</div>
            <a href={SALES_WHATSAPP_URL} target="_blank" rel="noreferrer" style={{ color: "#1d61e7", fontWeight: "bold", textDecoration: "none" }}>
              Fale com Vendas (WhatsApp)
            </a>
          </div>

          <div style={{ background: "#fff", border: "1px solid #dbe3ef", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ color: "#5e738e", marginBottom: 4 }}>Não consegue entrar na sua conta?</div>
            <a href={SUPPORT_WHATSAPP_URL} target="_blank" rel="noreferrer" style={{ color: "#1d61e7", fontWeight: "bold", textDecoration: "none" }}>
              Fale com Suporte (WhatsApp)
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}

export default Login;


