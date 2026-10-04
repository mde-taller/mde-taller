// MDE · Taller — pantallas de oficina: órdenes de trabajo, solicitudes, clientes y unidades.
(() => {
  const { st, cfg, esc, num, parseNum, nroOT, fecha, fechaHora, hoyISO, horaActual, esAdmin, esOficina,
          chipEstadoOT, chipEstadoTarea, errMsg, toast, modal, confirmar, ICONOS, ESTADOS_OT, TIPOS,
          ruta, ir, on, navegar } = App;

  const cacheTempario = {};
  async function tempario(tipo) {
    if (!cacheTempario[tipo]) {
      cacheTempario[tipo] = await Api.select('tempario', {
        select: 'id,tarea,horas,categoria:categorias_tempario(nombre)', tipo: 'eq.' + tipo, activo: 'is.true', order: 'tarea' });
    }
    return cacheTempario[tipo];
  }
  const claveTarea = x => `${x.tarea} · ${x.categoria ? x.categoria.nombre : ''}`;
  async function mecanicos() {
    const filas = await Api.select('usuario_roles', { select: 'usuario_id,usuario:usuarios(nombre,activo)', rol: 'eq.MECANICO' });
    return filas.filter(f => f.usuario && f.usuario.activo).map(f => ({ id: f.usuario_id, nombre: f.usuario.nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  // Pide horas para una tarea escrita a mano.
  async function pedirTareaAMano(texto) {
    const v = await modal({ titulo: 'Tarea escrita a mano', textoOk: 'Agregar',
      html: '<p class="nota">No está en el tempario de este tipo de unidad. Se agrega con las horas que indiques.</p>',
      campos: [{ id: 'desc', label: 'Tarea', valor: texto, obligatorio: true },
               { id: 'horas', label: 'Horas', valor: '', inputmode: 'decimal', obligatorio: true }] });
    if (!v) return null;
    const h = parseNum(v.horas);
    if (!(h >= 0)) { toast('Las horas no son válidas', 'error'); return null; }
    return { descripcion: v.desc.trim(), horas: h };
  }

  // ---------------- Lista de OT ----------------
  let filtroEstado = 'activas', filtroTexto = '';
  ruta(/^#\/ots$/, async main => {
    const params = { select: 'id,numero,estado,fecha_ingreso,tipo,km,unidad:unidades(dominio,interno),cliente:clientes(nombre),tareas:tareas_ot(estado)',
                     order: 'numero.desc', limit: 300 };
    if (filtroEstado === 'activas') params.estado = 'not.in.(CERRADA,PRUEBA)';
    else if (filtroEstado !== 'todas') params.estado = 'eq.' + filtroEstado;
    const ots = await Api.select('ordenes_trabajo', params);
    main.innerHTML = `
      <div class="encabezado"><div><h1>Órdenes de trabajo</h1><div class="sub" id="cuenta"></div></div>
        <div class="acciones">${esOficina() ? '<a class="btn btn-primario" href="#/ot-nueva">Nueva OT</a>' : ''}</div></div>
      <div class="fila-campos">
        <div class="campo"><label for="f-estado">Estado</label><select id="f-estado">
          <option value="activas">Activas (sin cerradas)</option><option value="todas">Todas</option>
          ${ESTADOS_OT.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join('')}</select></div>
        <div class="campo"><label for="f-texto">Buscar</label>
          <input id="f-texto" type="search" placeholder="N° de OT, cliente, dominio o INT" value="${esc(filtroTexto)}"></div>
      </div>
      <div class="tabla-caja"><table><thead><tr><th>N° OT</th><th>Ingreso</th><th>Cliente</th><th>Dominio · INT</th><th>Tipo</th><th>Estado</th><th>Tareas hechas</th></tr></thead>
        <tbody id="tbody"></tbody></table></div>`;
    document.getElementById('f-estado').value = filtroEstado;
    const pintar = () => {
      const q = filtroTexto.trim().toUpperCase();
      const lista = ots.filter(o => !q || [nroOT(o.numero), String(o.numero), o.cliente && o.cliente.nombre,
        o.unidad && o.unidad.dominio, o.unidad && o.unidad.interno].some(v => String(v || '').toUpperCase().includes(q)));
      document.getElementById('cuenta').textContent = `${lista.length} OT`;
      document.getElementById('tbody').innerHTML = lista.length ? lista.map(o => {
        const tot = (o.tareas || []).length, hechas = (o.tareas || []).filter(t => t.estado === 'HECHA').length;
        return `<tr class="clic" data-ot="${o.id}"><td><b>${esc(nroOT(o.numero))}</b></td><td>${fecha(o.fecha_ingreso)}</td>
          <td>${esc(o.cliente ? o.cliente.nombre : '')}</td><td>${esc(o.unidad ? o.unidad.dominio : '')}${o.unidad && o.unidad.interno ? ' · ' + esc(o.unidad.interno) : ''}</td>
          <td>${esc(o.tipo)}</td><td>${chipEstadoOT(o.estado)}</td><td>${hechas}/${tot}</td></tr>`;
      }).join('') : '<tr><td colspan="7" class="vacio">No hay OT para mostrar.</td></tr>';
    };
    pintar();
    document.getElementById('f-estado').addEventListener('change', ev => { filtroEstado = ev.target.value; navegar(); });
    document.getElementById('f-texto').addEventListener('input', ev => { filtroTexto = ev.target.value; pintar(); });
    on(main, 'click', 'tr[data-ot]', (ev, tr) => ir('#/ot/' + tr.dataset.ot));
  }, ['OFICINA', 'ADMINISTRADOR', 'DEPOSITO']);

  // ---------------- Nueva OT ----------------
  ruta(/^#\/ot-nueva$/, async main => {
    const clientes = await Api.select('clientes', { select: 'id,nombre', order: 'nombre' });
    const s = { unidades: [], unidad: null, tipo: '', tareas: [], repuestos: [] };

    main.innerHTML = `
      <div class="encabezado"><div><h1>Nueva orden de trabajo</h1><div class="sub">Fecha de ingreso: hoy (${fecha(hoyISO())}). El número se asigna solo al guardar.</div></div></div>
      <div class="dos-col">
        <div class="principal">
          <section class="tarjeta"><h2>Vehículo</h2>
            <div class="fila-campos">
              <div class="campo"><label for="n-cliente" class="obligatorio">Cliente</label><select id="n-cliente">
                <option value="">Elegí un cliente…</option>${clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}</select></div>
              <div class="campo"><label for="n-unidad" class="obligatorio">Dominio</label><select id="n-unidad" disabled><option value="">Elegí primero el cliente</option></select></div>
            </div>
            <div id="n-datos-unidad" class="datos" style="margin-bottom:12px"></div>
            <div class="nota" style="margin-bottom:12px">¿La unidad no está? Cargala en <a href="#/clientes">Clientes y unidades</a>.</div>
            <div class="fila-campos">
              <div class="campo"><label for="n-tipo" class="obligatorio">Tipo de unidad</label><select id="n-tipo">
                <option value="">Elegí…</option>${TIPOS.map(t => `<option>${t}</option>`).join('')}</select></div>
              <div class="campo"><label for="n-km" class="obligatorio">KM</label><input id="n-km" inputmode="numeric" autocomplete="off"></div>
              <div class="campo"><label for="n-hora">Hora de ingreso</label><input id="n-hora" type="time" value="${horaActual()}"></div>
            </div>
            <div class="fila-campos">
              <div class="campo"><label for="n-presupuesto">Presupuesto</label><input id="n-presupuesto"></div>
              <div class="campo"><label for="n-otcliente">OT del cliente</label><input id="n-otcliente"></div>
            </div>
            <div class="campo"><label for="n-obs">Observaciones</label><textarea id="n-obs"></textarea></div>
          </section>
          <section class="tarjeta"><h2>Trabajos y servicios</h2>
            <form id="f-tarea" style="display:flex;gap:8px;margin-bottom:8px">
              <input id="n-buscar-tarea" list="dl-tareas" placeholder="Elegí primero el tipo de unidad" autocomplete="off" disabled>
              <datalist id="dl-tareas"></datalist>
              <button class="btn" type="submit">Agregar</button></form>
            <div class="nota" style="margin-bottom:10px">Buscá por nombre en el tempario. Si no está, se agrega como tarea a mano.</div>
            <div class="tabla-caja"><table><thead><tr><th>#</th><th>Tarea</th><th class="num">Horas</th><th></th></tr></thead><tbody id="n-tareas"></tbody></table></div>
          </section>
          <section class="tarjeta"><h2>Repuestos <span class="nota">(opcional; los mecánicos también los cargan)</span></h2>
            <form id="f-rep" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
              <input id="n-rep-cod" placeholder="Código" style="flex:2 1 160px" autocomplete="off">
              <input id="n-rep-cant" placeholder="Cantidad" inputmode="decimal" style="flex:1 1 90px" autocomplete="off">
              <button class="btn" type="submit">Agregar</button></form>
            <div class="tabla-caja"><table><thead><tr><th>Código</th><th>Repuesto</th><th class="num">Cantidad</th><th class="num">Stock</th><th></th></tr></thead><tbody id="n-reps"></tbody></table></div>
          </section>
        </div>
        <div class="secundaria">
          <section class="tarjeta">
            <h2>Resumen</h2>
            <div class="datos" id="n-resumen"></div>
            <div class="error-box oculto" id="n-error"></div>
            <button class="btn btn-primario btn-grande" id="n-guardar" style="margin-top:12px">Guardar OT</button>
            <div class="nota" style="margin-top:8px">Obligatorio: cliente, dominio, tipo, KM y al menos un trabajo o repuesto.</div>
          </section>
        </div>
      </div>`;

    const $ = id => document.getElementById(id);
    const pintarResumen = () => {
      const horas = s.tareas.reduce((a, t) => a + Number(t.horas || 0), 0);
      $('n-resumen').innerHTML = `
        <div class="dato"><div class="et">Trabajos</div><div class="va">${s.tareas.length}</div></div>
        <div class="dato"><div class="et">Total horas</div><div class="va">${num(horas)} h</div></div>
        <div class="dato"><div class="et">Repuestos</div><div class="va">${s.repuestos.length}</div></div>`;
    };
    const pintarTareas = () => {
      $('n-tareas').innerHTML = s.tareas.length ? s.tareas.map((t, i) => `<tr><td>${i + 1}</td>
        <td>${esc(t.descripcion)}${t.categoria ? `<div class="nota">${esc(t.categoria)}</div>` : '<div class="nota">A mano</div>'}</td>
        <td class="num">${num(t.horas)}</td><td><button class="btn-texto" data-quitar-t="${i}">Quitar</button></td></tr>`).join('')
        : '<tr><td colspan="4" class="vacio">Sin trabajos todavía.</td></tr>';
      pintarResumen();
    };
    const pintarReps = () => {
      $('n-reps').innerHTML = s.repuestos.length ? s.repuestos.map((r, i) => `<tr><td>${esc(r.codigo)}</td><td>${esc(r.descripcion)}</td>
        <td class="num">${num(r.cantidad)}</td><td class="num">${num(r.disponible)}</td><td><button class="btn-texto" data-quitar-r="${i}">Quitar</button></td></tr>`).join('')
        : '<tr><td colspan="5" class="vacio">Sin repuestos.</td></tr>';
      pintarResumen();
    };
    const cargarTempario = async () => {
      const inp = $('n-buscar-tarea');
      if (!s.tipo) { inp.disabled = true; inp.placeholder = 'Elegí primero el tipo de unidad'; $('dl-tareas').innerHTML = ''; return; }
      const lista = await tempario(s.tipo);
      $('dl-tareas').innerHTML = lista.map(x => `<option value="${esc(claveTarea(x))}">${num(x.horas)} h</option>`).join('');
      inp.disabled = false; inp.placeholder = `Buscar en tempario de unidad ${s.tipo.toLowerCase()}`;
    };
    pintarTareas(); pintarReps();

    $('n-cliente').addEventListener('change', async ev => {
      const sel = $('n-unidad');
      s.unidad = null; $('n-datos-unidad').innerHTML = '';
      if (!ev.target.value) { sel.disabled = true; sel.innerHTML = '<option value="">Elegí primero el cliente</option>'; return; }
      s.unidades = await Api.select('unidades', { select: 'id,dominio,interno,chasis,tipo,marca:marcas(nombre),modelo:modelos(nombre)',
                                                  cliente_id: 'eq.' + ev.target.value, order: 'dominio' });
      sel.disabled = false;
      sel.innerHTML = `<option value="">${s.unidades.length ? 'Elegí el dominio…' : 'Este cliente no tiene unidades'}</option>` +
        s.unidades.map(u => `<option value="${u.id}">${esc(u.dominio)}${u.interno ? ' · INT ' + esc(u.interno) : ''}</option>`).join('');
    });
    $('n-unidad').addEventListener('change', async ev => {
      s.unidad = s.unidades.find(u => String(u.id) === ev.target.value) || null;
      const u = s.unidad;
      $('n-datos-unidad').innerHTML = u ? `
        <div class="dato"><div class="et">INT</div><div class="va">${esc(u.interno || '—')}</div></div>
        <div class="dato"><div class="et">Chasis</div><div class="va">${esc(u.chasis || '—')}</div></div>
        <div class="dato"><div class="et">Marca y modelo</div><div class="va">${esc([u.marca && u.marca.nombre, u.modelo && u.modelo.nombre].filter(Boolean).join(' ') || '—')}</div></div>` : '';
      if (u && u.tipo) { $('n-tipo').value = u.tipo; s.tipo = u.tipo; await cargarTempario(); }
    });
    $('n-tipo').addEventListener('change', async ev => {
      if (s.tareas.some(t => t.tempario_id) && ev.target.value !== s.tipo) {
        const ok = await confirmar('Cambiar el tipo de unidad quita las tareas del tempario ya agregadas. ¿Seguir?');
        if (!ok) { ev.target.value = s.tipo; return; }
        s.tareas = s.tareas.filter(t => !t.tempario_id); pintarTareas();
      }
      s.tipo = ev.target.value; await cargarTempario();
    });
    $('f-tarea').addEventListener('submit', async ev => {
      ev.preventDefault();
      const texto = $('n-buscar-tarea').value.trim();
      if (!texto) return;
      const lista = await tempario(s.tipo);
      const x = lista.find(y => claveTarea(y) === texto) || lista.filter(y => y.tarea.toUpperCase() === texto.toUpperCase()).find((y, i, arr) => arr.length === 1);
      if (x) s.tareas.push({ tempario_id: x.id, descripcion: x.tarea, horas: Number(x.horas), categoria: x.categoria ? x.categoria.nombre : '' });
      else { const m = await pedirTareaAMano(texto); if (!m) return; s.tareas.push(m); }
      $('n-buscar-tarea').value = ''; pintarTareas(); $('n-buscar-tarea').focus();
    });
    $('f-rep').addEventListener('submit', async ev => {
      ev.preventDefault();
      const cod = $('n-rep-cod').value.trim(), cant = parseNum($('n-rep-cant').value);
      if (!cod) return;
      if (!(cant > 0)) return toast('Indicá una cantidad mayor a cero', 'error');
      try {
        const r = (await Api.rpc('consultar_stock', { p_codigo: cod }))[0];
        if (!r) return toast('No existe un repuesto con ese código', 'error');
        const yaPedido = s.repuestos.filter(x => x.codigo === r.codigo).reduce((a, x) => a + x.cantidad, 0);
        if (cant + yaPedido > Number(r.disponible)) return toast(`No alcanza el stock de ${r.codigo}: hay ${num(r.disponible)}`, 'error');
        s.repuestos.push({ codigo: r.codigo, descripcion: r.descripcion, cantidad: cant, disponible: Number(r.disponible) });
        $('n-rep-cod').value = ''; $('n-rep-cant').value = ''; pintarReps(); $('n-rep-cod').focus();
      } catch (e) { toast(errMsg(e), 'error'); }
    });
    on(main, 'click', '[data-quitar-t]', (ev, b) => { s.tareas.splice(Number(b.dataset.quitarT), 1); pintarTareas(); });
    on(main, 'click', '[data-quitar-r]', (ev, b) => { s.repuestos.splice(Number(b.dataset.quitarR), 1); pintarReps(); });
    $('n-guardar').addEventListener('click', async ev => {
      const err = $('n-error');
      const falta = [];
      if (!$('n-cliente').value) falta.push('cliente');
      if (!s.unidad) falta.push('dominio');
      if (!$('n-tipo').value) falta.push('tipo de unidad');
      const km = parseInt(String($('n-km').value).replace(/\D/g, ''), 10);
      if (isNaN(km)) falta.push('KM');
      if (!s.tareas.length && !s.repuestos.length) falta.push('al menos un trabajo o repuesto');
      if (falta.length) { err.textContent = 'Falta: ' + falta.join(', ') + '.'; err.classList.remove('oculto'); return; }
      err.classList.add('oculto');
      ev.target.disabled = true; ev.target.textContent = 'Guardando…';
      try {
        const id = await Api.rpc('crear_ot', {
          p_unidad_id: s.unidad.id, p_km: km, p_tipo: $('n-tipo').value,
          p_tareas: s.tareas.map(t => t.tempario_id ? { tempario_id: t.tempario_id } : { descripcion: t.descripcion, horas: t.horas }),
          p_repuestos: s.repuestos.map(r => ({ codigo: r.codigo, cantidad: r.cantidad })),
          p_observaciones: $('n-obs').value.trim() || null, p_presupuesto: $('n-presupuesto').value.trim() || null,
          p_ot_cliente: $('n-otcliente').value.trim() || null, p_hora_ingreso: $('n-hora').value || null
        });
        toast('OT guardada');
        ir('#/ot/' + id);
      } catch (e) {
        err.textContent = errMsg(e); err.classList.remove('oculto');
        ev.target.disabled = false; ev.target.textContent = 'Guardar OT';
      }
    });
  }, ['OFICINA', 'ADMINISTRADOR']);

  // ---------------- Solicitudes: aprobar y rechazar ----------------
  async function aprobar(sol, listaMecanicos) {
    const opciones = [['', 'Sin asignar por ahora']].concat(listaMecanicos.map(m => [m.id, m.nombre]));
    const campos = [{ id: 'mec', label: 'Asignar a', tipo: 'select', opciones, valor: sol.mecanico ? sol.mecanico.id : '' }];
    if (!sol.tempario_id) campos.push({ id: 'horas', label: 'Horas a cobrar (la tarea no está en el tempario)', inputmode: 'decimal', obligatorio: true });
    const v = await modal({ titulo: 'Aprobar solicitud', textoOk: 'Aprobar',
      html: `<p><b>${esc(sol.tarea_propuesta)}</b></p><p class="nota">Falla: ${esc(sol.falla)}</p>`, campos });
    if (!v) return false;
    let horas = null;
    if (!sol.tempario_id) {
      horas = parseNum(v.horas);
      if (!(horas >= 0)) { toast('Las horas no son válidas', 'error'); return false; }
    }
    try {
      const tareaId = await Api.rpc('aprobar_solicitud', { p_solicitud_id: sol.id, p_mecanicos: v.mec ? [v.mec] : null });
      if (horas != null) await Api.update('tareas_ot', { id: 'eq.' + tareaId }, { horas });
      toast('Solicitud aprobada: la tarea se agregó a la OT');
      return true;
    } catch (e) { toast(errMsg(e), 'error'); return false; }
  }
  async function rechazar(sol) {
    const v = await modal({ titulo: 'Rechazar solicitud', textoOk: 'Rechazar', peligro: true,
      html: `<p><b>${esc(sol.tarea_propuesta)}</b></p>`,
      campos: [{ id: 'motivo', label: 'Motivo (le llega al mecánico)', tipo: 'textarea', obligatorio: true }] });
    if (!v) return false;
    try { await Api.rpc('rechazar_solicitud', { p_solicitud_id: sol.id, p_motivo: v.motivo.trim() }); toast('Solicitud rechazada'); return true; }
    catch (e) { toast(errMsg(e), 'error'); return false; }
  }
  const selSolicitud = 'id,falla,tarea_propuesta,tempario_id,estado,motivo_rechazo,creado_en,resuelta_en,' +
                       'ot:ordenes_trabajo(id,numero,unidad:unidades(dominio)),mecanico:usuarios!solicitudes_mecanico_id_fkey(id,nombre)';

  ruta(/^#\/solicitudes$/, async main => {
    const [pend, resueltas, mecs] = await Promise.all([
      Api.select('solicitudes', { select: selSolicitud, estado: 'eq.PENDIENTE', order: 'creado_en' }),
      Api.select('solicitudes', { select: selSolicitud, estado: 'neq.PENDIENTE', order: 'resuelta_en.desc', limit: 30 }),
      mecanicos()
    ]);
    main.innerHTML = `
      <div class="encabezado"><div><h1>Solicitudes de tareas</h1><div class="sub">${pend.length} pendientes</div></div></div>
      <div class="lista-tareas">${pend.length ? pend.map((s, i) => `
        <div class="tarea-card">
          <div class="linea1"><span><a href="#/ot/${s.ot.id}">${esc(nroOT(s.ot.numero))}</a> · ${esc(s.ot.unidad ? s.ot.unidad.dominio : '')} · ${esc(s.mecanico ? s.mecanico.nombre : '')} · ${fechaHora(s.creado_en)}</span></div>
          <div class="titulo">${esc(s.tarea_propuesta)}</div>
          <div class="linea3">Falla: ${esc(s.falla)}</div>
          <div class="acciones" style="margin-top:6px"><button class="btn btn-verde" data-aprobar="${i}">Aprobar</button>
            <button class="btn btn-peligro" data-rechazar="${i}">Rechazar</button></div>
        </div>`).join('') : '<div class="tarjeta vacio">No hay solicitudes pendientes.</div>'}</div>
      <h2 style="margin:24px 0 10px">Resueltas recientemente</h2>
      <div class="tabla-caja"><table><thead><tr><th>OT</th><th>Mecánico</th><th>Tarea propuesta</th><th>Resultado</th></tr></thead><tbody>
        ${resueltas.length ? resueltas.map(s => `<tr><td>${esc(nroOT(s.ot.numero))}</td><td>${esc(s.mecanico ? s.mecanico.nombre : '')}</td>
          <td>${esc(s.tarea_propuesta)}</td><td>${s.estado === 'APROBADA' ? '<span class="chip verde">Aprobada</span>' :
          `<span class="chip rojo">Rechazada</span> <span class="nota">${esc(s.motivo_rechazo)}</span>`}</td></tr>`).join('')
          : '<tr><td colspan="4" class="vacio">Sin solicitudes resueltas.</td></tr>'}</tbody></table></div>`;
    on(main, 'click', '[data-aprobar]', async (ev, b) => { if (await aprobar(pend[Number(b.dataset.aprobar)], mecs)) navegar(); });
    on(main, 'click', '[data-rechazar]', async (ev, b) => { if (await rechazar(pend[Number(b.dataset.rechazar)])) navegar(); });
  }, ['OFICINA', 'ADMINISTRADOR']);

  // ---------------- Detalle de OT ----------------
  async function cargarOT(id) {
    const [ots, tareas, reps] = await Promise.all([
      Api.select('ordenes_trabajo', { select: '*,unidad:unidades(id,dominio,interno,chasis,tipo,marca:marcas(nombre),modelo:modelos(nombre)),cliente:clientes(nombre,cuit,telefono)',
                                      id: 'eq.' + id }),
      Api.select('tareas_ot', { select: 'id,renglon,descripcion,horas,estado,tempario(categoria:categorias_tempario(nombre)),asignaciones(mecanico_id,terminada_en,usuario:usuarios(nombre))',
                                ot_id: 'eq.' + id, order: 'renglon' }),
      Api.select('repuestos_ot', { select: 'id,codigo,cantidad,tarea_id,cargado_en,repuesto:repuestos(descripcion),cargador:usuarios!repuestos_ot_cargado_por_fkey(nombre)',
                                   ot_id: 'eq.' + id, order: 'id' })
    ]);
    return { ot: ots[0], tareas, reps };
  }

  ruta(/^#\/ot\/(\d+)$/, async (main, id) => {
    const { ot, tareas, reps } = await cargarOT(id);
    if (!ot) { main.innerHTML = '<div class="tarjeta">No se encontró la OT.</div>'; return; }
    const puede = esOficina();
    const [mecs, sols, reales] = await Promise.all([
      puede ? mecanicos() : Promise.resolve([]),
      puede ? Api.select('solicitudes', { select: selSolicitud, ot_id: 'eq.' + id, estado: 'eq.PENDIENTE', order: 'creado_en' }) : Promise.resolve([]),
      esAdmin() ? Api.select('horas_reales', { select: 'tarea_id,mecanico,horas_reales,en_curso', ot_id: 'eq.' + id }) : Promise.resolve([])
    ]);
    const u = ot.unidad || {};
    const totalHoras = tareas.reduce((a, t) => a + Number(t.horas || 0), 0);
    const renglonDe = new Map(tareas.map(t => [t.id, t.renglon]));
    const realesPorTarea = {};
    for (const r of reales) (realesPorTarea[r.tarea_id] = realesPorTarea[r.tarea_id] || []).push(r);
    const temp = puede ? await tempario(ot.tipo) : [];

    main.innerHTML = `
      <a class="volver no-imprimir" href="#/ots">${ICONOS.atras} Órdenes de trabajo</a>
      <div class="encabezado">
        <div><h1>${esc(nroOT(ot.numero))}</h1>
          <div class="sub">${esc(ot.cliente ? ot.cliente.nombre : '')} · ${esc(u.dominio)}${u.interno ? ' · INT ' + esc(u.interno) : ''} · ${esc(ot.tipo)}</div></div>
        <div class="acciones">
          ${puede ? `<select id="o-estado" aria-label="Estado de la OT" style="width:auto">${ESTADOS_OT.map(e => `<option ${e === ot.estado ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>`
                  : chipEstadoOT(ot.estado)}
          <a class="btn" href="#/imprimir/${ot.id}">Imprimir / PDF</a>
          ${esAdmin() ? '<button class="btn btn-peligro" data-accion="borrar-ot">Eliminar</button>' : ''}
        </div>
      </div>
      ${sols.length ? `<section class="tarjeta" style="border-color:var(--ambar-borde);background:var(--ambar)"><h2>Solicitudes pendientes</h2>
        ${sols.map((s, i) => `<div class="repuesto-fila"><div class="info"><div class="desc">${esc(s.tarea_propuesta)}</div>
          <div class="cod">${esc(s.mecanico ? s.mecanico.nombre : '')} · Falla: ${esc(s.falla)}</div></div>
          <button class="btn btn-verde btn-chico" data-aprobar="${i}">Aprobar</button>
          <button class="btn btn-peligro btn-chico" data-rechazar="${i}">Rechazar</button></div>`).join('')}</section>` : ''}
      <div class="dos-col">
        <div class="principal">
          <section class="tarjeta"><h2>Trabajos y servicios</h2>
            <div class="tabla-caja"><table><thead><tr><th>#</th><th style="min-width:200px">Tarea</th><th class="num">Hs tempario</th><th>Mecánicos</th><th>Estado</th>
              ${esAdmin() ? '<th>Horas reales</th>' : ''}${puede ? '<th></th>' : ''}</tr></thead><tbody>
            ${tareas.length ? tareas.map(t => {
              const asig = t.asignaciones || [];
              const libres = mecs.filter(m => !asig.some(a => a.mecanico_id === m.id));
              return `<tr><td>${t.renglon}</td>
                <td>${esc(t.descripcion)}${t.tempario && t.tempario.categoria ? `<div class="nota">${esc(t.tempario.categoria.nombre)}</div>` : '<div class="nota">A mano</div>'}</td>
                <td class="num">${puede ? `<button class="btn-texto" data-editar-tarea="${t.id}" title="Editar tarea y horas">${num(t.horas)}</button>` : num(t.horas)}</td>
                <td>${asig.map(a => `<span class="chip" style="margin:2px">${esc(a.usuario ? a.usuario.nombre : '')}${a.terminada_en ? ' ✓' : ''}${puede ? `<button class="chip-x" data-desasignar="${t.id}" data-mec="${a.mecanico_id}" aria-label="Quitar a ${esc(a.usuario ? a.usuario.nombre : '')}">×</button>` : ''}</span>`).join('')}
                  ${puede && asig.length < 2 && libres.length ? `<select data-asignar="${t.id}" aria-label="Asignar mecánico" style="width:auto;min-height:36px;margin-top:4px">
                    <option value="">${asig.length ? '+ segundo mecánico' : 'Asignar…'}</option>${libres.map(m => `<option value="${m.id}">${esc(m.nombre)}</option>`).join('')}</select>` : ''}
                  ${!asig.length && !puede ? '<span class="nota">Sin asignar</span>' : ''}</td>
                <td>${chipEstadoTarea(t.estado)}</td>
                ${esAdmin() ? `<td>${(realesPorTarea[t.id] || []).map(r => `<div class="nota">${esc(r.mecanico)}: ${num(r.horas_reales)} h${r.en_curso ? ' (en curso)' : ''}</div>`).join('') || '<span class="nota">—</span>'}</td>` : ''}
                ${puede ? `<td><button class="btn-texto" data-quitar-tarea="${t.id}">Quitar</button></td>` : ''}</tr>`;
            }).join('') : `<tr><td colspan="7" class="vacio">Sin trabajos.</td></tr>`}
            </tbody></table></div>
            <div style="margin-top:10px;font-weight:600">Total horas (tempario): ${num(totalHoras)} h</div>
            ${puede ? `<form id="f-agregar-tarea" style="display:flex;gap:8px;margin-top:12px">
              <input id="o-tarea" list="dl-o-tareas" placeholder="Agregar tarea: buscá en el tempario o escribila" autocomplete="off">
              <datalist id="dl-o-tareas">${temp.map(x => `<option value="${esc(claveTarea(x))}">${num(x.horas)} h</option>`).join('')}</datalist>
              <button class="btn" type="submit">Agregar</button></form>` : ''}
          </section>
          <section class="tarjeta"><h2>Repuestos</h2>
            <div class="tabla-caja"><table><thead><tr><th>Código</th><th>Repuesto</th><th class="num">Cantidad</th><th>Tarea</th><th>Cargó</th>${puede ? '<th></th>' : ''}</tr></thead><tbody>
              ${reps.length ? reps.map(r => `<tr><td>${esc(r.codigo)}</td><td>${esc(r.repuesto ? r.repuesto.descripcion : '')}</td><td class="num">${num(r.cantidad)}</td>
                <td>${r.tarea_id ? '#' + renglonDe.get(r.tarea_id) : '—'}</td><td>${esc(r.cargador ? r.cargador.nombre : '')}<div class="nota">${fechaHora(r.cargado_en)}</div></td>
                ${puede ? `<td><button class="btn-texto" data-quitar-rep="${r.id}">Quitar</button></td>` : ''}</tr>`).join('')
                : `<tr><td colspan="6" class="vacio">Sin repuestos cargados.</td></tr>`}
            </tbody></table></div>
            ${puede ? `<form id="f-agregar-rep" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
              <input id="o-rep-cod" placeholder="Código" style="flex:2 1 160px" autocomplete="off">
              <input id="o-rep-cant" placeholder="Cantidad" inputmode="decimal" style="flex:1 1 90px" autocomplete="off">
              <button class="btn" type="submit">Agregar repuesto</button></form>` : ''}
          </section>
        </div>
        <div class="secundaria">
          <section class="tarjeta"><h2>Datos de la OT</h2>
            <div class="datos" style="margin-bottom:14px">
              <div class="dato"><div class="et">Cliente</div><div class="va">${esc(ot.cliente ? ot.cliente.nombre : '')}</div></div>
              <div class="dato"><div class="et">Dominio</div><div class="va">${esc(u.dominio)}</div></div>
              <div class="dato"><div class="et">INT</div><div class="va">${esc(u.interno || '—')}</div></div>
              <div class="dato"><div class="et">Chasis</div><div class="va">${esc(u.chasis || '—')}</div></div>
              <div class="dato"><div class="et">Marca y modelo</div><div class="va">${esc([u.marca && u.marca.nombre, u.modelo && u.modelo.nombre].filter(Boolean).join(' ') || '—')}</div></div>
              <div class="dato"><div class="et">Ingreso</div><div class="va">${fecha(ot.fecha_ingreso)}${ot.hora_ingreso ? ' ' + esc(ot.hora_ingreso.slice(0, 5)) : ''}</div></div>
            </div>
            <form id="f-datos">
              <div class="fila-campos">
                <div class="campo"><label for="o-km">KM</label><input id="o-km" inputmode="numeric" value="${esc(ot.km)}" ${puede ? '' : 'disabled'}></div>
                <div class="campo"><label for="o-fac">N° factura</label><input id="o-fac" value="${esc(ot.nro_factura || '')}" ${puede ? '' : 'disabled'}></div>
              </div>
              <div class="fila-campos">
                <div class="campo"><label for="o-fsal">Fecha de salida</label><input id="o-fsal" type="date" value="${esc(ot.fecha_salida || '')}" ${puede ? '' : 'disabled'}></div>
                <div class="campo"><label for="o-hsal">Hora de salida</label><input id="o-hsal" type="time" value="${esc((ot.hora_salida || '').slice(0, 5))}" ${puede ? '' : 'disabled'}></div>
              </div>
              <div class="fila-campos">
                <div class="campo"><label for="o-pres">Presupuesto</label><input id="o-pres" value="${esc(ot.presupuesto || '')}" ${puede ? '' : 'disabled'}></div>
                <div class="campo"><label for="o-otc">OT del cliente</label><input id="o-otc" value="${esc(ot.ot_cliente || '')}" ${puede ? '' : 'disabled'}></div>
              </div>
              <div class="campo"><label for="o-obs">Observaciones</label><textarea id="o-obs" ${puede ? '' : 'disabled'}>${esc(ot.observaciones || '')}</textarea></div>
              ${puede ? '<button class="btn btn-primario" type="submit" style="width:100%">Guardar datos</button>' : ''}
            </form>
          </section>
        </div>
      </div>`;

    if (!puede) return;
    const recargar = () => navegar();
    document.getElementById('o-estado').addEventListener('change', async ev => {
      const nuevo = ev.target.value;
      try {
        const cambios = { estado: nuevo };
        if ((nuevo === 'FINALIZADA' || nuevo === 'CERRADA') && !ot.fecha_salida) {
          const ok = await confirmar(`¿Poner la fecha de salida de hoy (${fecha(hoyISO())})?`, { titulo: 'Fecha de salida', textoOk: 'Sí', textoCancelar: 'No' });
          if (ok) { cambios.fecha_salida = hoyISO(); cambios.hora_salida = horaActual(); }
        }
        await Api.update('ordenes_trabajo', { id: 'eq.' + id }, cambios);
        toast('Estado: ' + nuevo); recargar();
      } catch (e) { toast(errMsg(e), 'error'); ev.target.value = ot.estado; }
    });
    document.getElementById('f-datos').addEventListener('submit', async ev => {
      ev.preventDefault();
      const km = parseInt(String(document.getElementById('o-km').value).replace(/\D/g, ''), 10);
      if (isNaN(km)) return toast('El KM no es válido', 'error');
      const v = x => document.getElementById(x).value.trim() || null;
      try {
        await Api.update('ordenes_trabajo', { id: 'eq.' + id }, {
          km, nro_factura: v('o-fac'), fecha_salida: v('o-fsal'), hora_salida: v('o-hsal'),
          presupuesto: v('o-pres'), ot_cliente: v('o-otc'), observaciones: v('o-obs') });
        toast('Datos guardados'); recargar();
      } catch (e) { toast(errMsg(e), 'error'); }
    });
    on(main, 'change', '[data-asignar]', async (ev, sel) => {
      if (!sel.value) return;
      try { await Api.insert('asignaciones', { tarea_id: Number(sel.dataset.asignar), mecanico_id: sel.value }); toast('Mecánico asignado'); recargar(); }
      catch (e) { toast(errMsg(e), 'error'); sel.value = ''; }
    });
    on(main, 'click', '[data-desasignar]', async (ev, b) => {
      const ok = await confirmar('¿Quitar a este mecánico de la tarea? Su tiempo registrado queda guardado.', { textoOk: 'Quitar' });
      if (!ok) return;
      try { await Api.remove('asignaciones', { tarea_id: 'eq.' + b.dataset.desasignar, mecanico_id: 'eq.' + b.dataset.mec }); recargar(); }
      catch (e) { toast(errMsg(e), 'error'); }
    });
    on(main, 'click', '[data-editar-tarea]', async (ev, b) => {
      const t = tareas.find(x => String(x.id) === b.dataset.editarTarea);
      const v = await modal({ titulo: 'Editar tarea', textoOk: 'Guardar', campos: [
        { id: 'desc', label: 'Tarea', valor: t.descripcion, obligatorio: true },
        { id: 'horas', label: 'Horas a cobrar', valor: String(t.horas).replace('.', ','), inputmode: 'decimal', obligatorio: true }] });
      if (!v) return;
      const h = parseNum(v.horas);
      if (!(h >= 0)) return toast('Las horas no son válidas', 'error');
      try { await Api.update('tareas_ot', { id: 'eq.' + t.id }, { descripcion: v.desc.trim(), horas: h }); toast('Tarea actualizada'); recargar(); }
      catch (e) { toast(errMsg(e), 'error'); }
    });
    on(main, 'click', '[data-quitar-tarea]', async (ev, b) => {
      const ok = await confirmar('¿Quitar esta tarea de la OT? Se borran también sus tiempos registrados. Los repuestos quedan en la OT.',
        { titulo: 'Quitar tarea', textoOk: 'Quitar', peligro: true });
      if (!ok) return;
      try { await Api.remove('tareas_ot', { id: 'eq.' + b.dataset.quitarTarea }); toast('Tarea quitada'); recargar(); }
      catch (e) { toast(errMsg(e), 'error'); }
    });
    on(main, 'click', '[data-quitar-rep]', async (ev, b) => {
      const ok = await confirmar('¿Quitar este repuesto de la OT? El stock vuelve.', { titulo: 'Quitar repuesto', textoOk: 'Quitar', peligro: true });
      if (!ok) return;
      try { await Api.remove('repuestos_ot', { id: 'eq.' + b.dataset.quitarRep }); toast('Repuesto quitado: el stock volvió'); recargar(); }
      catch (e) { toast(errMsg(e), 'error'); }
    });
    on(main, 'click', '[data-aprobar]', async (ev, b) => { if (await aprobar(sols[Number(b.dataset.aprobar)], mecs)) recargar(); });
    on(main, 'click', '[data-rechazar]', async (ev, b) => { if (await rechazar(sols[Number(b.dataset.rechazar)])) recargar(); });
    document.getElementById('f-agregar-tarea').addEventListener('submit', async ev => {
      ev.preventDefault();
      const texto = document.getElementById('o-tarea').value.trim();
      if (!texto) return;
      const x = temp.find(y => claveTarea(y) === texto) || temp.filter(y => y.tarea.toUpperCase() === texto.toUpperCase()).find((y, i, arr) => arr.length === 1);
      let fila;
      if (x) fila = { ot_id: Number(id), tempario_id: x.id };
      else { const m = await pedirTareaAMano(texto); if (!m) return; fila = { ot_id: Number(id), descripcion: m.descripcion, horas: m.horas }; }
      try { await Api.insert('tareas_ot', fila); toast('Tarea agregada'); recargar(); }
      catch (e) { toast(errMsg(e), 'error'); }
    });
    document.getElementById('f-agregar-rep').addEventListener('submit', async ev => {
      ev.preventDefault();
      const cod = document.getElementById('o-rep-cod').value.trim(), cant = parseNum(document.getElementById('o-rep-cant').value);
      if (!cod) return;
      if (!(cant > 0)) return toast('Indicá una cantidad mayor a cero', 'error');
      try {
        const r = (await Api.rpc('consultar_stock', { p_codigo: cod }))[0];
        if (!r) return toast('No existe un repuesto con ese código', 'error');
        await Api.insert('repuestos_ot', { ot_id: Number(id), codigo: r.codigo, cantidad: cant });
        toast('Repuesto agregado'); recargar();
      } catch (e) { toast(errMsg(e), 'error'); }
    });
    const borrar = main.querySelector('[data-accion=borrar-ot]');
    if (borrar) borrar.addEventListener('click', async () => {
      const v = await modal({ titulo: 'Eliminar OT', textoOk: 'Eliminar', peligro: true,
        html: `<p>Se borra la ${esc(nroOT(ot.numero))} con sus tareas, tiempos y repuestos. El stock de los repuestos vuelve. No se puede deshacer.</p>`,
        campos: [{ id: 'conf', label: `Escribí ${ot.numero} para confirmar`, inputmode: 'numeric', obligatorio: true }] });
      if (!v) return;
      if (v.conf.trim() !== String(ot.numero)) return toast('El número no coincide: no se eliminó', 'error');
      try { await Api.remove('ordenes_trabajo', { id: 'eq.' + id }); toast('OT eliminada'); ir('#/ots'); }
      catch (e) { toast(errMsg(e), 'error'); }
    });
  }, ['OFICINA', 'ADMINISTRADOR', 'DEPOSITO']);

  // ---------------- Impresión / PDF ----------------
  ruta(/^#\/imprimir\/(\d+)$/, async (main, id) => {
    const { ot, tareas, reps } = await cargarOT(id);
    if (!ot) { main.innerHTML = '<div class="tarjeta">No se encontró la OT.</div>'; return; }
    const u = ot.unidad || {};
    const total = tareas.reduce((a, t) => a + Number(t.horas || 0), 0);
    const tituloAnterior = document.title;
    document.title = nroOT(ot.numero) + ' - ' + (u.dominio || '');
    st.limpiar.push(() => { document.title = tituloAnterior; });
    main.innerHTML = `
      <div class="acciones no-imprimir" style="margin-bottom:12px">
        <a class="btn" href="#/ot/${ot.id}">${ICONOS.atras} Volver a la OT</a>
        <button class="btn btn-primario" onclick="window.print()">Imprimir / Guardar PDF</button>
        <span class="nota">Para PDF, elegí "Guardar como PDF" en la impresora.</span>
      </div>
      <div class="hoja">
        <h1>ORDEN DE REPARACIÓN DE VEHÍCULO</h1>
        <div class="empresa">${esc(cfg.empresa)}</div>
        <table><tr><th>N° OT</th><td><b>${esc(nroOT(ot.numero))}</b></td><th>Presupuesto</th><td>${esc(ot.presupuesto || '')}</td><th>OT cliente</th><td>${esc(ot.ot_cliente || '')}</td></tr>
          <tr><th>Fecha ingreso</th><td>${fecha(ot.fecha_ingreso)}</td><th>Hora ingreso</th><td>${esc((ot.hora_ingreso || '').slice(0, 5))}</td><th>N° FAC</th><td>${esc(ot.nro_factura || '')}</td></tr>
          <tr><th>Fecha salida</th><td>${fecha(ot.fecha_salida)}</td><th>Hora salida</th><td>${esc((ot.hora_salida || '').slice(0, 5))}</td><th>Estado</th><td>${esc(ot.estado)}</td></tr></table>
        <div class="seccion">DATOS DEL VEHÍCULO</div>
        <table><tr><th>Cliente</th><th>Marca</th><th>Modelo</th><th>Dominio</th><th>INT</th><th>Chasis</th><th>KM</th></tr>
          <tr><td>${esc(ot.cliente ? ot.cliente.nombre : '')}</td><td>${esc(u.marca ? u.marca.nombre : '')}</td><td>${esc(u.modelo ? u.modelo.nombre : '')}</td>
          <td>${esc(u.dominio)}</td><td>${esc(u.interno || '')}</td><td>${esc(u.chasis || '')}</td><td>${num(ot.km, 0)}</td></tr></table>
        <div><b>Tipo de unidad:</b> ${esc(ot.tipo)}</div>
        <div class="seccion">TRABAJO Y SERVICIO</div>
        <table><tr><th style="width:8%">#</th><th>Descripción</th><th style="width:14%">HS</th></tr>
          ${tareas.map(t => `<tr><td>${t.renglon}</td><td>${esc(t.descripcion)}</td><td style="text-align:right">${num(t.horas)}</td></tr>`).join('') || '<tr><td colspan="3">—</td></tr>'}
          <tr><th colspan="2" style="text-align:right">TOTAL HS</th><th style="text-align:right">${num(total)}</th></tr></table>
        <div class="seccion">REPUESTOS</div>
        <table><tr><th style="width:24%">Código</th><th>Repuesto</th><th style="width:14%">Cantidad</th></tr>
          ${reps.map(r => `<tr><td>${esc(r.codigo)}</td><td>${esc(r.repuesto ? r.repuesto.descripcion : '')}</td><td style="text-align:right">${num(r.cantidad)}</td></tr>`).join('') || '<tr><td colspan="3">—</td></tr>'}</table>
        ${ot.observaciones ? `<div class="seccion">OBSERVACIONES</div><div class="caja" style="min-height:0">${esc(ot.observaciones)}</div>` : ''}
        <div class="firmas">
          <div><div class="seccion">CHECK INGRESO · INSPECCIÓN VISUAL</div><div class="nota" style="color:#000">G: Golpe / R: Rayado / F: Faltante</div><div class="caja"></div></div>
          <div><div class="seccion">ENTREGA</div>
            <div>Firma:</div><div class="linea-firma"></div><div>Aclaración:</div><div class="linea-firma"></div>
            <div>DNI:</div><div class="linea-firma"></div><div>Fecha de retiro:</div><div class="linea-firma"></div></div>
        </div>
      </div>`;
  }, ['OFICINA', 'ADMINISTRADOR', 'DEPOSITO']);

  // ---------------- Clientes y unidades ----------------
  let clienteSel = null;
  async function elegirMarcaModelo(actualMarca, actualModelo) {
    const modelos = await Api.select('modelos', { select: 'id,nombre,marca:marcas(id,nombre)', order: 'nombre' });
    const opciones = [['', '(sin cargar)']].concat(modelos.sort((a, b) => (a.marca.nombre + a.nombre).localeCompare(b.marca.nombre + b.nombre))
      .map(m => [m.id, m.marca.nombre + ' · ' + m.nombre])).concat([['otro', 'Otra marca o modelo…']]);
    return { modelos, opciones };
  }
  async function resolverMarcaModelo(valor, modelos) {
    if (!valor) return { marca_id: null, modelo_id: null };
    if (valor !== 'otro') { const m = modelos.find(x => String(x.id) === String(valor)); return { marca_id: m.marca.id, modelo_id: m.id }; }
    const v = await modal({ titulo: 'Nueva marca o modelo', textoOk: 'Agregar',
      campos: [{ id: 'marca', label: 'Marca', obligatorio: true }, { id: 'modelo', label: 'Modelo', obligatorio: true }] });
    if (!v) return null;
    const marcaTxt = v.marca.trim().toUpperCase(), modeloTxt = v.modelo.trim().toUpperCase();
    let marca = (await Api.select('marcas', { select: 'id,nombre' })).find(x => x.nombre.toUpperCase() === marcaTxt);
    if (!marca) marca = (await Api.insert('marcas', { nombre: marcaTxt }))[0];
    let modelo = (await Api.select('modelos', { select: 'id,nombre', marca_id: 'eq.' + marca.id })).find(x => x.nombre.toUpperCase() === modeloTxt);
    if (!modelo) modelo = (await Api.insert('modelos', { marca_id: marca.id, nombre: modeloTxt }))[0];
    return { marca_id: marca.id, modelo_id: modelo.id };
  }
  async function formUnidad(u, clienteId) {
    const { modelos, opciones } = await elegirMarcaModelo();
    const v = await modal({ titulo: u ? 'Editar unidad ' + u.dominio : 'Nueva unidad', textoOk: 'Guardar', campos: [
      { id: 'dominio', label: 'Dominio', valor: u ? u.dominio : '', obligatorio: true },
      { id: 'interno', label: 'INT (interno)', valor: u ? u.interno : '' },
      { id: 'chasis', label: 'Chasis', valor: u ? u.chasis : '' },
      { id: 'mm', label: 'Marca y modelo', tipo: 'select', opciones, valor: u && u.modelo_id ? u.modelo_id : '' },
      { id: 'tipo', label: 'Tipo de unidad', tipo: 'select', opciones: [['', '(sin cargar)']].concat(TIPOS), valor: u ? u.tipo || '' : '' }] });
    if (!v) return false;
    const mm = await resolverMarcaModelo(v.mm, modelos);
    if (!mm) return false;
    const fila = { dominio: v.dominio.trim().toUpperCase(), interno: v.interno.trim() || null, chasis: v.chasis.trim().toUpperCase() || null,
                   marca_id: mm.marca_id, modelo_id: mm.modelo_id, tipo: v.tipo || null };
    try {
      if (u) await Api.update('unidades', { id: 'eq.' + u.id }, fila);
      else await Api.insert('unidades', Object.assign({ cliente_id: clienteId }, fila));
      toast(u ? 'Unidad guardada' : 'Unidad agregada'); return true;
    } catch (e) { toast(errMsg(e), 'error'); return false; }
  }
  async function formCliente(c) {
    const v = await modal({ titulo: c ? 'Editar cliente' : 'Nuevo cliente', textoOk: 'Guardar', campos: [
      { id: 'nombre', label: 'Cliente', valor: c ? c.nombre : '', obligatorio: true },
      { id: 'cuit', label: 'CUIT', valor: c ? c.cuit : '' }, { id: 'telefono', label: 'Teléfono', valor: c ? c.telefono : '' },
      { id: 'email', label: 'Email', valor: c ? c.email : '' }, { id: 'direccion', label: 'Dirección', valor: c ? c.direccion : '' },
      { id: 'contacto', label: 'Contacto', valor: c ? c.contacto : '' }] });
    if (!v) return null;
    const fila = { nombre: v.nombre.trim().toUpperCase() };
    for (const k of ['cuit', 'telefono', 'email', 'direccion', 'contacto']) fila[k] = v[k].trim() || null;
    try {
      const r = c ? await Api.update('clientes', { id: 'eq.' + c.id }, fila) : await Api.insert('clientes', fila);
      toast('Cliente guardado'); return r[0];
    } catch (e) { toast(errMsg(e), 'error'); return null; }
  }

  ruta(/^#\/clientes$/, async main => {
    const [clientes, todas] = await Promise.all([
      Api.select('clientes', { select: 'id,nombre,cuit,telefono,email,direccion,contacto', order: 'nombre' }),
      Api.select('unidades', { select: 'cliente_id' })
    ]);
    const cantidad = {};
    for (const u of todas) cantidad[u.cliente_id] = (cantidad[u.cliente_id] || 0) + 1;
    if (!clienteSel && clientes[0]) clienteSel = clientes[0].id;
    const c = clientes.find(x => x.id === clienteSel);
    const unidades = c ? await Api.select('unidades', { select: 'id,dominio,interno,chasis,tipo,marca_id,modelo_id,marca:marcas(nombre),modelo:modelos(nombre)',
                                                       cliente_id: 'eq.' + c.id, order: 'dominio' }) : [];
    main.innerHTML = `
      <div class="encabezado"><div><h1>Clientes y unidades</h1></div>
        <div class="acciones"><button class="btn btn-primario" data-accion="nuevo-cliente">Nuevo cliente</button></div></div>
      <div class="dos-col">
        <div class="secundaria"><div class="tabla-caja"><table><thead><tr><th>Cliente</th><th class="num">Unidades</th></tr></thead><tbody>
          ${clientes.map(x => `<tr class="clic ${x.id === clienteSel ? 'bien' : ''}" data-cliente="${x.id}"><td><b>${esc(x.nombre)}</b></td>
            <td class="num">${cantidad[x.id] || 0}</td></tr>`).join('') || '<tr><td colspan="2" class="vacio">Sin clientes.</td></tr>'}
        </tbody></table></div></div>
        <div class="principal">${c ? `
          <section class="tarjeta">
            <div class="encabezado" style="margin-bottom:8px"><h2>${esc(c.nombre)}</h2>
              <div class="acciones"><button class="btn btn-chico" data-accion="editar-cliente">Editar</button></div></div>
            <div class="datos">
              <div class="dato"><div class="et">CUIT</div><div class="va">${esc(c.cuit || '—')}</div></div>
              <div class="dato"><div class="et">Teléfono</div><div class="va">${esc(c.telefono || '—')}</div></div>
              <div class="dato"><div class="et">Email</div><div class="va">${esc(c.email || '—')}</div></div>
              <div class="dato"><div class="et">Contacto</div><div class="va">${esc(c.contacto || '—')}</div></div>
              <div class="dato"><div class="et">Dirección</div><div class="va">${esc(c.direccion || '—')}</div></div>
            </div>
          </section>
          <div class="encabezado" style="margin-bottom:10px"><h2>Unidades (${unidades.length})</h2>
            <button class="btn" data-accion="nueva-unidad">Nueva unidad</button></div>
          <div class="tabla-caja"><table><thead><tr><th>Dominio</th><th>INT</th><th>Chasis</th><th>Marca y modelo</th><th>Tipo</th><th></th></tr></thead><tbody>
            ${unidades.map((u, i) => `<tr><td><b>${esc(u.dominio)}</b></td><td>${esc(u.interno || '')}</td><td>${esc(u.chasis || '')}</td>
              <td>${esc([u.marca && u.marca.nombre, u.modelo && u.modelo.nombre].filter(Boolean).join(' ') || '—')}</td><td>${esc(u.tipo || '—')}</td>
              <td><button class="btn-texto" data-editar-unidad="${i}">Editar</button></td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Sin unidades cargadas.</td></tr>'}
          </tbody></table></div>` : '<div class="tarjeta vacio">Elegí un cliente.</div>'}
        </div>
      </div>`;
    on(main, 'click', '[data-cliente]', (ev, tr) => { clienteSel = Number(tr.dataset.cliente); navegar(); });
    on(main, 'click', '[data-accion=nuevo-cliente]', async () => { const n = await formCliente(null); if (n) { clienteSel = n.id; navegar(); } });
    on(main, 'click', '[data-accion=editar-cliente]', async () => { if (await formCliente(c)) navegar(); });
    on(main, 'click', '[data-accion=nueva-unidad]', async () => { if (await formUnidad(null, c.id)) navegar(); });
    on(main, 'click', '[data-editar-unidad]', async (ev, b) => { if (await formUnidad(unidades[Number(b.dataset.editarUnidad)])) navegar(); });
  }, ['OFICINA', 'ADMINISTRADOR']);
})();
