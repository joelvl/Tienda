// Sube una carpeta de fotos como prendas nuevas de una compra, desde la Mac.
// La IA de la tienda saca de cada foto el tipo, color, nombre, talla y el precio impreso.
//
// Uso (en la terminal, desde la carpeta del proyecto):
//   node scripts/cargar-fotos.mjs "/ruta/a/las/fotos"            pide usuario y contraseña, y sube
//   node scripts/cargar-fotos.mjs "/ruta/a/las/fotos" --prueba   solo revisa las fotos, no sube nada
// Opciones:
//   --compra "nombre"   la compra a la que se cargan (por defecto, la primera que registró)
//   --precio-uno        ponerles ₡1 a todas en lugar del precio de la foto
//   --preciso           usar el modelo preciso de la IA (más lento)
//   --sitio URL         dirección de la tienda publicada (por defecto https://joelvl.github.io/Tienda/)
//
// Si se corta, se puede volver a correr: las fotos ya subidas quedan anotadas en
// .carga-tienda.json dentro de la carpeta de fotos y no se repiten.
// Necesita macOS (usa "sips" para achicar las fotos).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const opcion = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const carpeta = args.find((a, i) => !a.startsWith("--") && !["--compra", "--sitio"].includes(args[i - 1]));
const prueba = args.includes("--prueba"), precioUno = args.includes("--precio-uno"), preciso = args.includes("--preciso");
const sitio = opcion("--sitio") || "https://joelvl.github.io/Tienda/";
if (!carpeta || !existsSync(carpeta)) { console.error('Uso: node scripts/cargar-fotos.mjs "/ruta/a/las/fotos" [--prueba] [--compra "nombre"] [--precio-uno]'); process.exit(1); }

// Tipos y colores: los mismos de la página, leídos de index.html para no repetirlos aquí
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const lista = nombre => new Function(`return ${html.match(new RegExp(`const ${nombre} = (\\[[\\s\\S]*?\\]);\\n`))[1]}`)();
const TIPOS = lista("TIPOS");
const COLORES = lista("COLORES").map(c => c[0]);
const normal = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const elegir = (v, validos) => validos.find(t => normal(t) === normal(v));

const fotos = readdirSync(carpeta).filter(f => /\.(jpe?g|png|heic|webp)$/i.test(f)).sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
const anotadas = join(carpeta, ".carga-tienda.json");
const hechas = existsSync(anotadas) ? JSON.parse(readFileSync(anotadas, "utf8")) : {};
const pendientes = fotos.filter(f => !hechas[f]);
console.log(`${fotos.length} fotos en la carpeta; ${fotos.length - pendientes.length} ya subidas; ${pendientes.length} por subir.`);
if (!pendientes.length) process.exit(0);

// Achica con sips: 1024 px para la IA y 280 px para la miniatura que guarda la tienda (igual que la página)
const tmp = mkdtempSync(join(tmpdir(), "carga-tienda-"));
function jpeg(archivo, max, calidad) {
  const out = join(tmp, `${max}.jpg`);
  execFileSync("sips", ["-Z", String(max), "-s", "format", "jpeg", "-s", "formatOptions", String(calidad), join(carpeta, archivo), "--out", out], { stdio: "ignore" });
  return readFileSync(out).toString("base64");
}

if (prueba) {
  for (const f of pendientes) {
    const g = jpeg(f, 1024, 82), m = jpeg(f, 280, 60);
    console.log(`  ${f}: IA ${Math.round(g.length * 0.75 / 1024)} KB, miniatura ${Math.round(m.length * 0.75 / 1024)} KB`);
  }
  rmSync(tmp, { recursive: true, force: true });
  console.log("Prueba lista. No se subió nada.");
  process.exit(0);
}

// ---------- Conexión con la tienda ----------
let cfg = process.env.SUPABASE_URL && (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY)
  ? { supabaseUrl: process.env.SUPABASE_URL, supabaseAnonKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY }
  : null;
