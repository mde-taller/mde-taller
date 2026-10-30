-- =====================================================================
--  MDE Electromecánica · Sistema de Órdenes de Trabajo
--  Paso 23 · Pedidos de repuesto: modificar, entregar y cancelar
--   - Modificar un pedido pendiente (repuesto, cantidad, nota): Oficina, Depósito o Administrador.
--   - Entregar: Depósito o Administrador. Carga el repuesto en la OT ya entregado (descuenta stock)
--     y avisa a quien lo pidió. Se puede entregar una parte: el resto sigue pedido.
--   - Cancelar con motivo: Oficina, Depósito, Administrador o el mismo que lo pidió. Avisa a quien lo pidió.
--   - Todo queda en el registro de la OT.
--  Se puede correr más de una vez sin problema.
-- =====================================================================
begin;

alter table public.pedidos_repuesto add column if not exists repuesto_ot_id bigint references public.repuestos_ot (id) on delete set null;
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.pedidos_repuesto'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%estado%' and conname <> 'pedidos_repuesto_estado_valido'
  loop
    execute format('alter table public.pedidos_repuesto drop constraint %I', c);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'pedidos_repuesto_estado_valido') then
    alter table public.pedidos_repuesto add constraint pedidos_repuesto_estado_valido
      check (estado in ('PENDIENTE', 'RESUELTO', 'CANCELADO'));
  end if;
end $$;

