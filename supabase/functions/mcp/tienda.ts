// Consultas de la tienda para el conector de Claude (MCP). Solo lee: no cambia nada.
// Hace las mismas cuentas que la app (costo de cada prenda, ganancia, pedidos y abonos).

const DIA = 86400000;
const CR = -6 * 3600000; // Costa Rica: UTC-6, sin horario de verano

type Fila = Record<string, any>;
export type Datos = { prendas: Fila[]; compras: Fila[]; tiendas: Fila[]; clientes: Fila[]; apartados: Fila[]; abonos: Fila[]; config: Fila };

// ---------- utilidades ----------
const num = (v: unknown) => Number(v) || 0;
const suma = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + (num(f(x))), 0);
const col = (n: number) => (n < 0 ? "-" : "") + "₡" + String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const normal = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const soloDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const inicioDia = (t: number) => Math.floor((t + CR) / DIA) * DIA - CR;
const fecha = (t: unknown) => t ? new Date(Number(t)).toLocaleDateString("es-CR", { timeZone: "America/Costa_Rica", weekday: "short", day: "numeric", month: "short", year: "numeric" }) : null;
const dias = (t: unknown, ahora: number) => t ? Math.max(0, Math.round((inicioDia(ahora) - inicioDia(Number(t))) / DIA)) : null;
const deFecha = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, (m || 1) - 1, d || 1) - CR; };

// ---------- cuentas (iguales a la app) ----------
export class Tienda {
  d: Datos; ahora: number;
  private cuenta = new Map<string, number>();
  constructor(d: Datos, ahora = Date.now()) {
    this.d = d; this.ahora = ahora;
    for (const p of d.prendas) if (p.compraId) this.cuenta.set(p.compraId, (this.cuenta.get(p.compraId) ?? 0) + 1);
  }
  compra(id: unknown) { return id ? this.d.compras.find((c) => c.id === id) : undefined; }
  tienda(id: unknown) { return id ? this.d.tiendas.find((t) => t.id === id) : undefined; }
  cliente(tel: unknown) { return tel ? this.d.clientes.find((c) => c.telefono === tel) : undefined; }
  costoUnidad(c: Fila) { const n = num(c.cantidad) > 0 ? num(c.cantidad) : Math.max(1, this.cuenta.get(c.id) ?? 0); return Math.round(num(c.costo) / n); }
  costo(p: Fila) { if (p.costoFijo) return num(p.costo); const c = this.compra(p.compraId); return c ? this.costoUnidad(c) : num(p.costo); }
  precioActual(p: Fila) { const d = num(p.descuento); return d > 0 ? Math.round(num(p.precio) * (100 - d) / 10000) * 100 : num(p.precio); }
  ganancia(p: Fila) { return num(p.precioVenta) - this.costo(p); }
  pct() { const v = this.d.config?.porcentajeApartado; return Math.min(100, Math.max(0, v == null ? 50 : num(v))); }
  pedido(a: Fila) {
    const abonos = this.d.abonos.filter((b) => b.apartadoId === a.id).sort((x, y) => x.fecha - y.fecha);
    const prendas = this.d.prendas.filter((p) => p.apartadoId === a.id);
    const pagado = suma(abonos, (b) => b.monto), precio = num(a.precio);
    const pctPagado = precio > 0 ? Math.min(100, Math.floor(pagado / precio * 100)) : 100;
    const cli = this.cliente(a.clienteTel);
    return {
      numero: a.numero, cliente: cli?.nombre ?? null, telefono: a.clienteTel ?? null, estado: a.estado,
      fecha: fecha(a.creado), entregado: fecha(a.entregado), precio, pagado, falta: Math.max(0, precio - pagado), porcentaje_pagado: pctPagado,
      ya_se_puede_entregar: a.estado === "apartado" && pctPagado >= this.pct(),
      prendas: prendas.map((p) => ({ codigo: p.codigo, descripcion: p.descripcion, talla: p.talla || null, ya_se_la_llevo: p.estado === "vendida" })),
      abonos: abonos.map((b) => ({ fecha: fecha(b.fecha), monto: num(b.monto) })),
      ultimo_abono: abonos.length ? fecha(abonos[abonos.length - 1].fecha) : null,
    };
  }
  prenda(p: Fila, conCosto = true) {
    const c = this.compra(p.compraId), t = c && this.tienda(c.tiendaId);
    const vendida = p.estado === "vendida";
    const r: Fila = {
      codigo: p.codigo, descripcion: p.descripcion, tipo: p.tipo, talla: p.talla || null, color: p.color || null, para: p.genero || "Mujer",
      estado: p.estado === "disponible" ? "en tienda" : p.estado, precio_etiqueta: num(p.precio),
    };
    if (num(p.descuento) > 0) { r.en_oferta = `${p.descuento} %`; r.precio_oferta = this.precioActual(p); }
    if (vendida) { r.vendida_en = num(p.precioVenta); r.fecha_venta = fecha(p.fechaVenta); const k = this.cliente(p.clienteTel); if (k) r.cliente = k.nombre; }
    else r.dias_en_tienda = dias(p.creada, this.ahora);
    if (p.estado === "apartada") { const a = this.d.apartados.find((x) => x.id === p.apartadoId); if (a) r.pedido = a.numero; }
    if (conCosto) { r.costo = this.costo(p); r[vendida ? "ganancia" : "ganaria"] = (vendida ? num(p.precioVenta) : this.precioActual(p)) - r.costo; }
    if (c) r.compra = c.nombre; if (t) r.tienda_donde_se_compro = t.nombre;
    return r;
  }
}

