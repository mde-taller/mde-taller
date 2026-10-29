-- =====================================================================
--  MDE Electromecánica · Sistema de Órdenes de Trabajo
--  Paso 17 · Fecha y hora de iniciación
--   - Nuevas columnas ordenes_trabajo.fecha_inicio / hora_inicio (hora de Argentina).
--   - Se completan solas la primera vez que un mecánico inicia una tarea de la OT
--     (primer registro del cronómetro). No se vuelven a cambiar.
--   - Las OT que ya tenían trabajo cargado toman la fecha y hora del primer registro.
--  Se puede correr más de una vez sin problema.
-- =====================================================================
begin;

alter table public.ordenes_trabajo add column if not exists fecha_inicio date;
alter table public.ordenes_trabajo add column if not exists hora_inicio time;

create or replace function public.ot_fecha_iniciacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_local timestamp := new.inicio at time zone 'America/Argentina/Buenos_Aires';
begin
  update public.ordenes_trabajo o
     set fecha_inicio = v_local::date,
         hora_inicio  = date_trunc('minute', v_local)::time
    from public.tareas_ot t
   where t.id = new.tarea_id and o.id = t.ot_id and o.fecha_inicio is null;
  return new;
end $$;

drop trigger if exists ot_fecha_iniciacion on public.registros_tiempo;
create trigger ot_fecha_iniciacion
  after insert on public.registros_tiempo
  for each row execute function public.ot_fecha_iniciacion();

revoke execute on function public.ot_fecha_iniciacion() from public, anon, authenticated;

-- OT anteriores: el primer registro del cronómetro.
update public.ordenes_trabajo o
   set fecha_inicio = (p.primero at time zone 'America/Argentina/Buenos_Aires')::date,
       hora_inicio  = date_trunc('minute', p.primero at time zone 'America/Argentina/Buenos_Aires')::time
  from (select t.ot_id, min(r.inicio) as primero
          from public.registros_tiempo r join public.tareas_ot t on t.id = r.tarea_id
         group by t.ot_id) p
 where p.ot_id = o.id and o.fecha_inicio is null;

commit;

notify pgrst, 'reload schema';

select 'Paso 17 listo: fecha y hora de iniciación' as resultado;
