-- Visitas del catálogo: qué pasa en el catálogo público, sin saber quién es la persona.
-- Cada teléfono o computadora se identifica con un código al azar que guarda su navegador
-- (sin nombre ni número). Se anota: entró al catálogo, tocó «La quiero» o abrió una foto en grande.

create table if not exists public.catalogo_eventos (
  id        bigint generated always as identity primary key,
  creado    timestamptz not null default now(),
  aparato   text not null,
  tipo      text not null check (tipo in ('visita', 'quiero', 'foto')),
  codigo    text,                                  -- la prenda (para «La quiero» y fotos)
  de_tienda boolean not null default false         -- desde un aparato con la tienda abierta: no se cuenta
);
create index if not exists catalogo_eventos_creado_idx on public.catalogo_eventos (creado desc);
create index if not exists catalogo_eventos_aparato_idx on public.catalogo_eventos (aparato, creado desc);

-- Seguridad: el personal de la tienda solo lee; nadie escribe directo en la tabla.
alter table public.catalogo_eventos enable row level security;
drop policy if exists "personal de la tienda lee" on public.catalogo_eventos;
create policy "personal de la tienda lee" on public.catalogo_eventos
  for select to authenticated using (true);
grant select on public.catalogo_eventos to authenticated;

-- El catálogo (sin usuario) anota por medio de esta función, que revisa lo que llega
-- y no deja repetir lo mismo en 10 segundos ni más de 150 anotaciones por hora desde un aparato.
create or replace function public.catalogo_evento(p_aparato text, p_tipo text, p_codigo text default null, p_de_tienda boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_aparato is null or p_aparato !~ '^[a-z0-9]{8,32}$' then return; end if;
  if p_tipo is null or p_tipo not in ('visita', 'quiero', 'foto') then return; end if;
  if p_tipo = 'visita' then p_codigo := null;
  elsif p_codigo is null or p_codigo !~ '^[0-9]{1,12}$' then return; end if;

  if exists (select 1 from public.catalogo_eventos e
             where e.aparato = p_aparato and e.tipo = p_tipo and e.codigo is not distinct from p_codigo
               and e.creado > now() - interval '10 seconds') then return; end if;
  if (select count(*) from public.catalogo_eventos e
      where e.aparato = p_aparato and e.creado > now() - interval '1 hour') >= 150 then return; end if;

  insert into public.catalogo_eventos (aparato, tipo, codigo, de_tienda)
  values (p_aparato, p_tipo, p_codigo, coalesce(p_de_tienda, false));

  -- De vez en cuando se borra lo de hace más de 6 meses, para que la tabla no crezca sin fin.
  if random() < 0.02 then
    delete from public.catalogo_eventos where creado < now() - interval '180 days';
  end if;
end;
$$;
revoke all on function public.catalogo_evento(text, text, text, boolean) from public;
grant execute on function public.catalogo_evento(text, text, text, boolean) to anon, authenticated;
