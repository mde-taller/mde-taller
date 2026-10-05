-- =====================================================================
--  MDE Electromecánica · Sistema de Órdenes de Trabajo
--  Paso 6 · Mejoras pedidas
--   1. Cantidad por tarea (ej. "por lado" x 2): las horas se multiplican.
--   2. El mecánico pausa la OT con un motivo; si falta un repuesto, lo pide.
--   3. Pedidos de repuesto para Depósito y Administrador.
--   4. El mecánico pide una OT nueva; el Administrador la acepta o la rechaza.
--   5. Búsqueda de repuestos mientras se escribe (código o descripción).
--  Se puede correr más de una vez sin problema.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Cantidad por tarea
-- ---------------------------------------------------------------------
alter table public.tareas_ot add column if not exists cantidad numeric(8,2) not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tareas_ot_cantidad_positiva') then
    alter table public.tareas_ot add constraint tareas_ot_cantidad_positiva check (cantidad > 0);
  end if;
end $$;
-- Horas que se cobran = cantidad x horas del tempario
alter table public.tareas_ot add column if not exists horas_total numeric(10,2)
  generated always as (round(cantidad * coalesce(horas, 0), 2)) stored;

alter table public.solicitudes add column if not exists cantidad numeric(8,2) not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'solicitudes_cantidad_positiva') then
    alter table public.solicitudes add constraint solicitudes_cantidad_positiva check (cantidad > 0);
  end if;
end $$;

-- crear_ot ahora acepta "cantidad" en cada tarea:
--   p_tareas: [{"tempario_id": 12, "cantidad": 2}, {"descripcion": "Tarea a mano", "horas": 1.5, "cantidad": 1}]
create or replace function public.crear_ot(
  p_unidad_id     bigint,
  p_km            integer,
  p_tipo          public.tipo_unidad,
  p_tareas        jsonb default '[]'::jsonb,
  p_repuestos     jsonb default '[]'::jsonb,
  p_observaciones text default null,
  p_presupuesto   text default null,
  p_ot_cliente    text default null,
  p_hora_ingreso  time default null
) returns bigint language plpgsql security invoker set search_path = public as $$
declare v_ot bigint; t jsonb; r jsonb;
begin
  if not public.es_oficina_o_admin() then
    raise exception 'Solo Oficina o Administrador pueden crear OT';
  end if;
  if p_unidad_id is null or p_km is null or p_tipo is null then
    raise exception 'Faltan datos obligatorios: unidad, KM y tipo de unidad';
  end if;
  if coalesce(jsonb_array_length(p_tareas), 0) + coalesce(jsonb_array_length(p_repuestos), 0) = 0 then
    raise exception 'La OT necesita al menos un trabajo o un repuesto';
  end if;

  insert into public.ordenes_trabajo (unidad_id, km, tipo, observaciones, presupuesto, ot_cliente, hora_ingreso)
  values (p_unidad_id, p_km, p_tipo, p_observaciones, p_presupuesto, p_ot_cliente, p_hora_ingreso)
  returning id into v_ot;

  for t in select * from jsonb_array_elements(coalesce(p_tareas, '[]'::jsonb)) loop
    insert into public.tareas_ot (ot_id, tempario_id, descripcion, horas, cantidad)
    values (v_ot, nullif(t ->> 'tempario_id', '')::bigint, t ->> 'descripcion',
            nullif(t ->> 'horas', '')::numeric, coalesce(nullif(t ->> 'cantidad', '')::numeric, 1));
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_repuestos, '[]'::jsonb)) loop
    insert into public.repuestos_ot (ot_id, codigo, cantidad)
    values (v_ot, r ->> 'codigo', (r ->> 'cantidad')::numeric);
  end loop;

  return v_ot;
end $$;

