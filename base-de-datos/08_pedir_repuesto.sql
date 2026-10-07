-- =====================================================================
--  MDE Electromecánica · Sistema de Órdenes de Trabajo
--  Paso 8 · Pedir un repuesto a Depósito cuando no hay stock
--   - Mecánico de la OT, Oficina o Administrador pueden pedirlo (sin pausar la OT).
--   - Avisa a Depósito y Administrador; cuando Depósito lo resuelve, le avisa a quien lo pidió.
--  Se puede correr más de una vez sin problema.
-- =====================================================================
begin;

-- Nota de quien pide (la columna "nota" es la respuesta de Depósito al resolver).
alter table public.pedidos_repuesto add column if not exists detalle text;

create or replace function public.pedir_repuesto(
  p_ot_id    bigint,
  p_codigo   text,
  p_cantidad numeric,
  p_tarea_id bigint default null,
  p_detalle  text default null
) returns bigint language plpgsql security definer set search_path = public as $$
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

  select nombre into v_nombre from public.usuarios where id = auth.uid();
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
end $$;

revoke execute on function public.pedir_repuesto(bigint, text, numeric, bigint, text) from public, anon;
grant execute on function public.pedir_repuesto(bigint, text, numeric, bigint, text) to authenticated;

commit;

select 'Paso 8 listo: pedir repuestos a Depósito' as resultado;
