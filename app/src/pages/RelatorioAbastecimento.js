/* eslint-disable react-hooks/exhaustive-deps */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { doc, getDoc, collection, getDocs, query, where, writeBatch } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import { registrarHistorico } from "../utils/historico";
import { formatoLogoPdf, resolverLogoPdf } from "../utils/pdfLogo";
import { belongsToTenant, getConfigDocId, getTenantId } from "../utils/tenant";

function RelatorioAbastecimento({ setTela }) {
  const tenantId = getTenantId();
  const sessaoOperacional = (() => {
    try {
      return JSON.parse(localStorage.getItem("sessaoOperacional") || "{}");
    } catch {
      return {};
    }
  })();
  const perfilSessao = String(sessaoOperacional?.perfilAcesso || sessaoOperacional?.perfil || "")
    .trim()
    .toUpperCase();
  const usuarioChaveSessao = Boolean(sessaoOperacional?.usuarioChave);
  const podeZerarHistorico = usuarioChaveSessao || perfilSessao === "GESTOR_GERAL";
  const [zerandoHistorico, setZerandoHistorico] = useState(false);
  const [dados, setDados] = useState([]);
  const [filtrado, setFiltrado] = useState([]);
  const [empresaSistema, setEmpresaSistema] = useState(null);
  const [equipamentosSistema, setEquipamentosSistema] = useState([]);

  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [obra, setObra] = useState("");
  const [equipamento, setEquipamento] = useState("");
  const [operador, setOperador] = useState("");
  const [tipoDiesel, setTipoDiesel] = useState("");
  const [apenasAssinados, setApenasAssinados] = useState(false);
  const [somenteAlertas, setSomenteAlertas] = useState(false);

  // Alertas: por padrao usamos baseline (mediana) por equipamento/grupo + capacidade do tanque.
  // Os campos abaixo ficam como "ajustes avancados" (opcionais).
  const [limiteLitrosPorUnidade, setLimiteLitrosPorUnidade] = useState("0"); // 0 = desativado
  const [minIntervaloHoras, setMinIntervaloHoras] = useState("0"); // 0 = auto
  const [minDeltaUnidade, setMinDeltaUnidade] = useState("0"); // 0 = desativado
  const [janelaComparacaoDias, setJanelaComparacaoDias] = useState("14");
  const [multiplicadorComparacao, setMultiplicadorComparacao] = useState("1.60");
  const [maxAbastecimentosDia, setMaxAbastecimentosDia] = useState("0"); // 0 = auto
  const [limiteLitrosDia, setLimiteLitrosDia] = useState("0"); // 0 = desativado
  const [multiplicadorDia, setMultiplicadorDia] = useState("1.60");
  const [minLitrosAlerta, setMinLitrosAlerta] = useState("0"); // 0 = desativado
  const [alertarSemAssinatura, setAlertarSemAssinatura] = useState(true);
  const [mostrarAvancado, setMostrarAvancado] = useState(false);
  const [painelAlertas, setPainelAlertas] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [jaPesquisou, setJaPesquisou] = useState(false);

  const hojeISO = () => new Date().toISOString().slice(0, 10);
  const diasAtrasISO = (dias) => {
    const d = new Date();
    d.setDate(d.getDate() - Number(dias || 0));
    return d.toISOString().slice(0, 10);
  };

  const baseInput = {
    height: 40,
    borderRadius: 8,
    border: "1px solid #cfd7e3",
    padding: "0 10px",
    boxSizing: "border-box",
    width: "100%",
    background: "#fff"
  };

  const card = {
    background: "#fff",
    border: "1px solid #e3e7ef",
    borderRadius: 8,
    padding: 14,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)"
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Evita carregar todo o historico ao abrir (reduz leituras/custo).
    // Comeca com um periodo curto e so busca quando clicar em "Pesquisar".
    setDataInicio(diasAtrasISO(7));
    setDataFim(hojeISO());
    buscarEmpresa();
    buscarEquipamentos();
  }, []);

  const buscarDados = async (ini, fim) => {
    const iniISO = String(ini || "").trim();
    const fimISO = String(fim || "").trim();

    try {
      const restricoes = [where("tenantId", "==", String(tenantId || "").toLowerCase())];
      if (iniISO) restricoes.push(where("data", ">=", iniISO));
      if (fimISO) restricoes.push(where("data", "<=", fimISO));
      const q = query(collection(db, "abastecimentos"), ...restricoes);
      const snap = await getDocs(q);
      const lista = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
      lista.sort((a, b) => (String(a.data || "") > String(b.data || "") ? 1 : -1));
      setDados(lista);
      return lista;
    } catch {
      // fallback: modo antigo (pode custar mais, mas nao quebra).
      const snap = await getDocs(collection(db, "abastecimentos"));
      const lista = snap.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((item) => belongsToTenant(item, tenantId))
        .filter((item) => {
          const dataRegistro = String(item.data || "");
          if (iniISO && dataRegistro < iniISO) return false;
          if (fimISO && dataRegistro > fimISO) return false;
          return true;
        });
      lista.sort((a, b) => (String(a.data || "") > String(b.data || "") ? 1 : -1));
      setDados(lista);
      return lista;
    }
  };

  const buscarEmpresa = async () => {
    const ref = doc(db, "configuracoes", getConfigDocId(tenantId));
    const snap = await getDoc(ref);
    if (snap.exists()) setEmpresaSistema(snap.data());
  };

  const buscarEquipamentos = async () => {
    const snap = await getDocs(collection(db, "equipamentos"));
    const lista = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId));
    setEquipamentosSistema(lista);
  };

  const zerarHistoricoAbastecimento = async () => {
    if (!podeZerarHistorico) return alert("Sem permissao para zerar historico.");
    if (zerandoHistorico) return;

    const ok1 = window.confirm(
      "ATENCAO: isso vai apagar TODO o historico de abastecimento desta empresa (tenant atual).\n" +
      "Isso nao repoe/ajusta estoque automaticamente.\n\n" +
      "Deseja continuar?"
    );
    if (!ok1) return;

    const texto = window.prompt("Para confirmar, digite ZERAR:");
    if (String(texto || "").trim().toUpperCase() !== "ZERAR") {
      return alert("Operacao cancelada.");
    }

    setZerandoHistorico(true);
    try {
      // Busca novamente para garantir que estamos apagando tudo mesmo (sem depender do estado local).
      const snap = await getDocs(collection(db, "abastecimentos"));
      const lista = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((item) => belongsToTenant(item, tenantId));

      // Firestore: max ~500 operacoes por batch. Usamos 450 por seguranca.
      const chunkSize = 450;
      for (let i = 0; i < lista.length; i += chunkSize) {
        const batch = writeBatch(db);
        lista.slice(i, i + chunkSize).forEach((item) => {
          batch.delete(doc(db, "abastecimentos", item.id));
        });
        // eslint-disable-next-line no-await-in-loop
        await batch.commit();
      }

      await registrarHistorico({
        modulo: "ABASTECIMENTO",
        acao: "ZEROU_HISTORICO",
        entidade: "ABASTECIMENTOS",
        registroId: "abastecimentos",
        usuario: String(sessaoOperacional?.nome || localStorage.getItem("usuarioLogado") || "-"),
        descricao: `Zerou historico de abastecimento (apagou ${lista.length} registros).`
      });

      setDados([]);
      setFiltrado([]);
      alert("Histórico de abastecimento zerado com sucesso.");
    } catch (e) {
      console.log(e);
      alert("Nao foi possivel zerar o historico agora. Tente novamente.");
    } finally {
      setZerandoHistorico(false);
    }
  };

  const normalizar = (valor) =>
    String(valor || "")
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const capacidadeTanquePorNome = useMemo(() => {
    const map = new Map();
    equipamentosSistema.forEach((eq) => {
      const nomeKey = normalizar(eq?.nome).trim();
      const cap = Number(eq?.capacidadeTanque || 0);
      if (nomeKey && Number.isFinite(cap) && cap > 0) map.set(nomeKey, cap);
    });
    return map;
  }, [equipamentosSistema]); // eslint-disable-line react-hooks/exhaustive-deps

  const capacidadeTanquePorCodigo = useMemo(() => {
    const map = new Map();
    equipamentosSistema.forEach((eq) => {
      const codKey = normalizar(eq?.codigo).trim();
      const cap = Number(eq?.capacidadeTanque || 0);
      if (codKey && Number.isFinite(cap) && cap > 0) map.set(codKey, cap);
    });
    return map;
  }, [equipamentosSistema]); // eslint-disable-line react-hooks/exhaustive-deps

  const obterCapacidadeTanque = (item) => {
    const codKey = normalizar(item?.codigo).trim();
    if (codKey && capacidadeTanquePorCodigo.has(codKey)) return capacidadeTanquePorCodigo.get(codKey);
    const nomeKey = normalizar(item?.equipamento).trim();
    if (nomeKey && capacidadeTanquePorNome.has(nomeKey)) return capacidadeTanquePorNome.get(nomeKey);
    return 0;
  };

  const avaliarAlerta = (item) => {
    const motivos = [];
    const litros = numero(item?.litros);
    const cap = obterCapacidadeTanque(item);
    const limTaxa = numero(limiteLitrosPorUnidade) || 0;
    const limIntervalo = numero(minIntervaloHoras) || 0;
    const limDelta = numero(minDeltaUnidade) || 0;
    const multComp = numero(multiplicadorComparacao) || 0;
    const maxDia = Math.max(0, Math.round(numero(maxAbastecimentosDia) || 0));
    const limDia = numero(limiteLitrosDia) || 0;
    const multDia = numero(multiplicadorDia) || 0;
    const minLitros = numero(minLitrosAlerta) || 0;

    // Baseline do proprio equipamento (medianas) - evita "chutar" limites fixos.
    const equipKeyBase = normalizar(item?.codigo || item?.equipamento).trim();
    const baseEq = equipKeyBase ? (baselinePorEquipamento?.medianas?.get(equipKeyBase) || null) : null;

    if (cap > 0 && litros > cap + 0.5) {
      motivos.push(`Acima da capacidade do tanque (${cap.toFixed(0)} L)`);
    }

    if (alertarSemAssinatura && !item?.assinatura) {
      motivos.push("Sem assinatura");
    }

    if (minLitros > 0 && litros > 0 && litros < minLitros) {
      motivos.push(`Litros muito baixo (${litros.toFixed(2)} L)`);
    }

    if (baseEq && multComp > 0 && baseEq.litros > 0 && litros > baseEq.litros * multComp) {
      motivos.push(`Acima do padrao do equipamento (mediana ${baseEq.litros.toFixed(1)} L)`);
    }

    // Comparacao entre maquinas iguais (mesma obra + mesmo tipo de equipamento).
    // Foco: quando o horimetro esta quebrado, comparamos o volume por abastecimento
    // com o padrao das outras maquinas com horimetro OK.
    if (Boolean(item?.horimetroQuebrado) && multComp > 0) {
      const key = chaveGrupoComparacao(item);
      const base = key ? (baselineLitrosPorAbastecimento.get(key) || 0) : 0;
      if (base > 0 && litros > base * multComp) {
        motivos.push(`Acima do padrao das maquinas iguais (mediana ${base.toFixed(1)} L)`);
      }
    }

    // Alertas diÃ¡rios por equipamento (quantidade, total e mistura de tipo)
    const equipKeyDia = normalizar(item?.codigo || item?.equipamento).trim();
    const dataISO = String(item?.data || "").trim();
    if (equipKeyDia && dataISO) {
      const porDia = resumoPorDiaPorEquip.get(equipKeyDia);
      const resumoDia = porDia ? porDia.get(dataISO) : null;
      if (resumoDia) {
        const maxAuto = baseEq && baseEq.countDia > 0 ? Math.max(2, Math.ceil(baseEq.countDia * 1.6)) : 2;
        const maxDiaUsado = maxDia > 0 ? maxDia : maxAuto;
        if (maxDiaUsado > 0 && resumoDia.count > maxDiaUsado) {
          motivos.push(`Muitos abastecimentos no dia (${resumoDia.count}x)`);
        }
        if (limDia > 0 && resumoDia.totalLitros > limDia) {
          motivos.push(`Total do dia alto (${resumoDia.totalLitros.toFixed(1)} L)`);
        }
        if (resumoDia.tipos && resumoDia.tipos.size >= 2) {
          motivos.push("Mistura de tipo no dia (S-10/S-500)");
        }

        // Comparacao diaria com o proprio equipamento (mediana diaria)
        if (multDia > 0 && baseEq && baseEq.totalDia > 0 && resumoDia.totalLitros > baseEq.totalDia * multDia) {
          motivos.push(`Acima do padrao diario do equipamento (mediana ${baseEq.totalDia.toFixed(1)} L/dia)`);
        }

        // Comparacao diaria com maquinas iguais (baseline mediana diaria do grupo)
        const grupo = chaveGrupoComparacao(item);
        const baseDia = grupo ? (baselineLitrosDiaPorGrupo.get(grupo) || 0) : 0;
        if (multDia > 0 && baseDia > 0 && resumoDia.totalLitros > baseDia * multDia) {
          motivos.push(`Acima do padrao diario do grupo (mediana ${baseDia.toFixed(1)} L/dia)`);
        }
      }
    }

    // Comparacoes com o abastecimento anterior do mesmo equipamento
    const equipKey = normalizar(item?.codigo || item?.equipamento).trim();
    const listaEquip = equipKey ? abastecimentosPorEquip.get(equipKey) : null;
    const dtAtual = parseDataHora(item);
    if (listaEquip && dtAtual) {
      const idx = listaEquip.findIndex((x) => x.item?.id === item?.id);
      const anterior = idx > 0 ? listaEquip[idx - 1] : null;
      if (anterior) {
        // Intervalo muito curto entre abastecimentos.
        // Se o usuario nao configurar um valor fixo, usamos um limite "auto" baseado na mediana do equipamento.
        const diffHoras = (dtAtual - anterior.dt) / (1000 * 60 * 60);
        const baseIntervalo = baseEq && baseEq.intervaloH > 0 ? baseEq.intervaloH : 0;
        const limAuto = baseIntervalo > 0 ? Math.max(0.5, baseIntervalo * 0.4) : 1; // fallback 1h
        const limUsado = limIntervalo > 0 ? limIntervalo : limAuto;
        if (diffHoras >= 0 && diffHoras < limUsado) {
          motivos.push(`Abastecimento muito frequente (${diffHoras.toFixed(2)} h)`);
        }

        // Se o horimetro estiver quebrado, podemos estimar uma taxa por TEMPO usando o horario do abastecimento.
        // Nao desconta tempo parado: serve como alerta "provavel anomalia" para investigacao.
        // Para nao gerar falso positivo em intervalos muito longos (noite/fim de semana), limitamos a janela.
        const diffHorasJanela = (dtAtual - anterior.dt) / (1000 * 60 * 60);
        if (Boolean(item?.horimetroQuebrado) && limTaxa > 0 && litros > 0) {
          if (diffHorasJanela > 0 && diffHorasJanela <= 12) {
            const taxaTempo = litros / diffHorasJanela; // L/h aproximado
            if (taxaTempo > limTaxa) {
              motivos.push(`Consumo alto por tempo (${taxaTempo.toFixed(2)} L/h aprox.)`);
            }
          }
        }

        // Alertas por horimetro/KM quando houver leitura numerica e NAO estiver quebrado
        const quebrado = Boolean(item?.horimetroQuebrado);
        const quebradoAnt = Boolean(anterior.item?.horimetroQuebrado);

        const unidadeAtual = !quebrado ? numero(item?.horimetro) : 0;
        const unidadeAnt = !quebradoAnt ? numero(anterior.item?.horimetro) : 0;

        if (!quebrado && !quebradoAnt && unidadeAtual > 0 && unidadeAnt > 0) {
          const delta = unidadeAtual - unidadeAnt;
          if (limDelta > 0 && delta <= limDelta) {
            motivos.push(`Leitura sem variacao (Î”=${delta.toFixed(2)})`);
          }
          if (delta > 0 && limTaxa > 0 && litros > 0) {
            const taxa = litros / delta; // L/unid (horimetro ou KM)
            if (taxa > limTaxa) {
              motivos.push(`Consumo alto (${taxa.toFixed(2)} L/unid)`);
            }
          }

          // Comparacao automatica por padrao do proprio equipamento (quando houver historico suficiente)
          if (delta > 0 && litros > 0 && baseEq && baseEq.taxa > 0 && multComp > 0) {
            const taxa = litros / delta;
            if (taxa > baseEq.taxa * multComp) {
              motivos.push(`Consumo alto vs padrao (mediana ${baseEq.taxa.toFixed(2)} L/unid)`);
            }
          }
        }
      }
    }

    // Se horimetro quebrado, usa horasTrabalhadas registradas no abastecimento (quando houver)
    if (Boolean(item?.horimetroQuebrado)) {
      const horas = numero(item?.horasTrabalhadas);
      if (horas > 0 && limTaxa > 0 && litros > 0) {
        const taxa = litros / horas; // L/h
        if (taxa > limTaxa) {
          motivos.push(`Consumo alto (${taxa.toFixed(2)} L/h)`);
        }
      }
    }

    return {
      nivel: motivos.length ? "ALERTA" : "OK",
      motivos,
      capacidadeTanque: cap
    };
  };

  const numero = (valor) => {
    const texto = String(valor ?? "")
      .trim()
      .replace(/\./g, "")
      .replace(",", ".");
    const convertido = Number(texto);
    return Number.isFinite(convertido) ? convertido : 0;
  };

  const parseDataHora = (item) => {
    // Prioriza ISO gravado no back (criadoEm). Fallback: dataHora pt-BR.
    const iso = String(item?.criadoEm || "").trim();
    if (iso) {
      const dt = new Date(iso);
      if (!Number.isNaN(dt.getTime())) return dt;
    }

    const txt = String(item?.dataHora || "").trim();
    // Esperado: "dd/mm/aaaa HH:MM:SS" (ou sem segundos)
    const match = txt.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (match) {
      const dd = Number(match[1]);
      const mm = Number(match[2]);
      const aa = Number(match[3]);
      const hh = Number(match[4]);
      const mi = Number(match[5]);
      const ss = Number(match[6] || 0);
      const dt = new Date(aa, mm - 1, dd, hh, mi, ss);
      if (!Number.isNaN(dt.getTime())) return dt;
    }

    const d = String(item?.data || "").trim();
    if (d) {
      const dt = new Date(`${d}T00:00:00`);
      if (!Number.isNaN(dt.getTime())) return dt;
    }

    return null;
  };

  const abastecimentosPorEquip = useMemo(() => {
    const map = new Map();
    dados.forEach((item) => {
      const key = normalizar(item?.codigo || item?.equipamento).trim();
      if (!key) return;
      const dt = parseDataHora(item);
      if (!dt) return;
      const arr = map.get(key) || [];
      arr.push({ item, dt });
      map.set(key, arr);
    });
    map.forEach((arr, key) => {
      arr.sort((a, b) => a.dt - b.dt);
      map.set(key, arr);
    });
    return map;
  }, [dados]); // eslint-disable-line react-hooks/exhaustive-deps

  const mediana = (valores) => {
    const nums = (valores || []).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    if (!nums.length) return 0;
    const mid = Math.floor(nums.length / 2);
    if (nums.length % 2 === 0) return (nums[mid - 1] + nums[mid]) / 2;
    return nums[mid];
  };

  const chaveGrupoComparacao = (item) => {
    // Mesmo tipo de equipamento na mesma obra: ajuda quando existem 2 maquinas iguais.
    const obraKey = normalizar(item?.obraId || item?.obra || "").trim();
    const tipoKey = normalizar(item?.equipamento || "").trim();
    return `${obraKey}__${tipoKey}`;
  };

  const baselineLitrosPorAbastecimento = useMemo(() => {
    const dias = numero(janelaComparacaoDias) || 0;
    const limiteDias = dias > 0 ? dias : 0;
    const agora = new Date();

    const map = new Map();

    dados.forEach((item) => {
      const dt = parseDataHora(item);
      if (!dt) return;
      if (limiteDias > 0) {
        const diffDias = (agora - dt) / (1000 * 60 * 60 * 24);
        if (diffDias > limiteDias) return;
      }

      // Baseline: apenas maquinas com horimetro OK (nao quebrado)
      if (Boolean(item?.horimetroQuebrado)) return;

      const litros = numero(item?.litros);
      if (!(litros > 0)) return;

      const key = chaveGrupoComparacao(item);
      if (!key) return;
      const arr = map.get(key) || [];
      arr.push(litros);
      map.set(key, arr);
    });

    const med = new Map();
    map.forEach((arr, key) => {
      med.set(key, mediana(arr));
    });
    return med;
  }, [dados, janelaComparacaoDias]); // eslint-disable-line react-hooks/exhaustive-deps

  const resumoPorDiaPorEquip = useMemo(() => {
    // Map equipKey -> Map dataISO -> { count, totalLitros, tipos: Set }
    const map = new Map();
    dados.forEach((item) => {
      const equipKey = normalizar(item?.codigo || item?.equipamento).trim();
      const dataISO = String(item?.data || "").trim();
      if (!equipKey || !dataISO) return;
      const litros = numero(item?.litros);
      if (!(litros > 0)) return;
      const tipo = normalizar(item?.tipo || "").trim();

      const porDia = map.get(equipKey) || new Map();
      const atual = porDia.get(dataISO) || { count: 0, totalLitros: 0, tipos: new Set() };
      atual.count += 1;
      atual.totalLitros += litros;
      if (tipo) atual.tipos.add(tipo);
      porDia.set(dataISO, atual);
      map.set(equipKey, porDia);
    });
    return map;
  }, [dados]); // eslint-disable-line react-hooks/exhaustive-deps

  const baselineLitrosDiaPorGrupo = useMemo(() => {
    // Baseline por obra+tipo: mediana do total diario (somente maquinas com horimetro OK)
    const dias = numero(janelaComparacaoDias) || 0;
    const limiteDias = dias > 0 ? dias : 0;
    const agora = new Date();

    // Map grupo -> Map dataISO -> totalLitros (para evitar duplicar por abastecimento)
    const totals = new Map();

    dados.forEach((item) => {
      if (Boolean(item?.horimetroQuebrado)) return;
      const dt = parseDataHora(item);
      if (!dt) return;
      if (limiteDias > 0) {
        const diffDias = (agora - dt) / (1000 * 60 * 60 * 24);
        if (diffDias > limiteDias) return;
      }
      const litros = numero(item?.litros);
      if (!(litros > 0)) return;
      const dataISO = String(item?.data || "").trim();
      if (!dataISO) return;

      const grupo = chaveGrupoComparacao(item);
      if (!grupo) return;
      const porDia = totals.get(grupo) || new Map();
      porDia.set(dataISO, (porDia.get(dataISO) || 0) + litros);
      totals.set(grupo, porDia);
    });

    const med = new Map();
    totals.forEach((porDia, grupo) => {
      const valores = Array.from(porDia.values());
      med.set(grupo, mediana(valores));
    });
    return med;
  }, [dados, janelaComparacaoDias]); // eslint-disable-line react-hooks/exhaustive-deps

  const baselinePorEquipamento = useMemo(() => {
    // Baselines por equipamento (medianas) dentro da janela: litros por abastecimento, intervalo (h), taxa (L/unid),
    // delta (unid), total diario (L/dia) e abastecimentos por dia (count).
    const dias = numero(janelaComparacaoDias) || 0;
    const limiteDias = dias > 0 ? dias : 0;
    const agora = new Date();

    const porEquip = new Map(); // equipKey -> arr { item, dt }
    dados.forEach((item) => {
      const equipKey = normalizar(item?.codigo || item?.equipamento).trim();
      if (!equipKey) return;
      const dt = parseDataHora(item);
      if (!dt) return;
      if (limiteDias > 0) {
        const diffDias = (agora - dt) / (1000 * 60 * 60 * 24);
        if (diffDias > limiteDias) return;
      }
      const arr = porEquip.get(equipKey) || [];
      arr.push({ item, dt });
      porEquip.set(equipKey, arr);
    });
    porEquip.forEach((arr, key) => {
      arr.sort((a, b) => a.dt - b.dt);
      porEquip.set(key, arr);
    });

    const medianas = new Map();

    porEquip.forEach((arr, equipKey) => {
      const litrosArr = [];
      const intervalosH = [];
      const taxas = [];
      const deltas = [];

      for (let i = 0; i < arr.length; i++) {
        const atual = arr[i];
        const litros = numero(atual.item?.litros);
        if (litros > 0) litrosArr.push(litros);

        if (i > 0) {
          const ant = arr[i - 1];
          const diffH = (atual.dt - ant.dt) / (1000 * 60 * 60);
          if (diffH > 0) intervalosH.push(diffH);

          const quebrado = Boolean(atual.item?.horimetroQuebrado);
          const quebradoAnt = Boolean(ant.item?.horimetroQuebrado);
          if (!quebrado && !quebradoAnt) {
            const uAtual = numero(atual.item?.horimetro);
            const uAnt = numero(ant.item?.horimetro);
            const delta = uAtual > 0 && uAnt > 0 ? (uAtual - uAnt) : 0;
            if (delta > 0) {
              deltas.push(delta);
              const taxa = litros > 0 ? (litros / delta) : 0;
              if (taxa > 0) taxas.push(taxa);
            }
          }
        }
      }

      const porDia = resumoPorDiaPorEquip.get(equipKey) || new Map();
      const totaisDia = [];
      const countsDia = [];
      porDia.forEach((v) => {
        if (v?.totalLitros > 0) totaisDia.push(v.totalLitros);
        if (v?.count > 0) countsDia.push(v.count);
      });

      medianas.set(equipKey, {
        litros: mediana(litrosArr),
        intervaloH: mediana(intervalosH),
        taxa: mediana(taxas),
        delta: mediana(deltas),
        totalDia: mediana(totaisDia),
        countDia: mediana(countsDia)
      });
    });

    return { porEquip, medianas };
  }, [dados, janelaComparacaoDias, resumoPorDiaPorEquip]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatarMoeda = (valor) =>
    Number(valor || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });

  const formatarDataBR = (dataISO) => {
    if (!dataISO) return "-";
    const partes = String(dataISO).split("-");
    if (partes.length === 3) return `${partes[2]}/${partes[1]}/${partes[0]}`;
    return dataISO;
  };

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

  const listaOleo = (item) =>
    (item.lubrificacoes || [])
      .filter((l) => normalizar(l.tipo).includes("OLEO"))
      .map((l) => `${l.produto || "-"} (${numero(l.quantidade).toFixed(2)} L)`)
      .join(" | ");

  const listaGraxa = (item) =>
    (item.lubrificacoes || [])
      .filter((l) => normalizar(l.tipo).includes("GRAXA"))
      .map((l) => `${l.produto || "-"} (${numero(l.quantidade).toFixed(2)} KG)`)
      .join(" | ");

  const resumoConsumos = (item) => {
    const linhas = [];
    const litros = numero(item.litros);
    const tipo = String(item.tipo || "-").trim();

    if (litros > 0) {
      linhas.push(`Diesel ${tipo}: ${litros.toFixed(2)} L`);
    }

    const oleo = listaOleo(item);
    if (oleo) linhas.push(`Oleo: ${oleo}`);

    const graxa = listaGraxa(item);
    if (graxa) linhas.push(`Graxa: ${graxa}`);

    return linhas.join("\n") || "-";
  };

  const opcoesObras = useMemo(
    () => [...new Set(dados.map((item) => item.obra).filter(Boolean))].sort(),
    [dados]
  );

  const opcoesEquipamentos = useMemo(
    () => [...new Set(dados.map((item) => item.equipamento).filter(Boolean))].sort(),
    [dados]
  );

  const opcoesOperadores = useMemo(
    () => [...new Set(dados.map((item) => item.operador).filter(Boolean))].sort(),
    [dados]
  );

  const aplicarFiltros = (base = dados) => {
    if (dataInicio && dataFim && dataInicio > dataFim) {
      alert("Data inicial nao pode ser maior que a data final.");
      return;
    }

    const resultado = (base || []).filter((item) => {
      const dataRegistro = String(item.data || "");
      const tipoRegistro = normalizar(item.tipo);

      if (dataInicio && dataRegistro < dataInicio) return false;
      if (dataFim && dataRegistro > dataFim) return false;
      if (obra && item.obra !== obra) return false;
      if (equipamento && item.equipamento !== equipamento) return false;
      if (operador && item.operador !== operador) return false;
      if (tipoDiesel && !tipoRegistro.includes(normalizar(tipoDiesel))) return false;
      if (apenasAssinados && !item.assinatura) return false;
      if (somenteAlertas && avaliarAlerta(item).nivel !== "ALERTA") return false;
      return true;
    });

    resultado.sort((a, b) => (String(a.data || "") > String(b.data || "") ? 1 : -1));
    setFiltrado(resultado);
  };

  const pesquisar = async () => {
    if (carregando) return;
    if (!dataInicio || !dataFim) {
      alert("Informe Data inicial e Data final para pesquisar (evita carregar historico inteiro).");
      return;
    }
    if (dataInicio > dataFim) {
      alert("Data inicial nao pode ser maior que a data final.");
      return;
    }

    setCarregando(true);
    try {
      const lista = await buscarDados(dataInicio, dataFim);
      setJaPesquisou(true);
      aplicarFiltros(lista);
    } finally {
      setCarregando(false);
    }
  };

  const limparFiltros = () => {
    setDataInicio(diasAtrasISO(7));
    setDataFim(hojeISO());
    setObra("");
    setEquipamento("");
    setOperador("");
    setTipoDiesel("");
    setApenasAssinados(false);
    setSomenteAlertas(false);
    setAlertarSemAssinatura(true);
    setMinLitrosAlerta("0");
    setFiltrado(dados);
  };

  const totalRegistros = filtrado.length;
  const totalLitros = filtrado.reduce((acc, item) => acc + numero(item.litros), 0);
  const totalS10 = filtrado
    .filter((item) => normalizar(item.tipo).includes("10"))
    .reduce((acc, item) => acc + numero(item.litros), 0);
  const totalS500 = filtrado
    .filter((item) => normalizar(item.tipo).includes("500"))
    .reduce((acc, item) => acc + numero(item.litros), 0);
  const totalOleo = filtrado.reduce((acc, item) => {
    const soma = (item.lubrificacoes || [])
      .filter((l) => normalizar(l.tipo).includes("OLEO"))
      .reduce((total, l) => total + numero(l.quantidade), 0);
    return acc + soma;
  }, 0);
  const totalGraxa = filtrado.reduce((acc, item) => {
    const soma = (item.lubrificacoes || [])
      .filter((l) => normalizar(l.tipo).includes("GRAXA"))
      .reduce((total, l) => total + numero(l.quantidade), 0);
    return acc + soma;
  }, 0);
  const totalValor = filtrado.reduce((acc, item) => acc + numero(item.total), 0);
  const totalAssinados = filtrado.filter((item) => !!item.assinatura).length;
  const totalAlertas = useMemo(
    () => filtrado.filter((item) => avaliarAlerta(item).nivel === "ALERTA").length,
    [filtrado] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const equipamentosEmAlerta = useMemo(() => {
    const set = new Set();
    filtrado.forEach((it) => {
      const a = avaliarAlerta(it);
      if (a.nivel === "ALERTA") {
        const key = String(it?.codigo || it?.equipamento || "").trim();
        if (key) set.add(key);
      }
    });
    return Array.from(set).sort();
  }, [filtrado]); // eslint-disable-line react-hooks/exhaustive-deps

  const resumoAlertasPorEquip = useMemo(() => {
    // Agrupa somente alertas do conjunto filtrado (respeita filtros de data/obra/etc.).
    // Para nao misturar o mesmo equipamento em obras diferentes, agrupamos por (equipamento + obra).
    const map = new Map(); // chave -> { equipKey, obraRaw, nome, codigo, alertas, litrosTotal, ultimoDt, motivosCount: Map }

    filtrado.forEach((it) => {
      const alerta = avaliarAlerta(it);
      if (alerta.nivel !== "ALERTA") return;

      const equipKey = String(it?.codigo || it?.equipamento || "").trim() || "-";
      const obraRaw = String(it?.obra || "").trim() || "-";
      const chave = `${equipKey}__${obraRaw}`;
      const nome = String(it?.equipamento || "-").trim() || "-";
      const codigo = String(it?.codigo || "").trim();
      const litros = numero(it?.litros);
      const dt = parseDataHora(it);

      const cur = map.get(chave) || {
        equipKey,
        obraRaw,
        nome,
        codigo,
        alertas: 0,
        litrosTotal: 0,
        ultimoDt: null,
        motivosCount: new Map()
      };

      cur.alertas += 1;
      cur.litrosTotal += litros;
      if (dt && (!cur.ultimoDt || dt > cur.ultimoDt)) cur.ultimoDt = dt;

      (alerta.motivos || []).forEach((m) => {
        const motivo = String(m || "").trim();
        if (!motivo) return;
        cur.motivosCount.set(motivo, (cur.motivosCount.get(motivo) || 0) + 1);
      });

      map.set(chave, cur);
    });

    const lista = Array.from(map.values()).map((r) => {
      const topMotivos = Array.from(r.motivosCount.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([motivo, qtd]) => `${motivo} (${qtd}x)`);
      return { ...r, topMotivos };
    });

    lista.sort((a, b) => {
      // primeiro por qtde de alertas, depois por ultimo horario
      if (b.alertas !== a.alertas) return b.alertas - a.alertas;
      const ta = a.ultimoDt ? a.ultimoDt.getTime() : 0;
      const tb = b.ultimoDt ? b.ultimoDt.getTime() : 0;
      return tb - ta;
    });

    return lista;
  }, [filtrado]); // eslint-disable-line react-hooks/exhaustive-deps

  const abrirDetalhesDoEquipamento = (equipKey, obraRaw) => {
    setPainelAlertas(false);
    setSomenteAlertas(true);
    setEquipamento(equipKey === "-" ? "" : equipKey);
    setObra(obraRaw && obraRaw !== "-" ? obraRaw : "");
    setTimeout(() => {
      const el = document.getElementById("tabela-abastecimentos");
      if (el?.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const gerarPDF = async () => {
    if (!filtrado.length) {
      alert("Nao ha dados para gerar o PDF!");
      return;
    }

    const pdf = new jsPDF("landscape", "mm", "a4");
    const larguraPagina = pdf.internal.pageSize.getWidth();
    const alturaPagina = pdf.internal.pageSize.getHeight();
    const margem = { top: 24, right: 10, bottom: 10, left: 10 };
    const larguraUtil = larguraPagina - margem.left - margem.right;

    const logoPdf = await resolverLogoPdf(empresaSistema);
    if (logoPdf) {
      try {
        pdf.addImage(logoPdf, formatoLogoPdf(logoPdf), margem.left, 12, 24, 12);
      } catch (e) {
        console.log("Nao foi possivel carregar a logo no PDF");
      }
    }

    pdf.setFontSize(15);
    pdf.setFont(undefined, "bold");
    pdf.text("RELATORIO DE ABASTECIMENTO", larguraPagina / 2, 16, { align: "center" });

    pdf.setFontSize(9.5);
    pdf.setFont(undefined, "normal");
    pdf.text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`, larguraPagina - margem.right, 22, {
      align: "right"
    });

    const linhas = filtrado.map((item) => {
      const alerta = avaliarAlerta(item);
        const alertaTxt = alerta.nivel === "ALERTA" ? `ALERTA: ${alerta.motivos.join("; ")}` : "OK";
        const horimetroExibicao = item.horimetroQuebrado
          ? `${item.horimetro || "-"} (quebrado)`
          : (item.horimetro || "-");
        return [
          formatarDataBR(item.data),
          item.req || "-",
          identificarObra(item.obra),
          item.equipamento || "-",
          item.codigo || "-",
          item.placa || "-",
          horimetroExibicao,
          alertaTxt,
          resumoConsumos(item),
          item.empresa || "-",
          primeiroNome(item.operador),
        primeiroNome(item.frentista),
        item.assinatura ? "ASSINADO" : "NAO"
      ];
    });

    autoTable(pdf, {
      startY: 27,
      theme: "grid",
      tableWidth: larguraUtil,
      head: [[
        "Data",
        "Req",
        "Obra",
        "Equipamento",
        "Código",
        "Placa",
        "Horimetro/KM",
        "Alerta",
        "Consumo (Diesel + Lubrificação)",
        "Empresa",
        "Operador",
        "Frentista",
        "Assinatura"
      ]],
      body: linhas,
      styles: {
        fontSize: 6.8,
        cellPadding: 1.2,
        valign: "middle",
        overflow: "linebreak"
      },
      headStyles: {
        fillColor: [11, 94, 215],
        textColor: 255,
        fontStyle: "bold",
        halign: "center"
      },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        // Coluna "Alerta" (index 7)
        if (data.column.index !== 7) return;
        const texto = String(data.cell.raw || "").toUpperCase();
        if (texto.startsWith("ALERTA")) {
          data.cell.styles.textColor = [180, 0, 0];
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [255, 232, 232];
        }
      },
      alternateRowStyles: { fillColor: [244, 247, 252] },
      margin: { left: margem.left, right: margem.right, bottom: margem.bottom }
    });

    let y = (pdf.lastAutoTable?.finalY || 170) + 4;
    if (y > alturaPagina - margem.bottom - 35) {
      pdf.addPage("a4", "landscape");
      y = margem.top;
    }

    autoTable(pdf, {
      startY: y,
      theme: "grid",
      tableWidth: larguraUtil,
      head: [["Resumo", "Valor"]],
      body: [
        ["Total de registros", totalRegistros],
        ["Diesel total", `${totalLitros.toFixed(2)} L`],
        ["Diesel S-10", `${totalS10.toFixed(2)} L`],
        ["Diesel S-500", `${totalS500.toFixed(2)} L`],
        ["Oleo total", `${totalOleo.toFixed(2)} L`],
        ["Graxa total", `${totalGraxa.toFixed(2)} KG`],
        ["Assinados", `${totalAssinados} de ${totalRegistros}`]
      ],
      styles: { fontSize: 8, cellPadding: 1.6 },
      headStyles: { fillColor: [11, 94, 215], textColor: 255, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: larguraUtil * 0.7 },
        1: { cellWidth: larguraUtil * 0.3, halign: "right" }
      },
      margin: { left: margem.left, right: margem.right, bottom: margem.bottom }
    });

    const totalPaginas = pdf.getNumberOfPages();
    for (let i = 1; i <= totalPaginas; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.text(`Pagina ${i} de ${totalPaginas}`, larguraPagina - margem.right, alturaPagina - 6, {
        align: "right"
      });
    }

    const nomePeriodo = dataInicio || dataFim
      ? `${dataInicio || "inicio"}_${dataFim || "fim"}`
      : "geral";
    pdf.save(`relatorio_abastecimento_${nomePeriodo}.pdf`);
    registrarHistorico({
      modulo: "RELATORIO_ABASTECIMENTO",
      acao: "GEROU_PDF",
      entidade: "RELATORIO_ABASTECIMENTO",
      registroId: nomePeriodo,
      usuario: operador || "-",
      descricao: `Gerou PDF de abastecimento (${nomePeriodo}).`
    });
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "18px 10px 28px", background: "#f3f5f8" }}>
      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <h2 style={{ margin: 0, color: "#0f2440" }}>Relatório de Abastecimento</h2>
          </div>
        <p style={{ margin: "8px 0 0", color: "#4a5c74" }}>
          Controle completo de diesel, lubrificantes, operadores, assinaturas e valores.
        </p>
      </div>

      <div style={{ ...card, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0, color: "#10243e" }}>Filtros</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 10,
            marginBottom: 10
          }}
        >
          <div>
            <label style={{ fontSize: 12, color: "#5a6b82" }}>Data inicial</label>
            <input
              style={baseInput}
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#5a6b82" }}>Data final</label>
            <input
              style={baseInput}
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#5a6b82" }}>Obra</label>
            <select style={baseInput} value={obra} onChange={(e) => setObra(e.target.value)}>
              <option value="">Todas</option>
              {opcoesObras.map((item) => (
                <option key={item} value={item}>{identificarObra(item)}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#5a6b82" }}>Equipamento</label>
            <select style={baseInput} value={equipamento} onChange={(e) => setEquipamento(e.target.value)}>
              <option value="">Todos</option>
              {opcoesEquipamentos.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#5a6b82" }}>Operador</label>
            <select style={baseInput} value={operador} onChange={(e) => setOperador(e.target.value)}>
              <option value="">Todos</option>
              {opcoesOperadores.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#5a6b82" }}>Tipo de Diesel</label>
            <select style={baseInput} value={tipoDiesel} onChange={(e) => setTipoDiesel(e.target.value)}>
              <option value="">Todos</option>
              <option value="S-10">S-10</option>
              <option value="S-500">S-500</option>
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={apenasAssinados}
                onChange={(e) => setApenasAssinados(e.target.checked)}
              />
              Somente assinados
            </label>
          </div>

          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={somenteAlertas}
                onChange={(e) => setSomenteAlertas(e.target.checked)}
              />
              Somente alertas
            </label>
          </div>
        </div>

        <div style={{ ...card, background: "#f8fbff", marginBottom: 10 }}>
          <div style={{ fontWeight: "bold", color: "#10243e", marginBottom: 6 }}>
            Alertas automaticos (recomendado)
          </div>
          <div style={{ fontSize: 12, color: "#5a6b82" }}>
            O sistema marca <strong>ALERTA</strong> quando detectar consumo fora do padrao do equipamento/grupo, abastecimento muito frequente,
            horimetro sem variacao, ou acima da capacidade do tanque (se cadastrado).
          </div>
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setMostrarAvancado((v) => !v)}
              style={{
                background: mostrarAvancado ? "#0b5ed7" : "#6c757d",
                border: "none",
                color: "#fff",
                borderRadius: 8,
                padding: "8px 12px",
                fontWeight: "bold",
                cursor: "pointer"
              }}
            >
              {mostrarAvancado ? "Ocultar ajustes avancados" : "Mostrar ajustes avancados"}
            </button>
          </div>
        </div>

        {mostrarAvancado && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 10,
              marginBottom: 10
            }}
          >
            <div>
              <label style={{ fontSize: 12, color: "#5a6b82" }}>Limite consumo (L/unid ou L/h) (0=off)</label>
              <input
                style={baseInput}
                value={limiteLitrosPorUnidade}
                onChange={(e) => setLimiteLitrosPorUnidade(e.target.value)}
                inputMode="decimal"
                placeholder="Ex: 25"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#5a6b82" }}>Intervalo minimo (h) entre abastecimentos (0=auto)</label>
              <input
                style={baseInput}
                value={minIntervaloHoras}
                onChange={(e) => setMinIntervaloHoras(e.target.value)}
                inputMode="decimal"
                placeholder="Ex: 1"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#5a6b82" }}>Delta minimo (horimetro/KM) (0=off)</label>
              <input
                style={baseInput}
                value={minDeltaUnidade}
                onChange={(e) => setMinDeltaUnidade(e.target.value)}
                inputMode="decimal"
                placeholder="Ex: 0.10"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#5a6b82" }}>Max abastecimentos/dia (equip.) (0=auto)</label>
              <input
                style={baseInput}
                value={maxAbastecimentosDia}
                onChange={(e) => setMaxAbastecimentosDia(e.target.value)}
                inputMode="numeric"
                placeholder="Ex: 2"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#5a6b82" }}>Limite litros/dia (0=off)</label>
              <input
                style={baseInput}
                value={limiteLitrosDia}
                onChange={(e) => setLimiteLitrosDia(e.target.value)}
                inputMode="decimal"
                placeholder="Ex: 300"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#5a6b82" }}>Comparacao (x mediana)</label>
              <input
                style={baseInput}
                value={multiplicadorComparacao}
                onChange={(e) => setMultiplicadorComparacao(e.target.value)}
                inputMode="decimal"
                placeholder="Ex: 1.60"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#5a6b82" }}>Comparacao diaria (x mediana)</label>
              <input
                style={baseInput}
                value={multiplicadorDia}
                onChange={(e) => setMultiplicadorDia(e.target.value)}
                inputMode="decimal"
                placeholder="Ex: 1.60"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#5a6b82" }}>Janela comparacao (dias)</label>
              <input
                style={baseInput}
                value={janelaComparacaoDias}
                onChange={(e) => setJanelaComparacaoDias(e.target.value)}
                inputMode="numeric"
                placeholder="Ex: 14"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#5a6b82" }}>Min litros (alerta) (0=off)</label>
              <input
                style={baseInput}
                value={minLitrosAlerta}
                onChange={(e) => setMinLitrosAlerta(e.target.value)}
                inputMode="decimal"
                placeholder="Ex: 5"
              />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={alertarSemAssinatura}
                  onChange={(e) => setAlertarSemAssinatura(e.target.checked)}
                />
                Alertar sem assinatura
              </label>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={pesquisar}
            style={{
              background: "#0b5ed7",
              border: "none",
              color: "#fff",
              borderRadius: 8,
              padding: "10px 14px",
              fontWeight: "bold",
              cursor: "pointer"
            }}
          >
            {carregando ? "Pesquisando..." : "Pesquisar"}
          </button>
          <button
            onClick={limparFiltros}
            style={{
              background: "#6c757d",
              border: "none",
              color: "#fff",
              borderRadius: 8,
              padding: "10px 14px",
              fontWeight: "bold",
              cursor: "pointer"
            }}
          >
            Limpar filtros
          </button>
          <button
            onClick={gerarPDF}
            style={{
              background: "#198754",
              border: "none",
              color: "#fff",
              borderRadius: 8,
              padding: "10px 14px",
              fontWeight: "bold",
              cursor: "pointer"
            }}
            disabled={!jaPesquisou || carregando}
          >
            Gerar PDF A4 paisagem
          </button>
          <button
            onClick={() => setPainelAlertas((v) => !v)}
            style={{
              background: painelAlertas ? "#b00000" : "#fff",
              border: `1px solid ${painelAlertas ? "#b00000" : "#cfd7e3"}`,
              color: painelAlertas ? "#fff" : "#10243e",
              borderRadius: 8,
              padding: "10px 14px",
              fontWeight: "bold",
              cursor: "pointer"
            }}
            title="Agrupa os alertas por equipamento e facilita a investigacao"
          >
            {painelAlertas ? "Voltar para tabela" : "Ver equipamentos em alerta"}
          </button>
          {podeZerarHistorico && (
            <button
              onClick={zerarHistoricoAbastecimento}
              disabled={zerandoHistorico}
              style={{
                background: "#dc3545",
                border: "none",
                color: "#fff",
                borderRadius: 8,
                padding: "10px 14px",
                fontWeight: "bold",
                cursor: zerandoHistorico ? "not-allowed" : "pointer",
                opacity: zerandoHistorico ? 0.7 : 1
              }}
              title="Apaga todos os abastecimentos desta empresa (tenant atual). Nao ajusta estoque automaticamente."
            >
              {zerandoHistorico ? "ZERANDO..." : "Zerar historico"}
            </button>
          )}
        </div>
      </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 10,
            marginBottom: 12
          }}
        >
          <div style={card}>Registros<br /><strong>{totalRegistros}</strong></div>
          <div style={card}>Diesel total<br /><strong>{totalLitros.toFixed(2)} L</strong></div>
          <div style={card}>S-10<br /><strong>{totalS10.toFixed(2)} L</strong></div>
          <div style={card}>S-500<br /><strong>{totalS500.toFixed(2)} L</strong></div>
          <div style={card}>Oleo<br /><strong>{totalOleo.toFixed(2)} L</strong></div>
          <div style={card}>Graxa<br /><strong>{totalGraxa.toFixed(2)} KG</strong></div>
          <div style={card}>Assinados<br /><strong>{totalAssinados}</strong></div>
          <div style={{ ...card, borderColor: totalAlertas ? "#f3b7b7" : "#e3e7ef", background: totalAlertas ? "#fff5f5" : "#fff" }}>
            Alertas<br /><strong style={{ color: totalAlertas ? "#b00000" : "#10243e" }}>{totalAlertas}</strong>
          </div>
          <div style={card}>Valor total<br /><strong>{formatarMoeda(totalValor)}</strong></div>
        </div>

        {!!equipamentosEmAlerta.length && (
          <div style={{ ...card, marginBottom: 12, borderColor: "#f3b7b7", background: "#fff5f5" }}>
            <strong style={{ color: "#b00000" }}>Equipamentos em alerta:</strong>{" "}
            <span style={{ color: "#10243e" }}>{equipamentosEmAlerta.join(", ")}</span>
            <div style={{ marginTop: 6, fontSize: 12, color: "#5a6b82" }}>
              Dica: passe o mouse em cima da coluna <strong>ALERTA</strong> para ver o motivo.
            </div>
          </div>
        )}

        {painelAlertas && (
          <div style={{ ...card, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ fontWeight: "bold", color: "#10243e" }}>Painel de alertas por equipamento</div>
                <div style={{ fontSize: 12, color: "#5a6b82" }}>
                  Baseado no periodo/filtros atuais. Clique em <strong>Detalhes</strong> para filtrar a tabela.
                </div>
              </div>
              <div style={{ fontSize: 12, color: "#5a6b82" }}>
                Total equipamentos em alerta: <strong style={{ color: "#b00000" }}>{resumoAlertasPorEquip.length}</strong>
              </div>
            </div>

            <div style={{ marginTop: 10, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 11 }}>
                <thead style={{ background: "#0b5ed7", color: "#fff" }}>
                  <tr>
                    {["Obra", "Equipamento", "Código", "Alertas", "Litros (alertas)", "Ultimo", "Principais motivos", "Ações"].map((t) => (
                      <th key={t} style={{ padding: "7px 6px", textAlign: "center" }}>{t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resumoAlertasPorEquip.map((r, idx) => (
                    <tr key={`${r.equipKey}__${r.obraRaw}`} style={{ background: idx % 2 === 0 ? "#f8fbff" : "#fff" }}>
                      <td style={{ padding: 6, textAlign: "center", fontWeight: "bold", wordBreak: "break-word" }}>{identificarObra(r.obraRaw)}</td>
                      <td style={{ padding: 6, textAlign: "left", wordBreak: "break-word", fontWeight: "bold" }}>{r.nome}</td>
                      <td style={{ padding: 6, textAlign: "center", wordBreak: "break-word" }}>{r.codigo || "-"}</td>
                      <td style={{ padding: 6, textAlign: "center", color: "#b00000", fontWeight: "bold" }}>{r.alertas}</td>
                      <td style={{ padding: 6, textAlign: "right", fontWeight: "bold" }}>{r.litrosTotal.toFixed(2)}</td>
                      <td style={{ padding: 6, textAlign: "center" }}>{r.ultimoDt ? r.ultimoDt.toLocaleString("pt-BR") : "-"}</td>
                      <td style={{ padding: 6, textAlign: "left", wordBreak: "break-word" }}>{r.topMotivos?.length ? r.topMotivos.join("; ") : "-"}</td>
                      <td style={{ padding: 6, textAlign: "center" }}>
                        <button
                          type="button"
                          onClick={() => abrirDetalhesDoEquipamento(r.equipKey, r.obraRaw)}
                          style={{
                            background: "#0b5ed7",
                            border: "none",
                            color: "#fff",
                            borderRadius: 8,
                            padding: "8px 12px",
                            fontWeight: "bold",
                            cursor: "pointer"
                          }}
                        >
                          Detalhes
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!resumoAlertasPorEquip.length && (
                    <tr>
                      <td colSpan={8} style={{ padding: 12, textAlign: "center", color: "#6c757d" }}>
                        Nenhum alerta encontrado com os filtros atuais.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      <div id="tabela-abastecimentos" style={{ ...card, overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
            fontSize: 11
          }}
        >
          <colgroup>
            <col style={{ width: "6%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "5%" }} />
          </colgroup>
          <thead style={{ background: "#0b5ed7", color: "#fff" }}>
            <tr>
              {[
                "Data",
                "Req",
                "Obra",
                "Equipamento",
                "Código",
                "Placa",
                "Diesel (L)",
                "Tipo",
                "Horimetro/KM",
                "Alerta",
                "Oleo",
                "Graxa",
                "Empresa",
                "Operador",
                "Frentista",
                "Assinatura",
                "Total"
              ].map((titulo) => (
                <th
                  key={titulo}
                  style={{
                    padding: "7px 5px",
                    textAlign: "center",
                    fontSize: 10,
                    lineHeight: 1.2
                  }}
                >
                  {titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtrado.map((item, idx) => {
              const alerta = avaliarAlerta(item);
              const isAlerta = alerta.nivel === "ALERTA";
              const textoAlertaCurto = isAlerta ? "ALERTA" : "OK";
              const detalhesAlerta = alerta.motivos.join("; ");
              const horimetroExibicao = item.horimetroQuebrado
                ? `${item.horimetro || "-"} (quebrado)`
                : (item.horimetro || "-");

              return (
                <tr
                  key={item.id}
                  style={{ background: isAlerta ? "#ffecec" : (idx % 2 === 0 ? "#f8fbff" : "#fff") }}
                  title={isAlerta ? detalhesAlerta : ""}
                >
                <td style={{ padding: "6px 4px", textAlign: "center", wordBreak: "break-word" }}>{formatarDataBR(item.data)}</td>
                <td style={{ padding: "6px 4px", textAlign: "center", wordBreak: "break-word" }}>{item.req || "-"}</td>
                <td style={{ padding: "6px 4px", textAlign: "center", wordBreak: "break-word" }}>{identificarObra(item.obra)}</td>
                <td style={{ padding: "6px 4px", textAlign: "center", wordBreak: "break-word" }}>{item.equipamento || "-"}</td>
                <td style={{ padding: "6px 4px", textAlign: "center", wordBreak: "break-word" }}>{item.codigo || "-"}</td>
                <td style={{ padding: "6px 4px", textAlign: "center", wordBreak: "break-word" }}>{item.placa || "-"}</td>
                <td style={{ padding: "6px 4px", textAlign: "right", fontWeight: "bold", color: "#0b5ed7", wordBreak: "break-word" }}>
                  {numero(item.litros).toFixed(2)}
                </td>
                <td style={{ padding: "6px 4px", textAlign: "center", wordBreak: "break-word" }}>{item.tipo || "-"}</td>
                <td style={{ padding: "6px 4px", textAlign: "center", wordBreak: "break-word" }}>{horimetroExibicao}</td>
                <td
                  style={{
                    padding: "6px 4px",
                    textAlign: "center",
                    fontWeight: "bold",
                    color: isAlerta ? "#b00000" : "#198754",
                    background: isAlerta ? "#ffe0e0" : "transparent",
                    wordBreak: "break-word"
                  }}
                  title={isAlerta ? detalhesAlerta : ""}
                >
                  {textoAlertaCurto}
                </td>
                <td style={{ padding: "6px 4px", wordBreak: "break-word" }}>{listaOleo(item) || "-"}</td>
                <td style={{ padding: "6px 4px", wordBreak: "break-word" }}>{listaGraxa(item) || "-"}</td>
                <td style={{ padding: "6px 4px", textAlign: "center", wordBreak: "break-word" }}>{item.empresa || "-"}</td>
                <td style={{ padding: "6px 4px", textAlign: "center", wordBreak: "break-word" }}>{primeiroNome(item.operador)}</td>
                <td style={{ padding: "6px 4px", textAlign: "center", wordBreak: "break-word" }}>{primeiroNome(item.frentista)}</td>
                <td style={{ padding: "6px 4px", textAlign: "center", fontWeight: "bold", wordBreak: "break-word" }}>
                  {item.assinatura ? "ASSINADO" : "NAO"}
                </td>
                <td style={{ padding: "6px 4px", textAlign: "right", color: "#198754", fontWeight: "bold", wordBreak: "break-word" }}>
                  {formatarMoeda(numero(item.total))}
                </td>
                </tr>
              );
            })}
            {!filtrado.length && (
              <tr>
                <td colSpan={17} style={{ padding: 14, textAlign: "center", color: "#6c757d" }}>
                  Nenhum abastecimento encontrado com os filtros atuais.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}

export default RelatorioAbastecimento;