if (!cfg) {
  const pagina = await (await fetch(sitio)).text();
  const m = pagina.match(/window\.MI_TIENDA_CONFIG=(\{.*?\});/);
  if (!m) { console.error(`No encontré la configuración en ${sitio}`); process.exit(1); }
  cfg = JSON.parse(m[1]);
}
const URL_SB = cfg.supabaseUrl, LLAVE = cfg.supabaseAnonKey;

function preguntar(texto, oculto) {
  return new Promise(res => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (oculto) rl._writeToOutput = s => { if (s.includes(texto)) process.stdout.write(texto); };
    rl.question(texto, r => { rl.close(); if (oculto) process.stdout.write("\n"); res(r.trim()); });
  });
}
const usuario = await preguntar("Usuario de la tienda (ej. mama): ");
const clave = await preguntar("Contraseña: ", true);
const correo = usuario.includes("@") ? usuario.toLowerCase() : `${usuario.toLowerCase().replace(/[^a-z0-9._-]/g, "")}@${cfg.dominioUsuarios || "mitienda.app"}`;
const sesion = await (await fetch(`${URL_SB}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: LLAVE, "Content-Type": "application/json" }, body: JSON.stringify({ email: correo, password: clave }),
})).json();
if (!sesion.access_token) { console.error("No se pudo entrar:", sesion.error_description || sesion.msg || "revise usuario y contraseña"); process.exit(1); }
const H = { apikey: LLAVE, Authorization: `Bearer ${sesion.access_token}`, "Content-Type": "application/json" };
// Toda llamada tiene tiempo límite: sin él, una respuesta que nunca llega deja el script esperando para siempre.
async function api(ruta, opciones = {}, segundos = 30) {
  const r = await fetch(`${URL_SB}${ruta}`, { ...opciones, headers: { ...H, ...(opciones.headers || {}) }, signal: AbortSignal.timeout(segundos * 1000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${ruta}: ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

// ---------- La compra ----------
const compras = await api("/rest/v1/compras?select=id,nombre,costo,cantidad,fecha&order=fecha.asc");
if (!compras.length) { console.error("No hay compras. Registre la compra en la tienda primero."); process.exit(1); }
const pedida = opcion("--compra");
const compra = pedida ? compras.find(c => normal(c.nombre) === normal(pedida)) || compras.find(c => normal(c.nombre).includes(normal(pedida))) : compras[0];
if (!compra) { console.error(`No hay una compra "${pedida}". Compras: ${compras.map(c => c.nombre).join(", ")}`); process.exit(1); }
const yaTiene = (await api(`/rest/v1/prendas?select=id&compra_id=eq.${encodeURIComponent(compra.id)}`)).length;
console.log(`\nCompra: «${compra.nombre}» del ${new Date(Number(compra.fecha)).toLocaleDateString("es-CR")} (ya tiene ${yaTiene} prendas).`);
console.log(`Se van a subir ${pendientes.length} prendas, ${precioUno ? "todas a ₡1" : "con el precio de la foto (₡1 si no trae)"}.`);
if (!/^s/i.test(await preguntar("¿Seguir? (s/n): "))) { console.log("No se subió nada."); process.exit(0); }

// Costo por prenda como en la página: fijo si la compra tiene cantidad; si no, se reparte entre todas
const costoPrenda = () => compra.cantidad > 0 ? Math.round(compra.costo / compra.cantidad) : Math.round(compra.costo / Math.max(1, yaTiene + pendientes.length));

const PROMPT = `Usted ayuda a una tienda de ropa en Costa Rica. La foto es de catálogo y muestra UNA prenda (a veces en varias vistas: frente, espalda, detalle). Suele traer impresos la talla y el precio.
Responda solo con un objeto JSON con estas claves:
"tipo": exactamente uno de ${JSON.stringify(TIPOS)}. "Enterizo" es de una sola pieza que une arriba con pantalón o short (mono, jumpsuit, romper). "Conjunto" son dos piezas que hacen juego (top con short, pantalón o enagua). En Costa Rica la falda se dice "Enagua". "Saco" incluye chaquetas, blazers y abrigos; un traje de saco y pantalón es "Conjunto".
"color": el color principal, exactamente uno de ${JSON.stringify(COLORES)}. Use "Estampado" si tiene diseño o muchos colores.
"descripcion": nombre corto en español para la etiqueta, máximo 4 palabras, sin talla ni precio (ej. "Vestido largo de lentejuelas", "Enterizo negro manga larga").
"talla": la talla impresa en la foto (ej. "M", "XL", "2XL" escríbalo "XXL"). Si trae varias, júntelas con "/" (ej. "S/M"). Si no trae, null.
"precio": el precio impreso en la foto, como número entero de colones (₡12.900 → 12900). Si no trae, null.`;

let creada = Date.now(), n = 0, fallas = 0, seguidas = 0;
for (const f of pendientes) {
  n++;
  try {
    // Si la IA no contesta, la foto no se sube: se reintenta al volver a correr el script
    const cuerpo = JSON.stringify({ prompt: PROMPT, imagen: jpeg(f, 1024, 82), preciso });
    let ia = null;
    for (let intento = 1; intento <= 2 && !ia; intento++) {
      process.stdout.write(`  ${n}/${pendientes.length}  leyendo la foto…\r`);
      ia = await api("/functions/v1/clasificar", { method: "POST", body: cuerpo }, 90).catch(e => { console.warn(`  ${n}/${pendientes.length}  la IA no contestó (${e.name === "TimeoutError" ? "tardó demasiado" : e.message})`); return null; });
    }
    if (!ia || ia.error) throw new Error(ia && ia.error ? ia.error : "sin respuesta de la IA");
    const tipo = elegir(ia.tipo, TIPOS) || "Otro";
    const precioFoto = Math.round(Number(ia.precio));
    const p = {
      id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      codigo: await api("/rest/v1/rpc/siguiente_codigo", { method: "POST", body: "{}" }),
      tipo,
      descripcion: String(ia.descripcion || tipo).trim().split(/\s+/).slice(0, 6).join(" ").slice(0, 60),
      talla: ia.talla ? String(ia.talla).trim().toUpperCase().replace(/^2XL$/, "XXL").slice(0, 20) : "",
      color: elegir(ia.color, COLORES) || "",
      compra_id: compra.id, costo: costoPrenda(), costo_fijo: false,
      precio: !precioUno && precioFoto >= 100 && precioFoto <= 500000 ? precioFoto : 1,
      estado: "disponible", creada: creada++, foto: `data:image/jpeg;base64,${jpeg(f, 280, 60)}`, impresa: false,
    };
    await api("/rest/v1/prendas", { method: "POST", body: JSON.stringify(p), headers: { Prefer: "return=minimal" } });
    hechas[f] = p.codigo;
    writeFileSync(anotadas, JSON.stringify(hechas, null, 1));
    seguidas = 0;
    console.log(`  ${n}/${pendientes.length}  ${p.codigo}  ${p.descripcion}${p.talla ? `, talla ${p.talla}` : ""}, ${p.color || "sin color"}, ₡${p.precio}`);
  } catch (e) {
    fallas++;
    console.error(`  ${n}/${pendientes.length}  ${f}: no se pudo subir (${e.message})`);
    if (++seguidas >= 3) { console.error("\nTres fotos seguidas fallaron: paro aquí. Revise el internet o el reconocimiento de fotos en la app y vuelva a correr el comando."); break; }
  }
}
rmSync(tmp, { recursive: true, force: true });
console.log(`\nListo: ${n - fallas} prendas subidas a «${compra.nombre}».${fallas ? ` ${fallas} fallaron: vuelva a correr el mismo comando para reintentarlas.` : ""}`);
