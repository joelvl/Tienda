-- Mi tienda: catálogo público para compartir con los clientes.
-- Los clientes no tienen usuario: solo pueden llamar estas dos funciones, que dan
-- las prendas disponibles SIN costo, compra, tienda, ventas ni clientes.

alter table public.config add column if not exists whatsapp text not null default '';

-- Lista sin fotos (es liviana): nombre y WhatsApp de la tienda, y las prendas en venta.
create or replace function public.catalogo_lista() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'tienda', (select json_build_object('nombre', c.nombre, 'whatsapp', c.whatsapp) from public.config c where c.id = 'tienda'),
    'prendas', coalesce((
      select json_agg(json_build_object(
               'codigo', p.codigo, 'tipo', p.tipo, 'descripcion', p.descripcion, 'talla', p.talla,
               'color', p.color, 'precio', p.precio, 'creada', p.creada, 'conFoto', p.foto <> '')
             order by p.creada desc)
      from public.prendas p where p.estado = 'disponible'), '[]'::json)
  );
$$;

-- Fotos por código, de a pocas, conforme el cliente va bajando en la página.
create or replace function public.catalogo_fotos(codigos text[]) returns table (codigo text, foto text)
language sql stable security definer set search_path = public as $$
  select p.codigo, p.foto from public.prendas p
  where p.estado = 'disponible' and p.codigo = any (codigos[1:60]);
$$;

revoke all on function public.catalogo_lista() from public;
revoke all on function public.catalogo_fotos(text[]) from public;
grant execute on function public.catalogo_lista() to anon, authenticated;
grant execute on function public.catalogo_fotos(text[]) to anon, authenticated;
