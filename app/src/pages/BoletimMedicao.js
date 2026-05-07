import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import jsPDF from "jspdf";
import { db } from "../firebase";
import { registrarHistorico } from "../utils/historico";
import { formatoLogoPdf, resolverLogoPdf } from "../utils/pdfLogo";
import { belongsToTenant, getConfigDocId, getTenantId, withTenant } from "../utils/tenant";

const COLECAO = "boletinsMedicao";
const TIPOS = ["PARCIAL", "FINAL"];
const CATEGORIAS = [
  "TRANSPORTE",
  "LOCACAO DE IMOVEL",
  "LOCACAO DE MAQUINAS",
  "REFEICOES",
  "MATERIAL",
  "SERVICOS DIVERSOS"
];
const UNIDADES = ["UN", "M2", "M3", "KM", "DIARIA", "MES", "VIAGEM", "TON", "REAL"];

const novoItem = (indice = 1) => ({
  uid: `${Date.now()}-${indice}-${Math.random().toString(36).slice(2, 8)}`,
  item: String(indice).padStart(2, "0"),
  categoria: "TRANSPORTE",
  descricao: "",
  unidade: "REAL",
  quantidade: "",
  valorUnitario: "",
  observacao: ""
});

const novoDesconto = () => ({
  uid: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  descricao: "",
  valor: ""
});

