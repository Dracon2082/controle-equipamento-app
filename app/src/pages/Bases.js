/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { registrarHistorico } from "../utils/historico";
import { belongsToTenant, getTenantId, withTenant } from "../utils/tenant";

function Bases({ setTela }) {
  const tenantId = getTenantId();
  const [estado, setEstado] = useState("");
  const [cidade, setCidade] = useState("");
  const [bases, setBases] = useState([]);
  const [editandoId, setEditandoId] = useState(null);
  const [filtro, setFiltro] = useState("");
  const [estados, setEstados] = useState([]); // ["AC", "SP", ...]
  const [cidades, setCidades] = useState([]); // ["Sena Madureira", ...]
  const [carregandoEstados, setCarregandoEstados] = useState(false);
  const [carregandoCidades, setCarregandoCidades] = useState(false);
  const [modoManual, setModoManual] = useState(false);

  const normalizar = (v) => String(v || "").trim().toUpperCase();
  const normalizarCidade = (v) => String(v || "").trim().toUpperCase();
  const chaveBase = (c, e) => `${normalizarCidade(c)}__${normalizar(e)}`;

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
    padding: "10px 20px",
    border: "none",
    borderRadius: 8,
    fontWeight: "bold",
    cursor: "pointer"
  };

  const secondaryButton = {
    ...primaryButton,
    background: "#6c757d"
  };

  const dangerButton = {
    background: "#cc0000",
    color: "#fff",
    border: "none",
    padding: "6px 10px",
    borderRadius: 6,
    cursor: "pointer"
  };

  const warningButton = {
    background: "#f0ad4e",
    color: "#000",
    border: "none",
    padding: "6px 10px",
    borderRadius: 6,
    cursor: "pointer",
    marginRight: 6
  };

  const carregar = async () => {
    const snap = await getDocs(collection(db, "bases_operacionais"));
    const lista = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((i) => belongsToTenant(i, tenantId))
      .map((i) => ({
        ...i,
        estado: normalizar(i.estado),
        cidade: normalizarCidade(i.cidade),
        chave: chaveBase(i.cidade, i.estado),
        ativo: i.ativo !== false
      }))
      .sort((a, b) => `${a.estado}${a.cidade}`.localeCompare(`${b.estado}${b.cidade}`));
    setBases(lista);
  };

  useEffect(() => {
    carregar();
  }, []);

  // Carrega UFs automaticamente (IBGE).
  useEffect(() => {
    let ativo = true;
    const carregarEstados = async () => {
      setCarregandoEstados(true);
      try {
        const res = await fetch("https://servicodados.ibge.gov.br/api/v1/localidades/estados");
        const data = await res.json();
        const lista = (Array.isArray(data) ? data : [])
          .map((e) => String(e?.sigla || "").toUpperCase().trim())
          .filter(Boolean)
          .sort();
        if (ativo) setEstados(lista);
      } catch {
        if (ativo) setEstados([]);
        // Se falhar, libera modo manual.
        if (ativo) setModoManual(true);
      } finally {
        if (ativo) setCarregandoEstados(false);
      }
    };
    carregarEstados();
    return () => {
      ativo = false;
    };
  }, []);

  // Carrega cidades da UF automaticamente (IBGE).
  useEffect(() => {
    let ativo = true;
    const carregarCidades = async () => {
      setCidades([]);
      if (!estado || modoManual) return;
      setCarregandoCidades(true);
      try {
        const uf = normalizar(estado);
        const res = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`);
        const data = await res.json();
        const lista = (Array.isArray(data) ? data : [])
          .map((c) => String(c?.nome || "").trim())
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));
        if (ativo) setCidades(lista);
      } catch {
        if (ativo) setCidades([]);
        if (ativo) setModoManual(true);
      } finally {
        if (ativo) setCarregandoCidades(false);
      }
    };
    carregarCidades();
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, modoManual]);

  const limpar = () => {
    setEstado("");
    setCidade("");
    setEditandoId(null);
  };

  const salvar = async () => {
    const uf = normalizar(estado);
    const cid = normalizarCidade(cidade);
    if (!uf || uf.length !== 2) return alert("Informe a UF (2 letras). Ex: AC, SP, RJ.");
    if (!cid) return alert("Informe a cidade.");

    const chave = chaveBase(cid, uf);
    const jaExiste = bases.find((b) => b.chave === chave && b.id !== editandoId);
    if (jaExiste) return alert("Essa base ja esta cadastrada (cidade/UF).");

    if (editandoId) {
      await updateDoc(doc(db, "bases_operacionais", editandoId), withTenant({
        estado: uf,
        cidade: cid,
        atualizadoEm: new Date().toISOString()
      }, tenantId));
      await registrarHistorico({
        modulo: "BASES",
        acao: "ATUALIZOU",
        entidade: "BASE_OPERACIONAL",
        registroId: editandoId,
        descricao: `Atualizou base ${cid}/${uf}.`
      });
      alert("Base atualizada.");
      limpar();
      carregar();
      return;
    }

    const ref = await addDoc(collection(db, "bases_operacionais"), withTenant({
      estado: uf,
      cidade: cid,
      ativo: true,
      criadoEm: new Date().toISOString()
    }, tenantId));

    await registrarHistorico({
      modulo: "BASES",
      acao: "CRIOU",
      entidade: "BASE_OPERACIONAL",
      registroId: ref.id,
      descricao: `Cadastrou base ${cid}/${uf}.`
    });

    alert("Base cadastrada!");
    limpar();
    carregar();
  };

  const editar = (item) => {
    setEditandoId(item.id);
    setEstado(item.estado || "");
    setCidade(item.cidade || "");
  };

  const alternarAtivo = async (item) => {
    const novoAtivo = !(item.ativo !== false);
    await updateDoc(doc(db, "bases_operacionais", item.id), withTenant({
      ativo: novoAtivo,
      atualizadoEm: new Date().toISOString()
    }, tenantId));
    await registrarHistorico({
      modulo: "BASES",
      acao: novoAtivo ? "ATIVOU" : "INATIVOU",
      entidade: "BASE_OPERACIONAL",
      registroId: item.id,
      descricao: `${novoAtivo ? "Ativou" : "Inativou"} base ${item.cidade}/${item.estado}.`
    });
    carregar();
  };

  const excluir = async (item) => {
    if (!window.confirm(`Excluir a base ${item.cidade}/${item.estado}?`)) return;
    await deleteDoc(doc(db, "bases_operacionais", item.id));
    await registrarHistorico({
      modulo: "BASES",
      acao: "EXCLUIU",
      entidade: "BASE_OPERACIONAL",
      registroId: item.id,
      descricao: `Excluiu base ${item.cidade}/${item.estado}.`
    });
    carregar();
  };

  const listaFiltrada = useMemo(() => {
    const f = normalizar(filtro);
    if (!f) return bases;
    return bases.filter((b) => `${b.cidade}/${b.estado}`.includes(f));
  }, [bases, filtro]);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 20, background: "#f5f7fa", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, color: "#222" }}>Cadastro de Bases (UF e Cidades)</h2>
        <button onClick={() => setTela("home")} style={secondaryButton}>Voltar</button>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Nova base</h3>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <div style={{ color: "#51637c", fontWeight: 700, fontSize: 13 }}>
            Selecione a UF e a cidade (IBGE). Se nao carregar, ative o modo manual.
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#173454", fontWeight: 900 }}>
            <input type="checkbox" checked={modoManual} onChange={(e) => setModoManual(e.target.checked)} />
            Modo manual
          </label>
        </div>

        {!modoManual ? (
          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 10 }}>
            <select
              style={inputStyle}
              value={estado}
              onChange={(e) => {
                setEstado(e.target.value);
                setCidade("");
              }}
              disabled={carregandoEstados}
            >
              <option value="">{carregandoEstados ? "Carregando UFs..." : "Selecione a UF"}</option>
              {estados.map((uf) => (
                <option key={uf} value={uf}>{uf}</option>
              ))}
            </select>

            <select
              style={inputStyle}
              value={cidade}
              onChange={(e) => setCidade(e.target.value)}
              disabled={!estado || carregandoCidades}
            >
              <option value="">
                {!estado
                  ? "Selecione a UF primeiro"
                  : (carregandoCidades ? "Carregando cidades..." : "Selecione a cidade")}
              </option>
              {cidades.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10 }}>
            <input
              style={inputStyle}
              placeholder="UF (ex: AC)"
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
              maxLength={2}
            />
            <input
              style={inputStyle}
              placeholder="Cidade (ex: Sena Madureira)"
              value={cidade}
              onChange={(e) => setCidade(e.target.value)}
            />
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
          <button style={primaryButton} onClick={salvar}>{editandoId ? "ATUALIZAR" : "SALVAR"}</button>
          <button style={secondaryButton} onClick={limpar}>LIMPAR</button>
        </div>
      </div>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Bases cadastradas</h3>
          <input
            style={{ ...inputStyle, marginBottom: 0, width: 320, maxWidth: "100%" }}
            placeholder="Buscar base (cidade/UF)..."
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
          />
        </div>

        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 8, overflow: "hidden", minWidth: 720 }}>
            <thead style={{ background: "#0b3d91", color: "#fff" }}>
              <tr>
                {["UF", "Cidade", "Status", "Acoes"].map((h) => (
                  <th key={h} style={{ border: "1px solid #d8e0ea", padding: 10, textAlign: "center" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listaFiltrada.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: 12, textAlign: "center" }}>Nenhuma base cadastrada.</td>
                </tr>
              )}
              {listaFiltrada.map((b, idx) => (
                <tr key={b.id} style={{ background: idx % 2 === 0 ? "#f8fbff" : "#fff" }}>
                  <td style={{ border: "1px solid #e5ebf3", padding: 10, textAlign: "center", fontWeight: 900 }}>{b.estado}</td>
                  <td style={{ border: "1px solid #e5ebf3", padding: 10, textAlign: "center", fontWeight: 900 }}>{b.cidade}</td>
                  <td style={{ border: "1px solid #e5ebf3", padding: 10, textAlign: "center", fontWeight: 900, color: b.ativo ? "#198754" : "#6c757d" }}>
                    {b.ativo ? "ATIVA" : "INATIVA"}
                  </td>
                  <td style={{ border: "1px solid #e5ebf3", padding: 10, textAlign: "center", whiteSpace: "nowrap" }}>
                    <button style={warningButton} onClick={() => editar(b)}>Editar</button>
                    <button style={{ ...warningButton, background: b.ativo ? "#adb5bd" : "#20c997" }} onClick={() => alternarAtivo(b)}>
                      {b.ativo ? "Inativar" : "Ativar"}
                    </button>
                    <button style={dangerButton} onClick={() => excluir(b)}>Excluir</button>
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

export default Bases;
