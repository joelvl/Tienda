// Crea un usuario de la tienda (usuario + contraseña) en Supabase.
// Uso:
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/crear-usuario.mjs mama MiClave123
// La llave "service_role" está en Supabase > Project Settings > API keys. No la suba a GitHub.
const [usuario, clave] = process.argv.slice(2);
const url = process.env.SUPABASE_URL;
const llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dominio = process.env.DOMINIO_USUARIOS || "mitienda.app";

if (!usuario || !clave || !url || !llave) {
  console.error("Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/crear-usuario.mjs <usuario> <contraseña>");
  process.exit(1);
}
if (clave.length < 6) {
  console.error("La contraseña debe tener al menos 6 caracteres.");
  process.exit(1);
}
const email = usuario.includes("@") ? usuario.toLowerCase() : `${usuario.toLowerCase().replace(/[^a-z0-9._-]/g, "")}@${dominio}`;
const r = await fetch(`${url}/auth/v1/admin/users`, {
  method: "POST",
  headers: { apikey: llave, Authorization: `Bearer ${llave}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: clave, email_confirm: true }),
});
const datos = await r.json().catch(() => ({}));
if (!r.ok) {
  console.error("No se pudo crear el usuario:", datos.msg || datos.message || r.status);
  process.exit(1);
}
console.log(`Usuario creado. Entra con el usuario "${usuario}" (correo interno ${email}).`);
