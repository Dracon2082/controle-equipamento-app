import { getApps, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  getAuth,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";
import { auth, firebaseConfig } from "../firebase";

const APP_SECUNDARIO_AUTH = "controle-equipamentos-auth-provision";

const getAuthSecundario = () => {
  const appExistente = getApps().find((app) => app.name === APP_SECUNDARIO_AUTH);
  const appSecundario = appExistente || initializeApp(firebaseConfig, APP_SECUNDARIO_AUTH);
  return getAuth(appSecundario);
};

export async function garantirUsuarioAuth(email, senha) {
  const emailNormalizado = String(email || "").trim().toLowerCase();
  const senhaNormalizada = String(senha || "");
  if (!emailNormalizado || !emailNormalizado.includes("@") || senhaNormalizada.length < 6) {
    return { ok: false, erro: "Dados insuficientes para criar usuario no Auth." };
  }

  try {
    const metodos = await fetchSignInMethodsForEmail(auth, emailNormalizado);
    if (Array.isArray(metodos) && metodos.length > 0) return { ok: true, existente: true };
  } catch {
    // segue tentativa de criacao
  }

  try {
    const authSecundario = getAuthSecundario();
    await createUserWithEmailAndPassword(authSecundario, emailNormalizado, senhaNormalizada);
    await signOut(authSecundario);
    return { ok: true, criado: true };
  } catch (error) {
    const codigo = String(error?.code || "");
    if (codigo.includes("email-already-in-use")) return { ok: true, existente: true };
    return { ok: false, erro: "Nao foi possivel provisionar usuario no Auth." };
  }
}

export async function solicitarResetSenhaPorEmail(email) {
  const emailNormalizado = String(email || "").trim().toLowerCase();
  if (!emailNormalizado || !emailNormalizado.includes("@")) {
    return { ok: false, erro: "Informe um e-mail valido." };
  }

  try {
    // Em alguns cenarios o usuario pode existir no sistema (Firestore), mas ainda nao ter sido provisionado no Auth.
    // Tambem pode existir protecao contra enumeracao de e-mails, o que faz o reset "parecer" ok sem enviar nada.
    // Para evitar isso, garantimos que exista um cadastro no Auth antes de solicitar o reset.
    const metodos = await fetchSignInMethodsForEmail(auth, emailNormalizado);
    if (!Array.isArray(metodos) || metodos.length === 0) {
      const base = Math.random().toString(36).slice(2, 8);
      const senhaTmp = `Temp@${base}`;
      await garantirUsuarioAuth(emailNormalizado, senhaTmp);
    }

    await sendPasswordResetEmail(auth, emailNormalizado, {
      url: window.location.origin
    });
    return { ok: true };
  } catch (error) {
    const codigo = String(error?.code || "");
    if (codigo.includes("user-not-found")) {
      return { ok: false, erro: "E-mail nao encontrado para redefinicao." };
    }
    if (codigo.includes("too-many-requests")) {
      return { ok: false, erro: "Muitas tentativas. Tente novamente em alguns minutos." };
    }
    return { ok: false, erro: "Falha ao enviar e-mail de redefinicao." };
  }
}

export async function validarSenhaViaAuth(email, senha) {
  const emailNormalizado = String(email || "").trim().toLowerCase();
  const senhaNormalizada = String(senha || "");
  if (!emailNormalizado || !emailNormalizado.includes("@") || !senhaNormalizada) return false;

  try {
    const authSecundario = getAuthSecundario();
    await signInWithEmailAndPassword(authSecundario, emailNormalizado, senhaNormalizada);
    await signOut(authSecundario);
    return true;
  } catch {
    return false;
  }
}
