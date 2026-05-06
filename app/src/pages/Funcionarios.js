/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  updateDoc
} from "firebase/firestore";
import { registrarHistorico } from "../utils/historico";
import { belongsToTenant, getTenantId, withTenant } from "../utils/tenant";

function Funcionarios({ setTela }) {
  const tenantId = getTenantId();
  const hojeBR = () => new Date().toLocaleDateString("pt-BR");

  const formatarDataBR = (valor) => {
    const numeros = String(valor || "").replace(/\D/g, "").slice(0, 8);
    if (numeros.length <= 2) return numeros;
    if (numeros.length <= 4) return `${numeros.slice(0, 2)}/${numeros.slice(2)}`;
    return `${numeros.slice(0, 2)}/${numeros.slice(2, 4)}/${numeros.slice(4)}`;
  };

  const dataValidaBR = (valor) => {
    const match = String(valor || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return false;
    const dia = Number(match[1]);
    const mes = Number(match[2]);
    const ano = Number(match[3]);
    const data = new Date(ano, mes - 1, dia);
    return (
      data.getFullYear() === ano &&
      data.getMonth() === mes - 1 &&
      data.getDate() === dia
    );
  };

  const formatarCpf = (valor) => {
    const numeros = String(valor || "").replace(/\D/g, "").slice(0, 11);
    if (numeros.length <= 3) return numeros;
    if (numeros.length <= 6) return `${numeros.slice(0, 3)}.${numeros.slice(3)}`;
    if (numeros.length <= 9) return `${numeros.slice(0, 3)}.${numeros.slice(3, 6)}.${numeros.slice(6)}`;
    return `${numeros.slice(0, 3)}.${numeros.slice(3, 6)}.${numeros.slice(6, 9)}-${numeros.slice(9)}`;
  };

  const soDigitos = (valor) => String(valor || "").replace(/\D/g, "");
  const normalizarTexto = (valor) => String(valor || "").toUpperCase().trim();

  const [nome, setNome] = useState("");
  const [funcao, setFuncao] = useState("");
  const [cpf, setCpf] = useState("");
  const [dataNascimento, setDataNascimento] = useState("");
  const [dataCadastro, setDataCadastro] = useState(hojeBR());
  const [lista, setLista] = useState([]);
  const [listaOriginal, setListaOriginal] = useState([]);
  const [editandoId, setEditandoId] = useState(null);
  const [busca, setBusca] = useState("");
  const [filtroFuncao, setFiltroFuncao] = useState("");
  const [acoesAbertasId, setAcoesAbertasId] = useState(null);
  const [acoesMenuPos, setAcoesMenuPos] = useState({ left: 0, top: 0 });
  const actionMenuRef = useRef(null);

  const inputStyle = {
    width: "100%",
    height: 42,
    padding: "0 10px",
    borderRadius: "6px",
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
    border: "none",
    padding: "10px 20px",
    borderRadius: 8,
    fontWeight: "bold",
    cursor: "pointer"
  };

  const secondaryButton = {
    ...primaryButton,
    background: "#6c757d"
  };

  const actionButton = {
    ...primaryButton,
    padding: "8px 14px",
    borderRadius: 999,
    background: "#0b3d91"
  };

  const actionMenu = {
    position: "fixed",
    background: "#fff",
    border: "1px solid #d8e0ea",
    borderRadius: 10,
    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
    padding: 10,
    minWidth: 190,
    zIndex: 9999
  };

  const actionItem = {
    width: "100%",
    boxSizing: "border-box",
    display: "block",
    textAlign: "left",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid transparent",
    background: "transparent",
    cursor: "pointer",
    fontWeight: 800,
    color: "#0b2239"
  };

  const limparFormulario = () => {
    setNome("");
    setFuncao("");
    setCpf("");
    setDataNascimento("");
    setDataCadastro(hojeBR());
    setEditandoId(null);
  };

  const buscar = async () => {
    const querySnapshot = await getDocs(collection(db, "funcionarios"));

    const dados = querySnapshot.docs.map((docItem) => ({
      id: docItem.id,
      ...docItem.data(),
    })).filter((item) => belongsToTenant(item, tenantId));

    dados.sort((a, b) => `${a.nome || ""}`.localeCompare(`${b.nome || ""}`));
    setLista(dados);
    setListaOriginal(dados);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    buscar();
  }, []);

  const editar = (item) => {
    setNome(item.nome || "");
    setFuncao(item.funcao || "");
    setCpf(formatarCpf(item.cpf || ""));
    setDataNascimento(item.dataNascimento || "");
    setDataCadastro(item.dataCadastro || hojeBR());
    setEditandoId(item.id);
    setAcoesAbertasId(null);
  };

  const salvar = async () => {
    if (!nome) return alert("Digite o nome completo do funcionario!");
    if (!funcao) return alert("Digite a funcao!");
    if (soDigitos(cpf).length !== 11) return alert("CPF invalido!");
    if (!dataValidaBR(dataCadastro)) return alert("Data invalida! Use dd/mm/aaaa.");
    if (dataNascimento && !dataValidaBR(dataNascimento)) return alert("Data de nascimento invalida! Use dd/mm/aaaa.");

    const cpfNumero = soDigitos(cpf);
    const nomeFormatado = normalizarTexto(nome);
    const funcaoFormatada = normalizarTexto(funcao);

    const cpfExiste = lista.find(
      (item) => soDigitos(item.cpf) === cpfNumero && item.id !== editandoId
    );
    if (cpfExiste) return alert("CPF ja cadastrado!");

    if (editandoId) {
      await updateDoc(doc(db, "funcionarios", editandoId), {
        nome: nomeFormatado,
        funcao: funcaoFormatada,
        cpf: cpfNumero,
        dataNascimento: dataNascimento || "",
        dataCadastro
      });
      await registrarHistorico({
        modulo: "FUNCIONARIOS",
        acao: "EDITOU",
        entidade: "FUNCIONARIO",
        registroId: editandoId,
        usuario: nomeFormatado,
        descricao: `Editou funcionario ${nomeFormatado}.`
      });
    } else {
      const ref = await addDoc(collection(db, "funcionarios"), withTenant({
        nome: nomeFormatado,
        funcao: funcaoFormatada,
        cpf: cpfNumero,
        dataNascimento: dataNascimento || "",
        dataCadastro
      }, tenantId));
      await registrarHistorico({
        modulo: "FUNCIONARIOS",
        acao: "CRIOU",
        entidade: "FUNCIONARIO",
        registroId: ref.id,
        usuario: nomeFormatado,
        descricao: `Cadastrou funcionario ${nomeFormatado}.`
      });
    }

    alert("Funcionario salvo com sucesso!");
    limparFormulario();
    buscar();
  };

  const excluir = async (id) => {
    if (!window.confirm("Excluir funcionario?")) return;
    const alvo = lista.find((item) => item.id === id);

    await deleteDoc(doc(db, "funcionarios", id));
    await registrarHistorico({
      modulo: "FUNCIONARIOS",
      acao: "EXCLUIU",
      entidade: "FUNCIONARIO",
      registroId: id,
      usuario: alvo?.nome || "",
      descricao: `Excluiu funcionario ${alvo?.nome || "-"}.`
    });
    buscar();
  };

  const funcoesDisponiveis = useMemo(() => {
    const set = new Set(
      (listaOriginal || [])
        .map((i) => normalizarTexto(i.funcao || ""))
        .filter(Boolean)
    );
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [listaOriginal]);

  const listaFiltrada = useMemo(() => {
    const t = String(busca || "").toLowerCase().trim();
    const f = normalizarTexto(filtroFuncao || "");

    return (listaOriginal || []).filter((item) => {
      const nomeOk = !t || String(item.nome || "").toLowerCase().includes(t);
      const funcaoOk = !f || normalizarTexto(item.funcao || "") === f;
      return nomeOk && funcaoOk;
    });
  }, [listaOriginal, busca, filtroFuncao]);

  // Reposiciona o menu real e evita ficar cortado (principalmente em telas menores).
  useLayoutEffect(() => {
    if (!acoesAbertasId) return;
    const el = actionMenuRef.current;
    if (!el) return;

    const padding = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const rect = el.getBoundingClientRect();
    let left = acoesMenuPos.left;
    let top = acoesMenuPos.top;

    if (rect.right > vw - padding) left = Math.max(padding, left - (rect.right - (vw - padding)));
    if (rect.bottom > vh - padding) top = Math.max(padding, top - (rect.bottom - (vh - padding)));
    if (rect.left < padding) left = padding;
    if (rect.top < padding) top = padding;

    if (left !== acoesMenuPos.left || top !== acoesMenuPos.top) {
      setAcoesMenuPos({ left, top });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acoesAbertasId]);

  // Fecha o menu se rolar a tela/redimensionar (evita menu "perdido").
  useEffect(() => {
    if (!acoesAbertasId) return;
    const close = () => setAcoesAbertasId(null);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [acoesAbertasId]);

  return (
    <div
      style={{
        maxWidth: 950,
        margin: "0 auto",
        padding: 20,
        background: "#f5f7fa",
        minHeight: "100vh"
      }}
      onClick={() => setAcoesAbertasId(null)}
    >
      <h2 style={{ textAlign: "center", marginBottom: 20 }}>
        Cadastro de Funcionarios
      </h2>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Dados do Funcionario</h3>

        <input
          style={inputStyle}
          placeholder="Nome completo"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />

        <input
          style={inputStyle}
          placeholder="Funcao"
          value={funcao}
          onChange={(e) => setFuncao(e.target.value)}
        />

        <input
          style={inputStyle}
          placeholder="CPF"
          value={cpf}
          maxLength={14}
          onChange={(e) => setCpf(formatarCpf(e.target.value))}
        />

        <input
          style={inputStyle}
          type="text"
          inputMode="numeric"
          maxLength={10}
          placeholder="Data de nascimento (opcional) (dd/mm/aaaa)"
          value={dataNascimento}
          onChange={(e) => setDataNascimento(formatarDataBR(e.target.value))}
        />

        <input
          style={inputStyle}
          type="text"
          inputMode="numeric"
          maxLength={10}
          placeholder="Data de cadastro (dd/mm/aaaa)"
          value={dataCadastro}
          onChange={(e) => setDataCadastro(formatarDataBR(e.target.value))}
        />

        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button style={primaryButton} onClick={salvar}>
            {editandoId ? "ATUALIZAR" : "SALVAR"}
          </button>
          <button style={secondaryButton} onClick={limparFormulario}>
            LIMPAR
          </button>
          </div>
      </div>

      <div style={card}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 10, alignItems: "center", marginBottom: 14 }}>
          <input
            style={{ ...inputStyle, marginBottom: 0 }}
            placeholder="Buscar funcionario (nome)..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />

          <select
            style={{ ...inputStyle, marginBottom: 0 }}
            value={filtroFuncao}
            onChange={(e) => setFiltroFuncao(e.target.value)}
          >
            <option value="">Todas as funcoes</option>
            {funcoesDisponiveis.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ fontWeight: 900, color: "#173454" }}>
            Total: {listaFiltrada.length}
            {filtroFuncao ? ` | Funcao: ${normalizarTexto(filtroFuncao)}` : ""}
          </div>
          <button
            style={secondaryButton}
            onClick={() => {
              setBusca("");
              setFiltroFuncao("");
            }}
          >
            Limpar filtros
          </button>
        </div>

        <table style={{
          width: "100%",
          borderCollapse: "collapse",
          background: "#fff",
          borderRadius: 8,
          overflow: "hidden"
        }}>
          <thead style={{ background: "#0b3d91", color: "#fff" }}>
            <tr>
              <th style={{ border: "1px solid #ccc", padding: 8 }}>Nome</th>
              <th style={{ border: "1px solid #ccc", padding: 8 }}>Funcao</th>
              <th style={{ border: "1px solid #ccc", padding: 8 }}>CPF</th>
              <th style={{ border: "1px solid #ccc", padding: 8 }}>Data Nasc.</th>
              <th style={{ border: "1px solid #ccc", padding: 8 }}>Data Cadastro</th>
              <th style={{ border: "1px solid #ccc", padding: 8 }}>Ações</th>
            </tr>
          </thead>

          <tbody>
            {listaFiltrada.length === 0 && (
              <tr>
                <td colSpan="6" style={{ textAlign: "center", padding: 12 }}>
                  Nenhum funcionario cadastrado.
                </td>
              </tr>
            )}

            {listaFiltrada.map((item, index) => (
              <tr
                key={item.id}
                style={{ background: index % 2 === 0 ? "#f2f2f2" : "#fff" }}
              >
                <td style={{ border: "1px solid #ccc", padding: 8 }}>{item.nome || "-"}</td>
                <td style={{ border: "1px solid #ccc", padding: 8 }}>{item.funcao || "-"}</td>
                <td style={{ border: "1px solid #ccc", padding: 8, whiteSpace: "nowrap" }}>{formatarCpf(item.cpf || "") || "-"}</td>
                <td style={{ border: "1px solid #ccc", padding: 8, whiteSpace: "nowrap" }}>{item.dataNascimento || "-"}</td>
                <td style={{ border: "1px solid #ccc", padding: 8, whiteSpace: "nowrap" }}>{item.dataCadastro || "-"}</td>
                <td style={{ border: "1px solid #ccc", padding: 8, textAlign: "center" }}>
                  <div style={{ position: "relative", display: "inline-block" }} onClick={(e) => e.stopPropagation()}>
                    <button
                      style={actionButton}
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const menuW = 210;
                        const menuH = 120;
                        const gap = 8;

                        const topPreferido = rect.bottom + gap;
                        const top = (topPreferido + menuH > window.innerHeight - 12)
                          ? Math.max(12, rect.top - gap - menuH)
                          : topPreferido;

                        const leftPreferido = rect.left;
                        const left = (leftPreferido + menuW > window.innerWidth - 12)
                          ? Math.max(12, rect.right - menuW)
                          : leftPreferido;

                        setAcoesMenuPos({ left, top });
                        setAcoesAbertasId((prev) => (prev === item.id ? null : item.id));
                      }}
                    >
                      Abrir
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {acoesAbertasId && (
        <div
          ref={actionMenuRef}
          style={{ ...actionMenu, left: acoesMenuPos.left, top: acoesMenuPos.top }}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const item = (listaOriginal || []).find((x) => x.id === acoesAbertasId);
            if (!item) return null;
            return (
              <>
                <button
                  style={{ ...actionItem, borderColor: "#ffe3b3", background: "#fff7e6" }}
                  onClick={() => editar(item)}
                >
                  Editar
                </button>

                <button
                  style={{
                    ...actionItem,
                    marginTop: 8,
                    borderColor: "#ffd6d6",
                    background: "#fff0f0",
                    color: "#a10f0f"
                  }}
                  onClick={() => excluir(item.id)}
                >
                  Excluir
                </button>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export default Funcionarios;