// ---------- períodos ----------
function rango(args: Fila, ahora: number): { ini: number; fin: number; nombre: string } {
  if (args.desde || args.hasta) {
    const ini = args.desde ? deFecha(args.desde) : 0, fin = args.hasta ? deFecha(args.hasta) + DIA : ahora + DIA;
    return { ini, fin, nombre: `del ${args.desde ?? "inicio"} al ${args.hasta ?? "hoy"}` };
  }
  const hoy = inicioDia(ahora), d = new Date(hoy - CR); // fecha de Costa Rica en UTC
  const lunes = hoy - ((d.getUTCDay() + 6) % 7) * DIA;
  const mes = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - CR;
  switch (args.periodo ?? "hoy") {
    case "ayer": return { ini: hoy - DIA, fin: hoy, nombre: "ayer" };
    case "semana": return { ini: lunes, fin: hoy + DIA, nombre: "esta semana (desde el lunes)" };
    case "semana_pasada": return { ini: lunes - 7 * DIA, fin: lunes, nombre: "la semana pasada" };
    case "mes": return { ini: mes, fin: hoy + DIA, nombre: "este mes" };
    case "mes_pasado": return { ini: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1) - CR, fin: mes, nombre: "el mes pasado" };
    case "ano": return { ini: Date.UTC(d.getUTCFullYear(), 0, 1) - CR, fin: hoy + DIA, nombre: "este año" };
    case "todo": return { ini: 0, fin: hoy + DIA, nombre: "desde el principio" };
    default: return { ini: hoy, fin: hoy + DIA, nombre: "hoy" };
  }
}
const PERIODO = {
  periodo: { type: "string", enum: ["hoy", "ayer", "semana", "semana_pasada", "mes", "mes_pasado", "ano", "todo"], description: "Período. Si no se da, es hoy." },
  desde: { type: "string", description: "Fecha inicial AAAA-MM-DD (en lugar de periodo)" },
  hasta: { type: "string", description: "Fecha final AAAA-MM-DD, incluida" },
};

// ---------- herramientas ----------
type Herramienta = { name: string; description: string; inputSchema: Fila; correr: (t: Tienda, a: Fila) => unknown };
const LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

