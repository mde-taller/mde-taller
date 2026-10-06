-- =====================================================================
--  MDE Electromecánica · Sistema de Órdenes de Trabajo
--  Paso 7 · Repuestos pendientes de entrega
--   - Todo repuesto que se carga en una OT queda PENDIENTE (el stock se descuenta al cargarlo).
--   - Se avisa a Oficina, Depósito y Administrador.
--   - Depósito o Administrador lo marcan ENTREGADO; se avisa a quien lo cargó.
--  Se puede correr más de una vez sin problema.
-- =====================================================================
begin;

alter table public.repuestos_ot add column if not exists estado text not null default 'PENDIENTE';
alter table public.repuestos_ot add column if not exists entregado_por uuid references public.usuarios (id);
alter table public.repuestos_ot add column if not exists entregado_en timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'repuestos_ot_estado_valido') then
    alter table public.repuestos_ot add constraint repuestos_ot_estado_valido check (estado in ('PENDIENTE', 'ENTREGADO'));
    -- Los repuestos cargados antes de este cambio se consideran entregados.
    update public.repuestos_ot set estado = 'ENTREGADO', entregado_en = cargado_en where estado = 'PENDIENTE';
  end if;
end $$;
create index if not exists repuestos_ot_pendientes on public.repuestos_ot (estado) where estado = 'PENDIENTE';

-- Control al cargar o modificar un repuesto de OT.
create or replace function public.controlar_stock_repuesto_ot()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_disponible numeric; v_ot bigint;
begin
  if tg_op = 'INSERT' then
    -- Todo repuesto nuevo queda pendiente de entrega.
    new.estado := 'PENDIENTE'; new.entregado_por := null; new.entregado_en := null;
  elsif new.estado is distinct from old.estado then
    if not (public.tiene_rol('DEPOSITO') or public.es_admin()) then
      raise exception 'Solo Depósito o Administrador marcan la entrega de repuestos';
    end if;
    if new.codigo = old.codigo and new.cantidad = old.cantidad then
      return new;  -- solo cambia la entrega: no toca el stock
    end if;
  end if;

  if new.tarea_id is not null then
    select ot_id into v_ot from public.tareas_ot where id = new.tarea_id;
    if v_ot is distinct from new.ot_id then
      raise exception 'La tarea no pertenece a esa OT';
    end if;
  end if;
  -- Bloquea el repuesto para que dos cargas simultáneas no pasen el stock.
  perform 1 from public.repuestos where codigo = new.codigo for update;
  v_disponible := public.stock_de(new.codigo);
  if tg_op = 'UPDATE' and old.codigo = new.codigo then
    v_disponible := v_disponible + old.cantidad;
  end if;
  if new.cantidad > v_disponible then
    raise exception 'Stock insuficiente de %: disponible %, pedido %',
      new.codigo, public.num_texto(v_disponible), public.num_texto(new.cantidad)
      using errcode = 'P0001', hint = 'STOCK_INSUFICIENTE';
  end if;
  if tg_op = 'UPDATE' then
    new.modificado_por := auth.uid();
    new.modificado_en := now();
  end if;
  return new;
end $$;

-- Aviso a Oficina, Depósito y Administrador por cada carga.
-- Si en la misma operación se cargan varios repuestos de la misma OT, se juntan en un solo aviso.
create or replace function public.avisar_repuesto_pendiente()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_desc text; v_nombre text; v_numero integer; v_dominio text; v_item text; v_n integer;
begin
  select descripcion into v_desc from public.repuestos where codigo = new.codigo;
  v_item := coalesce(v_desc, new.codigo) || ' (' || new.codigo || ') x ' || public.num_texto(new.cantidad);
  update public.avisos set mensaje = mensaje || '; ' || v_item
   where tipo = 'REPUESTO A ENTREGAR' and ot_id = new.ot_id and creado_en = now()
     and creado_por is not distinct from auth.uid();
  get diagnostics v_n = row_count;
  if v_n = 0 then
    select nombre into v_nombre from public.usuarios where id = auth.uid();
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
end $$;

drop trigger if exists repuesto_ot_avisar on public.repuestos_ot;
create trigger repuesto_ot_avisar
  after insert on public.repuestos_ot
  for each row execute function public.avisar_repuesto_pendiente();

-- Depósito o Administrador marcan entregados uno o varios repuestos.
create or replace function public.entregar_repuestos(p_ids bigint[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer; r record;
begin
  if not (public.tiene_rol('DEPOSITO') or public.es_admin()) then
    raise exception 'Solo Depósito o Administrador marcan la entrega de repuestos';
  end if;
  create temp table if not exists _entregados (id bigint, ot_id bigint, cargado_por uuid, codigo text, cantidad numeric) on commit drop;
  truncate _entregados;  -- (Supabase no permite DELETE sin WHERE)
  with x as (
    update public.repuestos_ot
       set estado = 'ENTREGADO', entregado_por = auth.uid(), entregado_en = now()
     where id = any(p_ids) and estado = 'PENDIENTE'
    returning id, ot_id, cargado_por, codigo, cantidad
  )
  insert into _entregados select * from x;
  get diagnostics v_n = row_count;
  -- Un aviso por persona y OT a quien cargó el repuesto (si no es quien entrega).
  for r in
    select e.cargado_por, e.ot_id, o.numero,
           string_agg(coalesce(p.descripcion, e.codigo) || ' x ' || public.num_texto(e.cantidad), '; ') as lista
    from _entregados e
    join public.ordenes_trabajo o on o.id = e.ot_id
    left join public.repuestos p on p.codigo = e.codigo
    where e.cargado_por is not null and e.cargado_por is distinct from auth.uid()
    group by e.cargado_por, e.ot_id, o.numero
  loop
    insert into public.avisos (para_usuario, tipo, mensaje, ot_id)
    values (r.cargado_por, 'REPUESTO ENTREGADO',
            format('Depósito entregó para %s: %s', public.numero_ot_texto(r.numero), r.lista), r.ot_id);
  end loop;
  return v_n;
end $$;

revoke execute on function public.entregar_repuestos(bigint[]), public.avisar_repuesto_pendiente() from public, anon;
grant execute on function public.entregar_repuestos(bigint[]) to authenticated;

commit;

select 'Paso 7 listo: repuestos pendientes de entrega' as resultado;
