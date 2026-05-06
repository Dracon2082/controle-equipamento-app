/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import { BrowserQRCodeReader } from "@zxing/browser";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { registrarHistorico } from "../utils/historico";
import { belongsToTenant, getTenantId, withTenant } from "../utils/tenant";

function ReceberTransferencia({ setTela }) {
  const tenantId = getTenantId();
  const sessaoOperacional = (() => {
    try {
      return JSON.parse(localStorage.getItem("sessaoOperacional") || "{}");
    } catch {
      return {};
    }
  })();

  const responsavelAtual = String(sessaoOperacional?.nome || localStorage.getItem("usuarioLogado") || "")
    .trim()
    .toUpperCase();
  const identificadorLoginAtual = String(
    sessaoOperacional?.email ||
      sessaoOperacional?.cpf ||
      localStorage.getItem("usuarioLogado") ||
      ""
  )
    .trim()
    .toLowerCase();
  const perfilSessao = String(sessaoOperacional?.perfilAcesso || "").trim().toUpperCase();
  const usuarioChaveSessao = Boolean(sessaoOperacional?.usuarioChave);

  const basesPermitidasLabel = (() => {
    const raw = Array.isArray(sessaoOperacional?.basesPermitidas)
      ? sessaoOperacional.basesPermitidas.map((b) => String(b || "").trim()).filter(Boolean)
      : [];
    return Array.from(new Set(raw.map((b) => {
      const up = String(b || "").trim().toUpperCase();
      if (up.includes("__")) {
        const parts = up.split("__");
        return `${String(parts?.[0] || "").trim()}/${String(parts?.[1] || "").trim()}`;
      }
      return up;
    }).filter(Boolean)));
  })();
  const acessoTotalBases = usuarioChaveSessao || perfilSessao === "GESTOR_GERAL";

  const isMobileDevice = (() => {
    const ua = String(window.navigator?.userAgent || "").toLowerCase();
    const mobileUA = /android|iphone|ipad|ipod|mobile|opera mini|iemobile/.test(ua);
    return mobileUA || window.innerWidth <= 700;
  })();

  const sigPad = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scanTimerRef = useRef(null);
  const zxingReaderRef = useRef(null);
  const zxingControlsRef = useRef(null);
  const attachRetryRef = useRef(null);

  const [scanErro, setScanErro] = useState("");
  const [scaneando, setScaneando] = useState(false);
  const [qrTexto, setQrTexto] = useState("");
  const [boletim, setBoletim] = useState(null);
  const [confirmando, setConfirmando] = useState(false);
  const [obsRecebimento, setObsRecebimento] = useState("");
  const [debugCam, setDebugCam] = useState("");
  const [cameraSelecionada, setCameraSelecionada] = useState("");
  const [reiniciandoCam, setReiniciandoCam] = useState(false);

  // Importante: em mobile, se o canvas tem width/height diferentes do tamanho exibido,
  // a assinatura fica "deslocada" (toca num lugar e desenha em outro).
  const assinaturaWidth = Math.min(520, Math.max(280, window.innerWidth - 56));

  const baseInput = {
    height: 42,
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
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    marginBottom: 12
  };

  const pararScan = () => {
    setScaneando(false);
    setDebugCam("");
    try {
      if (attachRetryRef.current) clearInterval(attachRetryRef.current);
      attachRetryRef.current = null;
    } catch {}
    try {
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    } catch {}
    try {
      if (zxingControlsRef.current) zxingControlsRef.current.stop();
      zxingControlsRef.current = null;
    } catch {}
    try {
      if (zxingReaderRef.current) zxingReaderRef.current.reset();
    } catch {}
    try {
      const s = streamRef.current;
      if (s) s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    } catch {}
  };

  const anexarStreamNoVideo = async (stream) => {
    if (!stream) return;
    const v = videoRef.current;
    if (!v) return;

    try {
      // Evita ficar com um stream antigo preso no elemento
      try {
        if (v.srcObject && v.srcObject !== stream) v.srcObject = null;
      } catch {}
      v.srcObject = stream;
      v.muted = true;
      try {
        v.setAttribute("playsinline", "true");
        v.setAttribute("webkit-playsinline", "true");
      } catch {}
      v.playsInline = true;
      v.autoplay = true;

      // Em alguns celulares, forcar load() ajuda a disparar os eventos de frame.
      try {
        if (typeof v.load === "function") v.load();
      } catch {}

      await new Promise((resolve) => {
        try {
          if (v.readyState >= 2) return resolve();
          const onMeta = () => {
            try { v.removeEventListener("loadedmetadata", onMeta); } catch {}
            resolve();
          };
          const onData = () => {
            try { v.removeEventListener("loadeddata", onData); } catch {}
            resolve();
          };
          v.addEventListener("loadedmetadata", onMeta);
          v.addEventListener("loadeddata", onData);
          setTimeout(resolve, 1200);
        } catch {
          resolve();
        }
      });

      try {
        await v.play();
      } catch (playErr) {
        setScanErro(`Camera nao conseguiu iniciar o preview. Detalhes: ${String(playErr?.message || playErr || "")}`);
      }
    } catch {
      // noop
    }
  };

  const reiniciarCamera = async () => {
    if (!scaneando) return;
    setReiniciandoCam(true);
    try {
      // Para tudo e reabre
      pararScan();
      // Pequena pausa para iOS/Android liberarem o hardware
      await new Promise((r) => setTimeout(r, 250));
      await iniciarScan();
    } finally {
      setReiniciandoCam(false);
    }
  };

  // Quando o stream esta pronto, mas o <video> foi renderizado depois (React),
  // precisamos tentar anexar novamente. Sem isso, alguns celulares ficam com preview preto.
  useEffect(() => {
    if (!scaneando) return;

    const stream = streamRef.current;
    if (!stream) return;

    // Tenta anexar imediatamente; se ainda nao tiver <video>, faz retry curto.
    const tryAttach = async () => {
      try {
        if (!videoRef.current) return false;
        await anexarStreamNoVideo(streamRef.current);
        return true;
      } catch {
        return false;
      }
    };

    let cancelled = false;
    (async () => {
      const ok = await tryAttach();
      if (ok || cancelled) return;

      try {
        if (attachRetryRef.current) clearInterval(attachRetryRef.current);
      } catch {}
      attachRetryRef.current = setInterval(async () => {
        if (cancelled) return;
        const done = await tryAttach();
        if (done) {
          try { clearInterval(attachRetryRef.current); } catch {}
          attachRetryRef.current = null;
        }
      }, 120);

      // Safety: para de tentar depois de alguns segundos
      setTimeout(() => {
        try {
          if (attachRetryRef.current) clearInterval(attachRetryRef.current);
          attachRetryRef.current = null;
        } catch {}
      }, 5000);
    })();

    return () => {
      cancelled = true;
      try {
        if (attachRetryRef.current) clearInterval(attachRetryRef.current);
        attachRetryRef.current = null;
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaneando]);

  const listarCameras = async () => {
    try {
      if (!navigator?.mediaDevices?.enumerateDevices) return [];
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = (devices || [])
        .filter((d) => d && d.kind === "videoinput")
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: String(d.label || `Camera ${idx + 1}`)
        }));
      // Se ainda nao escolheu, tenta selecionar uma traseira pelo label
      if (!cameraSelecionada && cams.length) {
        const pick =
          cams.find((c) => /(back|rear|traseira|environment)/i.test(String(c.label || ""))) || cams[0];
        setCameraSelecionada(pick.deviceId);
      }
      return cams;
    } catch {
      return [];
    }
  };

  useEffect(() => {
    return () => pararScan();
  }, []);

  // Se o usuario abriu via QR (URL), ja carrega o boletim automaticamente.
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const hash = String(u.hash || "").replace("#", "").trim().toLowerCase();
      const screen = String(u.searchParams.get("screen") || "").trim().toLowerCase();
      const id = u.searchParams.get("id") || u.searchParams.get("boletim");
      const t = u.searchParams.get("t") || u.searchParams.get("tenant");

      // Novo QR curto: /qr/<tenant>/<boletimId>
      const parts = String(u.pathname || "")
        .split("/")
        .map((p) => p.trim())
        .filter(Boolean);
      const isQrPath = parts.length >= 3 && String(parts[0]).toLowerCase() === "qr";
      const pathTenant = isQrPath ? parts[1] : "";
      const pathId = isQrPath ? parts[2] : "";

      // Aceita:
      // - ...&screen=receberTransferencia (preferido, mais compativel com iPhone/Safari)
      // - ...#receberTransferencia (links antigos)
      if (isQrPath && pathTenant && pathId) {
        const urlCompleta = `EG_TRANSFER|${pathTenant}|${pathId}`;
        setQrTexto(urlCompleta);
        carregarBoletimPorQr(urlCompleta);
      } else if ((screen === "recebertransferencia" || hash === "recebertransferencia") && id && t) {
        const urlCompleta = u.toString();
        setQrTexto(urlCompleta);
        carregarBoletimPorQr(urlCompleta);
      }
    } catch {
      // noop
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parseQr = (txt) => {
    const raw = String(txt || "").trim();
    if (!raw) return null;

    // Formato recomendado:
    // EG_TRANSFER|<tenantId>|<boletimId>
    if (raw.startsWith("EG_TRANSFER|")) {
      const parts = raw.split("|");
      if (parts.length >= 3) return { tenant: parts[1], id: parts[2] };
    }

    // Fallback: URL com query ?t=<tenant>&id=<id>
    try {
      if (raw.startsWith("http")) {
        const u = new URL(raw);
        const t = u.searchParams.get("t") || u.searchParams.get("tenant");
        const id = u.searchParams.get("id") || u.searchParams.get("boletim");
        if (t && id) return { tenant: t, id };

        // Novo formato curto: /qr/<tenant>/<boletimId>
        const parts = String(u.pathname || "")
          .split("/")
          .map((p) => p.trim())
          .filter(Boolean);
        const isQrPath = parts.length >= 3 && String(parts[0]).toLowerCase() === "qr";
        if (isQrPath && parts[1] && parts[2]) return { tenant: parts[1], id: parts[2] };
      }
    } catch {}

    return null;
  };

  const carregarBoletimPorQr = async (txt) => {
    setScanErro("");
    setBoletim(null);
    const parsed = parseQr(txt);
    if (!parsed) {
      setScanErro("QR Code invalido. Gere novamente no sistema.");
      return;
    }
    if (String(parsed.tenant || "").trim() !== String(tenantId || "").trim()) {
      setScanErro("Este QR Code nao pertence a esta empresa.");
      return;
    }

    const ref = doc(db, "boletinsTransferencia", parsed.id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      setScanErro("Boletim nao encontrado.");
      return;
    }
    const data = { id: snap.id, ...snap.data() };
    if (!belongsToTenant(data, tenantId)) {
      setScanErro("Boletim nao pertence a esta empresa.");
      return;
    }

    // Seguranca: so permite receber/assinar boletins destinados a uma base permitida do usuario.
    // (Usuario-chave / gestor geral tem acesso total.)
    try {
      if (!acessoTotalBases && basesPermitidasLabel.length) {
        const destinoBase = String(data?.destinoBase || "").trim().toUpperCase();
        const destinoLegado = String(data?.destino || "").trim().toUpperCase();
        const ok = basesPermitidasLabel.includes(destinoBase) || basesPermitidasLabel.some((b) => b && destinoLegado.includes(b));
        if (!ok) {
          setScanErro("Voce nao tem permissao para receber este boletim (destino pertence a outra base).");
          return;
        }
      }
    } catch {
      // noop
    }
    setBoletim(data);
  };

  const iniciarScan = async () => {
    setScanErro("");
    setQrTexto("");
    setBoletim(null);
    setDebugCam("");

    if (!isMobileDevice) {
      setScanErro("Leitura por camera e recomendada no celular.");
      return;
    }

    try {
      // ZXing e mais confiavel que BarcodeDetector em Android/iPhone.
      if (!zxingReaderRef.current) zxingReaderRef.current = new BrowserQRCodeReader();
      let stream = null;
      const getUserMedia = navigator?.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
      if (!getUserMedia) {
        setScanErro("Seu navegador nao liberou acesso a camera (mediaDevices indisponivel).");
        return;
      }

      // Helper: tenta escolher camera traseira por deviceId (melhor compatibilidade em Android/MIUI).
      const abrirStreamTraseiroPorDevice = async () => {
        try {
          // Atualiza lista de cameras (labels aparecem apos permissao)
          const cams = await listarCameras();
          if (!cams.length) return null;
          // Preferencias de label (quando permissao ja foi concedida)
          const prefer = (d) => {
            const label = String(d.label || "").toLowerCase();
            if (/(back|rear|traseira|environment)/.test(label)) return 3;
            if (/(front|frontal|user)/.test(label)) return 0;
            return 1;
          };
          const ordenadas = [...cams].sort((a, b) => prefer(b) - prefer(a));
          const escolhida =
            (cameraSelecionada ? cams.find((c) => c.deviceId === cameraSelecionada) : null) ||
            ordenadas[0];
          if (!escolhida?.deviceId) return null;
          return await getUserMedia({
            video: {
              deviceId: { exact: escolhida.deviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            audio: false
          });
        } catch {
          return null;
        }
      };

      // Se o usuario escolheu uma camera, tenta ela primeiro.
      if (cameraSelecionada) {
        try {
          stream = await getUserMedia({
            video: {
              deviceId: { exact: cameraSelecionada },
              width: { ideal: 1280 },
              height: { ideal: 720 }
            },
            audio: false
          });
        } catch {
          stream = null;
        }
      }

      try {
        // Preferencia: camera traseira (nem todo celular respeita "ideal").
        if (!stream) {
          stream = await getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false
          });
        }
      } catch {
        try {
          // Fallback 1: alguns aparelhos nao aceitam "ideal", mas aceitam string direta.
          if (!stream) {
            stream = await getUserMedia({
              video: { facingMode: "environment" },
              audio: false
            });
          }
        } catch {
          try {
            // Fallback 2: reduzir resolucao (alguns Androids travam em resolucao alta).
            if (!stream) {
              stream = await getUserMedia({
                video: { width: { ideal: 640 }, height: { ideal: 480 } },
                audio: false
              });
            }
          } catch {
            try {
              // Fallback 3: tenta explicitamente usar camera traseira via constraints avancados.
              if (!stream) {
                stream = await getUserMedia({
                  video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    advanced: [{ facingMode: "environment" }]
                  },
                  audio: false
                });
              }
            } catch {
              // Fallback 4: abre qualquer camera (para liberar permissao/labels), depois tenta escolher traseira.
              stream = await getUserMedia({ video: true, audio: false });
              try {
                stream.getTracks().forEach((t) => t.stop());
              } catch {}
              stream = await abrirStreamTraseiroPorDevice();
              if (!stream) {
                // Ultimo recurso: qualquer camera novamente
                stream = await getUserMedia({ video: true, audio: false });
              }
            }
          }
        }
      }
      streamRef.current = stream;
      try {
        const t = stream?.getVideoTracks?.()[0];
        if (t) {
          const st = typeof t.getSettings === "function" ? t.getSettings() : {};
          setDebugCam(`TRACK: ${String(t.label || "camera")} (${t.readyState || "?"}) ${st.width || "?"}x${st.height || "?"}`);
        }
      } catch {}
      setScaneando(true);
      // Atualiza lista de cameras depois que a permissao foi concedida
      listarCameras();

      // Se o preview ficar preto (videoWidth=0), orienta usar codigo manual.
      setTimeout(() => {
        try {
          const v = videoRef.current;
          if (!v) return;
          if (v.videoWidth && v.videoHeight) {
            setDebugCam(`OK (${v.videoWidth}x${v.videoHeight})`);
            return;
          }
          setDebugCam(`PRETO (readyState=${v.readyState}, w=${v.videoWidth}, h=${v.videoHeight})`);
          // Mantemos a escolha de camera automatica; se ficar preto, use o codigo manual.
          setScanErro(
            "A camera abriu, mas o preview ficou preto. Isso pode acontecer em alguns celulares/navegadores. " +
            "Tente: 1) tocar em Parar leitura e Ler QR Code de novo, 2) trocar para dados moveis (as vezes Wiâ€‘Fi com filtro atrapalha), 3) reiniciar o Chrome, 4) desligar economia de bateria do Chrome. " +
            "Se continuar, cole o codigo manual."
          );
        } catch {
          // ignore
        }
      }, 1200);

      // Inicia leitura continua pelo ZXing.
      setTimeout(async () => {
        try {
          if (!videoRef.current) return;
          // Para iPhone, ler pelo elemento <video> e mais estavel do que pegar frames manualmente.
          zxingControlsRef.current = await zxingReaderRef.current.decodeFromVideoElement(
            videoRef.current,
            (result, err) => {
              if (result?.getText) {
                const raw = String(result.getText() || "").trim();
                if (raw) {
                  setQrTexto(raw);
                  pararScan();
                  carregarBoletimPorQr(raw);
                }
              }
              // err e normal enquanto nao encontrou QR; nao exibimos.
            }
          );
        } catch (e) {
          setScanErro(`Falha ao iniciar leitura do QR pela camera. Detalhes: ${String(e?.message || e || "")}`);
        }
      }, 250);
    } catch (e) {
      pararScan();
      setScanErro(`Nao foi possivel acessar a camera. Detalhes: ${String(e?.message || e || "")}`);
    }
  };

  const confirmarRecebimento = async () => {
    if (!boletim?.id) return;
    if (confirmando) return;

    const assinaturaAtual =
      sigPad.current && !sigPad.current.isEmpty()
        ? sigPad.current.getCanvas().toDataURL("image/png")
        : null;
    if (!assinaturaAtual) {
      alert("Assinatura do recebedor e obrigatoria!");
      return;
    }

    setConfirmando(true);
    try {
      await updateDoc(doc(db, "boletinsTransferencia", boletim.id), withTenant({
        statusRecebimento: "RECEBIDO",
        recebidoEm: new Date().toISOString(),
        recebidoPor: responsavelAtual || "RECEBEDOR",
        recebidoPorLogin: identificadorLoginAtual || "",
        assinaturaRecebedor: assinaturaAtual,
        obsRecebimento: String(obsRecebimento || "").trim().toUpperCase()
      }, tenantId));

      await registrarHistorico({
        modulo: "TRANSFERENCIA",
        acao: "RECEBEU",
        entidade: "BOLETIM_TRANSFERENCIA",
        registroId: boletim.id,
        usuario: responsavelAtual || "-",
        descricao: `Confirmou recebimento do boletim ${boletim.numeroBoletim || "-"}.`
      });

      alert("Recebimento confirmado com sucesso.");
      setObsRecebimento("");
      setBoletim(null);
      setQrTexto("");
    } catch (e) {
      alert(`Falha ao confirmar recebimento. Detalhes: ${String(e?.message || e || "")}`);
    } finally {
      setConfirmando(false);
    }
  };

  const titulo = "Receber Transferencia (QR)";

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "18px 10px 28px", background: "#f3f5f8" }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ margin: 0, color: "#0f2440" }}>{titulo}</h2>
          <button
            type="button"
            onClick={() => setTela("home")}
            style={{ background: "#6c757d", border: "none", color: "#fff", borderRadius: 8, padding: "10px 14px", fontWeight: "bold", cursor: "pointer" }}
          >
            Voltar
          </button>
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: "#5a6b82" }}>
          Aponte a camera para o QR Code do boletim para abrir a 2a via e confirmar o recebimento com assinatura.
        </div>
      </div>

      <div style={card}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            onClick={scaneando ? pararScan : iniciarScan}
            style={{ background: scaneando ? "#b00000" : "#0b5ed7", border: "none", color: "#fff", borderRadius: 8, padding: "10px 14px", fontWeight: "bold", cursor: "pointer" }}
          >
            {scaneando ? "Parar leitura" : "Ler QR Code"}
          </button>
          {scaneando && (
            <button
              type="button"
              onClick={reiniciarCamera}
              disabled={reiniciandoCam}
              style={{ background: "#0d6efd", border: "none", color: "#fff", borderRadius: 8, padding: "10px 14px", fontWeight: "bold", cursor: reiniciandoCam ? "not-allowed" : "pointer", opacity: reiniciandoCam ? 0.7 : 1 }}
              title="Se o preview ficar preto, use isto para reiniciar a camera."
            >
              {reiniciandoCam ? "Reiniciando..." : "Reiniciar camera"}
            </button>
          )}
          <div style={{ flex: 1, minWidth: 220 }}>
            <input
              style={baseInput}
              value={qrTexto}
              onChange={(e) => setQrTexto(e.target.value)}
              placeholder="Ou cole o codigo do QR aqui"
            />
          </div>
          <button
            type="button"
            onClick={() => carregarBoletimPorQr(qrTexto)}
            style={{ background: "#198754", border: "none", color: "#fff", borderRadius: 8, padding: "10px 14px", fontWeight: "bold", cursor: "pointer" }}
          >
            Abrir boletim
          </button>
        </div>

        {scaneando && (
          <div style={{ marginTop: 10 }}>
            <video
              ref={videoRef}
              style={{ width: "100%", maxHeight: 340, borderRadius: 10, background: "#000", objectFit: "cover" }}
              autoPlay
              muted
              playsInline
            />
            <div style={{ marginTop: 6, fontSize: 12, color: "#5a6b82" }}>
              Se a camera ficar preta, verifique permissao de camera no navegador e tente parar/iniciar a leitura novamente.
            </div>
            {debugCam && (
              <div style={{ marginTop: 6, fontSize: 12, color: "#173454", fontWeight: 800 }}>
                Camera: {debugCam}
              </div>
            )}
          </div>
        )}

        {scanErro && (
          <div style={{ marginTop: 10, background: "#fff5f5", border: "1px solid #f3b7b7", padding: 10, borderRadius: 10, color: "#b00000", fontWeight: "bold" }}>
            {scanErro}
          </div>
        )}
      </div>

      {boletim && (
        <div style={card}>
          <div style={{ fontWeight: "bold", color: "#0f2440", marginBottom: 8 }}>
            Boletim {boletim.numeroBoletim || "-"} ({String(boletim.statusRecebimento || "PENDENTE").toUpperCase()})
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <div><strong>Data:</strong> {String(boletim.data || "-")}</div>
            <div><strong>Origem:</strong> {String(boletim.origem || "-").toUpperCase()}</div>
            <div><strong>Destino:</strong> {String(boletim.destino || "-").toUpperCase()}</div>
            <div><strong>Transportador:</strong> {String(boletim.transportador || "-").toUpperCase()}</div>
            <div><strong>Placa:</strong> {String(boletim.placaVeiculo || "-").toUpperCase()}</div>
            <div><strong>Código:</strong> {String(boletim.codigoTransporte || "-").toUpperCase()}</div>
          </div>

          <div style={{ marginTop: 10, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead style={{ background: "#0b5ed7", color: "#fff" }}>
                <tr>
                  {["Descrição", "Código", "Qtd", "Vlr Unit", "Vlr Total", "Obs"].map((t) => (
                    <th key={t} style={{ padding: 8, border: "1px solid #d8e0ea" }}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(boletim.itens) ? boletim.itens : []).map((it, idx) => (
                  <tr key={idx} style={{ background: idx % 2 === 0 ? "#fff" : "#f8fbff" }}>
                    <td style={{ padding: 8, border: "1px solid #e5ebf3" }}>{String(it?.descricao || "-").toUpperCase()}</td>
                    <td style={{ padding: 8, border: "1px solid #e5ebf3", textAlign: "center" }}>{String(it?.codigo || "-").toUpperCase()}</td>
                    <td style={{ padding: 8, border: "1px solid #e5ebf3", textAlign: "center" }}>{Number(it?.quantidade || 0)}</td>
                    <td style={{ padding: 8, border: "1px solid #e5ebf3", textAlign: "right" }}>{Number(it?.valorUnitario || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td style={{ padding: 8, border: "1px solid #e5ebf3", textAlign: "right", fontWeight: "bold" }}>{Number(it?.valorTotal || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td style={{ padding: 8, border: "1px solid #e5ebf3" }}>{String(it?.observacao || boletim.observacaoGeral || "-").toUpperCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: "bold", marginBottom: 6 }}>Observação do recebimento (opcional)</div>
            <input
              style={baseInput}
              value={obsRecebimento}
              onChange={(e) => setObsRecebimento(e.target.value)}
              placeholder="Ex: recebido sem avarias / caixa danificada / faltou 1 item..."
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: "bold", marginBottom: 6 }}>Assinatura do recebedor</div>
            <div style={{ border: "1px solid #cfd7e3", borderRadius: 10, overflow: "hidden", width: "100%", background: "#fff" }}>
              <SignatureCanvas
                ref={sigPad}
                penColor="black"
                canvasProps={{ width: assinaturaWidth, height: 160, style: { width: assinaturaWidth, height: 160, background: "#fff" } }}
              />
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              <button
                type="button"
                onClick={() => sigPad.current?.clear()}
                style={{ background: "#6c757d", border: "none", color: "#fff", borderRadius: 8, padding: "10px 14px", fontWeight: "bold", cursor: "pointer" }}
              >
                Limpar assinatura
              </button>
              <button
                type="button"
                disabled={confirmando}
                onClick={confirmarRecebimento}
                style={{ background: "#198754", border: "none", color: "#fff", borderRadius: 8, padding: "10px 14px", fontWeight: "bold", cursor: confirmando ? "not-allowed" : "pointer", opacity: confirmando ? 0.7 : 1 }}
              >
                {confirmando ? "Confirmando..." : "Confirmar recebimento"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ReceberTransferencia;

