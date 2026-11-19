-- =====================================================================
--  MDE Electromecánica · Sistema de Órdenes de Trabajo
--  Paso 28 · Precios en la OT (repuestos y mano de obra)
--   - Mano de obra = horas de tempario × valor hora (sin IVA).
--       · Valor hora general: configuración "valor_hora_mano_obra" ($ 180.000).
--       · Recargo por cliente (% sobre el valor hora): TSB, IND, TN y VDN +20 %.
--         Solo el Administrador lo cambia.
--   - Precio de cada repuesto en la OT (sin IVA), en este orden:
--       1. el que se escribió a mano en esa OT,
--       2. el precio de lista del repuesto (lista_precios),
--       3. el último costo de compra (de las órdenes de compra aprobadas)
--          más el % de recargo de la configuración "recargo_repuestos".
--   - Dos casillas por OT para elegir si en la OT impresa / PDF salen
--     los precios de repuestos y la mano de obra (IVA 21 % al pie).
--   - Al pasar la OT a FACTURADA se fijan el valor hora y los precios
--     propuestos: si después cambia la lista o el valor hora, esa OT no cambia.
--  Correr después del paso 27. Se puede correr más de una vez sin problema.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Configuración
-- ---------------------------------------------------------------------
insert into public.configuracion (clave, valor, descripcion)
values ('valor_hora_mano_obra', '180000', 'Valor de la hora de mano de obra, sin IVA')
on conflict (clave) do update
  set valor = coalesce(nullif(trim(public.configuracion.valor), ''), excluded.valor),
      descripcion = excluded.descripcion;
insert into public.configuracion (clave, valor, descripcion)
values ('recargo_repuestos', null, '% de recargo sobre el último costo de compra para proponer el precio de un repuesto')
on conflict (clave) do nothing;

-- Número de la configuración (vacío o mal escrito → null).
create or replace function public.config_numero(p_clave text)
returns numeric language sql stable security definer set search_path = public as $$
  select case when trim(valor) ~ '^\d+([.,]\d+)?$' then replace(trim(valor), ',', '.')::numeric end
  from public.configuracion where clave = p_clave;
$$;

-- ---------------------------------------------------------------------
-- 2. Recargo de mano de obra por cliente
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'clientes' and column_name = 'recargo_mano_obra') then
    alter table public.clientes add column recargo_mano_obra numeric(6,2) not null default 0
      constraint clientes_recargo_mo check (recargo_mano_obra >= 0 and recargo_mano_obra <= 500);
    -- Valor inicial (solo la primera vez): estas empresas pagan un 20 % más la hora.
    update public.clientes set recargo_mano_obra = 20 where upper(trim(nombre)) in ('TSB', 'IND', 'TN', 'VDN');
  end if;
end $$;

-- El recargo lo cambia solo el Administrador.
create or replace function public.cliente_recargo_solo_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.recargo_mano_obra <> 0) or
     (tg_op = 'UPDATE' and new.recargo_mano_obra is distinct from old.recargo_mano_obra) then
    if auth.uid() is not null and not public.es_admin() then
      raise exception 'El recargo de mano de obra del cliente lo cambia solo el Administrador';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.cliente_recargo_solo_admin() from public, anon, authenticated;
drop trigger if exists recargo_solo_admin on public.clientes;
create trigger recargo_solo_admin before insert or update on public.clientes
  for each row execute function public.cliente_recargo_solo_admin();

-- Valor hora que se le cobra a un cliente (sin IVA). Null si no hay valor hora configurado.
create or replace function public.valor_hora_cliente(p_cliente bigint)
returns numeric language sql stable security definer set search_path = public as $$
  select round(public.config_numero('valor_hora_mano_obra') * (1 + coalesce(c.recargo_mano_obra, 0) / 100), 2)
  from (select 1) x left join public.clientes c on c.id = p_cliente;
$$;

-- ---------------------------------------------------------------------
-- 3. Lista de precios de venta (sin IVA)
-- ---------------------------------------------------------------------
create table if not exists public.lista_precios (
  codigo          text primary key references public.repuestos (codigo) on update cascade on delete cascade,
  precio          numeric(14,2) not null check (precio > 0),
  actualizado_por uuid references public.usuarios (id) default auth.uid(),
  actualizado_en  timestamptz not null default now()
);

-- Último costo de compra de un repuesto (OC aprobadas, sin IVA).
create or replace function public.costo_ultimo_repuesto(p_codigo text)
returns numeric language sql stable security definer set search_path = public as $$
  select l.precio_unitario
  from public.ordenes_compra_lineas l join public.ordenes_compra o on o.id = l.oc_id
  where l.codigo = p_codigo and l.precio_unitario > 0
    and o.estado in ('EMITIDA', 'RECIBIDA PARCIAL', 'RECIBIDA')
  order by coalesce(o.aprobada_en, o.creado_en) desc, l.id desc
  limit 1;
