import { doc, getDoc, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../firebase";
import { button, container, input, title } from "../styles";
import { getConfigDocId, getLogoPath, getTenantId } from "../utils/tenant";

const arquivoParaBase64 = (arquivo) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(arquivo);
  });

function ConfigEmpresa({ setTela }) {
  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [telefone, setTelefone] = useState("");
  const [endereco, setEndereco] = useState("");
  const [inscricaoEstadual, setInscricaoEstadual] = useState("");
  const [logo, setLogo] = useState(null);
  const [estado, setEstado] = useState("");
  const [cidade, setCidade] = useState("");
  const [estados, setEstados] = useState([]);
  const [cidades, setCidades] = useState([]);

  const tenantAtual = getTenantId();
  const docConfigAtual = getConfigDocId(tenantAtual);

  useEffect(() => {
    fetch("https://servicodados.ibge.gov.br/api/v1/localidades/estados")
      .then((res) => res.json())
      .then((data) => {
        const lista = data.map((e) => e.sigla).sort();
        setEstados(lista);
      });
  }, []);

  useEffect(() => {
    if (!estado) return;
    fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${estado}/municipios`)
      .then((res) => res.json())
      .then((data) => setCidades(data.map((c) => c.nome)));
  }, [estado]);

  useEffect(() => {
    const carregar = async () => {
      const snap = await getDoc(doc(db, "configuracoes", docConfigAtual));
      if (!snap.exists()) return;
      const dados = snap.data();
      setNome(dados.nome || "");
      setCnpj(dados.cnpj || "");
      setTelefone(dados.telefone || "");
      setEndereco(dados.endereco || "");
      setInscricaoEstadual(dados.inscricaoEstadual || "");
      setEstado(dados.estado || "");
      setCidade(dados.cidade || "");
    };
    carregar();
  }, [docConfigAtual]);

  const salvar = async () => {
    const tenantEfetivo = getTenantId();
    const docId = getConfigDocId(tenantEfetivo);
    let logoURL = "";
    let logoBase64 = "";

    if (logo) {
      const storageRef = ref(storage, getLogoPath(tenantEfetivo));
      await uploadBytes(storageRef, logo);
      logoURL = await getDownloadURL(storageRef);
      try {
        logoBase64 = await arquivoParaBase64(logo);
      } catch {
        logoBase64 = "";
      }
    } else {
      const snap = await getDoc(doc(db, "configuracoes", docId));
      logoURL = snap.exists() ? snap.data().logo || "" : "";
      logoBase64 = snap.exists() ? snap.data().logoBase64 || "" : "";
    }

    await setDoc(doc(db, "configuracoes", docId), {
      tenantId: tenantEfetivo,
      nome,
      cnpj,
      telefone,
      endereco,
      inscricaoEstadual,
      logo: logoURL,
      logoBase64,
      estado,
      cidade
    });

    alert("Empresa salva.");
  };

  return (
    <div style={container}>
      <h2 style={title}>Cadastro da Empresa</h2>

      <input style={input} placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
      <input style={input} placeholder="CNPJ" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
      <input
        style={input}
        placeholder="Inscrição Estadual"
        value={inscricaoEstadual}
        onChange={(e) => setInscricaoEstadual(e.target.value)}
      />
      <input style={input} placeholder="Telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
      <input style={input} placeholder="Endereço" value={endereco} onChange={(e) => setEndereco(e.target.value)} />

      <select
        style={input}
        value={estado}
        onChange={(e) => {
          setEstado(e.target.value);
          setCidade("");
        }}
      >
        <option value="">Selecione o Estado</option>
        {estados.map((uf) => (
          <option key={uf}>{uf}</option>
        ))}
      </select>

      <select style={input} value={cidade} onChange={(e) => setCidade(e.target.value)}>
        <option value="">Selecione a Cidade</option>
        {cidades.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>

      <input type="file" style={input} onChange={(e) => setLogo(e.target.files?.[0] || null)} />

      <button style={button} onClick={salvar}>Salvar</button>
      </div>
  );
}

export default ConfigEmpresa;