const numeroParaMoeda = (valor) =>
  Number(valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const parseNumero = (valor) => {
  const texto = String(valor || "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : 0;
};

const formatarNumeroInput = (valor) => {
  const texto = String(valor || "").replace(/[^\d,.-]/g, "");
  return texto;
};

const formatarDataBR = (iso) => {
  if (!iso) return "-";
  const partes = String(iso).split("-");
  if (partes.length !== 3) return iso;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
};

const obterAnoReferencia = (dataIso) => {
  const ano = String(dataIso || "").slice(0, 4);
  return /^\d{4}$/.test(ano) ? ano : String(new Date().getFullYear());
};

const formatarNumeroBoletim = (sequencial, dataIso) =>
  `BM-${obterAnoReferencia(dataIso)}-${String(sequencial || 1).padStart(3, "0")}`;

const extrairSequencialBoletim = (numero) => {
  const texto = String(numero || "").trim();
  const match = texto.match(/(\d{3})$/);
  if (match) return Number(match[1]);
  const numeroDireto = Number(texto.replace(/\D/g, ""));
  return Number.isFinite(numeroDireto) && numeroDireto > 0 ? numeroDireto : 0;
};

const obterNumeroObra = (obra) => {
  const nome = String(obra?.nome || "").trim();
  const match = nome.match(/^(\d+)/);
  return match ? match[1] : nome;
};

function BoletimMedicao({ setTela }) {
  const tenantId = getTenantId();
  const [config, setConfig] = useState(null);
  const [obras, setObras] = useState([]);
  const [empresas, setEmpresas] = useState([]);
  const [lista, setLista] = useState([]);
  const [editandoId, setEditandoId] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [gerandoPdfId, setGerandoPdfId] = useState("");
  const [menuAbertoId, setMenuAbertoId] = useState("");
  const [grupoAbertoId, setGrupoAbertoId] = useState("");

  const [numero, setNumero] = useState("");
  const [obraId, setObraId] = useState("");
  const [contrato, setContrato] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [dadosPagamento, setDadosPagamento] = useState("");
  const [periodoInicial, setPeriodoInicial] = useState("");
  const [periodoFinal, setPeriodoFinal] = useState("");
  const [tipo, setTipo] = useState("PARCIAL");
  const [observacaoGeral, setObservacaoGeral] = useState("");
  const [reajustamento, setReajustamento] = useState("");
  const [retencaoCont, setRetencaoCont] = useState("");
  const [irrf, setIrrf] = useState("");
  const [iss, setIss] = useState("");
  const [inss, setInss] = useState("");
  const [itens, setItens] = useState([novoItem(1)]);
  const [descontoItens, setDescontoItens] = useState([novoDesconto()]);

  const inputStyle = {
    width: "100%",
    height: 42,
    padding: "0 10px",
    borderRadius: 8,
    border: "1px solid #cfd7e3",
    boxSizing: "border-box",
    background: "#fff"
  };

  const areaStyle = {
    ...inputStyle,
    height: 84,
    padding: "10px"
  };

  const card = {
    background: "#fff",
    border: "1px solid #e3e7ef",
    borderRadius: 8,
    padding: 16,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    marginBottom: 14
  };

  const botaoPrimario = {
    background: "#0b5ed7",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 16px",
    fontWeight: 800,
    cursor: "pointer"
  };

  const botaoSecundario = {
    background: "#eef2ff",
    color: "#2b2f55",
    border: "1px solid #d8dcff",
    borderRadius: 8,
    padding: "10px 14px",
    fontWeight: 700,
    cursor: "pointer"
  };

  const botaoPerigo = {
    background: "#fff5f5",
    color: "#c92a2a",
    border: "1px solid #ffc9c9",
    borderRadius: 8,
    padding: "10px 14px",
    fontWeight: 700,
    cursor: "pointer"
  };

  const obraSelecionada = useMemo(
    () => obras.find((item) => item.id === obraId) || null,
    [obras, obraId]
  );
  const empresaSelecionada = useMemo(
    () => empresas.find((item) => item.id === empresaId) || null,
    [empresas, empresaId]
  );

  const numeroSequencialAtual = useMemo(() => {
    const somenteNumero = extrairSequencialBoletim(numero);
    return Number.isFinite(somenteNumero) && somenteNumero > 0 ? somenteNumero : 0;
  }, [numero]);

  const boletinsDaEmpresaObra = useMemo(
    () =>
      lista.filter(
        (item) =>
          String(item.empresaRequisitanteId || "") === String(empresaId || "") &&
          String(item.obraId || "") === String(obraId || "")
      ),
    [lista, empresaId, obraId]
  );

  const normalizarAssinaturaItem = (item) =>
    [
      String(item?.categoria || "").trim().toUpperCase(),
      String(item?.descricao || "").trim().toUpperCase(),
      String(item?.unidade || "").trim().toUpperCase()
    ].join("|");

  const boletinsAnterioresOrdenados = useMemo(
    () =>
      [...boletinsDaEmpresaObra]
        .filter((boletim) => {
          if (editandoId && boletim.id === editandoId) return false;
          const seq = Number(boletim.numeroSequencialEmpresa || extrairSequencialBoletim(boletim.numero) || 0);
          if (numeroSequencialAtual > 0 && seq >= numeroSequencialAtual) return false;
          return true;
        })
        .sort((a, b) => {
          const seqA = Number(a.numeroSequencialEmpresa || extrairSequencialBoletim(a.numero) || 0);
          const seqB = Number(b.numeroSequencialEmpresa || extrairSequencialBoletim(b.numero) || 0);
          return seqA - seqB;
        }),
    [boletinsDaEmpresaObra, editandoId, numeroSequencialAtual]
  );

  const encontrarLinhaAnterior = (linhas, itemAtual, index) => {
    const assinatura = normalizarAssinaturaItem(itemAtual);
    const porAssinatura = linhas.find((linha) => normalizarAssinaturaItem(linha) === assinatura);
    if (porAssinatura) return porAssinatura;

    const itemEsperado = String(index + 1).padStart(2, "0");
    const porNumero = linhas.find((linha) => String(linha?.item || "").padStart(2, "0") === itemEsperado);
    if (porNumero) return porNumero;

    return linhas[index] || null;
  };

  const calcularAcumuladosAnteriores = (itemAtual, index) => {
    const assinatura = normalizarAssinaturaItem(itemAtual);
    if (!assinatura || !empresaId) {
      return {
        quantidadeAnterior: 0,
        valorAnterior: 0
      };
    }

    let quantidadeAnterior = 0;
    let valorAnterior = 0;

    for (let i = boletinsAnterioresOrdenados.length - 1; i >= 0; i -= 1) {
      const boletim = boletinsAnterioresOrdenados[i];
      const linhas = Array.isArray(boletim.itens) ? boletim.itens : [];
      const linhaAnterior = encontrarLinhaAnterior(linhas, itemAtual, index);
      if (linhaAnterior) {
        quantidadeAnterior += Number(linhaAnterior.quantidade || 0);
        valorAnterior += Number(linhaAnterior.valorTotal || 0);
      }
    }

    return {
      quantidadeAnterior,
      valorAnterior
    };
  };

  const itensCalculados = useMemo(
      () =>
        itens.map((item, index) => {
          const quantidadeNum = parseNumero(item.quantidade);
          const unitarioNum = parseNumero(item.valorUnitario);
          const valorTotal = quantidadeNum * unitarioNum;
          const acumulados = calcularAcumuladosAnteriores(item, index);
          return {
            ...item,
            item: String(index + 1).padStart(2, "0"),
            quantidadeNum,
            unitarioNum,
            valorTotal,
            acumuladoAnterior: acumulados.quantidadeAnterior,
            acumuladoAtual: acumulados.quantidadeAnterior + quantidadeNum,
            valorAcumuladoAnterior: acumulados.valorAnterior,
            valorAcumuladoAtual: acumulados.valorAnterior + valorTotal
          };
        }),
    [itens, numeroSequencialAtual, boletinsAnterioresOrdenados, editandoId] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const subtotal = useMemo(
    () => itensCalculados.reduce((acc, item) => acc + Number(item.valorTotal || 0), 0),
    [itensCalculados]
  );
  const descontoItensCalculados = useMemo(
    () =>
      descontoItens.map((item) => ({
        ...item,
        valorNum: parseNumero(item.valor)
      })),
    [descontoItens]
  );
  const descontosNum = useMemo(
    () => descontoItensCalculados.reduce((acc, item) => acc + Number(item.valorNum || 0), 0),
    [descontoItensCalculados]
  );
  const reajustamentoNum = useMemo(() => parseNumero(reajustamento), [reajustamento]);
  const retencaoContNum = useMemo(() => parseNumero(retencaoCont), [retencaoCont]);
  const irrfNum = useMemo(() => parseNumero(irrf), [irrf]);
  const issNum = useMemo(() => parseNumero(iss), [iss]);
  const inssNum = useMemo(() => parseNumero(inss), [inss]);
  const valorBruto = subtotal + reajustamentoNum - descontosNum;
  const valorLiquido = valorBruto - retencaoContNum - irrfNum - issNum - inssNum;
  const resumoAnterior = useMemo(() => {
    if (!boletinsAnterioresOrdenados.length) {
      return {
        valorMedicao: 0,
        reajustamento: 0,
        descontos: 0,
        valorBruto: 0,
        retencaoCont: 0,
        irrf: 0,
        iss: 0,
        inss: 0,
        valorLiquido: 0
      };
    }

    return boletinsAnterioresOrdenados.reduce(
      (acc, boletim) => ({
        valorMedicao: acc.valorMedicao + Number(boletim.subtotal || 0),
        reajustamento: acc.reajustamento + Number(boletim.reajustamento ?? boletim.acrescimos ?? 0),
        descontos: acc.descontos + Number(boletim.descontos || 0),
        valorBruto: acc.valorBruto + Number(boletim.valorBruto || 0),
        retencaoCont: acc.retencaoCont + Number(boletim.retencaoCont || 0),
        irrf: acc.irrf + Number(boletim.irrf || 0),
        iss: acc.iss + Number(boletim.iss || 0),
        inss: acc.inss + Number(boletim.inss || 0),
        valorLiquido: acc.valorLiquido + Number(boletim.valorLiquido || 0)
      }),
      {
        valorMedicao: 0,
        reajustamento: 0,
        descontos: 0,
        valorBruto: 0,
        retencaoCont: 0,
        irrf: 0,
        iss: 0,
        inss: 0,
        valorLiquido: 0
      }
    );
  }, [boletinsAnterioresOrdenados]);

  const acumuladoLiquidoAnterior = useMemo(() => Number(resumoAnterior.valorLiquido || 0), [resumoAnterior]);

  const acumuladoLiquidoAtual = acumuladoLiquidoAnterior + valorLiquido;

  const gruposBoletins = useMemo(() => {
    const mapa = new Map();

    lista.forEach((item) => {
      const grupoId = `${String(item.empresaRequisitanteId || item.empresaRequisitanteNome || "-")}__${String(item.obraId || item.obraNome || "-")}`;
      if (!mapa.has(grupoId)) {
        mapa.set(grupoId, {
          id: grupoId,
          empresaNome: item.empresaRequisitanteNome || "-",
          obraNome: item.obraNome || "-",
          itens: []
        });
      }
      mapa.get(grupoId).itens.push(item);
    });

    return Array.from(mapa.values())
      .map((grupo) => {
        const itensOrdenados = [...grupo.itens].sort((a, b) => {
          const seqA = Number(a.numeroSequencialEmpresa || extrairSequencialBoletim(a.numero) || 0);
          const seqB = Number(b.numeroSequencialEmpresa || extrairSequencialBoletim(b.numero) || 0);
          return seqB - seqA;
        });
        const ultima = itensOrdenados[0];
        return {
          ...grupo,
          itens: itensOrdenados,
          quantidadeMedicoes: itensOrdenados.length,
          ultimaMedicao: ultima,
          valorAcumulado: Number(ultima?.acumuladoLiquidoAtual ?? ultima?.valorLiquido ?? 0)
        };
      })
      .sort((a, b) => {
        const seqA = Number(a.ultimaMedicao?.numeroSequencialEmpresa || extrairSequencialBoletim(a.ultimaMedicao?.numero) || 0);
        const seqB = Number(b.ultimaMedicao?.numeroSequencialEmpresa || extrairSequencialBoletim(b.ultimaMedicao?.numero) || 0);
        return seqB - seqA;
      });
  }, [lista]);

  const obterResumoAnteriorBoletim = (boletimAtual) => {
    const empresaRef = String(boletimAtual?.empresaRequisitanteId || "");
    const obraRef = String(boletimAtual?.obraId || "");
    const seqAtual = Number(
      boletimAtual?.numeroSequencialEmpresa || extrairSequencialBoletim(boletimAtual?.numero) || 0
    );

    const anteriores = [...lista]
      .filter((item) => {
        if (String(item?.empresaRequisitanteId || "") !== empresaRef) return false;
        if (String(item?.obraId || "") !== obraRef) return false;
        const seq = Number(item?.numeroSequencialEmpresa || extrairSequencialBoletim(item?.numero) || 0);
        return seq > 0 && seq < seqAtual;
      })
      .sort((a, b) => {
        const seqA = Number(a?.numeroSequencialEmpresa || extrairSequencialBoletim(a?.numero) || 0);
        const seqB = Number(b?.numeroSequencialEmpresa || extrairSequencialBoletim(b?.numero) || 0);
        return seqB - seqA;
      });

    if (!anteriores.length) {
      return {
        valorMedicao: 0,
        reajustamento: 0,
        descontos: 0,
        valorBruto: 0,
        retencaoCont: 0,
        irrf: 0,
        iss: 0,
        inss: 0,
        valorLiquido: 0,
        acumuladoLiquidoAtual: 0
      };
    }

    return anteriores.reduce(
      (acc, anterior) => ({
        valorMedicao: acc.valorMedicao + Number(anterior.subtotal || 0),
        reajustamento: acc.reajustamento + Number(anterior.reajustamento ?? anterior.acrescimos ?? 0),
        descontos: acc.descontos + Number(anterior.descontos || 0),
        valorBruto: acc.valorBruto + Number(anterior.valorBruto || 0),
        retencaoCont: acc.retencaoCont + Number(anterior.retencaoCont || 0),
        irrf: acc.irrf + Number(anterior.irrf || 0),
        iss: acc.iss + Number(anterior.iss || 0),
        inss: acc.inss + Number(anterior.inss || 0),
        valorLiquido: acc.valorLiquido + Number(anterior.valorLiquido || 0),
        acumuladoLiquidoAtual:
          acc.acumuladoLiquidoAtual +
          Number(anterior.valorLiquido || 0)
      }),
      {
        valorMedicao: 0,
        reajustamento: 0,
        descontos: 0,
        valorBruto: 0,
        retencaoCont: 0,
        irrf: 0,
        iss: 0,
        inss: 0,
        valorLiquido: 0,
        acumuladoLiquidoAtual: 0
      }
    );
  };

  const obterLinhasPdf = (boletimAtual) => {
    const resumoAnteriorBoletim = obterResumoAnteriorBoletim(boletimAtual);
    const empresaRef = String(boletimAtual?.empresaRequisitanteId || "");
    const obraRef = String(boletimAtual?.obraId || "");
    const seqAtual = Number(
      boletimAtual?.numeroSequencialEmpresa || extrairSequencialBoletim(boletimAtual?.numero) || 0
    );

    const boletinsAnteriores = [...lista]
      .filter((item) => {
        if (String(item?.empresaRequisitanteId || "") !== empresaRef) return false;
        if (String(item?.obraId || "") !== obraRef) return false;
        const seq = Number(item?.numeroSequencialEmpresa || extrairSequencialBoletim(item?.numero) || 0);
        return seq > 0 && seq < seqAtual;
      })
      .sort((a, b) => {
        const seqA = Number(a?.numeroSequencialEmpresa || extrairSequencialBoletim(a?.numero) || 0);
        const seqB = Number(b?.numeroSequencialEmpresa || extrairSequencialBoletim(b?.numero) || 0);
        return seqB - seqA;
      });

    const linhasAtuais = Array.isArray(boletimAtual?.itens) ? boletimAtual.itens : [];
    const linhasAnterioresPorBoletim = boletinsAnteriores.map((b) => (Array.isArray(b?.itens) ? b.itens : []));

    return linhasAtuais.map((linhaAtual, index) => {
      let qtdAnterior = 0;
      let vlrAnterior = 0;
      linhasAnterioresPorBoletim.forEach((linhas) => {
        const linhaAnterior = encontrarLinhaAnterior(linhas, linhaAtual, index);
        if (linhaAnterior) {
          qtdAnterior += Number(linhaAnterior.quantidade || 0);
          vlrAnterior += Number(linhaAnterior.valorTotal || 0);
        }
      });
      const qtdPeriodo = Number(linhaAtual?.quantidade || 0);
      const qtdAcum = qtdAnterior + qtdPeriodo;
      const vlrPeriodo = Number(linhaAtual?.valorTotal || 0);
      const vlrAcum = vlrAnterior + vlrPeriodo;

      return {
        ...linhaAtual,
        acumuladoAnterior: qtdAnterior,
        acumuladoAtual: qtdAcum,
        valorAcumuladoAnterior: vlrAnterior,
        valorAcumuladoAtual: vlrAcum,
        _resumoAnteriorBoletim: resumoAnteriorBoletim
      };
    });
  };

  const carregar = async () => {
    const [snapObras, snapEmpresas, snapBoletins, snapConfig] = await Promise.all([
      getDocs(collection(db, "obras")),
      getDocs(collection(db, "empresas")),
      getDocs(collection(db, COLECAO)),
      getDoc(doc(db, "configuracoes", getConfigDocId(tenantId)))
    ]);

    const listaObras = snapObras.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId))
      .sort((a, b) => `${a.nome || ""}${a.cidade || ""}`.localeCompare(`${b.nome || ""}${b.cidade || ""}`));
    setObras(listaObras);

    const listaEmpresas = snapEmpresas.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId))
      .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));
    setEmpresas(listaEmpresas);

    const listaBoletins = snapBoletins.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId))
      .sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")));
    setLista(listaBoletins);
    setConfig(snapConfig.exists() ? snapConfig.data() : null);
  };

  useEffect(() => {
    const iniciar = async () => {
      await carregar();
    };
    iniciar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const limpar = () => {
    setEditandoId("");
    setNumero("");
    setObraId("");
    setContrato("");
    setEmpresaId("");
    setDadosPagamento("");
    setPeriodoInicial("");
    setPeriodoFinal("");
    setTipo("PARCIAL");
    setObservacaoGeral("");
    setReajustamento("");
    setRetencaoCont("");
    setIrrf("");
    setIss("");
    setInss("");
    setItens([novoItem(1)]);
    setDescontoItens([novoDesconto()]);
    setMenuAbertoId("");
  };

  const obterProximoNumeroEmpresa = (empresaAlvoId) => {
    if (!empresaAlvoId) return { sequencial: 1, numero: formatarNumeroBoletim(1, periodoInicial) };
    const maior = lista
      .filter((item) => String(item.empresaRequisitanteId || "") === String(empresaAlvoId || ""))
      .map((item) => Number(item.numeroSequencialEmpresa || extrairSequencialBoletim(item.numero) || 0))
      .filter((num) => Number.isFinite(num) && num > 0)
      .reduce((max, atual) => (atual > max ? atual : max), 0);
    const proximo = maior + 1;
    return {
      sequencial: proximo,
      numero: formatarNumeroBoletim(proximo, periodoInicial)
    };
  };

  useEffect(() => {
    if (!empresaId || editandoId) return;
    const dadosNumero = obterProximoNumeroEmpresa(empresaId);
    setNumero(dadosNumero.numero);

    const ultimo = lista.find((item) => String(item.empresaRequisitanteId || "") === String(empresaId || ""));
    if (ultimo?.contrato) {
      setContrato(String(ultimo.contrato || "").trim().toUpperCase());
    }
    if (!dadosPagamento) {
      if (ultimo?.dadosPagamento) {
        setDadosPagamento(String(ultimo.dadosPagamento || "").trim());
      }
    }
  }, [empresaId, editandoId, lista, periodoInicial, dadosPagamento]); // eslint-disable-line react-hooks/exhaustive-deps

  const atualizarItem = (uid, campo, valor) => {
    setItens((atual) =>
      atual.map((item) => (item.uid === uid ? { ...item, [campo]: valor } : item))
    );
  };

  const adicionarItem = () => {
    setItens((atual) => [...atual, novoItem(atual.length + 1)]);
  };

  const removerItem = (uid) => {
    setItens((atual) => {
      if (atual.length === 1) return atual;
      return atual.filter((item) => item.uid !== uid);
    });
  };

  const atualizarDesconto = (uid, campo, valor) => {
    setDescontoItens((atual) =>
      atual.map((item) => (item.uid === uid ? { ...item, [campo]: valor } : item))
    );
  };

  const adicionarDesconto = () => {
    setDescontoItens((atual) => [...atual, novoDesconto()]);
  };

  const removerDesconto = (uid) => {
    setDescontoItens((atual) => {
      if (atual.length === 1) return atual;
      return atual.filter((item) => item.uid !== uid);
    });
  };

  const carregarParaEdicao = (item) => {
    setEditandoId(item.id);
    setNumero(String(item.numero || ""));
    setObraId(String(item.obraId || ""));
    setContrato(String(item.contrato || ""));
    setEmpresaId(String(item.empresaRequisitanteId || ""));
    setDadosPagamento(String(item.dadosPagamento || ""));
    setPeriodoInicial(String(item.periodoInicial || ""));
    setPeriodoFinal(String(item.periodoFinal || ""));
    setTipo(String(item.tipo || "PARCIAL"));
    setObservacaoGeral(String(item.observacao || ""));
    setReajustamento((item.reajustamento ?? item.acrescimos) ? String(item.reajustamento ?? item.acrescimos).replace(".", ",") : "");
    setRetencaoCont(item.retencaoCont ? String(item.retencaoCont).replace(".", ",") : "");
    setIrrf(item.irrf ? String(item.irrf).replace(".", ",") : "");
    setIss(item.iss ? String(item.iss).replace(".", ",") : "");
    setInss(item.inss ? String(item.inss).replace(".", ",") : "");
    setItens(
      Array.isArray(item.itens) && item.itens.length
        ? item.itens.map((linha, index) => ({
            uid: `${item.id}-${index}-${Math.random().toString(36).slice(2, 6)}`,
            item: String(linha.item || index + 1).padStart(2, "0"),
            categoria: String(linha.categoria || "TRANSPORTE"),
            descricao: String(linha.descricao || ""),
            unidade: String(linha.unidade || "REAL"),
            quantidade: String(linha.quantidade ?? "").replace(".", ","),
            valorUnitario: String(linha.valorUnitario ?? "").replace(".", ","),
            observacao: String(linha.observacao || "")
          }))
        : [novoItem(1)]
    );
    setDescontoItens(
      Array.isArray(item.descontoItens) && item.descontoItens.length
        ? item.descontoItens.map((linha, index) => ({
            uid: `${item.id}-desconto-${index}-${Math.random().toString(36).slice(2, 6)}`,
            descricao: String(linha.descricao || ""),
            valor: String(linha.valor ?? "").replace(".", ",")
          }))
        : [novoDesconto()]
    );
    setMenuAbertoId("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const validar = () => {
    if (!obraId) return "Selecione a obra.";
    if (!empresaId) return "Selecione a empresa requisitante.";
    if (!String(dadosPagamento || "").trim()) return "Preencha os dados para pagamento.";
    if (!periodoInicial || !periodoFinal) return "Informe o periodo.";
    if (periodoFinal < periodoInicial) return "O período final não pode ser menor que o inicial.";
    const itensValidos = itensCalculados.filter((item) => String(item.descricao || "").trim());
    if (!itensValidos.length) return "Adicione pelo menos um item com descricao.";
    const itemInvalido = itensValidos.find(
      (item) => item.quantidadeNum <= 0 || item.unitarioNum < 0
    );
    if (itemInvalido) return "Preencha quantidade e valor unitario validos nos itens.";
    const descontoInvalido = descontoItensCalculados.find(
      (item) => item.valor && (!String(item.descricao || "").trim() || item.valorNum < 0)
    );
    if (descontoInvalido) return "Preencha descricao e valor validos nos descontos discriminados.";
    return "";
  };

  const salvar = async () => {
    const erro = validar();
    if (erro) {
      alert(erro);
      return;
    }
    setSalvando(true);
    try {
      const numeroGerado = obterProximoNumeroEmpresa(empresaId);
      const numeroFinal = numero || numeroGerado.numero;
      const numeroSequencialEmpresa = numeroSequencialAtual || numeroGerado.sequencial;
      const linhas = itensCalculados
        .filter((item) => String(item.descricao || "").trim())
        .map((item, index) => ({
          item: String(index + 1).padStart(2, "0"),
          categoria: String(item.categoria || "").trim().toUpperCase(),
          descricao: String(item.descricao || "").trim().toUpperCase(),
          unidade: String(item.unidade || "").trim().toUpperCase(),
            quantidade: Number(item.quantidadeNum || 0),
            acumuladoAnterior: Number(item.acumuladoAnterior || 0),
            acumuladoAtual: Number(item.acumuladoAtual || 0),
            valorUnitario: Number(item.unitarioNum || 0),
            valorTotal: Number(item.valorTotal || 0),
            valorAcumuladoAnterior: Number(item.valorAcumuladoAnterior || 0),
            valorAcumuladoAtual: Number(item.valorAcumuladoAtual || 0),
            observacao: String(item.observacao || "").trim()
          }));
      const descontosDetalhados = descontoItensCalculados
        .filter((item) => String(item.descricao || "").trim() || Number(item.valorNum || 0) > 0)
        .map((item) => ({
          descricao: String(item.descricao || "").trim().toUpperCase(),
          valor: Number(item.valorNum || 0)
        }));

      const payload = withTenant(
        {
          numero: numeroFinal,
          numeroSequencialEmpresa,
          obraId,
          obraNome: obterNumeroObra(obraSelecionada),
          obraNomeCompleto: String(obraSelecionada?.nome || "").trim(),
          obraCidade: String(obraSelecionada?.cidade || "").trim(),
          obraEstado: String(obraSelecionada?.estado || "").trim(),
          contrato: String(contrato || "").trim().toUpperCase(),
          empresaRequisitanteId: empresaId,
          empresaRequisitanteNome: String(empresaSelecionada?.nome || "").trim().toUpperCase(),
          dadosPagamento: String(dadosPagamento || "").trim().toUpperCase(),
          periodoInicial,
          periodoFinal,
          tipo: String(tipo || "PARCIAL").trim().toUpperCase(),
          observacao: String(observacaoGeral || "").trim(),
          subtotal: Number(subtotal || 0),
          descontos: Number(descontosNum || 0),
          descontoItens: descontosDetalhados,
          reajustamento: Number(reajustamentoNum || 0),
          acrescimos: Number(reajustamentoNum || 0),
          retencaoCont: Number(retencaoContNum || 0),
          irrf: Number(irrfNum || 0),
          iss: Number(issNum || 0),
          inss: Number(inssNum || 0),
          valorBruto: Number(valorBruto || 0),
          valorLiquido: Number(valorLiquido || 0),
          acumuladoLiquidoAnterior: Number(acumuladoLiquidoAnterior || 0),
          acumuladoLiquidoAtual: Number(acumuladoLiquidoAtual || 0),
          itens: linhas
        },
        tenantId
      );

      if (editandoId) {
        await updateDoc(doc(db, COLECAO, editandoId), {
          ...payload,
          atualizadoEm: new Date().toISOString()
        });
        await registrarHistorico({
          modulo: "BOLETIM_MEDICAO",
          acao: "ALTEROU",
          entidade: "BOLETIM",
          registroId: editandoId,
          descricao: `Atualizou boletim ${numeroFinal}.`
        });
      } else {
        const ref = await addDoc(collection(db, COLECAO), {
          ...payload,
          criadoEm: new Date().toISOString()
        });
        await registrarHistorico({
          modulo: "BOLETIM_MEDICAO",
          acao: "CRIOU",
          entidade: "BOLETIM",
          registroId: ref.id,
          descricao: `Criou boletim ${numeroFinal}.`
        });
      }

      await carregar();
      alert(editandoId ? "Boletim atualizado!" : "Boletim salvo!");
      limpar();
    } catch (e) {
      alert(`Erro ao salvar boletim: ${e?.message || e}`);
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async (item) => {
    if (!window.confirm(`Excluir o boletim ${item?.numero || ""}?`)) return;
    await deleteDoc(doc(db, COLECAO, item.id));
    await registrarHistorico({
      modulo: "BOLETIM_MEDICAO",
      acao: "EXCLUIU",
      entidade: "BOLETIM",
      registroId: item.id,
      descricao: `Excluiu boletim ${item?.numero || "-"}.`
    });
    await carregar();
    setMenuAbertoId("");
    if (editandoId === item.id) limpar();
  };

  const gerarPdf = async (item) => {
    setGerandoPdfId(item.id);
    try {
      const resumoAnteriorPdf = obterResumoAnteriorBoletim(item);
      const linhasPdf = obterLinhasPdf(item);
      const acumuladoAnteriorPdf = Number(
        item.acumuladoLiquidoAnterior ??
          resumoAnteriorPdf.acumuladoLiquidoAtual ??
          resumoAnteriorPdf.valorLiquido ??
          0
      );
      const acumuladoAtualPdf = Number(
        item.acumuladoLiquidoAtual ??
          (acumuladoAnteriorPdf + Number(item.valorLiquido || 0))
      );
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageWidth = 297;
      const pageHeight = 210;
      const margemEsq = 14;
      const margemDir = 14;
      const larguraUtil = pageWidth - margemEsq - margemDir;
      const logoBase64 = await resolverLogoPdf(config);

      const infoBloco = (rotulo, valor, x, yLinha, largura, offset = 24) => {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(9.2);
        pdf.text(rotulo, x, yLinha);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9.2);
        const quebrado = pdf.splitTextToSize(String(valor || "-"), largura);
        pdf.text(quebrado, x + offset, yLinha);
        return Math.max(3.2, quebrado.length * 2.9);
      };

      const desenharCabecalhoItens = (yCabecalho) => {
        pdf.setFillColor(11, 94, 215);
        pdf.setTextColor(255, 255, 255);
        pdf.rect(margemEsq, yCabecalho, larguraUtil, 7, "F");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(6.8);
        pdf.text("ITEM", 16, yCabecalho + 4.7);
        pdf.text("DESCRIÇÃO", 30, yCabecalho + 4.7);
        pdf.text("UND", 154, yCabecalho + 4.7, { align: "center" });
        pdf.text("QTD ANT.", 170, yCabecalho + 4.7, { align: "center" });
        pdf.text("QTD PER.", 185, yCabecalho + 4.7, { align: "center" });
        pdf.text("QTD ACUM.", 200, yCabecalho + 4.7, { align: "center" });
        pdf.text("VLR ANT.", 223, yCabecalho + 4.7, { align: "right" });
        pdf.text("VLR PER.", 252, yCabecalho + 4.7, { align: "right" });
        pdf.text("VLR ACUM.", 281, yCabecalho + 4.7, { align: "right" });
        pdf.setTextColor(0, 0, 0);
        return yCabecalho + 7;
      };

      const desenharCabecalhoDocumento = () => {
        if (logoBase64) {
          try {
            pdf.addImage(logoBase64, formatoLogoPdf(logoBase64), 14, 10, 22, 15);
          } catch {
            // ignora erro de logo
          }
        }

        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(16);
        pdf.text("BOLETIM DE MEDIÇÃO", pageWidth / 2, 17, { align: "center" });
        pdf.setFontSize(9.3);
        pdf.setFont("helvetica", "normal");
        pdf.text(String(config?.razaoSocial || config?.nomeFantasia || "").trim().toUpperCase(), pageWidth / 2, 22.8, { align: "center" });

        pdf.setDrawColor(190, 200, 214);
        pdf.line(margemEsq, 27, pageWidth - margemDir, 27);

        let yCab = 33;
        const colA = margemEsq;
        const colB = 150;
        const larguraA = 104;
        const larguraB = 108;
        const linha1 = Math.max(
          infoBloco("Número:", item.numero, colA, yCab, larguraA),
          infoBloco("Tipo:", item.tipo, colB, yCab, larguraB)
        );
        yCab += linha1 + 0.8;
        const linha2 = Math.max(
          infoBloco("Obra:", item.obraNome || "-", colA, yCab, 28, 15),
          infoBloco("Contrato:", item.contrato, colB, yCab, larguraB)
        );
        yCab += linha2 + 0.8;
        const linha3 = Math.max(
          infoBloco("Empresa:", item.empresaRequisitanteNome, colA, yCab, 74, 21),
          infoBloco("Período:", `${formatarDataBR(item.periodoInicial)} a ${formatarDataBR(item.periodoFinal)}`, colB, yCab, larguraB)
        );
        yCab += linha3 + 1.5;
        if (String(item.dadosPagamento || "").trim()) {
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(8.8);
          pdf.text("Dados para pagamento:", margemEsq, yCab);
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(8);
          const pagamento = pdf.splitTextToSize(String(item.dadosPagamento || ""), larguraUtil - 42);
          pdf.text(pagamento, margemEsq + 42, yCab);
          yCab += Math.max(2.6, pagamento.length * 2.45) + 0.8;
        }

        return yCab;
      };

      const desenharCabecalhoPagina = () => desenharCabecalhoItens(desenharCabecalhoDocumento());

      let y = desenharCabecalhoPagina();
      let paginaAtual = 1;
      const linhas = linhasPdf;
      const limiteItensPrimeiraFolha = 15;
      const alturaReservadaPrimeiraFolha = 56;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);

      const novaPaginaComCabecalho = () => {
        pdf.addPage();
        paginaAtual += 1;
        y = desenharCabecalhoPagina();
      };

      const novaPaginaDocumento = () => {
        pdf.addPage();
        paginaAtual += 1;
        y = desenharCabecalhoDocumento();
      };

      const novaPaginaSePreciso = (alturaNecessaria = 10) => {
        if (y + alturaNecessaria <= pageHeight - 16) return;
        novaPaginaComCabecalho();
      };

      linhas.forEach((linha, index) => {
        const descricao = `${linha.categoria || ""} - ${linha.descricao || ""}`.trim();
        const descricaoQuebrada = pdf.splitTextToSize(descricao || "-", 112);
        const altura = Math.max(6.6, descricaoQuebrada.length * 3.6 + 1.2);
        if (index === limiteItensPrimeiraFolha) {
          novaPaginaComCabecalho();
        }
        if (
          paginaAtual === 1 &&
          index < limiteItensPrimeiraFolha &&
          y + altura + 2 + alturaReservadaPrimeiraFolha > pageHeight - 16
        ) {
          novaPaginaComCabecalho();
        }
        novaPaginaSePreciso(altura + 2);
        pdf.rect(margemEsq, y, larguraUtil, altura);
        pdf.text(String(linha.item || "-"), 16, y + 4.2);
        pdf.text(descricaoQuebrada, 30, y + 4.2);
        pdf.text(String(linha.unidade || "-"), 154, y + 4.2, { align: "center" });
        pdf.text(numeroParaMoeda(linha.acumuladoAnterior).replace(",00", ""), 170, y + 4.2, { align: "center" });
        pdf.text(numeroParaMoeda(linha.quantidade).replace(",00", ""), 185, y + 4.2, { align: "center" });
        pdf.text(numeroParaMoeda(linha.acumuladoAtual).replace(",00", ""), 200, y + 4.2, { align: "center" });
        pdf.text(`R$ ${numeroParaMoeda(linha.valorAcumuladoAnterior || 0)}`, 223, y + 4.2, { align: "right" });
        pdf.text(`R$ ${numeroParaMoeda(linha.valorTotal)}`, 252, y + 4.2, { align: "right" });
        pdf.text(`R$ ${numeroParaMoeda(linha.valorAcumuladoAtual || linha.valorTotal || 0)}`, 281, y + 4.2, { align: "right" });
        y += altura;
      });

      if (String(item.observacao || "").trim()) {
        y += 8;
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "bold");
        pdf.text("Observação:", margemEsq, y);
        pdf.setFont("helvetica", "normal");
        const obs = pdf.splitTextToSize(String(item.observacao || ""), larguraUtil);
        pdf.text(obs, margemEsq, y + 5);
        y += obs.length * 4.2 + 6;
      }

      const descontosValidos = Array.isArray(item.descontoItens)
        ? item.descontoItens.filter(
            (linha) => String(linha.descricao || "").trim() || Number(linha.valor || 0) > 0
          )
        : [];

      const linhasFechamento = [
        ["VALOR DA MEDIÇÃO", resumoAnteriorPdf.valorMedicao, item.subtotal, resumoAnteriorPdf.valorMedicao + Number(item.subtotal || 0)],
        ["REAJUSTAMENTO", resumoAnteriorPdf.reajustamento, Number(item.reajustamento ?? item.acrescimos ?? 0), resumoAnteriorPdf.reajustamento + Number(item.reajustamento ?? item.acrescimos ?? 0)],
        ["DESCONTOS", resumoAnteriorPdf.descontos, Number(item.descontos || 0), resumoAnteriorPdf.descontos + Number(item.descontos || 0)],
        ["VALOR BRUTO A FATURAR", resumoAnteriorPdf.valorBruto, Number(item.valorBruto || 0), resumoAnteriorPdf.valorBruto + Number(item.valorBruto || 0)]
      ];
      const encargos = [
        ["RETENCAO CONT.", resumoAnteriorPdf.retencaoCont, Number(item.retencaoCont || 0), resumoAnteriorPdf.retencaoCont + Number(item.retencaoCont || 0)],
        ["IRRF", resumoAnteriorPdf.irrf, Number(item.irrf || 0), resumoAnteriorPdf.irrf + Number(item.irrf || 0)],
        ["ISS", resumoAnteriorPdf.iss, Number(item.iss || 0), resumoAnteriorPdf.iss + Number(item.iss || 0)],
        ["INSS", resumoAnteriorPdf.inss, Number(item.inss || 0), resumoAnteriorPdf.inss + Number(item.inss || 0)]
      ].filter(([, ant, per, acum]) => Number(ant) !== 0 || Number(per) !== 0 || Number(acum) !== 0);
      const rows = [...linhasFechamento, ...encargos];

      novaPaginaSePreciso(36 + rows.length * 7);
      y += 8;
      const tabelaX = 126;
      const tabelaW = pageWidth - margemDir - tabelaX;
      const acumRightX = pageWidth - margemDir - 3;
      const periodoRightX = acumRightX - 34;
      const anteriorRightX = periodoRightX - 34;
      const rowH = 5.8;

      pdf.setFillColor(233, 239, 249);
      pdf.rect(tabelaX, y - 5.5, tabelaW, rowH, "F");
      pdf.setDrawColor(214, 224, 238);
      pdf.rect(tabelaX, y - 5.5, tabelaW, rowH);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8.2);
      pdf.text("ANTERIOR", anteriorRightX, y - 0.8, { align: "right" });
      pdf.text("NO PERÍODO", periodoRightX, y - 0.8, { align: "right" });
      pdf.text("ACUMULADO", acumRightX, y - 0.8, { align: "right" });
      y += rowH;

      rows.forEach(([rotulo, anterior, periodo, acumulado]) => {
        pdf.rect(tabelaX, y - 5.5, tabelaW, rowH);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8.9);
        pdf.text(`${rotulo}:`, tabelaX + 2.4, y - 1.1);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8.7);
        pdf.text(`R$ ${numeroParaMoeda(anterior)}`, anteriorRightX, y - 1.1, { align: "right" });
        pdf.text(`R$ ${numeroParaMoeda(periodo)}`, periodoRightX, y - 1.1, { align: "right" });
        pdf.text(`R$ ${numeroParaMoeda(acumulado)}`, acumRightX, y - 1.1, { align: "right" });
        y += rowH;
      });

      pdf.setFillColor(239, 245, 255);
      pdf.rect(tabelaX, y - 5.5, tabelaW, 7.2, "F");
      pdf.rect(tabelaX, y - 5.5, tabelaW, 7.2);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10.3);
      pdf.text("TOTAL LÍQ. A RECEBER:", tabelaX + 2.4, y - 0.2);
      pdf.text(`R$ ${numeroParaMoeda(acumuladoAnteriorPdf)}`, anteriorRightX, y - 0.2, { align: "right" });
      pdf.text(`R$ ${numeroParaMoeda(item.valorLiquido)}`, periodoRightX, y - 0.2, { align: "right" });
      pdf.text(`R$ ${numeroParaMoeda(acumuladoAtualPdf)}`, acumRightX, y - 0.2, { align: "right" });
      y += 14;

      novaPaginaSePreciso(28);
      const assinaturaY = Math.min(y + 8, pageHeight - 20);
      const gapAss = 8;
      const blocoAssinaturaW = (larguraUtil - gapAss * 2) / 3;
      const assinatura1X = margemEsq;
      const assinatura2X = assinatura1X + blocoAssinaturaW + gapAss;
      const assinatura3X = assinatura2X + blocoAssinaturaW + gapAss;

      pdf.setDrawColor(120, 134, 156);
      pdf.line(assinatura1X, assinaturaY, assinatura1X + blocoAssinaturaW, assinaturaY);
      pdf.line(assinatura2X, assinaturaY, assinatura2X + blocoAssinaturaW, assinaturaY);
      pdf.line(assinatura3X, assinaturaY, assinatura3X + blocoAssinaturaW, assinaturaY);

      const escreverAssinatura = (texto, x) => {
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8.1);
        const linhasAss = pdf.splitTextToSize(texto, blocoAssinaturaW - 6);
        pdf.text(linhasAss, x + blocoAssinaturaW / 2, assinaturaY + 4.2, { align: "center" });
      };

      escreverAssinatura("ASSINATURA DO CONTRATADO", assinatura1X);
      escreverAssinatura("ENGENHEIRO RESPONSAVEL", assinatura2X);
      escreverAssinatura("GERENTE DA OBRA", assinatura3X);

      if (descontosValidos.length) {
        novaPaginaDocumento();
        pdf.setFontSize(8.2);
        pdf.setFont("helvetica", "bold");
        pdf.text("MEMÓRIA DE CÁLCULO DOS DESCONTOS", margemEsq, y);
        y += 3.2;
        pdf.setFillColor(233, 239, 249);
        pdf.rect(margemEsq, y, larguraUtil, 6.8, "F");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8.4);
        pdf.text("DESCRIÇÃO DO DESCONTO", margemEsq + 3, y + 4.5);
        pdf.text("VALOR", pageWidth - margemDir - 3, y + 4.5, { align: "right" });
        y += 6.8;
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8.6);
        descontosValidos.forEach((linha) => {
          if (y + 6.8 > pageHeight - 16) {
            novaPaginaDocumento();
            pdf.setFontSize(8.2);
            pdf.setFont("helvetica", "bold");
            pdf.text("MEMÓRIA DE CÁLCULO DOS DESCONTOS", margemEsq, y);
            y += 3.2;
            pdf.setFillColor(233, 239, 249);
            pdf.rect(margemEsq, y, larguraUtil, 6.8, "F");
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(8.4);
            pdf.text("DESCRIÇÃO DO DESCONTO", margemEsq + 3, y + 4.5);
            pdf.text("VALOR", pageWidth - margemDir - 3, y + 4.5, { align: "right" });
            y += 6.8;
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(8.6);
          }
          pdf.rect(margemEsq, y, larguraUtil, 6.8);
          pdf.text(String(linha.descricao || "-"), margemEsq + 3, y + 4.5);
          pdf.text(`R$ ${numeroParaMoeda(linha.valor)}`, pageWidth - margemDir - 3, y + 4.5, { align: "right" });
          y += 6.8;
        });
      }

      pdf.save(`${String(item.numero || "boletim-medicao").replace(/[^\w-]/g, "_")}.pdf`);
    } catch (e) {
      alert(`Erro ao gerar PDF: ${e?.message || e}`);
    } finally {
      setGerandoPdfId("");
    }
  };

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "18px 10px 28px", background: "#f3f5f8" }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0, color: "#10243e" }}>Boletim de Medição</h2>
            <p style={{ margin: "8px 0 0", color: "#566b86" }}>
              Medição simplificada para locação, transporte, refeições, materiais e serviços diversos.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={botaoSecundario} onClick={limpar}>Novo boletim</button>
            <button type="button" style={botaoSecundario} onClick={() => setTela("home")}>Voltar</button>
          </div>
        </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0, color: "#173454" }}>{editandoId ? "Editar boletim" : "Dados do boletim"}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>Número da medição (auto por empresa)</div>
              <input style={inputStyle} value={numero} disabled placeholder={`BM-${new Date().getFullYear()}-001`} />
            </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>Obra</div>
            <select style={inputStyle} value={obraId} onChange={(e) => setObraId(e.target.value)}>
              <option value="">Selecione a obra</option>
              {obras.map((obra) => (
                <option key={obra.id} value={obra.id}>
                  {obterNumeroObra(obra) || "-"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>Contrato</div>
            <input style={inputStyle} value={contrato} onChange={(e) => setContrato(e.target.value)} placeholder="Ex.: 070-2025" />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>Empresa requisitante</div>
            <select style={inputStyle} value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
              <option value="">Selecione a empresa</option>
              {empresas.map((empresa) => (
                <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>Período inicial</div>
            <input style={inputStyle} type="date" value={periodoInicial} onChange={(e) => setPeriodoInicial(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>Período final</div>
            <input style={inputStyle} type="date" value={periodoFinal} onChange={(e) => setPeriodoFinal(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>Tipo</div>
            <select style={inputStyle} value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {TIPOS.map((opcao) => (
                <option key={opcao} value={opcao}>{opcao}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>Dados para pagamento</div>
          <div style={{ fontSize: 11, color: "#6a7f97", marginBottom: 6 }}>
            Preenchimento unico por empresa, com opcao de ajuste quando precisar.
          </div>
          <textarea
            style={{ ...areaStyle, height: 64 }}
            value={dadosPagamento}
            onChange={(e) => setDadosPagamento(e.target.value)}
            placeholder="Razao social, documento, contato, chave PIX, banco, agencia ou outra informacao de pagamento."
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>Observação geral</div>
          <textarea style={areaStyle} value={observacaoGeral} onChange={(e) => setObservacaoGeral(e.target.value)} placeholder="Observações do boletim, medição, faturamento ou conferência." />
        </div>
      </div>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, color: "#173454" }}>Itens da medição</h3>
          <button type="button" style={botaoSecundario} onClick={adicionarItem}>Adicionar item</button>
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
          {itensCalculados.map((item) => (
            <div key={item.uid} style={{ border: "1px solid #e5ebf3", borderRadius: 10, padding: 12, background: "#fbfdff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                <strong style={{ color: "#173454" }}>Item {item.item}</strong>
                <button type="button" style={botaoPerigo} onClick={() => removerItem(item.uid)} disabled={itens.length === 1}>
                  Remover
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "100px minmax(180px, 1fr) 120px 130px 130px", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>Item</div>
                  <input style={inputStyle} value={item.item} disabled />
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>Categoria</div>
                  <select style={inputStyle} value={item.categoria} onChange={(e) => atualizarItem(item.uid, "categoria", e.target.value)}>
                    {CATEGORIAS.map((opcao) => (
                      <option key={opcao} value={opcao}>{opcao}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>Unidade</div>
                  <select style={inputStyle} value={item.unidade} onChange={(e) => atualizarItem(item.uid, "unidade", e.target.value)}>
                    {UNIDADES.map((opcao) => (
                      <option key={opcao} value={opcao}>{opcao}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>Quantidade</div>
                  <input style={inputStyle} value={item.quantidade} onChange={(e) => atualizarItem(item.uid, "quantidade", formatarNumeroInput(e.target.value))} placeholder="0,00" />
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>Valor unitario</div>
                  <input style={inputStyle} value={item.valorUnitario} onChange={(e) => atualizarItem(item.uid, "valorUnitario", formatarNumeroInput(e.target.value))} placeholder="0,00" />
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>Descrição do serviço</div>
                <input style={inputStyle} value={item.descricao} onChange={(e) => atualizarItem(item.uid, "descricao", e.target.value)} placeholder="Ex.: Frete de material petreo para obra..." />
              </div>
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 220px", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>Observação</div>
                  <textarea style={{ ...areaStyle, height: 64 }} value={item.observacao} onChange={(e) => atualizarItem(item.uid, "observacao", e.target.value)} placeholder="Opcional" />
                </div>
                <div style={{ border: "1px solid #d9e5ff", borderRadius: 10, background: "#eef4ff", padding: 14, display: "grid", alignContent: "center" }}>
                  <div style={{ fontSize: 12, color: "#54708f", fontWeight: 700 }}>Valor total do item</div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: "#173454", marginTop: 4 }}>
                    R$ {numeroParaMoeda(item.valorTotal)}
                  </div>
                    <div style={{ marginTop: 10, display: "grid", gap: 4, fontSize: 12, color: "#173454" }}>
                      <div><strong>Quantidade:</strong> {numeroParaMoeda(item.quantidadeNum).replace(",00", "")}</div>
                      <div><strong>Valor periodo:</strong> R$ {numeroParaMoeda(item.valorTotal)}</div>
                      <div><strong>Histórico do item:</strong> {numeroParaMoeda(item.acumuladoAtual).replace(",00", "")} {item.unidade}</div>
                    </div>
                  </div>
                </div>
              </div>
          ))}
        </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0, color: "#173454" }}>Fechamento da medição</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10, marginBottom: 14 }}>
          <div style={{ border: "1px solid #d9e5ff", borderRadius: 10, background: "#fbfdff", padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#5f7290", marginBottom: 6 }}>Valor da medição</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#173454" }}>R$ {numeroParaMoeda(subtotal)}</div>
          </div>
          <div style={{ border: "1px solid #d9e5ff", borderRadius: 10, background: "#fbfdff", padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#5f7290", marginBottom: 6 }}>Descontos do periodo</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#8b1e1e" }}>R$ {numeroParaMoeda(descontosNum)}</div>
          </div>
          <div style={{ border: "1px solid #d9e5ff", borderRadius: 10, background: "#fbfdff", padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#5f7290", marginBottom: 6 }}>Acumulado anterior</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#173454" }}>R$ {numeroParaMoeda(acumuladoLiquidoAnterior)}</div>
          </div>
          <div style={{ border: "1px solid #d9e5ff", borderRadius: 10, background: "#eef4ff", padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#5f7290", marginBottom: 6 }}>Total liquido a receber</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: "#0b5ed7" }}>R$ {numeroParaMoeda(valorLiquido)}</div>
            <div style={{ marginTop: 6, fontSize: 12, color: "#173454" }}>
              Acumulado atual: <strong>R$ {numeroParaMoeda(acumuladoLiquidoAtual)}</strong>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>Reajustamento</div>
            <input style={inputStyle} value={reajustamento} onChange={(e) => setReajustamento(formatarNumeroInput(e.target.value))} placeholder="0,00" />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>Retencao cont.</div>
            <input style={inputStyle} value={retencaoCont} onChange={(e) => setRetencaoCont(formatarNumeroInput(e.target.value))} placeholder="0,00" />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>IRRF</div>
            <input style={inputStyle} value={irrf} onChange={(e) => setIrrf(formatarNumeroInput(e.target.value))} placeholder="0,00" />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>ISS</div>
            <input style={inputStyle} value={iss} onChange={(e) => setIss(formatarNumeroInput(e.target.value))} placeholder="0,00" />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>INSS</div>
            <input style={inputStyle} value={inss} onChange={(e) => setInss(formatarNumeroInput(e.target.value))} placeholder="0,00" />
          </div>
        </div>

        <div style={{ marginTop: 14, border: "1px solid #e5ebf3", borderRadius: 10, padding: 12, background: "#fbfdff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <strong style={{ color: "#173454" }}>Memória de cálculo dos descontos</strong>
            <button type="button" style={botaoSecundario} onClick={adicionarDesconto}>Adicionar desconto</button>
          </div>
          <div style={{ fontSize: 11, color: "#6a7f97", marginBottom: 10 }}>
            Descreva claramente o motivo de cada desconto para o boletim ficar explicativo no PDF e na cobrança.
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {descontoItensCalculados.map((item) => (
              <div key={item.uid} style={{ display: "grid", gridTemplateColumns: "1fr 180px auto", gap: 10, alignItems: "end" }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>Descrição</div>
                  <input
                    style={inputStyle}
                    value={item.descricao}
                    onChange={(e) => atualizarDesconto(item.uid, "descricao", e.target.value)}
                    placeholder="Ex.: fornecimento de diesel / fornecimento de peca / aluguel descontado"
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#31455f", marginBottom: 4 }}>Valor</div>
                  <input
                    style={inputStyle}
                    value={item.valor}
                    onChange={(e) => atualizarDesconto(item.uid, "valor", formatarNumeroInput(e.target.value))}
                    placeholder="0,00"
                  />
                </div>
                <button type="button" style={botaoPerigo} onClick={() => removerDesconto(item.uid)} disabled={descontoItens.length === 1}>
                  Remover
                </button>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
          <button type="button" style={{ ...botaoPrimario, opacity: salvando ? 0.7 : 1 }} onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando..." : editandoId ? "Atualizar boletim" : "Salvar boletim"}
          </button>
          <button type="button" style={botaoSecundario} onClick={limpar}>Limpar formulario</button>
        </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0, color: "#173454" }}>Boletins cadastrados</h3>
        <div style={{ overflowX: "auto", marginBottom: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1080 }}>
            <thead style={{ background: "#0b5ed7", color: "#fff" }}>
              <tr>
                {["Obra", "Requisitante", "Medições", "Última medição", "Valor acumulado", "Ações"].map((titulo) => (
                  <th key={`grupo-${titulo}`} style={{ border: "1px solid #d8e0ea", padding: 10, textAlign: "left", whiteSpace: "nowrap" }}>
                    {titulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gruposBoletins.flatMap((grupo, index) => {
                const linhaGrupo = (
                  <tr key={grupo.id} style={{ background: index % 2 === 0 ? "#f8fbff" : "#fff" }}>
                    <td style={{ border: "1px solid #e5ebf3", padding: 10, fontWeight: 700 }}>{grupo.obraNome || "-"}</td>
                    <td style={{ border: "1px solid #e5ebf3", padding: 10 }}>{grupo.empresaNome || "-"}</td>
                    <td style={{ border: "1px solid #e5ebf3", padding: 10, whiteSpace: "nowrap" }}>{grupo.quantidadeMedicoes} medição(ões)</td>
                    <td style={{ border: "1px solid #e5ebf3", padding: 10, whiteSpace: "nowrap", fontWeight: 700 }}>
                      {grupo.ultimaMedicao?.numero || "-"}
                    </td>
                    <td style={{ border: "1px solid #e5ebf3", padding: 10, whiteSpace: "nowrap", fontWeight: 800 }}>
                      R$ {numeroParaMoeda(grupo.valorAcumulado)}
                    </td>
                    <td style={{ border: "1px solid #e5ebf3", padding: 10 }}>
                      <button
                        type="button"
                        style={botaoSecundario}
                        onClick={() => {
                          setMenuAbertoId("");
                          setGrupoAbertoId((atual) => (atual === grupo.id ? "" : grupo.id));
                        }}
                      >
                        {grupoAbertoId === grupo.id ? "Fechar" : "Abrir"}
                      </button>
                    </td>
                  </tr>
                );

                const linhaDetalhes = grupoAbertoId === grupo.id ? (
                  <tr key={`${grupo.id}-detalhes`}>
                    <td colSpan={6} style={{ border: "1px solid #e5ebf3", padding: 12, background: "#fdfefe" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead style={{ background: "#eef4ff", color: "#173454" }}>
                          <tr>
                            {["Número", "Período", "Tipo", "Valor líquido", "Ações"].map((titulo) => (
                              <th
                                key={`${grupo.id}-${titulo}`}
                                style={{ border: "1px solid #d8e0ea", padding: 8, textAlign: "left", whiteSpace: "nowrap" }}
                              >
                                {titulo}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {grupo.itens.map((item, itemIndex) => (
                            <tr key={item.id} style={{ background: itemIndex % 2 === 0 ? "#fff" : "#f8fbff" }}>
                              <td style={{ border: "1px solid #e5ebf3", padding: 8, fontWeight: 700 }}>{item.numero || "-"}</td>
                              <td style={{ border: "1px solid #e5ebf3", padding: 8, whiteSpace: "nowrap" }}>
                                {`${formatarDataBR(item.periodoInicial)} a ${formatarDataBR(item.periodoFinal)}`}
                              </td>
                              <td style={{ border: "1px solid #e5ebf3", padding: 8 }}>{item.tipo || "-"}</td>
                              <td style={{ border: "1px solid #e5ebf3", padding: 8, whiteSpace: "nowrap", fontWeight: 800 }}>
                                R$ {numeroParaMoeda(item.valorLiquido)}
                              </td>
                              <td style={{ border: "1px solid #e5ebf3", padding: 8 }}>
                                <div style={{ position: "relative", display: "inline-block" }}>
                                  <button
                                    type="button"
                                    style={botaoSecundario}
                                    onClick={() => setMenuAbertoId((atual) => (atual === item.id ? "" : item.id))}
                                  >
                                    Abrir
                                  </button>
                                  {menuAbertoId === item.id && (
                                    <div
                                      style={{
                                        position: "absolute",
                                        top: "calc(100% + 6px)",
                                        right: 0,
                                        minWidth: 150,
                                        background: "#fff",
                                        border: "1px solid #dfe6f2",
                                        borderRadius: 10,
                                        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.14)",
                                        padding: 8,
                                        display: "grid",
                                        gap: 6,
                                        zIndex: 10
                                      }}
                                    >
                                      <button type="button" style={botaoSecundario} onClick={() => carregarParaEdicao(item)}>
                                        Editar
                                      </button>
                                      <button
                                        type="button"
                                        style={{ ...botaoSecundario, opacity: gerandoPdfId === item.id ? 0.7 : 1 }}
                                        onClick={() => gerarPdf(item)}
                                        disabled={gerandoPdfId === item.id}
                                      >
                                        {gerandoPdfId === item.id ? "Gerando..." : "PDF"}
                                      </button>
                                      <button type="button" style={botaoPerigo} onClick={() => excluir(item)}>
                                        Excluir
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                ) : null;

                return linhaDetalhes ? [linhaGrupo, linhaDetalhes] : [linhaGrupo];
              })}
              {!gruposBoletins.length && (
                <tr>
                  <td colSpan={6} style={{ padding: 12, textAlign: "center", color: "#6c757d", border: "1px solid #e5ebf3" }}>
                    Nenhum boletim cadastrado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {false && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1080 }}>
            <thead style={{ background: "#0b5ed7", color: "#fff" }}>
              <tr>
                {["Número", "Obra", "Requisitante", "Período", "Tipo", "Valor líquido", "Ações"].map((titulo) => (
                  <th key={titulo} style={{ border: "1px solid #d8e0ea", padding: 10, textAlign: "left", whiteSpace: "nowrap" }}>{titulo}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lista.map((item, index) => (
                <tr key={item.id} style={{ background: index % 2 === 0 ? "#f8fbff" : "#fff" }}>
                  <td style={{ border: "1px solid #e5ebf3", padding: 10, fontWeight: 700 }}>{item.numero || "-"}</td>
                  <td style={{ border: "1px solid #e5ebf3", padding: 10 }}>{item.obraNome || "-"}</td>
                  <td style={{ border: "1px solid #e5ebf3", padding: 10 }}>{item.empresaRequisitanteNome || "-"}</td>
                  <td style={{ border: "1px solid #e5ebf3", padding: 10, whiteSpace: "nowrap" }}>
                    {`${formatarDataBR(item.periodoInicial)} a ${formatarDataBR(item.periodoFinal)}`}
                  </td>
                  <td style={{ border: "1px solid #e5ebf3", padding: 10 }}>{item.tipo || "-"}</td>
                  <td style={{ border: "1px solid #e5ebf3", padding: 10, whiteSpace: "nowrap", fontWeight: 800 }}>
                    R$ {numeroParaMoeda(item.valorLiquido)}
                  </td>
                    <td style={{ border: "1px solid #e5ebf3", padding: 10 }}>
                      <div style={{ position: "relative", display: "inline-block" }}>
                        <button
                          type="button"
                          style={botaoSecundario}
                          onClick={() => setMenuAbertoId((atual) => (atual === item.id ? "" : item.id))}
                        >
                          Abrir
                        </button>
                        {menuAbertoId === item.id && (
                          <div
                            style={{
                              position: "absolute",
                              top: "calc(100% + 6px)",
                              right: 0,
                              minWidth: 150,
                              background: "#fff",
                              border: "1px solid #dfe6f2",
                              borderRadius: 10,
                              boxShadow: "0 8px 24px rgba(15, 23, 42, 0.14)",
                              padding: 8,
                              display: "grid",
                              gap: 6,
                              zIndex: 10
                            }}
                          >
                            <button
                              type="button"
                              style={botaoSecundario}
                              onClick={() => carregarParaEdicao(item)}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              style={{ ...botaoSecundario, opacity: gerandoPdfId === item.id ? 0.7 : 1 }}
                              onClick={() => gerarPdf(item)}
                              disabled={gerandoPdfId === item.id}
                            >
                              {gerandoPdfId === item.id ? "Gerando..." : "PDF"}
                            </button>
                            <button
                              type="button"
                              style={botaoPerigo}
                              onClick={() => excluir(item)}
                            >
                              Excluir
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                </tr>
              ))}
              {!lista.length && (
                <tr>
                  <td colSpan={7} style={{ padding: 12, textAlign: "center", color: "#6c757d", border: "1px solid #e5ebf3" }}>
                    Nenhum boletim cadastrado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>
    </div>
  );
}

export default BoletimMedicao;