$$;

-- Precio propuesto de un repuesto: lista de precios, o último costo + recargo.
create or replace function public.precio_propuesto_repuesto(p_codigo text, out precio numeric, out origen text, out costo numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_rec numeric;
begin
  costo := public.costo_ultimo_repuesto(p_codigo);
  select lp.precio into precio from public.lista_precios lp where lp.codigo = p_codigo;
  if precio is not null then origen := 'LISTA'; return; end if;
  v_rec := public.config_numero('recargo_repuestos');
  if costo is not null and v_rec is not null then
    precio := round(costo * (1 + v_rec / 100), 2);
    origen := 'COSTO';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. Precio de cada repuesto en la OT y casillas de la OT impresa
-- ---------------------------------------------------------------------
create table if not exists public.precios_repuesto_ot (
  repuesto_ot_id  bigint primary key references public.repuestos_ot (id) on delete cascade,
  ot_id           bigint not null references public.ordenes_trabajo (id) on delete cascade,
  precio          numeric(14,2) not null check (precio >= 0),
  origen          text not null default 'A MANO',      -- A MANO · AL FACTURAR
  actualizado_por uuid references public.usuarios (id) default auth.uid(),
  actualizado_en  timestamptz not null default now(),
  constraint precio_rep_ot_origen check (origen in ('A MANO', 'AL FACTURAR'))
);
create index if not exists precios_repuesto_ot_ot on public.precios_repuesto_ot (ot_id);

-- Con la OT facturada no se cambian los precios (igual que tareas y repuestos).
drop trigger if exists bloqueo_facturada on public.precios_repuesto_ot;
create trigger bloqueo_facturada before insert or update or delete
  on public.precios_repuesto_ot for each row execute function public.ot_bloqueo_facturada();

alter table public.ordenes_trabajo add column if not exists mostrar_precios_repuestos boolean not null default false;
alter table public.ordenes_trabajo add column if not exists mostrar_mano_obra boolean not null default false;
alter table public.ordenes_trabajo add column if not exists valor_hora numeric(14,2);   -- se fija al facturar

-- Al pasar a FACTURADA se fijan el valor hora y los precios propuestos de los repuestos.
-- El valor hora fijado no se cambia a mano.
create or replace function public.ot_fijar_precios()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.valor_hora := old.valor_hora;
  if new.estado::text = 'FACTURADA' and old.estado::text <> 'FACTURADA' then
    new.valor_hora := coalesce(old.valor_hora, public.valor_hora_cliente(new.cliente_id));
    insert into public.precios_repuesto_ot (repuesto_ot_id, ot_id, precio, origen)
    select r.id, r.ot_id, p.precio, 'AL FACTURAR'
      from public.repuestos_ot r cross join lateral public.precio_propuesto_repuesto(r.codigo) p
     where r.ot_id = new.id and p.precio is not null
    on conflict (repuesto_ot_id) do nothing;
  end if;
  return new;
end $$;
revoke execute on function public.ot_fijar_precios() from public, anon, authenticated;
drop trigger if exists ot_fijar_precios on public.ordenes_trabajo;
create trigger ot_fijar_precios before update on public.ordenes_trabajo
  for each row execute function public.ot_fijar_precios();

-- Todo lo que hace falta para mostrar los importes de una OT (en pantalla y en la OT impresa).
create or replace function public.importes_ot(p_ot_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o public.ordenes_trabajo; c public.clientes; v_ve_costo boolean := public.es_oficina_o_admin();
begin
  if not public.ve_todas_las_ot() then raise exception 'No tenés permiso para ver los importes de la OT'; end if;
  select * into o from public.ordenes_trabajo where id = p_ot_id;
  if o.id is null then raise exception 'La OT no existe'; end if;
  select * into c from public.clientes where id = o.cliente_id;
  return jsonb_build_object(
    'valor_hora', coalesce(o.valor_hora, public.valor_hora_cliente(o.cliente_id)),
    'valor_hora_fijado', o.valor_hora is not null,
    'valor_hora_base', public.config_numero('valor_hora_mano_obra'),
    'recargo_cliente', coalesce(c.recargo_mano_obra, 0),
    'recargo_repuestos', public.config_numero('recargo_repuestos'),
    'mostrar_precios_repuestos', o.mostrar_precios_repuestos,
    'mostrar_mano_obra', o.mostrar_mano_obra,
    'repuestos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'precio', coalesce(po.precio, p.precio),
               'origen', coalesce(po.origen, p.origen),
               'propuesto', p.precio,
               'origen_propuesto', p.origen,
               'costo', case when v_ve_costo then p.costo end) order by r.id)
        from public.repuestos_ot r
        cross join lateral public.precio_propuesto_repuesto(r.codigo) p
        left join public.precios_repuesto_ot po on po.repuesto_ot_id = r.id
       where r.ot_id = o.id), '[]'::jsonb));
