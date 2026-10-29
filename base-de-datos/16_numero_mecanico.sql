-- =====================================================================
--  MDE Electromecánica · Sistema de Órdenes de Trabajo
--  Paso 16 · Número de mecánico
--   - Cada usuario puede tener un número de mecánico (usuarios.numero_mecanico). Lo asigna el
--     Administrador en Usuarios. No se puede repetir.
--   - En la OT (pantalla, hoja impresa y app del mecánico) cada tarea muestra el número de quien la hizo.
--   - El ayudante no tiene número propio a la vista: figura con el número de su responsable
--     (igual que con el nombre).
--  Se puede correr más de una vez sin problema.
-- =====================================================================
begin;

alter table public.usuarios add column if not exists numero_mecanico integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'usuarios_numero_mecanico_unico') then
    alter table public.usuarios add constraint usuarios_numero_mecanico_unico unique (numero_mecanico);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'usuarios_numero_mecanico_positivo') then
    alter table public.usuarios add constraint usuarios_numero_mecanico_positivo check (numero_mecanico is null or numero_mecanico > 0);
  end if;
end $$;

-- Número que se muestra: el del responsable si el usuario es ayudante (columna en la app: usuarios(numero:numero_visible)).
create or replace function public.numero_visible(u public.usuarios)
returns integer language sql stable security definer set search_path = public as $$
  select case when u.responsable_id is null then u.numero_mecanico
              else (select r.numero_mecanico from public.usuarios r where r.id = u.responsable_id) end;
$$;

revoke execute on function public.numero_visible(public.usuarios) from public, anon;
grant execute on function public.numero_visible(public.usuarios) to authenticated;

-- ot_taller_json (OT vista desde la app del mecánico): cada tarea muestra "N° 3 · NOMBRE".
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
        'asignados', coalesce((select jsonb_agg(x.n order by x.nro nulls last, x.n)
                                 from (select distinct public.numero_visible(us) as nro,
                                              coalesce('N° ' || public.numero_visible(us) || ' · ', '') || public.nombre_visible(us) as n
                                         from public.asignaciones a join public.usuarios us on us.id = a.mecanico_id
                                        where a.tarea_id = t.id) x), '[]'::jsonb),
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

commit;

-- Que la app vea la columna nueva enseguida.
notify pgrst, 'reload schema';
