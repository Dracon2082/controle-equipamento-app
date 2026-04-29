import { getStorage } from "firebase/storage";
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDb7IU3LuwPjym0ixcobYXl8srqe3sXjos",
  authDomain: "controle-de-equipamentos-f2450.firebaseapp.com",
  projectId: "controle-de-equipamentos-f2450",
  storageBucket: "controle-de-equipamentos-f2450.firebasestorage.app",
  messagingSenderId: "548609308894",
  appId: "1:548609308894:web:2797008b308182446aaa4f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);

export { db, storage, auth, firebaseConfig };
