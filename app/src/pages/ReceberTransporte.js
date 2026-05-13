/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import { BrowserQRCodeReader } from "@zxing/browser";
import { collection, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { registrarHistorico } from "../utils/historico";
import {
  atualizarRecebimentoTransportePendente,
  listarRecebimentosTransportePendentes,
  removerRecebimentoTransportePendente,
  salvarRecebimentoTransportePendente
} from "../utils/offlineReceberTransporte";
import { belongsToTenant, getTenantId, withTenant } from "../utils/tenant";

const COLECAO = "romaneiosTransporte";

function ReceberTransporte({ setTela }) {
  const tenantId = getTenantId();
  const sessao = (() => {
    try {
      return JSON.parse(localStorage.getItem("sessaoOperacional") || "{}");
    } catch {
      return {};
    }
  })();

  const recebedorAtual = String(sessao?.nome || localStorage.getItem("usuarioLogado") || "")
    .trim()
    .toUpperCase();
  const assinaturaWidth = Math.min(520, Math.max(280, window.innerWidth - 70));

  const assinaturaRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const readerRef = useRef(null);
  const controlsRef = useRef(null);

  const [scaneando, setScaneando] = useState(false);
  const [erroScan, setErroScan] = useState("");
  const [codigoManual, setCodigoManual] = useState("");
  const [romaneio, setRomaneio] = useState(null);
  const [situacao, setSituacao] = useState("RECEBIDO_TOTAL");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [pendenciasOffline, setPendenciasOffline] = useState([]);
  const [sincronizandoPendencias, setSincronizandoPendencias] = useState(false);
  const [mensagemSincronizacao, setMensagemSincronizacao] = useState("");

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

  const pararScan = () => {
    setScaneando(false);
    try {
      if (controlsRef.current) controlsRef.current.stop();
      controlsRef.current = null;
    } catch {}
    try {
      if (readerRef.current) readerRef.current.reset();
    } catch {}
    try {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    } catch {}
  };

  useEffect(() => () => pararScan(), []);

  useEffect(() => {
    const aoFicarOnline = () => setIsOnline(true);
    const aoFicarOffline = () => setIsOnline(false);
    window.addEventListener("online", aoFicarOnline);
    window.addEventListener("offline", aoFicarOffline);
    return () => {
      window.removeEventListener("online", aoFicarOnline);
      window.removeEventListener("offline", aoFicarOffline);
    };
  }, []);

  const atualizarPendencias = async () => {
    const itens = await listarRecebimentosTransportePendentes(tenantId);
    setPendenciasOffline(itens);
    return itens;
  };

  useEffect(() => {
    atualizarPendencias();
  }, [tenantId]);

  const parsePayload = (texto) => {
    const raw = String(texto || "").trim();
    if (!raw) return null;
    if (raw.startsWith("EG_TRANSPORTE|")) {
      const parts = raw.split("|");
      if (parts.length >= 3) return { tenant: parts[1], id: parts[2] };
    }
    return null;
  };

  const buscarPorQr = async (texto) => {
    setErroScan("");
    setRomaneio(null);
    const parsed = parsePayload(texto);
    if (!parsed) {
      setErroScan("QR invalido. Gere novamente o romaneio.");
      return;
    }
    if (String(parsed.tenant || "").trim() !== String(tenantId || "").trim()) {
      setErroScan("Este QR nao pertence a esta empresa.");
      return;
    }
    if (!navigator.onLine) {
      setRomaneio({
        id: parsed.id,
        numero: "ROMANEIO EM MODO OFFLINE",
        tipoTransporte: "PENDENTE DE VALIDACAO",
        materialLabel: "Dados completos serao validados na sincronizacao",
        quantidade: "-",
        unidade: "",
        origem: "-",
        destino: "-",
        obra: "-",
        caminhaoNome: "-",
        motorista: "-",
        status: "PENDENTE"
      });
      setCodigoManual(parsed.id);
      setMensagemSincronizacao("QR lido offline. O recebimento ficara salvo no celular e sera validado na sincronizacao.");
      return;
    }
    const snap = await getDoc(doc(db, COLECAO, parsed.id));
    if (!snap.exists()) {
      setErroScan("Romaneio nao encontrado.");
      return;
    }
    const data = { id: snap.id, ...snap.data() };
    if (!belongsToTenant(data, tenantId)) {
      setErroScan("Romaneio nao pertence a esta empresa.");
      return;
    }
    if (String(data.tipoTransporte || "").trim().toUpperCase() === "SAIDA_SIMPLES") {
      setErroScan("Esta saida simples e concluida na origem e nao exige recebimento no destino.");
      return;
    }
    setRomaneio(data);
    setCodigoManual(data.numero || "");
  };

  const buscarManual = async () => {
    const alvo = String(codigoManual || "").trim().toUpperCase();
    if (!alvo) return alert("Informe o numero do romaneio.");
    if (!navigator.onLine) {
      alert("Sem internet, a busca manual nao consegue localizar o romaneio. No offline use a leitura do QR.");
      return;
    }
    setErroScan("");
    setRomaneio(null);
    const snap = await getDocs(collection(db, COLECAO));
    const item = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((data) => belongsToTenant(data, tenantId))
      .find((data) => String(data.numero || "").trim().toUpperCase() === alvo || String(data.id || "").trim().toUpperCase() === alvo);
    if (!item) {
      setErroScan("Romaneio nao encontrado.");
      return;
    }
    if (String(item.tipoTransporte || "").trim().toUpperCase() === "SAIDA_SIMPLES") {
      setErroScan("Esta saida simples e concluida na origem e nao exige recebimento no destino.");
      return;
    }
    setRomaneio(item);
  };

  const iniciarScan = async () => {
    setErroScan("");
    setRomaneio(null);
    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        setErroScan("Camera indisponivel neste navegador.");
        return;
      }
      if (!readerRef.current) readerRef.current = new BrowserQRCodeReader();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute("playsinline", "true");
        await videoRef.current.play().catch(() => {});
      }
      setScaneando(true);
      setTimeout(async () => {
        try {
          if (!videoRef.current) return;
          controlsRef.current = await readerRef.current.decodeFromVideoElement(videoRef.current, (result) => {
            if (result?.getText) {
              const raw = String(result.getText() || "").trim();
              if (raw) {
                pararScan();
                buscarPorQr(raw);
              }
            }
          });
        } catch (e) {
          setErroScan(`Falha ao iniciar leitura. Detalhes: ${String(e?.message || e || "")}`);
        }
      }, 250);
    } catch (e) {
      pararScan();
      setErroScan(`Nao foi possivel abrir a camera. Detalhes: ${String(e?.message || e || "")}`);
    }
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

  const persistirRecebimentoRemoto = async (payload) => {
    const localRecebimento = await obterLocalizacao();
    await updateDoc(
      doc(db, COLECAO, payload.romaneioId),
      withTenant(
        {
          status: payload.situacao === "RECEBIDO_TOTAL" ? "RECEBIDO" : "DIVERGENCIA",
          recebidoStatus: payload.situacao,
          observacaoRecebimento: String(payload.observacao || "").trim().toUpperCase(),
          assinaturaRecebimento: payload.assinatura,
          recebedor: payload.recebedor || "RECEBEDOR",
          dataHoraRecebimento: new Date().toISOString(),
          localRecebimento
        },
        tenantId
      )
    );

    await registrarHistorico({
      modulo: "TRANSPORTE",
      acao: "RECEBEU",
      entidade: "ROMANEIO_TRANSPORTE",
      registroId: payload.romaneioId,
      usuario: payload.recebedor || "-",
      descricao: `Confirmou recebimento do romaneio ${payload.numeroRomaneio || payload.romaneioId || "-"}.`
    });
  };

  const sincronizarPendencias = async () => {
    if (!navigator.onLine || sincronizandoPendencias) return;
    const pendencias = await listarRecebimentosTransportePendentes(tenantId);
    if (!pendencias.length) return;

    setSincronizandoPendencias(true);
    setMensagemSincronizacao("Sincronizando recebimentos pendentes...");

    let sincronizados = 0;
    let comErro = 0;

    for (const pendencia of pendencias) {
      try {
        await atualizarRecebimentoTransportePendente(pendencia.id, {
          status: "sincronizando",
          ultimaTentativaEm: new Date().toISOString(),
          ultimoErro: ""
        });
        await persistirRecebimentoRemoto(pendencia.payload);
        await removerRecebimentoTransportePendente(pendencia.id);
        sincronizados += 1;
      } catch (error) {
        comErro += 1;
        await atualizarRecebimentoTransportePendente(pendencia.id, {
          status: "erro",
          ultimaTentativaEm: new Date().toISOString(),
          ultimoErro: String(error?.message || error || "Falha ao sincronizar recebimento de transporte.")
        });
      }
    }

    await atualizarPendencias();
    if (sincronizados && comErro) {
      setMensagemSincronizacao(`${sincronizados} recebimento(s) sincronizado(s) e ${comErro} ainda pendente(s).`);
    } else if (sincronizados) {
      setMensagemSincronizacao(`${sincronizados} recebimento(s) sincronizado(s) com sucesso.`);
    } else if (comErro) {
      setMensagemSincronizacao(`${comErro} recebimento(s) ainda pendente(s) por erro de sincronizacao.`);
    } else {
      setMensagemSincronizacao("");
    }
    setSincronizandoPendencias(false);
  };

  useEffect(() => {
    if (isOnline) {
      sincronizarPendencias();
    }
  }, [isOnline]);

  const confirmar = async () => {
    if (!romaneio?.id || salvando) return;
    const assinatura = assinaturaRef.current?.isEmpty()
      ? ""
      : assinaturaRef.current.getCanvas().toDataURL("image/png");
    if (!assinatura) {
      alert("A assinatura do recebedor e obrigatoria.");
      return;
    }
    const payload = {
      romaneioId: romaneio.id,
      numeroRomaneio: romaneio.numero || codigoManual || romaneio.id,
      situacao,
      observacao: String(observacao || "").trim().toUpperCase(),
      assinatura,
      recebedor: recebedorAtual || "RECEBEDOR"
    };
    setSalvando(true);
    if (!isOnline) {
      await salvarRecebimentoTransportePendente(payload, tenantId);
      await atualizarPendencias();
      setMensagemSincronizacao("Recebimento salvo no celular e aguardando sincronizacao.");
      alert("Recebimento salvo offline no celular. Ele sera sincronizado quando a internet voltar.");
      setRomaneio(null);
      setCodigoManual("");
      setObservacao("");
      setSituacao("RECEBIDO_TOTAL");
      assinaturaRef.current?.clear();
      setSalvando(false);
      return;
    }
    try {
      await persistirRecebimentoRemoto(payload);
      await atualizarPendencias();
      setMensagemSincronizacao("Recebimento enviado para o sistema com sucesso.");
      alert("Recebimento confirmado com sucesso.");
      setRomaneio(null);
      setCodigoManual("");
      setObservacao("");
      setSituacao("RECEBIDO_TOTAL");
      assinaturaRef.current?.clear();
    } catch (e) {
      const mensagem = String(e?.message || e || "");
      const erroDeRede = !navigator.onLine || /network|offline|unavailable|failed-precondition/i.test(mensagem);
      if (erroDeRede) {
        await salvarRecebimentoTransportePendente(payload, tenantId);
        await atualizarPendencias();
        setMensagemSincronizacao("Sem internet no momento. O recebimento ficou salvo no celular.");
        alert("Sem internet no momento. O recebimento foi salvo offline e sera sincronizado depois.");
        setRomaneio(null);
        setCodigoManual("");
        setObservacao("");
        setSituacao("RECEBIDO_TOTAL");
        assinaturaRef.current?.clear();
        return;
      }
      alert(`Falha ao confirmar recebimento. Detalhes: ${mensagem}`);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "18px 10px 28px", background: "#f3f5f8" }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0, color: "#10243e" }}>Receber Transporte (QR)</h2>
            <div style={{ marginTop: 4, fontSize: 12, color: "#5a6b82" }}>
              Leia o QR do romaneio ou digite o numero para conferir e assinar no destino.
            </div>
          </div>
          <button type="button" onClick={() => setTela("home")} style={botaoSecundario}>
            Voltar
          </button>
        </div>
      </div>

      <div
        style={{
          ...card,
          borderColor: isOnline ? "#cce5d1" : "#ffd8a8",
          background: isOnline ? "#f1fff4" : "#fff4e6",
          color: "#173454"
        }}
      >
        <div style={{ fontWeight: 800 }}>{isOnline ? "Celular online" : "Celular offline"}</div>
        <div style={{ marginTop: 4, fontSize: 13 }}>
          {isOnline
            ? "Os recebimentos podem ser enviados agora."
            : "No offline, use preferencialmente o QR para registrar o recebimento no celular."}
        </div>
        {!!pendenciasOffline.length && (
          <div style={{ marginTop: 6, fontSize: 13 }}>Pendencias offline: {pendenciasOffline.length}</div>
        )}
        {!!mensagemSincronizacao && (
          <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700 }}>{mensagemSincronizacao}</div>
        )}
      </div>

      <div style={card}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <button type="button" onClick={scaneando ? pararScan : iniciarScan} style={{ ...botaoPrimario, background: scaneando ? "#b02a37" : "#5f3dc4" }}>
            {scaneando ? "Parar leitura" : "Ler QR"}
          </button>
          <div style={{ fontSize: 12, color: "#5a6b82" }}>
            Se o QR estiver em print, PDF ou WhatsApp, a leitura funciona do mesmo jeito.
          </div>
        </div>

        {scaneando && (
          <div style={{ marginBottom: 12 }}>
            <video
              ref={videoRef}
              style={{ width: "100%", maxWidth: 520, borderRadius: 8, border: "1px solid #dbe3ef", background: "#000" }}
              muted
              playsInline
            />
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Número do romaneio</div>
            <input value={codigoManual} onChange={(e) => setCodigoManual(e.target.value.toUpperCase())} style={inputStyle} placeholder="Ex.: RT-20260501-0830-1234" />
          </div>
          <button type="button" onClick={buscarManual} style={botaoSecundario}>
            Buscar
          </button>
        </div>

        {erroScan && <div style={{ marginTop: 10, color: "#b02a37", fontWeight: 700 }}>{erroScan}</div>}
      </div>

      {romaneio && (
        <div style={card}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {[
              ["Número", romaneio.numero],
              ["Tipo", romaneio.tipoTransporte],
              ["Material", romaneio.materialLabel || romaneio.material],
              ["Quantidade", `${romaneio.quantidade || "-"} ${romaneio.unidade || ""}`],
              ["Origem", romaneio.origem],
              ["Destino", romaneio.destino],
              ["Obra / frente", romaneio.obra || "-"],
              ["Caminhao", romaneio.caminhaoNome || "-"],
              ["Motorista", romaneio.motorista || "-"],
              ["Status atual", romaneio.status || "-"]
            ].map(([label, value]) => (
              <div key={label} style={{ border: "1px solid #eef1f5", borderRadius: 8, padding: 10, background: "#fafbfd" }}>
                <div style={{ fontSize: 11, color: "#5a6b82", fontWeight: 700 }}>{label}</div>
                <div style={{ marginTop: 4, fontWeight: 800, color: "#10243e" }}>{value || "-"}</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Situacao do recebimento</div>
              <select value={situacao} onChange={(e) => setSituacao(e.target.value)} style={inputStyle}>
                <option value="RECEBIDO_TOTAL">Recebido total</option>
                <option value="RECEBIDO_PARCIAL">Recebido parcial</option>
                <option value="DIVERGENCIA">Recebido com divergencia</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Recebedor</div>
              <input value={recebedorAtual} readOnly style={{ ...inputStyle, background: "#f8f9fa" }} />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Observação / divergência</div>
            <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} style={areaStyle} placeholder="Opcional" />
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Assinatura do recebedor</div>
            <div style={{ border: "1px solid #dbe3ef", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
              <SignatureCanvas
                ref={assinaturaRef}
                penColor="black"
                canvasProps={{ width: assinaturaWidth, height: 150, style: { width: "100%", height: 150, display: "block" } }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <button type="button" onClick={() => assinaturaRef.current?.clear()} style={botaoSecundario}>
                Limpar assinatura
              </button>
              <button
                type="button"
                onClick={sincronizarPendencias}
                disabled={!pendenciasOffline.length || !isOnline || sincronizandoPendencias}
                style={{ ...botaoSecundario, opacity: sincronizandoPendencias ? 0.7 : 1 }}
              >
                {sincronizandoPendencias ? "Sincronizando..." : `Sincronizar pendencias${pendenciasOffline.length ? ` (${pendenciasOffline.length})` : ""}`}
              </button>
              <button type="button" onClick={confirmar} disabled={salvando} style={{ ...botaoPrimario, opacity: salvando ? 0.7 : 1 }}>
                {salvando ? "Salvando..." : "Confirmar recebimento"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ReceberTransporte;

