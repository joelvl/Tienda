// Supabase Edge Function: conector de Claude (servidor MCP) para consultar la tienda desde claude.ai.
// Solo lee. Se conecta con la dirección …/functions/v1/mcp/<MCP_CLAVE>; sin la clave no responde.
//
// Secretos (los pone GitHub Actions): MCP_CLAVE. Supabase da solos SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.
// Habla MCP por HTTP (Streamable HTTP) respondiendo JSON, sin sesiones.

import { correr, INSTRUCCIONES, listaHerramientas, type Datos } from "./tienda.ts";

const CLAVE = Deno.env.get("MCP_CLAVE") ?? "";
const URL_SB = Deno.env.get("SUPABASE_URL") ?? "";
const LLAVE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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

// Compara la clave sin dar pistas por el tiempo que tarda
function claveOk(dada: string) {
  if (CLAVE.length < 20 || dada.length !== CLAVE.length) return false;
  let x = 0;
  for (let i = 0; i < CLAVE.length; i++) x |= CLAVE.charCodeAt(i) ^ dada.charCodeAt(i);
  return x === 0;
}

type Pedido = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, any> };
async function atender(m: Pedido) {
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
      const nombre = String(m.params?.name ?? "");
      try {
        const r = correr(nombre, m.params?.arguments ?? {}, await cargar());
        return ok({ content: [{ type: "text", text: JSON.stringify(r, null, 1) }] });
      } catch (e) {
        console.error(e);
        return ok({ content: [{ type: "text", text: `No se pudo consultar: ${(e as Error).message}` }], isError: true });
      }
    }
    default: return m.id === undefined ? null : mal(-32601, `Método no disponible: ${m.method}`);
  }
}

Deno.serve(async (req: Request) => {
  const partes = new URL(req.url).pathname.split("/").filter(Boolean);
  if (!claveOk(partes[partes.length - 1] ?? "")) return new Response("No encontrado", { status: 404 });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  let cuerpo: Pedido | Pedido[];
  try { cuerpo = await req.json(); } catch { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } }, { status: 400 }); }
  const lista = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
  const respuestas = (await Promise.all(lista.map(atender))).filter((r) => r !== null);
  // Solo avisos (sin id): se aceptan sin respuesta
  if (!respuestas.length) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(cuerpo) ? respuestas : respuestas[0]);
});
