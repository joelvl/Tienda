-- Mi tienda: apartados. Un cliente separa varias prendas con un precio y las va pagando en abonos.
-- Las prendas apartadas salen del inventario (y del catálogo) hasta que se entregan o se cancela el apartado.

create table if not exists public.apartados (
  id          text primary key,
  numero      integer not null unique check (numero > 0),             -- el número del pedido (sale en la etiqueta)
  cliente_tel text references public.clientes (telefono) on delete set null on update cascade,
  precio      integer not null check (precio >= 0),                   -- lo que se acordó por todas las prendas
  estado      text    not null default 'apartado' check (estado in ('apartado', 'entregado', 'cancelado')),
  creado      bigint  not null,
  entregado   bigint,
  nota        text    not null default '',
  clave       text    not null unique check (length(clave) >= 16),    -- para el enlace que ve el cliente
  creado_por  uuid default auth.uid(),
  creado_en   timestamptz not null default now()
);
create index if not exists apartados_estado_idx on public.apartados (estado);
create index if not exists apartados_cliente_idx on public.apartados (cliente_tel);

create table if not exists public.abonos (
  id          text primary key,
  apartado_id text    not null references public.apartados (id) on delete cascade,
  monto       integer not null check (monto > 0),
  fecha       bigint  not null,
  nota        text    not null default '',
  creado_por  uuid default auth.uid(),
  creado_en   timestamptz not null default now()
);
create index if not exists abonos_apartado_idx on public.abonos (apartado_id);

-- Las prendas pueden estar apartadas
alter table public.prendas drop constraint if exists prendas_estado_check;
alter table public.prendas add constraint prendas_estado_check check (estado in ('disponible', 'vendida', 'apartada'));
alter table public.prendas
  add column if not exists apartado_id text references public.apartados (id) on delete set null;
create index if not exists prendas_apartado_idx on public.prendas (apartado_id);

-- Qué parte hay que pagar para poder entregar (porcentaje)
alter table public.config add column if not exists porcentaje_apartado integer not null default 50
  check (porcentaje_apartado between 0 and 100);

-- Seguridad: igual que el resto, solo usuarios con sesión iniciada
alter table public.apartados enable row level security;
alter table public.abonos enable row level security;
drop policy if exists "personal de la tienda" on public.apartados;
create policy "personal de la tienda" on public.apartados for all to authenticated using (true) with check (true);
drop policy if exists "personal de la tienda" on public.abonos;
create policy "personal de la tienda" on public.abonos for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.apartados, public.abonos to authenticated;

-- Lo que ve el cliente con su enlace: su pedido, las prendas y los abonos. Sin costos ni datos de otros.
create or replace function public.pedido_ver(clave text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'tienda', (select json_build_object('nombre', c.nombre, 'whatsapp', c.whatsapp) from public.config c where c.id = 'tienda'),
    'numero', a.numero, 'estado', a.estado, 'precio', a.precio, 'creado', a.creado, 'entregado', a.entregado,
    'cliente', (select k.nombre from public.clientes k where k.telefono = a.cliente_tel),
    'prendas', coalesce((
      select json_agg(json_build_object('descripcion', p.descripcion, 'talla', p.talla, 'codigo', p.codigo, 'foto', p.foto) order by p.creada)
      from public.prendas p where p.apartado_id = a.id), '[]'::json),
    'abonos', coalesce((
      select json_agg(json_build_object('monto', b.monto, 'fecha', b.fecha) order by b.fecha)
      from public.abonos b where b.apartado_id = a.id), '[]'::json)
  )
  from public.apartados a
  where a.clave = pedido_ver.clave and length(pedido_ver.clave) >= 16;
$$;
revoke all on function public.pedido_ver(text) from public;
grant execute on function public.pedido_ver(text) to anon, authenticated;

-- Tiempo real
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['apartados', 'abonos'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
