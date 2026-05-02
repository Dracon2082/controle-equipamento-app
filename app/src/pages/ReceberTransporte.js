/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import { BrowserQRCodeReader } from "@zxing/browser";
import { collection, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { registrarHistorico } from "../utils/historico";
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
    setRomaneio(data);
    setCodigoManual(data.numero || "");
  };

  const buscarManual = async () => {
    const alvo = String(codigoManual || "").trim().toUpperCase();
    if (!alvo) return alert("Informe o numero do romaneio.");
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

  const confirmar = async () => {
    if (!romaneio?.id || salvando) return;
    const assinatura = assinaturaRef.current?.isEmpty()
      ? ""
      : assinaturaRef.current.getCanvas().toDataURL("image/png");
    if (!assinatura) {
      alert("A assinatura do recebedor e obrigatoria.");
      return;
    }
    setSalvando(true);
    try {
      const localRecebimento = await obterLocalizacao();
      await updateDoc(
        doc(db, COLECAO, romaneio.id),
        withTenant(
          {
            status: situacao === "RECEBIDO_TOTAL" ? "RECEBIDO" : "DIVERGENCIA",
            recebidoStatus: situacao,
            observacaoRecebimento: String(observacao || "").trim().toUpperCase(),
            assinaturaRecebimento: assinatura,
            recebedor: recebedorAtual || "RECEBEDOR",
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
        registroId: romaneio.id,
        usuario: recebedorAtual || "-",
        descricao: `Confirmou recebimento do romaneio ${romaneio.numero || "-"}.`
      });

      alert("Recebimento confirmado com sucesso.");
      setRomaneio(null);
      setCodigoManual("");
      setObservacao("");
      setSituacao("RECEBIDO_TOTAL");
      assinaturaRef.current?.clear();
    } catch (e) {
      alert(`Falha ao confirmar recebimento. Detalhes: ${String(e?.message || e || "")}`);
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
            <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Numero do romaneio</div>
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
              ["Numero", romaneio.numero],
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
            <div style={{ fontSize: 12, fontWeight: 800, color: "#173454", marginBottom: 6 }}>Observacao / divergencia</div>
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
