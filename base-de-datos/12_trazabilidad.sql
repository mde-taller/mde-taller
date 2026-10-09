-- =====================================================================
--  MDE Electromecánica · Sistema de Órdenes de Trabajo
--  Paso 12 · Informe de trazabilidad (solo Administrador)
--   - informe_trazabilidad(desde, hasta): una fila por OT ingresada en el período, con
--     interno, patente, ingreso, egreso, estado, diagnóstico (tareas), observaciones,
--     mecánicos, horas de tempario, tiempo trabajado, tiempo en pausa (y por motivo),
--     primer trabajo, cuándo se finalizó y repuestos.
--  Se puede correr más de una vez sin problema.
-- =====================================================================
begin;

create or replace function public.informe_trazabilidad(p_desde date, p_hasta date)
returns table (
  id bigint, numero integer, cliente text, interno text, dominio text, unidad text, tipo text, estado text, km integer,
  fecha_ingreso date, hora_ingreso time, fecha_salida date, hora_salida time, creado_en timestamptz,
  diagnostico text, observaciones text, presupuesto text, ot_cliente text, nro_factura text, mecanicos text,
  tareas integer, tareas_hechas integer, horas_tempario numeric, minutos_trabajo numeric, minutos_pausa numeric,
  pausas_por_motivo jsonb, primer_trabajo timestamptz, finalizada_en timestamptz,
  repuestos integer, repuestos_pendientes integer, pausada_ahora text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'Solo el Administrador puede ver este informe'; end if;
  return query
  select o.id, o.numero, c.nombre, u.interno, u.dominio,
         nullif(concat_ws(' ', ma.nombre, mo.nombre), ''), o.tipo::text, o.estado::text, o.km,
         o.fecha_ingreso, o.hora_ingreso, o.fecha_salida, o.hora_salida, o.creado_en,
         (select string_agg(t.descripcion || case when t.cantidad <> 1 then ' x' || public.num_texto(t.cantidad) else '' end, ' · ' order by t.renglon)
            from public.tareas_ot t where t.ot_id = o.id),
         o.observaciones, o.presupuesto, o.ot_cliente, o.nro_factura,
         (select string_agg(distinct us.nombre, ', ')
            from public.asignaciones a join public.tareas_ot t on t.id = a.tarea_id join public.usuarios us on us.id = a.mecanico_id
           where t.ot_id = o.id),
         (select count(*)::int from public.tareas_ot t where t.ot_id = o.id),
         (select count(*)::int from public.tareas_ot t where t.ot_id = o.id and t.estado = 'HECHA'),
         (select coalesce(sum(t.horas_total), 0) from public.tareas_ot t where t.ot_id = o.id),
         (select coalesce(round(sum(extract(epoch from (coalesce(r.fin, now()) - r.inicio)) / 60)::numeric, 0), 0)
            from public.registros_tiempo r join public.tareas_ot t on t.id = r.tarea_id where t.ot_id = o.id),
         (select coalesce(round(sum(extract(epoch from (coalesce(p.fin, now()) - p.inicio)) / 60)::numeric, 0), 0)
            from public.pausas_ot p where p.ot_id = o.id),
         (select coalesce(jsonb_object_agg(m, minutos), '{}'::jsonb) from (
            select public.texto_motivo(p.motivo) as m,
                   round(sum(extract(epoch from (coalesce(p.fin, now()) - p.inicio)) / 60)::numeric, 0) as minutos
              from public.pausas_ot p where p.ot_id = o.id group by p.motivo) x),
         (select min(r.inicio) from public.registros_tiempo r join public.tareas_ot t on t.id = r.tarea_id where t.ot_id = o.id),
         (select min(h.creado_en) from public.historial_ot h where h.ot_id = o.id and h.tipo = 'ESTADO' and h.detalle like '%→ FINALIZADA'),
         (select count(*)::int from public.repuestos_ot ro where ro.ot_id = o.id),
         (select count(*)::int from public.repuestos_ot ro where ro.ot_id = o.id and ro.estado = 'PENDIENTE'),
         (select public.texto_motivo(p.motivo) from public.pausas_ot p where p.ot_id = o.id and p.fin is null limit 1)
    from public.ordenes_trabajo o
    left join public.clientes c on c.id = o.cliente_id
    left join public.unidades u on u.id = o.unidad_id
    left join public.marcas ma on ma.id = u.marca_id
    left join public.modelos mo on mo.id = u.modelo_id
   where o.fecha_ingreso between p_desde and p_hasta and o.estado <> 'PRUEBA'
   order by o.numero;
end $$;

revoke execute on function public.informe_trazabilidad(date, date) from public, anon;
grant execute on function public.informe_trazabilidad(date, date) to authenticated;

commit;

select 'Paso 12 listo: informe de trazabilidad' as resultado;
