/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useMemo, useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import jsPDF from "jspdf";
import QRCode from "qrcode";
import { db } from "../firebase";
import { registrarHistorico } from "../utils/historico";
import { formatoLogoPdf, resolverLogoPdf } from "../utils/pdfLogo";
import { belongsToTenant, getConfigDocId, getTenantId, withTenant } from "../utils/tenant";

const MATERIAIS = ["BARRO", "BRITA", "AREIA", "ASFALTO", "DIVERSOS"];
const UNIDADES = [
  { value: "M3", label: "M³" },
  { value: "TON", label: "Ton" },
  { value: "UN", label: "Un" }
];
const COLECAO = "romaneiosTransporte";
const MODO_ROMANEIO = "ROMANEIO";
const MODO_SAIDA_SIMPLES = "SAIDA_SIMPLES";

function Transportes({ setTela }) {
  const tenantId = getTenantId();
  const PERMISSAO_TRANSPORTE_LEGADA = "transportes";
  const PERMISSAO_INFORMAR_MEIO_TRANSPORTE = "informarMeioTransporte";
  const PERMISSAO_RECEBER_TRANSPORTE = "receberTransporte";
  const sessao = (() => {
    try {
      return JSON.parse(localStorage.getItem("sessaoOperacional") || "{}");
    } catch {
      return {};
    }
  })();

  const apontadorAtual = String(sessao?.nome || localStorage.getItem("usuarioLogado") || "")
    .trim()
    .toUpperCase();
  const permissoesSessao = Array.isArray(sessao?.permissoes)
    ? sessao.permissoes.map((item) => String(item || "").trim())
    : [];
  const perfilSessao = String(sessao?.perfilAcesso || "").trim().toUpperCase();
  const acessoAdministrativoTotal = perfilSessao === "GESTOR_GERAL" || perfilSessao === "ADMIN_UNIDADE";
  const podeInformarMeioTransporte =
    acessoAdministrativoTotal ||
    permissoesSessao.includes(PERMISSAO_INFORMAR_MEIO_TRANSPORTE) ||
    permissoesSessao.includes(PERMISSAO_TRANSPORTE_LEGADA) ||
    permissoesSessao.includes("transferencias");
  const podeReceberTransporte =
    acessoAdministrativoTotal ||
    permissoesSessao.includes(PERMISSAO_RECEBER_TRANSPORTE) ||
    permissoesSessao.includes(PERMISSAO_TRANSPORTE_LEGADA) ||
    permissoesSessao.includes("transferencias");

  const assinaturaWidth = Math.min(520, Math.max(280, window.innerWidth - 70));
  const assinaturaSaidaRef = useRef(null);
  const assinaturaMotoristaRef = useRef(null);
  const suportaCompartilhamento = Boolean(window.navigator?.share);

  const [equipamentos, setEquipamentos] = useState([]);
  const [empresas, setEmpresas] = useState([]);
  const [lista, setLista] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [config, setConfig] = useState(null);
  const [modoLancamento, setModoLancamento] = useState(MODO_ROMANEIO);
  const [material, setMaterial] = useState("BARRO");
  const [descricaoMaterial, setDescricaoMaterial] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [unidade, setUnidade] = useState("M3");
  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
  const [obra, setObra] = useState("");
  const [requisitante, setRequisitante] = useState("");
  const [caminhaoId, setCaminhaoId] = useState("");
  const [veiculoAvulso, setVeiculoAvulso] = useState("");
  const [placaAvulsa, setPlacaAvulsa] = useState("");
  const [motorista, setMotorista] = useState("");
  const [observacao, setObservacao] = useState("");
  const [romaneioGerado, setRomaneioGerado] = useState(null);
  const [qrPreview, setQrPreview] = useState("");
  const [gerandoPdfId, setGerandoPdfId] = useState("");
  const [formularioAberto, setFormularioAberto] = useState(false);
  const [menuComprovanteAbertoId, setMenuComprovanteAbertoId] = useState("");

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
    height: 86,
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
    background: "#5f3dc4",
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

  const caminhoes = useMemo(() => {
    const termos = ["CAMINHAO", "CAVALO", "CARRETA", "BASCULANTE", "PIPA", "MUNCK", "PRANCHA"];
    return equipamentos.filter((item) => {
      const texto = `${item?.nome || ""} ${item?.categoria || ""} ${item?.codigo || ""}`.toUpperCase();
      return termos.some((termo) => texto.includes(termo));
    });
  }, [equipamentos]);

  const caminhaoSelecionado = useMemo(
    () => caminhoes.find((item) => item.id === caminhaoId) || null,
    [caminhoes, caminhaoId]
  );

  const carregar = async () => {
    const [snapEquip, snapEmpresas, snapLista, snapConfig] = await Promise.all([
      getDocs(collection(db, "equipamentos")),
      getDocs(collection(db, "empresas")),
      getDocs(collection(db, COLECAO)),
      getDoc(doc(db, "configuracoes", getConfigDocId(tenantId)))
    ]);

    const listaEquip = snapEquip.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId))
      .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));
    setEquipamentos(listaEquip);

    const listaEmpresas = snapEmpresas.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId))
      .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));
    setEmpresas(listaEmpresas);

    const transportes = snapLista.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId))
      .sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")));
    setLista(transportes);
    setConfig(snapConfig.exists() ? snapConfig.data() : null);
  };

  useEffect(() => {
    carregar();
  }, []);

  useEffect(() => {
    if (!caminhaoSelecionado) return;
    if (!motorista.trim()) {
      setMotorista(String(caminhaoSelecionado.motoristaPadrao || caminhaoSelecionado.motorista || "").trim().toUpperCase());
    }
  }, [caminhaoSelecionado]);

  useEffect(() => {
    if (material === "DIVERSOS" && (unidade === "M3" || unidade === "TON")) {
      setUnidade("UN");
    }
  }, [material]);

  const limpar = () => {
    setModoLancamento(MODO_ROMANEIO);
    setMaterial("BARRO");
    setDescricaoMaterial("");
    setQuantidade("");
    setUnidade("M3");
    setOrigem("");
    setDestino("");
    setObra("");
    setRequisitante("");
    setCaminhaoId("");
    setVeiculoAvulso("");
    setPlacaAvulsa("");
    setMotorista("");
    setObservacao("");
    assinaturaSaidaRef.current?.clear();
    assinaturaMotoristaRef.current?.clear();
  };

  const obterLocalizacao = () =>
    new Promise((resolve) => {
      if (!navigator?.geolocation) {
        resolve({ indisponivel: true });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            precisao: pos.coords.accuracy || null
          }),
        () => resolve({ indisponivel: true }),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    });

  const normalizarOrigemChave = (valor) =>
    String(valor || "")
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .replace(/[^A-Z0-9]/g, "_");

  const montarNumeroSequencial = (origemValor) => {
    const origemChave = normalizarOrigemChave(origemValor);
    const maiorAtual = lista
      .filter((item) => normalizarOrigemChave(item.origemChave || item.origem) === origemChave)
      .map((item) => Number(item.numeroSequencial || 0))
      .filter((num) => Number.isFinite(num) && num > 0)
      .reduce((max, atual) => (atual > max ? atual : max), 0);
    const proximo = maiorAtual + 1;
    return {
      numeroSequencial: proximo,
      numeroExibicao: String(proximo).padStart(3, "0"),
      origemChave
    };
  };

  const montarNumeroRomaneio = (sequencial) => {
    const agora = new Date();
    const y = agora.getFullYear();
    const m = String(agora.getMonth() + 1).padStart(2, "0");
    const d = String(agora.getDate()).padStart(2, "0");
    return `RT-${y}${m}${d}-${String(sequencial || "").padStart(3, "0")}`;
  };

  const montarPayloadQr = (docId) => `EG_TRANSPORTE|${tenantId}|${docId}`;

  const gerarPdfRomaneio = async (item, acao = "download") => {
    if (!item?.id) return;
    setGerandoPdfId(item.id);
    try {
      const payload = String(item.qrPayload || "").trim();
      const exibirQr = Boolean(payload);
      let qrDataUrl = "";
      if (exibirQr) {
        qrDataUrl = await QRCode.toDataURL(payload, {
          margin: 1,
          width: 900,
          errorCorrectionLevel: "H"
        });
      }

      const pageHeight = exibirQr ? 240 : 210;
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: [80, pageHeight]
      });
      const logoBase64 = await resolverLogoPdf(config);
      if (logoBase64) {
        try {
          pdf.addImage(logoBase64, formatoLogoPdf(logoBase64), 28, 5, 24, 10);
        } catch {
          // segue sem logo
        }
      }

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.text("COMPROVANTE", 40, 20, { align: "center" });
      pdf.text("DE TRANSPORTE", 40, 25, { align: "center" });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      pdf.text(String(config?.nome || "Equipamento Gestão"), 40, 31, { align: "center" });
      pdf.text(`Romaneio: ${item.numero || "-"}`, 40, 35, { align: "center" });

      let y = 46;
      const linha = (rotulo, valor) => {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(7);
        pdf.text(`${rotulo}:`, 10, y);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(7);
        const texto = pdf.splitTextToSize(String(valor || "-"), 28);
        pdf.text(texto, 34, y);
        y += Math.max(4.5, texto.length * 3.8);
      };

      linha("Data/hora da saída", new Date(item.dataHoraSaida || item.criadoEm || Date.now()).toLocaleString("pt-BR"));
      linha("Tipo", item.tipoTransporte || "-");
      linha("Material", item.materialLabel || item.material || "-");
      linha("Quantidade", `${item.quantidade || "-"} ${item.unidade || ""}`.trim());
      linha("Origem", item.origem || "-");
      linha("Destino", item.destino || "-");
      linha("Requisitante", item.requisitante || "-");
      if (String(item.obra || "").trim()) linha("Obra / Frente", item.obra);
        linha(item.tipoTransporte === "SAIDA_SIMPLES" ? "Veiculo" : "Caminhao", item.caminhaoNome || "-");
        linha("Placa", item.placa || "-");
        linha("Motorista", item.motorista || "-");
      linha("Apontador da saída", item.apontadorSaida || "-");
      const statusLabel = String(item.status || "")
        .trim()
        .toUpperCase()
        .replace(/_/g, " ");
      linha("Status", statusLabel || "-");

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7);
      pdf.text("Observação:", 10, y);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      const obsQuebrada = pdf.splitTextToSize(String(item.observacao || "-"), 58);
      pdf.text(obsQuebrada, 10, y + 4);
      y += 7 + obsQuebrada.length * 3.8;

      const assinaturaSaida = String(item.assinaturaSaida || "");
      const assinaturaMotorista = String(item.assinaturaMotorista || "");
      if (assinaturaSaida || assinaturaMotorista) {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(7);
        pdf.text("Assinaturas", 10, y);
        y += 4;
        pdf.setFontSize(6);
        pdf.text("Apontador da saída", 24, y + 4, { align: "center" });
        pdf.text("Motorista", 56, y + 4, { align: "center" });
        if (assinaturaSaida) {
          pdf.addImage(assinaturaSaida, "PNG", 10, y + 6, 28, 12);
        }
        if (assinaturaMotorista) {
          pdf.addImage(assinaturaMotorista, "PNG", 42, y + 6, 28, 12);
        }
        y += 22;
      }

      if (exibirQr) {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8);
        pdf.text("QR do romaneio", 40, y, { align: "center" });
        pdf.addImage(qrDataUrl, "PNG", 20, y + 4, 40, 40);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(7);
        pdf.text(`Código manual: ${item.numero || item.id}`, 40, y + 49, { align: "center" });
      } else {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8);
        pdf.text("Saída simples concluída", 40, y + 6, { align: "center" });
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(7);
        const aviso = pdf.splitTextToSize(
          "Conferência realizada na origem com assinatura do apontador e do motorista. Este comprovante não exige recebimento no destino.",
          54
        );
        pdf.text(aviso, 40, y + 14, { align: "center" });
      }

      const nomeArquivo = `romaneio_transporte_${String(item.numero || item.id || "sem_numero").toLowerCase()}.pdf`;
      if (acao === "share" && suportaCompartilhamento) {
        const blob = pdf.output("blob");
        const arquivo = new File([blob], nomeArquivo, { type: "application/pdf" });
        try {
          if (window.navigator?.canShare?.({ files: [arquivo] })) {
            await window.navigator.share({
              title: `Romaneio ${item.numero || ""}`.trim(),
              text: `Comprovante do romaneio ${item.numero || ""}`.trim(),
              files: [arquivo]
            });
          } else {
            await window.navigator.share({
              title: `Romaneio ${item.numero || ""}`.trim(),
              text: `Comprovante do romaneio ${item.numero || ""}`.trim()
            });
            pdf.save(nomeArquivo);
          }
        } catch (erroShare) {
          if (String(erroShare?.name || "") !== "AbortError") {
            pdf.save(nomeArquivo);
          }
        }
      } else {
        pdf.save(nomeArquivo);
      }
    } finally {
      setGerandoPdfId("");
    }
  };

  const formatarLocalizacao = (local) => {
    const lat = Number(local?.lat);
    const lng = Number(local?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "Não informada";
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  };

  const linkMapa = (local) => {
    const lat = Number(local?.lat);
    const lng = Number(local?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
    return `https://www.google.com/maps?q=${lat},${lng}`;
  };

  const formatarStatusTabela = (status) => {
    const chave = String(status || "").trim().toUpperCase();
    const mapa = {
      EM_TRANSITO: "Em trânsito",
      RECEBIDO: "Recebido",
      DIVERGENCIA: "Com divergência",
      SAIDA_SIMPLES_CONCLUIDA: "Saída simples concluída",
      CANCELADO: "Cancelado"
    };
    return mapa[chave] || String(status || "-").replace(/_/g, " ");
  };

  const salvar = async () => {
    if (salvando) return;
      if (!quantidade || Number(String(quantidade).replace(",", ".")) <= 0) return alert("Informe a quantidade.");
      if (!origem.trim()) return alert("Informe a origem.");
      if (!destino.trim()) return alert("Informe o destino.");
      if (!requisitante.trim()) return alert("Informe a empresa requisitante.");
      if (modoLancamento === MODO_ROMANEIO && !caminhaoSelecionado) return alert("Selecione o caminhao.");
    if (modoLancamento === MODO_SAIDA_SIMPLES && !veiculoAvulso.trim()) return alert("Informe o veiculo.");
    if (modoLancamento === MODO_SAIDA_SIMPLES && !placaAvulsa.trim()) return alert("Informe a placa do caminhao.");
    if (!motorista.trim()) return alert("Informe o motorista.");
    if (material === "DIVERSOS" && !descricaoMaterial.trim()) return alert("Descreva o material diverso.");

    const assinaturaSaida = assinaturaSaidaRef.current?.isEmpty()
      ? ""
      : assinaturaSaidaRef.current.getCanvas().toDataURL("image/png");
    const assinaturaMotorista = assinaturaMotoristaRef.current?.isEmpty()
      ? ""
      : assinaturaMotoristaRef.current.getCanvas().toDataURL("image/png");

    if (!assinaturaSaida) return alert("A assinatura do apontador da saida e obrigatoria.");
    if (!assinaturaMotorista) return alert("A assinatura do motorista e obrigatoria.");

      setSalvando(true);
      try {
        const { numeroSequencial, numeroExibicao, origemChave } = montarNumeroSequencial(origem);
        const numeroFinal = montarNumeroRomaneio(numeroExibicao);
        const localSaida = modoLancamento === MODO_ROMANEIO ? await obterLocalizacao() : null;
      const ref = doc(collection(db, COLECAO));
      const qrPayload = modoLancamento === MODO_ROMANEIO ? montarPayloadQr(ref.id) : "";
        const caminhaoNomeFinal = modoLancamento === MODO_ROMANEIO
          ? String(caminhaoSelecionado?.nome || "").trim().toUpperCase()
          : String(veiculoAvulso || "").trim().toUpperCase();
      const placaFinal = modoLancamento === MODO_ROMANEIO
        ? String(caminhaoSelecionado?.placa || "").trim().toUpperCase()
        : String(placaAvulsa || "").trim().toUpperCase();
      const statusFinal = modoLancamento === MODO_SAIDA_SIMPLES ? "SAIDA_SIMPLES_CONCLUIDA" : "EM_TRANSITO";
      const tipoFinal = modoLancamento === MODO_SAIDA_SIMPLES
        ? "SAIDA_SIMPLES"
        : (material === "DIVERSOS" ? "DIVERSOS" : "MATERIAL");

      await setDoc(
        ref,
        withTenant(
          {
            numero: numeroFinal,
            numeroSequencial,
            tipoTransporte: tipoFinal,
            material,
            materialLabel: material === "DIVERSOS" ? String(descricaoMaterial || "").trim().toUpperCase() : material,
            descricaoMaterial: String(descricaoMaterial || "").trim().toUpperCase(),
            quantidade: Number(String(quantidade).replace(",", ".")),
            unidade,
              origem: String(origem || "").trim().toUpperCase(),
              origemChave,
              destino: String(destino || "").trim().toUpperCase(),
              obra: modoLancamento === MODO_ROMANEIO ? String(obra || "").trim().toUpperCase() : "",
              requisitante: String(requisitante || "").trim().toUpperCase(),
             caminhaoId: modoLancamento === MODO_ROMANEIO ? caminhaoSelecionado.id : "",
            caminhaoNome: caminhaoNomeFinal,
            caminhaoCodigo: modoLancamento === MODO_ROMANEIO ? String(caminhaoSelecionado.codigo || "").trim().toUpperCase() : "",
            placa: placaFinal,
            motorista: String(motorista || "").trim().toUpperCase(),
            observacao: String(observacao || "").trim().toUpperCase(),
            status: statusFinal,
            apontadorSaida: apontadorAtual || "APONTADOR",
            assinaturaSaida,
            assinaturaMotorista,
            assinaturaRecebimento: "",
            recebidoStatus: "",
            observacaoRecebimento: "",
            qrPayload,
            usaRecebimentoDestino: modoLancamento === MODO_ROMANEIO,
            criadoEm: new Date().toISOString(),
            dataHoraSaida: new Date().toISOString(),
            dataHoraRecebimento: "",
            localSaida,
            localRecebimento: null
          },
          tenantId
        )
      );

      await registrarHistorico({
        modulo: "TRANSPORTE",
        acao: "CRIOU",
        entidade: "ROMANEIO_TRANSPORTE",
        registroId: ref.id,
        usuario: apontadorAtual || "-",
        descricao: modoLancamento === MODO_SAIDA_SIMPLES
          ? `Registrou saída simples ${numeroFinal} para ${String(destino || "").trim().toUpperCase()}.`
          : `Criou romaneio de transporte ${numeroFinal} para ${String(destino || "").trim().toUpperCase()}.`
      });

      setRomaneioGerado({
        id: ref.id,
        numero: numeroFinal,
        qrPayload,
        tipoTransporte: tipoFinal
      });
      if (qrPayload) {
        setQrPreview(await QRCode.toDataURL(qrPayload, { margin: 1, width: 360, errorCorrectionLevel: "H" }));
      } else {
        setQrPreview("");
      }
      limpar();
      await carregar();
      alert(modoLancamento === MODO_SAIDA_SIMPLES ? "Saida simples registrada com sucesso." : "Romaneio criado com sucesso.");
    } catch (e) {
      alert(`Falha ao criar romaneio. Detalhes: ${String(e?.message || e || "")}`);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "18px 10px 28px", background: "#f3f5f8" }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0, color: "#10243e" }}>Romaneio de Transporte</h2>
            <div style={{ marginTop: 4, fontSize: 12, color: "#5a6b82" }}>
              Acompanhe os romaneios abaixo e abra o lancamento so quando precisar.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                setModoLancamento(MODO_ROMANEIO);
                setFormularioAberto((prev) => !prev || modoLancamento !== MODO_ROMANEIO);
              }}
              style={botaoPrimario}
              disabled={!podeInformarMeioTransporte}
            >
              {!podeInformarMeioTransporte
                ? "Sem permissão para lançar"
                : (formularioAberto && modoLancamento === MODO_ROMANEIO ? "Esconder lancamento" : "Novo romaneio")}
            </button>
            <button
              type="button"
              onClick={() => {
                setModoLancamento(MODO_SAIDA_SIMPLES);
                setFormularioAberto(true);
              }}
              style={{ ...botaoSecundario, background: "#fff4e6", borderColor: "#ffd8a8", color: "#9a4d00" }}
              disabled={!podeInformarMeioTransporte}
            >
              Saída simples
            </button>
            {podeReceberTransporte && (
              <button type="button" onClick={() => setTela("receberTransporte")} style={botaoSecundario}>
                Receber transporte
              </button>
            )}
            <button type="button" onClick={() => setTela("home")} style={{ ...botaoSecundario, background: "#f1f3f5", borderColor: "#dee2e6" }}>
              Voltar
            </button>
          </div>
        </div>
      </div>

      {formularioAberto && (
      <div style={card}>
        {!podeInformarMeioTransporte ? (
          <div style={{ background: "#fff3cd", border: "1px solid #ffe69c", color: "#7a5b00", borderRadius: 8, padding: 12, fontWeight: 700 }}>
            Este usuário não tem permissão para informar meio de transporte ou gerar romaneio.
          </div>
        ) : (
        <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Material</div>
            <select value={material} onChange={(e) => setMaterial(e.target.value)} style={inputStyle}>
              {MATERIAIS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Quantidade</div>
            <input value={quantidade} onChange={(e) => setQuantidade(e.target.value)} style={inputStyle} placeholder="Ex.: 10" />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Unidade</div>
            <select value={unidade} onChange={(e) => setUnidade(e.target.value)} style={inputStyle}>
              {UNIDADES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
          {material === "DIVERSOS" && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Descrição do material</div>
              <input value={descricaoMaterial} onChange={(e) => setDescricaoMaterial(e.target.value)} style={inputStyle} placeholder="Ex.: MADEIRA, FERRAGEM, PECAS" />
            </div>
          )}
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Origem</div>
            <input value={origem} onChange={(e) => setOrigem(e.target.value)} style={inputStyle} placeholder={modoLancamento === MODO_SAIDA_SIMPLES ? "Ex.: JAZIDA CENTRAL" : "Ex.: DEPOSITO CENTRAL"} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Destino</div>
            <input value={destino} onChange={(e) => setDestino(e.target.value)} style={inputStyle} placeholder={modoLancamento === MODO_SAIDA_SIMPLES ? "Ex.: ENTREGA AVULSA / CLIENTE" : "Ex.: OBRA 072 / PISTA KM 12"} />
          </div>
          {modoLancamento === MODO_ROMANEIO ? (
            <>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Obra / frente</div>
                <input value={obra} onChange={(e) => setObra(e.target.value)} style={inputStyle} placeholder="Ex.: 072" />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Empresa requisitante</div>
                <select value={requisitante} onChange={(e) => setRequisitante(e.target.value.toUpperCase())} style={inputStyle}>
                  <option value="">Selecione</option>
                  {empresas.map((item) => (
                    <option key={item.id} value={String(item.nome || "").trim().toUpperCase()}>
                      {String(item.nome || "").trim().toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Caminhao</div>
                <select value={caminhaoId} onChange={(e) => setCaminhaoId(e.target.value)} style={inputStyle}>
                  <option value="">Selecione</option>
                  {caminhoes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {`${item.nome || "CAMINHAO"}${item.codigo ? ` - ${item.codigo}` : ""}${item.placa ? ` (${item.placa})` : ""}`}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Empresa requisitante</div>
                <input value={requisitante} onChange={(e) => setRequisitante(e.target.value.toUpperCase())} style={inputStyle} placeholder="Ex.: PREFEITURA / CLIENTE / EMPRESA" />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Veiculo</div>
                <input value={veiculoAvulso} onChange={(e) => setVeiculoAvulso(e.target.value.toUpperCase())} style={inputStyle} placeholder="Ex.: CACAMBA TRUCADA / CARRETA / TRATOR" />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Placa do caminhao</div>
                <input value={placaAvulsa} onChange={(e) => setPlacaAvulsa(e.target.value.toUpperCase())} style={inputStyle} placeholder="Ex.: ABC-1234" />
              </div>
            </>
          )}
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Motorista</div>
            <input value={motorista} onChange={(e) => setMotorista(e.target.value.toUpperCase())} style={inputStyle} placeholder="Nome do motorista" />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Observação</div>
            <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} style={areaStyle} placeholder="Opcional" />
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: "#5a6b82" }}>
          {modoLancamento === MODO_SAIDA_SIMPLES
            ? "Use saída simples para material avulso da jazida ou venda direta. A conferência acontece na assinatura do motorista, sem recebimento no destino."
            : "A viagem já é o próprio romaneio. Aqui você informa só o material, a quantidade, a unidade e os dados da carga."}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginTop: 14 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>
              Assinatura do apontador da saída
            </div>
            <div style={{ border: "1px solid #dbe3ef", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
              <SignatureCanvas
                ref={assinaturaSaidaRef}
                penColor="black"
                canvasProps={{ width: assinaturaWidth, height: 150, style: { width: "100%", height: 150, display: "block" } }}
              />
            </div>
            <button type="button" onClick={() => assinaturaSaidaRef.current?.clear()} style={{ ...botaoSecundario, marginTop: 8 }}>
              Limpar assinatura
            </button>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Assinatura do motorista</div>
            <div style={{ border: "1px solid #dbe3ef", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
              <SignatureCanvas
                ref={assinaturaMotoristaRef}
                penColor="black"
                canvasProps={{ width: assinaturaWidth, height: 150, style: { width: "100%", height: 150, display: "block" } }}
              />
            </div>
            <button type="button" onClick={() => assinaturaMotoristaRef.current?.clear()} style={{ ...botaoSecundario, marginTop: 8 }}>
              Limpar assinatura
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
          <button type="button" onClick={salvar} disabled={salvando} style={{ ...botaoPrimario, opacity: salvando ? 0.7 : 1 }}>
            {salvando ? "Salvando..." : (modoLancamento === MODO_SAIDA_SIMPLES ? "Registrar saída simples" : "Gerar romaneio")}
          </button>
          <button type="button" onClick={limpar} style={botaoSecundario}>
            Limpar formulario
          </button>
        </div>
        </>
        )}
      </div>
      )}

      {romaneioGerado && (
        <div style={card}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 12, color: "#5a6b82", fontWeight: 700 }}>Ultimo romaneio criado</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#10243e", marginTop: 4 }}>{romaneioGerado.numero}</div>
              <div style={{ marginTop: 6, fontSize: 12, color: "#5a6b82" }}>
                {romaneioGerado.tipoTransporte === "SAIDA_SIMPLES"
                  ? "Saída simples concluída na conferência do motorista. Este registro já entra no relatório positivo de material."
                  : "O motorista pode levar este QR em print, PDF ou WhatsApp. No destino, use a tela de recebimento."}
              </div>
            </div>
            {qrPreview && (
              <img src={qrPreview} alt="QR do romaneio" style={{ width: 150, height: 150, objectFit: "contain", background: "#fff" }} />
            )}
          </div>
        </div>
      )}

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <h3 style={{ margin: 0, color: "#10243e" }}>Romaneios recentes</h3>
          <div style={{ fontSize: 12, color: "#5a6b82" }}>{lista.length} registro(s)</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1180, tableLayout: "fixed" }}>
            <thead style={{ background: "#f1f3f5" }}>
              <tr>
                {["Número", "Material", "Qtd.", "Origem", "Destino", "Requisitante", "Locais", "Caminhao", "Motorista", "Status", "Ações"].map((col) => (
                  <th key={col} style={{ border: "1px solid #e5ebf3", padding: "7px 6px", fontSize: 11, color: "#173454", textAlign: "center", verticalAlign: "middle" }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!lista.length && (
                <tr>
                  <td colSpan="11" style={{ border: "1px solid #e5ebf3", padding: 12, textAlign: "center", color: "#5a6b82" }}>
                    Nenhum romaneio criado ainda.
                  </td>
                </tr>
              )}
              {lista.slice(0, 20).map((item) => (
                <tr key={item.id} style={{ background: String(item.status || "").toUpperCase() === "RECEBIDO" ? "#f3fff8" : "#fff" }}>
                  <td style={{ border: "1px solid #e5ebf3", padding: "8px 6px", fontWeight: 800, textAlign: "center", verticalAlign: "middle", fontSize: 12, lineHeight: 1.2, wordBreak: "break-word" }}>{item.numero || "-"}</td>
                  <td style={{ border: "1px solid #e5ebf3", padding: "8px 6px", textAlign: "center", verticalAlign: "middle", fontSize: 12, lineHeight: 1.2, wordBreak: "break-word" }}>{item.materialLabel || item.material || "-"}</td>
                  <td style={{ border: "1px solid #e5ebf3", padding: "8px 6px", textAlign: "center", verticalAlign: "middle", fontSize: 12, lineHeight: 1.2, wordBreak: "break-word" }}>{`${item.quantidade || "-"} ${item.unidade || ""}`}</td>
                  <td style={{ border: "1px solid #e5ebf3", padding: "8px 6px", textAlign: "center", verticalAlign: "middle", fontSize: 12, lineHeight: 1.2, wordBreak: "break-word" }}>{item.origem || "-"}</td>
                  <td style={{ border: "1px solid #e5ebf3", padding: "8px 6px", textAlign: "center", verticalAlign: "middle", fontSize: 12, lineHeight: 1.2, wordBreak: "break-word" }}>{item.destino || "-"}</td>
                  <td style={{ border: "1px solid #e5ebf3", padding: "8px 6px", textAlign: "center", verticalAlign: "middle", fontSize: 12, lineHeight: 1.2, wordBreak: "break-word" }}>{item.requisitante || "-"}</td>
                  <td style={{ border: "1px solid #e5ebf3", padding: "8px 6px", fontSize: 11, textAlign: "center", verticalAlign: "middle", lineHeight: 1.2, wordBreak: "break-word" }}>
                    <div><strong>Saída:</strong> {formatarLocalizacao(item.localSaida)}</div>
                    {linkMapa(item.localSaida) && (
                      <div>
                        <a href={linkMapa(item.localSaida)} target="_blank" rel="noreferrer">Mapa saída</a>
                      </div>
                    )}
                    <div style={{ marginTop: 4 }}><strong>Receb.:</strong> {formatarLocalizacao(item.localRecebimento)}</div>
                    {linkMapa(item.localRecebimento) && (
                      <div>
                        <a href={linkMapa(item.localRecebimento)} target="_blank" rel="noreferrer">Mapa receb.</a>
                      </div>
                    )}
                  </td>
                  <td style={{ border: "1px solid #e5ebf3", padding: "8px 6px", textAlign: "center", verticalAlign: "middle", fontSize: 12, lineHeight: 1.2, wordBreak: "break-word" }}>{item.caminhaoNome || item.veiculo || "-"}</td>
                  <td style={{ border: "1px solid #e5ebf3", padding: "8px 6px", textAlign: "center", verticalAlign: "middle", fontSize: 12, lineHeight: 1.2, wordBreak: "break-word" }}>{item.motorista || "-"}</td>
                  <td style={{ border: "1px solid #e5ebf3", padding: "8px 6px", textAlign: "center", verticalAlign: "middle" }}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "5px 8px",
                        borderRadius: 999,
                        background: "#f4f0ff",
                        color: "#5f3dc4",
                        fontWeight: 800,
                        fontSize: 10,
                        lineHeight: 1.15,
                        maxWidth: 120
                      }}
                    >
                      {formatarStatusTabela(item.status)}
                    </span>
                  </td>
                    <td style={{ border: "1px solid #e5ebf3", padding: "8px 6px", textAlign: "center", verticalAlign: "middle" }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", position: "relative" }}>
                        {item.qrPayload && (
                          <button
                            type="button"
                          onClick={async () => {
                            setRomaneioGerado({ id: item.id, numero: item.numero, qrPayload: item.qrPayload, tipoTransporte: item.tipoTransporte });
                            setQrPreview(await QRCode.toDataURL(String(item.qrPayload || montarPayloadQr(item.id)), { margin: 1, width: 360, errorCorrectionLevel: "H" }));
                          }}
                          style={botaoSecundario}
                          >
                            Ver QR
                          </button>
                        )}
                        <div style={{ position: "relative" }}>
                          <button
                            type="button"
                            onClick={() => setMenuComprovanteAbertoId((prev) => (prev === item.id ? "" : item.id))}
                            disabled={gerandoPdfId === item.id}
                            style={{ ...botaoSecundario, opacity: gerandoPdfId === item.id ? 0.7 : 1, padding: "8px 12px", fontSize: 12 }}
                          >
                            {gerandoPdfId === item.id ? "Gerando..." : "Comprovante"}
                          </button>
                          {menuComprovanteAbertoId === item.id && (
                            <div
                              style={{
                                position: "absolute",
                                top: "calc(100% + 6px)",
                                right: 0,
                                minWidth: 170,
                                background: "#fff",
                                border: "1px solid #dbe3ef",
                                borderRadius: 10,
                                boxShadow: "0 12px 24px rgba(16,36,62,0.14)",
                                padding: 8,
                                zIndex: 20,
                                display: "grid",
                                gap: 6
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuComprovanteAbertoId("");
                                  gerarPdfRomaneio(item);
                                }}
                                style={{ ...botaoSecundario, width: "100%", textAlign: "left" }}
                              >
                                Baixar PDF
                              </button>
                              {suportaCompartilhamento && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMenuComprovanteAbertoId("");
                                    gerarPdfRomaneio(item, "share");
                                  }}
                                  style={{ ...botaoSecundario, width: "100%", textAlign: "left" }}
                                >
                                  Compartilhar
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Transportes;

