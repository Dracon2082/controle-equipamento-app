/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState } from "react";
import { db } from "../firebase";
import { deleteDoc, doc, getDoc, collection, addDoc, getDocs, updateDoc } from "firebase/firestore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { registrarHistorico } from "../utils/historico";
import { parseDecimalInput } from "../utils/number";
import { formatoLogoPdf, resolverLogoPdf } from "../utils/pdfLogo";
import { belongsToTenant, getConfigDocId, getTenantId, withTenant } from "../utils/tenant";

const EQUIPAMENTOS_POR_CATEGORIA = {
  "MAQUINAS PESADAS": [
    "RETROESCAVADEIRA",
    "ESCAVADEIRA HIDRAULICA",
    "MINI ESCAVADEIRA",
    "PA CARREGADEIRA",
    "MINI CARREGADEIRA",
    "TRATOR DE ESTEIRA",
    "MOTONIVELADORA",
    "ROLO COMPACTADOR",
    "CAMINHAO BASCULANTE",
    "CAMINHAO PIPA",
    "CAMINHAO MUNCK",
    "CAVALO MECANICO",
    "CARRETA PRANCHA",
    "VIBRO ACABADORA",
    "FRESADORA DE ASFALTO",
    "USINA DE ASFALTO",
    "PERFURATRIZ",
    "BETONEIRA",
    "GUINDASTE",
    "EMPILHADEIRA",
    "GERADOR",
    "COMPRESSOR"
  ],
  "VEICULOS DE APOIO": [
    "CAMINHONETE HILUX",
    "CAMINHONETE S10",
    "CAMINHONETE RANGER",
    "CAMINHONETE FRONTIER",
    "FIAT STRADA",
    "FIAT TORO",
    "VOLKSWAGEN AMAROK",
    "VOLKSWAGEN SAVEIRO",
    "CHEVROLET MONTANA",
    "RENAULT OROCH"
  ]
};

const MARCAS = [
  "CATERPILLAR",
  "KOMATSU",
  "VOLVO CE",
  "XCMG",
  "SANY",
  "HYUNDAI",
  "JCB",
  "CASE",
  "NEW HOLLAND",
  "DOOSAN",
  "LIEBHERR",
  "SDLG",
  "JOHN DEERE",
  "BOBCAT",
  "MANITOU",
  "TOYOTA",
  "CHEVROLET",
  "FIAT",
  "VOLKSWAGEN",
  "FORD",
  "NISSAN",
  "MITSUBISHI",
  "MERCEDES-BENZ",
  "SCANIA",
  "VOLVO",
  "IVECO"
];

const NOME_EQUIPAMENTO_OUTRO = "__OUTRO_EQUIPAMENTO__";

