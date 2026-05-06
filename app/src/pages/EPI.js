import { useEffect, useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import jsPDF from "jspdf";
import { addDoc, collection, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { belongsToTenant, getConfigDocId, getTenantId, withTenant } from "../utils/tenant";
import { registrarHistorico } from "../utils/historico";

const ITENS_PADRAO_EPI = [
  "LUVA PIGMENTADA",
  "OCULOS DE PROTECAO",
  "PROTETOR AURICULAR",
  "MASCARA PFF2",
  "CAPACETE",
  "BOTINA DE SEGURANCA",
  "UNIFORME",
  "COLETE REFLETIVO",
  "PERNEIRA",
  "PROTETOR SOLAR"
];

const formatarDataBr = (dataIso) => {
  if (!dataIso) return "-";
  try {
    return new Date(`${dataIso}T00:00:00`).toLocaleDateString("pt-BR");
  } catch {
    return "-";
  }
};

const upper = (v) => String(v || "").trim().toUpperCase();
const normalizarBaseValor = (valor) => String(valor || "").trim().toUpperCase();
const gerarChaveBase = (cidade, estado) => `${normalizarBaseValor(cidade)}__${normalizarBaseValor(estado)}`;

const urlParaDataUrl = async (url) => {
  const res = await fetch(url);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const formatoImagem = (src) => {
  const s = String(src || "").toLowerCase();
  if (s.includes("image/jpeg") || s.includes("image/jpg") || s.includes(".jpg") || s.includes(".jpeg")) return "JPEG";
  return "PNG";
};

function EPI({ setTela, modo = "completo", embed = false }) {
  const tenantId = getTenantId();
  const isMobile = window.innerWidth <= 700;
  const assinaturaWidth = Math.min(460, Math.max(280, window.innerWidth - 56));
  const assinaturaBaseWidth = Math.min(360, Math.max(240, window.innerWidth - 96));
  const sigEntregaRef = useRef(null);
  const sigBaixaRef = useRef(null);
  const sigEdicaoRef = useRef(null);
  const sigBaseEmpregadoRef = useRef(null);

  const [funcionarios, setFuncionarios] = useState([]);
  const [obras, setObras] = useState([]);
  const [entregas, setEntregas] = useState([]);
  const [estoqueEpi, setEstoqueEpi] = useState([]);
  const [configEmpresa, setConfigEmpresa] = useState(null);

  const [funcionario, setFuncionario] = useState("");
  const [funcionarioIdSelecionado, setFuncionarioIdSelecionado] = useState("");
  const [funcaoFuncionario, setFuncaoFuncionario] = useState("");
  const [obra, setObra] = useState("");
  const [epiPadrao, setEpiPadrao] = useState("");
  const [epiManual, setEpiManual] = useState("");
  const [caEpi, setCaEpi] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [dataEntrega, setDataEntrega] = useState(new Date().toISOString().split("T")[0]);
  const [obsEntrega, setObsEntrega] = useState("");
  const [assinaturaBaseEmpregado, setAssinaturaBaseEmpregado] = useState("");

  const [registroBaixa, setRegistroBaixa] = useState(null);
  const [dataBaixa, setDataBaixa] = useState(new Date().toISOString().split("T")[0]);
  const [obsBaixa, setObsBaixa] = useState("");

  const [registroEdicao, setRegistroEdicao] = useState(null);
  const [edFuncionario, setEdFuncionario] = useState("");
  const [edFuncao, setEdFuncao] = useState("");
  const [edObra, setEdObra] = useState("");
  const [edItem, setEdItem] = useState("");
  const [edCa, setEdCa] = useState("");
  const [edQtd, setEdQtd] = useState("1");
  const [edData, setEdData] = useState(new Date().toISOString().split("T")[0]);
  const [edObs, setEdObs] = useState("");

  const [funcionarioFicha, setFuncionarioFicha] = useState("");

  const inputStyle = {
    width: "100%",
    height: 42,
    borderRadius: 8,
    border: "1px solid #cfd7e3",
    padding: "0 10px",
    boxSizing: "border-box"
  };
  const card = {
    background: "#fff",
    border: "1px solid #e3e7ef",
    borderRadius: 8,
    padding: 14,
    marginBottom: 12
  };
  const btn = {
    border: "none",
    borderRadius: 8,
    padding: "10px 14px",
    fontWeight: "bold",
    cursor: "pointer"
  };

  const carregar = async () => {
    const [snapFunc, snapObras, snapEpi, snapEstoque, cfgSnap] = await Promise.all([
      getDocs(collection(db, "funcionarios")),
      getDocs(collection(db, "obras")),
      getDocs(collection(db, "epi_movimentacoes")),
      getDocs(collection(db, "almoxarifado_estoque_epi")),
      getDoc(doc(db, "configuracoes", getConfigDocId(tenantId)))
    ]);

    const listaFuncionarios = snapFunc.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((item) => belongsToTenant(item, tenantId));

    setFuncionarios(listaFuncionarios);
    setObras(
      snapObras.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((item) => belongsToTenant(item, tenantId))
    );
    setEntregas(
      snapEpi.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((item) => belongsToTenant(item, tenantId))
        .sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")))
    );
    setEstoqueEpi(
      snapEstoque.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((item) => belongsToTenant(item, tenantId))
        .sort((a, b) => {
          const ka = `${String(a.nome || "")} ${String(a.caEpi || "")}`.trim();
          const kb = `${String(b.nome || "")} ${String(b.caEpi || "")}`.trim();
          return ka.localeCompare(kb);
        })
    );
    setConfigEmpresa(cfgSnap.exists() ? cfgSnap.data() : null);
  };

  useEffect(() => {
    carregar();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selecionarFuncionario = (nome) => {
    setFuncionario(nome);
    const encontrado = funcionarios.find((f) => f.nome === nome);
    setFuncionarioIdSelecionado(encontrado?.id || "");
    setFuncaoFuncionario(upper(encontrado?.funcao));
    setAssinaturaBaseEmpregado(String(encontrado?.assinaturaEpi || ""));
    setTimeout(() => sigBaseEmpregadoRef.current?.clear(), 0);
  };

  const salvarAssinaturaBase = async () => {
    if (!funcionarioIdSelecionado) return alert("Selecione o funcionario.");
    const assinatura =
      sigBaseEmpregadoRef.current && !sigBaseEmpregadoRef.current.isEmpty()
        ? sigBaseEmpregadoRef.current.getCanvas().toDataURL("image/png")
        : "";
    if (!assinatura) return alert("Assine no campo.");

    await updateDoc(doc(db, "funcionarios", funcionarioIdSelecionado), {
      assinaturaEpi: assinatura,
      atualizadoEm: new Date().toISOString()
    });
    setAssinaturaBaseEmpregado(assinatura);
    alert("Assinatura base salva.");
    await carregar();
  };

  const salvarEntrega = async () => {
    const usuario = localStorage.getItem("usuarioLogado") || "USUARIO";
    const item = upper(epiManual || epiPadrao);
    const qtd = Number(quantidade || 0);
    const assinatura =
      sigEntregaRef.current && !sigEntregaRef.current.isEmpty()
        ? sigEntregaRef.current.getCanvas().toDataURL("image/png")
        : "";

    if (!funcionario || !funcaoFuncionario || !obra || !item || !caEpi || qtd <= 0) {
      return alert("Preencha funcionario, funcao, obra, item, CA e quantidade.");
    }
    if (!assinatura) return alert("A assinatura de recebimento e obrigatoria.");

    const obraInfo = obras.find((o) => o.nome === obra) || null;
    if (!obraInfo?.cidade || !obraInfo?.estado) {
      return alert("Nao foi possivel identificar a base (cidade/estado) da obra. Verifique o cadastro da obra.");
    }
    const baseChave = gerarChaveBase(obraInfo.cidade, obraInfo.estado);
    const baseCidade = upper(obraInfo.cidade);
    const baseEstado = upper(obraInfo.estado);

    // Baixa no estoque de EPI (por base + item + CA)
    const estoqueItem = estoqueEpi.find(
      (e) =>
        upper(e.baseChave) === upper(baseChave) &&
        upper(e.nome) === upper(item) &&
        upper(e.caEpi) === upper(caEpi)
    );
    if (!estoqueItem) {
      return alert("Sem estoque desse EPI para esta base. Registre a entrada de material primeiro (Almoxarifado).");
    }
    const saldoAtual = Number(estoqueItem.quantidade || 0);
    if (saldoAtual < qtd) {
      return alert(`Estoque insuficiente. Saldo atual: ${saldoAtual}.`);
    }
    await updateDoc(doc(db, "almoxarifado_estoque_epi", estoqueItem.id), {
      quantidade: saldoAtual - qtd,
      atualizadoEm: new Date().toISOString()
    });

    const ref = await addDoc(
      collection(db, "epi_movimentacoes"),
      withTenant(
        {
          funcionario,
          funcaoFuncionario,
          obra,
          item,
          caEpi: upper(caEpi),
          quantidade: qtd,
          dataEntrega,
          observacaoEntrega: upper(obsEntrega),
          assinaturaEntrega: assinatura,
          baseCidade,
          baseEstado,
          baseChave,
          status: "EM_USO",
          dataDevolucao: "",
          observacaoDevolucao: "",
          assinaturaDevolucao: "",
          entreguePor: usuario,
          criadoEm: new Date().toISOString()
        },
        tenantId
      )
    );

    await registrarHistorico({
      modulo: "EPI",
      acao: "CRIOU",
      entidade: "ENTREGA",
      registroId: ref.id,
      usuario,
      descricao: `${funcionario} recebeu ${qtd}x ${item}.`
    });

    setFuncionario("");
    setFuncionarioIdSelecionado("");
    setFuncaoFuncionario("");
    setObra("");
    setEpiPadrao("");
    setEpiManual("");
    setCaEpi("");
    setQuantidade("1");
    setObsEntrega("");
    sigEntregaRef.current?.clear();
    await carregar();
    alert("Entrega registrada.");
  };

  const abrirEdicao = (registro) => {
    setRegistroEdicao(registro);
    setEdFuncionario(registro.funcionario || "");
    setEdFuncao(registro.funcaoFuncionario || "");
    setEdObra(registro.obra || "");
    setEdItem(registro.item || "");
    setEdCa(registro.caEpi || "");
    setEdQtd(String(registro.quantidade || 1));
    setEdData(registro.dataEntrega || new Date().toISOString().split("T")[0]);
    setEdObs(registro.observacaoEntrega || "");
    setTimeout(() => sigEdicaoRef.current?.clear(), 0);
  };

  const salvarEdicao = async () => {
    const usuario = localStorage.getItem("usuarioLogado") || "USUARIO";
    if (!registroEdicao?.id) return;
    const assinaturaNova =
      sigEdicaoRef.current && !sigEdicaoRef.current.isEmpty()
        ? sigEdicaoRef.current.getCanvas().toDataURL("image/png")
        : "";
    if (!assinaturaNova) return alert("Na edicao precisa assinar novamente.");

    const oldItem = upper(registroEdicao.item);
    const oldCa = upper(registroEdicao.caEpi);
    const oldQtd = Number(registroEdicao.quantidade || 0);
    const oldObra = String(registroEdicao.obra || "");

    const newItem = upper(edItem);
    const newCa = upper(edCa);
    const newQtd = Number(edQtd || 0);
    const newObra = String(edObra || "");

    const oldBaseChave =
      upper(registroEdicao.baseChave) ||
      (() => {
        const o = obras.find((x) => x.nome === oldObra);
        return o?.cidade && o?.estado ? gerarChaveBase(o.cidade, o.estado) : "";
      })();

    const newBaseChave =
      (() => {
        const o = obras.find((x) => x.nome === newObra);
        return o?.cidade && o?.estado ? gerarChaveBase(o.cidade, o.estado) : "";
      })();

    if (!oldBaseChave || !newBaseChave) {
      return alert("Nao foi possivel identificar a base (cidade/estado) para ajustar o estoque. Verifique a obra.");
    }

    const ajustarEstoqueEpi = async ({ baseChave, item, ca, delta }) => {
      if (!delta) return;
      const existente = estoqueEpi.find(
        (e) =>
          upper(e.baseChave) === upper(baseChave) &&
          upper(e.nome) === upper(item) &&
          upper(e.caEpi) === upper(ca)
      );
      if (!existente) {
        if (delta < 0) {
          // Precisa tirar do estoque mas nao existe cadastro
          throw new Error("Sem estoque cadastrado para o item/CA nesta base.");
        }
        // Delta positivo: devolvendo ao estoque, cria registro
        const obraInfo = obras.find((o) => gerarChaveBase(o.cidade, o.estado) === baseChave) || {};
        await addDoc(
          collection(db, "almoxarifado_estoque_epi"),
          withTenant(
            {
              nome: upper(item),
              caEpi: upper(ca),
              quantidade: delta,
              unidade: "UN",
              baseCidade: upper(obraInfo.cidade || ""),
              baseEstado: upper(obraInfo.estado || ""),
              baseChave: upper(baseChave),
              criadoEm: new Date().toISOString()
            },
            tenantId
          )
        );
        return;
      }
      const saldo = Number(existente.quantidade || 0);
      const novoSaldo = saldo + delta;
      if (novoSaldo < 0) throw new Error(`Estoque insuficiente. Saldo atual: ${saldo}.`);
      await updateDoc(doc(db, "almoxarifado_estoque_epi", existente.id), {
        quantidade: novoSaldo,
        atualizadoEm: new Date().toISOString()
      });
    };

    try {
      const sameKey =
        upper(oldBaseChave) === upper(newBaseChave) &&
        upper(oldItem) === upper(newItem) &&
        upper(oldCa) === upper(newCa);

      if (sameKey) {
        const delta = oldQtd - newQtd; // positivo devolve, negativo baixa a mais
        if (delta !== 0) {
          await ajustarEstoqueEpi({ baseChave: oldBaseChave, item: oldItem, ca: oldCa, delta });
        }
      } else {
        // devolve o antigo
        if (oldQtd > 0) {
          await ajustarEstoqueEpi({ baseChave: oldBaseChave, item: oldItem, ca: oldCa, delta: oldQtd });
        }
        // baixa o novo
        if (newQtd > 0) {
          await ajustarEstoqueEpi({ baseChave: newBaseChave, item: newItem, ca: newCa, delta: -newQtd });
        }
      }
    } catch (e) {
      console.error(e);
      return alert(`Nao foi possivel ajustar o estoque na edicao: ${String(e?.message || e)}`);
    }

    await updateDoc(doc(db, "epi_movimentacoes", registroEdicao.id), {
      funcionario: upper(edFuncionario),
      funcaoFuncionario: upper(edFuncao),
      obra: upper(edObra),
      item: upper(edItem),
      caEpi: upper(edCa),
      quantidade: Number(edQtd || 0),
      dataEntrega: edData,
      observacaoEntrega: upper(edObs),
      assinaturaEntrega: assinaturaNova,
      baseChave: upper(newBaseChave),
      atualizadoEm: new Date().toISOString(),
      editadoPor: usuario
    });
    setRegistroEdicao(null);
    await carregar();
    alert("Entrega editada.");
  };

  const confirmarBaixa = async () => {
    const usuario = localStorage.getItem("usuarioLogado") || "USUARIO";
    const assinatura =
      sigBaixaRef.current && !sigBaixaRef.current.isEmpty()
        ? sigBaixaRef.current.getCanvas().toDataURL("image/png")
        : "";
    if (!registroBaixa?.id) return;
    if (!assinatura) return alert("Assinatura de devolucao obrigatoria.");

    const baseChave =
      upper(registroBaixa.baseChave) ||
      (() => {
        const o = obras.find((x) => x.nome === String(registroBaixa.obra || ""));
        return o?.cidade && o?.estado ? gerarChaveBase(o.cidade, o.estado) : "";
      })();

    if (!baseChave) {
      return alert("Nao foi possivel identificar a base para devolver ao estoque. Verifique a obra.");
    }

    // Devolucao volta para estoque
    const nome = upper(registroBaixa.item);
    const ca = upper(registroBaixa.caEpi);
    const qtd = Number(registroBaixa.quantidade || 0);
    const existente = estoqueEpi.find(
      (e) =>
        upper(e.baseChave) === upper(baseChave) &&
        upper(e.nome) === upper(nome) &&
        upper(e.caEpi) === upper(ca)
    );
    if (existente) {
      await updateDoc(doc(db, "almoxarifado_estoque_epi", existente.id), {
        quantidade: Number(existente.quantidade || 0) + qtd,
        atualizadoEm: new Date().toISOString()
      });
    } else {
      const obraInfo = obras.find((o) => gerarChaveBase(o.cidade, o.estado) === baseChave) || {};
      await addDoc(
        collection(db, "almoxarifado_estoque_epi"),
        withTenant(
          {
            nome,
            caEpi: ca,
            quantidade: qtd,
            unidade: "UN",
            baseCidade: upper(obraInfo.cidade || ""),
            baseEstado: upper(obraInfo.estado || ""),
            baseChave: upper(baseChave),
            criadoEm: new Date().toISOString()
          },
          tenantId
        )
      );
    }

    await updateDoc(doc(db, "epi_movimentacoes", registroBaixa.id), {
      status: "DEVOLVIDO",
      dataDevolucao: dataBaixa,
      observacaoDevolucao: upper(obsBaixa),
      assinaturaDevolucao: assinatura,
      devolvidoPor: usuario,
      atualizadoEm: new Date().toISOString()
    });
    setRegistroBaixa(null);
    setObsBaixa("");
    sigBaixaRef.current?.clear();
    await carregar();
    alert("Baixa registrada.");
  };

  const gerarFichaFuncionario = async () => {
    try {
      if (!funcionarioFicha) return alert("Selecione o funcionario.");
      const registros = entregas
        .filter((e) => e.funcionario === funcionarioFicha)
        .sort((a, b) => String(a.dataEntrega || "").localeCompare(String(b.dataEntrega || "")));
      if (!registros.length) return alert("Sem registros para esse funcionario.");

      const dadosFuncionario = funcionarios.find((f) => f.nome === funcionarioFicha) || {};
      const assinaturaBase = dadosFuncionario.assinaturaEpi || "";
      const funcaoFicha = dadosFuncionario.funcao || registros[0]?.funcaoFuncionario || "-";
      const dataAdmissao = dadosFuncionario.dataCadastro || "-";

      const logoBase64 = String(configEmpresa?.logoBase64 || "");
      const logoOriginal = String(configEmpresa?.logo || "");
      let logoData = logoBase64 || logoOriginal;
      if (logoData && !logoData.startsWith("data:")) {
        try {
          logoData = await urlParaDataUrl(logoData);
        } catch {
          logoData = "";
        }
      }

      const pdf = new jsPDF("p", "mm", "a4");
      const largura = pdf.internal.pageSize.getWidth();
      const margem = 10;
      const cols = [10, 54, 16, 22, 30, 22, 36]; // total 190

      let y = 12;
      const drawHeader = () => {
        pdf.setDrawColor(110);
        pdf.setLineWidth(0.2);
        pdf.rect(margem, 8, largura - margem * 2, 18);
        if (logoBase64 || logoOriginal || logoData) {
          try {
            const fonteLogo = logoBase64 || logoOriginal || logoData;
            pdf.addImage(fonteLogo, formatoImagem(fonteLogo), margem + 2, 9, 22, 14);
          } catch {
            try {
              if (logoData) {
                pdf.addImage(logoData, formatoImagem(logoData), margem + 2, 9, 22, 14);
              }
            } catch {}
          }
        }
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(14);
        pdf.text("CIE - CONTROLE INDIVIDUAL DE EPI", largura / 2, 18, { align: "center" });

        y = 31;
        pdf.setFontSize(12);
        pdf.rect(margem, y - 5, largura - margem * 2, 8);
        pdf.text("TERMO DE COMPROMISSO", largura / 2, y, { align: "center" });
        y += 7;

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9);
        const termo =
          "Declaro que recebi orientacao sobre o uso correto do EPI fornecido pela empresa e estou ciente das regras de uso, guarda e conservacao. Em caso de dano ou extravio causado pelo empregado, podera haver desconto do valor do equipamento conforme politica interna da empresa.";
        const linhas = pdf.splitTextToSize(termo, largura - margem * 2 - 4);
        pdf.text(linhas, margem + 2, y);
        y += linhas.length * 4 + 3;

        // assinatura fixa do empregado (mais alta e sem linha cortando)
        if (assinaturaBase) {
          try {
            const fmt = assinaturaBase.includes("image/jpeg") ? "JPEG" : "PNG";
            pdf.addImage(assinaturaBase, fmt, largura / 2 - 30, y - 2, 60, 10);
          } catch {}
        }
        pdf.line(largura / 2 - 34, y + 10.5, largura / 2 + 34, y + 10.5);
        pdf.text("Assinatura do Empregado", largura / 2, y + 14.5, { align: "center" });
        y += 22;

        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(11);
        pdf.rect(margem, y - 5, largura - margem * 2, 7);
        pdf.text(`Nome: ${funcionarioFicha}`, margem + 2, y);
        y += 8;
        pdf.rect(margem, y - 5, largura - margem * 2, 7);
        pdf.text(`Data Admissao: ${dataAdmissao}`, margem + 2, y);
        pdf.text(`Funcao: ${funcaoFicha}`, largura / 2 + 8, y);
        y += 8;

        const labels = ["Qtd", "EPI", "CA", "Data\nReceb.", "Ass.\nEmpregado", "Data\nDevol.", "Ass. Responsável\nDevolucao"];
        let x = margem;
        const hY = y;
        const headerH = 10;
        pdf.setFontSize(9);
        labels.forEach((label, i) => {
          pdf.rect(x, hY, cols[i], headerH);
          const ls = label.split("\n");
          const lineH = 3.5;
          const blocoH = ls.length * lineH;
          const startY = hY + (headerH - blocoH) / 2 + 2.5;
          ls.forEach((l, idx) => {
            pdf.text(l, x + cols[i] / 2, startY + idx * lineH, { align: "center" });
          });
          x += cols[i];
        });
        y = hY + headerH;
      };

      drawHeader();
      const rowH = 14;
      registros.forEach((r) => {
        if (y + rowH > 285) {
          pdf.addPage();
          drawHeader();
        }
        const vals = [
          String(r.quantidade || "-"),
          String(r.item || "-").slice(0, 24),
          String(r.caEpi || "-").slice(0, 12),
          formatarDataBr(r.dataEntrega),
          "",
          formatarDataBr(r.dataDevolucao),
          ""
        ];
        let x = margem;
        vals.forEach((v, i) => {
          pdf.rect(x, y, cols[i], rowH);
          if (i !== 4 && i !== 6) {
            pdf.setFontSize(8.5);
            pdf.text(v, x + cols[i] / 2, y + rowH / 2 + 1, { align: "center" });
          }
          x += cols[i];
        });

        if (r.assinaturaEntrega) {
          try {
            const fmt = String(r.assinaturaEntrega).includes("image/jpeg") ? "JPEG" : "PNG";
            const xAssEntrega = margem + cols[0] + cols[1] + cols[2] + cols[3] + 1;
            pdf.addImage(r.assinaturaEntrega, fmt, xAssEntrega, y + 1, cols[4] - 2, rowH - 2);
          } catch {}
        }

        if (r.assinaturaDevolucao) {
          try {
            const fmt = String(r.assinaturaDevolucao).includes("image/jpeg") ? "JPEG" : "PNG";
            const xAssDevolucao = margem + cols[0] + cols[1] + cols[2] + cols[3] + cols[4] + cols[5] + 1;
            pdf.addImage(r.assinaturaDevolucao, fmt, xAssDevolucao, y + 1, cols[6] - 2, rowH - 2);
          } catch {}
        }
        y += rowH;
      });

      const blobUrl = pdf.output("bloburl");
      const novaAba = window.open(blobUrl, "_blank");
      if (!novaAba) {
        pdf.save(`ficha-epi-${funcionarioFicha.replace(/\s+/g, "-").toLowerCase()}.pdf`);
      }
    } catch (error) {
      console.error("Erro ao gerar ficha EPI:", error);
      alert("Nao foi possivel gerar a ficha PDF agora. Tente novamente.");
    }
  };

  const pendentes = entregas.filter((e) => e.status === "EM_USO");

  const pageStyle = embed
    ? { maxWidth: 1200, margin: "0 auto", padding: 0, background: "transparent", minHeight: "unset" }
    : { maxWidth: 1080, margin: "0 auto", padding: isMobile ? 10 : 18, background: "#f3f5f8", minHeight: "100vh" };

  return (
    <div style={pageStyle}>
      {!embed && <h2 style={{ marginTop: 0, color: "#10243e" }}>Controle de EPI</h2>}

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Nova entrega de EPI</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <select style={inputStyle} value={funcionario} onChange={(e) => selecionarFuncionario(e.target.value)}>
            <option value="">Selecione o funcionario</option>
            {funcionarios.map((f, i) => <option key={i} value={f.nome}>{f.nome}</option>)}
          </select>
          <input style={inputStyle} placeholder="Funcao do funcionario" value={funcaoFuncionario} onChange={(e) => setFuncaoFuncionario(upper(e.target.value))} />
          <select style={inputStyle} value={obra} onChange={(e) => setObra(e.target.value)}>
            <option value="">Selecione a obra</option>
            {obras.map((o, i) => <option key={i} value={o.nome}>{o.nome}</option>)}
          </select>
          <select style={inputStyle} value={epiPadrao} onChange={(e) => setEpiPadrao(e.target.value)}>
            <option value="">EPI padrao</option>
            {ITENS_PADRAO_EPI.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <input style={inputStyle} placeholder="CA do EPI" value={caEpi} onChange={(e) => setCaEpi(upper(e.target.value))} />
          <input style={inputStyle} placeholder="Ou digite outro EPI" value={epiManual} onChange={(e) => setEpiManual(e.target.value)} />
          <input style={inputStyle} type="number" min="1" placeholder="Quantidade" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
          <input style={inputStyle} type="date" value={dataEntrega} onChange={(e) => setDataEntrega(e.target.value)} />
        </div>

        <div style={{ marginTop: 10, border: "1px solid #d6deeb", borderRadius: 8, padding: 10 }}>
          <p style={{ margin: "0 0 6px", fontWeight: "bold" }}>Assinatura base do empregado (uma vez)</p>
          {assinaturaBaseEmpregado && <img src={assinaturaBaseEmpregado} alt="Assinatura base" style={{ width: 220, height: 60, objectFit: "contain", border: "1px solid #d6deeb", borderRadius: 6, background: "#fff", marginBottom: 8 }} />}
          <SignatureCanvas ref={sigBaseEmpregadoRef} penColor="black" canvasProps={{ width: assinaturaBaseWidth, height: 90, style: { border: "1px dashed #95a5bf", borderRadius: 8, background: "#fff" } }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button style={{ ...btn, background: "#0b5ed7", color: "#fff", padding: "8px 12px" }} onClick={salvarAssinaturaBase}>Salvar assinatura base</button>
            <button style={{ ...btn, background: "#6c757d", color: "#fff", padding: "8px 12px" }} onClick={() => sigBaseEmpregadoRef.current?.clear()}>Limpar</button>
          </div>
        </div>

        <textarea style={{ ...inputStyle, height: 80, paddingTop: 10, marginTop: 10 }} placeholder="Observação da entrega" value={obsEntrega} onChange={(e) => setObsEntrega(e.target.value)} />

        <p style={{ marginBottom: 6, fontWeight: "bold" }}>Assinatura de recebimento</p>
        <SignatureCanvas ref={sigEntregaRef} penColor="black" canvasProps={{ width: assinaturaWidth, height: 130, style: { border: "1px dashed #95a5bf", borderRadius: 8, background: "#fff" } }} />

        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button style={{ ...btn, background: "#0b5ed7", color: "#fff" }} onClick={salvarEntrega}>Salvar entrega</button>
          <button style={{ ...btn, background: "#6c757d", color: "#fff" }} onClick={() => sigEntregaRef.current?.clear()}>Limpar assinatura</button>
          </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>EPIs pendentes de devolucao</h3>
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr style={{ background: "#0b3d91", color: "#fff" }}>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Data</th>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Funcionario</th>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Funcao</th>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Obra</th>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>EPI</th>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>CA</th>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Qtd</th>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Status</th>
              <th style={{ border: "1px solid #d4dce9", padding: 8 }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {pendentes.length === 0 && (
              <tr><td colSpan={9} style={{ border: "1px solid #d4dce9", padding: 10, textAlign: "center" }}>Nenhuma pendencia.</td></tr>
            )}
            {pendentes.map((m, i) => (
              <tr key={m.id} style={{ background: i % 2 === 0 ? "#f8fafe" : "#fff" }}>
                <td style={{ border: "1px solid #d4dce9", padding: 8 }}>{formatarDataBr(m.dataEntrega)}</td>
                <td style={{ border: "1px solid #d4dce9", padding: 8 }}>{m.funcionario}</td>
                <td style={{ border: "1px solid #d4dce9", padding: 8 }}>{m.funcaoFuncionario || "-"}</td>
                <td style={{ border: "1px solid #d4dce9", padding: 8 }}>{m.obra}</td>
                <td style={{ border: "1px solid #d4dce9", padding: 8 }}>{m.item}</td>
                <td style={{ border: "1px solid #d4dce9", padding: 8 }}>{m.caEpi || "-"}</td>
                <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center" }}>{m.quantidade}</td>
                <td style={{ border: "1px solid #d4dce9", padding: 8, color: "#a10000", fontWeight: "bold" }}>{m.status}</td>
                <td style={{ border: "1px solid #d4dce9", padding: 8, textAlign: "center", whiteSpace: "nowrap" }}>
                  <button style={{ ...btn, background: "#f0ad4e", color: "#111", padding: "6px 10px", marginRight: 6 }} onClick={() => abrirEdicao(m)}>Editar</button>
                  <button style={{ ...btn, background: "#198754", color: "#fff", padding: "6px 10px" }} onClick={() => setRegistroBaixa(m)}>Dar baixa</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Ficha de EPI por funcionario</h3>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 420px) auto", gap: 8, alignItems: "end" }}>
          <select style={inputStyle} value={funcionarioFicha} onChange={(e) => setFuncionarioFicha(e.target.value)}>
            <option value="">Selecione o funcionario</option>
            {funcionarios.map((f, i) => <option key={i} value={f.nome}>{f.nome}</option>)}
          </select>
          <button style={{ ...btn, background: "#0b5ed7", color: "#fff", height: 42 }} onClick={gerarFichaFuncionario}>Imprimir ficha</button>
        </div>
      </div>

      {registroEdicao && (
        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Editar entrega de EPI</h3>
          <p style={{ marginTop: 0, color: "#445d7b" }}>Ao editar, precisa assinatura nova de recebimento.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <input style={inputStyle} value={edFuncionario} onChange={(e) => setEdFuncionario(e.target.value)} placeholder="Funcionario" />
            <input style={inputStyle} value={edFuncao} onChange={(e) => setEdFuncao(upper(e.target.value))} placeholder="Funcao" />
            <input style={inputStyle} value={edObra} onChange={(e) => setEdObra(e.target.value)} placeholder="Obra" />
            <input style={inputStyle} value={edItem} onChange={(e) => setEdItem(upper(e.target.value))} placeholder="EPI" />
            <input style={inputStyle} value={edCa} onChange={(e) => setEdCa(upper(e.target.value))} placeholder="CA do EPI" />
            <input style={inputStyle} value={edQtd} onChange={(e) => setEdQtd(e.target.value)} type="number" min="1" placeholder="Quantidade" />
            <input style={inputStyle} value={edData} onChange={(e) => setEdData(e.target.value)} type="date" />
            <input style={inputStyle} value={edObs} onChange={(e) => setEdObs(e.target.value)} placeholder="Observação da entrega" />
          </div>
          <p style={{ marginBottom: 6, marginTop: 10, fontWeight: "bold" }}>Nova assinatura de recebimento</p>
          <SignatureCanvas ref={sigEdicaoRef} penColor="black" canvasProps={{ width: assinaturaWidth, height: 130, style: { border: "1px dashed #95a5bf", borderRadius: 8, background: "#fff" } }} />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button style={{ ...btn, background: "#0b5ed7", color: "#fff" }} onClick={salvarEdicao}>Salvar edicao</button>
            <button style={{ ...btn, background: "#6c757d", color: "#fff" }} onClick={() => sigEdicaoRef.current?.clear()}>Limpar assinatura</button>
            <button style={{ ...btn, background: "#dc3545", color: "#fff" }} onClick={() => setRegistroEdicao(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {registroBaixa && (
        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Baixa de EPI</h3>
          <p style={{ marginTop: 0 }}>
            <strong>{registroBaixa.funcionario}</strong> - {registroBaixa.item} ({registroBaixa.quantidade}) | CA: {registroBaixa.caEpi || "-"}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <input style={inputStyle} type="date" value={dataBaixa} onChange={(e) => setDataBaixa(e.target.value)} />
            <input style={inputStyle} placeholder="Observação da devolucao" value={obsBaixa} onChange={(e) => setObsBaixa(e.target.value)} />
          </div>
          <p style={{ marginBottom: 6, marginTop: 10, fontWeight: "bold" }}>Assinatura de devolucao</p>
          <SignatureCanvas ref={sigBaixaRef} penColor="black" canvasProps={{ width: assinaturaWidth, height: 130, style: { border: "1px dashed #95a5bf", borderRadius: 8, background: "#fff" } }} />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button style={{ ...btn, background: "#198754", color: "#fff" }} onClick={confirmarBaixa}>Confirmar baixa</button>
            <button style={{ ...btn, background: "#6c757d", color: "#fff" }} onClick={() => sigBaixaRef.current?.clear()}>Limpar assinatura</button>
            <button style={{ ...btn, background: "#dc3545", color: "#fff" }} onClick={() => setRegistroBaixa(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default EPI;


