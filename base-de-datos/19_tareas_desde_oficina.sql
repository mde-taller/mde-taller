-- =====================================================================
--  MDE Electromecánica · Sistema de Órdenes de Trabajo
--  Paso 19 · Oficina maneja las tareas de los mecánicos + comentario al pausar
--   - Oficina y Administrador pueden iniciar, pausar y terminar la tarea de un mecánico
--     desde la OT (corre el cronómetro de ese mecánico).
--   - Pausar una tarea (mecánico u oficina) pide un comentario obligatorio. El último
--     comentario queda en la tarea (tareas_ot.nota_pausa) y todo va al registro de la OT.
--  Se puede correr más de una vez sin problema.
-- =====================================================================
begin;

alter table public.tareas_ot add column if not exists nota_pausa text;

-- ---------- Funciones internas: hacen el trabajo para un mecánico dado ----------
create or replace function public.tarea_iniciar_de(p_tarea_id bigint, p_mec uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_motivo public.motivo_pausa;
begin
  if exists (select 1 from public.tareas_ot t join public.ordenes_trabajo o on o.id = t.ot_id
              where t.id = p_tarea_id and o.estado in ('CERRADA', 'PRUEBA')) then
    raise exception 'La OT está cerrada: no se pueden hacer cambios';
  end if;
  if exists (select 1 from public.tareas_ot where id = p_tarea_id and estado = 'HECHA') then
    raise exception 'La tarea ya está terminada';
  end if;
  select p.motivo into v_motivo from public.pausas_ot p join public.tareas_ot t on t.ot_id = p.ot_id
   where t.id = p_tarea_id and p.fin is null;
  if v_motivo is not null then
    raise exception 'La OT está pausada (%). Reanudala para seguir.', lower(public.texto_motivo(v_motivo));
  end if;
  insert into public.registros_tiempo (tarea_id, mecanico_id) values (p_tarea_id, p_mec) on conflict do nothing;
  update public.asignaciones set terminada_en = null where tarea_id = p_tarea_id and mecanico_id = p_mec;
  update public.tareas_ot set estado = 'EN CURSO', nota_pausa = null where id = p_tarea_id;
end $$;

create or replace function public.tarea_pausar_de(p_tarea_id bigint, p_mec uuid, p_comentario text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ot bigint; v_tarea text;
begin
  if nullif(trim(p_comentario), '') is null then raise exception 'Escribí por qué se pausa la tarea'; end if;
  if not exists (select 1 from public.registros_tiempo where tarea_id = p_tarea_id and mecanico_id = p_mec and fin is null) then
    raise exception 'La tarea no está en curso';
  end if;
  update public.registros_tiempo set fin = now() where tarea_id = p_tarea_id and mecanico_id = p_mec and fin is null;
  update public.tareas_ot set nota_pausa = trim(p_comentario) where id = p_tarea_id;
  if not exists (select 1 from public.registros_tiempo where tarea_id = p_tarea_id and fin is null) then
    update public.tareas_ot set estado = 'PAUSADA' where id = p_tarea_id and estado = 'EN CURSO';
  end if;
  select t.ot_id, t.renglon || '. ' || t.descripcion into v_ot, v_tarea from public.tareas_ot t where t.id = p_tarea_id;
  insert into public.historial_ot (ot_id, tipo, detalle, usuario_id)
  values (v_ot, 'PAUSA TAREA',
          v_tarea || case when p_mec <> auth.uid() then ' · de ' || public.nombre_visible_de(p_mec) else '' end
                  || ' · ' || trim(p_comentario),
          auth.uid());
end $$;

create or replace function public.tarea_terminar_de(p_tarea_id bigint, p_mec uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.tareas_ot t join public.ordenes_trabajo o on o.id = t.ot_id
              where t.id = p_tarea_id and o.estado in ('CERRADA', 'PRUEBA')) then
    raise exception 'La OT está cerrada: no se pueden hacer cambios';
  end if;
  update public.registros_tiempo set fin = now() where tarea_id = p_tarea_id and mecanico_id = p_mec and fin is null;
  update public.asignaciones set terminada_en = now() where tarea_id = p_tarea_id and mecanico_id = p_mec;
  if not exists (select 1 from public.asignaciones where tarea_id = p_tarea_id and terminada_en is null) then
    update public.tareas_ot set estado = 'HECHA', nota_pausa = null where id = p_tarea_id;
  elsif not exists (select 1 from public.registros_tiempo where tarea_id = p_tarea_id and fin is null) then
    update public.tareas_ot set estado = 'PAUSADA' where id = p_tarea_id;
  end if;
end $$;

revoke execute on function public.tarea_iniciar_de(bigint, uuid), public.tarea_pausar_de(bigint, uuid, text),
  public.tarea_terminar_de(bigint, uuid) from public, anon, authenticated;

-- ---------- Mecánico: su propia tarea ----------
create or replace function public.iniciar_tarea(p_tarea_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.asignaciones where tarea_id = p_tarea_id and mecanico_id = auth.uid()) then
    raise exception 'Esta tarea no está asignada a vos';
  end if;
  perform public.tarea_iniciar_de(p_tarea_id, auth.uid());
end $$;

drop function if exists public.pausar_tarea(bigint);
create or replace function public.pausar_tarea(p_tarea_id bigint, p_comentario text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.tarea_pausar_de(p_tarea_id, auth.uid(), p_comentario);
end $$;

create or replace function public.terminar_tarea(p_tarea_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.asignaciones where tarea_id = p_tarea_id and mecanico_id = auth.uid()) then
    raise exception 'Esta tarea no está asignada a vos';
  end if;
  perform public.tarea_terminar_de(p_tarea_id, auth.uid());
end $$;

-- ---------- Oficina / Administrador: la tarea de un mecánico ----------
create or replace function public.tarea_oficina(p_tarea_id bigint, p_mecanico_id uuid, p_accion text, p_comentario text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_ot bigint; v_tarea text; v_mec text;
begin
  if not public.es_oficina_o_admin() then raise exception 'Solo Oficina o Administrador pueden hacer esto'; end if;
  if not exists (select 1 from public.asignaciones where tarea_id = p_tarea_id and mecanico_id = p_mecanico_id) then
    raise exception 'Ese mecánico no está asignado a la tarea';
  end if;
  select t.ot_id, t.renglon || '. ' || t.descripcion into v_ot, v_tarea from public.tareas_ot t where t.id = p_tarea_id;
  v_mec := public.nombre_visible_de(p_mecanico_id);
  if p_accion = 'INICIAR' then
    perform public.tarea_iniciar_de(p_tarea_id, p_mecanico_id);
    insert into public.historial_ot (ot_id, tipo, detalle, usuario_id)
    values (v_ot, 'TAREA DESDE OFICINA', 'Inició ' || v_tarea || ' de ' || v_mec, auth.uid());
  elsif p_accion = 'PAUSAR' then
    perform public.tarea_pausar_de(p_tarea_id, p_mecanico_id, p_comentario);
  elsif p_accion = 'TERMINAR' then
    perform public.tarea_terminar_de(p_tarea_id, p_mecanico_id);
    insert into public.historial_ot (ot_id, tipo, detalle, usuario_id)
    values (v_ot, 'TAREA DESDE OFICINA', 'Terminó ' || v_tarea || ' de ' || v_mec, auth.uid());
  else
    raise exception 'Acción desconocida';
  end if;
end $$;

-- Cronómetros en marcha de una OT (para saber qué botones mostrar en Oficina).
create or replace function public.cronometros_ot(p_ot_id bigint)
returns table (tarea_id bigint, mecanico_id uuid, inicio timestamptz)
language sql stable security definer set search_path = public as $$
  select r.tarea_id, r.mecanico_id, r.inicio
    from public.registros_tiempo r join public.tareas_ot t on t.id = r.tarea_id
   where t.ot_id = p_ot_id and r.fin is null and public.es_oficina_o_admin();
$$;

revoke execute on function public.iniciar_tarea(bigint), public.pausar_tarea(bigint, text), public.terminar_tarea(bigint),
  public.tarea_oficina(bigint, uuid, text, text), public.cronometros_ot(bigint) from public, anon;
grant execute on function public.iniciar_tarea(bigint), public.pausar_tarea(bigint, text), public.terminar_tarea(bigint),
  public.tarea_oficina(bigint, uuid, text, text), public.cronometros_ot(bigint) to authenticated;

commit;

notify pgrst, 'reload schema';

select 'Paso 19 listo: tareas desde Oficina y comentario al pausar' as resultado;
