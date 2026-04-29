import { useMemo, useState } from "react";

function MinhaConta({ setTela }) {
  const sessao = (() => {
    try {
      return JSON.parse(localStorage.getItem("sessaoOperacional") || "{}");
    } catch {
      return {};
    }
  })();

  const nome = String(sessao?.nome || localStorage.getItem("usuarioLogado") || "USUARIO").trim();
  const email = String(sessao?.email || "").trim().toLowerCase();
  const perfil = String(sessao?.perfilAcesso || "OPERACIONAL").toUpperCase();
  const usuarioChave = Boolean(sessao?.usuarioChave);
  const tenant = String(sessao?.tenantId || localStorage.getItem("tenantId") || "tenant_local");
  const [mfaEmail, setMfaEmail] = useState(() => {
    try {
      const salvo = localStorage.getItem("mfaEmailEnabled");
      return salvo == null ? true : salvo === "1";
    } catch {
      return true;
    }
  });

  const iniciais = useMemo(() => {
    const partes = nome.split(" ").filter(Boolean);
    if (!partes.length) return "US";
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return `${partes[0].slice(0, 1)}${partes[partes.length - 1].slice(0, 1)}`.toUpperCase();
  }, [nome]);

  const card = {
    background: "#fff",
    border: "1px solid #dbe3ef",
    borderRadius: 10,
    padding: 18
  };
  const input = {
    width: "100%",
    height: 42,
    borderRadius: 8,
    border: "1px solid #cfd7e3",
    padding: "0 12px",
    boxSizing: "border-box",
    background: "#f6f8fc",
    marginBottom: 10,
    color: "#5a6b84"
  };

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: 14, background: "#eef2f7", minHeight: "100vh" }}>
      <h2 style={{ marginTop: 0, marginBottom: 12, color: "#173454", fontSize: 44 }}>Minha Conta</h2>

      <section style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 360px) 1fr", gap: 18 }}>
          <div>
            <h3 style={{ marginTop: 0, marginBottom: 8, color: "#173454" }}>Perfil</h3>
            <p style={{ marginTop: 0, color: "#5e738e" }}>
              Suas informacoes pessoais e configuracoes de seguranca da conta.
            </p>
          </div>

          <div>
            <div style={{ width: 118, height: 118, borderRadius: "50%", background: "#0b5ed7", color: "#fff", display: "grid", placeItems: "center", fontSize: 48, marginBottom: 10 }}>
              {iniciais}
            </div>
            <div style={{ color: "#5e738e", marginBottom: 10 }}>Clique no avatar para alterar</div>

            <div style={{ marginBottom: 6, color: "#5e738e", fontWeight: "bold" }}>Seu nome</div>
            <input style={input} value={nome} readOnly />

            <div style={{ marginBottom: 6, color: "#5e738e", fontWeight: "bold" }}>Seu e-mail</div>
            <input style={input} value={email} readOnly />

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <span style={{ border: "1px solid #dbe3ef", borderRadius: 999, padding: "6px 10px", background: "#f4f8ff", color: "#274669", fontWeight: 700 }}>
                Perfil: {perfil}
              </span>
              <span style={{ border: "1px solid #dbe3ef", borderRadius: 999, padding: "6px 10px", background: usuarioChave ? "#e9f7ef" : "#f6f8fc", color: "#274669", fontWeight: 700 }}>
                Usuario-Chave: {usuarioChave ? "SIM" : "NAO"}
              </span>
              <span style={{ border: "1px solid #dbe3ef", borderRadius: 999, padding: "6px 10px", background: "#f6f8fc", color: "#274669", fontWeight: 700 }}>
                Tenant: {tenant}
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                localStorage.setItem("forcarModoTrocaSenha", "1");
                setTela("login");
              }}
              style={{ border: "1px solid #a9ddb6", background: "#ecfff1", color: "#147a2e", borderRadius: 10, padding: "10px 14px", fontWeight: "bold", cursor: "pointer" }}
            >
              Alterar senha
            </button>
          </div>
        </div>
      </section>

      <section style={card}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) 1fr", gap: 18, alignItems: "center" }}>
          <div>
            <h3 style={{ marginTop: 0, marginBottom: 8, color: "#173454" }}>Autenticacao de dois fatores</h3>
            <p style={{ marginTop: 0, color: "#5e738e" }}>
              Mantenha sua conta segura habilitando a autenticacao de dois fatores via e-mail.
            </p>
          </div>

          <div>
            <label style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input
                type="checkbox"
                checked={mfaEmail}
                onChange={(e) => {
                  const novo = e.target.checked;
                  setMfaEmail(novo);
                  localStorage.setItem("mfaEmailEnabled", novo ? "1" : "0");
                }}
              />
              <div>
                <div style={{ color: "#173454", fontWeight: "bold" }}>Codigo de autenticacao por E-mail</div>
                <div style={{ color: "#5e738e" }}>
                  Receba um codigo de acesso unico por e-mail para entrar no sistema.
                </div>
              </div>
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}

export default MinhaConta;

