-- =====================================================================
--  MDE Electromecánica · Sistema de Órdenes de Trabajo
--  Paso 14 · Ayudantes
--   - Un usuario puede ser "ayudante de" otro (usuarios.responsable_id). Lo marca el Administrador.
--   - En pantallas, avisos e informes el trabajo del ayudante figura a nombre del responsable.
--   - Lo guardado no cambia: cada registro sigue con quien lo hizo de verdad. El registro de la OT
--     (solo Administrador) muestra "Responsable (lo hizo Ayudante, ayudante)".
--  Se puede correr más de una vez sin problema.
-- =====================================================================
begin;

alter table public.usuarios add column if not exists responsable_id uuid references public.usuarios (id) on delete set null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'usuarios_responsable_distinto') then
    alter table public.usuarios add constraint usuarios_responsable_distinto check (responsable_id is null or responsable_id <> id);
  end if;
end $$;

-- Nombre que se muestra: el del responsable si el usuario es ayudante (también sirve como columna en la app: usuarios(nombre_visible)).
create or replace function public.nombre_visible(u public.usuarios)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select r.nombre from public.usuarios r where r.id = u.responsable_id), u.nombre);
$$;
create or replace function public.id_visible(u public.usuarios)
returns uuid language sql stable as $$ select coalesce(u.responsable_id, u.id); $$;
create or replace function public.nombre_visible_de(p_usuario uuid)
returns text language sql stable security definer set search_path = public as $$
  select public.nombre_visible(u) from public.usuarios u where u.id = p_usuario;
