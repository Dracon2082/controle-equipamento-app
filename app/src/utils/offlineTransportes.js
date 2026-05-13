const DB_NAME = "controle-equipamento-offline-transportes";
const DB_VERSION = 1;
const STORE_NAME = "transportesPendentes";
const FALLBACK_KEY = "transportesPendentesOffline";

function gerarIdOffline() {
  return `offline-transporte-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function possuiIndexedDb() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function lerFallback() {
  try {
    return JSON.parse(localStorage.getItem(FALLBACK_KEY) || "[]");
  } catch {
    return [];
  }
}

function salvarFallback(itens) {
  localStorage.setItem(FALLBACK_KEY, JSON.stringify(itens));
}

function abrirBanco() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error("Falha ao abrir banco offline de transportes."));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("tenantId", "tenantId", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }
    };
  });
}

export async function listarTransportesPendentes(tenantId) {
  if (!possuiIndexedDb()) {
    return lerFallback()
      .filter((item) => !tenantId || item.tenantId === tenantId)
      .sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")));
  }

  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onerror = () => {
      db.close();
      reject(request.error || new Error("Falha ao listar pendencias de transporte."));
    };
    request.onsuccess = () => {
      const itens = (request.result || [])
        .filter((item) => !tenantId || item.tenantId === tenantId)
        .sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")));
      db.close();
      resolve(itens);
    };
  });
}

export async function salvarTransportePendente(payload, tenantId) {
  const registro = {
    id: gerarIdOffline(),
    tenantId,
    tipo: "transporte",
    status: "pendente",
    criadoEm: new Date().toISOString(),
    ultimaTentativaEm: null,
    ultimoErro: "",
    payload
  };

  if (!possuiIndexedDb()) {
    const itens = lerFallback();
    itens.push(registro);
    salvarFallback(itens);
    return registro;
  }

  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(registro);
    request.onerror = () => {
      db.close();
      reject(request.error || new Error("Falha ao salvar pendencia de transporte."));
    };
    request.onsuccess = () => {
      db.close();
      resolve(registro);
    };
  });
}

export async function atualizarTransportePendente(id, updates) {
  if (!possuiIndexedDb()) {
    const itens = lerFallback();
    const atualizados = itens.map((item) => (item.id === id ? { ...item, ...updates } : item));
    salvarFallback(atualizados);
    return atualizados.find((item) => item.id === id) || null;
  }

  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const getRequest = store.get(id);
    getRequest.onerror = () => {
      db.close();
      reject(getRequest.error || new Error("Falha ao atualizar pendencia de transporte."));
    };
    getRequest.onsuccess = () => {
      const atual = getRequest.result;
      if (!atual) {
        db.close();
        resolve(null);
        return;
      }
      const proximo = { ...atual, ...updates };
      const putRequest = store.put(proximo);
      putRequest.onerror = () => {
        db.close();
        reject(putRequest.error || new Error("Falha ao gravar atualizacao do transporte offline."));
      };
      putRequest.onsuccess = () => {
        db.close();
        resolve(proximo);
      };
    };
  });
}

export async function removerTransportePendente(id) {
  if (!possuiIndexedDb()) {
    salvarFallback(lerFallback().filter((item) => item.id !== id));
    return;
  }

  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onerror = () => {
      db.close();
      reject(request.error || new Error("Falha ao remover pendencia de transporte."));
    };
    request.onsuccess = () => {
      db.close();
      resolve();
    };
  });
}
