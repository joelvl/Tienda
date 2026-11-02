-- Mi tienda: clientes (nombre y teléfono) para registrar a quién se le vendió.

create table if not exists public.clientes (
  telefono   text primary key check (telefono ~ '^[0-9]{8,15}$'),   -- solo dígitos; es la llave
  nombre     text   not null check (length(trim(nombre)) > 0),
  creada     bigint not null,
  creado_por uuid default auth.uid(),
  creado_en  timestamptz not null default now()
);

-- La venta queda en cada prenda vendida; si se borra el cliente, la venta se queda sin cliente.
alter table public.prendas
  add column if not exists cliente_tel text references public.clientes (telefono) on delete set null on update cascade;
create index if not exists prendas_cliente_idx on public.prendas (cliente_tel);

-- Seguridad: igual que el resto, solo usuarios con sesión iniciada
alter table public.clientes enable row level security;
drop policy if exists "personal de la tienda" on public.clientes;
create policy "personal de la tienda" on public.clientes
  for all to authenticated using (true) with check (true);

-- Permisos explícitos: los proyectos nuevos de Supabase ya no los dan solos a las tablas
-- creadas por migración, y sin ellos no se puede borrar.
grant select, insert, update, delete on public.prendas, public.compras, public.tiendas, public.clientes to authenticated;
grant select, insert, update on public.config to authenticated;

-- Tiempo real
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clientes') then
    alter publication supabase_realtime add table public.clientes;
  end if;
end $$;
