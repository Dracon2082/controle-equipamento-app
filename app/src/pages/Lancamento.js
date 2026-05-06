/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState } from "react";
import { db } from "../firebase";
import { addDoc, collection, deleteDoc, doc, getDocs, updateDoc } from "firebase/firestore";
import { registrarHistorico } from "../utils/historico";
import { belongsToTenant, getTenantId, withTenant } from "../utils/tenant";

const SERVICOS_POR_EQUIPAMENTO = [
  {
    chaves: ["RECAPEADEIRA", "VIBROACABADORA", "PAVIMENTADORA"],
    servicos: [
      "APLICACAO DE CBUQ",
      "RECAPEAMENTO ASFALTICO",
      "ESPALHAMENTO DE MASSA ASFALTICA",
      "REGULARIZACAO DE CAMADA ASFALTICA"
    ]
  },
  {
    chaves: ["COMPACTADOR", "ROLO", "VIBRO", "PE DE CARNEIRO"],
    servicos: [
      "COMPACTACAO DE SOLO",
      "COMPACTACAO DE BASE",
      "COMPACTACAO DE ASFALTO",
      "ACABAMENTO DE COMPACTACAO"
    ]
  },
  {
    chaves: ["RETROESCAVADEIRA"],
    servicos: [
      "ESCAVACAO DE VALA",
      "REMOCAO DE MATERIAL",
      "CARGA DE MATERIAL",
      "LIMPEZA DE AREA"
    ]
  },
  {
    chaves: ["ESCAVADEIRA"],
    servicos: [
      "ESCAVACAO PROFUNDA",
      "ESCAVACAO DE BUEIRO",
      "CARGA DE SOLO",
      "DESMONTE DE MATERIAL"
    ]
  },
  {
    chaves: ["PA CARREGADEIRA", "PA-CARREGADEIRA", "PA CARREGADEIRA", "MINI CARREGADEIRA"],
    servicos: [
      "CARGA DE MATERIAL",
      "ESPALHAMENTO DE MATERIAL",
      "LIMPEZA DE FRENTE DE OBRA",
      "MOVIMENTACAO INTERNA DE MATERIAL"
    ]
  },
  {
    chaves: ["MOTONIVELADORA", "PATROL"],
    servicos: [
      "REGULARIZACAO DE SUBLEITO",
      "NIVELAMENTO DE VIA",
      "ACABAMENTO DE BASE",
      "ABERTURA DE LEITO"
    ]
  },
  {
    chaves: ["CAMINHAO BASCULANTE", "BASCULANTE", "CACAMBA"],
    servicos: [
      "TRANSPORTE DE MATERIAL",
      "DESCARGA DE MATERIAL",
      "APOIO A ESCAVACAO",
      "RETIRADA DE ENTULHO"
    ]
  }
];

const SERVICOS_GERAIS = [
  "A DISPOSICAO",
  "DESLOCAMENTO",
  "APOIO OPERACIONAL",
  "LIMPEZA DE AREA",
  "SERVICO INTERNO"
];

