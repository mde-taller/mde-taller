-- =====================================================================
--  MDE Electromecánica · Sistema de Órdenes de Trabajo
--  Paso 15 · Fecha y hora de finalización
--   - Lo que antes era "fecha/hora de salida" pasa a ser la fecha y hora de finalización de la OT
--     (mismas columnas fecha_salida / hora_salida).
--   - Se completa sola al pasar la OT a FINALIZADA (hora de Argentina). Al pasar a CERRADA sin fecha, también.
--   - Si la OT vuelve a un estado activo (abierta, en diagnóstico, en reparación, esperando repuestos), se borra.
--   - El registro de la OT lo anota como "Fecha de finalización".
--  Se puede correr más de una vez sin problema.
-- =====================================================================
begin;

create or replace function public.ot_fecha_finalizacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ahora timestamp := now() at time zone 'America/Argentina/Buenos_Aires';
begin
  if new.estado = 'FINALIZADA' then
    new.fecha_salida := v_ahora::date;
    new.hora_salida := date_trunc('minute', v_ahora)::time;
  elsif new.estado = 'CERRADA' then
    if new.fecha_salida is null then
      new.fecha_salida := v_ahora::date;
      new.hora_salida := date_trunc('minute', v_ahora)::time;
    end if;
  elsif new.estado in ('ABIERTA', 'EN DIAGNÓSTICO', 'EN REPARACIÓN', 'ESPERANDO REPUESTOS')
        and old.estado in ('FINALIZADA', 'CERRADA') then
    new.fecha_salida := null;
    new.hora_salida := null;
  end if;
  return new;
end $$;

drop trigger if exists ot_fecha_finalizacion on public.ordenes_trabajo;
create trigger ot_fecha_finalizacion
  before update on public.ordenes_trabajo
  for each row when (old.estado is distinct from new.estado)
  execute function public.ot_fecha_finalizacion();

-- El registro de cambios anota "fecha de finalización" en lugar de "salida".
create or replace function public.registrar_cambio_ot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado is distinct from old.estado then
    insert into public.historial_ot (ot_id, tipo, detalle, usuario_id)
    values (new.id, 'ESTADO', old.estado || ' → ' || new.estado, auth.uid());
  end if;
  if new.fecha_ingreso is distinct from old.fecha_ingreso or new.hora_ingreso is distinct from old.hora_ingreso then
    insert into public.historial_ot (ot_id, tipo, detalle, usuario_id)
    values (new.id, 'INGRESO',
            format('Cambió la fecha de ingreso: %s → %s',
                   concat_ws(' ', to_char(old.fecha_ingreso, 'DD/MM/YYYY'), to_char(old.hora_ingreso, 'HH24:MI')),
                   concat_ws(' ', to_char(new.fecha_ingreso, 'DD/MM/YYYY'), to_char(new.hora_ingreso, 'HH24:MI'))), auth.uid());
  end if;
  if new.fecha_salida is distinct from old.fecha_salida or new.hora_salida is distinct from old.hora_salida then
    insert into public.historial_ot (ot_id, tipo, detalle, usuario_id)
    values (new.id, 'SALIDA',
            case when new.fecha_salida is null then 'Se borró la fecha de finalización'
                 else 'Fecha de finalización: ' || concat_ws(' ', to_char(new.fecha_salida, 'DD/MM/YYYY'), to_char(new.hora_salida, 'HH24:MI')) end,
            auth.uid());
  end if;
  return new;
end $$;

revoke execute on function public.ot_fecha_finalizacion() from public, anon, authenticated;

commit;

select 'Paso 15 listo: fecha y hora de finalización' as resultado;
