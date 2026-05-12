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

  // Fallback para sempre listar todos os estados do Brasil mesmo se o IBGE falhar.
  const UFS_BR = [
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
    "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
    "RS", "RO", "RR", "SC", "SP", "SE", "TO"
  ];

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
    // Mostra a lista completa de UFs imediatamente, mesmo se o IBGE demorar ou falhar.
    // Isso evita o "bug visual" de aparecer apenas AC (por exemplo, quando o sistema
    // ainda tem poucas bases cadastradas ou o IBGE nÃƒÂ£o responde).
    setEstados(UFS_BR);

    // Carrega bases do sistema (para validacoes/atalhos), mas SEM limitar o cadastro de obras
    // apenas as UFs/cidades ja cadastradas. Assim, o usuario consegue cadastrar obras em
    // qualquer estado/cidade (IBGE) e, se desejar, cadastrar a base depois.
    const carregarBases = async () => {
      let ufsDoSistema = [];
      try {
        const snap = await getDocs(collection(db, "bases_operacionais"));
        const bases = snap.docs
          .map((d) => d.data())
          .filter((item) => belongsToTenant(item, tenantId))
          .filter((b) => b.ativo !== false)
          .map((b) => ({ estado: String(b.estado || "").toUpperCase().trim(), cidade: String(b.cidade || "").toUpperCase().trim() }))
          .filter((b) => b.estado && b.cidade);
        setCatalogoBases(bases);
        ufsDoSistema = Array.from(new Set(bases.map((b) => b.estado))).filter(Boolean);
      } catch {
        // ignora; ainda vamos tentar IBGE abaixo
      }

      // Sempre tenta IBGE para mostrar todos os estados do Brasil.
      try {
        const res = await fetch("https://servicodados.ibge.gov.br/api/v1/localidades/estados");
        const data = await res.json();
        const ufsIbge = (Array.isArray(data) ? data : [])
          .map((e) => String(e?.sigla || "").toUpperCase().trim())
          .filter(Boolean);

        // Merge: lista fixa do Brasil + IBGE + (o que ja existe no sistema). Mantemos tudo.
        const merged = Array.from(new Set([...UFS_BR, ...ufsIbge, ...ufsDoSistema])).sort();
        setEstados(merged);
      } catch (error) {
        console.error(error);
        // Se IBGE falhar, ainda assim mostra todos os estados do Brasil.
        const merged = Array.from(new Set([...UFS_BR, ...ufsDoSistema])).sort();
        setEstados(merged);
      }
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
    const doCatalogoSet = new Set(doCatalogo.map((c) => String(c || "").toUpperCase().trim()).filter(Boolean));

    // Sempre tenta IBGE para listar TODAS as cidades daquela UF.
    // Se falhar, cai no catalogo do sistema (se existir).
    const uf = String(estado || "").toUpperCase().trim();
    fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`)
      .then((res) => res.json())
      .then((data) => {
        const lista = (Array.isArray(data) ? data : [])
          .map((c) => String(c?.nome || "").trim())
          .filter(Boolean);

        // Se a cidade ja existe como base no sistema, pode aparecer primeiro (sinaliza "oficial").
        const ordenada = lista.sort((a, b) => {
          const aKey = String(a).toUpperCase().trim();
          const bKey = String(b).toUpperCase().trim();
          const aEhBase = doCatalogoSet.has(aKey) ? 0 : 1;
          const bEhBase = doCatalogoSet.has(bKey) ? 0 : 1;
          if (aEhBase !== bEhBase) return aEhBase - bEhBase;
          return a.localeCompare(b);
        });

        setCidades(ordenada);
      })
      .catch((error) => {
        console.error(error);
        if (doCatalogo.length) {
          setCidades(Array.from(new Set(doCatalogo)).sort());
          return;
        }
        alert("Erro ao carregar cidades (IBGE)!");
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
      alert("Essa obra já existe nessa cidade!");
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
        <h3 style={{ marginTop: 0 }}>Relação de Obras Cadastradas</h3>

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
              <th style={{ border: "1px solid #ccc", padding: 10 }}>Ações</th>
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



