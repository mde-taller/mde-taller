// MDE · Taller — Informes de trazabilidad (solo Administrador): del período y por OT.
(() => {
  const { st, esc, num, nroOT, hoyISO, chipEstadoOT, chipEstadoTarea, textoMotivo, duracionTexto, errMsg, toast,
          ESTADOS_OT, ICONOS, ruta, on, navegar } = App;

  // ---------------- Utilidades ----------------
  const H24 = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  const fh = d => d ? new Date(d).toLocaleString('es-AR', Object.assign({ day: '2-digit', month: '2-digit', year: 'numeric' }, H24)).replace(',', '') : '';
  const fhc = d => d ? new Date(d).toLocaleString('es-AR', Object.assign({ day: '2-digit', month: '2-digit' }, H24)).replace(',', '') : '';
  const fd = s => s ? s.split('-').reverse().join('/') : '';
  const hhmm = t => t ? String(t).slice(0, 5) : '';
  const local = (f, h) => f ? new Date(`${f}T${h || '00:00:00'}`) : null;
  const ingresoDe = o => local(o.fecha_ingreso, o.hora_ingreso);
  const egresoDe = o => local(o.fecha_salida, o.hora_salida);
  const terminada = o => ['FINALIZADA', 'CERRADA'].includes(o.estado);
  const minEntre = (a, b) => (((b ? new Date(b) : new Date()) - new Date(a)) / 60000);
  const horas = min => num(Math.round(Number(min || 0) / 6) / 10) + ' h';
  // Tiempo en el taller: del ingreso al egreso (o a cuando se finalizó, o hasta ahora si sigue).
  const enTaller = o => {
    const ini = ingresoDe(o);
    const fin = egresoDe(o) || (terminada(o) && o.finalizada_en ? new Date(o.finalizada_en) : null);
    return { min: minEntre(ini, fin), sigue: !fin };
  };
  const ingresoTexto = o => `${fd(o.fecha_ingreso)}${o.hora_ingreso ? ' ' + hhmm(o.hora_ingreso) : ''}`;
  const egresoTexto = o => o.fecha_salida ? `${fd(o.fecha_salida)}${o.hora_salida ? ' ' + hhmm(o.hora_salida) : ''}` : '';
  // Hoja de impresión: período apaisado; informe de OT vertical. Se quita al salir de la pantalla.
  function paginaImpresion(orientacion) {
    const s = document.createElement('style');
    s.textContent = `@media print { @page { size: A4 ${orientacion}; margin: 10mm; } }`;
    document.head.appendChild(s);
    st.limpiar.push(() => s.remove());
  }
  const emitido = () => `Emitido el ${fh(new Date())} por ${esc(st.nombre)}`;

  // ---------------- Informe del período ----------------
  let tDesde = '', tHasta = '', tEstado = '', tCliente = '', tBuscar = '';
  ruta(/^#\/trazabilidad$/, async main => {
    if (!tDesde) { const h = hoyISO(); tDesde = h.slice(0, 8) + '01'; tHasta = h; }
    paginaImpresion('landscape');
    main.innerHTML = `
      <div class="encabezado no-imprimir"><div><h1>Trazabilidad de OT</h1>
        <div class="sub">Cada OT ingresada en el período: ingreso, egreso, estado, trabajo, tiempos y pausas. Tocá una OT para ver su informe completo.</div></div>
        <div class="acciones"><button class="btn" data-accion="excel">Descargar Excel</button>
          <button class="btn btn-primario" data-accion="imprimir">Imprimir / PDF</button></div></div>
      <form id="t-filtros" class="fila-campos no-imprimir" style="align-items:end">
        <div class="campo"><label for="t-desde">Ingreso desde</label><input id="t-desde" type="date" value="${tDesde}"></div>
        <div class="campo"><label for="t-hasta">Hasta</label><input id="t-hasta" type="date" value="${tHasta}"></div>
        <div class="campo"><button class="btn btn-primario" type="submit">Ver</button></div>
      </form>
      <div id="t-res"><div class="vacio">Cargando…</div></div>`;
    document.getElementById('t-filtros').addEventListener('submit', ev => {
      ev.preventDefault(); tDesde = document.getElementById('t-desde').value; tHasta = document.getElementById('t-hasta').value; navegar(); });

    let datos;
    try { datos = await Api.rpc('informe_trazabilidad', { p_desde: tDesde, p_hasta: tHasta }) || []; }
    catch (e) { document.getElementById('t-res').innerHTML = `<div class="error-box">${esc(errMsg(e))}</div>`; return; }
    const clientes = [...new Set(datos.map(o => o.cliente).filter(Boolean))].sort();
    const filtrar = () => {
      const q = tBuscar.trim().toUpperCase();
      return datos.filter(o => (!tEstado || o.estado === tEstado) && (!tCliente || o.cliente === tCliente) &&
        (!q || [nroOT(o.numero), String(o.numero), o.interno, o.dominio, o.diagnostico, o.observaciones].some(v => String(v || '').toUpperCase().includes(q))));
    };

    const pintar = () => {
      const lista = filtrar();
      const terminadas = lista.filter(terminada);
      const conTiempo = lista.map(o => ({ o, t: enTaller(o) }));
      const cerradasT = conTiempo.filter(x => !x.t.sigue);
      const promedio = cerradasT.length ? cerradasT.reduce((a, x) => a + x.t.min, 0) / cerradasT.length : null;
      const conInicio = lista.filter(o => o.primer_trabajo);
      const promInicio = conInicio.length ? conInicio.reduce((a, o) => a + Math.max(0, minEntre(ingresoDe(o), o.primer_trabajo)), 0) / conInicio.length : null;
      const sum = k => lista.reduce((a, o) => a + Number(o[k] || 0), 0);
      const minTemp = sum('horas_tempario') * 60, minTrab = sum('minutos_trabajo'), minPausa = sum('minutos_pausa');
      const motivos = {};
      for (const o of lista) for (const [m, v] of Object.entries(o.pausas_por_motivo || {})) motivos[m] = (motivos[m] || 0) + Number(v);

      document.getElementById('t-res').innerHTML = `
        <div class="solo-imprimir informe-cabecera">
          <div><div class="informe-empresa">MDE Electromecánica</div><h1>Trazabilidad de OT</h1>
            <div>OT ingresadas del ${fd(tDesde)} al ${fd(tHasta)}${tEstado ? ' · Estado: ' + esc(tEstado) : ''}${tCliente ? ' · Cliente: ' + esc(tCliente) : ''}</div></div>
          <div class="informe-emitido">${emitido()}</div></div>
        <div class="fila-campos no-imprimir" style="align-items:end">
          <div class="campo"><label for="t-estado">Estado</label><select id="t-estado"><option value="">Todos</option>
            ${ESTADOS_OT.filter(e => e !== 'PRUEBA').map(e => `<option ${e === tEstado ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></div>
          <div class="campo"><label for="t-cliente">Cliente</label><select id="t-cliente"><option value="">Todos</option>
            ${clientes.map(c => `<option ${c === tCliente ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
          <div class="campo" style="flex:2 1 240px"><label for="t-buscar">Buscar</label><input id="t-buscar" type="search" value="${esc(tBuscar)}" placeholder="OT, interno, patente o trabajo"></div>
        </div>
        <section class="kpis">
          <div class="kpi"><div class="kpi-et">OT</div><div class="kpi-va">${lista.length}</div><div class="kpi-sub">${terminadas.length} ${terminadas.length === 1 ? 'finalizada o cerrada' : 'finalizadas o cerradas'}</div></div>
          <div class="kpi"><div class="kpi-et">Promedio en el taller</div><div class="kpi-va">${promedio == null ? '—' : duracionTexto(promedio)}</div><div class="kpi-sub">de las que ya salieron o se finalizaron</div></div>
          <div class="kpi"><div class="kpi-et">Promedio hasta empezar</div><div class="kpi-va">${promInicio == null ? '—' : duracionTexto(promInicio)}</div><div class="kpi-sub">del ingreso al primer trabajo</div></div>
          <div class="kpi"><div class="kpi-et">Trabajo real</div><div class="kpi-va">${horas(minTrab)}</div><div class="kpi-sub">tempario ${horas(minTemp)}${minTemp ? ' · ' + Math.round(minTrab / minTemp * 100) + '%' : ''}</div></div>
          <div class="kpi"><div class="kpi-et">En pausa</div><div class="kpi-va">${horas(minPausa)}</div>
            <div class="kpi-sub">${Object.entries(motivos).sort((a, b) => b[1] - a[1]).map(([m, v]) => `${esc(m)} ${duracionTexto(v)}`).join(' · ') || 'sin pausas'}</div></div>
        </section>
        <div class="tabla-caja informe-tabla"><table><thead><tr>
          <th>OT</th><th>Cliente</th><th>Interno</th><th>Patente</th><th>Ingreso</th><th>Egreso</th><th>Estado</th>
          <th class="c-diag">Diagnóstico</th><th class="c-obs">Observaciones</th><th class="num">En taller</th>
          <th class="num">Trabajo / tempario</th><th class="num">Pausas</th><th>Mecánicos</th></tr></thead><tbody>
          ${lista.map(o => {
            const t = enTaller(o);
            return `<tr class="clic" data-ir="${o.id}">
              <td style="white-space:nowrap"><b>${esc(nroOT(o.numero))}</b></td><td>${esc(o.cliente || '')}</td><td>${esc(o.interno || '')}</td><td>${esc(o.dominio || '')}</td>
              <td style="white-space:nowrap">${fd(o.fecha_ingreso)}${o.hora_ingreso ? `<div class="nota">${hhmm(o.hora_ingreso)}</div>` : ''}</td>
              <td style="white-space:nowrap">${o.fecha_salida ? fd(o.fecha_salida) + (o.hora_salida ? `<div class="nota">${hhmm(o.hora_salida)}</div>` : '') : '<span class="nota">—</span>'}</td>
              <td>${chipEstadoOT(o.estado)}${o.pausada_ahora ? `<div class="nota">Pausada: ${esc(o.pausada_ahora)}</div>` : ''}</td>
              <td class="c-diag"><div class="recorte">${esc(o.diagnostico || '')}</div><div class="nota">${o.tareas_hechas}/${o.tareas} tareas hechas</div></td>
              <td class="c-obs"><div class="recorte">${esc(o.observaciones || '')}</div></td>
              <td class="num" style="white-space:nowrap">${duracionTexto(t.min)}${t.sigue ? '<div class="nota">sigue</div>' : ''}</td>
              <td class="num" style="white-space:nowrap">${horas(o.minutos_trabajo)}<div class="nota">de ${horas(Number(o.horas_tempario) * 60)}</div></td>
              <td class="num" style="white-space:nowrap">${Number(o.minutos_pausa) ? duracionTexto(o.minutos_pausa) : '—'}</td>
              <td>${esc(o.mecanicos || '')}</td></tr>`;
          }).join('') || '<tr><td colspan="13" class="vacio">No hay OT para mostrar.</td></tr>'}
          </tbody>
          ${lista.length ? `<tfoot><tr><td colspan="9"><b>Totales (${lista.length} OT)</b></td><td></td>
            <td class="num"><b>${horas(minTrab)}</b><div class="nota">de ${horas(minTemp)}</div></td><td class="num"><b>${horas(minPausa)}</b></td><td></td></tr></tfoot>` : ''}
        </table></div>
        <div class="nota informe-pie">"En taller": del ingreso al egreso (o hasta que se finalizó / hasta ahora si sigue). "Trabajo": tiempo real del cronómetro de los mecánicos. "Pausas": OT pausada por el mecánico, con su motivo.</div>`;
      document.getElementById('t-estado').addEventListener('change', ev => { tEstado = ev.target.value; pintar(); });
      document.getElementById('t-cliente').addEventListener('change', ev => { tCliente = ev.target.value; pintar(); });
      const b = document.getElementById('t-buscar');
      b.addEventListener('input', ev => { tBuscar = ev.target.value; const pos = ev.target.selectionStart; pintar();
        const nb = document.getElementById('t-buscar'); nb.focus(); nb.setSelectionRange(pos, pos); });
    };
    pintar();
    on(main, 'click', 'tr[data-ir]', (ev, tr) => { location.hash = '#/trazabilidad/' + tr.dataset.ir; });
    on(main, 'click', '[data-accion=imprimir]', () => window.print());
    on(main, 'click', '[data-accion=excel]', () => {
      const lista = filtrar();
      const columnas = [
        { titulo: 'OT', ancho: 11 }, { titulo: 'Cliente', ancho: 20 }, { titulo: 'Interno', ancho: 10 }, { titulo: 'Patente', ancho: 11 },
        { titulo: 'Unidad', ancho: 24 }, { titulo: 'Tipo', ancho: 10 }, { titulo: 'KM', ancho: 10, tipo: 'entero' },
        { titulo: 'Ingreso', ancho: 16, tipo: 'fechahora' }, { titulo: 'Egreso', ancho: 16, tipo: 'fechahora' }, { titulo: 'Estado', ancho: 16 },
        { titulo: 'Diagnóstico', ancho: 50 }, { titulo: 'Observaciones', ancho: 40 }, { titulo: 'Mecánicos', ancho: 22 },
        { titulo: 'Tareas', ancho: 8, tipo: 'entero' }, { titulo: 'Tareas hechas', ancho: 9, tipo: 'entero' },
        { titulo: 'Horas tempario', ancho: 10, tipo: 'numero' }, { titulo: 'Horas trabajadas', ancho: 10, tipo: 'numero' },
        { titulo: 'Horas en pausa', ancho: 10, tipo: 'numero' }, { titulo: 'Pausas por motivo', ancho: 30 },
        { titulo: 'Días en taller', ancho: 9, tipo: 'numero' }, { titulo: 'Primer trabajo', ancho: 16, tipo: 'fechahora' },
        { titulo: 'Finalizada', ancho: 16, tipo: 'fechahora' }, { titulo: 'Repuestos', ancho: 9, tipo: 'entero' },
        { titulo: 'Repuestos sin entregar', ancho: 10, tipo: 'entero' }, { titulo: 'Presupuesto', ancho: 14 },
        { titulo: 'OT del cliente', ancho: 14 }, { titulo: 'N° factura', ancho: 14 }];
      const r2 = v => Math.round(v * 100) / 100;
      const filas = lista.map(o => [
        nroOT(o.numero), o.cliente, o.interno, o.dominio, o.unidad, o.tipo, o.km, ingresoDe(o), egresoDe(o), o.estado,
        o.diagnostico, o.observaciones, o.mecanicos, o.tareas, o.tareas_hechas, r2(Number(o.horas_tempario)),
        r2(Number(o.minutos_trabajo) / 60), r2(Number(o.minutos_pausa) / 60),
        Object.entries(o.pausas_por_motivo || {}).map(([m, v]) => `${m}: ${duracionTexto(v)}`).join(' · '),
        r2(enTaller(o).min / 1440), o.primer_trabajo ? new Date(o.primer_trabajo) : null,
        o.finalizada_en ? new Date(o.finalizada_en) : null, o.repuestos, o.repuestos_pendientes, o.presupuesto, o.ot_cliente, o.nro_factura]);
      const blob = XlsxMini.crear({ hoja: 'Trazabilidad', titulo: 'MDE Electromecánica · Trazabilidad de OT',
        subtitulo: `OT ingresadas del ${fd(tDesde)} al ${fd(tHasta)}${tEstado ? ' · ' + tEstado : ''}${tCliente ? ' · ' + tCliente : ''} · ${emitido()}`,
        columnas, filas });
      XlsxMini.descargar(blob, `Trazabilidad OT ${fd(tDesde).replace(/\//g, '-')} al ${fd(tHasta).replace(/\//g, '-')}.xlsx`);
      toast(`Excel descargado: ${lista.length} OT`);
    });
  }, ['ADMINISTRADOR']);

  // ---------------- Informe de trazabilidad de una OT ----------------
  function lineaDeTiempo({ desde, hasta, etapas, mecanicos, pausas, hitos = [] }) {
    const W = 1000, IZQ = 130, DER = 12, FILA = 30, ALTO_BARRA = 18;
    const filas = [{ nombre: 'Estado', tipo: 'estado', segs: etapas }, ...mecanicos.map(m => ({ nombre: m.nombre, tipo: 'trabajo', segs: m.segs })),
                   { nombre: 'OT en pausa', tipo: 'pausa', segs: pausas }];
    const t0 = desde.getTime(), t1 = Math.max(hasta.getTime(), t0 + 3600000);
    const X = t => IZQ + (Math.min(Math.max(t, t0), t1) - t0) / (t1 - t0) * (W - IZQ - DER);
    const alto = 26 + filas.length * FILA + 8 + (hitos.length ? 16 : 0);
    const altoFilas = 26 + filas.length * FILA;
    // Marcas del eje: cada 1, 2, 3, 6, 12 h o por día según el largo.
    const horasTot = (t1 - t0) / 3600000;
    const paso = [1, 2, 3, 6, 12, 24, 48, 168].find(p => horasTot / p <= 10) || 168;
    const marcas = [];
    const primera = new Date(t0); primera.setMinutes(0, 0, 0);
    if (paso >= 24) primera.setHours(0);
    for (let t = primera.getTime(); t <= t1; t += paso * 3600000) if (t >= t0) marcas.push(t);
    const dias = [];
    const d0 = new Date(t0); d0.setHours(24, 0, 0, 0);
    for (let t = d0.getTime(); t < t1; t += 86400000) dias.push(t);
    const etiq = t => { const d = new Date(t); return paso >= 24 ? d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
      : d.getHours() === 0 || t === marcas[0] ? fhc(d)
      : d.toLocaleTimeString('es-AR', H24); };
    const seg = (s, y, fila) => {
      const x1 = X(new Date(s.desde).getTime()), x2 = X((s.hasta ? new Date(s.hasta) : new Date()).getTime());
      const w = Math.max(2, x2 - x1);
      const titulo = `${fila.nombre === 'Estado' ? s.etiqueta : fila.nombre + (s.etiqueta ? ' · ' + s.etiqueta : '')}: ${fhc(s.desde)} → ${s.hasta ? fhc(s.hasta) : 'sigue'} (${duracionTexto(minEntre(s.desde, s.hasta))})`;
      if (fila.tipo === 'estado') {
        const cabe = w > s.etiqueta.length * 6.6 + 10;
        return `<g><title>${esc(titulo)}</title><rect class="lt-estado ${s.i % 2 ? 'b' : ''}" x="${x1}" y="${y}" width="${w}" height="${ALTO_BARRA}" rx="3"/>
          ${cabe ? `<text class="lt-txt-estado" x="${x1 + 5}" y="${y + 13}">${esc(s.etiqueta)}</text>` : ''}</g>`;
      }
      return `<g><title>${esc(titulo)}</title><rect class="${fila.tipo === 'pausa' ? 'lt-pausa' : 'lt-trabajo'}" x="${x1}" y="${y}" width="${w}" height="${ALTO_BARRA}" rx="3"/></g>`;
    };
    return `<svg class="linea-tiempo" viewBox="0 0 ${W} ${alto}" role="img" aria-label="Línea de tiempo de la OT">
      <defs><pattern id="rayado" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="#C2410C"/><line x1="0" y1="0" x2="0" y2="6" stroke="#fff" stroke-width="2" stroke-opacity=".45"/></pattern></defs>
      ${dias.map(t => `<line class="lt-dia" x1="${X(t)}" y1="18" x2="${X(t)}" y2="${alto - 4}"/>`).join('')}
      ${marcas.map(t => `<g><line class="lt-grilla" x1="${X(t)}" y1="18" x2="${X(t)}" y2="${alto - 4}"/>
        <text class="lt-eje" x="${X(t)}" y="12" text-anchor="${X(t) > W - 60 ? 'end' : 'middle'}">${esc(etiq(t))}</text></g>`).join('')}
      ${filas.map((f, i) => {
        const y = 26 + i * FILA;
        return `<g><text class="lt-fila" x="${IZQ - 8}" y="${y + 13}" text-anchor="end">${esc(f.nombre.length > 18 ? f.nombre.slice(0, 17) + '…' : f.nombre)}</text>
          <line class="lt-base" x1="${IZQ}" y1="${y + ALTO_BARRA + 5}" x2="${W - DER}" y2="${y + ALTO_BARRA + 5}"/>
          ${f.segs.map(s => seg(s, y, f)).join('')}</g>`;
      }).join('')}
      ${hitos.map(h => { const x = X(h.t.getTime()); return `<g><title>${esc(h.texto + ': ' + fhc(h.t))}</title>
        <line class="lt-hito" x1="${x}" y1="18" x2="${x}" y2="${altoFilas}"/>
        <text class="lt-hito-txt" x="${x}" y="${altoFilas + 13}" text-anchor="${x < IZQ + 40 ? 'start' : x > W - 60 ? 'end' : 'middle'}">${esc(h.texto)} ${esc(fhc(h.t))}</text></g>`; }).join('')}
    </svg>`;
  }

  ruta(/^#\/trazabilidad\/(\d+)$/, async (main, id) => {
    paginaImpresion('portrait');
    const [ots, tareas, reps, pedidos, registro] = await Promise.all([
      Api.select('ordenes_trabajo', { select: '*,unidad:unidades(dominio,interno,chasis,marca:marcas(nombre),modelo:modelos(nombre)),cliente:clientes(nombre),' +
        'solicitante:usuarios!ordenes_trabajo_solicitada_por_fkey(nombre),' +
        'pausas:pausas_ot(id,motivo,detalle,inicio,fin,pausador:usuarios!pausas_ot_pausada_por_fkey(nombre),reanudador:usuarios!pausas_ot_reanudada_por_fkey(nombre))', id: 'eq.' + id }),
      Api.select('tareas_ot', { select: 'id,renglon,descripcion,cantidad,horas,horas_total,estado,asignaciones(mecanico_id,asignado_en,terminada_en,usuario:usuarios(nombre))', ot_id: 'eq.' + id, order: 'renglon' }),
      Api.select('repuestos_ot', { select: 'id,codigo,cantidad,cargado_en,estado,entregado_en,repuesto:repuestos(descripcion),cargador:usuarios!repuestos_ot_cargado_por_fkey(nombre),entregador:usuarios!repuestos_ot_entregado_por_fkey(nombre)', ot_id: 'eq.' + id, order: 'cargado_en' }),
      Api.select('pedidos_repuesto', { select: 'id,descripcion,codigo,cantidad,estado,nota,detalle,creado_en,resuelto_en,pedidor:usuarios!pedidos_repuesto_pedido_por_fkey(nombre),resolvio:usuarios!pedidos_repuesto_resuelto_por_fkey(nombre)', ot_id: 'eq.' + id, order: 'creado_en' }),
      Api.rpc('registro_ot', { p_ot_id: Number(id) })
    ]);
    const o = ots[0];
    if (!o) { main.innerHTML = '<div class="tarjeta">No se encontró la OT.</div>'; return; }
    const registros = tareas.length ? await Api.select('registros_tiempo', { select: 'tarea_id,mecanico_id,inicio,fin,usuario:usuarios(nombre)',
      tarea_id: 'in.(' + tareas.map(t => t.id).join(',') + ')', order: 'inicio' }) : [];
    const u = o.unidad || {};
    const ingreso = ingresoDe(o), egreso = egresoDe(o);
    const finalizadaEv = (registro || []).find(e => e.tipo === 'ESTADO' && /→ FINALIZADA$/.test(e.detalle));
    const finTaller = egreso || (terminada(o) && finalizadaEv ? new Date(finalizadaEv.momento) : null);
    const pausas = (o.pausas || []).slice().sort((a, b) => new Date(a.inicio) - new Date(b.inicio));

    // Etapas (estados) a partir del historial; arranca en ABIERTA al crearse la OT.
    const cambios = (registro || []).filter(e => e.tipo === 'ESTADO');
    const etapas = [];
    let actual = cambios.length ? cambios[0].detalle.split(' → ')[0] : (o.estado === 'ABIERTA' ? 'ABIERTA' : null);
    let desde = o.creado_en, quien = null;
    if (actual) {
      for (const c of cambios) {
        etapas.push({ etiqueta: actual, desde, hasta: c.momento, quien });
        actual = c.detalle.split(' → ')[1]; desde = c.momento; quien = c.usuario;
      }
      etapas.push({ etiqueta: actual, desde, hasta: terminada(o) ? (egreso && egreso > new Date(desde) ? egreso : desde) : null, quien, abierta: !terminada(o) });
    }
    etapas.forEach((e, i) => { e.i = i; });
    const sinHistorial = !cambios.length && o.estado !== 'ABIERTA';

    // Trabajo por mecánico
    const porMec = new Map();
    for (const r of registros) {
      const k = r.mecanico_id;
      if (!porMec.has(k)) porMec.set(k, { nombre: r.usuario ? r.usuario.nombre : '—', segs: [], min: 0, tareas: new Set() });
      const m = porMec.get(k);
      const t = tareas.find(x => x.id === r.tarea_id);
      m.segs.push({ desde: r.inicio, hasta: r.fin, etiqueta: t ? `${t.renglon}. ${t.descripcion}` : '' });
      m.min += minEntre(r.inicio, r.fin); m.tareas.add(r.tarea_id);
    }
    const mecanicos = [...porMec.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
    const minTrab = mecanicos.reduce((a, m) => a + m.min, 0);
    const minPausa = pausas.reduce((a, p) => a + minEntre(p.inicio, p.fin), 0);
    const minTemp = tareas.reduce((a, t) => a + Number(t.horas_total || 0), 0) * 60;
    const primerTrabajo = registros.length ? registros[0].inicio : null;
    const realPorTarea = id2 => registros.filter(r => r.tarea_id === id2).reduce((a, r) => a + minEntre(r.inicio, r.fin), 0);
    const inicioTarea = id2 => { const r = registros.find(x => x.tarea_id === id2); return r ? r.inicio : null; };

    // Dominio de la línea de tiempo
    const tiempos = [ingreso, new Date(o.creado_en), ...registros.map(r => new Date(r.inicio)), ...pausas.map(p => new Date(p.inicio))].filter(Boolean);
    const ltDesde = new Date(Math.min(...tiempos.map(d => d.getTime())));
    const finales = [finTaller, ...registros.map(r => r.fin ? new Date(r.fin) : new Date()), ...pausas.map(p => p.fin ? new Date(p.fin) : new Date()),
                     ...etapas.filter(e => e.hasta).map(e => new Date(e.hasta))].filter(Boolean);
    const ltHasta = finTaller && !registros.some(r => !r.fin) && !pausas.some(p => !p.fin)
      ? new Date(Math.max(...finales.map(d => d.getTime()))) : new Date();
    const pausasLT = pausas.map(p => ({ desde: p.inicio, hasta: p.fin, etiqueta: textoMotivo(p.motivo) + (p.detalle ? ': ' + p.detalle : '') }));

    const repEntregados = reps.filter(r => r.estado === 'ENTREGADO').length;
    main.innerHTML = `
      <div class="acciones no-imprimir" style="margin-bottom:12px">
        <a class="btn" href="#/trazabilidad">${ICONOS.atras} Trazabilidad</a>
        <a class="btn" href="#/ot/${o.id}">Ver la OT</a>
        <button class="btn btn-primario" data-accion="imprimir">Imprimir / PDF</button></div>
      <div class="informe">
        <div class="informe-cabecera">
          <div><div class="informe-empresa">MDE Electromecánica · Informe de trazabilidad</div>
            <h1>${esc(nroOT(o.numero))} ${chipEstadoOT(o.estado)}</h1>
            <div>${esc(o.cliente ? o.cliente.nombre : '')} · ${esc(u.dominio || '')}${u.interno ? ' · INT ' + esc(u.interno) : ''}</div></div>
          <div class="informe-emitido">${emitido()}</div></div>
        <section class="tarjeta"><div class="datos">
          <div class="dato"><div class="et">Unidad</div><div class="va">${esc([u.marca && u.marca.nombre, u.modelo && u.modelo.nombre].filter(Boolean).join(' ') || '—')}</div></div>
          <div class="dato"><div class="et">Tipo</div><div class="va">${esc(o.tipo)}</div></div>
          <div class="dato"><div class="et">Chasis</div><div class="va">${esc(u.chasis || '—')}</div></div>
          <div class="dato"><div class="et">KM</div><div class="va">${num(o.km, 0)}</div></div>
          <div class="dato"><div class="et">Ingreso</div><div class="va">${ingresoTexto(o)}</div></div>
          <div class="dato"><div class="et">Egreso</div><div class="va">${egresoTexto(o) || '—'}</div></div>
          ${o.solicitante ? `<div class="dato"><div class="et">Pedida por</div><div class="va">${esc(o.solicitante.nombre)}</div></div>` : ''}
          ${o.ot_cliente ? `<div class="dato"><div class="et">OT del cliente</div><div class="va">${esc(o.ot_cliente)}</div></div>` : ''}
          ${o.nro_factura ? `<div class="dato"><div class="et">N° factura</div><div class="va">${esc(o.nro_factura)}</div></div>` : ''}
        </div>${o.observaciones ? `<div style="margin-top:8px"><span class="nota">Observaciones:</span> ${esc(o.observaciones)}</div>` : ''}</section>
        <section class="kpis">
          <div class="kpi"><div class="kpi-et">En el taller</div><div class="kpi-va">${duracionTexto(minEntre(ingreso, finTaller))}</div><div class="kpi-sub">${finTaller ? 'del ingreso al ' + (egreso ? 'egreso' : 'cierre') : 'sigue en el taller'}</div></div>
          <div class="kpi"><div class="kpi-et">Hasta empezar</div><div class="kpi-va">${primerTrabajo ? duracionTexto(Math.max(0, minEntre(ingreso, primerTrabajo))) : '—'}</div><div class="kpi-sub">${primerTrabajo ? 'primer trabajo ' + fhc(primerTrabajo) : 'todavía no se trabajó'}</div></div>
          <div class="kpi"><div class="kpi-et">Trabajo real</div><div class="kpi-va">${horas(minTrab)}</div><div class="kpi-sub">tempario ${horas(minTemp)}${minTemp ? ' · ' + Math.round(minTrab / minTemp * 100) + '%' : ''}</div></div>
          <div class="kpi"><div class="kpi-et">En pausa</div><div class="kpi-va">${pausas.length ? duracionTexto(minPausa) : '—'}</div><div class="kpi-sub">${pausas.length} pausa${pausas.length === 1 ? '' : 's'}</div></div>
          <div class="kpi"><div class="kpi-et">Tareas</div><div class="kpi-va">${tareas.filter(t => t.estado === 'HECHA').length} / ${tareas.length}</div><div class="kpi-sub">hechas</div></div>
          <div class="kpi"><div class="kpi-et">Repuestos</div><div class="kpi-va">${repEntregados} / ${reps.length}</div><div class="kpi-sub">entregados${pedidos.length ? ' · ' + pedidos.length + ' pedidos a Depósito' : ''}</div></div>
        </section>

        <section class="tarjeta"><h2>Línea de tiempo</h2>
          <div class="lt-marco">${lineaDeTiempo({ desde: ltDesde, hasta: ltHasta, etapas: etapas.map(e => Object.assign({}, e, { hasta: e.abierta ? null : e.hasta })), mecanicos, pausas: pausasLT,
            hitos: [{ t: ingreso, texto: 'Ingreso' }, ...(egreso ? [{ t: egreso, texto: 'Egreso' }] : [])] })}</div>
          <div class="lt-leyenda"><span><i class="lt-k trabajo"></i>Trabajo del mecánico (cronómetro)</span><span><i class="lt-k pausa"></i>OT en pausa</span><span><i class="lt-k estado"></i>Estado de la OT</span>
            <span class="nota">En la computadora, pasá el mouse por cada barra para ver horarios y duración.</span></div>
        </section>

        <section class="tarjeta"><h2>Etapas</h2>
          ${sinHistorial ? `<div class="nota" style="margin-bottom:6px">Esta OT cambió de estado antes de que existiera el registro de estados: se muestra desde que se empezó a registrar.</div>` : ''}
          <div class="tabla-caja"><table><thead><tr><th>Estado</th><th>Desde</th><th>Hasta</th><th class="num">Duración</th><th>Lo cambió</th></tr></thead><tbody>
            ${etapas.map(e => `<tr><td>${chipEstadoOT(e.etiqueta)}</td><td>${fh(e.desde)}</td><td>${e.abierta ? '<b>actual</b>' : terminada(o) && e === etapas[etapas.length - 1] ? '—' : fh(e.hasta)}</td>
              <td class="num">${terminada(o) && e === etapas[etapas.length - 1] ? '—' : duracionTexto(minEntre(e.desde, e.abierta ? null : e.hasta))}</td><td>${esc(e.quien || (e.i === 0 ? 'Al crear la OT' : ''))}</td></tr>`).join('')
              || `<tr><td colspan="5" class="vacio">Sin cambios de estado registrados. Estado actual: ${esc(o.estado)}.</td></tr>`}
          </tbody></table></div></section>

        <section class="tarjeta"><h2>Tareas</h2>
          <div class="tabla-caja"><table><thead><tr><th>#</th><th>Tarea</th><th>Mecánico</th><th class="num">Tempario</th><th class="num">Real</th><th class="num">Diferencia</th><th>Empezó</th><th>Terminó</th><th>Estado</th></tr></thead><tbody>
            ${tareas.map(t => {
              const real = realPorTarea(t.id), temp = Number(t.horas_total || 0) * 60;
              const fin = (t.asignaciones || []).map(a => a.terminada_en).filter(Boolean).sort().pop();
              const dif = real - temp;
              return `<tr><td>${t.renglon}</td><td>${esc(t.descripcion)}${Number(t.cantidad) !== 1 ? ' × ' + num(t.cantidad) : ''}</td>
                <td>${esc((t.asignaciones || []).map(a => a.usuario ? a.usuario.nombre : '').join(', ') || 'Sin asignar')}</td>
                <td class="num">${horas(temp)}</td><td class="num">${real ? horas(real) : '—'}</td>
                <td class="num">${real ? (dif > 0 ? '+' : dif < 0 ? '−' : '') + horas(Math.abs(dif)) : '—'}</td>
                <td>${fhc(inicioTarea(t.id)) || '—'}</td><td>${t.estado === 'HECHA' && fin ? fhc(fin) : '—'}</td><td>${chipEstadoTarea(t.estado)}</td></tr>`;
            }).join('') || '<tr><td colspan="9" class="vacio">Sin tareas.</td></tr>'}
          </tbody></table></div>
          <div class="nota" style="margin-top:6px">Diferencia: tiempo real menos tempario (+ = tardó más que el tempario).</div></section>

        ${mecanicos.length ? `<section class="tarjeta"><h2>Mecánicos</h2>
          <div class="tabla-caja"><table><thead><tr><th>Mecánico</th><th class="num">Tramos de trabajo</th><th class="num">Tiempo trabajado</th><th>Primer trabajo</th><th>Último trabajo</th></tr></thead><tbody>
            ${mecanicos.map(m => `<tr><td><b>${esc(m.nombre)}</b></td><td class="num">${m.segs.length}</td><td class="num">${horas(m.min)}</td>
              <td>${fhc(m.segs[0].desde)}</td><td>${m.segs.some(s => !s.hasta) ? '<b>trabajando ahora</b>' : fhc(m.segs[m.segs.length - 1].hasta)}</td></tr>`).join('')}
          </tbody></table></div></section>` : ''}

        <section class="tarjeta"><h2>Pausas</h2>
          <div class="tabla-caja"><table><thead><tr><th>Motivo</th><th>Desde</th><th>Hasta</th><th class="num">Duración</th><th>Pausó</th><th>Reanudó</th></tr></thead><tbody>
            ${pausas.map(p => `<tr><td><b>${esc(textoMotivo(p.motivo))}</b>${p.detalle ? `<div class="nota">${esc(p.detalle)}</div>` : ''}</td>
              <td>${fh(p.inicio)}</td><td>${p.fin ? fh(p.fin) : '<b>sigue pausada</b>'}</td><td class="num">${duracionTexto(minEntre(p.inicio, p.fin))}</td>
              <td>${esc(p.pausador ? p.pausador.nombre : '')}</td><td>${esc(p.reanudador ? p.reanudador.nombre : '')}</td></tr>`).join('') || '<tr><td colspan="6" class="vacio">La OT no tuvo pausas.</td></tr>'}
          </tbody></table></div></section>

        <section class="tarjeta"><h2>Repuestos</h2>
          <div class="tabla-caja"><table><thead><tr><th>Código</th><th>Repuesto</th><th class="num">Cant.</th><th>Cargó</th><th>Cargado</th><th>Entregó</th><th>Entregado</th><th class="num">Demora</th></tr></thead><tbody>
            ${reps.map(r => `<tr><td>${esc(r.codigo)}</td><td>${esc(r.repuesto ? r.repuesto.descripcion : '')}</td><td class="num">${num(r.cantidad)}</td>
              <td>${esc(r.cargador ? r.cargador.nombre : '')}</td><td>${fhc(r.cargado_en)}</td><td>${esc(r.entregador ? r.entregador.nombre : '')}</td>
              <td>${r.entregado_en ? fhc(r.entregado_en) : '<b>pendiente</b>'}</td><td class="num">${r.entregado_en ? duracionTexto(minEntre(r.cargado_en, r.entregado_en)) : '—'}</td></tr>`).join('')
              || '<tr><td colspan="8" class="vacio">Sin repuestos.</td></tr>'}
          </tbody></table></div>
          ${pedidos.length ? `<h3 style="margin:14px 0 6px">Pedidos a Depósito</h3>
          <div class="tabla-caja"><table><thead><tr><th>Repuesto</th><th class="num">Cant.</th><th>Pidió</th><th>Pedido</th><th>Resolvió</th><th>Resuelto</th><th class="num">Demora</th></tr></thead><tbody>
            ${pedidos.map(p => `<tr><td>${esc(p.descripcion)}${p.detalle ? `<div class="nota">${esc(p.detalle)}</div>` : ''}</td><td class="num">${num(p.cantidad)}</td>
              <td>${esc(p.pedidor ? p.pedidor.nombre : '')}</td><td>${fhc(p.creado_en)}</td><td>${esc(p.resolvio ? p.resolvio.nombre : '')}</td>
              <td>${p.resuelto_en ? fhc(p.resuelto_en) : '<b>pendiente</b>'}</td><td class="num">${duracionTexto(minEntre(p.creado_en, p.resuelto_en))}${p.resuelto_en ? '' : ' (sigue)'}</td></tr>`).join('')}
          </tbody></table></div>` : ''}</section>

        <section class="tarjeta informe-registro"><h2>Registro completo</h2>
          <div class="tabla-caja"><table><thead><tr><th>Cuándo</th><th>Hasta</th><th>Qué</th><th>Detalle</th><th>Quién</th></tr></thead><tbody>
            ${(registro || []).map(e => `<tr><td style="white-space:nowrap">${fhc(e.momento)}</td><td style="white-space:nowrap">${e.hasta ? fhc(e.hasta) : ''}</td>
              <td>${esc((e.tipo.charAt(0) + e.tipo.slice(1).toLowerCase()).replace(/^Ot /, 'OT '))}</td><td>${esc(e.detalle || '')}</td><td>${esc(e.usuario || '')}</td></tr>`).join('')}
          </tbody></table></div></section>
        <div class="nota informe-pie">Horarios en hora de Argentina. El tiempo trabajado sale del cronómetro de cada mecánico; las horas de tempario son las que se cobran.</div>
      </div>`;
    on(main, 'click', '[data-accion=imprimir]', () => window.print());
  }, ['ADMINISTRADOR']);
})();