export const HERRAMIENTAS: Herramienta[] = [
  {
    name: "resumen_ventas",
    description: "Cuánto se vendió y cuánto se ganó en un período (hoy, semana, mes…), con el detalle por día y lo más vendido. La ganancia ya resta lo que costó cada prenda.",
    inputSchema: { type: "object", properties: { ...PERIODO } },
    correr(t, a) {
      const r = rango(a, t.ahora);
      const vs = t.d.prendas.filter((p) => p.estado === "vendida" && num(p.fechaVenta) >= r.ini && num(p.fechaVenta) < r.fin);
      const porDia = new Map<number, Fila[]>();
      for (const p of vs) { const k = inicioDia(num(p.fechaVenta)); porDia.set(k, [...(porDia.get(k) ?? []), p]); }
      const porTipo = new Map<string, Fila[]>();
      for (const p of vs) porTipo.set(p.tipo, [...(porTipo.get(p.tipo) ?? []), p]);
      return {
        periodo: r.nombre, prendas_vendidas: vs.length, vendido: suma(vs, (p) => p.precioVenta), ganancia: suma(vs, (p) => t.ganancia(p)),
        ventas: new Set(vs.map((p) => p.ventaId || p.id)).size,
        por_dia: [...porDia.entries()].sort((x, y) => x[0] - y[0]).map(([k, ps]) => ({ dia: fecha(k), prendas: ps.length, vendido: suma(ps, (p) => p.precioVenta), ganancia: suma(ps, (p) => t.ganancia(p)) })),
        por_tipo: [...porTipo.entries()].map(([tipo, ps]) => ({ tipo, prendas: ps.length, vendido: suma(ps, (p) => p.precioVenta), ganancia: suma(ps, (p) => t.ganancia(p)) })).sort((x, y) => y.vendido - x.vendido),
        detalle: vs.length <= 40 ? vs.sort((x, y) => x.fechaVenta - y.fechaVenta).map((p) => t.prenda(p)) : "Son muchas: pregunte por un período más corto para ver cada prenda.",
      };
    },
  },
  {
    name: "buscar_prendas",
    description: "Busca prendas por texto (nombre, color, código), tipo, talla, color, para quién, precio o estado. Sirve para saber qué hay en la tienda, qué está en oferta o qué se vendió.",
    inputSchema: {
      type: "object", properties: {
        texto: { type: "string", description: "Palabras a buscar, por ejemplo 'vestido rojo' o un código" },
        tipo: { type: "string", description: "Vestido, Blusa, Pantalón, Enagua, Zapatos…" },
        talla: { type: "string" }, color: { type: "string" },
        para: { type: "string", enum: ["Mujer", "Hombre", "Unisex"] },
        estado: { type: "string", enum: ["en_tienda", "vendida", "apartada", "todas"], description: "Por defecto: en_tienda" },
        en_oferta: { type: "boolean" }, precio_max: { type: "number" }, precio_min: { type: "number" },
        limite: { type: "number", description: "Máximo de prendas a devolver (por defecto 30)" },
      },
    },
    correr(t, a) {
      const est = a.estado ?? "en_tienda";
      let ps = t.d.prendas.filter((p) => est === "todas" || p.estado === (est === "en_tienda" ? "disponible" : est));
      if (a.tipo) ps = ps.filter((p) => normal(p.tipo) === normal(a.tipo));
      if (a.talla) ps = ps.filter((p) => normal(p.talla) === normal(a.talla));
      if (a.color) ps = ps.filter((p) => normal(p.color).includes(normal(a.color)));
      if (a.para) ps = ps.filter((p) => (p.genero || "Mujer") === a.para);
      if (a.en_oferta != null) ps = ps.filter((p) => (num(p.descuento) > 0) === !!a.en_oferta);
      if (a.precio_max) ps = ps.filter((p) => t.precioActual(p) <= num(a.precio_max));
      if (a.precio_min) ps = ps.filter((p) => t.precioActual(p) >= num(a.precio_min));
      if (a.texto) { const ws = normal(a.texto).split(/\s+/); ps = ps.filter((p) => { const h = normal([p.descripcion, p.tipo, p.color, p.talla, "talla " + p.talla, p.codigo].join(" ")); return ws.every((w) => h.includes(w)); }); }
      const lim = Math.min(200, num(a.limite) || 30);
      return { encontradas: ps.length, valor_a_precio_de_venta: suma(ps.filter((p) => p.estado === "disponible"), (p) => t.precioActual(p)), prendas: ps.slice(0, lim).map((p) => t.prenda(p)), nota: ps.length > lim ? `Se muestran ${lim} de ${ps.length}.` : undefined };
    },
  },
  {
    name: "inventario",
    description: "Resumen de lo que hay en la tienda: cuántas prendas por tipo y talla, cuánto valen, cuántas en oferta, sin etiqueta impresa, y las que llevan muchos días sin venderse.",
    inputSchema: { type: "object", properties: { dias_estancada: { type: "number", description: "Días para considerar una prenda estancada (por defecto 30)" } } },
    correr(t, a) {
      const ps = t.d.prendas.filter((p) => p.estado === "disponible"), lim = num(a.dias_estancada) || 30;
      const grupos = new Map<string, Fila[]>();
      for (const p of ps) grupos.set(p.tipo, [...(grupos.get(p.tipo) ?? []), p]);
      const viejas = ps.filter((p) => (dias(p.creada, t.ahora) ?? 0) >= lim).sort((x, y) => x.creada - y.creada);
      return {
        en_tienda: ps.length, valor_a_precio_de_venta: suma(ps, (p) => t.precioActual(p)), costo_total: suma(ps, (p) => t.costo(p)),
        en_oferta: ps.filter((p) => num(p.descuento) > 0).length, sin_etiqueta_impresa: ps.filter((p) => !p.impresa).length,
        apartadas_en_pedidos: t.d.prendas.filter((p) => p.estado === "apartada").length,
        por_tipo: [...grupos.entries()].map(([tipo, xs]) => ({ tipo, prendas: xs.length, valor: suma(xs, (p) => t.precioActual(p)), tallas: Object.fromEntries([...new Set(xs.map((p) => p.talla || "sin talla"))].map((tl) => [tl, xs.filter((p) => (p.talla || "sin talla") === tl).length])) })).sort((x, y) => y.prendas - x.prendas),
        [`mas_de_${lim}_dias_sin_venderse`]: viejas.slice(0, 40).map((p) => t.prenda(p)),
      };
    },
  },
  {
    name: "pedidos",
    description: "Pedidos (apartados): quién debe, cuánto ha pagado, cuánto falta, qué prendas tiene y si ya se puede entregar. Por defecto, los activos (que no se han entregado o que todavía deben).",
    inputSchema: { type: "object", properties: {
      ver: { type: "string", enum: ["activos", "terminados", "todos"], description: "Por defecto: activos" },
      cliente: { type: "string", description: "Nombre o teléfono de la clienta" },
      numero: { type: "number", description: "Número de pedido, para ver uno solo con todos sus abonos" },
    } },
    correr(t, a) {
      let xs = t.d.apartados.map((x) => t.pedido(x));
      if (a.numero) xs = xs.filter((x) => num(x.numero) === num(a.numero));
      else {
        const ver = a.ver ?? "activos";
        const activo = (x: Fila) => x.estado === "apartado" || (x.estado === "entregado" && x.falta > 0);
        if (ver !== "todos") xs = xs.filter((x) => (ver === "activos") === activo(x));
      }
      if (a.cliente) { const q = normal(a.cliente), d = soloDigitos(a.cliente); xs = xs.filter((x) => normal(x.cliente).includes(q) || (d.length >= 4 && String(x.telefono ?? "").includes(d))); }
      xs.sort((x, y) => y.falta - x.falta);
      return { pedidos: xs.length, total_por_cobrar: suma(xs, (x) => x.falta), se_entrega_al_pagar: `${t.pct()} %`, lista: xs };
    },
  },
  {
    name: "clientes",
    description: "Clientes: cuánto ha gastado cada una, cuántas compras, la última vez que compró y si debe algo en pedidos. Con 'cliente' da el detalle de una (todo lo que compró).",
    inputSchema: { type: "object", properties: {
      cliente: { type: "string", description: "Nombre o teléfono, para ver el detalle de una clienta" },
      orden: { type: "string", enum: ["gasto", "reciente", "nombre"], description: "Por defecto: gasto" },
      limite: { type: "number" },
    } },
    correr(t, a) {
      const info = (k: Fila) => {
        const vs = t.d.prendas.filter((p) => p.estado === "vendida" && p.clienteTel === k.telefono);
        const peds = t.d.apartados.filter((x) => x.clienteTel === k.telefono && x.estado !== "cancelado").map((x) => t.pedido(x));
        return { nombre: k.nombre, telefono: k.telefono, gastado: suma(vs, (p) => p.precioVenta), prendas_compradas: vs.length, compras: new Set(vs.map((p) => p.ventaId || p.id)).size,
          ultima_compra: vs.length ? fecha(Math.max(...vs.map((p) => num(p.fechaVenta)))) : null, ultima_t: vs.length ? Math.max(...vs.map((p) => num(p.fechaVenta))) : 0,
          debe_en_pedidos: suma(peds, (x) => x.falta), vs, peds };
      };
      if (a.cliente) {
        const q = normal(a.cliente), d = soloDigitos(a.cliente);
        const ks = t.d.clientes.filter((k) => normal(k.nombre).includes(q) || (d.length >= 4 && k.telefono.includes(d)));
        if (!ks.length) return { error: `No hay ninguna clienta con «${a.cliente}».` };
        return ks.slice(0, 5).map((k) => { const i = info(k); return { ...i, vs: undefined, peds: undefined, ultima_t: undefined, lo_que_compro: i.vs.sort((x, y) => y.fechaVenta - x.fechaVenta).map((p) => ({ fecha: fecha(p.fechaVenta), descripcion: p.descripcion, talla: p.talla || null, pago: num(p.precioVenta) })), pedidos: i.peds }; });
      }
      const xs = t.d.clientes.map(info);
      const orden = a.orden ?? "gasto";
      xs.sort(orden === "nombre" ? (x, y) => x.nombre.localeCompare(y.nombre, "es") : orden === "reciente" ? (x, y) => y.ultima_t - x.ultima_t : (x, y) => y.gastado - x.gastado);
      return { clientes: xs.length, lista: xs.slice(0, Math.min(200, num(a.limite) || 30)).map((x) => ({ ...x, vs: undefined, peds: undefined, ultima_t: undefined })) };
    },
  },
  {
    name: "compras_y_tiendas",
    description: "Las compras (pacas) y las tiendas donde se compra: cuánto se pagó, cuánto costó cada prenda, cuánto se ha recuperado vendiendo y qué tienda deja más ganancia.",
    inputSchema: { type: "object", properties: {} },
    correr(t) {
      const compras = t.d.compras.slice().sort((x, y) => y.fecha - x.fecha).map((c) => {
        const ps = t.d.prendas.filter((p) => p.compraId === c.id), vs = ps.filter((p) => p.estado === "vendida");
        const recuperado = suma(vs, (p) => p.precioVenta);
        return { compra: c.nombre, fecha: fecha(c.fecha), tienda: t.tienda(c.tiendaId)?.nombre ?? null, pago: num(c.costo), costo_por_prenda: t.costoUnidad(c),
          cerrada: num(c.cantidad) > 0, prendas_registradas: ps.length, vendidas: vs.length, en_tienda: ps.filter((p) => p.estado === "disponible").length,
          recuperado, balance: recuperado - num(c.costo) };
      });
      const tiendas = t.d.tiendas.map((ti) => {
        const ids = new Set(t.d.compras.filter((c) => c.tiendaId === ti.id).map((c) => c.id));
        const vs = t.d.prendas.filter((p) => ids.has(p.compraId) && p.estado === "vendida");
        const costo = suma(vs, (p) => t.costo(p)), vendido = suma(vs, (p) => p.precioVenta);
        return { tienda: ti.nombre, zona: ti.zona || null, compras: ids.size, invertido: suma(t.d.compras.filter((c) => c.tiendaId === ti.id), (c) => c.costo), prendas_vendidas: vs.length, vendido, ganancia: vendido - costo,
          por_cada_1000_que_costo_se_vende_en: costo > 0 ? Math.round(vendido / costo * 1000) : null };
      }).sort((x, y) => (y.por_cada_1000_que_costo_se_vende_en ?? 0) - (x.por_cada_1000_que_costo_se_vende_en ?? 0));
      return { compras, tiendas };
    },
  },
];

export const INSTRUCCIONES = "Conector de solo lectura de la tienda de ropa. Los montos son colones (₡). " +
  "«Ganancia» ya resta lo que costó cada prenda. Un pedido es un apartado: la clienta paga en abonos y se lleva las prendas cuando pagó lo necesario. " +
  "Responda en español sencillo, con montos como ₡12.900.";

export function listaHerramientas() {
  return HERRAMIENTAS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema, annotations: LECTURA }));
}
export function correr(nombre: string, args: Fila, datos: Datos, ahora = Date.now()) {
  const h = HERRAMIENTAS.find((x) => x.name === nombre);
  if (!h) throw new Error(`No existe la herramienta ${nombre}`);
  return h.correr(new Tienda(datos, ahora), args ?? {});
}
