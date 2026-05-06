/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { registrarHistorico } from "../utils/historico";
import { belongsToTenant, getTenantId, withTenant } from "../utils/tenant";

function DiarioObra({ setTela }) {
  const tenantId = getTenantId();
  const sessaoOperacional = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("sessaoOperacional") || "{}");
    } catch {
      return {};
    }
  }, []);

  const perfilSessao = String(sessaoOperacional?.perfilAcesso || "").trim().toUpperCase();
  const usuarioChaveSessao = Boolean(sessaoOperacional?.usuarioChave);
  // Importante: ADMIN_UNIDADE nao e acesso total de bases.
  // Ele deve respeitar basesPermitidas (cidade/estado) como qualquer operacional.
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
  const basePermitida = (obra) =>
    acessoTotalBases || (
      basesPermitidas.length > 0 && (
        basesPermitidas.includes(chaveBase(obra?.cidade, obra?.estado))
        || cidadesPermitidas.has(String(obra?.cidade || "").trim().toUpperCase())
      )
    );

  const isMobileDevice = useMemo(() => {
    const ua = String(window.navigator?.userAgent || "").toLowerCase();
    const mobileUA = /android|iphone|ipad|ipod|mobile|opera mini|iemobile/.test(ua);
    return mobileUA || window.innerWidth <= 900;
  }, []);

  const apontadorNome = String(sessaoOperacional?.nome || localStorage.getItem("usuarioLogado") || "").trim() || "APONTADOR";

  const hojeISO = () => {
    const d = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };

  const card = {
    background: "#fff",
    border: "1px solid #e3e7ef",
    borderRadius: 8,
    padding: 14,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)"
  };

  const inputBase = {
    width: "100%",
    height: 40,
    borderRadius: 8,
    border: "1px solid #cfd7e3",
    padding: "0 10px",
    boxSizing: "border-box"
  };

  const label = { fontSize: 12, fontWeight: 800, color: "#173454", margin: "0 0 6px" };

  const [obras, setObras] = useState([]);
  const [obraId, setObraId] = useState("");
  const obraSelecionada = useMemo(() => obras.find((o) => String(o.id) === String(obraId)) || null, [obras, obraId]);
  const [salvando, setSalvando] = useState(false);

  const [data, setData] = useState(hojeISO());
  const [objeto, setObjeto] = useState("");
  const [objetoAuto, setObjetoAuto] = useState("");
  const [diasDecorridos, setDiasDecorridos] = useState("");
  const [logradouro, setLogradouro] = useState("");
  const [bairro, setBairro] = useState("");

  const CLIMAS = [
    { id: "sol", label: "SOL" },
    { id: "nublado", label: "NUBLADO" },
    { id: "chuva", label: "CHUVA" },
    { id: "impraticavel", label: "IMPRAT." }
  ];
  const [climaManha, setClimaManha] = useState("sol");
  const [climaTarde, setClimaTarde] = useState("sol");

  const [equipe, setEquipe] = useState([
    { funcao: "Encarregado", quantidade: "1" },
    { funcao: "Servente", quantidade: "" }
  ]);
  const [equipamentos, setEquipamentos] = useState([{ descricao: "", quantidade: "" }]);
  const [atividades, setAtividades] = useState("");
  const [ocorrencias, setOcorrencias] = useState("");
  const [acidentes, setAcidentes] = useState("");

  const addEquipe = () => setEquipe((prev) => [...prev, { funcao: "", quantidade: "" }]);
  const removeEquipe = (idx) => setEquipe((prev) => prev.filter((_, i) => i !== idx));

  const addEquipamento = () => setEquipamentos((prev) => [...prev, { descricao: "", quantidade: "" }]);
  const removeEquipamento = (idx) => setEquipamentos((prev) => prev.filter((_, i) => i !== idx));

  const chipWrap = (ativo) => ({
    border: `1px solid ${ativo ? "#0b5ed7" : "#cfd7e3"}`,
    background: ativo ? "#eaf2ff" : "#fff",
    color: ativo ? "#0b5ed7" : "#173454",
    padding: "8px 10px",
    borderRadius: 999,
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
    letterSpacing: 0.2
  });

  const carregarObras = async () => {
    const snap = await getDocs(collection(db, "obras"));
    const lista = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      // Obras legadas (sem tenantId) podem existir. Para nao "sumir" no uso real,
      // permitimos exibir quando o tenant atual nao e o tenant_local.
      .filter((o) => belongsToTenant(o, tenantId) || (!o?.tenantId && String(tenantId) !== "tenant_local"))
      // Operacional: restringe por base/cidade permitida (igual outros modulos).
      .filter((o) => basePermitida(o))
      .sort((a, b) => String(a.numero || a.codigo || a.id).localeCompare(String(b.numero || b.codigo || b.id), "pt-BR"));
    setObras(lista);
    // Se a obra atual nao existe mais na lista (por permissao), seleciona a primeira disponivel.
    const existeAtual = lista.some((o) => String(o.id) === String(obraId));
    if ((!obraId || !existeAtual) && lista.length) setObraId(String(lista[0].id));
  };

  useEffect(() => {
    carregarObras();
  }, []);

  const parseObraNumeroEObjeto = (obra) => {
    const nome = String(obra?.nome || "").trim();
    // Padrao comum: "072 - EXECUCAO DE SERVICOS ..."
    const m = nome.match(/^\s*([0-9]{1,6})\s*[-â€“â€”]\s*(.+)\s*$/);
    if (m) {
      return { numero: m[1], objeto: m[2] };
    }
    // Se nao tiver separador, tenta pegar um "codigo" no inicio.
    const m2 = nome.match(/^\s*([0-9]{1,6})\s+(.+)\s*$/);
    if (m2) {
      return { numero: m2[1], objeto: m2[2] };
    }
    return { numero: nome || String(obra?.id || "-").trim(), objeto: "" };
  };

  // Auto-preencher o Objeto/Descrição com base na obra selecionada.
  useEffect(() => {
    if (!obraSelecionada) return;
    const { objeto: objetoDaObra } = parseObraNumeroEObjeto(obraSelecionada);
    // Se o usuario ainda nao editou manualmente (ou esta com o valor auto anterior),
    // mantemos sempre sincronizado com a obra selecionada.
    const atual = String(objeto || "").trim();
    const autoAnterior = String(objetoAuto || "").trim();
    if (!atual || atual === autoAnterior) {
      const novo = String(objetoDaObra || "").trim();
      setObjeto(novo);
      setObjetoAuto(novo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obraId]);

  const montarPayloadRdo = () => {
    const { numero: obraNumero } = parseObraNumeroEObjeto(obraSelecionada);
    return withTenant({
      data,
      obraId: String(obraId || ""),
      obraNumero: String(obraNumero || "").trim(),
      logradouro: String(logradouro || "").trim(),
      bairro: String(bairro || "").trim(),
      objeto: String(objeto || "").trim(),
      diasDecorridos: String(diasDecorridos || "").trim(),
      climaManha,
      climaTarde,
      equipe: Array.isArray(equipe) ? equipe : [],
      equipamentos: Array.isArray(equipamentos) ? equipamentos : [],
      atividades: String(atividades || "").trim(),
      ocorrencias: String(ocorrencias || "").trim(),
      acidentes: String(acidentes || "").trim(),
      apontadorNome: String(apontadorNome || "").trim(),
      apontadorEmail: String(sessaoOperacional?.email || "").trim(),
      criadoEm: new Date().toISOString()
    }, tenantId);
  };

  const salvarRdo = async () => {
    if (!obraId) {
      alert("Selecione a obra.");
      return;
    }
    const payload = montarPayloadRdo();
    const faltando = [];
    if (!payload.data) faltando.push("Data");
    if (!payload.objeto) faltando.push("Objeto/Descrição");
    if (!payload.logradouro) faltando.push("Logradouro");
    if (!payload.bairro) faltando.push("Bairro");
    if (!String(payload.atividades || "").trim()) faltando.push("Atividades executadas");
    if (faltando.length) {
      alert(`Campos obrigatorios faltando: ${faltando.join(", ")}`);
      return;
    }
    try {
      setSalvando(true);
      // Regras:
      // 1) Permite varios RDO no mesmo dia (ruas diferentes).
      // 2) Evita duplicar o MESMO local no mesmo dia (OBRA + APONTADOR + DATA + LOGRADOURO + BAIRRO).
      // 3) Sequencia 001/002/... por OBRA + APONTADOR (nao mistura entre apontadores).
      const snapExistentes = await getDocs(collection(db, "rdo"));
      const existentes = snapExistentes.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => belongsToTenant(r, tenantId));

      const obraKey = String(payload.obraNumero || "").trim();
      const apontadorKey = String(payload.apontadorEmail || payload.apontadorNome || "").trim().toUpperCase();
      const daMesmaObraEApontador = existentes.filter((r) => {
        if (String(r.obraNumero || "").trim() !== obraKey) return false;
        const key = String(r.apontadorEmail || r.apontadorNome || "").trim().toUpperCase();
        return key === apontadorKey;
      });

      const dataKey = String(payload.data || "").trim();
      const logKey = String(payload.logradouro || "").trim().toUpperCase();
      const bairroKey = String(payload.bairro || "").trim().toUpperCase();
      const jaExisteMesmoLocal = daMesmaObraEApontador.some((r) => {
        if (String(r.data || "").trim() !== dataKey) return false;
        const rLog = String(r.logradouro || "").trim().toUpperCase();
        const rBairro = String(r.bairro || "").trim().toUpperCase();
        return rLog === logKey && rBairro === bairroKey;
      });
      if (jaExisteMesmoLocal) {
        alert("Ja existe um RDO para esse apontador nesta obra, nesta data e neste local (logradouro/bairro).");
        return;
      }

      const maxSeq = daMesmaObraEApontador.reduce((acc, r) => {
        const n = Number(r.sequencia || r.seq || 0);
        return Number.isFinite(n) ? Math.max(acc, n) : acc;
      }, 0);
      const prox = maxSeq + 1;
      const numeroRdo = String(prox).padStart(3, "0");

      const payloadFinal = {
        ...payload,
        sequencia: prox,
        numeroRdo
      };

      const ref = await addDoc(collection(db, "rdo"), payloadFinal);
      await registrarHistorico({
        modulo: "RDO",
        acao: "CRIAR",
        entidade: "RDO",
        registroId: ref.id,
        descricao: `RDO ${payloadFinal.numeroRdo || ""} OBRA ${payloadFinal.obraNumero || "-"} - ${payloadFinal.logradouro || "-"} - ${payloadFinal.data || "-"}`,
        usuario: payloadFinal.apontadorNome || payloadFinal.apontadorEmail || "APONTADOR"
      });
      alert("RDO salvo. Ele vai aparecer em Relatórios > Relatório Diario de Obra (RDO).");
    } catch (e) {
      console.log(e);
      alert("Nao foi possivel salvar o RDO.");
    } finally {
      setSalvando(false);
    }
  };

  // PDF do RDO e gerado/baixado pelo Relatório Diario de Obra (RDO).

  return (
    <div style={{ padding: isMobileDevice ? 10 : 20, maxWidth: 1240, margin: "0 auto", fontFamily: "Arial" }}>
      <div style={{ ...card, marginBottom: 12, borderLeft: "5px solid #0b5ed7" }}>
        <h2 style={{ margin: "0 0 6px", color: "#10243e" }}>Diario de Obra (RDO)</h2>
        <div style={{ color: "#4a5c74", fontWeight: 700, fontSize: 13, lineHeight: 1.25 }}>
          Modelo inicial para voce revisar. Depois que voce aprovar a estrutura, a gente liga no banco e cria o relatorio oficial.
        </div>
      </div>

      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobileDevice ? "1fr" : "1fr 1fr 1fr", gap: 10 }}>
          <div>
            <div style={label}>Data</div>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={inputBase} />
          </div>
          <div>
            <div style={label}>Obra</div>
            <select value={obraId} onChange={(e) => setObraId(e.target.value)} style={inputBase}>
              {obras.map((o) => {
                const { numero } = parseObraNumeroEObjeto(o);
                return (
                  <option key={o.id} value={o.id}>
                    {numero || o.id}
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <div style={label}>Apontador (usuario logado)</div>
            <input type="text" value={apontadorNome} readOnly style={{ ...inputBase, background: "#f8f9fa" }} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobileDevice ? "1fr" : "2fr 1fr", gap: 10, marginTop: 10 }}>
          <div>
            <div style={label}>Logradouro</div>
            <input value={logradouro} onChange={(e) => setLogradouro(e.target.value)} style={inputBase} placeholder="Ex.: AV ORLEI CAMELI / RUA DOIS / TRAVESSA..." />
          </div>
          <div>
            <div style={label}>Bairro</div>
            <input value={bairro} onChange={(e) => setBairro(e.target.value)} style={inputBase} placeholder="Ex.: CENTRO" />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobileDevice ? "1fr" : "2fr 1fr", gap: 10, marginTop: 10 }}>
          <div>
            <div style={label}>Objeto / Descrição</div>
            <textarea
              value={objeto}
              onChange={(e) => setObjeto(e.target.value)}
              rows={isMobileDevice ? 3 : 2}
              style={{ ...inputBase, height: "auto", padding: 10 }}
              placeholder="Ex.: PAVIMENTACAO ASFALTICA EM VIA URBANA..."
            />
          </div>
          <div>
            <div style={label}>Dias decorridos</div>
            <input value={diasDecorridos} onChange={(e) => setDiasDecorridos(e.target.value)} style={inputBase} placeholder="15" />
          </div>
        </div>
      </div>

      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobileDevice ? "1fr" : "1fr 1fr", gap: 12 }}>
          <div>
            <div style={label}>Clima (manha)</div>
            {isMobileDevice ? (
              <select value={climaManha} onChange={(e) => setClimaManha(e.target.value)} style={inputBase}>
                {CLIMAS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {CLIMAS.map((c) => (
                  <button key={c.id} type="button" style={chipWrap(climaManha === c.id)} onClick={() => setClimaManha(c.id)}>
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <div style={label}>Clima (tarde)</div>
            {isMobileDevice ? (
              <select value={climaTarde} onChange={(e) => setClimaTarde(e.target.value)} style={inputBase}>
                {CLIMAS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {CLIMAS.map((c) => (
                  <button key={c.id} type="button" style={chipWrap(climaTarde === c.id)} onClick={() => setClimaTarde(c.id)}>
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, color: "#10243e" }}>Mao de Obra</h3>
          <button type="button" onClick={addEquipe} style={{ ...inputBase, width: "auto", height: 38, cursor: "pointer", fontWeight: 900 }}>
            + Adicionar
          </button>
        </div>
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#0b5ed7", color: "#fff" }}>
                <th style={{ textAlign: "left", padding: 8 }}>Funcao</th>
                <th style={{ width: 120, textAlign: "center", padding: 8 }}>Qtd</th>
                <th style={{ width: 90, textAlign: "center", padding: 8 }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {equipe.map((l, idx) => (
                <tr key={idx}>
                  <td style={{ border: "1px solid #e5ebf3", padding: 6 }}>
                    <input
                      value={l.funcao}
                      onChange={(e) =>
                        setEquipe((prev) => prev.map((x, i) => (i === idx ? { ...x, funcao: e.target.value } : x)))
                      }
                      style={{ ...inputBase, height: 36 }}
                      placeholder="Ex.: Pedreiro"
                    />
                  </td>
                  <td style={{ border: "1px solid #e5ebf3", padding: 6 }}>
                    <input
                      value={l.quantidade}
                      onChange={(e) =>
                        setEquipe((prev) => prev.map((x, i) => (i === idx ? { ...x, quantidade: e.target.value } : x)))
                      }
                      style={{ ...inputBase, height: 36, textAlign: "center" }}
                      placeholder="0"
                    />
                  </td>
                  <td style={{ border: "1px solid #e5ebf3", padding: 6, textAlign: "center" }}>
                    <button
                      type="button"
                      onClick={() => removeEquipe(idx)}
                      style={{ border: "none", borderRadius: 8, padding: "8px 10px", background: "#dc3545", color: "#fff", cursor: "pointer", fontWeight: 900 }}
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
              {!equipe.length && (
                <tr>
                  <td colSpan={3} style={{ border: "1px solid #e5ebf3", padding: 12, textAlign: "center", color: "#6c757d" }}>
                    Nenhuma linha. Clique em "+ Adicionar".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, color: "#10243e" }}>Equipamentos na Frente</h3>
          <button type="button" onClick={addEquipamento} style={{ ...inputBase, width: "auto", height: 38, cursor: "pointer", fontWeight: 900 }}>
            + Adicionar
          </button>
        </div>
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#0b5ed7", color: "#fff" }}>
                <th style={{ textAlign: "left", padding: 8 }}>Equipamento</th>
                <th style={{ width: 90, textAlign: "center", padding: 8 }}>Qtd</th>
                <th style={{ width: 90, textAlign: "center", padding: 8 }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {equipamentos.map((l, idx) => (
                <tr key={idx}>
                  <td style={{ border: "1px solid #e5ebf3", padding: 6 }}>
                    <input
                      value={l.descricao}
                      onChange={(e) =>
                        setEquipamentos((prev) => prev.map((x, i) => (i === idx ? { ...x, descricao: e.target.value } : x)))
                      }
                      style={{ ...inputBase, height: 36 }}
                      placeholder="Ex.: Motoniveladora 120K"
                    />
                  </td>
                  <td style={{ border: "1px solid #e5ebf3", padding: 6 }}>
                    <input
                      value={l.quantidade}
                      onChange={(e) =>
                        setEquipamentos((prev) => prev.map((x, i) => (i === idx ? { ...x, quantidade: e.target.value } : x)))
                      }
                      style={{ ...inputBase, height: 36, textAlign: "center" }}
                      placeholder="0"
                    />
                  </td>
                  <td style={{ border: "1px solid #e5ebf3", padding: 6, textAlign: "center" }}>
                    <button
                      type="button"
                      onClick={() => removeEquipamento(idx)}
                      style={{ border: "none", borderRadius: 8, padding: "8px 10px", background: "#dc3545", color: "#fff", cursor: "pointer", fontWeight: 900 }}
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
              {!equipamentos.length && (
                <tr>
                  <td colSpan={3} style={{ border: "1px solid #e5ebf3", padding: 12, textAlign: "center", color: "#6c757d" }}>
                    Nenhuma linha. Clique em "+ Adicionar".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ ...card, marginBottom: 12 }}>
        <div style={label}>Atividades Executadas</div>
        <textarea
          value={atividades}
          onChange={(e) => setAtividades(e.target.value)}
          rows={isMobileDevice ? 4 : 3}
          style={{ ...inputBase, height: "auto", padding: 10 }}
          placeholder="Descreva as atividades do dia..."
        />
      </div>

      <div style={{ ...card, marginBottom: 12 }}>
        <div style={label}>Ocorrencias / Observações</div>
        <textarea
          value={ocorrencias}
          onChange={(e) => setOcorrencias(e.target.value)}
          rows={isMobileDevice ? 4 : 3}
          style={{ ...inputBase, height: "auto", padding: 10 }}
          placeholder="Ex.: Interrupcoes, falta de material, etc."
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobileDevice ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div style={card}>
          <div style={label}>Acidentes</div>
          <textarea
            value={acidentes}
            onChange={(e) => setAcidentes(e.target.value)}
            rows={isMobileDevice ? 3 : 2}
            style={{ ...inputBase, height: "auto", padding: 10 }}
            placeholder="Se houve, descreva."
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={salvarRdo}
          disabled={salvando}
          style={{
            border: "none",
            borderRadius: 10,
            padding: "12px 16px",
            background: salvando ? "#6c757d" : "#198754",
            color: "#fff",
            fontWeight: 900,
            cursor: salvando ? "not-allowed" : "pointer"
          }}
        >
          {salvando ? "Salvando..." : "Salvar RDO"}
        </button>
        <button
          type="button"
          onClick={() => setTela("home")}
          style={{ border: "none", borderRadius: 10, padding: "12px 16px", background: "#6c757d", color: "#fff", fontWeight: 900, cursor: "pointer" }}
        >
          Voltar ao painel
        </button>
      </div>
    </div>
  );
}

export default DiarioObra;

