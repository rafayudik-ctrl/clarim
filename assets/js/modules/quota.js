// Estimativa da cota gratuita diária da YouTube Data API.
// A API não informa a cota restante; usamos o gasto registrado na última coleta.
// A cota renova à meia-noite no horário do Pacífico (America/Los_Angeles).

const PACIFIC = "America/Los_Angeles";

function pacificDay(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PACIFIC,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

/**
 * Retorna { remaining, limit, used, renewed } ou null se não houver dado.
 * `renewed` = a coleta foi em um dia anterior, então a cota já renovou.
 */
export function estimateQuota(quota, generatedAt, now = new Date()) {
  if (!quota || !Number.isFinite(quota.limit) || quota.limit < 1) return null;

  const generated = new Date(generatedAt);
  if (Number.isNaN(generated.getTime())) return null;

  const sameDay = pacificDay(generated) === pacificDay(now);
  const used = Math.min(Math.max(quota.used, 0), quota.limit);

  return sameDay
    ? { remaining: quota.limit - used, limit: quota.limit, used, renewed: false }
    : { remaining: quota.limit, limit: quota.limit, used: 0, renewed: true };
}

export function describeQuota(quota, generatedAt, now = new Date(), format = (n) => String(n)) {
  const e = estimateQuota(quota, generatedAt, now);
  if (!e) return "";

  const base =
    `Cota gratuita diária da API do YouTube: ${format(e.remaining)} de ${format(e.limit)} ` +
    "unidades restantes";

  return e.renewed
    ? `${base} (cota já renovada desde a última coleta; estimativa).`
    : `${base} (estimativa após a última coleta de hoje).`;
}
