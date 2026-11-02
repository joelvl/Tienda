-- Mi tienda: catálogo de tiendas donde se compra y rentabilidad por tienda.

create table if not exists public.tiendas (
  id         text primary key,
  nombre     text   not null check (length(trim(nombre)) > 0),
  zona       text   not null default '',
  nota       text   not null default '',
  creada     bigint not null,
  creado_por uuid default auth.uid(),
  creado_en  timestamptz not null default now()
);

alter table public.compras
  add column if not exists tienda_id text references public.tiendas (id) on delete set null;
create index if not exists compras_tienda_idx on public.compras (tienda_id);

-- Seguridad: igual que el resto, solo usuarios con sesión iniciada
alter table public.tiendas enable row level security;
drop policy if exists "personal de la tienda" on public.tiendas;
create policy "personal de la tienda" on public.tiendas
  for all to authenticated using (true) with check (true);

-- Tiempo real
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tiendas') then
    alter publication supabase_realtime add table public.tiendas;
  end if;
end $$;

-- Rentabilidad por tienda (para consultar desde Supabase o un reporte).
-- Igual que en la app: la ganancia solo cuenta prendas con costo final
-- (costo escrito a mano, o compra cerrada con su cantidad de prendas).
create or replace view public.rentabilidad_por_tienda
with (security_invoker = true) as
with costo_compra as (
  select c.id, c.tienda_id, c.cantidad,
         c.costo::numeric / greatest(coalesce(c.cantidad,
           (select count(*) from public.prendas p where p.compra_id = c.id)), 1) as costo_unidad
  from public.compras c
),
prendas_con_costo as (
  select p.id, p.estado, p.precio_venta, p.creada, p.fecha_venta, cc.tienda_id,
         case when p.costo_fijo then p.costo::numeric else cc.costo_unidad end as costo_real,
         (p.costo_fijo or cc.cantidad is not null) as costo_final
  from public.prendas p
  join costo_compra cc on cc.id = p.compra_id
)
select
  t.id,
  t.nombre,
  t.zona,
  (select count(*) from public.compras c where c.tienda_id = t.id)                         as compras,
  (select count(*) from public.compras c where c.tienda_id = t.id and c.cantidad is null)  as compras_sin_cerrar,
  (select coalesce(sum(c.costo), 0) from public.compras c where c.tienda_id = t.id)        as invertido,
  count(pc.id)                                                                            as prendas,
  count(pc.id) filter (where pc.estado = 'vendida')                                       as vendidas,
  coalesce(sum(pc.precio_venta) filter (where pc.estado = 'vendida'), 0)                  as vendido,
  round(coalesce(sum(pc.precio_venta - pc.costo_real)
        filter (where pc.estado = 'vendida' and pc.costo_final), 0))                      as ganancia,
  round(sum(pc.precio_venta) filter (where pc.estado = 'vendida' and pc.costo_final) * 1000
        / nullif(sum(pc.costo_real) filter (where pc.estado = 'vendida' and pc.costo_final), 0)) as vende_en_por_cada_1000,
  round(avg((pc.fecha_venta - pc.creada) / 86400000.0)
        filter (where pc.estado = 'vendida' and pc.costo_final), 1)                       as dias_para_vender
from public.tiendas t
left join prendas_con_costo pc on pc.tienda_id = t.id
group by t.id, t.nombre, t.zona;

grant select on public.rentabilidad_por_tienda to authenticated;