end $$;

-- Cambia el precio de un repuesto en la OT (null = vuelve al precio propuesto).
-- p_a_lista: además lo guarda como precio de lista del repuesto.
create or replace function public.fijar_precio_repuesto_ot(p_id bigint, p_precio numeric, p_a_lista boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare r public.repuestos_ot; v_antes numeric; v_desc text;
begin
  if not public.es_oficina_o_admin() then raise exception 'Los precios los cambian Oficina o el Administrador'; end if;
  select * into r from public.repuestos_ot where id = p_id;
  if r.id is null then raise exception 'Ese repuesto ya no está en la OT'; end if;
  if p_precio is not null and p_precio < 0 then raise exception 'El precio no puede ser negativo'; end if;
  if p_a_lista and not (p_precio > 0) then raise exception 'Para guardarlo en la lista de precios tiene que ser mayor a cero'; end if;
  select precio into v_antes from public.precios_repuesto_ot where repuesto_ot_id = p_id;
  if p_precio is null then
    delete from public.precios_repuesto_ot where repuesto_ot_id = p_id;
  else
    insert into public.precios_repuesto_ot (repuesto_ot_id, ot_id, precio, origen)
    values (p_id, r.ot_id, round(p_precio, 2), 'A MANO')
    on conflict (repuesto_ot_id) do update
      set precio = excluded.precio, origen = 'A MANO', actualizado_por = auth.uid(), actualizado_en = now();
  end if;
  if p_a_lista then perform public.fijar_precio_lista(r.codigo, p_precio); end if;
  select descripcion into v_desc from public.repuestos where codigo = r.codigo;
  insert into public.historial_ot (ot_id, tipo, detalle, usuario_id)
  values (r.ot_id, 'PRECIO', format('%s (%s): %s → %s%s', v_desc, r.codigo,
            case when v_antes is null then 'precio propuesto' else public.pesos(v_antes) end,
            case when p_precio is null then 'precio propuesto' else public.pesos(round(p_precio, 2)) end,
            case when p_a_lista then ' (también en la lista de precios)' else '' end), auth.uid());
end $$;

-- Precio de lista de un repuesto (null = lo saca de la lista).
create or replace function public.fijar_precio_lista(p_codigo text, p_precio numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_oficina_o_admin() then raise exception 'Los precios los cambian Oficina o el Administrador'; end if;
  if not exists (select 1 from public.repuestos where codigo = p_codigo) then raise exception 'No existe el repuesto %', p_codigo; end if;
  if p_precio is null then
    delete from public.lista_precios where codigo = p_codigo;
  else
    if p_precio <= 0 then raise exception 'El precio tiene que ser mayor a cero'; end if;
    insert into public.lista_precios (codigo, precio) values (p_codigo, round(p_precio, 2))
    on conflict (codigo) do update set precio = excluded.precio, actualizado_por = auth.uid(), actualizado_en = now();
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. Permisos: los precios los ven Oficina y Administrador; se cambian con las funciones.
-- ---------------------------------------------------------------------
alter table public.lista_precios enable row level security;
drop policy if exists ver on public.lista_precios;
create policy ver on public.lista_precios for select to authenticated using (public.es_oficina_o_admin());
revoke all on public.lista_precios from anon;
revoke insert, update, delete, truncate on public.lista_precios from authenticated;
grant select on public.lista_precios to authenticated;

alter table public.precios_repuesto_ot enable row level security;
drop policy if exists ver on public.precios_repuesto_ot;
create policy ver on public.precios_repuesto_ot for select to authenticated using (public.es_oficina_o_admin());
revoke all on public.precios_repuesto_ot from anon;
revoke insert, update, delete, truncate on public.precios_repuesto_ot from authenticated;
grant select on public.precios_repuesto_ot to authenticated;

revoke execute on function public.config_numero(text), public.valor_hora_cliente(bigint), public.costo_ultimo_repuesto(text),
  public.precio_propuesto_repuesto(text), public.importes_ot(bigint),
  public.fijar_precio_repuesto_ot(bigint, numeric, boolean), public.fijar_precio_lista(text, numeric) from public, anon;
grant execute on function public.importes_ot(bigint), public.fijar_precio_repuesto_ot(bigint, numeric, boolean),
  public.fijar_precio_lista(text, numeric) to authenticated;
revoke execute on function public.costo_ultimo_repuesto(text), public.precio_propuesto_repuesto(text), public.config_numero(text),
  public.valor_hora_cliente(bigint) from authenticated;

commit;

notify pgrst, 'reload schema';

select 'Paso 28 listo: precios de repuestos y mano de obra en la OT' as resultado;
