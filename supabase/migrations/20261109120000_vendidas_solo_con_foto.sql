-- Las vendidas de los últimos 15 días salen en el catálogo solo si tienen foto en buena calidad (foto grande).
-- Las que no la tienen dejan de salir al venderse, como antes; en la tienda siguen igual (inventario y ventas).

create or replace function public.catalogo_lista() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'tienda', (select json_build_object('nombre', c.nombre, 'whatsapp', c.whatsapp) from public.config c where c.id = 'tienda'),
    'prendas', coalesce((
      select json_agg(json_build_object(
               'codigo', p.codigo, 'tipo', p.tipo, 'descripcion', p.descripcion, 'talla', p.talla,
               'color', p.color, 'genero', p.genero, 'precio', p.precio,
               'descuento', case when p.estado = 'vendida' then 0 else p.descuento end,
               'creada', p.creada, 'conFoto', p.foto <> '' or p.foto_url <> '',
               'vendida', p.estado = 'vendida')
             order by (p.estado = 'vendida'), coalesce(case when p.estado = 'vendida' then p.fecha_venta end, p.creada) desc)
      from public.prendas p
      where p.estado = 'disponible'
         or (p.estado = 'vendida' and coalesce(p.foto_url, '') <> ''
             and p.fecha_venta >= (extract(epoch from now()) * 1000)::bigint - 15 * 86400000::bigint)), '[]'::json)
  );
$$;

create or replace function public.catalogo_fotos(codigos text[]) returns table (codigo text, foto text, foto_url text)
language sql stable security definer set search_path = public as $$
  select p.codigo, p.foto, p.foto_url from public.prendas p
  where (p.estado = 'disponible'
         or (p.estado = 'vendida' and coalesce(p.foto_url, '') <> ''
             and p.fecha_venta >= (extract(epoch from now()) * 1000)::bigint - 15 * 86400000::bigint))
    and p.codigo = any (codigos[1:60]);
$$;
revoke all on function public.catalogo_fotos(text[]) from public;
grant execute on function public.catalogo_fotos(text[]) to anon, authenticated;
