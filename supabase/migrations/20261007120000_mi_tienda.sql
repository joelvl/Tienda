-- Mi tienda: tablas, seguridad, códigos de etiqueta y tiempo real.
-- GitHub Actions la aplica sola con `supabase db push`.

-- ---------- Compras (pacas o mercadería) ----------
create table if not exists public.compras (
  id          text primary key,
  nombre      text    not null default 'Compra',
  costo       integer not null default 0 check (costo >= 0),
  cantidad    integer check (cantidad is null or cantidad > 0),   -- opcional: si es null, el costo se reparte entre las prendas registradas
  fecha       bigint  not null,                                   -- milisegundos (Date.now())
  nota        text    not null default '',
  creado_por  uuid default auth.uid(),
  creado_en   timestamptz not null default now()
);

-- ---------- Prendas ----------
create table if not exists public.prendas (
  id             text primary key,
  codigo         text    not null unique,                         -- el número del código de barras (6 dígitos)
  tipo           text    not null default 'Otro',
  descripcion    text    not null default '',
  talla          text    not null default '',
  color          text    not null default '',
  compra_id      text references public.compras (id) on delete set null,
  costo          integer not null default 0 check (costo >= 0),
  costo_fijo     boolean not null default false,                  -- true: costo escrito a mano; false: sale de la compra
  precio         integer not null check (precio >= 0),            -- precio de etiqueta
  estado         text    not null default 'disponible' check (estado in ('disponible', 'vendida')),
  creada         bigint  not null,
  foto           text    not null default '',                     -- miniatura en JPEG (data URL)
  impresa        boolean not null default false,
  precio_venta   integer check (precio_venta is null or precio_venta >= 0),
  fecha_venta    bigint,
  venta_id       text,                                            -- agrupa las prendas de una misma venta
  creado_por     uuid default auth.uid(),
  actualizado_en timestamptz not null default now()
);
create index if not exists prendas_estado_idx      on public.prendas (estado);
create index if not exists prendas_compra_idx      on public.prendas (compra_id);
create index if not exists prendas_fecha_venta_idx on public.prendas (fecha_venta);

-- ---------- Ajustes de la tienda (una sola fila) ----------
create table if not exists public.config (
  id            text primary key default 'tienda' check (id = 'tienda'),
  nombre        text    not null default 'Mi tienda',
  factor        numeric not null default 2.5,
  etiqueta      text    not null default '50x30',
  ultimo_codigo integer not null default 0,
  modelo_ia     text    not null default 'quick' check (modelo_ia in ('quick', 'preciso'))
);
insert into public.config (id) values ('tienda') on conflict (id) do nothing;

-- ---------- Fecha de última modificación ----------
create or replace function public.tocar_actualizado() returns trigger
language plpgsql set search_path = public as $$
begin
  new.actualizado_en := now();
  return new;
end $$;
drop trigger if exists prendas_actualizado on public.prendas;
create trigger prendas_actualizado before update on public.prendas
  for each row execute function public.tocar_actualizado();

-- ---------- Códigos de etiqueta sin repetir ----------
-- Siempre da el siguiente número libre, aunque se hayan cargado prendas de un respaldo.
create sequence if not exists public.prenda_codigo_seq;
create or replace function public.siguiente_codigo() returns text
language plpgsql security definer set search_path = public as $$
declare
  maximo bigint;
  n bigint;
begin
  perform pg_advisory_xact_lock(724242);   -- una solicitud a la vez
  select coalesce(max(codigo::bigint), 0) into maximo
    from public.prendas where codigo ~ '^[0-9]{1,15}$';
  n := nextval('public.prenda_codigo_seq');
  if n <= maximo then
    perform setval('public.prenda_codigo_seq', maximo + 1);
    n := maximo + 1;
  end if;
  return lpad(n::text, 6, '0');
end $$;
revoke all on function public.siguiente_codigo() from public, anon;
grant execute on function public.siguiente_codigo() to authenticated;

-- ---------- Seguridad: solo usuarios con sesión iniciada ----------
-- Desactive "Allow new users to sign up" en Supabase: así solo entran los usuarios que usted cree.
alter table public.compras enable row level security;
alter table public.prendas enable row level security;
alter table public.config  enable row level security;

drop policy if exists "personal de la tienda" on public.compras;
create policy "personal de la tienda" on public.compras
  for all to authenticated using (true) with check (true);

drop policy if exists "personal de la tienda" on public.prendas;
create policy "personal de la tienda" on public.prendas
  for all to authenticated using (true) with check (true);

drop policy if exists "personal de la tienda lee" on public.config;
create policy "personal de la tienda lee" on public.config
  for select to authenticated using (true);
drop policy if exists "personal de la tienda cambia" on public.config;
create policy "personal de la tienda cambia" on public.config
  for insert to authenticated with check (id = 'tienda');
drop policy if exists "personal de la tienda actualiza" on public.config;
create policy "personal de la tienda actualiza" on public.config
  for update to authenticated using (id = 'tienda') with check (id = 'tienda');

-- ---------- Tiempo real: los cambios se ven al instante en todos los aparatos ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['prendas', 'compras', 'config'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
