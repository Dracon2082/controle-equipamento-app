/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState } from "react";
import { db } from "../firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  updateDoc
} from "firebase/firestore";
import { registrarHistorico } from "../utils/historico";
import { LIMITES_PADRAO_PLANO, obterLimitesPlanoCliente } from "../utils/planos";
import { belongsToTenant, getTenantId, withTenant } from "../utils/tenant";
import { garantirUsuarioAuth } from "../utils/authUsers";

function Frentista({ setTela }) {
  const tenantId = getTenantId();
  const PERFIL_GESTOR_GERAL = "GESTOR_GERAL";
  const PERFIL_ADMIN_UNIDADE = "ADMIN_UNIDADE";
  const PERFIL_OPERACIONAL = "OPERACIONAL";
  const PERMISSAO_TRANSPORTE_LEGADA = "transportes";
  const PERMISSAO_INFORMAR_MEIO_TRANSPORTE = "informarMeioTransporte";
  const PERMISSAO_RECEBER_TRANSPORTE = "receberTransporte";
  const sessaoOperacional = (() => {
    try {
      return JSON.parse(localStorage.getItem("sessaoOperacional") || "{}");
    } catch {
      return {};
    }
  })();
  const perfilSessao = String(sessaoOperacional?.perfilAcesso || "").toUpperCase();
  const usuarioChaveSessao = Boolean(sessaoOperacional?.usuarioChave);
  const basesSessao = Array.isArray(sessaoOperacional?.basesPermitidas)
    ? sessaoOperacional.basesPermitidas.map((b) => String(b || "").trim()).filter(Boolean)
    : [];
  const podeGerenciarPerfisAdministrativos =
    perfilSessao === PERFIL_GESTOR_GERAL && usuarioChaveSessao;
  const podeVerOperacionaisDaUnidade = perfilSessao === PERFIL_ADMIN_UNIDADE;
  const podeVerListaUsuarios = podeGerenciarPerfisAdministrativos || podeVerOperacionaisDaUnidade;
  const permissoesAdministrativas = [
    "admin_relatorios",
    "admin_cadastros",
    "admin_controle"
  ];
  const permissoesFinanceiras = ["admin_financeiro"];
  const permissoesOperacionaisPadrao = [
    "abastecimento",
    "lancamento",
    "diarioObra",
    "producaoCampo",
    "manutencao",
    "materiaisSaidas",
    // Recebimento de transferencia (QR + assinatura) e operacional.
    "receberTransferencia",
    PERMISSAO_INFORMAR_MEIO_TRANSPORTE,
    PERMISSAO_RECEBER_TRANSPORTE
  ];

  const opcoesPermissao = [
    { key: "abastecimento", label: "Abastecimento" },
    { key: "lancamento", label: "Lancamento diario de equipamento" },
    { key: "diarioObra", label: "Diario de Obra (RDO)" },
    { key: "producaoCampo", label: "Produção de campo / croqui" },
    { key: "manutencao", label: "Manutenção de equipamentos" },
    { key: "materiaisSaidas", label: "Saidas de materiais (almox/insumos/EPI)" },
    { key: "receberTransferencia", label: "Receber transferencia (QR)" },
    { key: PERMISSAO_INFORMAR_MEIO_TRANSPORTE, label: "Informar meio de transporte / gerar romaneio" },
    { key: PERMISSAO_RECEBER_TRANSPORTE, label: "Receber transporte (QR)" }
  ];
  const permissoesOperacionaisValidas = Array.from(
    new Set([...opcoesPermissao.map((op) => op.key), PERMISSAO_TRANSPORTE_LEGADA])
  );

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [cpf, setCpf] = useState("");
  const [funcao, setFuncao] = useState("");
  const [perfilAcesso, setPerfilAcesso] = useState(PERFIL_OPERACIONAL);
  const [usuarioChave, setUsuarioChave] = useState(false);
  const [permissoes, setPermissoes] = useState([]);
  const [basesPermitidas, setBasesPermitidas] = useState([]);
  const [basesDisponiveis, setBasesDisponiveis] = useState([]);
  const [lista, setLista] = useState([]);
  const [listaOriginal, setListaOriginal] = useState([]);
  const [editandoId, setEditandoId] = useState(null);
  const [mostrarListaUsuarios, setMostrarListaUsuarios] = useState(false);
  const [limitesPlano, setLimitesPlano] = useState({
    gestores: LIMITES_PADRAO_PLANO.gestores,
    admins: LIMITES_PADRAO_PLANO.admins,
    operadores: LIMITES_PADRAO_PLANO.operadores,
    operadoresIlimitado: false,
    total: 0
  });

  const normalizarTexto = (valor) => String(valor || "").toUpperCase().trim();
  const apenasDigitos = (valor) => String(valor || "").replace(/\D/g, "");
  const formatarCpf = (valor) => {
    const digitos = apenasDigitos(valor).slice(0, 11);
    return digitos
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  };
  const chaveBase = (cidade, estado) => `${normalizarTexto(cidade)}__${normalizarTexto(estado)}`;

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

  const warningButton = {
    background: "#f0ad4e",
    color: "#000",
    border: "none",
    padding: "6px 10px",
    borderRadius: 6,
    cursor: "pointer",
    marginRight: 6
  };

  const dangerButton = {
    background: "#cc0000",
    color: "#fff",
    border: "none",
    padding: "6px 10px",
    borderRadius: 6,
    cursor: "pointer"
  };

  const thStyle = { border: "1px solid #ccc", padding: "6px 5px", whiteSpace: "normal", textAlign: "center", fontSize: 12, lineHeight: 1.15 };
  const tdStyle = { border: "1px solid #ccc", padding: "6px 5px", verticalAlign: "middle", wordBreak: "break-word", overflowWrap: "anywhere", fontSize: 11, lineHeight: 1.2, textAlign: "center" };
  const tdNoWrap = { ...tdStyle, whiteSpace: "nowrap" };
  const tdAcoes = { ...tdStyle, textAlign: "center", whiteSpace: "nowrap" };

  const limparFormulario = () => {
    setNome("");
    setEmail("");
    setCpf("");
    setFuncao("");
    setPerfilAcesso(PERFIL_OPERACIONAL);
    setUsuarioChave(false);
    setPermissoes([]);
    setBasesPermitidas([]);
    setEditandoId(null);
  };

  const carregar = async () => {
    const [snapUsuarios, snapClientes, snapObras, snapBases] = await Promise.all([
      getDocs(collection(db, "frentistas")),
      getDocs(collection(db, "clientesSistema")),
      getDocs(collection(db, "obras")),
      getDocs(collection(db, "bases_operacionais"))
    ]);

    const dados = snapUsuarios.docs.map((docItem) => ({
      id: docItem.id,
      ...docItem.data()
    })).filter((item) => belongsToTenant(item, tenantId));
    const dadosVisiveis = podeGerenciarPerfisAdministrativos
      ? dados
      : podeVerOperacionaisDaUnidade
      ? dados.filter((item) => String(item.perfilAcesso || PERFIL_OPERACIONAL).toUpperCase() === PERFIL_OPERACIONAL)
      : [];
    dadosVisiveis.sort((a, b) => `${a.nome || ""}`.localeCompare(`${b.nome || ""}`));
    setLista(dadosVisiveis);
    setListaOriginal(dadosVisiveis);

    const clientes = snapClientes.docs.map((d) => d.data());
    const clienteAtual =
      clientes.find((item) => String(item.tenantId || "").toLowerCase() === String(tenantId || "").toLowerCase()) ||
      clientes.find((item) => String(item.cnpj || "") === String(tenantId || ""));
    const limitesCliente = obterLimitesPlanoCliente(clienteAtual || {});
    const limiteGestores = Number(limitesCliente.limiteGestores || LIMITES_PADRAO_PLANO.gestores);
    const limiteAdmins = Number(limitesCliente.limiteAdmins || LIMITES_PADRAO_PLANO.admins);
    const limiteOperadoresRaw = limitesCliente.limiteOperadores;
    const operadoresIlimitado = limiteOperadoresRaw === null || Number(limiteOperadoresRaw) <= 0;
    const limiteOperadores = operadoresIlimitado ? 0 : Number(limiteOperadoresRaw || LIMITES_PADRAO_PLANO.operadores);
    const limiteTotal = Number(limitesCliente.maxUsuariosNoPlano || 0);
    setLimitesPlano({
      gestores: limiteGestores > 0 ? limiteGestores : LIMITES_PADRAO_PLANO.gestores,
      admins: limiteAdmins > 0 ? limiteAdmins : LIMITES_PADRAO_PLANO.admins,
      operadores: limiteOperadores,
      operadoresIlimitado,
      total: limiteTotal > 0 ? limiteTotal : 0
    });

    const basesCatalogo = snapBases.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId))
      .filter((b) => b.ativo !== false);

    const mapaBases = new Map();

    // Preferencia: usa o catalogo de bases cadastrado (UF + Cidades).
    basesCatalogo.forEach((item) => {
      const chave = chaveBase(item.cidade, item.estado);
      if (!chave || mapaBases.has(chave)) return;
      mapaBases.set(chave, {
        chave,
        cidade: normalizarTexto(item.cidade),
        estado: normalizarTexto(item.estado)
      });
    });

    // Fallback (compatibilidade): se ainda nao tem catalogo, usa as bases inferidas das obras.
    const obrasTenant = snapObras.docs
      .map((d) => d.data())
      .filter((item) => belongsToTenant(item, tenantId));
    if (mapaBases.size === 0) {
      obrasTenant.forEach((item) => {
        const chave = chaveBase(item.cidade, item.estado);
        if (!chave || mapaBases.has(chave)) return;
        mapaBases.set(chave, {
          chave,
          cidade: normalizarTexto(item.cidade),
          estado: normalizarTexto(item.estado)
        });
      });
    }
    setBasesDisponiveis(Array.from(mapaBases.values()).sort((a, b) => `${a.estado}${a.cidade}`.localeCompare(`${b.estado}${b.cidade}`)));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    carregar();
  }, []);

  useEffect(() => {
    if (!podeGerenciarPerfisAdministrativos) {
      setPerfilAcesso(PERFIL_OPERACIONAL);
      setUsuarioChave(false);
      setBasesPermitidas(basesSessao);
    }
  }, [basesSessao.join("|"), podeGerenciarPerfisAdministrativos]); // eslint-disable-line react-hooks/exhaustive-deps

  const alternarPermissao = (chave) => {
    setPermissoes((anterior) =>
      anterior.includes(chave)
        ? anterior.filter((item) => item !== chave)
        : [...anterior, chave]
    );
  };

  const alternarBase = (chave) => {
    setBasesPermitidas((anterior) =>
      anterior.includes(chave)
        ? anterior.filter((item) => item !== chave)
        : [...anterior, chave]
    );
  };

  const editar = (item) => {
    const perfilItem = String(item.perfilAcesso || "").toUpperCase();
    if (!podeGerenciarPerfisAdministrativos && perfilItem !== PERFIL_OPERACIONAL) {
      alert("Somente gestor-chave pode editar usuarios administrativos.");
      return;
    }
    setNome(item.nome || "");
    setEmail(item.email || "");
    setCpf(formatarCpf(item.cpf || ""));
    setFuncao(item.funcao || "");
    const perfilInferido = perfilItem
      || (String(item.funcao || "").toUpperCase().includes("GESTOR") ? PERFIL_GESTOR_GERAL : PERFIL_OPERACIONAL);
    setPerfilAcesso(perfilInferido);
    setUsuarioChave(item?.usuarioChave === true || perfilInferido === PERFIL_GESTOR_GERAL);
    const permissoesItem = Array.isArray(item.permissoes) ? item.permissoes : [];
    const permissoesNormalizadas = permissoesItem.map((perm) =>
      perm === PERMISSAO_TRANSPORTE_LEGADA ? PERMISSAO_INFORMAR_MEIO_TRANSPORTE : perm
    );
    setPermissoes(Array.from(new Set(permissoesNormalizadas)));
    const basesItem = Array.isArray(item.basesPermitidas) ? item.basesPermitidas : [];
    setBasesPermitidas(
      perfilInferido === PERFIL_GESTOR_GERAL
        ? []
        : basesItem.length
        ? basesItem
        : basesDisponiveis.map((base) => base.chave)
    );
    setEditandoId(item.id);
    setMostrarListaUsuarios(true);
  };

  const salvar = async () => {
    if (!nome) return alert("Informe o nome completo.");
    if (!email || !String(email).includes("@")) return alert("E-mail invalido.");
    if (!funcao) return alert("Informe a funcao.");
    const perfilSelecionado = String(perfilAcesso || PERFIL_OPERACIONAL).toUpperCase();
    const cpfNumero = apenasDigitos(cpf);
    if (!podeGerenciarPerfisAdministrativos && perfilSelecionado !== PERFIL_OPERACIONAL) {
      return alert("Somente gestor-chave pode cadastrar ou editar administrativo da unidade.");
    }
    if (perfilSelecionado === PERFIL_OPERACIONAL && cpfNumero.length !== 11) {
      return alert("Informe um CPF valido para o usuario operacional.");
    }
    const limiteOperacionaisPlano = limitesPlano.operadoresIlimitado ? 0 : Number(limitesPlano.operadores || 0);
    const limiteAdminsPlano = Number(limitesPlano.admins || 0);
    const limiteGestoresPlano = Number(limitesPlano.gestores || 1);
    const limiteTotalPlano = Number(limitesPlano.total || 0);
    const totalUsuariosAtivos = lista.filter((item) => item.id !== editandoId).length;
    const totalOperacionais = lista.filter(
      (item) =>
        String(item.perfilAcesso || PERFIL_OPERACIONAL).toUpperCase() === PERFIL_OPERACIONAL &&
        item.id !== editandoId
    ).length;
    const totalAdmins = lista.filter(
      (item) =>
        String(item.perfilAcesso || PERFIL_OPERACIONAL).toUpperCase() === PERFIL_ADMIN_UNIDADE &&
        item.id !== editandoId
    ).length;
    const totalGestores = lista.filter(
      (item) =>
        String(item.perfilAcesso || PERFIL_OPERACIONAL).toUpperCase() === PERFIL_GESTOR_GERAL &&
        item.id !== editandoId
    ).length;
    if (!editandoId && limiteTotalPlano > 0 && totalUsuariosAtivos >= limiteTotalPlano) {
      alert(`Limite total de usuarios do plano atingido (${limiteTotalPlano}).`);
      return;
    }
    if (!editandoId && perfilSelecionado === PERFIL_OPERACIONAL && limiteOperacionaisPlano > 0 && totalOperacionais >= limiteOperacionaisPlano) {
      alert(`Limite de usuarios operacionais atingido (${limiteOperacionaisPlano}).`);
      return;
    }
    if (!editandoId && perfilSelecionado === PERFIL_ADMIN_UNIDADE && limiteAdminsPlano > 0 && totalAdmins >= limiteAdminsPlano) {
      alert(`Limite de usuarios ADM atingido (${limiteAdminsPlano}).`);
      return;
    }
    if (!editandoId && perfilSelecionado === PERFIL_GESTOR_GERAL && limiteGestoresPlano > 0 && totalGestores >= limiteGestoresPlano) {
      alert(`Limite de gestores atingido (${limiteGestoresPlano}).`);
      return;
    }

    const permissoesOperacionaisSelecionadas = permissoes
      .filter((item) => permissoesOperacionaisValidas.includes(item))
      .map((item) => (item === PERMISSAO_TRANSPORTE_LEGADA ? PERMISSAO_INFORMAR_MEIO_TRANSPORTE : item));
    if (perfilSelecionado === PERFIL_OPERACIONAL && !permissoesOperacionaisSelecionadas.length) {
      return alert("Selecione pelo menos uma permissao operacional.");
    }
    const basesUsuarioFinal =
      perfilSelecionado === PERFIL_GESTOR_GERAL
        ? []
        : (podeGerenciarPerfisAdministrativos ? basesPermitidas : basesSessao);
    if (perfilSelecionado !== PERFIL_GESTOR_GERAL && !basesUsuarioFinal.length) {
      return alert("Selecione pelo menos uma base permitida para o usuario.");
    }

    // Em bases antigas pode existir duplicidade de e-mail entre operacionais.
    // Na edicao, se o usuario NAO mudou o e-mail, permitimos atualizar permissoes/bases sem bloquear.
    const emailDigitado = String(email || "").trim().toLowerCase();
    const emailAtualRegistro = editandoId
      ? String((listaOriginal.find((u) => u.id === editandoId)?.email || "")).trim().toLowerCase()
      : "";
    const emailFoiAlterado = !editandoId ? true : emailDigitado !== emailAtualRegistro;

    const emailExiste = emailFoiAlterado
      ? lista.find((item) => String(item.email || "").trim().toLowerCase() === emailDigitado && item.id !== editandoId)
      : null;
    if (emailExiste) return alert("E-mail ja cadastrado.");
    const cpfExiste = lista.find(
      (item) => apenasDigitos(item.cpf) === cpfNumero && item.id !== editandoId
    );
    if (perfilSelecionado === PERFIL_OPERACIONAL && cpfExiste) return alert("CPF ja cadastrado.");

    if (perfilSelecionado === PERFIL_OPERACIONAL) {
      const duplicadoMesmaBase = lista.find((item) => {
        if (item.id === editandoId) return false;
        const mesmoCpf = cpfNumero.length === 11 && apenasDigitos(item.cpf) === cpfNumero;
        const mesmoEmail = String(item.email || "").trim().toLowerCase() === emailDigitado;
        if (!mesmoCpf && !mesmoEmail) return false;
        return basesSobrepostas(item.basesPermitidas, basesUsuarioFinal);
      });

      if (duplicadoMesmaBase) {
        return alert("Ja existe um operador com este CPF ou e-mail em uma das mesmas bases selecionadas.");
      }
    }

    let permissoesFinal = permissoesOperacionaisSelecionadas;
    if (perfilSelecionado === PERFIL_ADMIN_UNIDADE) {
      permissoesFinal = Array.from(new Set([...permissoesOperacionaisSelecionadas, ...permissoesAdministrativas]));
    }
    if (perfilSelecionado === PERFIL_GESTOR_GERAL) {
      permissoesFinal = Array.from(new Set([
        ...permissoesOperacionaisPadrao,
        ...permissoesAdministrativas,
        ...permissoesFinanceiras
      ]));
    }

    const payload = withTenant({
      nome: normalizarTexto(nome),
      email: String(email || "").trim().toLowerCase(),
      cpf: perfilSelecionado === PERFIL_OPERACIONAL ? cpfNumero : "",
      dataNascimento: "",
      funcao: normalizarTexto(funcao),
      perfilAcesso: perfilSelecionado,
      usuarioChave: podeGerenciarPerfisAdministrativos ? Boolean(usuarioChave) : false,
      permissoes: permissoesFinal,
      basesPermitidas: basesUsuarioFinal,
      atualizadoEm: new Date().toISOString()
    }, tenantId);

    if (payload.usuarioChave) {
      const snapUsuarios = await getDocs(collection(db, "frentistas"));
      const usuariosChaveAtivos = snapUsuarios.docs.filter((docItem) => {
        const dados = docItem.data();
        if (!belongsToTenant(dados, tenantId)) return false;
        if (docItem.id === editandoId) return false;
        return dados?.usuarioChave === true;
      });
      await Promise.all(
        usuariosChaveAtivos.map((docItem) =>
          updateDoc(doc(db, "frentistas", docItem.id), { usuarioChave: false })
        )
      );
    }

    if (editandoId) {
      await updateDoc(doc(db, "frentistas", editandoId), payload);
      await registrarHistorico({
        modulo: "USUARIOS_OPERACIONAIS",
        acao: "EDITOU",
        entidade: "USUARIO",
        registroId: editandoId,
        usuario: payload.nome,
        descricao: `Editou usuario operacional ${payload.nome}.`,
        detalhes: { permissoes }
      });
    } else {
      const senhaProvisionada = perfilSelecionado === PERFIL_OPERACIONAL
        ? cpfNumero.substring(0, 6)
        : (() => {
          const base = Math.random().toString(36).slice(2, 8);
          return `Temp@${base}`;
        })();
      payload.senha = senhaProvisionada;
      payload.senhaInicial = senhaProvisionada;
      payload.trocarSenhaObrigatoria = false;
      payload.criadoEm = new Date().toISOString();
      const ref = await addDoc(collection(db, "frentistas"), payload);
      await garantirUsuarioAuth(payload.email, senhaProvisionada);
      await registrarHistorico({
        modulo: "USUARIOS_OPERACIONAIS",
        acao: "CRIOU",
        entidade: "USUARIO",
        registroId: ref.id,
        usuario: payload.nome,
        descricao: `Cadastrou usuario operacional ${payload.nome}.`,
        detalhes: { permissoes }
      });
      alert(
        "Usuario operacional salvo com sucesso.\n\n" +
        `Login: ${perfilSelecionado === PERFIL_OPERACIONAL ? cpfNumero : payload.email}\n` +
        `E-mail de recuperacao: ${payload.email}\n` +
        `Senha inicial: ${senhaProvisionada}\n\n` +
        "Depois do primeiro acesso, o usuario pode alterar a senha em Minha Conta."
      );
    }
    if (editandoId) alert("Usuario operacional atualizado com sucesso.");
    limparFormulario();
    carregar();
  };

  const excluir = async (id) => {
    if (!window.confirm("Excluir usuario operacional?")) return;
    const alvo = lista.find((item) => item.id === id);
    await deleteDoc(doc(db, "frentistas", id));
    await registrarHistorico({
      modulo: "USUARIOS_OPERACIONAIS",
      acao: "EXCLUIU",
      entidade: "USUARIO",
      registroId: id,
      usuario: alvo?.nome || "",
      descricao: `Excluiu usuario operacional ${alvo?.nome || "-"}.`
    });
    carregar();
  };

  const textoPermissoes = (itens) =>
    (Array.isArray(itens) ? itens : [])
      .map((chave) => opcoesPermissao.find((op) => op.key === chave)?.label || chave)
      .join(" | ");

  const formatarBaseLabel = (chave) => {
    const encontrada = basesDisponiveis.find((base) => base.chave === chave);
    if (encontrada) return `${encontrada.cidade}/${encontrada.estado}`;
    const [cidade = "", estado = ""] = String(chave || "").split("__");
    if (!cidade && !estado) return "-";
    return `${cidade}/${estado}`.replace(/\/$/, "");
  };

  const textoBases = (itens) =>
    (Array.isArray(itens) ? itens : [])
      .map((chave) => formatarBaseLabel(chave))
      .join(" | ");

  const basesSobrepostas = (basesA, basesB) => {
    const setA = new Set(
      (Array.isArray(basesA) ? basesA : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    );
    return (Array.isArray(basesB) ? basesB : []).some((item) =>
      setA.has(String(item || "").trim())
    );
  };

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 20, background: "#f5f7fa", minHeight: "100vh" }}>
      <h2 style={{ textAlign: "center", marginBottom: 20 }}>Cadastro de Usuarios Operacionais</h2>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Dados de acesso</h3>

        <input
          style={inputStyle}
          placeholder="Nome completo"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
        <input
          style={inputStyle}
          placeholder="E-mail de acesso"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          style={inputStyle}
          placeholder="CPF (login do operacional)"
          value={cpf}
          onChange={(e) => setCpf(formatarCpf(e.target.value))}
        />
        <input
          style={inputStyle}
          placeholder="Funcao"
          value={funcao}
          onChange={(e) => setFuncao(e.target.value)}
        />
        <select
          style={inputStyle}
          value={perfilAcesso}
          onChange={(e) => {
            const perfilNovo = e.target.value;
            setPerfilAcesso(perfilNovo);
            if (perfilNovo === PERFIL_GESTOR_GERAL) {
              setBasesPermitidas([]);
              setPermissoes(permissoesOperacionaisPadrao);
              setUsuarioChave(true);
            }
          }}
        >
          {podeGerenciarPerfisAdministrativos && (
            <option value={PERFIL_GESTOR_GERAL}>Gestor Geral (acesso completo da empresa)</option>
          )}
          {podeGerenciarPerfisAdministrativos && (
            <option value={PERFIL_ADMIN_UNIDADE}>Administrativo da Unidade</option>
          )}
          <option value={PERFIL_OPERACIONAL}>Operacional (app/campo)</option>
        </select>
        <div style={{ marginBottom: 12, background: "#eef4ff", border: "1px solid #c9dafd", borderRadius: 8, padding: "8px 10px", color: "#1b3e8a", fontWeight: "bold" }}>
          Operacional APP/Campo: login por CPF e senha inicial com os 6 primeiros digitos do CPF. O e-mail fica para recuperacao de senha.
        </div>
        {podeGerenciarPerfisAdministrativos && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, color: "#1f3c63", fontWeight: "bold" }}>
            <input
              type="checkbox"
              checked={usuarioChave}
              onChange={(e) => setUsuarioChave(e.target.checked)}
            />
            Usuario-Chave (controla todos os cadastros)
          </label>
        )}

        <div style={{ border: "1px solid #d4dbe7", borderRadius: 8, padding: 10, marginBottom: 12 }}>
          <strong>Permissoes de operacao</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 6, marginTop: 8 }}>
            {opcoesPermissao.map((op) => (
              <label key={op.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={permissoes.includes(op.key)}
                  onChange={() => alternarPermissao(op.key)}
                />
                {op.label}
              </label>
            ))}
          </div>
        </div>

        {perfilAcesso === PERFIL_GESTOR_GERAL ? (
          <div style={{ marginBottom: 12, background: "#e9f7ef", border: "1px solid #b7e2c8", borderRadius: 8, padding: "8px 10px", color: "#1d5f3d", fontWeight: "bold" }}>
            Gestor geral: acesso total a todas as cidades, relatorios, cadastros e financeiro.
          </div>
        ) : !podeGerenciarPerfisAdministrativos ? (
          <div style={{ border: "1px solid #d4dbe7", borderRadius: 8, padding: 10, marginBottom: 12 }}>
            <strong>Bases da unidade (fixas)</strong>
            <div style={{ marginTop: 8, color: "#3a4d69", fontSize: 13 }}>
              {basesSessao.length
                ? basesSessao.map((chave) => formatarBaseLabel(chave)).join(" | ")
                : "Nenhuma base vinculada ao usuario da unidade. Solicite ajuste ao gestor-chave."}
            </div>
          </div>
        ) : (
          <div style={{ border: "1px solid #d4dbe7", borderRadius: 8, padding: 10, marginBottom: 12 }}>
            <strong>Bases permitidas (cidade/estado)</strong>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 6, marginTop: 8 }}>
              {basesDisponiveis.map((base) => (
                <label key={base.chave} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={basesPermitidas.includes(base.chave)}
                    onChange={() => alternarBase(base.chave)}
                  />
                  {base.cidade}/{base.estado}
                </label>
              ))}
              {basesDisponiveis.length === 0 && (
                <span style={{ color: "#8a98ad", fontSize: 13 }}>
                  Cadastre obras para liberar bases operacionais.
                </span>
              )}
            </div>
            {perfilAcesso === PERFIL_ADMIN_UNIDADE && (
              <div style={{ marginTop: 8, fontSize: 13, color: "#3a4d69" }}>
                Administrativo da unidade pode cadastrar e gerir apenas usuarios operacionais.
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <button style={primaryButton} onClick={salvar}>
            {editandoId ? "ATUALIZAR" : "SALVAR"}
          </button>
          <button style={secondaryButton} onClick={limparFormulario}>
            LIMPAR
          </button>
          </div>
      </div>

      {podeVerListaUsuarios ? (
      <div style={card}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: mostrarListaUsuarios ? 14 : 0
          }}
        >
          <div>
            <div style={{ fontSize: 24, fontWeight: "bold", color: "#16345f" }}>
              Usuarios cadastrados
            </div>
            <div style={{ color: "#5a6f8f", marginTop: 4 }}>
              {listaOriginal.length} usuario(s) disponivel(is) para consulta e manutencao.
            </div>
          </div>
          <button
            style={{
              ...secondaryButton,
              minWidth: 220,
              background: mostrarListaUsuarios ? "#0b3d91" : "#6c757d"
            }}
            onClick={() => setMostrarListaUsuarios((aberto) => !aberto)}
          >
            {mostrarListaUsuarios
              ? `OCULTAR USUARIOS (${listaOriginal.length})`
              : `VER USUARIOS CADASTRADOS (${listaOriginal.length})`}
          </button>
        </div>

        {mostrarListaUsuarios ? (
          <>
            <input
              style={{ ...inputStyle, marginBottom: 14 }}
              placeholder="Buscar usuario..."
              onChange={(e) => {
                const valor = String(e.target.value || "").toLowerCase().trim();
                if (!valor) {
                  setLista(listaOriginal);
                  return;
                }
                const filtrado = listaOriginal.filter((item) =>
                  String(item.nome || "").toLowerCase().includes(valor)
                );
                setLista(filtrado);
              }}
            />

            <div style={{ width: "100%" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 8, overflow: "hidden", tableLayout: "fixed" }}>
                <thead style={{ background: "#0b3d91", color: "#fff" }}>
                  <tr>
                    <th style={{ ...thStyle, width: "14%" }}>Nome</th>
                    <th style={{ ...thStyle, width: "16%" }}>E-mail</th>
                    <th style={{ ...thStyle, width: "10%" }}>CPF/Login</th>
                    <th style={{ ...thStyle, width: "10%" }}>Senha inicial</th>
                    <th style={{ ...thStyle, width: "12%" }}>Perfil / Funcao</th>
                    <th style={{ ...thStyle, width: "14%" }}>Permissoes</th>
                    <th style={{ ...thStyle, width: "14%" }}>Bases</th>
                    <th style={{ ...thStyle, width: "10%" }}>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                {lista.length === 0 && (
                  <tr>
                    <td colSpan="8" style={{ textAlign: "center", padding: 12 }}>
                      Nenhum usuario operacional cadastrado.
                    </td>
                  </tr>
                )}
                {lista.map((item, index) => (
                  <tr key={item.id} style={{ background: index % 2 === 0 ? "#f2f2f2" : "#fff" }}>
                    <td style={tdStyle}>{item.nome || "-"}</td>
                    <td style={{ ...tdStyle, textAlign: "left" }}>{item.email || "-"}</td>
                    <td style={{ ...tdNoWrap, textAlign: "center" }}>{formatarCpf(item.cpf || "") || "-"}</td>
                    <td style={{ ...tdNoWrap, fontFamily: "monospace", textAlign: "center" }}>{item.senhaInicial || item.senha || "-"}</td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: "bold" }}>{item.perfilAcesso || PERFIL_OPERACIONAL}</div>
                      <div>{item.funcao || "-"}</div>
                      {item.usuarioChave ? <div style={{ color: "#1d5f3d", fontWeight: "bold" }}>Usuario-chave</div> : null}
                    </td>
                    <td style={tdStyle}>{textoPermissoes(item.permissoes) || "-"}</td>
                    <td style={tdStyle}>
                      {String(item.perfilAcesso || PERFIL_OPERACIONAL).toUpperCase() === PERFIL_GESTOR_GERAL
                        ? "TODAS"
                        : textoBases(item.basesPermitidas) || "-"}
                    </td>
                    <td style={tdAcoes}>
                      <div style={{ display: "grid", gap: 4 }}>
                        <button style={{ ...warningButton, marginRight: 0 }} onClick={() => editar(item)}>Editar</button>
                        <button style={dangerButton} onClick={() => excluir(item.id)}>Excluir</button>
                      </div>
                    </td>
                  </tr>
                ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
      ) : (
      <div style={card}>
        <div style={{ color: "#2f4665", fontWeight: "bold" }}>
          Apenas Gestor-Geral (usuario-chave) e Administrativo da Unidade podem visualizar usuarios.
        </div>
      </div>
      )}
    </div>
  );
}

export default Frentista;



