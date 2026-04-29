import { useState } from "react";
import { masterLogin, MASTER_LOCAL_EMAIL, MASTER_LOCAL_PASSWORD } from "../utils/masterAuth";

function MasterLogin({ setTela }) {
  const [email, setEmail] = useState(MASTER_LOCAL_EMAIL);
  const [senha, setSenha] = useState(MASTER_LOCAL_PASSWORD);

  const entrar = async () => {
    if (!email || !senha) {
      alert("Informe e-mail e senha do administrador.");
      return;
    }

    const resultado = await masterLogin(email, senha);
    if (!resultado.ok) {
      alert(resultado.erro || "Credenciais administrativas invalidas.");
      return;
    }

    alert("Acesso administrativo liberado.");
    setTela("masterClientes");
  };

  return (
    <div style={{ maxWidth: 520, margin: "40px auto", padding: 20, background: "#f5f7fa", minHeight: "100vh" }}>
      <div style={{ background: "#fff", borderRadius: 8, padding: 20, border: "1px solid #dbe3ef" }}>
        <h2 style={{ marginTop: 0 }}>Acesso Administrativo</h2>
        <p style={{ marginTop: 0, color: "#55657c" }}>
          Esta area e exclusiva do proprietario do sistema.
        </p>
        <p style={{ marginTop: 0, color: "#3b4d66", fontSize: 13 }}>
          Acesso local: <strong>{MASTER_LOCAL_EMAIL}</strong> / <strong>{MASTER_LOCAL_PASSWORD}</strong>
        </p>

        <input
          style={{ width: "100%", height: 42, borderRadius: 8, border: "1px solid #cfd7e3", padding: "0 10px", marginBottom: 10, boxSizing: "border-box" }}
          placeholder="E-mail administrativo"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          style={{ width: "100%", height: 42, borderRadius: 8, border: "1px solid #cfd7e3", padding: "0 10px", marginBottom: 12, boxSizing: "border-box" }}
          type="password"
          placeholder="Senha administrativa"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
        />

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => {
              setEmail(MASTER_LOCAL_EMAIL);
              setSenha(MASTER_LOCAL_PASSWORD);
            }}
            style={{ background: "#163256", color: "#fff", border: "none", borderRadius: 8, padding: "10px 14px", fontWeight: "bold", cursor: "pointer" }}
          >
            Usar acesso local
          </button>
          <button
            onClick={entrar}
            style={{ background: "#0b5ed7", color: "#fff", border: "none", borderRadius: 8, padding: "10px 14px", fontWeight: "bold", cursor: "pointer" }}
          >
            Entrar no Master
          </button>
          <button
            onClick={() => setTela("masterLogin")}
            style={{ background: "#6c757d", color: "#fff", border: "none", borderRadius: 8, padding: "10px 14px", fontWeight: "bold", cursor: "pointer" }}
          >
            Voltar
          </button>
        </div>
      </div>
    </div>
  );
}

export default MasterLogin;
