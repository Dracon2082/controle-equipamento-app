/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect } from "react";
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
  const [dataCadastro, setDataCadastro] = useState(hojeBR());
  const [lista, setLista] = useState([]);
  const [listaOriginal, setListaOriginal] = useState([]);
  const [editandoId, setEditandoId] = useState(null);

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

  const warningButton = {
    background: "#f0ad4e",
    color: "#000",
    border: "none",
    padding: "6px 10px",
    borderRadius: 6,
    cursor: "pointer",
    marginRight: 6
  };

  const dangerButton = {
    background: "#cc0000",
    color: "#fff",
    border: "none",
    padding: "6px 10px",
    borderRadius: 6,
    cursor: "pointer"
  };

  const limparFormulario = () => {
    setNome("");
    setFuncao("");
    setCpf("");
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
    setDataCadastro(item.dataCadastro || item.dataNascimento || hojeBR());
    setEditandoId(item.id);
  };

  const salvar = async () => {
    if (!nome) return alert("Digite o nome completo do funcionario!");
    if (!funcao) return alert("Digite a funcao!");
    if (soDigitos(cpf).length !== 11) return alert("CPF invalido!");
    if (!dataValidaBR(dataCadastro)) return alert("Data invalida! Use dd/mm/aaaa.");

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

  return (
    <div style={{
      maxWidth: 950,
      margin: "0 auto",
      padding: 20,
      background: "#f5f7fa",
      minHeight: "100vh"
    }}>
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
        <input
          style={{ ...inputStyle, marginBottom: 14 }}
          placeholder="Buscar funcionario..."
          onChange={(e) => {
            const valor = String(e.target.value || "").toLowerCase().trim();

            if (!valor) {
              setLista(listaOriginal);
              return;
            }

            const filtrado = listaOriginal.filter((item) =>
              String(item.nome || "").toLowerCase().includes(valor)
            );
            setLista(filtrado);
          }}
        />

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
              <th style={{ border: "1px solid #ccc", padding: 8 }}>Data Cadastro</th>
              <th style={{ border: "1px solid #ccc", padding: 8 }}>Acoes</th>
            </tr>
          </thead>

          <tbody>
            {lista.length === 0 && (
              <tr>
                <td colSpan="5" style={{ textAlign: "center", padding: 12 }}>
                  Nenhum funcionario cadastrado.
                </td>
              </tr>
            )}

            {lista.map((item, index) => (
              <tr
                key={item.id}
                style={{ background: index % 2 === 0 ? "#f2f2f2" : "#fff" }}
              >
                <td style={{ border: "1px solid #ccc", padding: 8 }}>{item.nome || "-"}</td>
                <td style={{ border: "1px solid #ccc", padding: 8 }}>{item.funcao || "-"}</td>
                <td style={{ border: "1px solid #ccc", padding: 8, whiteSpace: "nowrap" }}>{formatarCpf(item.cpf || "") || "-"}</td>
                <td style={{ border: "1px solid #ccc", padding: 8, whiteSpace: "nowrap" }}>{item.dataCadastro || item.dataNascimento || "-"}</td>
                <td style={{ border: "1px solid #ccc", padding: 8, textAlign: "center" }}>
                  <button style={warningButton} onClick={() => editar(item)}>Editar</button>
                  <button style={dangerButton} onClick={() => excluir(item.id)}>Excluir</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Funcionarios;

