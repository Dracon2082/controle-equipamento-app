/* eslint-disable react-hooks/exhaustive-deps */
import { collection, addDoc, getDocs, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { useState, useEffect } from "react";
import { db } from "../firebase";
import { registrarHistorico } from "../utils/historico";
import { parseDecimalInput } from "../utils/number";
import { belongsToTenant, getTenantId, withTenant } from "../utils/tenant";

function Lubrificantes({ setTela, embed = false }) {
  const tenantId = getTenantId();
  const sessaoOperacional = (() => {
    try {
      return JSON.parse(localStorage.getItem("sessaoOperacional") || "{}");
    } catch {
      return {};
    }
  })();
  const perfilSessao = String(sessaoOperacional?.perfilAcesso || "").trim().toUpperCase();
  const usuarioChaveSessao = Boolean(sessaoOperacional?.usuarioChave);
  const acessoTotalBases = perfilSessao === "GESTOR_GERAL" || usuarioChaveSessao;
  const basesPermitidas = Array.isArray(sessaoOperacional?.basesPermitidas)
    ? sessaoOperacional.basesPermitidas.map((b) => String(b || "").trim().toUpperCase()).filter(Boolean)
    : [];
  const chaveBase = (cidadeValor, estadoValor) =>
    `${String(cidadeValor || "").trim().toUpperCase()}__${String(estadoValor || "").trim().toUpperCase()}`;
  const normalizarCidade = (valor) =>
    String(valor || "").replace(/\s+/g, " ").trim().toUpperCase();

  const [obras, setObras] = useState([]);
  const [obraBaseId, setObraBaseId] = useState("");
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("");
  const [marca, setMarca] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [preco, setPreco] = useState("");
  const [editId, setEditId] = useState("");
  const [lista, setLista] = useState([]);
  const [data, setData] = useState(
    new Date().toISOString().split("T")[0]
    );
  const [nota, setNota] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [categoria, setCategoria] = useState("");
  const [unidade, setUnidade] = useState("");
  const [secaoAtiva, setSecaoAtiva] = useState("NOVA");
  const baseSelecionada = obras.find((item) => item.id === obraBaseId) || null;
  const baseUnicaTravada = obras.length === 1;
  const totalEntradaPreview = (() => {
    const qtdNum = parseDecimalInput(quantidade);
    const precoNum = parseDecimalInput(preco);
    if (!qtdNum || !precoNum) return 0;
    return qtdNum * precoNum;
  })();

  // Registro de entrada (nao baixa no abastecimento): mantemos acumulado.
  // O estoque que baixa continua sendo `quantidade`.
  const quantidadeEntradaDoItem = (item) => {
    const v = item?.quantidadeEntrada;
    if (v === 0) return 0;
    if (v !== undefined && v !== null && v !== "") return Number(v) || 0;
    return Number(item?.quantidade || 0) || 0;
  };
  const totalEntradaDoItem = (item) => {
    const v = item?.totalEntrada;
    if (v === 0) return 0;
    if (v !== undefined && v !== null && v !== "") return Number(v) || 0;
    const qtd = quantidadeEntradaDoItem(item);
    const precoNum = Number(item?.preco || 0) || 0;
    return qtd * precoNum;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    buscar();
  }, []);

  useEffect(() => {
    buscarObras();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    buscar();
  }, [obraBaseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const buscarObras = async () => {
    if (!acessoTotalBases && basesPermitidas.length) {
      const cidadesPermitidas = Array.from(
        new Set(
          basesPermitidas
            .map((base) => String(base || "").split("__")[0])
            .map((cidade) => normalizarCidade(cidade))
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b));
      const listaBasesPermitidas = cidadesPermitidas.map((cidade) => ({
        id: cidade,
        cidade,
        estado: ""
      }));
      setObras(listaBasesPermitidas);
      if (!obraBaseId && listaBasesPermitidas.length > 0) {
        setObraBaseId(listaBasesPermitidas[0].id);
      }
      return;
    }
    if (!acessoTotalBases && !basesPermitidas.length) {
      setObras([]);
      setObraBaseId("");
      return;
    }

    const snapObras = await getDocs(collection(db, "obras"));
    const listaObras = snapObras.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId))
      .filter((item) => normalizarCidade(item.cidade));
    const mapaBases = new Map();
    listaObras.forEach((item) => {
      const cidade = normalizarCidade(item.cidade);
      const estado = String(item.estado || "").trim().toUpperCase();
      if (!cidade || mapaBases.has(cidade)) return;
      mapaBases.set(cidade, {
        id: cidade,
        cidade,
        estado
      });
    });
    const listaBases = Array.from(mapaBases.values()).sort((a, b) => a.cidade.localeCompare(b.cidade));
    setObras(listaBases);

    if (!obraBaseId && listaBases.length > 0) {
      setObraBaseId(listaBases[0].id);
    }
  };

  const buscar = async () => {
    const obraAtual = obras.find((item) => item.id === obraBaseId);
    const cidadeBase = String(obraAtual?.cidade || "").trim().toUpperCase();
    if (!cidadeBase) {
      setLista([]);
      return;
    }

    const snap = await getDocs(collection(db, "lubrificantes"));

    const itens = snap.docs
      .map((d) => ({
        id: d.id,
        ...d.data(),
      }))
      .filter((item) => belongsToTenant(item, tenantId))
      .filter((item) => String(item.cidade || "").trim().toUpperCase() === cidadeBase);

    // Backfill: se ainda nao existir registro de entrada, inicializa com o estoque atual.
    // Isso evita que o "registro" va baixando junto com o abastecimento em itens antigos.
    const faltantes = itens.filter(
      (item) => item.quantidadeEntrada === undefined || item.quantidadeEntrada === null
    );
    const itensComEntrada = itens.map((item) => {
      if (item.quantidadeEntrada === undefined || item.quantidadeEntrada === null) {
        const qtd = Number(item.quantidade || 0) || 0;
        const precoNum = Number(item.preco || 0) || 0;
        const total = Number(item.total || 0) || (qtd * precoNum);
        return { ...item, quantidadeEntrada: qtd, totalEntrada: total };
      }
      return item;
    });

    setLista(itensComEntrada);

    if (faltantes.length) {
      try {
        await Promise.all(
          faltantes.map((item) => {
            const qtd = Number(item.quantidade || 0) || 0;
            const precoNum = Number(item.preco || 0) || 0;
            const total = Number(item.total || 0) || (qtd * precoNum);
            return updateDoc(doc(db, "lubrificantes", item.id), {
              quantidadeEntrada: qtd,
              totalEntrada: total
            });
          })
        );
      } catch {
        // Se falhar, nao bloqueia a tela. A proxima carga tenta novamente.
      }
    }
  };

  const salvar = async () => {
    const cidadeBase = String(baseSelecionada?.cidade || "").trim().toUpperCase();
    const estadoBase = String(baseSelecionada?.estado || "").trim().toUpperCase();
    if (!obraBaseId || !cidadeBase) {
      alert("Selecione a cidade base.");
      return;
    }

    if (!nome || !tipo) {
      alert("Preencha todos os campos!");
      return;
    }

    // Modo edicao: ajusta o item do estoque sem somar novamente.
    if (editId) {
      const alvoEdicao = lista.find((i) => i.id === editId);
      if (!alvoEdicao) {
        setEditId("");
        alert("Registro nao encontrado para edicao.");
        return;
      }

      const quantidadeFinal = parseDecimalInput(quantidade);
      const precoInformado = parseDecimalInput(preco);
      const precoFinal = precoInformado > 0 ? precoInformado : parseDecimalInput(alvoEdicao.preco || 0);
      const quantidadeEntradaMantida = parseDecimalInput(
        alvoEdicao.quantidadeEntrada ?? alvoEdicao.quantidade ?? 0
      );
      const totalEntradaMantido = alvoEdicao.totalEntrada ?? (quantidadeEntradaMantida * precoFinal);

      await updateDoc(doc(db, "lubrificantes", editId), {
        nome: nome.toUpperCase().trim(),
        tipo,
        marca: marca.toUpperCase().trim(),
        quantidade: quantidadeFinal,
        preco: precoFinal,
        total: quantidadeFinal * precoFinal,
        // Mantem o registro de entrada (nao baixa no abastecimento)
        quantidadeEntrada: quantidadeEntradaMantida,
        totalEntrada: totalEntradaMantido,
        unidade,
        data,
        nota,
        fornecedor: fornecedor.toUpperCase(),
        categoria,
        cidade: cidadeBase,
        estado: estadoBase,
        baseChave: chaveBase(cidadeBase, estadoBase)
      });

      await registrarHistorico({
        modulo: "LUBRIFICANTES",
        acao: "EDITOU",
        entidade: "ESTOQUE",
        registroId: editId,
        descricao: `Editou item ${nome.toUpperCase().trim()} em ${cidadeBase}/${estadoBase}.`
      });

      setEditId("");
      setNome("");
      setTipo("");
      setMarca("");
      setQuantidade("");
      setNota("");
      setFornecedor("");
      setCategoria("");
      setUnidade("");
      setPreco("");

      buscar();
      return;
    }

    const jaExiste = lista.find(
      (item) =>
        item.nome === nome.toUpperCase().trim() &&
        String(item.cidade || "").toUpperCase() === cidadeBase
    );

    if (jaExiste) {
      // SOMA NO ESTOQUE
      const quantidadeEntrada = parseDecimalInput(quantidade || 0);
      const novaQuantidade =
        parseDecimalInput(jaExiste.quantidade || 0) + quantidadeEntrada;
      const precoInformado = parseDecimalInput(preco);
      const precoFinal = precoInformado > 0 ? precoInformado : parseDecimalInput(jaExiste.preco || 0);
      const quantidadeEntradaAtual = parseDecimalInput(
        jaExiste.quantidadeEntrada ?? jaExiste.quantidade ?? 0
      );
      const novaQuantidadeEntrada = quantidadeEntradaAtual + quantidadeEntrada;

      await updateDoc(doc(db, "lubrificantes", jaExiste.id), {
        quantidade: novaQuantidade,
        // Registro de entrada acumulado (nao baixa no abastecimento)
        quantidadeEntrada: novaQuantidadeEntrada,
        preco: precoFinal,
        total: novaQuantidade * precoFinal,
        totalEntrada: novaQuantidadeEntrada * precoFinal,
        unidade: unidade || jaExiste.unidade,
        cidade: cidadeBase,
        estado: estadoBase,
        baseChave: chaveBase(cidadeBase, estadoBase)
      });
      await registrarHistorico({
        modulo: "LUBRIFICANTES",
        acao: "EDITOU",
        entidade: "ESTOQUE",
        registroId: jaExiste.id,
        descricao: `Atualizou estoque de ${nome.toUpperCase().trim()} em ${cidadeBase}/${estadoBase}.`
      });

    } else {
      // CADASTRA NOVO
      const quantidadeNum = parseDecimalInput(quantidade);
      const precoNum = parseDecimalInput(preco);
      const ref = await addDoc(collection(db, "lubrificantes"), withTenant({
        nome: nome.toUpperCase().trim(),
        tipo,
        marca: marca.toUpperCase().trim(),
        quantidade: quantidadeNum,
        // Registro de entrada (nao baixa no abastecimento)
        quantidadeEntrada: quantidadeNum,
        preco: precoNum,
        total: quantidadeNum * precoNum,
        totalEntrada: quantidadeNum * precoNum,
        unidade,
        data,
        nota,
        fornecedor: fornecedor.toUpperCase(),
        categoria,
        estado: estadoBase,
        cidade: cidadeBase,
        baseChave: chaveBase(cidadeBase, estadoBase)
      }, tenantId));
      await registrarHistorico({
        modulo: "LUBRIFICANTES",
        acao: "CRIOU",
        entidade: "ESTOQUE",
        registroId: ref.id,
        descricao: `Cadastrou item ${nome.toUpperCase().trim()} em ${cidadeBase}/${estadoBase}.`
      });
    }

    setNome("");
    setTipo("");
    setMarca("");
    setQuantidade("");
    setNota("");
    setFornecedor("");
    setCategoria("");
    setUnidade("");
    setPreco("");
    setEditId("");

    buscar();
  };

  const excluir = async (id) => {
    if (!window.confirm("Deseja excluir?")) return;
    const alvo = lista.find((item) => item.id === id);

    await deleteDoc(doc(db, "lubrificantes", id));
    await registrarHistorico({
      modulo: "LUBRIFICANTES",
      acao: "EXCLUIU",
      entidade: "ESTOQUE",
      registroId: id,
      descricao: `Excluiu item ${alvo?.nome || "-"} em ${alvo?.cidade || "-"}.`
    });
    buscar();
  };

  const importarPadrao = async () => {
    const cidadeBase = String(baseSelecionada?.cidade || "").trim().toUpperCase();
    const estadoBase = String(baseSelecionada?.estado || "").trim().toUpperCase();
    if (!obraBaseId || !cidadeBase) {
      alert("Selecione a cidade base antes de importar a lista padrao!");
      return;
    }

    const listaPadrao = [
      { nome: "DIESEL S-10", tipo: "OLEO", categoria: "COMBUSTIVEL", unidade: "L" },
      { nome: "DIESEL S-500", tipo: "OLEO", categoria: "COMBUSTIVEL", unidade: "L" },
      { nome: "OLEO MOTOR 15W40", tipo: "OLEO", categoria: "MOTOR" },
      { nome: "OLEO MOTOR 10W30", tipo: "OLEO", categoria: "MOTOR" },
      { nome: "OLEO HIDRAULICO ISO 32", tipo: "OLEO", categoria: "HIDRAULICO" },
      { nome: "OLEO HIDRAULICO ISO 46", tipo: "OLEO", categoria: "HIDRAULICO" },
      { nome: "OLEO HIDRAULICO ISO 68", tipo: "OLEO", categoria: "HIDRAULICO" },
      { nome: "OLEO TRANSMISSAO TO-4 SAE 30", tipo: "OLEO", categoria: "TRANSMISSAO" },
      { nome: "OLEO TRANSMISSAO TO-4 SAE 50", tipo: "OLEO", categoria: "TRANSMISSAO" },
      { nome: "OLEO DIFERENCIAL 80W90", tipo: "OLEO", categoria: "DIFERENCIAL" },
      { nome: "OLEO DIFERENCIAL 85W140", tipo: "OLEO", categoria: "DIFERENCIAL" },
      { nome: "OLEO REDUTOR ISO 220", tipo: "OLEO", categoria: "INDUSTRIAL" },
      { nome: "OLEO REDUTOR ISO 320", tipo: "OLEO", categoria: "INDUSTRIAL" },
      { nome: "OLEO COMPRESSOR 68", tipo: "OLEO", categoria: "INDUSTRIAL" },
      { nome: "OLEO COMPRESSOR 100", tipo: "OLEO", categoria: "INDUSTRIAL" },
      { nome: "OLEO TERMICO", tipo: "OLEO", categoria: "INDUSTRIAL" },
      { nome: "GRAXA EP2", tipo: "GRAXA", categoria: "GRAXA" },
      { nome: "GRAXA LITHIUM NLGI 2", tipo: "GRAXA", categoria: "GRAXA" },
      { nome: "GRAXA LITHIUM NLGI 3", tipo: "GRAXA", categoria: "GRAXA" },
      { nome: "GRAXA MOLIBDENIO", tipo: "GRAXA", categoria: "GRAXA" },
      { nome: "GRAXA GRAFITADA", tipo: "GRAXA", categoria: "GRAXA" },
      { nome: "GRAXA ALTA TEMPERATURA", tipo: "GRAXA", categoria: "GRAXA" }
    ];

    for (let item of listaPadrao) {
      const existe = lista.find(
        (l) =>
          l.nome === item.nome &&
          String(l.cidade || "").toUpperCase() === cidadeBase
      );

      if (!existe) {
        await addDoc(collection(db, "lubrificantes"), withTenant({
          ...item,
          marca: "",
          quantidade: 0,
          unidade: item.unidade || (item.tipo === "OLEO" ? "L" : "KG"),
          data: new Date().toISOString().split("T")[0],
          nota: "",
          fornecedor: "",
          estado: estadoBase,
          cidade: cidadeBase,
          baseChave: chaveBase(cidadeBase, estadoBase)
        }, tenantId));
      }
    }

    alert("Lista padrao importada com sucesso!");
    await registrarHistorico({
      modulo: "LUBRIFICANTES",
      acao: "IMPORTOU_PADRAO",
      entidade: "ESTOQUE",
      registroId: `${cidadeBase}-${estadoBase}`,
      descricao: `Importou lista padrao para ${cidadeBase}/${estadoBase}.`
    });
    buscar();
  };

  const agrupar = (arr) => {
    const mapa = {};

    arr.forEach((item) => {
      const nome = item.nome;

      if (!mapa[nome]) {
        mapa[nome] = {
          ...item,
          quantidade: parseDecimalInput(item.quantidade || 0)
        };
      } else {
        mapa[nome].quantidade += parseDecimalInput(item.quantidade || 0);
      }
    });

    return Object.values(mapa);
  };

  const normalizarTexto = (valor) =>
    String(valor || "")
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Z0-9]/g, "");

  const ehOleo = (item) => normalizarTexto(item.tipo).includes("LEO");
  const ehCombustivel = (item) =>
    normalizarTexto(item.categoria).includes("COMBUST") ||
    normalizarTexto(item.nome).includes("DIESELS10") ||
    normalizarTexto(item.nome).includes("DIESELS500");

  const oleos = agrupar(
    lista.filter(
      (item) => ehOleo(item) && !ehCombustivel(item)
    )
  );
  const graxas = agrupar(lista.filter((item) => normalizarTexto(item.tipo).includes("GRAXA")));

  const diesel = agrupar(
    lista.filter((item) => ehCombustivel(item))
  );

  // divide em linhas (4 por linha)
  const dividir = (arr, tamanho) => {
    const linhas = [];
    for (let i = 0; i < arr.length; i += tamanho) {
      linhas.push(arr.slice(i, i + tamanho));
    }
    return linhas;
  };

  const oleosLinhas = dividir(oleos, 4);
  const graxasLinhas = dividir(graxas, 4);

  const listaPadrao = [
    "DIESEL S-10",
    "DIESEL S-500",
    "OLEO MOTOR 15W40",
    "OLEO MOTOR 10W30",
    "OLEO HIDRAULICO ISO 32",
    "OLEO HIDRAULICO ISO 46",
    "OLEO HIDRAULICO ISO 68",
    "OLEO TRANSMISSAO TO-4 SAE 30",
    "OLEO TRANSMISSAO TO-4 SAE 50",
    "OLEO DIFERENCIAL 80W90",
    "OLEO DIFERENCIAL 85W140",
    "OLEO REDUTOR ISO 220",
    "OLEO REDUTOR ISO 320",
    "OLEO COMPRESSOR 68",
    "OLEO COMPRESSOR 100",
    "OLEO TERMICO",
    "GRAXA EP2",
    "GRAXA LITHIUM NLGI 2",
    "GRAXA LITHIUM NLGI 3",
    "GRAXA MOLIBDENIO",
    "GRAXA GRAFITADA",
    "GRAXA ALTA TEMPERATURA"
  ];

  const pageStyle = embed
    ? { maxWidth: 1240, margin: "0 auto", padding: 0, background: "transparent", minHeight: "unset" }
    : { maxWidth: 900, margin: "0 auto", padding: 20, background: "#f5f7fa", minHeight: "100vh" };

  return (
    <div style={pageStyle}>
      {!embed && <h2>Entrada Diesel / Lubrificantes</h2>}

      <div style={{
        background: "#fff",
        padding: 20,
        borderRadius: 10,
        marginBottom: 20,
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
      }}>

      {baseUnicaTravada && baseSelecionada ? (
        <div
          style={{
            marginBottom: 10,
            fontWeight: "bold",
            color: "#0b3d91"
          }}
        >
          Base da unidade: {String(baseSelecionada.cidade || "").toUpperCase()}
        </div>
      ) : (
        <select
          style={{
            width: "100%",
            padding: "0 10px",
            height: "42px",
            borderRadius: "6px",
            border: "1px solid #ccc",
            marginBottom: 10
          }}
          value={obraBaseId}
          onChange={(e) => setObraBaseId(e.target.value)}
        >
          <option value="">Selecione a Cidade Base</option>
          {obras.map((o) => (
            <option key={o.id} value={o.id}>
              {String(o.cidade || "").toUpperCase()}
            </option>
          ))}
        </select>
      )}

      {baseSelecionada && (
        <div style={{ marginBottom: 10, fontWeight: "bold", color: "#0b3d91" }}>
          Base ativa: {String(baseSelecionada.cidade || "").toUpperCase()}
        </div>
      )}

      {secaoAtiva === "NOVA" && (
      <>
      <div style={{ marginBottom: 12, color: "#5b6f8a", fontSize: 13 }}>
        Preencha e salve a entrada. O estoque e o histórico ficam em visões separadas para deixar a tela mais leve.
      </div>
      <select
        style={{
          width: "100%",
          padding: "0 10px",
          height: "42px",
          borderRadius: "6px",
          border: "1px solid #ccc",
          marginBottom: 10,
          boxSizing: "border-box"
        }}
        value={nome}
        onChange={(e) => {
          const produto = e.target.value;
          setNome(produto);

          if (produto === "DIESEL S-10" || produto === "DIESEL S-500") {
            setTipo("Diesel");
            setCategoria("Combustivel");
            setUnidade("L");
          }
        }}
      >
        <option value="">Selecione ou digite abaixo</option>

        {listaPadrao.map((item, i) => (
        <option key={i} value={item}>
          {item}
        </option>
      ))}
      </select>

      <input
        style={{
          width: "100%",
          padding: "0 10px",
          height: "42px",
          borderRadius: "6px",
          border: "1px solid #ccc",
          marginBottom: 10,
          boxSizing: "border-box"
        }}
        placeholder="Ou digite novo produto"
        value={nome}
        onChange={(e) => setNome(e.target.value)}
      />

      <select
        style={{
          width: "100%",
          padding: "10px",
          borderRadius: "6px",
          border: "1px solid #ccc",
          marginBottom: 10
        }}
        value={tipo}
        onChange={(e) => setTipo(e.target.value)}
      >
        <option value="">Selecione o tipo</option>
        <option>Oleo</option>
        <option>Graxa</option>
      </select>

        <input
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: "6px",
            border: "1px solid #ccc",
            marginBottom: 10,
            boxSizing: "border-box"
          }}
          placeholder="Marca (ex: Mobil, Caterpillar)"
          value={marca}
          onChange={(e) => setMarca(e.target.value)}
        />

        <select
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: "6px",
            border: "1px solid #ccc",
            marginBottom: 10
          }}
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
        >
          <option value="">Selecione a categoria</option>
          <option>Motor</option>
          <option>Hidraulico</option>
          <option>Transmissao</option>
          <option>Diferencial</option>
          <option>Graxa</option>
          <option>Industrial</option>
          <option>Combustivel</option>
        </select>

        
        <input
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: "6px",
            border: "1px solid #ccc",
            marginBottom: 10,
            boxSizing: "border-box"
          }}
          placeholder="Quantidade"
          value={quantidade}
          onChange={(e) => setQuantidade(e.target.value)}
        />

        <input
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: "6px",
            border: "1px solid #ccc",
            marginBottom: 10,
            boxSizing: "border-box"
          }}
          placeholder="Preco Unitario (R$)"
          value={preco}
          onChange={(e) => setPreco(e.target.value)}
        />

        <div style={{
          background: "#f1f6ff",
          border: "1px solid #d7e4ff",
          borderRadius: 8,
          padding: "10px 12px",
          marginBottom: 10,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <div style={{ fontWeight: "bold", color: "#10243e" }}>Total da entrada</div>
          <div style={{ fontWeight: "bold", color: "#0b3d91", whiteSpace: "nowrap" }}>
            {`R$ ${Number(totalEntradaPreview || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </div>
        </div>

        <select
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: "6px",
            border: "1px solid #ccc",
            marginBottom: 10
          }}
          value={unidade}
          onChange={(e) => setUnidade(e.target.value)}
        >
          <option value="">Unidade</option>
          <option value="L">Litros (L)</option>
          <option value="KG">Quilos (KG)</option>
        </select>

        <input
          type="date"
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: "6px",
            border: "1px solid #ccc",
            marginBottom: 10,
            boxSizing: "border-box"
          }}
          value={data}
          onChange={(e) => setData(e.target.value)}
        />

        <input
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: "6px",
            border: "1px solid #ccc",
            marginBottom: 10,
            boxSizing: "border-box"
          }}
          placeholder="Número da Nota Fiscal"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
        />

        <input
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: "6px",
            border: "1px solid #ccc",
            marginBottom: 10,
            boxSizing: "border-box"
          }}
          placeholder="Fornecedor (empresa)"
          value={fornecedor}
          onChange={(e) => setFornecedor(e.target.value)}
        />


      <button style={{
        background: "#0066cc",
        color: "#fff",
        padding: "10px 20px",
        border: "none",
        borderRadius: 8,
        fontWeight: "bold",
        cursor: "pointer",
        marginRight: 10
      }} onClick={salvar}>
        {editId ? "ATUALIZAR" : "SALVAR"}
      </button>

      <button style={{
        background: "#28a745",
        color: "#fff",
        padding: "10px 20px",
        border: "none",
        borderRadius: 8,
        fontWeight: "bold",
        cursor: "pointer"
      }} onClick={importarPadrao}>
        IMPORTAR PADRAO
      </button>
      </>
      )}

      </div>

      <div style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        alignItems: "center",
        background: "#fff",
        border: "1px solid #e3e7ef",
        borderRadius: 8,
        padding: 14,
        marginBottom: 16,
        boxShadow: "0 2px 8px rgba(15, 23, 42, 0.05)"
      }}>
        <button
          style={{
            background: secaoAtiva === "NOVA" ? "#0b5ed7" : "#eaf2ff",
            color: secaoAtiva === "NOVA" ? "#fff" : "#17407f",
            border: secaoAtiva === "NOVA" ? "none" : "1px solid #cfe0ff",
            borderRadius: 8,
            padding: "10px 14px",
            fontWeight: "bold",
            cursor: "pointer"
          }}
          onClick={() => setSecaoAtiva("NOVA")}
        >
          Nova entrada
        </button>
        <button
          style={{
            background: secaoAtiva === "ESTOQUE" ? "#0b5ed7" : "#eaf2ff",
            color: secaoAtiva === "ESTOQUE" ? "#fff" : "#17407f",
            border: secaoAtiva === "ESTOQUE" ? "none" : "1px solid #cfe0ff",
            borderRadius: 8,
            padding: "10px 14px",
            fontWeight: "bold",
            cursor: "pointer"
          }}
          onClick={() => setSecaoAtiva("ESTOQUE")}
        >
          Estoque atual
        </button>
        <button
          style={{
            background: secaoAtiva === "HISTORICO" ? "#0b5ed7" : "#eaf2ff",
            color: secaoAtiva === "HISTORICO" ? "#fff" : "#17407f",
            border: secaoAtiva === "HISTORICO" ? "none" : "1px solid #cfe0ff",
            borderRadius: 8,
            padding: "10px 14px",
            fontWeight: "bold",
            cursor: "pointer"
          }}
          onClick={() => setSecaoAtiva("HISTORICO")}
        >
          Historico de entradas
        </button>
        <div style={{ color: "#5b6f8a", fontSize: 13 }}>
          Cada visao mostra uma etapa separada para deixar a tela mais leve.
        </div>
      </div>

      {secaoAtiva === "ESTOQUE" && (
      <>
      <h3>ESTOQUE DE DIESEL</h3>

      <table style={{
        width: "100%",
        borderCollapse: "collapse",
        marginBottom: 20
      }}>
        <tr>
          {diesel.map((item) => (
            <td style={{
              border: "1px solid #ccc",
              padding: 10,
              textAlign: "center",
              fontWeight: "bold"
            }}>
              {item.nome}
            </td>
          ))}
        </tr>

        <tr>
          {diesel.map((item) => (
            <td style={{
              border: "1px solid #ccc",
              padding: 10,
              textAlign: "center",
              fontWeight: "bold"
            }}>
              {item.quantidade} {item.unidade}
            </td>
          ))}
        </tr>
      </table>

      <h3 style={{ marginTop: 20 }}>ESTOQUE DE LUBRIFICANTES</h3>

      <table style={{
        width: "100%",
        borderCollapse: "collapse",
        marginBottom: 20
      }}>
        {oleosLinhas.map((linha, i) => (
          <>
            <tr key={"nome-" + i}>
              {linha.map((item) => (
                <td style={{
                  border: "1px solid #ccc",
                  padding: 10,
                  fontWeight: "bold",
                  textAlign: "center"
                }}>
                  {item.nome}
                </td>
              ))}
            </tr>

            <tr key={"qtd-" + i}>
              {linha.map((item) => (
                <td style={{
                  border: "1px solid #ccc",
                  padding: 10,
                  textAlign: "center",
                  color: item.quantidade < 10 ? "red" : "black",
                  fontWeight: "bold"
                }}>
                  {item.quantidade ? `${item.quantidade} ${item.unidade || ""}` : ""}
                </td>
              ))}
            </tr>
          </>
        ))}
      </table>

      <h3>ESTOQUE GRAXAS</h3>

      <table style={{
        width: "100%",
        borderCollapse: "collapse"
      }}>
        {graxasLinhas.map((linha, i) => (
          <>
            <tr key={"nome-g-" + i}>
              {linha.map((item) => (
                <td style={{
                  border: "1px solid #ccc",
                  padding: 10,
                  fontWeight: "bold",
                  textAlign: "center"
                }}>
                  {item.nome}
                </td>
              ))}
            </tr>

            <tr key={"qtd-g-" + i}>
              {linha.map((item) => (
                <td style={{
                  border: "1px solid #ccc",
                  padding: 10,
                  textAlign: "center",
                  color: item.quantidade < 10 ? "red" : "black",
                  fontWeight: "bold"
                }}>
                  {item.quantidade ? `${item.quantidade} ${item.unidade || ""}` : ""}
                </td>
              ))}
            </tr>
          </>
        ))}
      </table>
      </>
      )}

      {secaoAtiva === "HISTORICO" && (
      <>
      <h3 style={{ marginBottom: 10 }}>
        REGISTRO DE ENTRADA
      </h3>

      <table style={{
        width: "100%",
        borderCollapse: "collapse",
        background: "#fff",
        borderRadius: 10,
        overflow: "hidden",
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
      }}>
        <thead style={{
          background: "#0b3d91",
          color: "#fff"
        }}>
            <tr>
            <th style={{ border: "1px solid #ccc", padding: 8 }}>
              Produto
            </th>
            <th style={{ border: "1px solid #ccc", padding: 8 }}>
              Tipo
            </th>
            <th style={{ border: "1px solid #ccc", padding: 8 }}>
              Marca
            </th>
            <th style={{ border: "1px solid #ccc", padding: 8 }}>
              Quantidade
            </th>
            <th style={{ border: "1px solid #ccc", padding: 8 }}>
              Preco Unitario
            </th>

            <th style={{ border: "1px solid #ccc", padding: 8 }}>
              Total
            </th>
            <th style={{ border: "1px solid #ccc", padding: 8 }}>
              Data
            </th>
            <th style={{ border: "1px solid #ccc", padding: 8 }}>
              Nota Fiscal
            </th>
            <th style={{ border: "1px solid #ccc", padding: 8 }}>
              Fornecedor
            </th>
            <th style={{ border: "1px solid #ccc", padding: 8 }}>
              Ações
            </th>
            </tr>
        </thead>

        <tbody>
            {lista.map((item, i) => (
            <tr
              key={i}
              style={{
                background: i % 2 === 0 ? "#f2f2f2" : "#ffffff"
              }}
            >
                <td style={{ border: "1px solid #ccc", padding: 8 }}>
                  {item.nome}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 8 }}>
                  {item.tipo}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 8 }}>
                  {item.marca}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 8 }}>
                  {quantidadeEntradaDoItem(item)
                    ? `${quantidadeEntradaDoItem(item)} ${item.unidade || ""}`
                    : ""}
                </td>
                <td style={{
                  border: "1px solid #ccc",
                  padding: 8,
                  whiteSpace: "nowrap",
                  textAlign: "right",
                  fontWeight: "bold"
                }}>
                  {`R$ ${(item.preco || 0).toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })}`}
                </td>
                <td style={{
                  border: "1px solid #ccc",
                  padding: 8,
                  whiteSpace: "nowrap",
                  textAlign: "right",
                  fontWeight: "bold"
                }}>
                  {`R$ ${((totalEntradaDoItem(item)) || 0).toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })}`}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 8 }}>
                  {item.data
                    ? item.data.split("-").reverse().join("/")
                    : ""}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 8 }}>
                  {item.nota}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 8 }}>
                  {item.fornecedor}
                </td>
                <td style={{ border: "1px solid #ccc", padding: 8, textAlign: "center" }}>
                  <button
                    style={{
                      background: "#ffc107",
                      color: "#000",
                      border: "none",
                      padding: "5px 10px",
                      borderRadius: 5,
                      cursor: "pointer",
                      marginRight: 5
                    }}
                    onClick={() => {
                      setEditId(item.id);
                      setNome(item.nome);
                      setTipo(item.tipo);
                      setMarca(item.marca);
                      setQuantidade(item.quantidade);
                      setUnidade(item.unidade || "");
                      setCategoria(item.categoria || "");
                      setPreco(item.preco || "");
                      setData(item.data);
                      setNota(item.nota);
                      setFornecedor(item.fornecedor);
                    }}
                  >
                    Editar
                  </button>

                  <button
                    style={{
                      background: "#cc0000",
                      color: "#fff",
                      border: "none",
                      padding: "5px 10px",
                      borderRadius: 5,
                      cursor: "pointer"
                    }}
                    onClick={() => excluir(item.id)}
                  >
                    Excluir
                  </button>
                </td>
            </tr>
            ))}
        </tbody>
        </table>
      </>
      )}

      <br />
      
    </div>
  );
}

export default Lubrificantes;





