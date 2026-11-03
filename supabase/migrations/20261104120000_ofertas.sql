-- Mi tienda: ofertas. Cada prenda puede tener un descuento (porcentaje) sobre su precio de etiqueta.

alter table public.prendas
  add column if not exists descuento integer not null default 0 check (descuento between 0 and 90);

-- El catálogo también lo muestra (el precio tachado y el de oferta)
create or replace function public.catalogo_lista() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'tienda', (select json_build_object('nombre', c.nombre, 'whatsapp', c.whatsapp) from public.config c where c.id = 'tienda'),
    'prendas', coalesce((
      select json_agg(json_build_object(
               'codigo', p.codigo, 'tipo', p.tipo, 'descripcion', p.descripcion, 'talla', p.talla,
               'color', p.color, 'genero', p.genero, 'precio', p.precio, 'descuento', p.descuento,
               'creada', p.creada, 'conFoto', p.foto <> '')
             order by p.creada desc)
      from public.prendas p where p.estado = 'disponible'), '[]'::json)
  );
$$;
