import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import jsPDF from "jspdf";
import { db } from "../firebase";
import { registrarHistorico } from "../utils/historico";
import { formatoLogoPdf, resolverLogoPdf } from "../utils/pdfLogo";
import { belongsToTenant, getConfigDocId, getTenantId, withTenant } from "../utils/tenant";

const COLECAO = "memorandosInternos";

const formatarDataBR = (iso) => {
  if (!iso) return "";
  const partes = String(iso).split("-");
  if (partes.length !== 3) return iso;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
};

const obterAnoReferencia = (dataIso) => {
  const ano = String(dataIso || "").slice(0, 4);
  return /^\d{4}$/.test(ano) ? ano : String(new Date().getFullYear());
};

const formatarNumeroMemorando = (sequencial, dataIso) =>
  `MI-${obterAnoReferencia(dataIso)}-${String(sequencial || 1).padStart(3, "0")}`;

const extrairSequencial = (numero) => {
  const texto = String(numero || "").trim();
  const match = texto.match(/(\d{3})$/);
  if (match) return Number(match[1]);
  return 0;
};

function MemorandoInterno({ setTela }) {
  const tenantId = getTenantId();
  const sessaoOperacional = (() => {
    try {
      return JSON.parse(localStorage.getItem("sessaoOperacional") || "{}");
    } catch {
      return {};
    }
  })();

  const hojeIso = new Date().toISOString().slice(0, 10);
  const nomeUsuario = String(sessaoOperacional?.nome || localStorage.getItem("usuarioLogado") || "").trim() || "Responsavel";

  const [config, setConfig] = useState(null);
  const [lista, setLista] = useState([]);
  const [editandoId, setEditandoId] = useState("");
  const [menuAbertoId, setMenuAbertoId] = useState("");
  const [gerandoPdfId, setGerandoPdfId] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [numero, setNumero] = useState("");
  const [dataEmissao, setDataEmissao] = useState(hojeIso);
  const [destinatario, setDestinatario] = useState("Prezados");
  const [assunto, setAssunto] = useState("Memorando interno");
  const [descricao, setDescricao] = useState("");
  const [encerramento, setEncerramento] = useState("Sem mais para o momento, coloco-me a disposicao para quaisquer esclarecimentos adicionais.");
  const [assinadoPor, setAssinadoPor] = useState(nomeUsuario);
  const [cargo, setCargo] = useState("Responsavel");

  const nomeEmpresa = useMemo(
    () => String(config?.razaoSocial || config?.nomeFantasia || config?.nome || "Empresa").trim(),
    [config]
  );

  const cnpjEmpresa = useMemo(() => String(config?.cnpj || "").trim(), [config]);
  const logoTela = useMemo(() => {
    const base64 = String(config?.logoBase64 || "").trim();
    if (base64) return base64;
    return String(config?.logo || "").trim();
  }, [config]);

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
    height: 100,
    padding: "10px"
  };

  const card = {
    background: "#fff",
    border: "1px solid #e3e7ef",
    borderRadius: 8,
    padding: 18,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    marginBottom: 16
  };

  const primaryButton = {
    background: "#0b5ed7",
    color: "#fff",
    border: "none",
    padding: "10px 18px",
    borderRadius: 8,
    fontWeight: 800,
    cursor: "pointer"
  };

  const secondaryButton = {
    ...primaryButton,
    background: "#eef2ff",
    color: "#2b2f55",
    border: "1px solid #d8dcff"
  };

  const dangerButton = {
    background: "#fff5f5",
    color: "#c92a2a",
    border: "1px solid #ffc9c9",
    padding: "10px 14px",
    borderRadius: 8,
    fontWeight: 700,
    cursor: "pointer"
  };

  const buscar = async () => {
    const [cfgSnap, listaSnap] = await Promise.all([
      getDoc(doc(db, "configuracoes", getConfigDocId(tenantId))),
      getDocs(collection(db, COLECAO))
    ]);

    setConfig(cfgSnap.exists() ? cfgSnap.data() : null);

    const memorandos = listaSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId))
      .sort((a, b) => String(b?.numero || "").localeCompare(String(a?.numero || ""), "pt-BR"));
    setLista(memorandos);
  };

  useEffect(() => {
    buscar();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const anoAtual = useMemo(() => obterAnoReferencia(dataEmissao), [dataEmissao]);

  const proximoNumero = useMemo(() => {
    if (editandoId && numero) return numero;
    const seq = lista
      .filter((item) => String(item?.numero || "").includes(`MI-${anoAtual}-`))
      .reduce((maior, item) => Math.max(maior, extrairSequencial(item.numero)), 0);
    return formatarNumeroMemorando(seq + 1, dataEmissao);
  }, [anoAtual, dataEmissao, editandoId, lista, numero]);

  useEffect(() => {
    if (!editandoId) setNumero(proximoNumero);
  }, [proximoNumero, editandoId]);

  const limparFormulario = () => {
    setEditandoId("");
    setMenuAbertoId("");
    setNumero(formatarNumeroMemorando(1, hojeIso));
    setDataEmissao(hojeIso);
    setDestinatario("Prezados");
    setAssunto("Memorando interno");
    setDescricao("");
    setEncerramento("Sem mais para o momento, coloco-me a disposicao para quaisquer esclarecimentos adicionais.");
    setAssinadoPor(nomeUsuario);
    setCargo("Responsavel");
  };

  const salvar = async () => {
    if (!destinatario.trim()) return alert("Informe o destinatario.");
    if (!assunto.trim()) return alert("Informe o assunto.");
    if (!descricao.trim()) return alert("Informe a descricao.");

    setSalvando(true);
    try {
      const payload = withTenant({
        numero: numero || proximoNumero,
        dataEmissao,
        destinatario: destinatario.trim(),
        assunto: assunto.trim(),
        descricao: descricao.trim(),
        encerramento: encerramento.trim(),
        assinadoPor: assinadoPor.trim(),
        cargo: cargo.trim(),
        criadoEmISO: editandoId ? undefined : new Date().toISOString(),
        atualizadoEmISO: new Date().toISOString()
      }, tenantId);

      if (editandoId) {
        const ref = doc(db, COLECAO, editandoId);
        const atualizado = { ...payload };
        delete atualizado.criadoEmISO;
        await updateDoc(ref, atualizado);
        await registrarHistorico({
          modulo: "MEMORANDO_INTERNO",
          acao: "EDITOU",
          entidade: "MEMORANDO",
          registroId: editandoId,
          descricao: `Atualizou memorando ${payload.numero}.`
        });
      } else {
        const ref = await addDoc(collection(db, COLECAO), payload);
        await registrarHistorico({
          modulo: "MEMORANDO_INTERNO",
          acao: "CRIOU",
          entidade: "MEMORANDO",
          registroId: ref.id,
          descricao: `Criou memorando ${payload.numero}.`
        });
      }

      alert("Memorando salvo com sucesso!");
      limparFormulario();
      buscar();
    } catch (error) {
      console.error(error);
      alert("Nao foi possivel salvar o memorando.");
    } finally {
      setSalvando(false);
    }
  };

  const editar = (item) => {
    setEditandoId(item.id);
    setMenuAbertoId("");
    setNumero(String(item.numero || ""));
    setDataEmissao(String(item.dataEmissao || hojeIso));
    setDestinatario(String(item.destinatario || "Prezados"));
    setAssunto(String(item.assunto || ""));
    setDescricao(String(item.descricao || item.introducao || ""));
    setEncerramento(String(item.encerramento || ""));
    setAssinadoPor(String(item.assinadoPor || nomeUsuario));
    setCargo(String(item.cargo || "Responsavel"));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const excluir = async (item) => {
    if (!window.confirm(`Excluir o memorando ${item.numero}?`)) return;
    try {
      await deleteDoc(doc(db, COLECAO, item.id));
      await registrarHistorico({
        modulo: "MEMORANDO_INTERNO",
        acao: "EXCLUIU",
        entidade: "MEMORANDO",
        registroId: item.id,
        descricao: `Excluiu memorando ${item.numero}.`
      });
      buscar();
    } catch (error) {
      console.error(error);
      alert("Nao foi possivel excluir o memorando.");
    }
  };

  const gerarPdf = async (item) => {
    setGerandoPdfId(item.id);
    try {
      const docPdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
      const largura = docPdf.internal.pageSize.getWidth();
      const altura = docPdf.internal.pageSize.getHeight();
      const margem = 15;
      let y = 16;

      const dataUrl = await resolverLogoPdf(config);
      const formato = formatoLogoPdf(dataUrl || config?.logo || config?.logoBase64 || "");
      docPdf.setFillColor(247, 250, 255);
      docPdf.roundedRect(margem, y - 6, largura - margem * 2, 40, 3, 3, "F");
      docPdf.setDrawColor(221, 229, 242);
      docPdf.roundedRect(margem, y - 6, largura - margem * 2, 40, 3, 3, "S");

      if (dataUrl) {
        try {
          docPdf.addImage(dataUrl, formato, margem + 4, y - 2, 28, 20);
        } catch {
          // ignora falha da logo
        }
      }

      docPdf.setFont("helvetica", "bold");
      docPdf.setFontSize(13);
      const nomeEmpresaLinhas = docPdf.splitTextToSize(
        String(nomeEmpresa || "EMPRESA").toUpperCase(),
        largura - margem * 2 - 70
      );
      docPdf.text(nomeEmpresaLinhas, largura / 2, y + 0.5, { align: "center" });
      docPdf.setFont("helvetica", "normal");
      docPdf.setFontSize(9);
      const linhaEmpresa = cnpjEmpresa ? `CNPJ: ${cnpjEmpresa}` : "Comunicacao interna";
      const yInfoBase = y + Math.max(nomeEmpresaLinhas.length * 5, 6) + 1.5;
      docPdf.text(linhaEmpresa, largura / 2, yInfoBase, { align: "center" });
      docPdf.text(`Data de emissao: ${formatarDataBR(item.dataEmissao)}`, largura / 2, yInfoBase + 5, { align: "center" });

      docPdf.setFillColor(17, 67, 130);
      const larguraBoxMemorando = 78;
      const xBoxMemorando = (largura - larguraBoxMemorando) / 2;
      const yBoxMemorando = yInfoBase + 9;
      docPdf.roundedRect(xBoxMemorando, yBoxMemorando, larguraBoxMemorando, 13, 2.5, 2.5, "F");
      docPdf.setTextColor(255, 255, 255);
      docPdf.setFont("helvetica", "bold");
      docPdf.setFontSize(10.5);
      docPdf.text("MEMORANDO INTERNO", largura / 2, yBoxMemorando + 8, { align: "center" });
      docPdf.setTextColor(0, 0, 0);
      y = yBoxMemorando + 20;

      docPdf.setDrawColor(210, 220, 235);
      docPdf.line(margem, y, largura - margem, y);
      y += 8;

      const escreverLinha = (rotulo, valor) => {
        docPdf.setFont("helvetica", "bold");
        docPdf.setFontSize(11);
        docPdf.text(`${rotulo}:`, margem, y);
        docPdf.setFont("helvetica", "normal");
        const texto = docPdf.splitTextToSize(String(valor || "-"), largura - 48);
        docPdf.text(texto, margem + 30, y);
        y += texto.length * 5.2 + 1;
      };

      const garantirEspaco = (alturaNecessaria = 16) => {
        if (y + alturaNecessaria <= altura - 22) return;
        docPdf.addPage();
        y = 18;
      };

      escreverLinha("Numero", item.numero);
      escreverLinha("Data", formatarDataBR(item.dataEmissao));
      escreverLinha("Destinatario", item.destinatario || "-");
      escreverLinha("Assunto", item.assunto || "-");

      garantirEspaco(24);
      docPdf.setFont("helvetica", "bold");
      docPdf.setFontSize(11);
      docPdf.text("Descricao:", margem, y);
      y += 6;

      docPdf.setFont("helvetica", "normal");
      const descricaoLinhas = docPdf.splitTextToSize(String(item.descricao || ""), largura - margem * 2);
      docPdf.text(descricaoLinhas, margem, y);
      y += descricaoLinhas.length * 5.2 + 8;

      if (item.encerramento) {
        garantirEspaco(22);
        const encerramentoTexto = docPdf.splitTextToSize(String(item.encerramento || ""), largura - margem * 2);
        docPdf.text(encerramentoTexto, margem, y);
        y += encerramentoTexto.length * 5.2 + 8;
      }

      garantirEspaco(30);
      docPdf.setFont("helvetica", "normal");
      docPdf.text("Atenciosamente,", margem, y);
      y += 18;

      const assinaturaY = y;
      docPdf.line(margem, assinaturaY, largura - margem - 70, assinaturaY);
      docPdf.setFont("helvetica", "bold");
      docPdf.text(String(item.assinadoPor || nomeUsuario), margem, assinaturaY + 6);
      docPdf.setFont("helvetica", "normal");
      docPdf.text(String(item.cargo || "Responsavel"), margem, assinaturaY + 11);

      docPdf.save(`${String(item.numero || "memorando").replace(/[^\w-]/g, "_")}.pdf`);
    } catch (error) {
      console.error(error);
      alert("Nao foi possivel gerar o PDF do memorando.");
    } finally {
      setGerandoPdfId("");
    }
  };

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: 20, background: "#f5f7fa", minHeight: "100vh" }}>
      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "stretch", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flex: 1, minWidth: 320 }}>
          <div
            style={{
              width: 90,
              height: 90,
              borderRadius: 18,
              border: "1px solid #d9e3f3",
              background: "linear-gradient(180deg, #f8fbff 0%, #edf4ff 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              flexShrink: 0
            }}
          >
            {logoTela ? (
              <img
                src={logoTela}
                alt="Logo da empresa"
                style={{ maxWidth: "78%", maxHeight: "78%", objectFit: "contain" }}
              />
            ) : (
              <div style={{ color: "#4f6482", fontWeight: 800, textAlign: "center", fontSize: 13, lineHeight: 1.2 }}>
                LOGO
              </div>
            )}
          </div>

          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                borderRadius: 999,
                background: "#eef4ff",
                color: "#1d4d8f",
                fontWeight: 800,
                fontSize: 12,
                letterSpacing: 0.3,
                marginBottom: 10
              }}
            >
              DOCUMENTO INTERNO
            </div>
            <h2 style={{ margin: 0, color: "#173454", fontSize: 28, lineHeight: 1.1 }}>Memorando Interno</h2>
            <p style={{ margin: "8px 0 0", color: "#173454", fontWeight: 700, fontSize: 15 }}>
              {nomeEmpresa || "Empresa"}
            </p>
            <p style={{ margin: "6px 0 0", color: "#5f6f86", fontSize: 14 }}>
              Modelo interno simples para comunicacao oficial, solicitacoes e envio de orientacoes.
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" style={secondaryButton} onClick={limparFormulario}>
            {editandoId ? "Novo memorando" : "Limpar"}
          </button>
          <button type="button" style={secondaryButton} onClick={() => setTela("home")}>
            Voltar
          </button>
        </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0, color: "#173454" }}>Dados do memorando</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Numero</label>
            <input style={inputStyle} value={numero} readOnly />
          </div>
          <div>
            <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Data</label>
            <input style={inputStyle} type="date" value={dataEmissao} onChange={(e) => setDataEmissao(e.target.value)} />
          </div>
          <div>
            <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Destinatario</label>
            <input style={inputStyle} value={destinatario} onChange={(e) => setDestinatario(e.target.value)} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Assunto</label>
            <input style={inputStyle} value={assunto} onChange={(e) => setAssunto(e.target.value)} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Descricao</label>
            <textarea style={{ ...areaStyle, minHeight: 160 }} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
        </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0, color: "#173454" }}>Fechamento</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Encerramento</label>
            <textarea style={areaStyle} value={encerramento} onChange={(e) => setEncerramento(e.target.value)} />
          </div>
          <div>
            <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Assinado por</label>
            <input style={inputStyle} value={assinadoPor} onChange={(e) => setAssinadoPor(e.target.value)} />
          </div>
          <div>
            <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Cargo</label>
            <input style={inputStyle} value={cargo} onChange={(e) => setCargo(e.target.value)} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
          <button type="button" style={primaryButton} onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando..." : editandoId ? "Atualizar memorando" : "Salvar memorando"}
          </button>
          <button type="button" style={secondaryButton} onClick={limparFormulario}>
            {editandoId ? "Cancelar edicao" : "Limpar formulario"}
          </button>
        </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0, color: "#173454" }}>Memorandos cadastrados</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
            <thead>
              <tr style={{ background: "#1d5fd1", color: "#fff" }}>
                <th style={{ padding: 12, textAlign: "left" }}>Numero</th>
                <th style={{ padding: 12, textAlign: "left" }}>Data</th>
                <th style={{ padding: 12, textAlign: "left" }}>Assunto</th>
                <th style={{ padding: 12, textAlign: "center" }}>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {lista.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: 18, textAlign: "center", color: "#61738b", borderBottom: "1px solid #edf1f7" }}>
                    Nenhum memorando cadastrado.
                  </td>
                </tr>
              )}
              {lista.map((item) => (
                <tr key={item.id}>
                  <td style={{ padding: 12, borderBottom: "1px solid #edf1f7", fontWeight: 700 }}>{item.numero}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #edf1f7" }}>{formatarDataBR(item.dataEmissao)}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #edf1f7" }}>{item.assunto || "-"}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #edf1f7", textAlign: "center", position: "relative" }}>
                    <button
                      type="button"
                      style={secondaryButton}
                      onClick={() => setMenuAbertoId((atual) => (atual === item.id ? "" : item.id))}
                    >
                      Abrir
                    </button>
                    {menuAbertoId === item.id && (
                      <div
                        style={{
                          marginTop: 8,
                          display: "grid",
                          gap: 8,
                          justifyItems: "stretch"
                        }}
                      >
                        <button type="button" style={secondaryButton} onClick={() => editar(item)}>Editar</button>
                        <button
                          type="button"
                          style={secondaryButton}
                          onClick={() => gerarPdf(item)}
                          disabled={gerandoPdfId === item.id}
                        >
                          {gerandoPdfId === item.id ? "Gerando..." : "PDF"}
                        </button>
                        <button type="button" style={dangerButton} onClick={() => excluir(item)}>Excluir</button>
                      </div>
                    )}
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

export default MemorandoInterno;
