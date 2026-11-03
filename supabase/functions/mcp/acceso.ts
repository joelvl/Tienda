// Login del conector de Claude (OAuth 2.1 con PKCE, como pide MCP).
// Claude abre conectar.html (en GitHub Pages), la persona entra con su usuario de la tienda,
// y aquí se revisa la contraseña con Supabase y se le da a Claude un permiso temporal.
// No se guarda nada: los códigos y permisos van firmados con MCP_CLAVE y vencen solos.

export type Config = { base: string; login: string; clave: string; urlSb: string; llavePublica: string; llaveServicio: string };

const enc = new TextEncoder();
const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64url = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));

async function hmac(clave: string, texto: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(clave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", k, enc.encode(texto)));
}
function iguales(a: string, b: string) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
export async function firmar(cfg: Config, datos: Record<string, unknown>, segundos: number) {
  const cuerpo = b64url(enc.encode(JSON.stringify({ ...datos, exp: Math.floor(Date.now() / 1000) + segundos })));
  return `${cuerpo}.${await hmac(cfg.clave, cuerpo)}`;
}
export async function leer(cfg: Config, token: string, tipo: string): Promise<Record<string, any> | null> {
  const [cuerpo, firma] = String(token || "").split(".");
  if (!cuerpo || !firma || !iguales(firma, await hmac(cfg.clave, cuerpo))) return null;
  try {
    const d = JSON.parse(deB64url(cuerpo));
    return d.typ === tipo && d.exp > Date.now() / 1000 ? d : null;
  } catch { return null; }
}

// Solo se le entregan permisos a Claude (y a una prueba local en esta computadora)
export function retornoOk(uri: string) {
  try {
    const u = new URL(uri);
    if (u.protocol === "https:" && ["claude.ai", "claude.com"].includes(u.hostname) && u.pathname === "/api/mcp/auth_callback") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname);
  } catch { return false; }
}
async function pkceOk(verificador: string, reto: string) {
  if (!verificador || !reto) return false;
  return iguales(b64url(await crypto.subtle.digest("SHA-256", enc.encode(verificador))), reto);
}

// ---------- descubrimiento ----------
export function metadatosRecurso(cfg: Config) {
  return { resource: cfg.base, authorization_servers: [cfg.base], bearer_methods_supported: ["header"], scopes_supported: ["tienda"], resource_name: "Mi tienda" };
}
export function metadatosServidor(cfg: Config) {
  return {
    issuer: cfg.base,
    authorization_endpoint: cfg.login,
    token_endpoint: `${cfg.base}/token`,
    registration_endpoint: `${cfg.base}/registrar`,
    jwks_uri: `${cfg.base}/jwks`,
    scopes_supported: ["tienda"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  };
}
export function desafio(cfg: Config) {
  return `Bearer resource_metadata="${cfg.base}/.well-known/oauth-protected-resource", scope="tienda"`;
}

// ---------- registro del cliente (Claude se registra solo) ----------
export function registrar(cuerpo: Record<string, any>) {
  const uris: string[] = Array.isArray(cuerpo?.redirect_uris) ? cuerpo.redirect_uris : [];
  if (!uris.length || !uris.every(retornoOk)) return { status: 400, json: { error: "invalid_redirect_uri", error_description: "Solo Claude puede conectarse." } };
  return {
    status: 201,
    json: {
      client_id: "claude-" + crypto.randomUUID(), client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: cuerpo.client_name ?? "Claude", redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none",
    },
  };
}

// ---------- login (lo llama conectar.html) ----------
export async function entrar(cfg: Config, c: Record<string, any>) {
  if (c.response_type && c.response_type !== "code") return { status: 400, json: { error: "Este tipo de conexión no se puede usar." } };
  if (!retornoOk(c.redirect_uri)) return { status: 400, json: { error: "Este enlace no es de Claude. Vuelva a conectar desde Claude." } };
  if (!c.code_challenge || (c.code_challenge_method ?? "S256") !== "S256") return { status: 400, json: { error: "Falta un dato de seguridad. Vuelva a conectar desde Claude." } };
  const r = await fetch(`${cfg.urlSb}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: cfg.llavePublica, "Content-Type": "application/json" },
    body: JSON.stringify({ email: String(c.email ?? ""), password: String(c.password ?? "") }),
  });
  if (!r.ok) return { status: 401, json: { error: r.status === 429 ? "Demasiados intentos. Espere unos minutos." : "Usuario o contraseña incorrectos." } };
  const u = (await r.json()).user;
  const codigo = await firmar(cfg, { typ: "codigo", sub: u.id, email: u.email, cid: c.client_id ?? "", ru: c.redirect_uri, cc: c.code_challenge }, 300);
  const destino = new URL(c.redirect_uri);
  destino.searchParams.set("code", codigo);
  if (c.state) destino.searchParams.set("state", c.state);
  return { status: 200, json: { redirect: destino.href } };
}

// ---------- permisos ----------
const UNA_HORA = 3600, UN_MES = 30 * 86400;
async function emitir(cfg: Config, sub: string, email: string) {
  return {
    access_token: await firmar(cfg, { typ: "acceso", sub, email }, UNA_HORA),
    token_type: "Bearer", expires_in: UNA_HORA, scope: "tienda",
    refresh_token: await firmar(cfg, { typ: "refresco", sub, email }, UN_MES),
  };
}
// Si la borran o la bloquean en Supabase, Claude pierde el acceso al renovar el permiso
async function usuarioActivo(cfg: Config, sub: string) {
  const h: Record<string, string> = { apikey: cfg.llaveServicio };
  if (cfg.llaveServicio.startsWith("eyJ")) h.Authorization = `Bearer ${cfg.llaveServicio}`;
  const r = await fetch(`${cfg.urlSb}/auth/v1/admin/users/${encodeURIComponent(sub)}`, { headers: h });
  if (!r.ok) return false;
  const u = await r.json();
  return !(u.banned_until && Date.parse(u.banned_until) > Date.now());
}
export async function token(cfg: Config, p: URLSearchParams) {
  const mal = (error: string, error_description: string) => ({ status: 400, json: { error, error_description } });
  if (p.get("grant_type") === "authorization_code") {
    const c = await leer(cfg, p.get("code") ?? "", "codigo");
    if (!c) return mal("invalid_grant", "El código venció. Vuelva a conectar.");
    if (p.get("redirect_uri") && p.get("redirect_uri") !== c.ru) return mal("invalid_grant", "Dirección de retorno distinta.");
    if (c.cid && p.get("client_id") && p.get("client_id") !== c.cid) return mal("invalid_grant", "Cliente distinto.");
    if (!(await pkceOk(p.get("code_verifier") ?? "", c.cc))) return mal("invalid_grant", "Verificación PKCE fallida.");
    return { status: 200, json: await emitir(cfg, c.sub, c.email) };
  }
  if (p.get("grant_type") === "refresh_token") {
    const r = await leer(cfg, p.get("refresh_token") ?? "", "refresco");
    if (!r || !(await usuarioActivo(cfg, r.sub))) return mal("invalid_grant", "Vuelva a entrar con su usuario.");
    return { status: 200, json: await emitir(cfg, r.sub, r.email) };
  }
  return mal("unsupported_grant_type", "Tipo de permiso no soportado.");
}
export async function permisoOk(cfg: Config, req: Request) {
  const t = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  return t ? await leer(cfg, t, "acceso") : null;
}
