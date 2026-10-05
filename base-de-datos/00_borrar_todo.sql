-- =====================================================================
--  MDE Electromecánica · Borrar todo y empezar de cero
--
--  ATENCIÓN: borra todas las tablas de la app y sus datos (OT, stock,
--  repuestos, clientes...). Usalo SOLO si 00_verificar.sql dice
--  "Esquema incompleto", o si querés volver a cargar todo desde el Excel.
--  No borra los usuarios de Authentication.
-- =====================================================================
begin;

drop trigger if exists al_crear_usuario on auth.users;

drop view if exists public.horas_reales;
drop view if exists public.stock_disponible;

drop table if exists
  public.pedidos_repuesto, public.pausas_ot, public.solicitudes_de_ot,
  public.avisos, public.solicitudes, public.registros_tiempo, public.movimientos_stock,
  public.repuestos_ot, public.asignaciones, public.tareas_ot, public.ordenes_trabajo,
  public.repuestos, public.tempario, public.categorias_tempario, public.unidades,
  public.modelos, public.marcas, public.clientes, public.configuracion,
  public.usuario_roles, public.usuarios
  cascade;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('antes_de_guardar_ot','antes_de_guardar_tarea','aprobar_solicitud',
        'avisar_solicitud_nueva','buscar_repuesto','consultar_stock','controlar_asignacion',
        'controlar_stock_repuesto_ot','crear_ficha_usuario','crear_ot','es_admin',
        'es_oficina_o_admin','iniciar_tarea','mecanico_en_ot','mecanico_en_tarea',
        'movimiento_repuesto_ot','num_texto','numero_ot_texto','pausar_tarea',
        'rechazar_solicitud','recordar_tipo_unidad','stock_de','terminar_tarea',
        'tiene_rol','ve_todas_las_ot','tiene_algun_rol','texto_motivo','pausar_ot','reanudar_ot',
        'resolver_pedido_repuesto','avisar_solicitud_ot','aprobar_solicitud_ot','rechazar_solicitud_ot',
        'buscar_repuestos')
  loop
    execute format('drop function if exists %s cascade', f.firma);
  end loop;
end $$;

drop type if exists public.motivo_pausa, public.rol_usuario, public.tipo_unidad, public.estado_ot,
  public.estado_tarea, public.tipo_movimiento, public.estado_solicitud cascade;

commit;

select 'Listo: base vacía. Ahora corré 01_esquema.sql' as resultado;
