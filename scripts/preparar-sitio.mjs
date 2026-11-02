// Arma la carpeta dist/ que se publica en GitHub Pages.
// Inserta en index.html y catalogo.html la dirección de Supabase y la llave pública (publicable),
// más lo necesario para instalar la tienda en la pantalla de inicio del celular.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const url = process.env.SUPABASE_URL;
// La llave publicable (sb_publishable_...) o, en proyectos viejos, la llave anon.
const clave = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const dominio = process.env.DOMINIO_USUARIOS || "mitienda.app";
if (!url || !clave) {
  console.error("Faltan los secretos SUPABASE_URL y/o SUPABASE_PUBLISHABLE_KEY en GitHub.");
  process.exit(1);
}

const marca = "<!--MI_TIENDA_CONFIG-->";
let html = readFileSync("index.html", "utf8");
if (!html.includes(marca)) {
  console.error(`No se encontró ${marca} en index.html`);
  process.exit(1);
}
const config = JSON.stringify({ supabaseUrl: url, supabaseAnonKey: clave, dominioUsuarios: dominio }).replace(/</g, "\\u003c");
html = html.replace(marca, [
  `<script>window.MI_TIENDA_CONFIG=${config};</script>`,
  `<link rel="manifest" href="manifest.webmanifest">`,
  `<meta name="theme-color" content="#C92A62">`,
  `<link rel="icon" href="icono-192.png">`,
  `<link rel="apple-touch-icon" href="icono-180.png">`,
  `<meta name="apple-mobile-web-app-capable" content="yes">`,
  `<meta name="mobile-web-app-capable" content="yes">`,
  `<meta name="apple-mobile-web-app-title" content="Mi tienda">`,
].join("\n"));

mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", html);

// Catálogo para clientes: solo necesita la dirección y la llave pública.
let catalogo = readFileSync("catalogo.html", "utf8");
if (!catalogo.includes(marca)) {
  console.error(`No se encontró ${marca} en catalogo.html`);
  process.exit(1);
}
catalogo = catalogo.replace(marca, [
  `<script>window.MI_TIENDA_CONFIG=${JSON.stringify({ supabaseUrl: url, supabaseAnonKey: clave }).replace(/</g, "\\u003c")};</script>`,
  `<link rel="manifest" href="catalogo.webmanifest">`,
  `<meta name="theme-color" content="#C92A62">`,
  `<link rel="icon" href="icono-192.png">`,
  `<link rel="apple-touch-icon" href="icono-180.png">`,
  `<meta name="apple-mobile-web-app-capable" content="yes">`,
  `<meta name="mobile-web-app-capable" content="yes">`,
  `<meta name="apple-mobile-web-app-title" content="Catálogo">`,
].join("\n"));
writeFileSync("dist/catalogo.html", catalogo);
// Página de prueba de la impresora Bluetooth (no necesita configuración)
copyFileSync("impresora.html", "dist/impresora.html");
for (const f of ["manifest.webmanifest", "catalogo.webmanifest", "icono-180.png", "icono-192.png", "icono-512.png"]) {
  copyFileSync(`publico/${f}`, `dist/${f}`);
}
writeFileSync("dist/.nojekyll", "");
console.log("Sitio listo en dist/");
