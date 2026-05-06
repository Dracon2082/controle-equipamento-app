/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, runTransaction, updateDoc } from "firebase/firestore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { db } from "../firebase";
import { registrarHistorico } from "../utils/historico";
import { formatoLogoPdf, resolverLogoPdf } from "../utils/pdfLogo";
import { belongsToTenant, getConfigDocId, getTenantId, withTenant } from "../utils/tenant";

const TIPOS_MANUTENCAO = ["PREVENTIVA", "CORRETIVA"];
const TIPOS_ITEM = ["PECA", "OLEO", "FILTRO", "SERVICO", "OUTRO"];

function Manutencao({ setTela, modoRelatorio = false }) {
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
  const normalizarBaseValor = (valor) => String(valor || "").trim().toUpperCase();
  const gerarChaveBase = (cidade, estado) => `${normalizarBaseValor(cidade)}__${normalizarBaseValor(estado)}`;

  const [equipamentos, setEquipamentos] = useState([]);
  const [obras, setObras] = useState([]);
  const [lista, setLista] = useState([]);
  const [empresaSistema, setEmpresaSistema] = useState(null);
  const [alertas, setAlertas] = useState([]);
  const [pecasEstoque, setPecasEstoque] = useState([]);
  const [pecaEstoqueId, setPecaEstoqueId] = useState("");
  const [oleosEstoque, setOleosEstoque] = useState([]);
  const [oleoEstoqueId, setOleoEstoqueId] = useState("");
  const [baseChaveAtiva, setBaseChaveAtiva] = useState("");
  const [ultimoLancPorEquip, setUltimoLancPorEquip] = useState({});

  const [tipoManutencao, setTipoManutencao] = useState("PREVENTIVA");
  const [equipamento, setEquipamento] = useState("");
  const [obra, setObra] = useState(""); // preenchida automaticamente pelo ultimo lancamento do equipamento
  const [mecanico, setMecanico] = useState("");
  const [dataExecucao, setDataExecucao] = useState(new Date().toISOString().split("T")[0]);
  const [horimetroKm, setHorimetroKm] = useState("");
  const [problemaRelatado, setProblemaRelatado] = useState("");
  const [servicosExecutados, setServicosExecutados] = useState("");
  const [proximaManutencao, setProximaManutencao] = useState("");
  const [observacao, setObservacao] = useState("");

  const [itemTipo, setItemTipo] = useState("PECA");
  const [itemNome, setItemNome] = useState("");
  const [itemSerie, setItemSerie] = useState("");
  const [itemQuantidade, setItemQuantidade] = useState("");
  const [itemValorUnitario, setItemValorUnitario] = useState("");
  const [itemObservacao, setItemObservacao] = useState("");
  const [itens, setItens] = useState([]);

  const [filtroEquipamento, setFiltroEquipamento] = useState("");
  const [filtroObra, setFiltroObra] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroDataInicio, setFiltroDataInicio] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");

  const page = {
    maxWidth: 1240,
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
    minHeight: 90,
    resize: "vertical"
  };

  const botaoPrimario = {
    background: "#0b5ed7",
    border: "none",
    color: "#fff",
    borderRadius: 8,
    padding: "10px 14px",
    fontWeight: "bold",
    cursor: "pointer"
  };

  const botaoSecundario = {
    ...botaoPrimario,
    background: "#6c757d"
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    carregarDadosIniciais();
  }, []);

  const numero = (valor) => {
    if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
    const bruto = String(valor ?? "").trim();
    if (!bruto) return 0;

    // Aceita formatos "1234.56", "1234,56" e "1.234,56".
    const temVirgula = bruto.includes(",");
    const temPonto = bruto.includes(".");
    let normalizado = bruto;

    if (temVirgula && temPonto) {
      normalizado = bruto.replace(/\./g, "").replace(",", ".");
    } else if (temVirgula) {
      normalizado = bruto.replace(",", ".");
    }

    const convertido = Number(normalizado);
    return Number.isFinite(convertido) ? convertido : 0;
  };

  const formatarDataBR = (dataISO) => {
    const partes = String(dataISO || "").split("-");
    if (partes.length !== 3) return dataISO || "-";
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
  };

  const formatarMoeda = (valor) =>
    Number(valor || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });

  const primeiroNome = (nomeCompleto) => {
    const nome = String(nomeCompleto || "").trim();
    if (!nome) return "-";
    return nome.split(/\s+/)[0];
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

  const alertasNaBase = useMemo(() => {
    const base = String(baseChaveAtiva || "").trim().toUpperCase();
    if (!base) return [];
    return (alertas || [])
      .filter((a) => String(a.baseChave || "").trim().toUpperCase() === base)
      .filter((a) => String(a.status || "").trim().toUpperCase() === "ABERTO");
  }, [alertas, baseChaveAtiva]);

  const resolverAlerta = async (alertaId) => {
    if (!alertaId) return;
    if (!window.confirm("Marcar este alerta como resolvido?")) return;
    const usuario = String(mecanico || localStorage.getItem("usuarioLogado") || "-").trim() || "-";
    await updateDoc(doc(db, "alertas_manutencao", alertaId), withTenant({
      status: "RESOLVIDO",
      resolvidoEm: new Date().toISOString(),
      resolvidoPor: usuario
    }, tenantId));
    // Atualiza localmente sem recarregar tudo
    setAlertas((prev) => (prev || []).map((a) => (a.id === alertaId ? { ...a, status: "RESOLVIDO" } : a)));
  };

  const usarAlertaNoCadastro = (alerta) => {
    if (!alerta) return;
    if (alerta.baseChave && String(alerta.baseChave).trim()) {
      setBaseChaveAtiva(String(alerta.baseChave).trim().toUpperCase());
    }
    if (alerta.equipamento) setEquipamento(String(alerta.equipamento));
    setTipoManutencao("CORRETIVA");
    setProblemaRelatado(String(alerta.relato || alerta.problema || "").trim());
    if (alerta.data) setDataExecucao(String(alerta.data));
  };

  const carregarDadosIniciais = async () => {
    const [snapEquip, snapObras, snapManut, snapEmpresa, snapPecas, snapLub, snapLanc, snapAlertas] = await Promise.all([
      getDocs(collection(db, "equipamentos")),
      getDocs(collection(db, "obras")),
      getDocs(collection(db, "manutencoes")),
      getDoc(doc(db, "configuracoes", getConfigDocId(tenantId))),
      getDocs(collection(db, "almoxarifado_estoque_pecas")),
      getDocs(collection(db, "lubrificantes")),
      getDocs(collection(db, "lancamentos")),
      getDocs(collection(db, "alertas_manutencao"))
    ]);

    const listaEquip = snapEquip.docs.map((d) => ({ id: d.id, ...d.data() })).filter((item) => belongsToTenant(item, tenantId));
    listaEquip.sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));
    setEquipamentos(listaEquip);

    const listaObras = snapObras.docs.map((d) => ({ id: d.id, ...d.data() })).filter((item) => belongsToTenant(item, tenantId));
    const obrasPermitidas = listaObras.filter(basePermitida);
    listaObras.sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));
    setObras(obrasPermitidas);

    const listaManut = snapManut.docs.map((d) => ({ id: d.id, ...d.data() })).filter((item) => belongsToTenant(item, tenantId));
    listaManut.sort((a, b) => String(b.dataExecucao || "").localeCompare(String(a.dataExecucao || "")));
    setLista(listaManut);

    if (snapEmpresa.exists()) setEmpresaSistema(snapEmpresa.data());

    const listaAlertas = snapAlertas.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId))
      .sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")));
    setAlertas(listaAlertas);

    const pecas = snapPecas.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId));
    pecas.sort((a, b) => {
      const ka = `${String(a.nome || "")} ${String(a.numeroSerie || a.equipamentoCodigo || "")}`.trim();
      const kb = `${String(b.nome || "")} ${String(b.numeroSerie || b.equipamentoCodigo || "")}`.trim();
      return ka.localeCompare(kb);
    });
    setPecasEstoque(pecas);

    const lub = snapLub.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId));
    lub.sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));
    setOleosEstoque(lub);

    const lancs = snapLanc.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId));

    const parseDataRegistro = (item) => {
      if (item?.dataAtualizacao) {
        const dt = new Date(item.dataAtualizacao);
        if (!Number.isNaN(dt.getTime())) return dt;
      }
      if (item?.dataCriacao) {
        const dt = new Date(item.dataCriacao);
        if (!Number.isNaN(dt.getTime())) return dt;
      }
      const texto = String(item?.data || "");
      const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
      const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      return new Date(0);
    };

    // Mapa: equipamento -> ultimo lancamento (para descobrir base/cidade e obra atual)
    const mapaUltimo = {};
    for (const l of lancs) {
      const equipNome = String(l.equipamento || "").trim();
      if (!equipNome) continue;
      const dt = parseDataRegistro(l);
      const atual = mapaUltimo[equipNome];
      if (!atual || dt > atual._dt) {
        const obraNome = String(l.obra || "").trim();
        const obraInfo = listaObras.find((o) => String(o.nome || "").trim() === obraNome);
        const baseChave = obraInfo ? gerarChaveBase(obraInfo.cidade, obraInfo.estado) : "";
        mapaUltimo[equipNome] = { ...l, obraNome, baseChave, _dt: dt };
      }
    }
    setUltimoLancPorEquip(mapaUltimo);

    // Bases disponiveis: se so tem uma, trava automatico
    const basesUnicas = Array.from(
      new Set(obrasPermitidas.map((o) => gerarChaveBase(o.cidade, o.estado)).filter(Boolean))
    );
    if (!baseChaveAtiva && basesUnicas.length === 1) {
      setBaseChaveAtiva(basesUnicas[0]);
    }
  };

  const equipamentoSelecionado = useMemo(
    () => equipamentos.find((eq) => eq.nome === equipamento),
    [equipamentos, equipamento]
  );

  useEffect(() => {
    const nomeEquip = String(equipamento || "").trim();
    if (!nomeEquip) {
      setObra("");
      return;
    }
    const info = ultimoLancPorEquip?.[nomeEquip];
    const obraNome = String(info?.obraNome || info?.obra || "").trim();
    if (obraNome) {
      setObra(obraNome);
    } else {
      setObra("");
    }
  }, [equipamento, ultimoLancPorEquip]);

  const basesDisponiveis = useMemo(() => {
    const mapa = new Map();
    obras.forEach((o) => {
      const key = gerarChaveBase(o.cidade, o.estado);
      if (!key) return;
      if (mapa.has(key)) return;
      mapa.set(key, { baseChave: key, cidade: normalizarBaseValor(o.cidade), estado: normalizarBaseValor(o.estado) });
    });
    return Array.from(mapa.values()).sort((a, b) => String(a.cidade || "").localeCompare(String(b.cidade || "")));
  }, [obras]);

  const equipamentosNaBase = useMemo(() => {
    const base = String(baseChaveAtiva || "").trim().toUpperCase();
    if (!base) return [];
    // Se nao tiver info de ultimo lancamento, mostra todos (fallback)
    const nomes = equipamentos.map((e) => String(e.nome || "").trim()).filter(Boolean);
    const filtrados = nomes.filter((n) => String(ultimoLancPorEquip?.[n]?.baseChave || "").trim().toUpperCase() === base);
    return (filtrados.length ? filtrados : nomes).sort((a, b) => a.localeCompare(b));
  }, [equipamentos, baseChaveAtiva, ultimoLancPorEquip]);

  const baseChaveObra = useMemo(() => String(baseChaveAtiva || "").trim().toUpperCase(), [baseChaveAtiva]);
  const baseCidadeAtiva = useMemo(() => String(baseChaveObra || "").split("__")[0] || "", [baseChaveObra]);
  const baseEstadoAtivo = useMemo(() => String(baseChaveObra || "").split("__")[1] || "", [baseChaveObra]);

  const pecasDisponiveisNaObra = useMemo(() => {
    if (!baseChaveObra) return [];
    return pecasEstoque
      .filter((p) => String(p.baseChave || "").trim().toUpperCase() === baseChaveObra)
      .sort((a, b) => {
        const ka = `${String(a.nome || "")} ${String(a.numeroSerie || a.equipamentoCodigo || "")}`.trim();
        const kb = `${String(b.nome || "")} ${String(b.numeroSerie || b.equipamentoCodigo || "")}`.trim();
        return ka.localeCompare(kb);
      });
  }, [pecasEstoque, baseChaveObra]);

  const filtrosDisponiveisNaObra = useMemo(() => {
    return pecasDisponiveisNaObra.filter((p) =>
      String(p.nome || "").trim().toUpperCase().includes("FILTRO")
    );
  }, [pecasDisponiveisNaObra]);

  const pecaSelecionada = useMemo(
    () => pecasDisponiveisNaObra.find((p) => p.id === pecaEstoqueId) || null,
    [pecasDisponiveisNaObra, pecaEstoqueId]
  );

  const filtroSelecionado = useMemo(
    () => filtrosDisponiveisNaObra.find((p) => p.id === pecaEstoqueId) || null,
    [filtrosDisponiveisNaObra, pecaEstoqueId]
  );

  const oleosDisponiveisNaObra = useMemo(() => {
    if (!baseChaveObra) return [];
    return oleosEstoque
      .filter((i) => String(i.baseChave || "").trim().toUpperCase() === baseChaveObra)
      .filter((i) => String(i.tipo || "").trim().toUpperCase() === "OLEO")
      .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));
  }, [oleosEstoque, baseChaveObra]);

  const oleoSelecionado = useMemo(
    () => oleosDisponiveisNaObra.find((o) => o.id === oleoEstoqueId) || null,
    [oleosDisponiveisNaObra, oleoEstoqueId]
  );

  const totalItens = itens.reduce((acc, item) => acc + numero(item.total), 0);

  const adicionarItem = () => {
    if ((itemTipo === "PECA" || itemTipo === "FILTRO") && !pecaEstoqueId) {
      alert("Selecione a peca/filtro no estoque do almoxarifado.");
      return;
    }
    if (itemTipo === "OLEO" && !oleoEstoqueId) {
      alert("Selecione o oleo no estoque de diesel/lubrificantes.");
      return;
    }

    if (!itemNome.trim()) {
      alert("Informe o nome do item trocado.");
      return;
    }

    const quantidade = numero(itemQuantidade);
    const valorUnitario =
      itemTipo === "PECA"
        ? numero(pecaSelecionada?.precoUnitario || 0)
        : itemTipo === "FILTRO"
          ? numero(filtroSelecionado?.precoUnitario || 0)
          : itemTipo === "OLEO"
            ? numero(oleoSelecionado?.preco || 0)
            : numero(itemValorUnitario);
    const total = quantidade * valorUnitario;

    if (itemTipo === "PECA" || itemTipo === "FILTRO") {
      const alvo = itemTipo === "PECA" ? pecaSelecionada : filtroSelecionado;
      const saldo = numero(alvo?.quantidade || 0);
      if (!quantidade || quantidade <= 0) {
        alert("Informe a quantidade usada.");
        return;
      }
      if (saldo < quantidade) {
        alert("Estoque insuficiente para essa peca.");
        return;
      }
    }
    if (itemTipo === "OLEO") {
      const saldo = numero(oleoSelecionado?.quantidade || 0);
      if (!quantidade || quantidade <= 0) {
        alert("Informe a quantidade usada.");
        return;
      }
      if (saldo < quantidade) {
        alert("Estoque insuficiente para esse oleo.");
        return;
      }
    }

    setItens((anterior) => [
      ...anterior,
      {
        tipo: itemTipo,
        nome: itemNome.trim().toUpperCase(),
        serie: itemTipo === "PECA" || itemTipo === "FILTRO"
          ? String(
              (itemTipo === "PECA" ? pecaSelecionada : filtroSelecionado)?.numeroSerie
              || (itemTipo === "PECA" ? pecaSelecionada : filtroSelecionado)?.equipamentoCodigo
              || itemSerie
              || ""
            ).trim().toUpperCase()
          : itemTipo === "OLEO"
            ? ""
            : itemSerie.trim().toUpperCase(),
        quantidade,
        valorUnitario,
        total,
        observacao: itemObservacao.trim(),
        estoquePecaId: itemTipo === "PECA" || itemTipo === "FILTRO" ? pecaEstoqueId : "",
        estoqueLubId: itemTipo === "OLEO" ? oleoEstoqueId : ""
      }
    ]);

    setItemTipo("PECA");
    setItemNome("");
    setItemSerie("");
    setItemQuantidade("");
    setItemValorUnitario("");
    setItemObservacao("");
    setPecaEstoqueId("");
    setOleoEstoqueId("");
  };

  const removerItem = (indice) => {
    setItens((anterior) => anterior.filter((_, idx) => idx !== indice));
  };

  useEffect(() => {
    if (itemTipo === "PECA" && pecaSelecionada) {
      setItemNome(String(pecaSelecionada.nome || "").trim().toUpperCase());
      setItemSerie(String(pecaSelecionada.numeroSerie || pecaSelecionada.equipamentoCodigo || "").trim().toUpperCase());
      const valor = Number(pecaSelecionada.precoUnitario || 0) || 0;
      setItemValorUnitario(valor ? String(valor) : "");
      return;
    }
    if (itemTipo === "FILTRO" && filtroSelecionado) {
      setItemNome(String(filtroSelecionado.nome || "").trim().toUpperCase());
      setItemSerie(String(filtroSelecionado.numeroSerie || filtroSelecionado.equipamentoCodigo || "").trim().toUpperCase());
      const valor = Number(filtroSelecionado.precoUnitario || 0) || 0;
      setItemValorUnitario(valor ? String(valor) : "");
      return;
    }
    if (itemTipo === "OLEO" && oleoSelecionado) {
      setItemNome(String(oleoSelecionado.nome || "").trim().toUpperCase());
      setItemSerie("");
      const valor = Number(oleoSelecionado.preco || 0) || 0;
      setItemValorUnitario(valor ? String(valor) : "");
      return;
    }
  }, [itemTipo, pecaSelecionada, filtroSelecionado, oleoSelecionado]);

  const salvarManutencao = async () => {
    if (!baseChaveAtiva || !equipamento || !mecanico.trim() || !dataExecucao) {
      alert("Preencha base/cidade, equipamento, mecanico e data.");
      return;
    }
    // A manutencao e controlada pela base ativa. A obra pode existir (por ultimo lancamento),
    // mas nao deve bloquear o cadastro se estiver vazia.

    if (!itens.length && !servicosExecutados.trim()) {
      alert("Informe os servicos executados ou adicione itens trocados.");
      return;
    }

    const pecasNoEstoque = itens.filter((i) => i.tipo === "PECA" || i.tipo === "FILTRO");
    if (pecasNoEstoque.some((i) => !i.estoquePecaId)) {
      alert("Existe peca sem vinculo ao estoque. Remova e adicione novamente selecionando do estoque.");
      return;
    }
    const oleosNoEstoque = itens.filter((i) => i.tipo === "OLEO");
    if (oleosNoEstoque.some((i) => !i.estoqueLubId)) {
      alert("Existe oleo sem vinculo ao estoque. Remova e adicione novamente selecionando do estoque.");
      return;
    }

    const payloadBase = {
      tipoManutencao,
      equipamento,
      codigoEquipamento: equipamentoSelecionado?.codigo || "",
      placaEquipamento: equipamentoSelecionado?.placa || "",
      requisitante: equipamentoSelecionado?.proprietario || "",
      obra,
      mecanico: mecanico.trim().toUpperCase(),
      dataExecucao,
      horimetroKm: String(horimetroKm || "").trim(),
      problemaRelatado: problemaRelatado.trim(),
      servicosExecutados: servicosExecutados.trim(),
      proximaManutencao: proximaManutencao || "",
      observacao: observacao.trim(),
      itens,
      totalManutencao: totalItens,
      criadoEm: new Date().toISOString()
    };

    const manutRef = doc(collection(db, "manutencoes"));

    try {
      await runTransaction(db, async (tx) => {
        // 1) Baixa de pecas no estoque e registro de movimentacao
        for (const item of pecasNoEstoque) {
          const estoqueRef = doc(db, "almoxarifado_estoque_pecas", item.estoquePecaId);
          const estoqueSnap = await tx.get(estoqueRef);
          if (!estoqueSnap.exists()) {
            throw new Error("Peca nao encontrada no estoque.");
          }
          const est = estoqueSnap.data();
          const saldoAtual = Number(est.quantidade || 0);
          const qtd = Number(item.quantidade || 0);
          if (qtd <= 0) throw new Error("Quantidade invalida para peca.");
          if (saldoAtual < qtd) {
            throw new Error(`Estoque insuficiente para a peca ${String(item.nome || "").trim()}.`);
          }

          tx.update(estoqueRef, {
            quantidade: saldoAtual - qtd,
            atualizadoEm: new Date().toISOString()
          });

          const movRef = doc(collection(db, "almoxarifado_movimentacoes_pecas"));
          const numeroSerie = String(item.serie || "").trim().toUpperCase();
          const valorUnit = Number(item.valorUnitario || 0) || 0;
          const total = Number(item.total || 0) || qtd * valorUnit;
          tx.set(movRef, withTenant({
            tipoMov: "SAIDA",
            tipoItem: String(item.tipo || "PECA").trim().toUpperCase(),
            nome: String(item.nome || "").trim().toUpperCase(),
            numeroSerie,
            quantidade: qtd,
            unidade: String(est.unidade || "UN").trim().toUpperCase(),
            dataMov: dataExecucao,
            fornecedor: "",
            observacao: String(item.observacao || "").trim(),
            baseCidade: baseCidadeAtiva,
            baseEstado: baseEstadoAtivo,
            baseChave: baseChaveObra,
            obra,
            equipamento,
            codigoEquipamento: String(equipamentoSelecionado?.codigo || "").trim().toUpperCase(),
            mecanico: mecanico.trim().toUpperCase(),
            valorUnitario: valorUnit,
            total,
            criadoPor: mecanico.trim().toUpperCase(),
            criadoEm: new Date().toISOString()
          }, tenantId));
        }

        // 2) Baixa de oleos no estoque de lubrificantes (entrada diesel/lubrificantes)
        for (const item of oleosNoEstoque) {
          const lubRef = doc(db, "lubrificantes", item.estoqueLubId);
          const lubSnap = await tx.get(lubRef);
          if (!lubSnap.exists()) throw new Error("Oleo nao encontrado no estoque.");
          const lub = lubSnap.data();
          const saldo = Number(lub.quantidade || 0);
          const qtd = Number(item.quantidade || 0);
          if (qtd <= 0) throw new Error("Quantidade invalida para oleo.");
          if (saldo < qtd) throw new Error(`Estoque insuficiente para ${String(item.nome || "").trim()}.`);
          tx.update(lubRef, {
            quantidade: saldo - qtd,
            total: (saldo - qtd) * (Number(lub.preco || 0) || 0)
          });
        }

        // 3) Salva manutencao
        tx.set(manutRef, withTenant(payloadBase, tenantId));
      });
    } catch (err) {
      alert(String(err?.message || err || "Erro ao salvar manutencao/baixar estoque."));
      return;
    }

    const ref = { id: manutRef.id };
    await registrarHistorico({
      modulo: "MANUTENCAO",
      acao: "CRIOU",
      entidade: "MANUTENCAO",
      registroId: ref.id,
      usuario: mecanico.trim(),
      descricao: `Manutenção ${tipoManutencao} registrada para ${equipamento}.`,
      detalhes: { obra, totalItens }
    });
    alert("Manutenção salva com sucesso.");

    setTipoManutencao("PREVENTIVA");
    setEquipamento("");
    setObra("");
    setMecanico("");
    setDataExecucao(new Date().toISOString().split("T")[0]);
    setHorimetroKm("");
    setProblemaRelatado("");
    setServicosExecutados("");
    setProximaManutencao("");
    setObservacao("");
    setItens([]);

    carregarDadosIniciais();
  };

  const listaFiltrada = useMemo(() => {
    return lista.filter((item) => {
      if (filtroEquipamento && item.equipamento !== filtroEquipamento) return false;
      if (filtroObra && item.obra !== filtroObra) return false;
      if (filtroTipo && item.tipoManutencao !== filtroTipo) return false;
      if (filtroDataInicio && String(item.dataExecucao || "") < filtroDataInicio) return false;
      if (filtroDataFim && String(item.dataExecucao || "") > filtroDataFim) return false;
      return true;
    });
  }, [lista, filtroEquipamento, filtroObra, filtroTipo, filtroDataInicio, filtroDataFim]);

  const totaisFiltro = useMemo(() => {
    const total = listaFiltrada.reduce((acc, item) => acc + numero(item.totalManutencao), 0);
    const preventivas = listaFiltrada.filter((item) => item.tipoManutencao === "PREVENTIVA").length;
    const corretivas = listaFiltrada.filter((item) => item.tipoManutencao === "CORRETIVA").length;
    return {
      total,
      registros: listaFiltrada.length,
      preventivas,
      corretivas
    };
  }, [listaFiltrada]);

  const gerarPDF = async () => {
    if (!listaFiltrada.length) {
      alert("Nao ha dados para gerar o PDF.");
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
        console.log("Falha ao carregar a logo no PDF");
      }
    }

    pdf.setFontSize(14);
    pdf.setFont(undefined, "bold");
    pdf.text("RELATORIO DE MANUTENCAO DE EQUIPAMENTOS", larguraPagina / 2, 13, { align: "center" });

    pdf.setFontSize(9);
    pdf.setFont(undefined, "normal");
    pdf.text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`, larguraPagina - margem.right, 18, {
      align: "right"
    });

    const tabela = listaFiltrada.map((item) => {
      const itensTexto = (item.itens || [])
        .map((i) =>
          `${i.tipo}: ${i.nome} | Serie: ${i.serie || "-"} | Qtd: ${numero(i.quantidade).toFixed(2)} | Vlr: ${formatarMoeda(i.total)}`
        )
        .join("\n");

      return [
        formatarDataBR(item.dataExecucao),
        item.tipoManutencao || "-",
        item.equipamento || "-",
        item.codigoEquipamento || "-",
        item.placaEquipamento || "-",
        identificarObra(item.obra),
        primeiroNome(item.mecanico),
        item.horimetroKm || "-",
        item.servicosExecutados || "-",
        itensTexto || "-",
        formatarMoeda(item.totalManutencao)
      ];
    });

    autoTable(pdf, {
      startY: 22,
      theme: "grid",
      tableWidth: larguraUtil,
      head: [[
        "Data",
        "Tipo",
        "Equipamento",
        "Código",
        "Placa",
        "Obra",
        "Mecanico",
        "Horimetro/KM",
        "Servico executado",
        "Itens e pecas trocadas",
        "Total"
      ]],
      body: tabela,
      styles: {
        fontSize: 6.4,
        cellPadding: 1,
        overflow: "linebreak",
        valign: "middle"
      },
      headStyles: {
        fillColor: [11, 94, 215],
        textColor: 255,
        fontStyle: "bold",
        halign: "center"
      },
      alternateRowStyles: { fillColor: [244, 247, 252] },
      columnStyles: {
        0: { cellWidth: 12 },
        1: { cellWidth: 14, halign: "center" },
        2: { cellWidth: 25 },
        3: { cellWidth: 12, halign: "center" },
        4: { cellWidth: 12, halign: "center" },
        5: { cellWidth: 18 },
        6: { cellWidth: 13, halign: "center" },
        7: { cellWidth: 14, halign: "center" },
        8: { cellWidth: 38 },
        9: { cellWidth: 100 },
        10: { cellWidth: 20, halign: "right" }
      },
      margin: { left: margem.left, right: margem.right, bottom: margem.bottom }
    });

    let y = (pdf.lastAutoTable?.finalY || 160) + 4;
    if (y > alturaPagina - 40) {
      pdf.addPage("a4", "landscape");
      y = 14;
    }

    autoTable(pdf, {
      startY: y,
      theme: "grid",
      tableWidth: 170,
      head: [["Resumo", "Valor"]],
      body: [
        ["Total de registros", totaisFiltro.registros],
        ["Preventivas", totaisFiltro.preventivas],
        ["Corretivas", totaisFiltro.corretivas],
        ["Custo total", formatarMoeda(totaisFiltro.total)]
      ],
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [11, 94, 215], textColor: 255, fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 110 }, 1: { cellWidth: 60, halign: "right" } },
      margin: { left: margem.left }
    });

    const totalPaginas = pdf.getNumberOfPages();
    for (let i = 1; i <= totalPaginas; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.text(`Pagina ${i} de ${totalPaginas}`, larguraPagina - margem.right, alturaPagina - 5, {
        align: "right"
      });
    }

    pdf.save("relatorio_manutencao_equipamentos.pdf");
    registrarHistorico({
      modulo: "MANUTENCAO",
      acao: "GEROU_PDF",
      entidade: "RELATORIO_MANUTENCAO",
      registroId: "pdf-manutencao",
      usuario: mecanico || "-",
      descricao: "Gerou PDF de manutencao de equipamentos."
    });
  };

  return (
    <div style={page}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, color: "#10243e" }}>Manutenção Preventiva e Corretiva</h2>
          </div>
        <p style={{ margin: "8px 0 0", color: "#4a5c74" }}>
          Registro completo para mecanico: pecas, oleos, filtros, servicos executados e custo por equipamento.
        </p>
      </div>

      {!modoRelatorio && (
        <div style={card}>
          <h3 style={{ marginTop: 0, color: "#10243e" }}>Alertas de equipamentos (quebra/parada)</h3>
          {!baseChaveAtiva && (
            <div style={{ color: "#6b7c93", fontWeight: 600 }}>
              Selecione a cidade/base ativa para ver os alertas.
            </div>
          )}
          {baseChaveAtiva && !alertasNaBase.length && (
            <div style={{ color: "#198754", fontWeight: "bold" }}>
              Nenhum alerta aberto nesta base.
            </div>
          )}
          {baseChaveAtiva && alertasNaBase.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <div style={{ marginBottom: 8, fontWeight: "bold", color: "#b00000" }}>
                Alertas abertos: {alertasNaBase.length}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 860 }}>
                <thead style={{ background: "#dc3545", color: "#fff" }}>
                  <tr>
                    {["Data", "Obra", "Equipamento", "Operador", "Relato", "Ações"].map((h) => (
                      <th key={h} style={{ padding: 8, border: "1px solid #f0b7b7" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {alertasNaBase.slice(0, 50).map((a, idx) => (
                    <tr key={a.id} style={{ background: idx % 2 === 0 ? "#fff5f5" : "#fff" }}>
                      <td style={{ padding: 8, border: "1px solid #f3d1d1", textAlign: "center" }}>{String(a.data || "-")}</td>
                      <td style={{ padding: 8, border: "1px solid #f3d1d1" }}>{identificarObra(a.obra)}</td>
                      <td style={{ padding: 8, border: "1px solid #f3d1d1" }}>{String(a.equipamento || "-")}</td>
                      <td style={{ padding: 8, border: "1px solid #f3d1d1" }}>{primeiroNome(a.operador)}</td>
                      <td style={{ padding: 8, border: "1px solid #f3d1d1" }}>{String(a.relato || "-")}</td>
                      <td style={{ padding: 8, border: "1px solid #f3d1d1", textAlign: "center", whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          onClick={() => usarAlertaNoCadastro(a)}
                          style={{ ...botaoPrimario, padding: "6px 10px", background: "#0b5ed7", marginRight: 6 }}
                        >
                          Usar
                        </button>
                        <button
                          type="button"
                          onClick={() => resolverAlerta(a.id)}
                          style={{ ...botaoPrimario, padding: "6px 10px", background: "#198754" }}
                        >
                          Resolver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!modoRelatorio && (
      <div style={card}>
        <h3 style={{ marginTop: 0, color: "#10243e" }}>Cadastro de manutencao</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <select style={inputBase} value={tipoManutencao} onChange={(e) => setTipoManutencao(e.target.value)}>
            {TIPOS_MANUTENCAO.map((tipo) => (
              <option key={tipo} value={tipo}>{tipo}</option>
            ))}
          </select>

          <select style={inputBase} value={baseChaveAtiva} onChange={(e) => setBaseChaveAtiva(e.target.value)}>
            <option value="">Cidade base / base ativa</option>
            {basesDisponiveis.map((b) => (
              <option key={b.baseChave} value={b.baseChave}>
                {b.cidade}/{b.estado}
              </option>
            ))}
          </select>

          <select
            style={inputBase}
            value={equipamento}
            onChange={(e) => setEquipamento(e.target.value)}
            disabled={!baseChaveAtiva}
            title={!baseChaveAtiva ? "Selecione a cidade/base primeiro" : ""}
          >
            <option value="">Selecione o equipamento</option>
            {equipamentosNaBase.map((nome) => (
              <option key={nome} value={nome}>{nome}</option>
            ))}
          </select>

          <input style={inputBase} value={mecanico} onChange={(e) => setMecanico(e.target.value)} placeholder="Mecanico responsavel" />
          <input style={inputBase} type="date" value={dataExecucao} onChange={(e) => setDataExecucao(e.target.value)} />
          <input style={inputBase} value={horimetroKm} onChange={(e) => setHorimetroKm(e.target.value)} placeholder="Horimetro / KM" />
          <input style={inputBase} type="date" value={proximaManutencao} onChange={(e) => setProximaManutencao(e.target.value)} />
          <input style={inputBase} value={equipamentoSelecionado?.codigo || ""} readOnly placeholder="Código do equipamento" />
          <input style={inputBase} value={equipamentoSelecionado?.placa || ""} readOnly placeholder="Placa do equipamento" />
          <input style={inputBase} value={equipamentoSelecionado?.proprietario || ""} readOnly placeholder="Empresa requisitante / dono" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
          <textarea
            style={textArea}
            value={problemaRelatado}
            onChange={(e) => setProblemaRelatado(e.target.value)}
            placeholder="Problema relatado"
          />
          <textarea
            style={textArea}
            value={servicosExecutados}
            onChange={(e) => setServicosExecutados(e.target.value)}
            placeholder="Servicos executados"
          />
        </div>

        <div style={{ marginTop: 10 }}>
          <textarea
            style={{ ...textArea, minHeight: 70 }}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Observação geral"
          />
        </div>
      </div>
      )}

      {!modoRelatorio && (
      <div style={card}>
        <h3 style={{ marginTop: 0, color: "#10243e" }}>Itens trocados e custos</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
          <select style={inputBase} value={itemTipo} onChange={(e) => setItemTipo(e.target.value)}>
            {TIPOS_ITEM.map((tipo) => (
              <option key={tipo} value={tipo}>{tipo}</option>
            ))}
          </select>

          {itemTipo === "PECA" ? (
            <select
              style={inputBase}
              value={pecaEstoqueId}
              onChange={(e) => setPecaEstoqueId(e.target.value)}
              title={!obra ? "Selecione uma obra para ver o estoque dessa base." : ""}
            >
              <option value="">
                {baseChaveAtiva ? "Selecione a peca do estoque" : "Selecione a cidade/base primeiro"}
              </option>
              {pecasDisponiveisNaObra.map((p) => {
                const serie = String(p.numeroSerie || p.equipamentoCodigo || "").trim().toUpperCase();
                const saldo = Number(p.quantidade || 0);
                const un = String(p.unidade || "UN").trim().toUpperCase();
                return (
                  <option key={p.id} value={p.id}>
                    {`${String(p.nome || "").trim().toUpperCase()} | ${serie || "-"} | ${saldo} ${un}`}
                  </option>
                );
              })}
            </select>
          ) : itemTipo === "FILTRO" ? (
            <select
              style={inputBase}
              value={pecaEstoqueId}
              onChange={(e) => setPecaEstoqueId(e.target.value)}
              title={!obra ? "Selecione uma obra para ver o estoque dessa base." : ""}
            >
              <option value="">
                {baseChaveAtiva ? "Selecione o filtro do estoque" : "Selecione a cidade/base primeiro"}
              </option>
              {filtrosDisponiveisNaObra.map((p) => {
                const serie = String(p.numeroSerie || p.equipamentoCodigo || "").trim().toUpperCase();
                const saldo = Number(p.quantidade || 0);
                const un = String(p.unidade || "UN").trim().toUpperCase();
                return (
                  <option key={p.id} value={p.id}>
                    {`${String(p.nome || "").trim().toUpperCase()} | ${serie || "-"} | ${saldo} ${un}`}
                  </option>
                );
              })}
            </select>
          ) : itemTipo === "OLEO" ? (
            <select
              style={inputBase}
              value={oleoEstoqueId}
              onChange={(e) => setOleoEstoqueId(e.target.value)}
              title={!obra ? "Selecione uma obra para ver o estoque dessa base." : ""}
            >
              <option value="">
                {baseChaveAtiva ? "Selecione o oleo do estoque" : "Selecione a cidade/base primeiro"}
              </option>
              {oleosDisponiveisNaObra.map((o) => {
                const saldo = Number(o.quantidade || 0);
                const un = String(o.unidade || "L").trim().toUpperCase();
                return (
                  <option key={o.id} value={o.id}>
                    {`${String(o.nome || "").trim().toUpperCase()} | ${saldo} ${un}`}
                  </option>
                );
              })}
            </select>
          ) : (
            <input style={inputBase} value={itemNome} onChange={(e) => setItemNome(e.target.value)} placeholder="Nome da peca/item" />
          )}

          <input
            style={{ ...inputBase, background: itemTipo === "PECA" ? "#f3f5f8" : "#fff" }}
            value={itemSerie}
            onChange={(e) => setItemSerie(e.target.value)}
            placeholder="Serie / numero do item"
            disabled={itemTipo === "PECA" || itemTipo === "FILTRO" || itemTipo === "OLEO"}
          />

          <input style={inputBase} value={itemQuantidade} onChange={(e) => setItemQuantidade(e.target.value)} placeholder="Quantidade" />

          <input
            style={{ ...inputBase, background: (itemTipo === "PECA" || itemTipo === "FILTRO" || itemTipo === "OLEO") ? "#f3f5f8" : "#fff" }}
            value={itemValorUnitario}
            onChange={(e) => setItemValorUnitario(e.target.value)}
            placeholder="Valor unitario"
            disabled={itemTipo === "PECA" || itemTipo === "FILTRO" || itemTipo === "OLEO"}
          />

          <input style={inputBase} value={itemObservacao} onChange={(e) => setItemObservacao(e.target.value)} placeholder="Observação do item" />
        </div>

        {(itemTipo === "PECA" && pecaSelecionada) && (
          <div style={{ marginTop: 8, color: "#1b3e8a", fontWeight: "bold" }}>
            Saldo no estoque: {Number(pecaSelecionada.quantidade || 0)} {String(pecaSelecionada.unidade || "UN").toUpperCase()}
            {Number(pecaSelecionada.precoUnitario || 0) ? ` | Unit: ${formatarMoeda(pecaSelecionada.precoUnitario)}` : ""}
          </div>
        )}
        {(itemTipo === "FILTRO" && filtroSelecionado) && (
          <div style={{ marginTop: 8, color: "#1b3e8a", fontWeight: "bold" }}>
            Saldo no estoque: {Number(filtroSelecionado.quantidade || 0)} {String(filtroSelecionado.unidade || "UN").toUpperCase()}
            {Number(filtroSelecionado.precoUnitario || 0) ? ` | Unit: ${formatarMoeda(filtroSelecionado.precoUnitario)}` : ""}
          </div>
        )}
        {(itemTipo === "OLEO" && oleoSelecionado) && (
          <div style={{ marginTop: 8, color: "#1b3e8a", fontWeight: "bold" }}>
            Saldo no estoque: {Number(oleoSelecionado.quantidade || 0)} {String(oleoSelecionado.unidade || "L").toUpperCase()}
            {Number(oleoSelecionado.preco || 0) ? ` | Unit: ${formatarMoeda(oleoSelecionado.preco)}` : ""}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button style={botaoPrimario} onClick={adicionarItem}>Adicionar item</button>
          <div style={{ ...botaoSecundario, cursor: "default" }}>
            Total parcial: {formatarMoeda(totalItens)}
          </div>
        </div>

        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 11 }}>
            <thead style={{ background: "#0b5ed7", color: "#fff" }}>
              <tr>
                {["Tipo", "Item", "Serie", "Qtd", "Vlr unit", "Total", "Obs", "Acao"].map((titulo) => (
                  <th key={titulo} style={{ padding: "7px 6px", textAlign: "center" }}>{titulo}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {itens.map((item, idx) => (
                <tr key={`${item.nome}-${idx}`} style={{ background: idx % 2 === 0 ? "#f8fbff" : "#fff" }}>
                  <td style={{ padding: 6, textAlign: "center" }}>{item.tipo}</td>
                  <td style={{ padding: 6, textAlign: "center", wordBreak: "break-word" }}>{item.nome}</td>
                  <td style={{ padding: 6, textAlign: "center" }}>{item.serie || "-"}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{numero(item.quantidade).toFixed(2)}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{formatarMoeda(item.valorUnitario)}</td>
                  <td style={{ padding: 6, textAlign: "right", fontWeight: "bold" }}>{formatarMoeda(item.total)}</td>
                  <td style={{ padding: 6, textAlign: "center", wordBreak: "break-word" }}>{item.observacao || "-"}</td>
                  <td style={{ padding: 6, textAlign: "center" }}>
                    <button style={{ ...botaoSecundario, padding: "6px 10px" }} onClick={() => removerItem(idx)}>
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
              {!itens.length && (
                <tr>
                  <td colSpan={8} style={{ padding: 10, textAlign: "center", color: "#6c757d" }}>
                    Nenhum item adicionado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <button style={botaoPrimario} onClick={salvarManutencao}>Salvar manutencao</button>
          <button style={botaoSecundario} onClick={() => setItens([])}>Limpar itens</button>
        </div>
      </div>
      )}

      <div style={card}>
        <h3 style={{ marginTop: 0, color: "#10243e" }}>Relatório de manutencao por equipamento</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 10 }}>
          <select style={inputBase} value={filtroEquipamento} onChange={(e) => setFiltroEquipamento(e.target.value)}>
            <option value="">Todos os equipamentos</option>
            {equipamentos.map((eq) => (
              <option key={eq.id || eq.nome} value={eq.nome}>{eq.nome}</option>
            ))}
          </select>
          <select style={inputBase} value={filtroObra} onChange={(e) => setFiltroObra(e.target.value)}>
            <option value="">Todas as obras</option>
            {obras.map((o) => (
              <option key={o.id || o.nome} value={o.nome}>{identificarObra(o.nome)}</option>
            ))}
          </select>
          <select style={inputBase} value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
            <option value="">Todos os tipos</option>
            {TIPOS_MANUTENCAO.map((tipo) => (
              <option key={tipo} value={tipo}>{tipo}</option>
            ))}
          </select>
          <input style={inputBase} type="date" value={filtroDataInicio} onChange={(e) => setFiltroDataInicio(e.target.value)} />
          <input style={inputBase} type="date" value={filtroDataFim} onChange={(e) => setFiltroDataFim(e.target.value)} />
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          {modoRelatorio && <button style={botaoPrimario} onClick={gerarPDF}>Gerar PDF</button>}
          <button
            style={botaoSecundario}
            onClick={() => {
              setFiltroEquipamento("");
              setFiltroObra("");
              setFiltroTipo("");
              setFiltroDataInicio("");
              setFiltroDataFim("");
            }}
          >
            Limpar filtros
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 10 }}>
          <div style={{ ...botaoSecundario, cursor: "default" }}>Registros: {totaisFiltro.registros}</div>
          <div style={{ ...botaoSecundario, cursor: "default" }}>Preventivas: {totaisFiltro.preventivas}</div>
          <div style={{ ...botaoSecundario, cursor: "default" }}>Corretivas: {totaisFiltro.corretivas}</div>
          <div style={{ ...botaoSecundario, cursor: "default" }}>Custo: {formatarMoeda(totaisFiltro.total)}</div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 11 }}>
            <thead style={{ background: "#0b5ed7", color: "#fff" }}>
              <tr>
                {["Data", "Tipo", "Equipamento", "Código", "Placa", "Obra", "Mecanico", "Total", "Itens trocados"].map((titulo) => (
                  <th key={titulo} style={{ padding: "7px 6px", textAlign: "center" }}>{titulo}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listaFiltrada.map((item, idx) => (
                <tr key={item.id} style={{ background: idx % 2 === 0 ? "#f8fbff" : "#fff" }}>
                  <td style={{ padding: 6, textAlign: "center" }}>{formatarDataBR(item.dataExecucao)}</td>
                  <td style={{ padding: 6, textAlign: "center" }}>{item.tipoManutencao || "-"}</td>
                  <td style={{ padding: 6, textAlign: "center", wordBreak: "break-word" }}>{item.equipamento || "-"}</td>
                  <td style={{ padding: 6, textAlign: "center" }}>{item.codigoEquipamento || "-"}</td>
                  <td style={{ padding: 6, textAlign: "center" }}>{item.placaEquipamento || "-"}</td>
                  <td style={{ padding: 6, textAlign: "center", wordBreak: "break-word" }}>{identificarObra(item.obra)}</td>
                  <td style={{ padding: 6, textAlign: "center" }}>{primeiroNome(item.mecanico)}</td>
                  <td style={{ padding: 6, textAlign: "right", fontWeight: "bold" }}>{formatarMoeda(item.totalManutencao)}</td>
                  <td style={{ padding: 6, textAlign: "left", wordBreak: "break-word" }}>
                    {(item.itens || []).map((i) => `${i.tipo}: ${i.nome}`).join(" | ") || "-"}
                  </td>
                </tr>
              ))}
              {!listaFiltrada.length && (
                <tr>
                  <td colSpan={9} style={{ padding: 10, textAlign: "center", color: "#6c757d" }}>
                    Nenhuma manutencao encontrada.
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

export default Manutencao;


