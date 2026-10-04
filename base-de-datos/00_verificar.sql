-- =====================================================================
--  MDE Electromecánica · Verificar en qué paso está la base
--  Se puede correr cuantas veces quieras: no cambia nada.
--  Mirá la columna "siguiente_paso".
-- =====================================================================
with chequeo as (
  select
    (select count(*) from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
        and table_name in ('usuarios','usuario_roles','configuracion','clientes','marcas','modelos',
                           'unidades','categorias_tempario','tempario','repuestos','ordenes_trabajo',
                           'tareas_ot','asignaciones','repuestos_ot','movimientos_stock',
                           'registros_tiempo','solicitudes','avisos')) as tablas,
    (select count(*) from information_schema.views
      where table_schema = 'public' and table_name in ('stock_disponible','horas_reales')) as vistas,
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) as funciones,
    (select count(*) from pg_policies where schemaname = 'public') as permisos
),
datos as (
  select c.*,
    case when tablas = 18 then (xpath('/row/n/text()', query_to_xml(
      'select count(*) as n from public.clientes', false, true, '')))[1]::text::int end as clientes,
    case when tablas = 18 then (xpath('/row/n/text()', query_to_xml(
      'select count(*) as n from public.tempario', false, true, '')))[1]::text::int end as tareas_tempario,
    case when tablas = 18 then (xpath('/row/n/text()', query_to_xml(
      'select count(*) as n from public.repuestos', false, true, '')))[1]::text::int end as repuestos,
    case when tablas = 18 then (xpath('/row/n/text()', query_to_xml(
      'select count(*) as n from public.usuario_roles where rol = ''ADMINISTRADOR''', false, true, '')))[1]::text::int end as administradores
  from chequeo c
)
select
  case
    when tablas = 0 and vistas = 0 and permisos = 0
      then 'Base vacía: corré 01_esquema.sql'
    when tablas < 18 or vistas < 2 or funciones < 25 or permisos < 42
      then 'Esquema incompleto: corré 00_borrar_todo.sql y después 01_esquema.sql'
    when clientes = 0
      then 'Esquema completo: seguí con 02_datos_base.sql'
    when repuestos < 35142
      then format('Datos base cargados. Repuestos: %s de 35142. Corré las partes de 03_repuestos que falten (se pueden repetir sin problema)', repuestos)
    when administradores = 0
      then 'Todo cargado: seguí con el paso 4 (crear tu usuario) y 04_primer_administrador.sql'
    else 'Base completa y con Administrador. ¡Lista!'
  end as siguiente_paso,
  tablas, vistas, funciones, permisos, clientes, tareas_tempario, repuestos, administradores
from datos;
