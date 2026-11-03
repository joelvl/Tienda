-- Mi tienda: en un pedido, la clienta puede llevarse prendas sueltas mientras sigue pagando.
-- El enlace del cliente muestra cuáles ya se llevó (las que quedan como vendidas dentro del pedido).

create or replace function public.pedido_ver(clave text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'tienda', (select json_build_object('nombre', c.nombre, 'whatsapp', c.whatsapp) from public.config c where c.id = 'tienda'),
    'numero', a.numero, 'estado', a.estado, 'precio', a.precio, 'creado', a.creado, 'entregado', a.entregado,
    'cliente', (select k.nombre from public.clientes k where k.telefono = a.cliente_tel),
    'prendas', coalesce((
      select json_agg(json_build_object('descripcion', p.descripcion, 'talla', p.talla, 'codigo', p.codigo, 'foto', p.foto,
                                        'retirada', p.estado = 'vendida', 'fechaRetiro', p.fecha_venta) order by p.creada)
      from public.prendas p where p.apartado_id = a.id), '[]'::json),
    'abonos', coalesce((
      select json_agg(json_build_object('monto', b.monto, 'fecha', b.fecha) order by b.fecha)
      from public.abonos b where b.apartado_id = a.id), '[]'::json)
  )
  from public.apartados a
  where a.clave = pedido_ver.clave and length(pedido_ver.clave) >= 16;
$$;