-- La solicitud de tarea aprobada respeta la cantidad pedida.
create or replace function public.aprobar_solicitud(p_solicitud_id bigint, p_mecanicos uuid[] default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare s public.solicitudes; v_tarea bigint; m uuid; v_numero integer;
begin
  if not public.es_oficina_o_admin() then
    raise exception 'Solo Oficina o Administrador pueden aprobar solicitudes';
  end if;
  select * into s from public.solicitudes where id = p_solicitud_id for update;
  if s.id is null or s.estado <> 'PENDIENTE' then
    raise exception 'La solicitud no existe o ya fue resuelta';
  end if;
  insert into public.tareas_ot (ot_id, tempario_id, descripcion, cantidad)
  values (s.ot_id, s.tempario_id, case when s.tempario_id is null then s.tarea_propuesta end, s.cantidad)
  returning id into v_tarea;
  foreach m in array coalesce(p_mecanicos, array[]::uuid[]) loop
    insert into public.asignaciones (tarea_id, mecanico_id) values (v_tarea, m);
  end loop;
  update public.solicitudes
     set estado = 'APROBADA', resuelta_por = auth.uid(), resuelta_en = now(), tarea_creada_id = v_tarea
   where id = s.id;
  select numero into v_numero from public.ordenes_trabajo where id = s.ot_id;
  insert into public.avisos (para_usuario, tipo, mensaje, ot_id)
  values (s.mecanico_id, 'SOLICITUD APROBADA',
          format('Se aprobó tu solicitud en %s: %s', public.numero_ot_texto(v_numero), s.tarea_propuesta),
          s.ot_id);
  return v_tarea;
end $$;

-- ---------------------------------------------------------------------
-- 2 y 3. Pausas de OT y pedidos de repuesto
-- ---------------------------------------------------------------------
do $$ begin
  if to_regtype('public.motivo_pausa') is null then
    create type public.motivo_pausa as enum
      ('FALTA DE REPUESTO', 'ESPERA DEL CLIENTE', 'FIN DE JORNADA', 'TRABAJO EXTERNO', 'OTRO');
  end if;
end $$;

create table if not exists public.pausas_ot (
  id               bigint generated by default as identity primary key,
  ot_id            bigint not null references public.ordenes_trabajo (id) on delete cascade,
  motivo           public.motivo_pausa not null,
  detalle          text,
  pausada_por      uuid references public.usuarios (id),
  inicio           timestamptz not null default now(),
  fin              timestamptz,
  reanudada_por    uuid references public.usuarios (id),
  estado_anterior  public.estado_ot,
  constraint otro_con_detalle check (motivo <> 'OTRO' or coalesce(trim(detalle), '') <> '')
);
create unique index if not exists una_pausa_abierta_por_ot on public.pausas_ot (ot_id) where fin is null;

create table if not exists public.pedidos_repuesto (
  id           bigint generated by default as identity primary key,
  ot_id        bigint not null references public.ordenes_trabajo (id) on delete cascade,
  pausa_id     bigint references public.pausas_ot (id) on delete set null,
  tarea_id     bigint references public.tareas_ot (id) on delete set null,
  codigo       text references public.repuestos (codigo) on update cascade,  -- vacío si no está en la lista
  descripcion  text not null,
  cantidad     numeric(12,2) not null check (cantidad > 0),
  pedido_por   uuid references public.usuarios (id),
  creado_en    timestamptz not null default now(),
  estado       text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'RESUELTO')),
  resuelto_por uuid references public.usuarios (id),
  resuelto_en  timestamptz,
  nota         text
);
create index if not exists pedidos_pendientes on public.pedidos_repuesto (estado, creado_en);

create or replace function public.texto_motivo(m public.motivo_pausa)
returns text language sql immutable as $$
  select upper(left(m::text, 1)) || lower(substr(m::text, 2));
$$;

-- El mecánico asignado pausa la OT: se frenan todos los cronómetros de la OT.
-- Si el motivo es falta de repuesto, la OT pasa a ESPERANDO REPUESTOS y se crea el pedido.
--   p_repuestos: [{"texto": "A9061800109", "cantidad": 2}, {"texto": "Retén de piñón", "cantidad": 1}]
create or replace function public.pausar_ot(
  p_ot_id     bigint,
  p_motivo    public.motivo_pausa,
  p_detalle   text default null,
  p_repuestos jsonb default '[]'::jsonb,
  p_tarea_id  bigint default null
) returns bigint language plpgsql security definer set search_path = public as $$
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

  select nombre into v_nombre from public.usuarios where id = auth.uid();
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
end $$;

