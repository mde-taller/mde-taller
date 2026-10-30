-- =====================================================================
--  MDE Electromecánica · Sistema de Órdenes de Trabajo
--  Paso 22 · Eliminar repuestos
--   - Depósito y Administrador pueden eliminar un repuesto desde Stock y repuestos.
--   - Si nunca se usó (sin movimientos, OT ni pedidos), se borra por completo.
--   - Si tiene historial, queda oculto (repuestos.eliminado): no aparece en búsquedas, no se
--     puede escanear ni cargar en OT nuevas, pero las OT y movimientos anteriores lo siguen mostrando.
--   - Si después se vuelve a dar de alta el mismo código, se recupera.
--  Se puede correr más de una vez sin problema.
-- =====================================================================
begin;

alter table public.repuestos add column if not exists eliminado boolean not null default false;

-- Stock: solo repuestos no eliminados.
create or replace view public.stock_disponible with (security_invoker = true) as
select r.codigo,
       r.descripcion,
       coalesce(sum(m.cantidad) filter (where m.tipo = 'STOCK INICIAL'), 0) as stock_inicial,
       coalesce(sum(m.cantidad) filter (where m.tipo = 'ENTRADA'), 0)       as entradas,
       coalesce(sum(m.cantidad) filter (where m.tipo = 'SALIDA'), 0)        as salidas,
       coalesce(sum(m.cantidad) filter (where m.tipo = 'AJUSTE'), 0)        as ajustes,
       coalesce(sum(case m.tipo when 'SALIDA' then -m.cantidad else m.cantidad end), 0) as disponible
from public.repuestos r
left join public.movimientos_stock m on m.codigo = r.codigo
where not r.eliminado
group by r.codigo, r.descripcion;

create or replace function public.buscar_repuesto(p_codigo text)
returns setof public.repuestos language sql stable as $$
  select * from public.repuestos
  where codigo_limpio = upper(regexp_replace(coalesce(p_codigo, ''), '\s+', '', 'g')) and not eliminado;
$$;

create or replace function public.consultar_stock(p_codigo text)
returns table (codigo text, descripcion text, disponible numeric)
language sql stable security definer set search_path = public as $$
  select r.codigo, r.descripcion, public.stock_de(r.codigo)
  from public.repuestos r
  where r.codigo_limpio = upper(regexp_replace(coalesce(p_codigo, ''), '\s+', '', 'g')) and not r.eliminado;
$$;

create or replace function public.buscar_repuestos(p_texto text, p_limite integer default 12)
returns table (codigo text, descripcion text, disponible numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_t text := trim(coalesce(p_texto, '')); v_c text; v_palabras text[];
begin
  if not public.tiene_algun_rol() or length(v_t) < 2 then return; end if;
  v_c := upper(regexp_replace(v_t, '\s+', '', 'g'));
  v_c := replace(replace(replace(v_c, '\', '\\'), '%', '\%'), '_', '\_');
  v_palabras := array(select replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_')
                      from unnest(regexp_split_to_array(v_t, '\s+')) w where w <> '');
  return query
  select x.codigo, x.descripcion, public.stock_de(x.codigo)
  from (
    select r.codigo, r.descripcion,
           (r.codigo_limpio like v_c || '%') as empieza,
           (r.codigo_limpio like '%' || v_c || '%') as contiene
    from public.repuestos r
    where not r.eliminado
      and (r.codigo_limpio like '%' || v_c || '%'
           or not exists (select 1 from unnest(v_palabras) w where r.descripcion not ilike '%' || w || '%'))
    order by 3 desc, 4 desc, r.codigo
    limit least(greatest(coalesce(p_limite, 12), 1), 50)
  ) x
  order by x.empieza desc, x.contiene desc, x.codigo;
end $$;

-- No se puede cargar en una OT un repuesto eliminado.
create or replace function public.repuesto_no_eliminado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.repuestos where codigo = new.codigo and eliminado) then
    raise exception 'El repuesto % fue eliminado: no se puede cargar', new.codigo;
  end if;
  return new;
end $$;
drop trigger if exists repuesto_ot_no_eliminado on public.repuestos_ot;
create trigger repuesto_ot_no_eliminado
  before insert on public.repuestos_ot
  for each row execute function public.repuesto_no_eliminado();

-- Eliminar: borra si nunca se usó; si tiene historial, lo oculta.
create or replace function public.eliminar_repuesto(p_codigo text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not (public.tiene_rol('DEPOSITO') or public.es_admin()) then
    raise exception 'Solo Depósito o Administrador pueden eliminar repuestos';
  end if;
  if not exists (select 1 from public.repuestos where codigo = p_codigo and not eliminado) then
    raise exception 'El repuesto no existe o ya fue eliminado';
  end if;
  if exists (select 1 from public.repuestos_ot where codigo = p_codigo)
     or exists (select 1 from public.movimientos_stock where codigo = p_codigo)
     or exists (select 1 from public.pedidos_repuesto where codigo = p_codigo) then
    update public.repuestos set eliminado = true where codigo = p_codigo;
    return 'OCULTO';
  end if;
  delete from public.repuestos where codigo = p_codigo;
  return 'BORRADO';
end $$;

revoke execute on function public.eliminar_repuesto(text), public.repuesto_no_eliminado() from public, anon;
grant execute on function public.eliminar_repuesto(text) to authenticated;
grant execute on function public.buscar_repuestos(text, integer), public.consultar_stock(text) to authenticated;

commit;

notify pgrst, 'reload schema';

select 'Paso 22 listo: eliminar repuestos' as resultado;
