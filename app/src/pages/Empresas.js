/* eslint-disable react-hooks/exhaustive-deps */
import { db } from "../firebase";
import { useState, useEffect } from "react";
import { collection, addDoc, getDocs, deleteDoc, doc } from "firebase/firestore";
import { registrarHistorico } from "../utils/historico";
import { belongsToTenant, getTenantId, withTenant } from "../utils/tenant";

function Empresas({ setTela }) {
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

  const soDigitos = (valor) => String(valor || "").replace(/\D/g, "");
  const normalizarTexto = (valor) => String(valor || "").toUpperCase().trim();

  const formatarDocumento = (valor, tipoDocumento) => {
    const numeros = soDigitos(valor);
    if (tipoDocumento === "CPF") {
      const v = numeros.slice(0, 11);
      if (v.length <= 3) return v;
      if (v.length <= 6) return `${v.slice(0, 3)}.${v.slice(3)}`;
      if (v.length <= 9) return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6)}`;
      return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;
    }

    const v = numeros.slice(0, 14);
    if (v.length <= 2) return v;
    if (v.length <= 5) return `${v.slice(0, 2)}.${v.slice(2)}`;
    if (v.length <= 8) return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5)}`;
    if (v.length <= 12) return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8)}`;
    return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
  };

  const formatarTelefone = (valor) => {
    const numeros = soDigitos(valor).slice(0, 11);
    if (numeros.length <= 2) return numeros;
    if (numeros.length <= 6) return `(${numeros.slice(0, 2)}) ${numeros.slice(2)}`;
    if (numeros.length <= 10) {
      return `(${numeros.slice(0, 2)}) ${numeros.slice(2, 6)}-${numeros.slice(6)}`;
    }
    return `(${numeros.slice(0, 2)}) ${numeros.slice(2, 7)}-${numeros.slice(7)}`;
  };

  const [nome, setNome] = useState("");
  const [tipoDocumento, setTipoDocumento] = useState("CNPJ");
  const [documento, setDocumento] = useState("");
  const [telefone, setTelefone] = useState("");
  const [dataCadastro, setDataCadastro] = useState(hojeBR());
  const [lista, setLista] = useState([]);

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

  const dangerButton = {
    background: "#cc0000",
    color: "#fff",
    border: "none",
    padding: "6px 10px",
    borderRadius: 6,
    cursor: "pointer"
  };

  const buscar = async () => {
    const snap = await getDocs(collection(db, "empresas"));

    const dados = snap.docs.map((docItem) => ({
      id: docItem.id,
      ...docItem.data(),
    })).filter((item) => belongsToTenant(item, tenantId));

    dados.sort((a, b) => `${a.nome || ""}`.localeCompare(`${b.nome || ""}`));
    setLista(dados);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    buscar();
  }, []);

  const limparFormulario = () => {
    setNome("");
    setTipoDocumento("CNPJ");
    setDocumento("");
    setTelefone("");
    setDataCadastro(hojeBR());
  };

  const salvar = async () => {
    if (!nome) return alert("Digite o nome da empresa!");
    if (!documento) return alert(`Digite o ${tipoDocumento}!`);
    if (!dataValidaBR(dataCadastro)) return alert("Data invalida! Use dd/mm/aaaa.");

    const docNumero = soDigitos(documento);
    if (tipoDocumento === "CPF" && docNumero.length !== 11) return alert("CPF invalido!");
    if (tipoDocumento === "CNPJ" && docNumero.length !== 14) return alert("CNPJ invalido!");

    const nomeNormalizado = normalizarTexto(nome);
    const existeNome = lista.find((item) => normalizarTexto(item.nome) === nomeNormalizado);
    if (existeNome) return alert("Empresa ja cadastrada!");

    const existeDocumento = lista.find(
      (item) => soDigitos(item.documento || item.cnpj || item.cpf) === docNumero
    );
    if (existeDocumento) return alert(`${tipoDocumento} ja cadastrado!`);

    const ref = await addDoc(collection(db, "empresas"), withTenant({
      nome: nomeNormalizado,
      tipoDocumento,
      documento: docNumero,
      telefone: soDigitos(telefone),
      dataCadastro
    }, tenantId));
    await registrarHistorico({
      modulo: "EMPRESAS",
      acao: "CRIOU",
      entidade: "EMPRESA_REQUISITANTE",
      registroId: ref.id,
      descricao: `Cadastrou empresa ${nomeNormalizado}.`
    });
    alert("Empresa salva com sucesso!");
    limparFormulario();
    buscar();
  };

  const excluir = async (id) => {
    if (!window.confirm("Excluir empresa?")) return;
    const alvo = lista.find((item) => item.id === id);

    await deleteDoc(doc(db, "empresas", id));
    await registrarHistorico({
      modulo: "EMPRESAS",
      acao: "EXCLUIU",
      entidade: "EMPRESA_REQUISITANTE",
      registroId: id,
      descricao: `Excluiu empresa ${alvo?.nome || "-"}.`
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
        Empresas Requisitantes
      </h2>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Cadastro da Empresa</h3>

        <input
          style={inputStyle}
          placeholder="Nome da empresa"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />

        <select
          style={inputStyle}
          value={tipoDocumento}
          onChange={(e) => {
            setTipoDocumento(e.target.value);
            setDocumento("");
          }}
        >
          <option value="CNPJ">CNPJ</option>
          <option value="CPF">CPF</option>
        </select>

        <input
          style={inputStyle}
          placeholder={tipoDocumento}
          value={documento}
          onChange={(e) => setDocumento(formatarDocumento(e.target.value, tipoDocumento))}
        />

        <input
          style={inputStyle}
          placeholder="Telefone para contato"
          value={telefone}
          onChange={(e) => setTelefone(formatarTelefone(e.target.value))}
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
          <button style={primaryButton} onClick={salvar}>SALVAR</button>
          <button style={secondaryButton} onClick={limparFormulario}>LIMPAR</button>
          </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Tabela de Empresas Cadastradas</h3>

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
              <th style={{ border: "1px solid #ccc", padding: 8 }}>Tipo</th>
              <th style={{ border: "1px solid #ccc", padding: 8 }}>Documento</th>
              <th style={{ border: "1px solid #ccc", padding: 8 }}>Telefone</th>
              <th style={{ border: "1px solid #ccc", padding: 8 }}>Data Cadastro</th>
              <th style={{ border: "1px solid #ccc", padding: 8 }}>Ações</th>
            </tr>
          </thead>

          <tbody>
            {lista.length === 0 && (
              <tr>
                <td colSpan="6" style={{ textAlign: "center", padding: 12 }}>
                  Nenhuma empresa cadastrada.
                </td>
              </tr>
            )}

            {lista.map((item, index) => (
              <tr key={item.id} style={{ background: index % 2 === 0 ? "#f2f2f2" : "#fff" }}>
                <td style={{ border: "1px solid #ccc", padding: 8 }}>{item.nome || "-"}</td>
                <td style={{ border: "1px solid #ccc", padding: 8, textAlign: "center" }}>
                  {item.tipoDocumento || "-"}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 8, textAlign: "center", whiteSpace: "nowrap" }}>
                  {formatarDocumento(item.documento || item.cnpj || item.cpf || "", item.tipoDocumento || "CNPJ")}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 8, textAlign: "center", whiteSpace: "nowrap" }}>
                  {formatarTelefone(item.telefone || "") || "-"}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 8, textAlign: "center", whiteSpace: "nowrap" }}>
                  {item.dataCadastro || "-"}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 8, textAlign: "center" }}>
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

export default Empresas;


