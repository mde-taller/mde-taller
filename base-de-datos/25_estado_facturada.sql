-- =====================================================================
--  MDE Electromecánica · Sistema de Órdenes de Trabajo
--  Paso 25 · Estado FACTURADA
--   - Nuevo estado de OT: FACTURADA (va entre FINALIZADA y CERRADA).
--   - Una OT facturada queda bloqueada: no se agregan, cambian ni quitan tareas, asignaciones,
--     repuestos, butacas ni pedidos, y los mecánicos no pueden iniciar trabajo. Para corregir algo,
--     primero se cambia el estado.
--   - Al pasar a FACTURADA se cierran los cronómetros que hubieran quedado abiertos y, si no tenía
--     fecha de finalización, se completa.
--  Se puede correr más de una vez sin problema.
-- =====================================================================
alter type public.estado_ot add value if not exists 'FACTURADA' after 'FINALIZADA';

begin;

-- Fecha de finalización y cronómetros según el estado.
create or replace function public.ot_fecha_finalizacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ahora timestamp := now() at time zone 'America/Argentina/Buenos_Aires';
begin
  if new.estado::text = 'FINALIZADA' then
    new.fecha_salida := v_ahora::date;
    new.hora_salida := date_trunc('minute', v_ahora)::time;
  elsif new.estado::text in ('FACTURADA', 'CERRADA') then
    if new.fecha_salida is null then
      new.fecha_salida := v_ahora::date;
      new.hora_salida := date_trunc('minute', v_ahora)::time;
    end if;
  elsif new.estado::text in ('ABIERTA', 'EN DIAGNÓSTICO', 'EN REPARACIÓN', 'ESPERANDO REPUESTOS')
        and old.estado::text in ('FINALIZADA', 'FACTURADA', 'CERRADA') then
    new.fecha_salida := null;
    new.hora_salida := null;
  end if;
  if new.estado::text = 'FACTURADA' then
    update public.registros_tiempo r set fin = now()
      from public.tareas_ot t
     where t.id = r.tarea_id and t.ot_id = new.id and r.fin is null;
  end if;
  return new;
end $$;

-- Bloqueo de una OT facturada (sirve para cualquier tabla que tenga ot_id o tarea_id).
create or replace function public.ot_bloqueo_facturada()
returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb; v_ot bigint; v_estado text;
begin
  if tg_op = 'DELETE' then j := to_jsonb(old); else j := to_jsonb(new); end if;
  v_ot := nullif(j ->> 'ot_id', '')::bigint;
  if v_ot is null and j ? 'tarea_id' then
    select t.ot_id into v_ot from public.tareas_ot t where t.id = nullif(j ->> 'tarea_id', '')::bigint;
  end if;
  if v_ot is not null then
    select o.estado::text into v_estado from public.ordenes_trabajo o where o.id = v_ot;
    if v_estado = 'FACTURADA' then
      raise exception 'La OT está facturada: no se pueden hacer cambios. Si hay que corregir algo, primero cambiá el estado de la OT.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke execute on function public.ot_bloqueo_facturada() from public, anon, authenticated;

drop trigger if exists bloqueo_facturada on public.tareas_ot;
create trigger bloqueo_facturada before insert or delete or update of descripcion, horas, cantidad, tempario_id
  on public.tareas_ot for each row execute function public.ot_bloqueo_facturada();
drop trigger if exists bloqueo_facturada on public.asignaciones;
create trigger bloqueo_facturada before insert or delete
  on public.asignaciones for each row execute function public.ot_bloqueo_facturada();
drop trigger if exists bloqueo_facturada on public.repuestos_ot;
create trigger bloqueo_facturada before insert or update or delete
  on public.repuestos_ot for each row execute function public.ot_bloqueo_facturada();
drop trigger if exists bloqueo_facturada on public.registros_tiempo;
create trigger bloqueo_facturada before insert
  on public.registros_tiempo for each row execute function public.ot_bloqueo_facturada();
drop trigger if exists bloqueo_facturada on public.butacas_tarea;
create trigger bloqueo_facturada before insert or update or delete
  on public.butacas_tarea for each row execute function public.ot_bloqueo_facturada();
drop trigger if exists bloqueo_facturada on public.pedidos_repuesto;
create trigger bloqueo_facturada before insert
  on public.pedidos_repuesto for each row execute function public.ot_bloqueo_facturada();
drop trigger if exists bloqueo_facturada on public.solicitudes;
create trigger bloqueo_facturada before insert
  on public.solicitudes for each row execute function public.ot_bloqueo_facturada();
drop trigger if exists bloqueo_facturada on public.pedidos_tarea;
create trigger bloqueo_facturada before insert
  on public.pedidos_tarea for each row execute function public.ot_bloqueo_facturada();

