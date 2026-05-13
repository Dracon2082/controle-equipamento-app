export const PLANOS = [
  {
    id: "PLANO_1",
    nome: "Plano 1",
    valor: 349,
    limiteGestores: 2,
    limiteAdmins: 8,
    limiteOperadores: 50
  },
  {
    id: "PLANO_2",
    nome: "Plano 2",
    valor: 499,
    limiteGestores: 2,
    limiteAdmins: 11,
    limiteOperadores: 80
  },
  {
    id: "PLANO_600",
    nome: "Plano 3",
    valor: 699,
    limiteGestores: 2,
    limiteAdmins: 16,
    limiteOperadores: 120
  },
  {
    id: "PLANO_4",
    nome: "Plano 4",
    valor: 899,
    limiteGestores: 2,
    limiteAdmins: 21,
    limiteOperadores: null
  }
];

export const PLANO_TESTE_10D = {
  id: "TESTE_10D",
  nome: "Teste 10 dias",
  valor: 0,
  limiteGestores: 2,
  limiteAdmins: 4,
  limiteOperadores: 10,
  dias: 10
};

export const LIMITES_PADRAO_PLANO = {
  gestores: 2,
  admins: 3,
  operadores: 20
};

export const obterPlanoPorId = (planoId) => {
  const pid = String(planoId || "").trim();
  if (!pid) return null;
  if (pid === PLANO_TESTE_10D.id) return PLANO_TESTE_10D;
  return PLANOS.find((p) => String(p.id) === pid || String(p.nome) === pid) || null;
};

export const descreverPlano = (plano) => {
  const qtdGestores = Number(plano?.limiteGestores || 0);
  const textoGestores = `${qtdGestores} ${qtdGestores === 1 ? "Gestor" : "Gestores"}`;
  return `${textoGestores}, ${plano?.limiteAdmins} ADM, ${
    plano?.limiteOperadores === null ? "Operadores ilimitados" : `${plano?.limiteOperadores} Operadores`
  }`;
};

export const obterLimitesPlanoCliente = (cliente) => {
  const planoBase = obterPlanoPorId(cliente?.planoId || cliente?.planoNome);
  const limiteGestoresBase = Number(planoBase?.limiteGestores || LIMITES_PADRAO_PLANO.gestores);
  const limiteAdminsBase = Number(planoBase?.limiteAdmins || LIMITES_PADRAO_PLANO.admins);
  const limiteOperadoresBase = planoBase?.limiteOperadores ?? LIMITES_PADRAO_PLANO.operadores;

  const limiteGestoresSalvo = Number(cliente?.limiteGestoresPlano || 0);
  const limiteAdminsSalvo = Number(cliente?.limiteAdminsPlano || 0);
  const limiteOperadoresSalvo = cliente?.limiteOperadoresPlano;

  const limiteGestores = Math.max(limiteGestoresBase, limiteGestoresSalvo || 0, LIMITES_PADRAO_PLANO.gestores);
  const limiteAdmins = Math.max(limiteAdminsBase, limiteAdminsSalvo || 0, LIMITES_PADRAO_PLANO.admins);

  let limiteOperadores = limiteOperadoresBase;
  if (limiteOperadoresSalvo === null || limiteOperadoresBase === null) {
    limiteOperadores = null;
  } else {
    limiteOperadores = Math.max(Number(limiteOperadoresBase || 0), Number(limiteOperadoresSalvo || 0), LIMITES_PADRAO_PLANO.operadores);
  }

  const maxUsuariosNoPlano =
    limiteOperadores === null ? 0 : limiteGestores + limiteAdmins + Number(limiteOperadores || 0);

  return {
    planoBase,
    limiteGestores,
    limiteAdmins,
    limiteOperadores,
    maxUsuariosNoPlano
  };
};
