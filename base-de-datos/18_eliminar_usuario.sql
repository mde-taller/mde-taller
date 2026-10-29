-- =====================================================================
--  MDE Electromecánica · Sistema de Órdenes de Trabajo
--  Paso 18 · Eliminar usuarios
--   - El Administrador puede eliminar cualquier usuario (menos a sí mismo) desde Usuarios.
--   - Se borra su acceso (ya no puede entrar y el nombre de usuario queda libre para otro),
--     sus roles y su número de mecánico. Deja de aparecer en la lista de Usuarios.
--   - Lo que hizo en las OT queda guardado con su nombre (tareas, horas, repuestos, registro).
--     Si nunca hizo nada, se borra por completo.
--   - Las tareas que tenía asignadas y nunca empezó quedan libres para asignar a otro.
--  Se puede correr más de una vez sin problema.
-- =====================================================================
begin;

alter table public.usuarios add column if not exists eliminado boolean not null default false;

-- La ficha del usuario ya no depende de su acceso: así se puede borrar el acceso y conservar el historial.
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.usuarios'::regclass and contype = 'f'
              and confrelid = 'auth.users'::regclass
  loop
    execute format('alter table public.usuarios drop constraint %I', c);
  end loop;
end $$;

create or replace function public.eliminar_usuario(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_nombre text;
begin
  if not public.es_admin() then raise exception 'Solo el Administrador puede eliminar usuarios'; end if;
  if p_id = auth.uid() then raise exception 'No podés eliminar tu propio usuario'; end if;
  select nombre into v_nombre from public.usuarios where id = p_id and not eliminado;
  if v_nombre is null then raise exception 'El usuario no existe o ya fue eliminado'; end if;

  -- Cronómetros abiertos: se cierran ahora.
  update public.registros_tiempo set fin = now() where mecanico_id = p_id and fin is null;
  -- Tareas asignadas que nunca empezó ni terminó: quedan libres.
  delete from public.asignaciones a
   where a.mecanico_id = p_id and a.terminada_en is null
     and not exists (select 1 from public.registros_tiempo r where r.tarea_id = a.tarea_id and r.mecanico_id = p_id);
  -- Sus ayudantes dejan de serlo.
  update public.usuarios set responsable_id = null where responsable_id = p_id;
  delete from public.usuario_roles where usuario_id = p_id;
  update public.usuarios
     set eliminado = true, activo = false, numero_mecanico = null, responsable_id = null, email = null
   where id = p_id;

  -- Acceso: se borra (el nombre de usuario queda libre).
  delete from auth.users where id = p_id;

  -- Si no tiene nada guardado, se borra la ficha también.
  begin
    delete from public.usuarios where id = p_id;
  exception when foreign_key_violation then
    null; -- tiene historial: la ficha queda (oculta) para que las OT sigan mostrando su nombre
  end;
  return v_nombre;
end $$;

revoke execute on function public.eliminar_usuario(uuid) from public, anon;
grant execute on function public.eliminar_usuario(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';

select 'Paso 18 listo: eliminar usuarios' as resultado;
