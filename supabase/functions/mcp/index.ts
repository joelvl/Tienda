// Supabase Edge Function: conector de Claude (servidor MCP) para consultar la tienda desde claude.ai.
// Consulta todo y solo puede corregir datos de prendas (ver corregir_prendas). Dirección: …/functions/v1/mcp. Para usarlo hay que entrar con un usuario de la tienda (ver acceso.ts).
//
// Secretos (los pone GitHub Actions): MCP_CLAVE (firma los permisos) y MCP_LOGIN_URL (la página conectar.html).
// Supabase da solos SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.
// Habla MCP por HTTP (Streamable HTTP) respondiendo JSON, sin sesiones.

import { correr, datosParaFoto, INSTRUCCIONES, listaHerramientas, prepararCorrecciones, type Datos } from "./tienda.ts";
import { type Config, desafio, entrar, metadatosRecurso, metadatosServidor, permisoOk, registrar, token } from "./acceso.ts";

const URL_SB = Deno.env.get("SUPABASE_URL") ?? "";
const LLAVE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CFG: Config = {
  base: `${URL_SB}/functions/v1/mcp`,
  login: Deno.env.get("MCP_LOGIN_URL") || "https://joelvl.github.io/Tienda/conectar.html",
  clave: Deno.env.get("MCP_CLAVE") ?? "",
  urlSb: URL_SB,
  llavePublica: Deno.env.get("SUPABASE_ANON_KEY") || LLAVE,
  llaveServicio: LLAVE,
};
const VERSIONES = ["2025-06-18", "2025-03-26", "2024-11-05"];

const camel = (k: string) => k.replace(/_([a-z])/g, (_, m) => m.toUpperCase());
const deFila = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), v]));

// Lee una tabla completa (de mil en mil), sin las fotos
async function tabla(nombre: string, columnas = "*") {
  const filas: Record<string, unknown>[] = [];
  const h: Record<string, string> = { apikey: LLAVE };
  if (LLAVE.startsWith("eyJ")) h.Authorization = `Bearer ${LLAVE}`;
  for (let desde = 0; ; desde += 1000) {
    const r = await fetch(`${URL_SB}/rest/v1/${nombre}?select=${columnas}`, { headers: { ...h, Range: `${desde}-${desde + 999}` } });
    if (!r.ok) throw new Error(`${nombre}: ${r.status} ${await r.text()}`);
    const lote = await r.json();
    filas.push(...lote.map(deFila));
    if (lote.length < 1000) break;
  }
  return filas;
}
let cache: { t: number; datos: Datos } | null = null;
async function cargar(): Promise<Datos> {
  if (cache && Date.now() - cache.t < 30000) return cache.datos;
  const sinFoto = "id,codigo,tipo,descripcion,talla,color,compra_id,costo,costo_fijo,precio,estado,creada,impresa,precio_venta,fecha_venta,venta_id,cliente_tel,genero,apartado_id,descuento";
  const [prendas, compras, tiendas, clientes, apartados, abonos, config] = await Promise.all([
    tabla("prendas", sinFoto), tabla("compras"), tabla("tiendas"), tabla("clientes"), tabla("apartados"), tabla("abonos"), tabla("config"),
  ]);
  const datos = { prendas, compras, tiendas, clientes, apartados, abonos, config: config[0] ?? {} } as Datos;
  cache = { t: Date.now(), datos };
  return datos;
}

const cabeceras = () => { const h: Record<string, string> = { apikey: LLAVE, "Content-Type": "application/json" }; if (LLAVE.startsWith("eyJ")) h.Authorization = `Bearer ${LLAVE}`; return h; };

// Fotos de las prendas (miniaturas JPEG guardadas en la tabla), para que Claude las mire
async function verFotos(args: Record<string, any>) {
  const codigos = (Array.isArray(args.codigos) ? args.codigos : []).slice(0, 6).map((c: unknown) => { const t = String(c ?? "").trim(); return /^\d{1,6}$/.test(t) ? t.padStart(6, "0") : t; });
  if (!codigos.length) return [{ type: "text", text: "Diga los códigos de las prendas." }];
  const r = await fetch(`${URL_SB}/rest/v1/prendas?select=codigo,foto&codigo=in.(${codigos.map(encodeURIComponent).join(",")})`, { headers: cabeceras() });
  if (!r.ok) throw new Error(`fotos: ${r.status}`);
  const fotos = new Map((await r.json()).map((x: { codigo: string; foto: string }) => [x.codigo, x.foto]));
  const datos = await cargar(), salida: unknown[] = [];
  for (const c of codigos) {
    const p = datos.prendas.find((x) => x.codigo === c);
    if (!p) { salida.push({ type: "text", text: `${c}: no existe esa prenda.` }); continue; }
    salida.push({ type: "text", text: JSON.stringify(datosParaFoto(p, datos)) });
    const f = String(fotos.get(c) ?? ""), m = f.match(/^data:(image\/[a-z]+);base64,(.+)$/);
    salida.push(m ? { type: "image", mimeType: m[1], data: m[2] } : { type: "text", text: `${c}: no tiene foto.` });
  }
  return salida;
}

