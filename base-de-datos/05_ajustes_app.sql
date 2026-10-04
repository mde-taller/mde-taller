-- =====================================================================
--  MDE Electromecánica · Sistema de Órdenes de Trabajo
--  Paso 5 · Ajustes para la app
--   - Solo los usuarios con algún rol pueden leer datos del taller.
--   - Cada ficha de usuario guarda su email (para mostrar el usuario de ingreso).
--  Se puede correr más de una vez sin problema.
-- =====================================================================
begin;

create or replace function public.tiene_algun_rol()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.usuario_roles ur join public.usuarios u on u.id = ur.usuario_id
    where ur.usuario_id = auth.uid() and u.activo
  );
$$;
revoke execute on function public.tiene_algun_rol() from anon, public;
grant execute on function public.tiene_algun_rol() to authenticated;

-- Lectura de datos del taller: solo con rol asignado.
drop policy if exists ver on public.clientes;
create policy ver on public.clientes for select to authenticated using (public.tiene_algun_rol());
drop policy if exists ver on public.marcas;
create policy ver on public.marcas for select to authenticated using (public.tiene_algun_rol());
drop policy if exists ver on public.modelos;
create policy ver on public.modelos for select to authenticated using (public.tiene_algun_rol());
drop policy if exists ver on public.unidades;
create policy ver on public.unidades for select to authenticated using (public.tiene_algun_rol());
drop policy if exists ver on public.categorias_tempario;
create policy ver on public.categorias_tempario for select to authenticated using (public.tiene_algun_rol());
drop policy if exists ver on public.tempario;
create policy ver on public.tempario for select to authenticated using (public.tiene_algun_rol());
drop policy if exists ver on public.repuestos;
create policy ver on public.repuestos for select to authenticated using (public.tiene_algun_rol());
drop policy if exists ver on public.configuracion;
create policy ver on public.configuracion for select to authenticated using (public.tiene_algun_rol());

-- Usuarios y roles: cada uno ve lo suyo; con rol, ve a los demás.
drop policy if exists ver on public.usuarios;
create policy ver on public.usuarios for select to authenticated using (id = auth.uid() or public.tiene_algun_rol());
drop policy if exists ver on public.usuario_roles;
create policy ver on public.usuario_roles for select to authenticated using (usuario_id = auth.uid() or public.tiene_algun_rol());

-- Email en la ficha del usuario.
alter table public.usuarios add column if not exists email text;
update public.usuarios u set email = a.email from auth.users a where a.id = u.id and u.email is distinct from a.email;

create or replace function public.crear_ficha_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.usuarios (id, nombre, email)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''), split_part(new.email, '@', 1)), new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;
revoke execute on function public.crear_ficha_usuario() from authenticated, anon, public;

commit;

select 'Paso 5 listo: ajustes aplicados' as resultado;
