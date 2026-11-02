// Supabase Edge Function: reconoce la prenda de una foto con Claude
// (tipo y color con probabilidad, nombre corto y precio sugerido).
// La página le manda { prompt, imagen (JPEG en base64), preciso } y recibe el JSON.
//
// Secretos (los pone GitHub Actions): ANTHROPIC_API_KEY
// Opcionales: MODELO_RAPIDO, MODELO_PRECISO para cambiar de modelo sin tocar código.

const MODELO_RAPIDO = Deno.env.get("MODELO_RAPIDO") ?? "claude-haiku-4-5-20251001";
const MODELO_PRECISO = Deno.env.get("MODELO_PRECISO") ?? "claude-sonnet-5-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Solo usuarios con sesión iniciada (la llave pública "anon" no sirve para gastar IA).
function rolDelToken(req: Request): string | null {
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const parte = token.split(".")[1];
    if (!parte) return null;
    const b64 = parte.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parte.length / 4) * 4, "=");
    const datos = JSON.parse(atob(b64));
    return typeof datos.role === "string" ? datos.role : null;
  } catch {
    return null;
  }
}

type Bloque = { type: string; text?: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (rolDelToken(req) !== "authenticated") return json({ error: "Inicie sesión para usar el reconocimiento." }, 401);

  const clave = Deno.env.get("ANTHROPIC_API_KEY");
  if (!clave) return json({ error: "Falta el secreto ANTHROPIC_API_KEY en Supabase." }, 500);

  let entrada: { prompt?: unknown; imagen?: unknown; preciso?: unknown };
  try {
    entrada = await req.json();
  } catch {
    return json({ error: "Solicitud inválida" }, 400);
  }
  const { prompt, imagen, preciso } = entrada ?? {};
  if (typeof prompt !== "string" || prompt.length > 20000 || typeof imagen !== "string" || imagen.length > 6_000_000) {
    return json({ error: "Solicitud inválida" }, 400);
  }

  const respuesta = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": clave,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: preciso === true ? MODELO_PRECISO : MODELO_RAPIDO,
      max_tokens: 800,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imagen } },
          { type: "text", text: `${prompt}\n\nResponda únicamente con el objeto JSON, sin texto antes ni después.` },
        ],
      }],
    }),
  });

  if (!respuesta.ok) {
    console.error("Error de la API de Claude", respuesta.status, await respuesta.text());
    return json({ error: "El reconocimiento no está disponible en este momento." }, 502);
  }

  const datos = await respuesta.json() as { content?: Bloque[] };
  const texto = (datos.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  const ini = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (ini < 0 || fin <= ini) return json({ error: "La IA no devolvió datos." }, 502);
  try {
    return json(JSON.parse(texto.slice(ini, fin + 1)));
  } catch {
    return json({ error: "La IA devolvió datos con mal formato." }, 502);
  }
});
