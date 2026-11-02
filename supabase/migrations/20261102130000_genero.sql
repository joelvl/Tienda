-- Mi tienda: para quién es cada prenda (mujer, hombre o unisex).

alter table public.prendas
  add column if not exists genero text not null default 'Mujer' check (genero in ('Mujer', 'Hombre', 'Unisex'));
create index if not exists prendas_genero_idx on public.prendas (genero);

-- El catálogo también lo muestra
create or replace function public.catalogo_lista() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'tienda', (select json_build_object('nombre', c.nombre, 'whatsapp', c.whatsapp) from public.config c where c.id = 'tienda'),
    'prendas', coalesce((
      select json_agg(json_build_object(
               'codigo', p.codigo, 'tipo', p.tipo, 'descripcion', p.descripcion, 'talla', p.talla,
               'color', p.color, 'genero', p.genero, 'precio', p.precio, 'creada', p.creada, 'conFoto', p.foto <> '')
             order by p.creada desc)
      from public.prendas p where p.estado = 'disponible'), '[]'::json)
  );
$$;