function Lancamento({ setTela }) {
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
  const hojeBR = () => new Date().toLocaleDateString("pt-BR");

  const formatarDataBR = (valor) => {
    const numeros = String(valor || "").replace(/\D/g, "").slice(0, 8);
    if (numeros.length <= 2) return numeros;
    if (numeros.length <= 4) return `${numeros.slice(0, 2)}/${numeros.slice(2)}`;
    return `${numeros.slice(0, 2)}/${numeros.slice(2, 4)}/${numeros.slice(4)}`;
  };

  const brParaISO = (valorBR) => {
    const m = String(valorBR || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return "";
    return `${m[3]}-${m[2]}-${m[1]}`;
  };

  const isoParaBR = (valorISO) => {
    const m = String(valorISO || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return "";
    return `${m[3]}/${m[2]}/${m[1]}`;
  };

  const dataValidaBR = (valor) => {
    const match = String(valor || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return false;
    const dia = Number(match[1]);
    const mes = Number(match[2]);
    const ano = Number(match[3]);
    const dt = new Date(ano, mes - 1, dia);
    return dt.getFullYear() === ano && dt.getMonth() === mes - 1 && dt.getDate() === dia;
  };

  const parseNumero = (valor) => {
    const txt = String(valor || "").trim().replace(",", ".");
    const n = Number(txt);
    return Number.isFinite(n) ? n : 0;
  };

  const parseHoraMinutos = (valor) => {
    const txt = String(valor || "").trim();
    const match = txt.match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return h * 60 + m;
  };

  const calcularHorasTurno = (inicio, fim) => {
    const iniMin = parseHoraMinutos(inicio);
    const fimMin = parseHoraMinutos(fim);
    if (iniMin == null || fimMin == null) return 0;
    let diff = fimMin - iniMin;
    // Se o turno passou da meia-noite
    if (diff < 0) diff += 24 * 60;
    return Number((diff / 60).toFixed(2));
  };

  const parseDataRegistro = (item) => {
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

  // Para regras de sequencia/â€œdia faltandoâ€, precisamos usar a DATA DO LANCAMENTO,
  // nao a data de criacao/atualizacao (o usuario pode lanÃ§ar retroativo).
  const parseDataOperacao = (item) => {
    const texto = String(item?.data || "").trim();
    const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
    const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return new Date(0);
  };

  const formatarDataVisual = (valor) => {
    const txt = String(valor || "");
    const iso = txt.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    return txt;
  };

  const [obra, setObra] = useState("");
  const [equipamento, setEquipamento] = useState("");
  const [operador, setOperador] = useState("");
  const [horimetroInicial, setHorimetroInicial] = useState("");
  const [horimetroFinal, setHorimetroFinal] = useState("");
  const [horimetroQuebrado, setHorimetroQuebrado] = useState(false);
  const [horaInicioTurno, setHoraInicioTurno] = useState("07:00");
  const [horaFimTurno, setHoraFimTurno] = useState("");
  const [horas, setHoras] = useState(0);
  const [status, setStatus] = useState("");
  const [descricao, setDescricao] = useState("");
  const [servicoSugerido, setServicoSugerido] = useState("");
  const [data, setData] = useState(hojeBR());
  const [equipamentoQuebrou, setEquipamentoQuebrou] = useState(false);

  // Abastecimento excepcional (quando acabou o diesel da base e o equipamento abastece no posto).
  // Nao entra no estoque do sistema, mas precisa aparecer no relatorio mensal do equipamento.
  const [abasteceuPosto, setAbasteceuPosto] = useState(false);
  const [postoLitros, setPostoLitros] = useState("");
  const [postoNotaFiscal, setPostoNotaFiscal] = useState("");

  const [obras, setObras] = useState([]);
  const [obrasDetalhes, setObrasDetalhes] = useState([]);
  const [equipamentos, setEquipamentos] = useState([]);
  const [operadores, setOperadores] = useState([]);
  const [ultimoLancamentoEquip, setUltimoLancamentoEquip] = useState(null);

  const [registros, setRegistros] = useState([]);
  const [editandoId, setEditandoId] = useState("");
  const [mostrarRegistros, setMostrarRegistros] = useState(() => !isMobile);

  const [relatoQuebra, setRelatoQuebra] = useState("");
  const [enviandoAlerta, setEnviandoAlerta] = useState(false);

  const servicosSugeridos = (() => {
    const nome = String(equipamento || "").toUpperCase();
    const grupo = SERVICOS_POR_EQUIPAMENTO.find((item) => item.chaves.some((ch) => nome.includes(ch)));
    return grupo ? grupo.servicos : SERVICOS_GERAIS;
  })();

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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    buscarDados();
  }, []);

  const identificarNumeroObra = (obraTexto) => {
    const texto = String(obraTexto || "").trim();
    if (!texto) return "-";
    const matchNumero = texto.match(/\d{3}/);
    if (matchNumero) return matchNumero[0];
    return texto.replace(/\s+/g, " ").trim().toUpperCase().slice(0, 8);
  };

  useEffect(() => {
    if (horimetroQuebrado) {
      const iniTxt = String(horaInicioTurno || "").trim();
      const fimTxt = String(horaFimTurno || "").trim();
      setHoras(iniTxt && fimTxt ? calcularHorasTurno(iniTxt, fimTxt) : 0);
      return;
    }
    const ini = parseNumero(horimetroInicial);
    const fimTxt = String(horimetroFinal || "").trim();
    const fim = parseNumero(fimTxt);
    setHoras(fimTxt && fim > ini ? Number((fim - ini).toFixed(2)) : 0);
  }, [horimetroInicial, horimetroFinal, horimetroQuebrado, horaInicioTurno, horaFimTurno]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    buscarUltimoLancamento(equipamento);
  }, [equipamento]);

  const buscarDados = async () => {
    const snapObras = await getDocs(collection(db, "obras"));
    const listaObrasDados = snapObras.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId))
      .filter(basePermitida)
      .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));

    const listaObras = listaObrasDados
      .map((item) => item.nome)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    setObras(listaObras);
    setObrasDetalhes(listaObrasDados);

    const snapEquip = await getDocs(collection(db, "equipamentos"));
    const listaEquip = snapEquip.docs
      .map((d) => d.data())
      .filter((item) => belongsToTenant(item, tenantId))
      .map((item) => item.nome)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    setEquipamentos(listaEquip);

    const snapOp = await getDocs(collection(db, "funcionarios"));
    const listaOps = snapOp.docs
      .map((d) => d.data())
      .filter((item) => belongsToTenant(item, tenantId))
      .map((item) => item.nome)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    setOperadores(listaOps);

    await carregarLancamentos();
  };

  const carregarLancamentos = async () => {
    const snap = await getDocs(collection(db, "lancamentos"));
    const lista = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId))
      .sort((a, b) => parseDataRegistro(b) - parseDataRegistro(a));
    setRegistros(lista);
  };

  const buscarUltimoLancamento = async (equipamentoSelecionado) => {
    if (!equipamentoSelecionado) {
      setUltimoLancamentoEquip(null);
      return null;
    }
    const snap = await getDocs(collection(db, "lancamentos"));
    const lista = snap.docs
      .map((d) => d.data())
      .filter((i) => belongsToTenant(i, tenantId))
      .filter((i) => String(i.equipamento || "").toUpperCase().trim() === String(equipamentoSelecionado || "").toUpperCase().trim());
    if (!lista.length) {
      setUltimoLancamentoEquip(null);
      return null;
    }
    lista.sort((a, b) => parseDataRegistro(b) - parseDataRegistro(a));
    const fechado = lista.find((i) => String(i.horimetroFinal || "").trim() !== "");
    const alvo = fechado || lista[0];
    setUltimoLancamentoEquip(alvo);
    return alvo;
  };

  const buscarUltimoLancamentoFechado = async (equipamentoSelecionado) => {
    if (!equipamentoSelecionado) return null;
    const snap = await getDocs(collection(db, "lancamentos"));
    const lista = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((i) => belongsToTenant(i, tenantId))
      .filter((i) =>
        String(i.equipamento || "").toUpperCase().trim() ===
        String(equipamentoSelecionado || "").toUpperCase().trim()
      )
      .filter((i) => String(i.horimetroFinal || "").trim() !== "");

    if (!lista.length) return null;
    lista.sort((a, b) => parseDataOperacao(b) - parseDataOperacao(a));
    return lista[0];
  };

  const statusSemOperacao = (valor) => String(valor || "").trim().toUpperCase().startsWith("SEM OPERACAO");

  useEffect(() => {
    // Quando marcar como SEM OPERACAO, padroniza a descricao automaticamente.
    if (!statusSemOperacao(status)) return;
    if (String(descricao || "").trim().toUpperCase() !== "SEM OPERACAO") {
      setDescricao("SEM OPERACAO");
      setServicoSugerido("");
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const buscarLancamentoPorEquipamentoData = async (equipamentoSelecionado, dataBR) => {
    if (!equipamentoSelecionado || !dataValidaBR(dataBR)) return null;
    const equipKey = String(equipamentoSelecionado || "").toUpperCase().trim();
    const dataKey = formatarDataBR(dataBR);

    const local = (registros || []).find((r) => {
      const rEquip = String(r.equipamento || "").toUpperCase().trim();
      const rData = formatarDataBR(formatarDataVisual(r.data));
      return rEquip === equipKey && rData === dataKey;
    });
    if (local) return local;

    // Garantia extra (caso o estado local nao esteja atualizado).
    const snap = await getDocs(collection(db, "lancamentos"));
    const lista = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((i) => belongsToTenant(i, tenantId))
      .filter((i) => String(i.equipamento || "").toUpperCase().trim() === equipKey)
      .filter((i) => formatarDataBR(formatarDataVisual(i.data)) === dataKey);
    return lista[0] || null;
  };

  const registrarSemOperacaoAutomatico = async ({ dataBR, obraValor, equipamentoValor, operadorValor, horimetroBase }) => {
    if (!dataValidaBR(dataBR)) return { ok: false, motivo: "Data invalida." };
    if (!obraValor || !equipamentoValor || !operadorValor) return { ok: false, motivo: "Preencha obra, equipamento e operador." };
    const existente = await buscarLancamentoPorEquipamentoData(equipamentoValor, dataBR);
    if (existente) return { ok: false, motivo: "Ja existe lancamento nesta data." };

    const agoraIso = new Date().toISOString();
    const payload = withTenant({
      data: dataBR,
      obra: obraValor,
      equipamento: equipamentoValor,
      operador: operadorValor,
      horimetroQuebrado: false,
      horaInicioTurno: "",
      horaFimTurno: "",
      horimetroInicial: String(horimetroBase || "").replace(",", "."),
      horimetroFinal: String(horimetroBase || "").replace(",", "."),
      horas: 0,
      status: "SEM OPERACAO - DOMINGO",
      descricao: "SEM OPERACAO"
    }, tenantId);

    const ref = await addDoc(collection(db, "lancamentos"), { ...payload, dataCriacao: agoraIso });
    await registrarHistorico({
      modulo: "LANCAMENTO",
      acao: "CRIOU",
      entidade: "LANCAMENTO_DIARIO",
      registroId: ref.id,
      usuario: operadorValor,
      descricao: `Criou lancamento SEM OPERACAO (domingo) de ${equipamentoValor} na data ${dataBR}.`,
      detalhes: { obra: obraValor, equipamento: equipamentoValor, status: payload.status }
    });
    return { ok: true, id: ref.id };
  };

  const registroAbertoHoje = (() => {
    if (!equipamento || !dataValidaBR(data)) return null;
    const equipKey = String(equipamento || "").toUpperCase().trim();
    const dataKey = formatarDataBR(data);
    return (
      registros.find((r) => {
        const rEquip = String(r.equipamento || "").toUpperCase().trim();
        const rData = formatarDataBR(formatarDataVisual(r.data));
        const rQuebrado = Boolean(r.horimetroQuebrado);
        const rFinal = rQuebrado ? String(r.horaFimTurno || "").trim() : String(r.horimetroFinal || "").trim();
        return rEquip === equipKey && rData === dataKey && rFinal === "";
      }) || null
    );
  })();

  const modoFinalizarDia = Boolean(registroAbertoHoje && !editandoId);

  useEffect(() => {
    // Quando existe um lancamento aberto para este equipamento/data,
    // preenche os campos automaticamente para o usuario apenas FINALIZAR o dia.
    if (!modoFinalizarDia) return;

    const r = registroAbertoHoje;
    if (!r) return;

    setObra(r.obra || "");
    setOperador(r.operador || "");
    setStatus(r.status || "");
    setDescricao(r.descricao || "");
    setServicoSugerido(r.descricao || "");
    setHorimetroInicial(String(r.horimetroInicial || ""));
    setHorimetroQuebrado(Boolean(r.horimetroQuebrado));
    setHoraInicioTurno(String(r.horaInicioTurno || "07:00"));
    setHoraFimTurno(String(r.horaFimTurno || ""));
  }, [modoFinalizarDia, registroAbertoHoje]);

  const limparFormulario = () => {
    setObra("");
    setEquipamento("");
    setOperador("");
    setHorimetroInicial("");
    setHorimetroFinal("");
    setHorimetroQuebrado(false);
    setHoraInicioTurno("07:00");
    setHoraFimTurno("");
    setHoras(0);
    setStatus("");
    setDescricao("");
    setServicoSugerido("");
    setRelatoQuebra("");
    setEquipamentoQuebrou(false);
    setAbasteceuPosto(false);
    setPostoLitros("");
    setPostoNotaFiscal("");
    setData(hojeBR());
    setEditandoId("");
  };

  const editarRegistro = async (registro) => {
    setEditandoId(registro.id);
    setData(formatarDataBR(formatarDataVisual(registro.data)));
    setObra(registro.obra || "");
    setEquipamento(registro.equipamento || "");
    setOperador(registro.operador || "");
    setHorimetroInicial(String(registro.horimetroInicial || ""));
    setHorimetroFinal(String(registro.horimetroFinal || ""));
    setHorimetroQuebrado(Boolean(registro.horimetroQuebrado));
    setHoraInicioTurno(String(registro.horaInicioTurno || "07:00"));
    setHoraFimTurno(String(registro.horaFimTurno || ""));
    setStatus(registro.status || "");
    setDescricao(registro.descricao || "");
    setServicoSugerido(registro.descricao || "");
    setRelatoQuebra("");
    setEquipamentoQuebrou(false);
    setAbasteceuPosto(Boolean(registro.postoAbasteceu));
    setPostoLitros(String(registro.postoLitros ?? ""));
    setPostoNotaFiscal(String(registro.postoNotaFiscal ?? ""));
    await buscarUltimoLancamento(registro.equipamento || "");
  };

  const excluirRegistro = async (id) => {
    if (!window.confirm("Deseja excluir este lancamento?")) return;
    const alvo = registros.find((r) => r.id === id);
    await deleteDoc(doc(db, "lancamentos", id));
    await registrarHistorico({
      modulo: "LANCAMENTO",
      acao: "EXCLUIU",
      entidade: "LANCAMENTO_DIARIO",
      registroId: id,
      usuario: alvo?.operador || operador,
      descricao: `Excluiu lancamento de ${alvo?.equipamento || "-"} em ${alvo?.data || "-"}.`
    });
    if (editandoId === id) limparFormulario();
    await carregarLancamentos();
  };

  const enviarAlertaQuebra = async () => {
    if (enviandoAlerta) return;
    const operadorLogado = String(operador || "").trim();
    if (!dataValidaBR(data)) return alert("Data invalida! Use dd/mm/aaaa.");
    if (!obra || !equipamento || !operadorLogado) return alert("Preencha obra, equipamento e operador.");
    const texto = String(relatoQuebra || "").trim();
    if (!texto) return alert("Descreva o que quebrou (ex.: estourou mangueira, travou, etc.).");

    const obraInfo = obrasDetalhes.find((o) => String(o?.nome || "").trim() === String(obra || "").trim());
    const obraCidade = obraInfo?.cidade || "";
    const obraEstado = obraInfo?.estado || "";
    const baseChave = `${String(obraCidade || "").trim().toUpperCase()}__${String(obraEstado || "").trim().toUpperCase()}`;

    setEnviandoAlerta(true);
    try {
      const agoraIso = new Date().toISOString();
      const ref = await addDoc(collection(db, "alertas_manutencao"), withTenant({
        tipo: "EQUIPAMENTO_QUEBROU",
        status: "ABERTO",
        data,
        dataHora: new Date().toLocaleString("pt-BR"),
        criadoEm: agoraIso,
        baseChave,
        obra,
        obraCidade,
        obraEstado,
        equipamento,
        operador: operadorLogado,
        relato: texto
      }, tenantId));

      await registrarHistorico({
        modulo: "ALERTAS",
        acao: "CRIOU",
        entidade: "ALERTA_MANUTENCAO",
        registroId: ref.id,
        usuario: operadorLogado,
        descricao: `Enviou alerta de quebra: ${equipamento} (${identificarNumeroObra(obra)})`,
        detalhes: { obra, equipamento, baseChave }
      });

      alert("Alerta enviado para manutencao/admin.");
      setRelatoQuebra("");
    } finally {
      setEnviandoAlerta(false);
    }
  };

  const salvar = async () => {
    if (!dataValidaBR(data)) return alert("Data invalida! Use dd/mm/aaaa.");

    // Se estiver finalizando um registro aberto, nao obrigar o usuario a preencher tudo novamente.
    const baseRegistro = modoFinalizarDia ? registroAbertoHoje : null;
    const obraEfetiva = baseRegistro?.obra || obra;
    const operadorEfetivo = baseRegistro?.operador || operador;
    const statusEfetivo = baseRegistro?.status || status;
      const semOperacao = statusSemOperacao(statusEfetivo);
      const descricaoEfetiva = semOperacao ? "SEM OPERACAO" : (baseRegistro?.descricao || descricao);
      const horimetroQuebradoEfetivo = Boolean(baseRegistro?.horimetroQuebrado ?? horimetroQuebrado);
      const horimetroInicialEfetivo = String(baseRegistro?.horimetroInicial ?? horimetroInicial ?? "").trim();
      const horaInicioEfetiva = String(baseRegistro?.horaInicioTurno ?? horaInicioTurno ?? "").trim();

      // Abastecimento excepcional em posto (fora do estoque do sistema).
      const postoAbasteceuEfetivo = Boolean(baseRegistro?.postoAbasteceu ?? abasteceuPosto);
      const postoLitrosEfetivoTxt = String(baseRegistro?.postoLitros ?? postoLitros ?? "").trim();
      const postoNotaFiscalEfetiva = String(baseRegistro?.postoNotaFiscal ?? postoNotaFiscal ?? "").trim();
      const postoLitrosEfetivoNum = postoAbasteceuEfetivo ? parseNumero(postoLitrosEfetivoTxt) : 0;

      if (!obraEfetiva || !equipamento || !operadorEfetivo) return alert("Preencha obra, equipamento e operador.");
      if (!statusEfetivo) return alert("Selecione o status.");

      if (!modoFinalizarDia && postoAbasteceuEfetivo) {
        if (postoLitrosEfetivoNum <= 0) return alert("Abastecimento em posto: informe os litros (ex.: 80).");
      }

      const fimHorimetroInformado = semOperacao ? true : (String(horimetroFinal || "").trim() !== "");
      const fimHoraInformado = semOperacao ? true : (String(horaFimTurno || "").trim() !== "");

    if (horimetroQuebradoEfetivo) {
      if (!horaInicioEfetiva) return alert("Horimetro quebrado: informe a hora inicio do turno.");
      if (modoFinalizarDia && !fimHoraInformado) return alert("Informe a hora fim para finalizar o dia.");
    } else {
      const ini = parseNumero(horimetroInicialEfetivo);
      const fim = semOperacao ? ini : parseNumero(horimetroFinal);
      if (!horimetroInicialEfetivo) return alert("Informe o horimetro inicial.");
      if (fimHorimetroInformado && fim < ini) return alert("Horimetro final nao pode ser menor que o inicial.");
      if (modoFinalizarDia && !fimHorimetroInformado) return alert("Informe o horimetro final para finalizar o dia.");
    }

    // Se houver buraco de datas (ex.: domingo sem lancamento), obriga registrar SEM OPERACAO antes de criar novo dia.
    if (!editandoId && !modoFinalizarDia && !semOperacao) {
      const ultimoFechado = await buscarUltimoLancamentoFechado(equipamento);
      if (ultimoFechado?.data) {
        const dtUlt = parseDataOperacao(ultimoFechado);
        const br = String(data || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        const dtAtual = br ? new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1])) : null;
        if (dtAtual && dtUlt && dtUlt.getTime() > 0) {
          const prox = new Date(dtUlt.getFullYear(), dtUlt.getMonth(), dtUlt.getDate() + 1);
          // Se a data escolhida estiver pulando pelo menos 1 dia.
          if (dtAtual.getTime() > prox.getTime()) {
            const dd = String(prox.getDate()).padStart(2, "0");
            const mm = String(prox.getMonth() + 1).padStart(2, "0");
            const aa = String(prox.getFullYear());
            const dataFaltante = `${dd}/${mm}/${aa}`;
            const isDomingo = prox.getDay() === 0;
            if (isDomingo) {
              const confirmar = window.confirm(
                `Falta registrar o domingo ${dataFaltante} para este equipamento.\n\n` +
                `Quer registrar automaticamente como SEM OPERACAO (horimetro final = inicial, horas = 0)?`
              );
              if (confirmar) {
                const esperado = String(ultimoFechado.horimetroFinal || "").trim();
                const res = await registrarSemOperacaoAutomatico({
                  dataBR: dataFaltante,
                  obraValor: obraEfetiva,
                  equipamentoValor: equipamento,
                  operadorValor: operadorEfetivo,
                  horimetroBase: esperado || horimetroInicialEfetivo
                });
                if (res.ok) {
                  alert(`Domingo ${dataFaltante} registrado como SEM OPERACAO. Agora clique em SALVAR novamente para lancar ${formatarDataBR(data)}.`);
                  await carregarLancamentos();
                  return;
                }
                return alert(`Nao foi possivel registrar automaticamente: ${res.motivo || "erro"}`);
              }
            }
            return alert(
              `Existe um dia sem lancamento para este equipamento: ${dataFaltante}.\n` +
              `Antes de lancar ${formatarDataBR(data)}, registre esse dia como SEM OPERACAO.`
            );
          }
        }
      }
    }

    // Validacao de sequencia: sempre contra o ultimo lancamento FECHADO (com final preenchido).
    if (!modoFinalizarDia && !horimetroQuebradoEfetivo) {
      const iniSeq = parseNumero(horimetroInicialEfetivo);
      const ultimoFechado = await buscarUltimoLancamentoFechado(equipamento);
      if (!editandoId && ultimoFechado && String(ultimoFechado.horimetroFinal || "") !== "") {
        const esperado = parseNumero(ultimoFechado.horimetroFinal);
        if (Math.abs(iniSeq - esperado) > 0.0001) {
          return alert(
            `Horimetro inicial fora da sequencia!\n` +
            `Ultimo final de ${equipamento}: ${esperado}\n` +
            `Use ${esperado} como inicial para continuar.`
          );
        }
      }
    }

    // Mantem o card de ultimo lancamento do equipamento atualizado.
    await buscarUltimoLancamento(equipamento);

    const iniNum = parseNumero(horimetroInicialEfetivo);
    const fimNum = semOperacao ? iniNum : parseNumero(horimetroFinal);
    const horasEfetivas = horimetroQuebradoEfetivo
      ? (semOperacao ? 0 : (fimHoraInformado ? calcularHorasTurno(horaInicioEfetiva, String(horaFimTurno || "").trim()) : 0))
      : (semOperacao ? 0 : (fimHorimetroInformado ? Number((fimNum - iniNum).toFixed(2)) : 0));

      const payloadBase = withTenant({
        data,
        obra: obraEfetiva,
        equipamento,
        operador: operadorEfetivo,
      horimetroQuebrado: Boolean(horimetroQuebradoEfetivo),
      horaInicioTurno: horimetroQuebradoEfetivo ? horaInicioEfetiva : "",
      horaFimTurno: horimetroQuebradoEfetivo
        ? (semOperacao ? horaInicioEfetiva : (fimHoraInformado ? String(horaFimTurno || "").trim() : ""))
        : "",
      horimetroInicial: horimetroQuebradoEfetivo ? "" : String(horimetroInicialEfetivo).replace(",", "."),
      horimetroFinal: horimetroQuebradoEfetivo
        ? ""
        : (semOperacao ? String(horimetroInicialEfetivo).replace(",", ".") : (fimHorimetroInformado ? String(horimetroFinal).replace(",", ".") : "")),
        horas: horasEfetivas,
        status: statusEfetivo,
        descricao: String(descricaoEfetiva || "").trim(),
        postoAbasteceu: Boolean(postoAbasteceuEfetivo),
        postoLitros: postoAbasteceuEfetivo ? postoLitrosEfetivoNum : 0,
        postoNotaFiscal: postoAbasteceuEfetivo ? postoNotaFiscalEfetiva : "",
      }, tenantId);

    const agoraIso = new Date().toISOString();

    // Se existe registro "aberto" (mesmo equipamento + mesma data sem final) e nao esta editando,
    // ao informar o final a gente FINALIZA o mesmo registro.
    const alvoFinalizacaoId = !editandoId && registroAbertoHoje?.id ? registroAbertoHoje.id : "";

    // Bloqueia duplicidade (mesmo equipamento + mesma data), exceto quando estiver editando/finalizando.
    if (!editandoId && !alvoFinalizacaoId) {
      const existente = await buscarLancamentoPorEquipamentoData(equipamento, data);
      if (existente) {
        return alert(
          `Ja existe lancamento do equipamento ${equipamento} na data ${formatarDataBR(data)}.\n` +
          `Para corrigir, use Editar/Atualizar nas operacoes registradas.`
        );
      }
    }

    if (editandoId || alvoFinalizacaoId) {
      const id = editandoId || alvoFinalizacaoId;
      await updateDoc(doc(db, "lancamentos", id), { ...payloadBase, dataAtualizacao: agoraIso });
      await registrarHistorico({
        modulo: "LANCAMENTO",
        acao: "EDITOU",
        entidade: "LANCAMENTO_DIARIO",
        registroId: id,
        usuario: operadorEfetivo,
        descricao: `Editou lancamento de ${equipamento} na data ${data}.`,
        detalhes: { obra: obraEfetiva, equipamento, status: statusEfetivo }
      });
      alert("Lancamento atualizado com sucesso.");
    } else {
      const ref = await addDoc(collection(db, "lancamentos"), { ...payloadBase, dataCriacao: agoraIso });
      await registrarHistorico({
        modulo: "LANCAMENTO",
        acao: "CRIOU",
        entidade: "LANCAMENTO_DIARIO",
        registroId: ref.id,
        usuario: operadorEfetivo,
        descricao: `Criou lancamento de ${equipamento} na data ${data}.`,
        detalhes: { obra: obraEfetiva, equipamento, status: statusEfetivo }
      });
      alert("Lancamento salvo com sucesso.");
    }

    limparFormulario();
    await carregarLancamentos();
  };

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: isMobile ? 10 : 20, background: "#f5f7fa", minHeight: "100vh" }}>
      <h2 style={{ textAlign: "center", marginBottom: 20 }}>Controle Operacional - Lancamento Diario de Equipamento</h2>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>{editandoId ? "Editar lancamento" : "Dados do lancamento"}</h3>

        {modoFinalizarDia && (
          <div style={{ background: "#eafaf1", color: "#0a5b2b", borderRadius: 8, padding: "10px 12px", fontWeight: "bold", marginBottom: 10 }}>
            Lancamento aberto encontrado para este equipamento/data. Preencha apenas o horimetro final e finalize o dia.
          </div>
        )}

        <input
          style={inputStyle}
          type="date"
          value={brParaISO(data)}
          onChange={(e) => setData(formatarDataBR(isoParaBR(e.target.value)))}
        />

        <select style={inputStyle} value={obra} onChange={(e) => setObra(e.target.value)} disabled={modoFinalizarDia}>
          <option value="">Selecione a obra</option>
          {obras.map((item) => (
            <option key={item} value={item} title={item}>{identificarNumeroObra(item)}</option>
          ))}
        </select>

        <select style={inputStyle} value={equipamento} onChange={(e) => setEquipamento(e.target.value)} disabled={modoFinalizarDia}>
          <option value="">Selecione o equipamento</option>
          {equipamentos.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>

        <select style={inputStyle} value={operador} onChange={(e) => setOperador(e.target.value)} disabled={modoFinalizarDia}>
          <option value="">Selecione o operador</option>
          {operadores.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>

        <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: "bold", marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={horimetroQuebrado}
            disabled={modoFinalizarDia}
            onChange={(e) => {
              const marcado = e.target.checked;
              setHorimetroQuebrado(marcado);
              if (marcado) {
                setHorimetroInicial("");
                setHorimetroFinal("");
              } else {
                setHoraFimTurno("");
              }
            }}
          />
          Horimetro do equipamento quebrado
        </label>

        {horimetroQuebrado ? (
          <div style={{ display: "flex", gap: 10 }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              type="time"
              value={horaInicioTurno}
              onChange={(e) => setHoraInicioTurno(e.target.value)}
              disabled={modoFinalizarDia}
              title="Hora inicio do turno"
            />
            <input
              style={{ ...inputStyle, flex: 1 }}
              type="time"
              value={horaFimTurno}
              onChange={(e) => setHoraFimTurno(e.target.value)}
              title="Hora fim do turno (pode preencher depois)"
            />
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10 }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              placeholder="Horimetro inicial"
              value={horimetroInicial}
              onChange={(e) => setHorimetroInicial(e.target.value)}
              disabled={modoFinalizarDia}
            />
            <input
              style={{ ...inputStyle, flex: 1 }}
              placeholder="Horimetro final (pode preencher depois)"
              value={horimetroFinal}
              onChange={(e) => setHorimetroFinal(e.target.value)}
            />
          </div>
        )}

        <div style={{ background: "#eaf3ff", color: "#0b3d91", borderRadius: 8, padding: "10px 12px", fontWeight: "bold", marginBottom: 10 }}>
          Horas trabalhadas: {horas.toFixed(2)}
        </div>

        {ultimoLancamentoEquip && (
          <div style={{ background: "#fff7e6", color: "#8a5a00", borderRadius: 8, padding: "10px 12px", fontWeight: "bold", marginBottom: 10 }}>
            Ultimo horimetro final de {equipamento || "equipamento"}: {ultimoLancamentoEquip.horimetroFinal}
          </div>
        )}

        {!modoFinalizarDia && (
          <>
              <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Selecione o status</option>
                <option>TRABALHANDO</option>
                <option>A DISPOSICAO</option>
                <option>CHUVA</option>
                <option>MECANICA</option>
                <option>SEM OPERACAO - DOMINGO</option>
                <option>SEM OPERACAO - FERIADO</option>
              </select>

              <div style={{ background: "#f1f6ff", border: "1px solid #d8e2ff", borderRadius: 10, padding: 12, marginBottom: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 900, color: "#10243e" }}>
                  <input
                    type="checkbox"
                    checked={abasteceuPosto}
                    onChange={(e) => {
                      const marcado = e.target.checked;
                      setAbasteceuPosto(marcado);
                      if (!marcado) {
                        setPostoLitros("");
                        setPostoNotaFiscal("");
                      }
                    }}
                    disabled={String(status || "").toUpperCase().startsWith("SEM OPERACAO")}
                  />
                  Abastecimento em posto (fora do estoque)
                </label>

                {abasteceuPosto && (
                  <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                    <input
                      style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
                      placeholder="Litros abastecidos (ex.: 80)"
                      value={postoLitros}
                      onChange={(e) => setPostoLitros(e.target.value)}
                    />
                    <input
                      style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
                      placeholder="NF / Cupom (opcional)"
                      value={postoNotaFiscal}
                      onChange={(e) => setPostoNotaFiscal(e.target.value)}
                    />
                  </div>
                )}

                <div style={{ fontSize: 12, color: "#4a5c74", marginTop: 8 }}>
                  Use isso somente quando o equipamento abastecer no posto. Nao baixa/nao entra no estoque do sistema, mas aparece no relatorio mensal do equipamento.
                </div>
              </div>
  
              <label style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 10px", fontWeight: 800, color: "#10243e" }}>
                <input
                  type="checkbox"
                  checked={equipamentoQuebrou}
                onChange={(e) => setEquipamentoQuebrou(e.target.checked)}
              />
              Equipamento quebrou (enviar alerta)
            </label>

            <select
              style={inputStyle}
              value={servicoSugerido}
              onChange={(e) => {
                const valor = e.target.value;
                setServicoSugerido(valor);
                setDescricao(valor);
              }}
              disabled={String(status || "").toUpperCase().startsWith("SEM OPERACAO")}
            >
              <option value="">Selecione o servico padrao ({equipamento || "equipamento"})</option>
              {servicosSugeridos.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>

            <textarea
              style={{ width: "100%", minHeight: 80, padding: 10, borderRadius: 6, border: "1px solid #ccc", marginBottom: 10, boxSizing: "border-box" }}
              placeholder="Descrição do serviço"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              disabled={String(status || "").toUpperCase().startsWith("SEM OPERACAO")}
            />

            {String(status || "").toUpperCase().startsWith("SEM OPERACAO") && (
              <div style={{ background: "#eef2f7", border: "1px solid #d8e0ea", borderRadius: 10, padding: 10, marginBottom: 10, fontWeight: 700, color: "#10243e" }}>
                Sem operacao: o sistema vai salvar com Horimetro Final = Horimetro Inicial e Horas = 0.
              </div>
            )}

            {equipamentoQuebrou && (
              <div style={{ background: "#fff1f1", border: "1px solid #ffd1d1", borderRadius: 10, padding: 12, marginBottom: 10 }}>
                <div style={{ fontWeight: "bold", color: "#8a1f1f", marginBottom: 8 }}>
                  Equipamento quebrou? Envie um alerta para manutencao/admin
                </div>
                <textarea
                  style={{ width: "100%", minHeight: 70, padding: 10, borderRadius: 8, border: "1px solid #ffc2c2", boxSizing: "border-box" }}
                  placeholder="Descreva o problema (ex.: estourou mangueira, travou, vazamento, etc.)"
                  value={relatoQuebra}
                  onChange={(e) => setRelatoQuebra(e.target.value)}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={enviarAlertaQuebra}
                    disabled={enviandoAlerta}
                    style={{
                      ...primaryButton,
                      background: "#dc3545",
                      padding: "10px 12px"
                    }}
                  >
                    {enviandoAlerta ? "ENVIANDO..." : "ENVIAR ALERTA"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {modoFinalizarDia && (
          <div style={{ background: "#f1f6ff", color: "#10243e", borderRadius: 8, padding: "10px 12px", fontWeight: "bold", marginBottom: 10 }}>
            Servico do inicio: {descricao || "-"}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button style={primaryButton} onClick={salvar}>
            {(() => {
              const fimInformado = horimetroQuebrado
                ? String(horaFimTurno || "").trim() !== ""
                : String(horimetroFinal || "").trim() !== "";
              if (editandoId) return "ATUALIZAR";
              if (registroAbertoHoje) return "FINALIZAR DIA";
              return fimInformado ? "SALVAR DIA" : "SALVAR INICIO";
            })()}
          </button>
          <button style={secondaryButton} onClick={limparFormulario}>LIMPAR</button>
          </div>
      </div>

      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <h3 style={{ marginTop: 0, marginBottom: 0 }}>Operacoes registradas</h3>
          <button
            type="button"
            onClick={() => setMostrarRegistros((v) => !v)}
            style={{
              ...secondaryButton,
              padding: "8px 12px",
              borderRadius: 999,
              background: mostrarRegistros ? "#6c757d" : "#0b5ed7"
            }}
            aria-expanded={mostrarRegistros}
          >
            {mostrarRegistros ? "Ocultar" : `Ver (${registros.length})`}
          </button>
        </div>
        <div style={{ marginTop: 8, color: "#6b7c93", fontSize: 12, fontWeight: 600 }}>
          {mostrarRegistros ? "Toque em Editar/Excluir para ajustar o lancamento." : "Abra para conferir e editar/excluir."}
        </div>

        {mostrarRegistros && <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 980 }}>
            <thead style={{ background: "#0b5ed7", color: "#fff" }}>
              <tr>
                {["Data", "Obra", "Equipamento", "Operador", "Inicio", "Fim", "Status", "Descrição", "Ações"].map((h) => (
                  <th key={h} style={{ padding: 8, border: "1px solid #d8e0ea" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {registros.slice(0, 50).map((item, idx) => (
                <tr key={item.id} style={{ background: idx % 2 === 0 ? "#f8fbff" : "#fff" }}>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3", textAlign: "center" }}>{formatarDataVisual(item.data)}</td>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3" }}>{item.obra || "-"}</td>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3" }}>{item.equipamento || "-"}</td>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3" }}>{item.operador || "-"}</td>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3", textAlign: "center" }}>
                    {item.horimetroQuebrado ? (item.horaInicioTurno || "-") : (item.horimetroInicial || "-")}
                  </td>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3", textAlign: "center" }}>
                    {item.horimetroQuebrado ? (item.horaFimTurno || "-") : (item.horimetroFinal || "-")}
                  </td>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3", textAlign: "center" }}>{item.status || "-"}</td>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3" }}>{item.descricao || "-"}</td>
                  <td style={{ padding: 8, border: "1px solid #e5ebf3", textAlign: "center", whiteSpace: "nowrap" }}>
                    <button style={{ ...primaryButton, padding: "6px 10px", marginRight: 6 }} onClick={() => editarRegistro(item)}>
                      Editar
                    </button>
                    <button
                      style={{ ...secondaryButton, padding: "6px 10px", background: "#dc3545" }}
                      onClick={() => excluirRegistro(item.id)}
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
              {!registros.length && (
                <tr>
                  <td colSpan={9} style={{ padding: 10, textAlign: "center", color: "#6c757d" }}>
                    Nenhum lancamento encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>}
      </div>
    </div>
  );
}

export default Lancamento;