-- ---------- Modificar ----------
create or replace function public.modificar_pedido_repuesto(p_id bigint, p_codigo text, p_descripcion text, p_cantidad numeric, p_detalle text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v public.pedidos_repuesto; v_cod text; v_desc text; v_antes text;
begin
  if not (public.es_oficina_o_admin() or public.tiene_rol('DEPOSITO')) then
    raise exception 'Solo Oficina, Depósito o Administrador pueden modificar pedidos';
  end if;
  select * into v from public.pedidos_repuesto where id = p_id for update;
  if v.id is null or v.estado <> 'PENDIENTE' then raise exception 'El pedido no existe o ya no está pendiente'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'La cantidad tiene que ser mayor a cero'; end if;
  if nullif(trim(p_codigo), '') is not null then
    select codigo, descripcion into v_cod, v_desc from public.repuestos
     where codigo_limpio = upper(regexp_replace(p_codigo, '\s+', '', 'g')) and not eliminado;
    if v_cod is null then raise exception 'No existe un repuesto con el código %', p_codigo; end if;
  end if;
  v_desc := coalesce(nullif(trim(p_descripcion), ''), v_desc);
  if v_desc is null then raise exception 'Escribí qué repuesto es'; end if;
  v_antes := v.descripcion || ' x ' || public.num_texto(v.cantidad);
  update public.pedidos_repuesto
     set codigo = v_cod, descripcion = v_desc, cantidad = p_cantidad, detalle = nullif(trim(p_detalle), '')
   where id = p_id;
  insert into public.historial_ot (ot_id, tipo, detalle, usuario_id)
  values (v.ot_id, 'PEDIDO MODIFICADO', v_antes || ' → ' || v_desc || coalesce(' (' || v_cod || ')', '') || ' x ' || public.num_texto(p_cantidad), auth.uid());
end $$;

-- ---------- Entregar (todo o una parte) ----------
create or replace function public.entregar_pedido_repuesto(p_id bigint, p_cantidad numeric default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare v public.pedidos_repuesto; v_cant numeric; v_ro bigint; v_numero integer; v_estado text;
begin
  if not (public.tiene_rol('DEPOSITO') or public.es_admin()) then
    raise exception 'Solo Depósito o Administrador entregan repuestos';
  end if;
  select * into v from public.pedidos_repuesto where id = p_id for update;
  if v.id is null or v.estado <> 'PENDIENTE' then raise exception 'El pedido no existe o ya no está pendiente'; end if;
  if v.codigo is null then raise exception 'El pedido no tiene código de repuesto: modificalo y elegí el repuesto de la lista'; end if;
  select numero, estado into v_numero, v_estado from public.ordenes_trabajo where id = v.ot_id;
  if v_estado in ('CERRADA', 'PRUEBA') then raise exception 'La OT está cerrada: no se pueden cargar repuestos'; end if;
  v_cant := coalesce(p_cantidad, v.cantidad);
  if v_cant <= 0 then raise exception 'La cantidad a entregar tiene que ser mayor a cero'; end if;
  if v_cant > v.cantidad then raise exception 'No podés entregar más de lo pedido (%)', public.num_texto(v.cantidad); end if;

  -- Se carga en la OT (descuenta stock; si no alcanza, da error y queda en Movimientos) y se marca entregado.
  perform set_config('mde.entrega_pedido', '1', true);   -- sin aviso de "repuesto para entregar"
  insert into public.repuestos_ot (ot_id, tarea_id, codigo, cantidad)
  values (v.ot_id, v.tarea_id, v.codigo, v_cant)
  returning id into v_ro;
  perform set_config('mde.entrega_pedido', '', true);
  update public.repuestos_ot set estado = 'ENTREGADO', entregado_por = auth.uid(), entregado_en = now() where id = v_ro;

  if v_cant < v.cantidad then
    update public.pedidos_repuesto set cantidad = cantidad - v_cant where id = p_id;
    insert into public.historial_ot (ot_id, tipo, detalle, usuario_id)
    values (v.ot_id, 'PEDIDO ENTREGADO', 'Entregó ' || public.num_texto(v_cant) || ' de ' || v.descripcion
            || '; siguen pedidos ' || public.num_texto(v.cantidad - v_cant), auth.uid());
  else
    update public.pedidos_repuesto
       set estado = 'RESUELTO', resuelto_por = auth.uid(), resuelto_en = now(), nota = 'Entregado', repuesto_ot_id = v_ro
     where id = p_id;
  end if;

  if v.pedido_por is not null and v.pedido_por is distinct from auth.uid() then
    insert into public.avisos (para_usuario, tipo, mensaje, ot_id)
    values (v.pedido_por, 'PEDIDO ENTREGADO',
            format('Depósito entregó %s x %s para %s%s', v.descripcion, public.num_texto(v_cant), public.numero_ot_texto(v_numero),
                   case when v_cant < v.cantidad then '. Faltan ' || public.num_texto(v.cantidad - v_cant) else '' end),
            v.ot_id);
  end if;
  return v_cant;
end $$;

-- ---------- Cancelar ----------
create or replace function public.cancelar_pedido_repuesto(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.pedidos_repuesto; v_numero integer;
begin
  select * into v from public.pedidos_repuesto where id = p_id for update;
  if v.id is null or v.estado <> 'PENDIENTE' then raise exception 'El pedido no existe o ya no está pendiente'; end if;
  if not (public.es_oficina_o_admin() or public.tiene_rol('DEPOSITO') or v.pedido_por = auth.uid()) then
    raise exception 'No tenés permiso para cancelar este pedido';
  end if;
  if nullif(trim(p_motivo), '') is null then raise exception 'Escribí por qué se cancela'; end if;
  update public.pedidos_repuesto
     set estado = 'CANCELADO', resuelto_por = auth.uid(), resuelto_en = now(), nota = trim(p_motivo)
   where id = p_id;
  select numero into v_numero from public.ordenes_trabajo where id = v.ot_id;
  if v.pedido_por is not null and v.pedido_por is distinct from auth.uid() then
    insert into public.avisos (para_usuario, tipo, mensaje, ot_id)
    values (v.pedido_por, 'PEDIDO CANCELADO',
            format('Se canceló el pedido de %s x %s para %s: %s', v.descripcion, public.num_texto(v.cantidad),
                   public.numero_ot_texto(v_numero), trim(p_motivo)),
            v.ot_id);
  end if;
end $$;

-- Al entregar un pedido no se avisa "repuesto para entregar".
CREATE OR REPLACE FUNCTION public.avisar_repuesto_pendiente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_desc text; v_nombre text; v_numero integer; v_dominio text; v_item text; v_n integer;
begin
  -- Si se carga al entregar un pedido a Depósito, ya está entregado: no hace falta avisar.
  if coalesce(current_setting('mde.entrega_pedido', true), '') = '1' then return new; end if;
  select descripcion into v_desc from public.repuestos where codigo = new.codigo;
  v_item := coalesce(v_desc, new.codigo) || ' (' || new.codigo || ') x ' || public.num_texto(new.cantidad);
  update public.avisos set mensaje = mensaje || '; ' || v_item
   where tipo = 'REPUESTO A ENTREGAR' and ot_id = new.ot_id and creado_en = now()
     and creado_por is not distinct from auth.uid();
  get diagnostics v_n = row_count;
  if v_n = 0 then
    v_nombre := public.nombre_visible_de(auth.uid());
    select o.numero, u.dominio into v_numero, v_dominio
      from public.ordenes_trabajo o join public.unidades u on u.id = o.unidad_id where o.id = new.ot_id;
    insert into public.avisos (para_rol, tipo, mensaje, ot_id, creado_por)
    select r, 'REPUESTO A ENTREGAR',
           format('%s cargó en %s (%s) para entregar: %s', coalesce(v_nombre, 'Alguien'),
                  public.numero_ot_texto(v_numero), v_dominio, v_item),
           new.ot_id, auth.uid()
    from unnest(array['OFICINA', 'DEPOSITO', 'ADMINISTRADOR']::public.rol_usuario[]) r;
  end if;
  return new;
end $function$;

-- Registro de la OT: los pedidos cancelados se muestran como cancelados.
CREATE OR REPLACE FUNCTION public.registro_ot(p_ot_id bigint)
 RETURNS TABLE(momento timestamp with time zone, hasta timestamp with time zone, tipo text, detalle text, usuario text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.es_admin() then raise exception 'Solo el Administrador puede ver el registro'; end if;
  return query
  select * from (
    -- Creación
    select o.creado_en, null::timestamptz, 'OT CREADA'::text,
           format('Ingreso %s%s · KM %s', to_char(o.fecha_ingreso, 'DD/MM/YYYY'), coalesce(' ' || to_char(o.hora_ingreso, 'HH24:MI'), ''), o.km)
             || coalesce(' · pedida por ' || public.nombre_registro(sol), ''),
           public.nombre_registro(cre)
      from public.ordenes_trabajo o
      left join public.usuarios cre on cre.id = o.creado_por
      left join public.usuarios sol on sol.id = o.solicitada_por
     where o.id = p_ot_id
    union all
    -- Cambios de estado y de fechas
    select h.creado_en, null, h.tipo, h.detalle, public.nombre_registro(u)
      from public.historial_ot h left join public.usuarios u on u.id = h.usuario_id
     where h.ot_id = p_ot_id
    union all
    -- Pausas de la OT (desde / hasta)
    select p.inicio, p.fin, 'PAUSA',
           public.texto_motivo(p.motivo) || coalesce(': ' || nullif(trim(p.detalle), ''), '')
             || case when p.fin is null then ' · sigue pausada' else coalesce(' · reanudó ' || public.nombre_registro(re), '') end,
           public.nombre_registro(pa)
      from public.pausas_ot p
      left join public.usuarios pa on pa.id = p.pausada_por
      left join public.usuarios re on re.id = p.reanudada_por
     where p.ot_id = p_ot_id
    union all
    -- Tramos de trabajo de cada mecánico (cronómetro)
    select r.inicio, r.fin, 'TRABAJO', t.renglon || '. ' || t.descripcion, public.nombre_registro(u)
      from public.registros_tiempo r
      join public.tareas_ot t on t.id = r.tarea_id
      left join public.usuarios u on u.id = r.mecanico_id
     where t.ot_id = p_ot_id
    union all
    -- Asignaciones y tareas terminadas
    select a.asignado_en, null, 'ASIGNACIÓN', t.renglon || '. ' || t.descripcion, public.nombre_registro(u)
      from public.asignaciones a join public.tareas_ot t on t.id = a.tarea_id left join public.usuarios u on u.id = a.mecanico_id
     where t.ot_id = p_ot_id
    union all
    select a.terminada_en, null, 'TAREA TERMINADA', t.renglon || '. ' || t.descripcion, public.nombre_registro(u)
      from public.asignaciones a join public.tareas_ot t on t.id = a.tarea_id left join public.usuarios u on u.id = a.mecanico_id
     where t.ot_id = p_ot_id and a.terminada_en is not null
    union all
    -- Repuestos
    select ro.cargado_en, null, 'REPUESTO CARGADO',
           coalesce(rp.descripcion, ro.codigo) || ' (' || ro.codigo || ') x ' || public.num_texto(ro.cantidad), public.nombre_registro(u)
      from public.repuestos_ot ro left join public.repuestos rp on rp.codigo = ro.codigo left join public.usuarios u on u.id = ro.cargado_por
     where ro.ot_id = p_ot_id
    union all
    select ro.entregado_en, null, 'REPUESTO ENTREGADO',
           coalesce(rp.descripcion, ro.codigo) || ' x ' || public.num_texto(ro.cantidad), public.nombre_registro(u)
      from public.repuestos_ot ro left join public.repuestos rp on rp.codigo = ro.codigo left join public.usuarios u on u.id = ro.entregado_por
     where ro.ot_id = p_ot_id and ro.entregado_en is not null
    union all
    select pr.creado_en, pr.resuelto_en, 'PEDIDO DE REPUESTO',
           pr.descripcion || ' x ' || public.num_texto(pr.cantidad)
             || case when pr.estado = 'RESUELTO' then ' · resuelto por ' || coalesce(public.nombre_registro(rs), '') || coalesce(': ' || pr.nota, '')
                     when pr.estado = 'CANCELADO' then ' · cancelado por ' || coalesce(public.nombre_registro(rs), '') || coalesce(': ' || pr.nota, '')
                     else ' · pendiente' end,
           public.nombre_registro(u)
      from public.pedidos_repuesto pr left join public.usuarios u on u.id = pr.pedido_por left join public.usuarios rs on rs.id = pr.resuelto_por
     where pr.ot_id = p_ot_id
    union all
    -- Solicitudes de tareas nuevas y pedidos de tareas sin asignar
    select s.creado_en, s.resuelta_en, 'TAREA SOLICITADA',
           s.tarea_propuesta || ' (falla: ' || s.falla || ') · ' || lower(s.estado::text)
             || coalesce(' por ' || public.nombre_registro(rs), '') || coalesce(': ' || s.motivo_rechazo, ''),
           public.nombre_registro(u)
      from public.solicitudes s left join public.usuarios u on u.id = s.mecanico_id left join public.usuarios rs on rs.id = s.resuelta_por
     where s.ot_id = p_ot_id
    union all
    select pt.creado_en, pt.resuelto_en, 'PIDIÓ TAREA',
           pt.descripcion || ' · ' || lower(pt.estado) || coalesce(' por ' || public.nombre_registro(rs), '') || coalesce(': ' || pt.motivo, ''),
           public.nombre_registro(u)
      from public.pedidos_tarea pt left join public.usuarios u on u.id = pt.mecanico_id left join public.usuarios rs on rs.id = pt.resuelto_por
     where pt.ot_id = p_ot_id
  ) x
  order by 1, 3;
end $function$;

revoke execute on function public.modificar_pedido_repuesto(bigint, text, text, numeric, text),
  public.entregar_pedido_repuesto(bigint, numeric), public.cancelar_pedido_repuesto(bigint, text) from public, anon;
grant execute on function public.modificar_pedido_repuesto(bigint, text, text, numeric, text),
  public.entregar_pedido_repuesto(bigint, numeric), public.cancelar_pedido_repuesto(bigint, text) to authenticated;
revoke execute on function public.registro_ot(bigint) from public, anon;
grant execute on function public.registro_ot(bigint) to authenticated;

commit;

notify pgrst, 'reload schema';

select 'Paso 23 listo: pedidos de repuesto (modificar, entregar, cancelar)' as resultado;