function Equipamentos({ setTela }) {
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

  const [categoria, setCategoria] = useState("");
  const [nome, setNome] = useState("");
  const [nomeManual, setNomeManual] = useState("");
  const [placa, setPlaca] = useState("");
  const [marca, setMarca] = useState("");
  const [codigo, setCodigo] = useState("");
  const [capacidadeTanque, setCapacidadeTanque] = useState("");
  const [lista, setLista] = useState([]);
  const [editandoId, setEditandoId] = useState("");
  const [dataEntrada, setDataEntrada] = useState(hojeBR());
  const [proprietario, setProprietario] = useState("");
  const [empresas, setEmpresas] = useState([]);
  const [empresaSistema, setEmpresaSistema] = useState(null);
  const categorias = Object.keys(EQUIPAMENTOS_POR_CATEGORIA);
  const opcoesNome = categoria
    ? EQUIPAMENTOS_POR_CATEGORIA[categoria] || []
    : categorias.flatMap((item) => EQUIPAMENTOS_POR_CATEGORIA[item]);

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

  const actionBtnBase = {
    border: "none",
    padding: "0 12px",
    borderRadius: 6,
    cursor: "pointer",
    height: 32,
    minWidth: 74,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    fontWeight: "bold",
    lineHeight: 1
  };

  const dangerButton = {
    ...actionBtnBase,
    background: "#cc0000",
    color: "#fff"
  };

  const warningButton = {
    ...actionBtnBase,
    background: "#f0ad4e",
    color: "#10243e"
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    buscar();
    buscarEmpresas();
    buscarEmpresaSistema();
  }, []);

  const normalizar = (valor) => String(valor || "").toUpperCase().trim();

  const limparFormulario = () => {
    setNome("");
    setNomeManual("");
    setCategoria("");
    setPlaca("");
    setMarca("");
    setCodigo("");
    setCapacidadeTanque("");
    setDataEntrada(hojeBR());
    setProprietario("");
    setEditandoId("");
  };

  const editar = (item) => {
    setEditandoId(item.id);
    setCategoria(item.categoria || "");

    const nomeAtual = String(item.nome || "").trim();
    const nomeUpper = normalizar(nomeAtual);
    const existeNaLista = opcoesNome.map(normalizar).includes(nomeUpper);
    if (existeNaLista) {
      setNome(nomeUpper);
      setNomeManual("");
    } else {
      setNome(NOME_EQUIPAMENTO_OUTRO);
      setNomeManual(nomeUpper);
    }

    setMarca(normalizar(item.marca || ""));
    setCodigo(normalizar(item.codigo || ""));
    setPlaca(normalizar(item.placa || ""));
    setCapacidadeTanque(
      item.capacidadeTanque !== undefined && item.capacidadeTanque !== null && item.capacidadeTanque !== ""
        ? String(item.capacidadeTanque).replace(".", ",")
        : ""
    );
    setDataEntrada(item.dataEntrada || hojeBR());
    setProprietario(item.proprietario || "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const salvar = async () => {
    const nomeFinal = nome === NOME_EQUIPAMENTO_OUTRO ? nomeManual : nome;

    if (!categoria) return alert("Selecione a categoria!");
    if (!nomeFinal) return alert("Selecione ou digite o nome do equipamento!");
    if (!marca) return alert("Selecione a marca!");
    if (!dataEntrada || !dataValidaBR(dataEntrada)) {
      return alert("Informe a data no formato dd/mm/aaaa!");
    }

    const nomeFormatado = normalizar(nomeFinal);
    const marcaFormatada = normalizar(marca);
    const codigoFormatado = normalizar(codigo);
    const placaFormatada = normalizar(placa);
    const capacidadeNum = capacidadeTanque ? parseDecimalInput(capacidadeTanque) : 0;

    if (capacidadeNum < 0) {
      alert("Capacidade do tanque invalida!");
      return;
    }

    const existe = lista.find(
      (item) =>
        normalizar(item.nome) === nomeFormatado &&
        normalizar(item.codigo) === codigoFormatado &&
        normalizar(item.placa) === placaFormatada &&
        normalizar(item.proprietario) === normalizar(proprietario)
    );

    if (existe && existe.id !== editandoId) {
      alert("Esse equipamento ja esta cadastrado!");
      return;
    }

    const payload = withTenant({
      categoria,
      nome: nomeFormatado,
      placa: placaFormatada,
      marca: marcaFormatada,
      codigo: codigoFormatado,
      capacidadeTanque: capacidadeNum,
      dataEntrada,
      proprietario
    }, tenantId);

    if (editandoId) {
      await updateDoc(doc(db, "equipamentos", editandoId), payload);
      await registrarHistorico({
        modulo: "EQUIPAMENTOS",
        acao: "EDITOU",
        entidade: "EQUIPAMENTO",
        registroId: editandoId,
        descricao: `Editou equipamento ${nomeFormatado} (${codigoFormatado || "-"})`
      });
      alert("Equipamento atualizado com sucesso!");
    } else {
      const ref = await addDoc(collection(db, "equipamentos"), payload);
      await registrarHistorico({
        modulo: "EQUIPAMENTOS",
        acao: "CRIOU",
        entidade: "EQUIPAMENTO",
        registroId: ref.id,
        descricao: `Cadastrou equipamento ${nomeFormatado} (${codigoFormatado || "-"})`
      });
      alert("Equipamento salvo com sucesso!");
    }

    buscar();
    limparFormulario();
  };

  const buscar = async () => {
    const snap = await getDocs(collection(db, "equipamentos"));
    const dados = snap.docs.map((equipamento) => ({
      id: equipamento.id,
      ...equipamento.data()
    })).filter((item) => belongsToTenant(item, tenantId));

    dados.sort((a, b) => `${a.nome || ""}`.localeCompare(`${b.nome || ""}`));
    setLista(dados);
  };

  const buscarEmpresas = async () => {
    const snap = await getDocs(collection(db, "empresas"));
    const empresasLista = snap.docs
      .map((empresa) => empresa.data())
      .filter((empresa) => belongsToTenant(empresa, tenantId))
      .map((empresa) => empresa.nome)
      .filter(Boolean);
    empresasLista.sort((a, b) => a.localeCompare(b));
    setEmpresas(empresasLista);
  };

  const excluir = async (id) => {
    if (!window.confirm("Deseja excluir este equipamento?")) return;
    const alvo = lista.find((item) => item.id === id);
    await deleteDoc(doc(db, "equipamentos", id));
    await registrarHistorico({
      modulo: "EQUIPAMENTOS",
      acao: "EXCLUIU",
      entidade: "EQUIPAMENTO",
      registroId: id,
      descricao: `Excluiu equipamento ${alvo?.nome || "-"} (${alvo?.codigo || "-"})`
    });
    buscar();
  };

  const buscarEmpresaSistema = async () => {
    const ref = doc(db, "configuracoes", getConfigDocId(tenantId));
    const snap = await getDoc(ref);
    if (snap.exists()) {
      setEmpresaSistema(snap.data());
    }
  };

  const gerarPDF = async () => {
    const pdf = new jsPDF("landscape");
    const base64 = await resolverLogoPdf(empresaSistema);

    if (base64) {
      try {
        pdf.addImage(base64, formatoLogoPdf(base64), 14, 8, 35, 18);
      } catch (error) {
        console.log("Erro na logo", error);
      }
    }

    pdf.setFontSize(16);
    pdf.setFont("helvetica", "bold");
    pdf.text("RELATORIO DE EQUIPAMENTOS", 148, 15, { align: "center" });

    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.text(`Data: ${new Date().toLocaleDateString("pt-BR")}`, 148, 22, { align: "center" });

    const tabela = lista.map((item) => [
      item.categoria || "-",
      item.nome || "-",
      item.marca || "-",
      item.codigo || "-",
      item.placa || "-",
      item.capacidadeTanque ? `${Number(item.capacidadeTanque || 0).toFixed(0)} L` : "-",
      item.dataEntrada || "-",
      item.proprietario || "-"
    ]);

    autoTable(pdf, {
      startY: 30,
      margin: { left: 14, right: 14 },
      head: [["Categoria", "Nome", "Marca", "Código", "Placa", "Tanque (L)", "Data Entrada", "Proprietario"]],
      body: tabela,
      theme: "grid",
      styles: {
        fontSize: 8,
        halign: "center"
      },
      headStyles: {
        fillColor: [0, 102, 204],
        textColor: 255,
        halign: "center"
      },
      alternateRowStyles: {
        fillColor: [240, 240, 240]
      }
    });

    pdf.save("relatorio_equipamentos.pdf");
    registrarHistorico({
      modulo: "EQUIPAMENTOS",
      acao: "GEROU_PDF",
      entidade: "RELATORIO_EQUIPAMENTOS",
      registroId: "pdf-equipamentos",
      descricao: "Gerou PDF de equipamentos."
    });
  };

  return (
    <div style={{
      maxWidth: 1280,
      margin: "0 auto",
      padding: 20,
      background: "#f5f7fa",
      minHeight: "100vh"
    }}>
      <h2 style={{ textAlign: "center", marginBottom: 20 }}>
        Cadastro de Equipamentos
      </h2>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Dados do Equipamento</h3>

        <select
          style={inputStyle}
          value={categoria}
          onChange={(e) => {
            setCategoria(e.target.value);
            setNome("");
            setNomeManual("");
          }}
        >
          <option value="">Selecione a categoria</option>
          {categorias.map((itemCategoria) => (
            <option key={itemCategoria} value={itemCategoria}>{itemCategoria}</option>
          ))}
        </select>

        <select style={inputStyle} value={nome} onChange={(e) => setNome(e.target.value)}>
          <option value="">
            {categoria ? "Selecione o nome do equipamento" : "Selecione a categoria primeiro"}
          </option>
          {opcoesNome.map((tipo) => (
            <option key={tipo} value={tipo}>{tipo}</option>
          ))}
          <option value={NOME_EQUIPAMENTO_OUTRO}>Outro (digitar manualmente)</option>
        </select>

        {nome === NOME_EQUIPAMENTO_OUTRO && (
          <input
            style={inputStyle}
            placeholder="Digite o nome do equipamento"
            value={nomeManual}
            onChange={(e) => setNomeManual(e.target.value)}
          />
        )}

        <select style={inputStyle} value={marca} onChange={(e) => setMarca(e.target.value)}>
          <option value="">Selecione a marca</option>
          {MARCAS.map((itemMarca) => (
            <option key={itemMarca} value={itemMarca}>{itemMarca}</option>
          ))}
        </select>

        <input
          style={inputStyle}
          placeholder="Código (opcional)"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
        />

        <input
          style={inputStyle}
          placeholder="Placa (opcional)"
          value={placa}
          onChange={(e) => setPlaca(e.target.value)}
        />

        <input
          style={inputStyle}
          placeholder="Capacidade do tanque (L) (opcional)"
          inputMode="decimal"
          value={capacidadeTanque}
          onChange={(e) => setCapacidadeTanque(e.target.value)}
        />

        <input
          style={inputStyle}
          type="text"
          inputMode="numeric"
          maxLength={10}
          placeholder="Data de entrada (dd/mm/aaaa)"
          value={dataEntrada}
          onChange={(e) => setDataEntrada(formatarDataBR(e.target.value))}
        />

        <select style={inputStyle} value={proprietario} onChange={(e) => setProprietario(e.target.value)}>
          <option value="">Selecione o proprietario</option>
          {empresas.map((empresa) => (
            <option key={empresa} value={empresa}>{empresa}</option>
          ))}
        </select>

        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button style={primaryButton} onClick={salvar}>{editandoId ? "ATUALIZAR" : "SALVAR"}</button>
          {editandoId && (
            <button style={{ ...primaryButton, background: "#6c757d" }} onClick={limparFormulario}>
              CANCELAR EDICAO
            </button>
          )}
          <button style={{ ...primaryButton, background: "#28a745" }} onClick={gerarPDF}>GERAR PDF</button>
          </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Equipamentos Cadastrados</h3>

        <div>
          <table style={{
            width: "100%",
            borderCollapse: "collapse",
            background: "#fff",
            borderRadius: 8,
            overflow: "hidden"
          }}>
            <thead style={{ background: "#0b3d91", color: "#fff" }}>
              <tr>
                <th style={{ border: "1px solid #ccc", padding: 8, textAlign: "center" }}>Categoria</th>
                <th style={{ border: "1px solid #ccc", padding: 8, textAlign: "center" }}>Nome</th>
                <th style={{ border: "1px solid #ccc", padding: 8, textAlign: "center" }}>Marca</th>
                <th style={{ border: "1px solid #ccc", padding: 8, textAlign: "center", whiteSpace: "nowrap" }}>Código</th>
                <th style={{ border: "1px solid #ccc", padding: 8, textAlign: "center", whiteSpace: "nowrap" }}>Placa</th>
                <th style={{ border: "1px solid #ccc", padding: 8, textAlign: "center", whiteSpace: "nowrap" }}>Tanque (L)</th>
                <th style={{ border: "1px solid #ccc", padding: 8, textAlign: "center", whiteSpace: "nowrap" }}>Data Entrada</th>
                <th style={{ border: "1px solid #ccc", padding: 8, textAlign: "center" }}>Proprietario</th>
                <th style={{ border: "1px solid #ccc", padding: 8, textAlign: "center", whiteSpace: "nowrap" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.length === 0 && (
                <tr>
                  <td colSpan="9" style={{ textAlign: "center", padding: 12 }}>
                    Nenhum equipamento cadastrado.
                  </td>
                </tr>
              )}
              {lista.map((item, index) => (
                <tr key={item.id} style={{ background: index % 2 === 0 ? "#f2f2f2" : "#fff" }}>
                  <td style={{ border: "1px solid #ccc", padding: 8 }}>{item.categoria || "-"}</td>
                  <td style={{ border: "1px solid #ccc", padding: 8 }}>{item.nome}</td>
                  <td style={{ border: "1px solid #ccc", padding: 8 }}>{item.marca}</td>
                  <td style={{ border: "1px solid #ccc", padding: 8, textAlign: "center", whiteSpace: "nowrap" }}>{item.codigo || "-"}</td>
                  <td style={{ border: "1px solid #ccc", padding: 8, textAlign: "center", whiteSpace: "nowrap" }}>{item.placa || "-"}</td>
                  <td style={{ border: "1px solid #ccc", padding: 8, textAlign: "center" }}>
                    {item.capacidadeTanque ? Number(item.capacidadeTanque || 0).toFixed(0) : "-"}
                  </td>
                  <td style={{ border: "1px solid #ccc", padding: 8, textAlign: "center" }}>{item.dataEntrada || "-"}</td>
                  <td style={{ border: "1px solid #ccc", padding: 8, whiteSpace: "normal", overflowWrap: "anywhere" }}>{item.proprietario || "-"}</td>
                  <td style={{ border: "1px solid #ccc", padding: 8, textAlign: "center", whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center" }}>
                      <button style={warningButton} onClick={() => editar(item)}>Editar</button>
                      <button style={dangerButton} onClick={() => excluir(item.id)}>Excluir</button>
                    </div>
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

export default Equipamentos;