// Corrige prendas: solo los campos permitidos, una por una, y dice qué cambió
async function corregir(args: Record<string, any>, quien: string) {
  const { listos, errores } = prepararCorrecciones(args, await cargar());
  const hechos: unknown[] = [];
  for (const x of listos) {
    const r = await fetch(`${URL_SB}/rest/v1/prendas?id=eq.${encodeURIComponent(x.id)}`, { method: "PATCH", headers: { ...cabeceras(), Prefer: "return=minimal" }, body: JSON.stringify(x.fila) });
    if (!r.ok) { errores.push(`${x.codigo}: no se pudo guardar (${r.status}).`); continue; }
    console.log(`corregir_prendas por ${quien}: ${x.codigo} ${JSON.stringify(x.antes)} -> ${JSON.stringify(x.despues)}`);
    hechos.push({ codigo: x.codigo, antes: x.antes, despues: x.despues });
  }
  cache = null;
  return {
    content: [{ type: "text", text: JSON.stringify({ corregidas: hechos.length, cambios: hechos, problemas: errores.length ? errores : undefined, nota: hechos.length ? "Los cambios ya se ven en la tienda." : "No se cambió nada." }, null, 1) }],
    isError: !hechos.length && errores.length > 0,
  };
}

type Pedido = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, any> };
async function atender(m: Pedido, quien = "") {
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: m.id, result });
  const mal = (code: number, message: string) => ({ jsonrpc: "2.0", id: m.id ?? null, error: { code, message } });
  switch (m.method) {
    case "initialize": {
      const pedida = m.params?.protocolVersion;
      return ok({
        protocolVersion: VERSIONES.includes(pedida) ? pedida : VERSIONES[0],
        capabilities: { tools: {} },
        serverInfo: { name: "mi-tienda", title: "Mi tienda", version: "1.0.0" },
        instructions: INSTRUCCIONES,
      });
    }
    case "ping": return ok({});
    case "tools/list": return ok({ tools: listaHerramientas() });
    case "tools/call": {
      const nombre = String(m.params?.name ?? ""), args = m.params?.arguments ?? {};
      try {
        if (nombre === "ver_fotos") return ok({ content: await verFotos(args) });
        if (nombre === "corregir_prendas") return ok(await corregir(args, quien));
        const r = correr(nombre, args, await cargar());
        return ok({ content: [{ type: "text", text: JSON.stringify(r, null, 1) }] });
      } catch (e) {
        console.error(e);
        return ok({ content: [{ type: "text", text: `No se pudo consultar: ${(e as Error).message}` }], isError: true });
      }
    }
    default: return m.id === undefined ? null : mal(-32601, `Método no disponible: ${m.method}`);
  }
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const enJson = (r: { status: number; json: unknown }, extra: Record<string, string> = {}) =>
  Response.json(r.json, { status: r.status, headers: { ...CORS, "Cache-Control": "no-store", ...extra } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (CFG.clave.length < 20) return new Response("Falta configurar MCP_CLAVE", { status: 503 });
  // Lo que viene después de /mcp en la dirección
  const partes = new URL(req.url).pathname.split("/").filter(Boolean);
  const ruta = "/" + partes.slice(partes.indexOf("mcp") + 1).join("/");

  if (req.method === "GET" && ruta.startsWith("/.well-known/oauth-protected-resource")) return enJson({ status: 200, json: metadatosRecurso(CFG) });
  if (req.method === "GET" && (ruta.startsWith("/.well-known/oauth-authorization-server") || ruta.startsWith("/.well-known/openid-configuration"))) return enJson({ status: 200, json: metadatosServidor(CFG) });
  if (req.method === "GET" && ruta === "/jwks") return enJson({ status: 200, json: { keys: [] } });
  if (req.method === "POST" && ruta === "/registrar") return enJson(registrar(await req.json().catch(() => ({}))));
  if (req.method === "POST" && ruta === "/entrar") return enJson(await entrar(CFG, await req.json().catch(() => ({}))));
  if (req.method === "POST" && ruta === "/token") return enJson(await token(CFG, new URLSearchParams(await req.text())));
  if (ruta !== "/") return new Response("No encontrado", { status: 404, headers: CORS });

  // MCP: solo con permiso (si no, Claude pide entrar con el usuario de la tienda)
  const permiso = await permisoOk(CFG, req);
  if (!permiso) return enJson({ status: 401, json: { error: "invalid_token", error_description: "Entre con su usuario de la tienda." } }, { "WWW-Authenticate": desafio(CFG) });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
  let cuerpo: Pedido | Pedido[];
  try { cuerpo = await req.json(); } catch { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } }, { status: 400 }); }
  const lista = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
  const respuestas = (await Promise.all(lista.map((x) => atender(x, String(permiso.email ?? permiso.sub ?? ""))))).filter((r) => r !== null);
  // Solo avisos (sin id): se aceptan sin respuesta
  if (!respuestas.length) return new Response(null, { status: 202, headers: CORS });
  return Response.json(Array.isArray(cuerpo) ? respuestas : respuestas[0], { headers: CORS });
});