$$;
create or replace function public.id_visible_de(p_usuario uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(u.responsable_id, u.id) from public.usuarios u where u.id = p_usuario;
$$;
-- Para el registro de la OT (Administrador): "Emiliano (lo hizo Carlos, ayudante)".
create or replace function public.nombre_registro(u public.usuarios)
returns text language sql stable security definer set search_path = public as $$
  select case when u.responsable_id is null then u.nombre
              else public.nombre_visible(u) || ' (lo hizo ' || u.nombre || ', ayudante)' end;
$$;

-- Horas reales: a nombre del responsable (y su id, para agrupar).
create or replace view public.horas_reales with (security_invoker = true) as
select rt.tarea_id,
       t.ot_id,
       rt.mecanico_id,
       public.nombre_visible_de(rt.mecanico_id) as mecanico,
       round(sum(extract(epoch from (coalesce(rt.fin, now()) - rt.inicio))) / 3600.0, 2) as horas_reales,
       bool_or(rt.fin is null) as en_curso,
       public.id_visible_de(rt.mecanico_id) as responsable_id
from public.registros_tiempo rt
join public.tareas_ot t on t.id = rt.tarea_id
group by rt.tarea_id, t.ot_id, rt.mecanico_id;


-- avisar_repuesto_pendiente: el aviso usa el nombre del responsable
CREATE OR REPLACE FUNCTION public.avisar_repuesto_pendiente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_desc text; v_nombre text; v_numero integer; v_dominio text; v_item text; v_n integer;
begin
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

-- avisar_solicitud_nueva: el aviso usa el nombre del responsable
CREATE OR REPLACE FUNCTION public.avisar_solicitud_nueva()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_numero integer; v_nombre text;
begin
  select numero into v_numero from public.ordenes_trabajo where id = new.ot_id;
  v_nombre := public.nombre_visible_de(new.mecanico_id);
  insert into public.avisos (para_rol, tipo, mensaje, ot_id)
  values ('OFICINA', 'SOLICITUD NUEVA',
          format('%s pide agregar a %s: %s', coalesce(v_nombre, 'Un mecánico'),
                 public.numero_ot_texto(v_numero), new.tarea_propuesta),
          new.ot_id);
  return new;
end $function$;

-- avisar_solicitud_ot: el aviso usa el nombre del responsable
CREATE OR REPLACE FUNCTION public.avisar_solicitud_ot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_nombre text; v_unidad text;
begin
  v_nombre := public.nombre_visible_de(new.mecanico_id);
  select coalesce(u.dominio, new.unidad_texto) into v_unidad from (select 1) x
    left join public.unidades u on u.id = new.unidad_id;
  insert into public.avisos (para_rol, tipo, mensaje)
  values ('ADMINISTRADOR', 'SOLICITUD DE OT',
          format('%s pide una OT nueva para %s (%s trabajos, %s repuestos)', coalesce(v_nombre, 'Un mecánico'),
                 v_unidad, jsonb_array_length(new.tareas), jsonb_array_length(new.repuestos)));
  return new;
end $function$;

-- movimiento_repuesto_ot: el aviso usa el nombre del responsable
CREATE OR REPLACE FUNCTION public.movimiento_repuesto_ot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_desc text; v_numero integer; v_nombre text;
begin
  if tg_op = 'INSERT' then
    insert into public.movimientos_stock (tipo, codigo, cantidad, ot_id, repuesto_ot_id, usuario_id)
    values ('SALIDA', new.codigo, new.cantidad, new.ot_id, new.id, auth.uid());
    return new;
  end if;

  select numero into v_numero from public.ordenes_trabajo where id = coalesce(new.ot_id, old.ot_id);
  v_nombre := public.nombre_visible_de(auth.uid());

  if tg_op = 'UPDATE' then
    update public.movimientos_stock
       set codigo = new.codigo, cantidad = new.cantidad
     where repuesto_ot_id = new.id;
    if not public.es_oficina_o_admin() and (new.cantidad <> old.cantidad or new.codigo <> old.codigo) then
      select descripcion into v_desc from public.repuestos where codigo = new.codigo;
      insert into public.avisos (para_rol, tipo, mensaje, ot_id)
      select r, 'REPUESTO MODIFICADO',
             format('%s modificó un repuesto en %s: %s (%s), cantidad %s → %s',
                    coalesce(v_nombre, 'Un usuario'), public.numero_ot_texto(v_numero),
                    v_desc, new.codigo, public.num_texto(old.cantidad), public.num_texto(new.cantidad)),
             new.ot_id
      from unnest(array['OFICINA', 'ADMINISTRADOR']::public.rol_usuario[]) r;
    end if;
    return new;
  end if;

  -- DELETE: el movimiento de salida se borra solo (el stock vuelve).
  if not public.es_oficina_o_admin() and auth.uid() is not null then
    select descripcion into v_desc from public.repuestos where codigo = old.codigo;
    insert into public.avisos (para_rol, tipo, mensaje, ot_id)
    select r, 'REPUESTO QUITADO',
           format('%s quitó un repuesto de %s: %s (%s), cantidad %s',
                  coalesce(v_nombre, 'Un usuario'), public.numero_ot_texto(v_numero),
                  v_desc, old.codigo, public.num_texto(old.cantidad)),
           old.ot_id
    from unnest(array['OFICINA', 'ADMINISTRADOR']::public.rol_usuario[]) r
    where exists (select 1 from public.ordenes_trabajo where id = old.ot_id);
  end if;
  return old;
end $function$;

-- pausar_ot: el aviso usa el nombre del responsable
CREATE OR REPLACE FUNCTION public.pausar_ot(p_ot_id bigint, p_motivo motivo_pausa, p_detalle text DEFAULT NULL::text, p_repuestos jsonb DEFAULT '[]'::jsonb, p_tarea_id bigint DEFAULT NULL::bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ot public.ordenes_trabajo; v_pausa bigint; v_nombre text; r jsonb; v_cod text; v_desc text;
        v_texto text; v_cant numeric; v_lista text := ''; v_nro text; v_det text := nullif(trim(p_detalle), '');
begin
  if not public.tiene_rol('MECANICO') or not public.mecanico_en_ot(p_ot_id) then
    raise exception 'Solo un mecánico asignado a esta OT puede pausarla';
  end if;
  select * into v_ot from public.ordenes_trabajo where id = p_ot_id for update;
  if v_ot.estado in ('CERRADA', 'PRUEBA') then
    raise exception 'La OT está cerrada: no se puede pausar';
  end if;
  if exists (select 1 from public.pausas_ot where ot_id = p_ot_id and fin is null) then
    raise exception 'La OT ya está pausada';
  end if;
  if p_motivo = 'OTRO' and v_det is null then
    raise exception 'Escribí el motivo de la pausa';
  end if;
  if p_motivo = 'FALTA DE REPUESTO' and coalesce(jsonb_array_length(p_repuestos), 0) = 0 then
    raise exception 'Indicá qué repuesto falta';
  end if;

  insert into public.pausas_ot (ot_id, motivo, detalle, pausada_por, estado_anterior)
  values (p_ot_id, p_motivo, v_det, auth.uid(), v_ot.estado)
  returning id into v_pausa;

  update public.registros_tiempo set fin = now()
   where fin is null and tarea_id in (select id from public.tareas_ot where ot_id = p_ot_id);
  update public.tareas_ot set estado = 'PAUSADA' where ot_id = p_ot_id and estado = 'EN CURSO';

  if p_motivo = 'FALTA DE REPUESTO' then
    update public.ordenes_trabajo set estado = 'ESPERANDO REPUESTOS' where id = p_ot_id;
    for r in select * from jsonb_array_elements(p_repuestos) loop
      v_cod := null; v_desc := null;
      v_texto := nullif(trim(coalesce(r ->> 'texto', r ->> 'codigo', r ->> 'descripcion', '')), '');
      v_cant := coalesce(nullif(r ->> 'cantidad', '')::numeric, 1);
      if v_texto is null then raise exception 'Indicá qué repuesto falta'; end if;
      if v_cant <= 0 then raise exception 'La cantidad pedida tiene que ser mayor a cero'; end if;
      select codigo, descripcion into v_cod, v_desc from public.repuestos
       where codigo_limpio = upper(regexp_replace(coalesce(r ->> 'codigo', v_texto), '\s+', '', 'g'));
      if v_cod is null then v_desc := v_texto; end if;
      insert into public.pedidos_repuesto (ot_id, pausa_id, tarea_id, codigo, descripcion, cantidad, pedido_por)
      values (p_ot_id, v_pausa, p_tarea_id, v_cod, v_desc, v_cant, auth.uid());
      v_lista := v_lista || case when v_lista = '' then '' else '; ' end
                 || v_desc || coalesce(' (' || v_cod || ')', '') || ' x ' || public.num_texto(v_cant);
    end loop;
  end if;

  v_nombre := public.nombre_visible_de(auth.uid());
  v_nro := public.numero_ot_texto(v_ot.numero);
  if p_motivo = 'FALTA DE REPUESTO' then
    insert into public.avisos (para_rol, tipo, mensaje, ot_id)
    select x, 'PEDIDO DE REPUESTO',
           format('%s pide para %s: %s%s', coalesce(v_nombre, 'Un mecánico'), v_nro, v_lista,
                  coalesce('. Nota: ' || v_det, '')),
           p_ot_id
    from unnest(array['DEPOSITO', 'ADMINISTRADOR']::public.rol_usuario[]) x;
    insert into public.avisos (para_rol, tipo, mensaje, ot_id)
    values ('OFICINA', 'OT PAUSADA',
            format('%s pausó %s: falta de repuesto (%s)', coalesce(v_nombre, 'Un mecánico'), v_nro, v_lista), p_ot_id);
  else
    insert into public.avisos (para_rol, tipo, mensaje, ot_id)
    select x, 'OT PAUSADA',
           format('%s pausó %s: %s%s', coalesce(v_nombre, 'Un mecánico'), v_nro,
                  lower(public.texto_motivo(p_motivo)), coalesce(' (' || v_det || ')', '')),
           p_ot_id
    from unnest(array['OFICINA', 'ADMINISTRADOR']::public.rol_usuario[]) x;
  end if;
  return v_pausa;
end $function$;

-- reanudar_ot: el aviso usa el nombre del responsable
CREATE OR REPLACE FUNCTION public.reanudar_ot(p_ot_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_p public.pausas_ot; v_estado public.estado_ot; v_numero integer; v_nombre text;
begin
  if not (public.mecanico_en_ot(p_ot_id) or public.es_oficina_o_admin()) then
    raise exception 'No tenés permiso para reanudar esta OT';
  end if;
  select * into v_p from public.pausas_ot where ot_id = p_ot_id and fin is null for update;
  if v_p.id is null then raise exception 'La OT no está pausada'; end if;
  update public.pausas_ot set fin = now(), reanudada_por = auth.uid() where id = v_p.id;
  select estado, numero into v_estado, v_numero from public.ordenes_trabajo where id = p_ot_id;
  if v_p.motivo = 'FALTA DE REPUESTO' and v_estado = 'ESPERANDO REPUESTOS' and v_p.estado_anterior is not null then
    update public.ordenes_trabajo set estado = v_p.estado_anterior where id = p_ot_id;
  end if;
  if not public.es_oficina_o_admin() then
    v_nombre := public.nombre_visible_de(auth.uid());
    insert into public.avisos (para_rol, tipo, mensaje, ot_id)
    values ('OFICINA', 'OT REANUDADA',
            format('%s reanudó %s', coalesce(v_nombre, 'Un mecánico'), public.numero_ot_texto(v_numero)), p_ot_id);
  end if;
end $function$;

-- guardar_butacas: el aviso usa el nombre del responsable
CREATE OR REPLACE FUNCTION public.guardar_butacas(p_tarea_id bigint, p_butacas jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_t public.tareas_ot; v_estado public.estado_ot; v_numero integer; v_previas integer; v_n integer;
        r jsonb; v_nombre text; v_lista text;
begin
  select * into v_t from public.tareas_ot where id = p_tarea_id for update;
  if v_t.id is null then raise exception 'La tarea no existe'; end if;
  if not (public.mecanico_en_tarea(p_tarea_id) or public.es_oficina_o_admin()) then
    raise exception 'No tenés permiso para cargar butacas en esta tarea';
  end if;
  select estado, numero into v_estado, v_numero from public.ordenes_trabajo where id = v_t.ot_id;
  if v_estado in ('CERRADA', 'PRUEBA') then
    raise exception 'La OT está cerrada: no se pueden hacer cambios';
  end if;

  select count(*) into v_previas from public.butacas_tarea where tarea_id = p_tarea_id;
  delete from public.butacas_tarea where tarea_id = p_tarea_id;
  for r in select * from jsonb_array_elements(coalesce(p_butacas, '[]'::jsonb)) loop
    if jsonb_array_length(coalesce(r -> 'trabajos', '[]'::jsonb)) = 0 then
      raise exception 'Indicá qué se le hizo a la butaca %', r ->> 'butaca';
    end if;
    insert into public.butacas_tarea (tarea_id, butaca, trabajos, cargado_por)
    values (p_tarea_id, upper(trim(r ->> 'butaca')),
            array(select x from (select distinct jsonb_array_elements_text(r -> 'trabajos') as x) d
                  order by array_position(array['REEMPLAZO', 'REPARACION', 'CAMBIO DE REPUESTO',
                                                'COLOCACION DE CINTO', 'REEMPLAZO DE CINTO'], x)),
            auth.uid());
  end loop;

  -- Cada butaca suma 1 a la cantidad (si se borran todas, vuelve a 1).
  select count(*) into v_n from public.butacas_tarea where tarea_id = p_tarea_id;
  if v_n > 0 then
    update public.tareas_ot set cantidad = v_n where id = p_tarea_id and cantidad <> v_n;
  elsif v_previas > 0 then
    update public.tareas_ot set cantidad = 1 where id = p_tarea_id and cantidad <> 1;
  end if;

  if not public.es_oficina_o_admin() then
    v_nombre := public.nombre_visible_de(auth.uid());
    select string_agg(case butaca when 'COND' then 'conductor' else butaca end || ': ' || public.texto_trabajos_butaca(trabajos), '; '
                      order by case butaca when 'COND' then 0 else butaca::int end)
      into v_lista from public.butacas_tarea where tarea_id = p_tarea_id;
    insert into public.avisos (para_rol, tipo, mensaje, ot_id, creado_por)
    select x, 'BUTACAS',
           format('%s marcó %s butaca%s en %s (%s)%s. Cantidad de la tarea: %s', coalesce(v_nombre, 'Un mecánico'),
                  v_n, case when v_n = 1 then '' else 's' end, public.numero_ot_texto(v_numero), v_t.descripcion,
                  coalesce(': ' || v_lista, ''), case when v_n > 0 then v_n else 1 end),
           v_t.ot_id, auth.uid()
    from unnest(array['OFICINA', 'ADMINISTRADOR']::public.rol_usuario[]) x;
  end if;
  return v_n;
end $function$;

-- pedir_repuesto: el aviso usa el nombre del responsable
CREATE OR REPLACE FUNCTION public.pedir_repuesto(p_ot_id bigint, p_codigo text, p_cantidad numeric, p_tarea_id bigint DEFAULT NULL::bigint, p_detalle text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ot public.ordenes_trabajo; v_cod text; v_desc text; v_id bigint; v_nombre text; v_dominio text;
        v_det text := nullif(trim(p_detalle), '');
begin
  if not (public.mecanico_en_ot(p_ot_id) or public.es_oficina_o_admin()) then
    raise exception 'No tenés permiso para pedir repuestos para esta OT';
  end if;
  select * into v_ot from public.ordenes_trabajo where id = p_ot_id;
  if v_ot.id is null then raise exception 'La OT no existe'; end if;
  if v_ot.estado in ('CERRADA', 'PRUEBA') then
    raise exception 'La OT está cerrada: no se pueden pedir repuestos';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad pedida tiene que ser mayor a cero';
  end if;
  if p_tarea_id is not null and not exists (select 1 from public.tareas_ot where id = p_tarea_id and ot_id = p_ot_id) then
    raise exception 'La tarea no pertenece a esa OT';
  end if;
  select codigo, descripcion into v_cod, v_desc from public.repuestos
   where codigo_limpio = upper(regexp_replace(coalesce(p_codigo, ''), '\s+', '', 'g'));
  if v_cod is null then
    raise exception 'No existe un repuesto con el código %', p_codigo;
  end if;

  insert into public.pedidos_repuesto (ot_id, tarea_id, codigo, descripcion, cantidad, pedido_por, detalle)
  values (p_ot_id, p_tarea_id, v_cod, v_desc, p_cantidad, auth.uid(), v_det)
  returning id into v_id;

  v_nombre := public.nombre_visible_de(auth.uid());
  select dominio into v_dominio from public.unidades where id = v_ot.unidad_id;
  insert into public.avisos (para_rol, tipo, mensaje, ot_id, creado_por)
  select x, 'PEDIDO DE REPUESTO',
         format('%s pide para %s (%s): %s (%s) x %s. Stock actual: %s%s',
                coalesce(v_nombre, 'Alguien'), public.numero_ot_texto(v_ot.numero), v_dominio,
                v_desc, v_cod, public.num_texto(p_cantidad), public.num_texto(public.stock_de(v_cod)),
                coalesce('. Nota: ' || v_det, '')),
         p_ot_id, auth.uid()
  from unnest(array['DEPOSITO', 'ADMINISTRADOR']::public.rol_usuario[]) x;
  return v_id;
end $function$;

-- pedir_tarea: el aviso usa el nombre del responsable
CREATE OR REPLACE FUNCTION public.pedir_tarea(p_tarea_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_t public.tareas_ot; v_ot public.ordenes_trabajo; v_dominio text; v_nombre text; v_id bigint;
begin
  if not public.tiene_rol('MECANICO') then raise exception 'Solo los mecánicos pueden pedir tareas'; end if;
  select * into v_t from public.tareas_ot where id = p_tarea_id for update;
  if v_t.id is null then raise exception 'La tarea no existe'; end if;
  select * into v_ot from public.ordenes_trabajo where id = v_t.ot_id;
  if v_ot.estado in ('FINALIZADA', 'CERRADA', 'PRUEBA') then
    raise exception 'La OT está finalizada o cerrada: no se pueden pedir tareas';
  end if;
  if v_t.estado = 'HECHA' then raise exception 'La tarea ya está hecha'; end if;
  if exists (select 1 from public.asignaciones where tarea_id = p_tarea_id) then
    raise exception 'La tarea ya tiene un mecánico asignado';
  end if;
  if exists (select 1 from public.pedidos_tarea where tarea_id = p_tarea_id and mecanico_id = auth.uid() and estado = 'PENDIENTE') then
    raise exception 'Ya pediste esta tarea: espera la aprobación';
  end if;
  select dominio into v_dominio from public.unidades where id = v_ot.unidad_id;
  insert into public.pedidos_tarea (tarea_id, mecanico_id, ot_id, ot_numero, descripcion, dominio)
  values (p_tarea_id, auth.uid(), v_ot.id, v_ot.numero, v_t.descripcion, v_dominio)
  returning id into v_id;
  v_nombre := public.nombre_visible_de(auth.uid());
  insert into public.avisos (para_rol, tipo, mensaje, ot_id, creado_por)
  select x, 'PEDIDO DE TAREA',
         format('%s pide hacer "%s" en %s (%s)', coalesce(v_nombre, 'Un mecánico'), v_t.descripcion,
                public.numero_ot_texto(v_ot.numero), v_dominio),
         v_ot.id, auth.uid()
  from unnest(array['OFICINA', 'ADMINISTRADOR']::public.rol_usuario[]) x;
  return v_id;
end $function$;

-- resolver_pedido_tarea: el aviso usa el nombre del responsable
CREATE OR REPLACE FUNCTION public.resolver_pedido_tarea(p_id bigint, p_aprobar boolean, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.pedidos_tarea; v_estado public.estado_ot; v_nombre text; r record;
begin
  if not public.es_oficina_o_admin() then raise exception 'Solo Oficina o Administrador pueden resolver pedidos de tareas'; end if;
  select * into v from public.pedidos_tarea where id = p_id for update;
  if v.id is null or v.estado <> 'PENDIENTE' then raise exception 'El pedido no existe o ya fue resuelto'; end if;
  if p_aprobar then
    select o.estado into v_estado from public.tareas_ot t join public.ordenes_trabajo o on o.id = t.ot_id where t.id = v.tarea_id;
    if v_estado in ('FINALIZADA', 'CERRADA', 'PRUEBA') then
      raise exception 'La OT está finalizada o cerrada: no se puede asignar';
    end if;
    insert into public.asignaciones (tarea_id, mecanico_id) values (v.tarea_id, v.mecanico_id) on conflict do nothing;
    update public.pedidos_tarea set estado = 'APROBADO', resuelto_por = auth.uid(), resuelto_en = now() where id = p_id;
    insert into public.avisos (para_usuario, tipo, mensaje, ot_id)
    values (v.mecanico_id, 'TAREA ASIGNADA',
            format('Te asignaron "%s" en %s (%s)', v.descripcion, public.numero_ot_texto(v.ot_numero), v.dominio), v.ot_id);
    -- Los demás que la habían pedido quedan rechazados.
    v_nombre := public.nombre_visible_de(v.mecanico_id);
    for r in
      update public.pedidos_tarea
         set estado = 'RECHAZADO', motivo = 'Se le asignó a ' || coalesce(v_nombre, 'otro mecánico'),
             resuelto_por = auth.uid(), resuelto_en = now()
       where tarea_id = v.tarea_id and estado = 'PENDIENTE' and id <> p_id
      returning mecanico_id
    loop
      insert into public.avisos (para_usuario, tipo, mensaje, ot_id)
      values (r.mecanico_id, 'PEDIDO DE TAREA RECHAZADO',
              format('No se te asignó "%s" en %s: se le asignó a %s', v.descripcion,
                     public.numero_ot_texto(v.ot_numero), coalesce(v_nombre, 'otro mecánico')), v.ot_id);
    end loop;
  else
    if nullif(trim(p_motivo), '') is null then raise exception 'Escribí el motivo del rechazo'; end if;
    update public.pedidos_tarea set estado = 'RECHAZADO', motivo = trim(p_motivo), resuelto_por = auth.uid(), resuelto_en = now()
     where id = p_id;
    insert into public.avisos (para_usuario, tipo, mensaje, ot_id)
    values (v.mecanico_id, 'PEDIDO DE TAREA RECHAZADO',
            format('No se aprobó tu pedido de "%s" en %s: %s', v.descripcion, public.numero_ot_texto(v.ot_numero), trim(p_motivo)),
            v.ot_id);
  end if;
end $function$;

-- ot_taller_json: asignados con el nombre del responsable
CREATE OR REPLACE FUNCTION public.ot_taller_json(p_ot_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', o.id, 'numero', o.numero, 'estado', o.estado, 'tipo', o.tipo, 'fecha_ingreso', o.fecha_ingreso,
    'km', o.km, 'observaciones', o.observaciones, 'dominio', u.dominio, 'interno', u.interno,
    'cliente', c.nombre, 'marca', ma.nombre, 'modelo', mo.nombre,
    'pausa', (select p.motivo from public.pausas_ot p where p.ot_id = o.id and p.fin is null limit 1),
    'tareas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'renglon', t.renglon, 'descripcion', t.descripcion, 'estado', t.estado, 'cantidad', t.cantidad,
        'asignados', coalesce((select jsonb_agg(distinct public.nombre_visible(us) order by public.nombre_visible(us))
                                 from public.asignaciones a join public.usuarios us on us.id = a.mecanico_id
                                where a.tarea_id = t.id), '[]'::jsonb),
        'mia', exists (select 1 from public.asignaciones a where a.tarea_id = t.id and a.mecanico_id = auth.uid()),
        'pedida', exists (select 1 from public.pedidos_tarea pt where pt.tarea_id = t.id
                           and pt.mecanico_id = auth.uid() and pt.estado = 'PENDIENTE')
      ) order by t.renglon) from public.tareas_ot t where t.ot_id = o.id), '[]'::jsonb))
  from public.ordenes_trabajo o
  left join public.unidades u on u.id = o.unidad_id
  left join public.clientes c on c.id = o.cliente_id
  left join public.marcas ma on ma.id = u.marca_id
  left join public.modelos mo on mo.id = u.modelo_id
  where o.id = p_ot_id;
$function$;

-- informe_trazabilidad: mecánicos con el nombre del responsable
CREATE OR REPLACE FUNCTION public.informe_trazabilidad(p_desde date, p_hasta date)
 RETURNS TABLE(id bigint, numero integer, cliente text, interno text, dominio text, unidad text, tipo text, estado text, km integer, fecha_ingreso date, hora_ingreso time without time zone, fecha_salida date, hora_salida time without time zone, creado_en timestamp with time zone, diagnostico text, observaciones text, presupuesto text, ot_cliente text, nro_factura text, mecanicos text, tareas integer, tareas_hechas integer, horas_tempario numeric, minutos_trabajo numeric, minutos_pausa numeric, pausas_por_motivo jsonb, primer_trabajo timestamp with time zone, finalizada_en timestamp with time zone, repuestos integer, repuestos_pendientes integer, pausada_ahora text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.es_admin() then raise exception 'Solo el Administrador puede ver este informe'; end if;
  return query
  select o.id, o.numero, c.nombre, u.interno, u.dominio,
         nullif(concat_ws(' ', ma.nombre, mo.nombre), ''), o.tipo::text, o.estado::text, o.km,
         o.fecha_ingreso, o.hora_ingreso, o.fecha_salida, o.hora_salida, o.creado_en,
         (select string_agg(t.descripcion || case when t.cantidad <> 1 then ' x' || public.num_texto(t.cantidad) else '' end, ' · ' order by t.renglon)
            from public.tareas_ot t where t.ot_id = o.id),
         o.observaciones, o.presupuesto, o.ot_cliente, o.nro_factura,
         (select string_agg(distinct public.nombre_visible(us), ', ')
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
end $function$;

-- parte_diario: mecánicos con el nombre del responsable
CREATE OR REPLACE FUNCTION public.parte_diario()
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
             c.nombre as cliente, u.interno, u.dominio,
             nullif(concat_ws(' ', ma.nombre, mo.nombre), '') as unidad,
             (select count(*) from public.tareas_ot t where t.ot_id = o.id) as tareas,
             (select count(*) from public.tareas_ot t where t.ot_id = o.id and t.estado = 'HECHA') as tareas_hechas,
             (select string_agg(distinct public.nombre_visible(us), ', ')
                from public.asignaciones a join public.tareas_ot t on t.id = a.tarea_id
                join public.usuarios us on us.id = a.mecanico_id
               where t.ot_id = o.id and t.estado <> 'HECHA') as mecanicos,
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
       where o.estado in ('ABIERTA', 'EN DIAGNÓSTICO', 'EN REPARACIÓN', 'ESPERANDO REPUESTOS')
    ) x), '[]'::jsonb));
end $function$;

-- reporte_pausas: quién pausó / reanudó con el nombre del responsable
CREATE OR REPLACE FUNCTION public.reporte_pausas(p_desde date, p_hasta date)
 RETURNS TABLE(ot_id bigint, ot_numero integer, dominio text, cliente text, motivo text, detalle text, pauso text, reanudo text, inicio timestamp with time zone, fin timestamp with time zone, minutos numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.es_admin() then raise exception 'Solo el Administrador puede ver este reporte'; end if;
  return query
  select o.id, o.numero, u.dominio, c.nombre, public.texto_motivo(p.motivo), p.detalle,
         public.nombre_visible(pa), public.nombre_visible(re), p.inicio, p.fin,
         round((extract(epoch from (coalesce(p.fin, now()) - p.inicio)) / 60)::numeric, 0)
    from public.pausas_ot p
    join public.ordenes_trabajo o on o.id = p.ot_id
    left join public.unidades u on u.id = o.unidad_id
    left join public.clientes c on c.id = o.cliente_id
    left join public.usuarios pa on pa.id = p.pausada_por
    left join public.usuarios re on re.id = p.reanudada_por
   where (p.inicio at time zone 'America/Argentina/Buenos_Aires')::date between p_desde and p_hasta
   order by p.inicio;
end $function$;

-- registro_ot (solo Administrador): el responsable y, entre paréntesis, quién lo hizo
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
             || case when pr.estado = 'RESUELTO' then ' · resuelto por ' || coalesce(public.nombre_registro(rs), '') else ' · pendiente' end,
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

revoke execute on function public.nombre_visible(public.usuarios), public.id_visible(public.usuarios), public.nombre_visible_de(uuid),
  public.id_visible_de(uuid), public.nombre_registro(public.usuarios) from public, anon;
grant execute on function public.nombre_visible(public.usuarios), public.id_visible(public.usuarios), public.nombre_visible_de(uuid),
  public.id_visible_de(uuid) to authenticated;
revoke execute on function public.nombre_registro(public.usuarios) from authenticated;

commit;

select 'Paso 14 listo: ayudantes' as resultado;
