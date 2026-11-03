-- Mi tienda: fotos en buena calidad.
-- La prenda sigue guardando una miniatura (foto) para las listas; la foto grande va al almacenamiento «fotos»
-- y la prenda guarda su dirección (foto_url).

alter table public.prendas add column if not exists foto_url text not null default '';

-- Almacenamiento público (las fotos se ven en el catálogo); solo el personal con sesión sube o borra.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "fotos: personal sube" on storage.objects;
create policy "fotos: personal sube" on storage.objects for insert to authenticated with check (bucket_id = 'fotos');
drop policy if exists "fotos: personal cambia" on storage.objects;
create policy "fotos: personal cambia" on storage.objects for update to authenticated using (bucket_id = 'fotos') with check (bucket_id = 'fotos');
drop policy if exists "fotos: personal borra" on storage.objects;
create policy "fotos: personal borra" on storage.objects for delete to authenticated using (bucket_id = 'fotos');

-- El catálogo da también la foto grande (al tocar la foto se ve en buena calidad)
drop function if exists public.catalogo_fotos(text[]);
create function public.catalogo_fotos(codigos text[]) returns table (codigo text, foto text, foto_url text)
language sql stable security definer set search_path = public as $$
  select p.codigo, p.foto, p.foto_url from public.prendas p
  where p.estado = 'disponible' and p.codigo = any (codigos[1:60]);
$$;
revoke all on function public.catalogo_fotos(text[]) from public;
grant execute on function public.catalogo_fotos(text[]) to anon, authenticated;

-- El catálogo sabe qué prendas tienen foto aunque solo tengan la grande
create or replace function public.catalogo_lista() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'tienda', (select json_build_object('nombre', c.nombre, 'whatsapp', c.whatsapp) from public.config c where c.id = 'tienda'),
    'prendas', coalesce((
      select json_agg(json_build_object(
               'codigo', p.codigo, 'tipo', p.tipo, 'descripcion', p.descripcion, 'talla', p.talla,
               'color', p.color, 'genero', p.genero, 'precio', p.precio, 'descuento', p.descuento,
               'creada', p.creada, 'conFoto', p.foto <> '' or p.foto_url <> '')
             order by p.creada desc)
      from public.prendas p where p.estado = 'disponible'), '[]'::json)
  );
$$;