-- Reanudar: un mecánico de la OT, Oficina o Administrador.
create or replace function public.reanudar_ot(p_ot_id bigint)
returns void language plpgsql security definer set search_path = public as $$
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
    select nombre into v_nombre from public.usuarios where id = auth.uid();
    insert into public.avisos (para_rol, tipo, mensaje, ot_id)
    values ('OFICINA', 'OT REANUDADA',
            format('%s reanudó %s', coalesce(v_nombre, 'Un mecánico'), public.numero_ot_texto(v_numero)), p_ot_id);
  end if;
end $$;

-- Con la OT pausada no se puede iniciar ninguna tarea.
create or replace function public.iniciar_tarea(p_tarea_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_motivo public.motivo_pausa;
begin
  if not exists (select 1 from public.asignaciones where tarea_id = p_tarea_id and mecanico_id = auth.uid()) then
    raise exception 'Esta tarea no está asignada a vos';
  end if;
  if exists (select 1 from public.tareas_ot where id = p_tarea_id and estado = 'HECHA') then
    raise exception 'La tarea ya está terminada';
  end if;
  select p.motivo into v_motivo from public.pausas_ot p join public.tareas_ot t on t.ot_id = p.ot_id
   where t.id = p_tarea_id and p.fin is null;
  if v_motivo is not null then
    raise exception 'La OT está pausada (%). Reanudala para seguir.', lower(public.texto_motivo(v_motivo));
  end if;
  insert into public.registros_tiempo (tarea_id, mecanico_id)
  values (p_tarea_id, auth.uid())
  on conflict do nothing;
  update public.asignaciones set terminada_en = null where tarea_id = p_tarea_id and mecanico_id = auth.uid();
  update public.tareas_ot set estado = 'EN CURSO' where id = p_tarea_id;
end $$;

-- Depósito o Administrador marca el pedido como resuelto; le avisa al mecánico.
create or replace function public.resolver_pedido_repuesto(p_id bigint, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v public.pedidos_repuesto; v_numero integer;
begin
  if not (public.tiene_rol('DEPOSITO') or public.es_admin()) then
    raise exception 'Solo Depósito o Administrador pueden resolver pedidos';
  end if;
  select * into v from public.pedidos_repuesto where id = p_id for update;
  if v.id is null or v.estado <> 'PENDIENTE' then
    raise exception 'El pedido no existe o ya fue resuelto';
  end if;
  update public.pedidos_repuesto
     set estado = 'RESUELTO', resuelto_por = auth.uid(), resuelto_en = now(), nota = nullif(trim(p_nota), '')
   where id = p_id;
  select numero into v_numero from public.ordenes_trabajo where id = v.ot_id;
  if v.pedido_por is not null then
    insert into public.avisos (para_usuario, tipo, mensaje, ot_id)
    values (v.pedido_por, 'PEDIDO RESUELTO',
            format('Depósito: ya está %s x %s para %s%s', v.descripcion, public.num_texto(v.cantidad),
                   public.numero_ot_texto(v_numero), coalesce('. ' || nullif(trim(p_nota), ''), '')),
            v.ot_id);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. Solicitudes de OT del mecánico (las acepta el Administrador)
-- ---------------------------------------------------------------------
alter table public.ordenes_trabajo add column if not exists solicitada_por uuid references public.usuarios (id);

create table if not exists public.solicitudes_de_ot (
  id              bigint generated by default as identity primary key,
  mecanico_id     uuid not null default auth.uid() references public.usuarios (id),
  unidad_id       bigint references public.unidades (id),
  unidad_texto    text,              -- si la unidad no está cargada
  km              integer not null check (km >= 0),
  tipo            public.tipo_unidad not null,
  observaciones   text,
  tareas          jsonb not null default '[]'::jsonb,
  repuestos       jsonb not null default '[]'::jsonb,
  estado          public.estado_solicitud not null default 'PENDIENTE',
  motivo_rechazo  text,
  resuelta_por    uuid references public.usuarios (id),
  resuelta_en     timestamptz,
  ot_id           bigint references public.ordenes_trabajo (id) on delete set null,
  creado_en       timestamptz not null default now(),
  constraint con_unidad check (unidad_id is not null or coalesce(trim(unidad_texto), '') <> ''),
  constraint con_contenido check (jsonb_array_length(tareas) + jsonb_array_length(repuestos) > 0),
  constraint rechazo_ot_con_motivo check (estado <> 'RECHAZADA' or coalesce(trim(motivo_rechazo), '') <> '')
);
create index if not exists solicitudes_de_ot_estado on public.solicitudes_de_ot (estado, creado_en);

create or replace function public.avisar_solicitud_ot()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_nombre text; v_unidad text;
begin
  select nombre into v_nombre from public.usuarios where id = new.mecanico_id;
  select coalesce(u.dominio, new.unidad_texto) into v_unidad from (select 1) x
    left join public.unidades u on u.id = new.unidad_id;
  insert into public.avisos (para_rol, tipo, mensaje)
  values ('ADMINISTRADOR', 'SOLICITUD DE OT',
          format('%s pide una OT nueva para %s (%s trabajos, %s repuestos)', coalesce(v_nombre, 'Un mecánico'),
                 v_unidad, jsonb_array_length(new.tareas), jsonb_array_length(new.repuestos)));
  return new;
end $$;

drop trigger if exists solicitud_ot_avisar on public.solicitudes_de_ot;
create trigger solicitud_ot_avisar
  after insert on public.solicitudes_de_ot
  for each row execute function public.avisar_solicitud_ot();

-- El Administrador acepta: se crea la OT (con número) sin asignar. Puede ajustar los datos antes.
create or replace function public.aprobar_solicitud_ot(
  p_id            bigint,
  p_unidad_id     bigint default null,
  p_km            integer default null,
  p_tipo          public.tipo_unidad default null,
  p_tareas        jsonb default null,
  p_repuestos     jsonb default null,
  p_observaciones text default null
) returns bigint language plpgsql security definer set search_path = public as $$
declare s public.solicitudes_de_ot; v_unidad bigint; v_ot bigint; v_numero integer; v_dominio text;
begin
  if not public.es_admin() then
    raise exception 'Solo el Administrador puede aceptar solicitudes de OT';
  end if;
  select * into s from public.solicitudes_de_ot where id = p_id for update;
  if s.id is null or s.estado <> 'PENDIENTE' then
    raise exception 'La solicitud no existe o ya fue resuelta';
  end if;
  v_unidad := coalesce(p_unidad_id, s.unidad_id);
  if v_unidad is null then
    raise exception 'Elegí la unidad (el mecánico escribió: %)', s.unidad_texto;
  end if;
  v_ot := public.crear_ot(v_unidad, coalesce(p_km, s.km), coalesce(p_tipo, s.tipo),
                          coalesce(p_tareas, s.tareas), coalesce(p_repuestos, s.repuestos),
                          coalesce(p_observaciones, s.observaciones));
  update public.ordenes_trabajo set solicitada_por = s.mecanico_id where id = v_ot;
  update public.solicitudes_de_ot
     set estado = 'APROBADA', resuelta_por = auth.uid(), resuelta_en = now(), ot_id = v_ot, unidad_id = v_unidad
   where id = s.id;
  select o.numero, u.dominio into v_numero, v_dominio
    from public.ordenes_trabajo o join public.unidades u on u.id = o.unidad_id where o.id = v_ot;
  insert into public.avisos (para_usuario, tipo, mensaje, ot_id)
  values (s.mecanico_id, 'SOLICITUD DE OT APROBADA',
          format('Se aceptó tu pedido de OT para %s: es la %s', v_dominio, public.numero_ot_texto(v_numero)), v_ot);
  return v_ot;
end $$;

create or replace function public.rechazar_solicitud_ot(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare s public.solicitudes_de_ot; v_unidad text;
begin
  if not public.es_admin() then
    raise exception 'Solo el Administrador puede rechazar solicitudes de OT';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Escribí el motivo del rechazo';
  end if;
  select * into s from public.solicitudes_de_ot where id = p_id for update;
  if s.id is null or s.estado <> 'PENDIENTE' then
    raise exception 'La solicitud no existe o ya fue resuelta';
  end if;
  update public.solicitudes_de_ot
     set estado = 'RECHAZADA', motivo_rechazo = trim(p_motivo), resuelta_por = auth.uid(), resuelta_en = now()
   where id = s.id;
  select coalesce(u.dominio, s.unidad_texto) into v_unidad from (select 1) x
    left join public.unidades u on u.id = s.unidad_id;
  insert into public.avisos (para_usuario, tipo, mensaje)
  values (s.mecanico_id, 'SOLICITUD DE OT RECHAZADA',
          format('Se rechazó tu pedido de OT para %s. Motivo: %s', v_unidad, trim(p_motivo)));
end $$;

-- ---------------------------------------------------------------------
-- 5. Búsqueda de repuestos mientras se escribe
-- ---------------------------------------------------------------------
-- Busca por código (con o sin espacios, en cualquier parte) o por palabras de la descripción.
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
    where r.codigo_limpio like '%' || v_c || '%'
       or not exists (select 1 from unnest(v_palabras) w where r.descripcion not ilike '%' || w || '%')
    order by 3 desc, 4 desc, r.codigo
    limit least(greatest(coalesce(p_limite, 12), 1), 50)
  ) x
  order by x.empieza desc, x.contiene desc, x.codigo;
end $$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
alter table public.pausas_ot        enable row level security;
alter table public.pedidos_repuesto enable row level security;
alter table public.solicitudes_de_ot   enable row level security;

drop policy if exists ver on public.pausas_ot;
create policy ver on public.pausas_ot for select to authenticated
  using (public.ve_todas_las_ot() or public.mecanico_en_ot(ot_id));

drop policy if exists ver on public.pedidos_repuesto;
create policy ver on public.pedidos_repuesto for select to authenticated
  using (public.ve_todas_las_ot() or pedido_por = auth.uid() or public.mecanico_en_ot(ot_id));

drop policy if exists ver on public.solicitudes_de_ot;
create policy ver on public.solicitudes_de_ot for select to authenticated
  using (mecanico_id = auth.uid() or public.es_admin());
drop policy if exists crear on public.solicitudes_de_ot;
create policy crear on public.solicitudes_de_ot for insert to authenticated
  with check (mecanico_id = auth.uid() and estado = 'PENDIENTE' and public.tiene_rol('MECANICO'));

revoke all on public.pausas_ot, public.pedidos_repuesto, public.solicitudes_de_ot from anon;
grant select on public.pausas_ot, public.pedidos_repuesto to authenticated;
grant select, insert on public.solicitudes_de_ot to authenticated;
grant usage, select on all sequences in schema public to authenticated;

revoke execute on function public.pausar_ot(bigint, public.motivo_pausa, text, jsonb, bigint),
  public.reanudar_ot(bigint), public.resolver_pedido_repuesto(bigint, text),
  public.aprobar_solicitud_ot(bigint, bigint, integer, public.tipo_unidad, jsonb, jsonb, text),
  public.rechazar_solicitud_ot(bigint, text), public.buscar_repuestos(text, integer),
  public.texto_motivo(public.motivo_pausa), public.avisar_solicitud_ot()
  from public, anon;
grant execute on function public.pausar_ot(bigint, public.motivo_pausa, text, jsonb, bigint),
  public.reanudar_ot(bigint), public.resolver_pedido_repuesto(bigint, text),
  public.aprobar_solicitud_ot(bigint, bigint, integer, public.tipo_unidad, jsonb, jsonb, text),
  public.rechazar_solicitud_ot(bigint, text), public.buscar_repuestos(text, integer),
  public.texto_motivo(public.motivo_pausa)
  to authenticated;

commit;

select 'Paso 6 listo: mejoras aplicadas' as resultado;
