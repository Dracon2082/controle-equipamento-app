const TENANT_STORAGE_KEY = "tenantId";

const normalizarTenant = (valor) =>
  String(valor || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");

export function getTenantId() {
  const existente = normalizarTenant(localStorage.getItem(TENANT_STORAGE_KEY));
  if (existente) return existente;

  const padrao = "tenant_local";
  localStorage.setItem(TENANT_STORAGE_KEY, padrao);
  return padrao;
}

export function setTenantId(valor) {
  const tenant = normalizarTenant(valor) || "tenant_local";
  localStorage.setItem(TENANT_STORAGE_KEY, tenant);
  return tenant;
}

export function belongsToTenant(item, tenantId = getTenantId()) {
  const tenantItem = normalizarTenant(item?.tenantId);
  const tenantAtual = normalizarTenant(tenantId) || "tenant_local";

  // Registros legados (sem tenantId) so aparecem no tenant local.
  // Isso evita vazamento de dados antigos para tenants de clientes reais.
  if (!tenantItem) return tenantAtual === "tenant_local";

  return tenantItem === tenantAtual;
}

export function withTenant(payload, tenantId = getTenantId()) {
  return {
    ...payload,
    tenantId: normalizarTenant(tenantId) || "tenant_local"
  };
}

export function getConfigDocId(tenantId = getTenantId()) {
  return `empresaSistema_${normalizarTenant(tenantId) || "tenant_local"}`;
}

export function getLogoPath(tenantId = getTenantId()) {
  return `logos/${normalizarTenant(tenantId) || "tenant_local"}/empresaSistema.png`;
}
