/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect } from "react";
import { db } from "../firebase";
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
} from "firebase/firestore";
import { registrarHistorico } from "../utils/historico";
import { belongsToTenant, getTenantId, withTenant } from "../utils/tenant";

function Obras({ setTela }) {
  const tenantId = getTenantId();
  const [nome, setNome] = useState("");
  const [obras, setObras] = useState([]);
  const [estado, setEstado] = useState("");
  const [cidade, setCidade] = useState("");
  const [estados, setEstados] = useState([]);
  const [cidades, setCidades] = useState([]);
  const [catalogoBases, setCatalogoBases] = useState([]);

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

  const dangerButton = {
    background: "#cc0000",
    color: "#fff",
    border: "none",
    padding: "6px 10px",
    borderRadius: 6,
    cursor: "pointer"
  };

  const normalizarTexto = (valor) =>
    String(valor || "").toUpperCase().trim();

  const buscarObras = async () => {
    const querySnapshot = await getDocs(collection(db, "obras"));

    const lista = querySnapshot.docs.map((docItem) => ({
      id: docItem.id,
      ...docItem.data(),
    })).filter((item) => belongsToTenant(item, tenantId));

    lista.sort((a, b) =>
      `${a.estado || ""}${a.cidade || ""}${a.nome || ""}`.localeCompare(
        `${b.estado || ""}${b.cidade || ""}${b.nome || ""}`
      )
    );

    setObras(lista);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    buscarObras();
  }, []);

  useEffect(() => {
    // Preferencia: usa o catalogo de bases cadastrado no sistema (vale para qualquer pais/UF).
    // Fallback: se ainda nao tem bases cadastradas, usa IBGE (Brasil) para nao bloquear.
    const carregarBases = async () => {
      try {
        const snap = await getDocs(collection(db, "bases_operacionais"));
        const bases = snap.docs
          .map((d) => d.data())
          .filter((item) => belongsToTenant(item, tenantId))
          .filter((b) => b.ativo !== false)
          .map((b) => ({ estado: String(b.estado || "").toUpperCase().trim(), cidade: String(b.cidade || "").toUpperCase().trim() }))
          .filter((b) => b.estado && b.cidade);
        setCatalogoBases(bases);
        const ufs = Array.from(new Set(bases.map((b) => b.estado))).sort();
        if (ufs.length) {
          setEstados(ufs);
          return;
        }
      } catch {
        // ignora e tenta fallback IBGE abaixo
      }

      fetch("https://servicodados.ibge.gov.br/api/v1/localidades/estados")
        .then((res) => res.json())
        .then((data) => {
          const lista = data.map((e) => e.sigla).sort();
          setEstados(lista);
        })
        .catch((error) => {
          console.error(error);
          alert("Erro ao carregar estados!");
        });
    };

    carregarBases();
  }, []);

  useEffect(() => {
    if (!estado) {
      setCidades([]);
      return;
    }

    const doCatalogo = catalogoBases
      .filter((b) => String(b.estado || "").toUpperCase().trim() === String(estado || "").toUpperCase().trim())
      .map((b) => b.cidade)
      .filter(Boolean);
    if (doCatalogo.length) {
      setCidades(Array.from(new Set(doCatalogo)).sort());
      return;
    }

    fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${estado}/municipios`)
      .then((res) => res.json())
      .then((data) => {
        const lista = data.map((c) => c.nome);
        setCidades(lista);
      })
      .catch((error) => {
        console.error(error);
        alert("Erro ao carregar cidades!");
      });
  }, [estado]);

  const salvar = async () => {
    if (!nome) return alert("Digite o nome da obra!");
    if (!estado) return alert("Selecione o estado da obra!");
    if (!cidade) return alert("Selecione a cidade da obra!");

    const nomeFormatado = nome.trim().toUpperCase();

    const existe = obras.find(
      (obra) =>
        normalizarTexto(obra.nome) === normalizarTexto(nomeFormatado) &&
        normalizarTexto(obra.estado) === normalizarTexto(estado) &&
        normalizarTexto(obra.cidade) === normalizarTexto(cidade)
    );

    if (existe) {
      alert("Essa obra ja existe nessa cidade!");
      return;
    }

    const ref = await addDoc(collection(db, "obras"), withTenant({
      nome: nomeFormatado,
      estado,
      cidade
    }, tenantId));
    await registrarHistorico({
      modulo: "OBRAS",
      acao: "CRIOU",
      entidade: "OBRA",
      registroId: ref.id,
      descricao: `Cadastrou obra ${nomeFormatado} (${cidade}/${estado}).`
    });

    setNome("");
    setEstado("");
    setCidade("");
    alert("Obra cadastrada!");
    buscarObras();
  };

  const excluir = async (id) => {
    if (!window.confirm("Deseja excluir essa obra?")) return;
    const alvo = obras.find((item) => item.id === id);

    await deleteDoc(doc(db, "obras", id));
    await registrarHistorico({
      modulo: "OBRAS",
      acao: "EXCLUIU",
      entidade: "OBRA",
      registroId: id,
      descricao: `Excluiu obra ${alvo?.nome || "-"} (${alvo?.cidade || "-"}/${alvo?.estado || "-"})`
    });
    buscarObras();
  };

  return (
    <div style={{
      maxWidth: 900,
      margin: "0 auto",
      padding: 20,
      background: "#f5f7fa",
      minHeight: "100vh"
    }}>
      <h2 style={{
        textAlign: "center",
        marginBottom: 20,
        color: "#222"
      }}>
        Cadastro de Obras
      </h2>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Dados da Obra</h3>

        <input
          style={inputStyle}
          placeholder="Nome da obra"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />

        <select
          style={inputStyle}
          value={estado}
          onChange={(e) => {
            setEstado(e.target.value);
            setCidade("");
          }}
        >
          <option value="">Selecione o Estado</option>
          {estados.map((uf) => (
            <option key={uf} value={uf}>{uf}</option>
          ))}
        </select>

        <select
          style={inputStyle}
          value={cidade}
          onChange={(e) => setCidade(e.target.value)}
          disabled={!estado}
        >
          <option value="">
            {estado ? "Selecione a Cidade" : "Selecione o estado primeiro"}
          </option>
          {cidades.map((nomeCidade) => (
            <option key={nomeCidade} value={nomeCidade}>{nomeCidade}</option>
          ))}
        </select>

        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button style={primaryButton} onClick={salvar}>
            SALVAR
          </button>

          </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Relacao de Obras Cadastradas</h3>

        <table style={{
          width: "100%",
          borderCollapse: "collapse",
          background: "#fff",
          borderRadius: 8,
          overflow: "hidden"
        }}>
          <thead style={{ background: "#0b3d91", color: "#fff" }}>
            <tr>
              <th style={{ border: "1px solid #ccc", padding: 10 }}>Obra</th>
              <th style={{ border: "1px solid #ccc", padding: 10 }}>Estado</th>
              <th style={{ border: "1px solid #ccc", padding: 10 }}>Cidade</th>
              <th style={{ border: "1px solid #ccc", padding: 10 }}>Acoes</th>
            </tr>
          </thead>

          <tbody>
            {obras.length === 0 && (
              <tr>
                <td colSpan="4" style={{ padding: 12, textAlign: "center" }}>
                  Nenhuma obra cadastrada.
                </td>
              </tr>
            )}

            {obras.map((obra, index) => (
              <tr
                key={obra.id}
                style={{ background: index % 2 === 0 ? "#f2f2f2" : "#fff" }}
              >
                <td style={{ border: "1px solid #ccc", padding: 10, fontWeight: "bold" }}>
                  {obra.nome}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 10, textAlign: "center" }}>
                  {obra.estado || "-"}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 10 }}>
                  {obra.cidade || "Sem cidade"}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 10, textAlign: "center" }}>
                  <button style={dangerButton} onClick={() => excluir(obra.id)}>
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Obras;

