-- =====================================================================
--  MDE Electromecánica · Sistema de Órdenes de Trabajo
--  Paso 13 · Parte diario (Oficina y Administrador)
--   - parte_diario(): OT activas con su tiempo en el taller, quién trabaja ahora,
--     pausas, repuestos pendientes y los números del día.
--   - Configuración de los colores: desde cuántos días una unidad pasa a amarillo y a rojo
--     (las cambia el Administrador desde la pantalla).
--  Se puede correr más de una vez sin problema.
-- =====================================================================
begin;

insert into public.configuracion (clave, valor, descripcion) values
  ('parte_dias_amarillo', '3', 'Parte diario: desde cuántos días en el taller la unidad se marca en amarillo'),
  ('parte_dias_rojo', '7', 'Parte diario: desde cuántos días en el taller la unidad se marca en rojo')
on conflict (clave) do nothing;

create or replace function public.parte_diario()
returns jsonb language plpgsql stable security definer set search_path = public as $$
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
             c.nombre as cliente, u.interno, u.dominio,
             nullif(concat_ws(' ', ma.nombre, mo.nombre), '') as unidad,
             (select count(*) from public.tareas_ot t where t.ot_id = o.id) as tareas,
             (select count(*) from public.tareas_ot t where t.ot_id = o.id and t.estado = 'HECHA') as tareas_hechas,
             (select string_agg(distinct us.nombre, ', ')
                from public.asignaciones a join public.tareas_ot t on t.id = a.tarea_id
                join public.usuarios us on us.id = a.mecanico_id
               where t.ot_id = o.id and t.estado <> 'HECHA') as mecanicos,
             (select string_agg(distinct us.nombre, ', ')
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
       where o.estado in ('ABIERTA', 'EN DIAGNÓSTICO', 'EN REPARACIÓN', 'ESPERANDO REPUESTOS')
    ) x), '[]'::jsonb));
end $$;

revoke execute on function public.parte_diario() from public, anon;
grant execute on function public.parte_diario() to authenticated;

commit;

select 'Paso 13 listo: parte diario' as resultado;