-- Parte diario: las facturadas también muestran su tiempo en el taller hasta la finalización.
CREATE OR REPLACE FUNCTION public.parte_diario(p_estado text default null)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tz  constant text := 'America/Argentina/Buenos_Aires';
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if not public.es_oficina_o_admin() then raise exception 'Solo Oficina o Administrador pueden ver el parte diario'; end if;
  return jsonb_build_object(
    'ahora', now(),
    'hoy', v_hoy,
    'dias_amarillo', coalesce((select valor from public.configuracion where clave = 'parte_dias_amarillo'), '3'),
    'dias_rojo', coalesce((select valor from public.configuracion where clave = 'parte_dias_rojo'), '7'),
    'ingresaron_hoy', (select count(*) from public.ordenes_trabajo where fecha_ingreso = v_hoy and estado <> 'PRUEBA'),
    'salieron_hoy', (select count(*) from public.ordenes_trabajo where fecha_salida = v_hoy and estado <> 'PRUEBA'),
    'finalizadas_hoy', (select count(distinct h.ot_id) from public.historial_ot h
                         where h.tipo = 'ESTADO' and h.detalle like '%→ FINALIZADA'
                           and (h.creado_en at time zone v_tz)::date = v_hoy),
    'mecanicos_trabajando', (select count(distinct r.mecanico_id) from public.registros_tiempo r
                              join public.tareas_ot t on t.id = r.tarea_id
                              join public.ordenes_trabajo o on o.id = t.ot_id
                             where r.fin is null and o.estado <> 'PRUEBA'),
    'ots', coalesce((select jsonb_agg(to_jsonb(x) order by x.ingreso, x.numero) from (
      select o.id, o.numero, o.estado::text as estado, o.tipo::text as tipo, o.km, o.observaciones,
             o.fecha_ingreso, o.hora_ingreso,
             ((o.fecha_ingreso + coalesce(o.hora_ingreso, time '00:00')) at time zone v_tz) as ingreso,
             case when o.fecha_salida is not null and o.estado in ('FINALIZADA', 'FACTURADA', 'CERRADA')
                  then ((o.fecha_salida + coalesce(o.hora_salida, time '00:00')) at time zone v_tz) end as salida,
             o.fecha_salida, o.hora_salida,
             c.nombre as cliente, u.interno, u.dominio,
             nullif(concat_ws(' ', ma.nombre, mo.nombre), '') as unidad,
             (select count(*) from public.tareas_ot t where t.ot_id = o.id) as tareas,
             (select count(*) from public.tareas_ot t where t.ot_id = o.id and t.estado = 'HECHA') as tareas_hechas,
             (select string_agg(distinct public.nombre_visible(us), ', ')
                from public.asignaciones a join public.tareas_ot t on t.id = a.tarea_id
                join public.usuarios us on us.id = a.mecanico_id
               where t.ot_id = o.id and (t.estado <> 'HECHA' or p_estado is not null)) as mecanicos,
             (select string_agg(distinct public.nombre_visible(us), ', ')
                from public.registros_tiempo r join public.tareas_ot t on t.id = r.tarea_id
                join public.usuarios us on us.id = r.mecanico_id
               where t.ot_id = o.id and r.fin is null) as trabajando,
             (select jsonb_build_object('motivo', public.texto_motivo(p.motivo), 'detalle', p.detalle, 'desde', p.inicio)
                from public.pausas_ot p where p.ot_id = o.id and p.fin is null limit 1) as pausa,
             (select max(r.inicio) from public.registros_tiempo r join public.tareas_ot t on t.id = r.tarea_id
               where t.ot_id = o.id) as ultimo_trabajo,
             (select count(*) from public.pedidos_repuesto pr where pr.ot_id = o.id and pr.estado = 'PENDIENTE') as pedidos_pendientes,
             (select count(*) from public.repuestos_ot ro where ro.ot_id = o.id and ro.estado = 'PENDIENTE') as repuestos_sin_entregar
        from public.ordenes_trabajo o
        left join public.clientes c on c.id = o.cliente_id
        left join public.unidades u on u.id = o.unidad_id
        left join public.marcas ma on ma.id = u.marca_id
        left join public.modelos mo on mo.id = u.modelo_id
       where (p_estado is null and o.estado in ('ABIERTA', 'EN DIAGNÓSTICO', 'EN REPARACIÓN', 'ESPERANDO REPUESTOS'))
          or (p_estado is not null and o.estado::text = p_estado)
    ) x), '[]'::jsonb));
end $function$;

revoke execute on function public.parte_diario(text) from public, anon;
grant execute on function public.parte_diario(text) to authenticated;

commit;

notify pgrst, 'reload schema';

select 'Paso 25 listo: estado FACTURADA' as resultado;
