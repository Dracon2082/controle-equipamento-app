import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

const MASTER_SESSION_KEY = "sessaoMaster";

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

export async function enviarResetSenhaMaster(email) {
  const emailNormalizado = String(email || "").trim().toLowerCase();
  if (!emailNormalizado) return { ok: false, erro: "Informe o e-mail." };
  try {
    await sendPasswordResetEmail(auth, emailNormalizado);
    return { ok: true };
  } catch (error) {
    const codigo = String(error?.code || "");
    if (codigo.includes("user-not-found")) return { ok: false, erro: "E-mail nao encontrado." };
    return { ok: false, erro: "Nao foi possivel enviar o e-mail de recuperacao. Verifique sua conexao." };
  }
}

export async function alterarSenhaMaster({ senhaAtual, novaSenha }) {
  const user = auth.currentUser;
  if (!user?.email) return { ok: false, erro: "Voce precisa estar logado para alterar a senha." };
  if (!senhaAtual || !novaSenha) return { ok: false, erro: "Informe a senha atual e a nova senha." };

  try {
    const cred = EmailAuthProvider.credential(user.email, String(senhaAtual));
    await reauthenticateWithCredential(user, cred);
    await updatePassword(user, String(novaSenha));
    return { ok: true };
  } catch (error) {
    const codigo = String(error?.code || "");
    if (codigo.includes("wrong-password") || codigo.includes("invalid-credential")) {
      return { ok: false, erro: "Senha atual invalida." };
    }
    if (codigo.includes("weak-password")) {
      return { ok: false, erro: "Senha fraca. Use uma senha mais forte." };
    }
    return { ok: false, erro: "Nao foi possivel alterar a senha agora. Tente novamente." };
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
