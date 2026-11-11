// API do Espelho de Viagem — guarda no Upstash Redis:
//   pe_vet / pe_vd   → pedidos especiais (reentrega, promocional…) por nota fiscal
//   man_vet / man_vd → entregas manuais adicionadas nas rotas (por data + número da rota)
// GET    /api/espelho?ns=pe_vet                 → { campo: valor, ... }
// POST   /api/espelho  { ns, campo, valor }     → grava
// DELETE /api/espelho  { ns, campo }            → apaga
// Usa as variáveis criadas pela integração Upstash na Vercel (KV_REST_API_* ou UPSTASH_REDIS_REST_*).

const URL_REDIS = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const NAMESPACES = ["pe_vet", "pe_vd", "man_vet", "man_vd", "esp"];   // esp = Entregas Especiais

async function redis(cmd) {
  const r = await fetch(URL_REDIS, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || `Upstash ${r.status}`);
  return j.result;
}

function lerCorpo(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!URL_REDIS || !TOKEN) return res.status(500).json({ erro: "Upstash não configurado na Vercel" });

  const corpo = req.method === "GET" ? {} : lerCorpo(req);
  const ns = String((req.query && req.query.ns) || corpo.ns || "");
  if (!NAMESPACES.includes(ns)) return res.status(400).json({ erro: "ns inválido" });
  const chave = `espelho:${ns}`;

  try {
    if (req.method === "GET") {
      const plano = (await redis(["HGETALL", chave])) || [];
      const obj = {};
      for (let i = 0; i < plano.length; i += 2) {
        try { obj[plano[i]] = JSON.parse(plano[i + 1]); } catch { obj[plano[i]] = plano[i + 1]; }
      }
      return res.status(200).json(obj);
    }
    const campo = String(corpo.campo || "").slice(0, 200);
    if (!campo) return res.status(400).json({ erro: "campo obrigatório" });
    if (req.method === "POST") {
      const valor = JSON.stringify(corpo.valor ?? null);
      if (valor.length > 100000) return res.status(413).json({ erro: "valor muito grande" });
      await redis(["HSET", chave, campo, valor]);
      return res.status(200).json({ ok: true });
    }
    if (req.method === "DELETE") {
      await redis(["HDEL", chave, campo]);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ erro: "método não permitido" });
  } catch (e) {
    return res.status(502).json({ erro: String(e.message || e) });
  }
};
