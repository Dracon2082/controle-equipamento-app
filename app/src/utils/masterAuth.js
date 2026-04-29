import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

const MASTER_SESSION_KEY = "sessaoMaster";
export const MASTER_LOCAL_EMAIL = String(process.env.REACT_APP_MASTER_EMAIL || "master@controle.local").trim().toLowerCase();
export const MASTER_LOCAL_PASSWORD = String(process.env.REACT_APP_MASTER_PASSWORD || "Master@123");

const normalizarErroLogin = (error) => {
  const codigo = String(error?.code || "");
  if (codigo.includes("invalid-credential") || codigo.includes("wrong-password") || codigo.includes("user-not-found")) {
    return "E-mail ou senha invalido.";
  }
  if (codigo.includes("too-many-requests")) {
    return "Muitas tentativas. Tente novamente em alguns minutos.";
  }
  return "Falha no login administrativo. Verifique sua conexao.";
};

export async function masterLogin(email, senha) {
  const emailNormalizado = String(email || "").trim().toLowerCase();
  const senhaNormalizada = String(senha || "");

  if (emailNormalizado === MASTER_LOCAL_EMAIL && senhaNormalizada === MASTER_LOCAL_PASSWORD) {
    localStorage.setItem(
      MASTER_SESSION_KEY,
      JSON.stringify({
        uid: "local-master",
        email: MASTER_LOCAL_EMAIL,
        origem: "local",
        logadoEm: new Date().toISOString()
      })
    );
    return { ok: true };
  }

  try {
    const cred = await signInWithEmailAndPassword(auth, emailNormalizado, senhaNormalizada);
    const uid = cred.user.uid;

    const snapPermissao = await getDoc(doc(db, "master_admins", uid));
    if (!snapPermissao.exists() || snapPermissao.data()?.ativo !== true) {
      await signOut(auth);
      return { ok: false, erro: "Usuario sem permissao master." };
    }

    localStorage.setItem(
      MASTER_SESSION_KEY,
      JSON.stringify({
        uid,
        email: cred.user.email || "",
        logadoEm: new Date().toISOString()
      })
    );

    return { ok: true };
  } catch (error) {
    return { ok: false, erro: normalizarErroLogin(error) };
  }
}

export function isMasterAutenticado() {
  try {
    const sessao = JSON.parse(localStorage.getItem(MASTER_SESSION_KEY) || "null");
    return !!sessao?.uid;
  } catch {
    return false;
  }
}

export async function masterLogout() {
  try {
    await signOut(auth);
  } catch {
    // noop
  }
  localStorage.removeItem(MASTER_SESSION_KEY);
}
