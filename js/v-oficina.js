// MDE · Taller — pantallas de oficina: órdenes de trabajo, solicitudes e impresión.
(() => {
  const { st, cfg, esc, num, parseNum, nroOT, fecha, fechaHora, hoyISO, horaActual, esAdmin, esOficina,
          chipEstadoOT, chipEstadoTarea, errMsg, toast, modal, confirmar, ICONOS, ESTADOS_OT, TIPOS,
          textoMotivo, pausaAbierta, chipPausa, autocompletarRepuesto, autocompletarUnidad, unidadExacta,
          decidirFaltante, pedirADeposito, esFaltaDeStock, esTareaButaca, resumenButacas, ruta, ir, on, navegar } = App;

  const cacheTempario = {};
  async function tempario(tipo) {
    if (!cacheTempario[tipo]) {
      cacheTempario[tipo] = await Api.select('tempario', {
        select: 'id,tarea,horas,categoria:categorias_tempario(nombre)', tipo: 'eq.' + tipo, activo: 'is.true', order: 'tarea' });
    }
    return cacheTempario[tipo];
  }
  const claveTarea = x => `${x.tarea} · ${x.categoria ? x.categoria.nombre : ''}`;
  const buscarEnTempario = (lista, texto) => lista.find(y => claveTarea(y) === texto)
    || lista.filter(y => y.tarea.toUpperCase() === texto.toUpperCase()).find((y, i, arr) => arr.length === 1);
  async function mecanicos() {
    const filas = await Api.select('usuario_roles', { select: 'usuario_id,usuario:usuarios(nombre,activo)', rol: 'eq.MECANICO' });
    return filas.filter(f => f.usuario && f.usuario.activo).map(f => ({ id: f.usuario_id, nombre: f.usuario.nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }
  const hora = d => d ? new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

  // Pide horas para una tarea escrita a mano.
  async function pedirTareaAMano(texto) {
    const v = await modal({ titulo: 'Tarea escrita a mano', textoOk: 'Agregar',
      html: '<p class="nota">No está en el tempario de este tipo de unidad. Se agrega con las horas que indiques (por unidad).</p>',
      campos: [{ id: 'desc', label: 'Tarea', valor: texto, obligatorio: true },
               { id: 'horas', label: 'Horas por unidad', valor: '', inputmode: 'decimal', obligatorio: true }] });
    if (!v) return null;
    const h = parseNum(v.horas);
    if (!(h >= 0)) { toast('Las horas no son válidas', 'error'); return null; }
    return { descripcion: v.desc.trim(), horas: h };
  }

  // ---------------- Lista de OT ----------------
  let filtroEstado = 'activas', filtroTexto = '';
  ruta(/^#\/ots$/, async main => {
    const params = { select: 'id,numero,estado,fecha_ingreso,tipo,km,unidad:unidades(dominio,interno),cliente:clientes(nombre),tareas:tareas_ot(estado),pausas:pausas_ot(motivo,fin)',
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
          <td>${esc(o.tipo)}</td><td>${chipEstadoOT(o.estado)} ${chipPausa(pausaAbierta(o))}</td><td>${hechas}/${tot}</td></tr>`;
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
    const s = { unidad: null, tipo: '', tareas: [], repuestos: [], pedidos: [] };

    main.innerHTML = `
      <div class="encabezado"><div><h1>Nueva orden de trabajo</h1><div class="sub">Fecha de ingreso: hoy (${fecha(hoyISO())}). El número se asigna solo al guardar.</div></div></div>
      <div class="dos-col">
        <div class="principal">
          <section class="tarjeta"><h2>Vehículo</h2>
            <div class="fila-campos">
              <div class="campo"><label for="n-unidad" class="obligatorio">Dominio</label><input id="n-unidad" placeholder="Escribí dominio, INT o chasis"></div>
              <div class="campo"><label for="n-cliente">Cliente</label><select id="n-cliente">
                <option value="">Todos los clientes</option>${clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}</select></div>
            </div>
            <div id="n-datos-unidad" class="datos" style="margin-bottom:12px"></div>
            <div class="nota" style="margin-bottom:12px">Al elegir la unidad se completa el cliente. Si elegís primero el cliente, el buscador muestra solo sus unidades. ¿La unidad no está? Cargala en <a href="#/clientes">Clientes y unidades</a>.</div>
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
            <form id="f-tarea" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
              <input id="n-buscar-tarea" list="dl-tareas" placeholder="Elegí primero el tipo de unidad" autocomplete="off" disabled style="flex:3 1 260px">
              <datalist id="dl-tareas"></datalist>
              <input id="n-tarea-cant" value="1" inputmode="decimal" aria-label="Cantidad" title="Cantidad" style="flex:0 0 80px;text-align:center">
              <button class="btn" type="submit">Agregar</button></form>
            <div class="nota" style="margin-bottom:10px">Buscá por nombre en el tempario. Si no está, se agrega como tarea a mano. La cantidad multiplica las horas (ej. 2 lados).</div>
            <div class="tabla-caja"><table><thead><tr><th>#</th><th>Tarea</th><th class="num">Cant.</th><th class="num">Hs c/u</th><th class="num">Hs total</th><th></th></tr></thead><tbody id="n-tareas"></tbody></table></div>
          </section>
          <section class="tarjeta"><h2>Repuestos <span class="nota">(opcional; los mecánicos también los cargan)</span></h2>
            <form id="f-rep" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
              <input id="n-rep-cod" placeholder="Código o descripción" style="flex:2 1 220px">
              <input id="n-rep-cant" placeholder="Cantidad" inputmode="decimal" style="flex:0 1 110px" autocomplete="off">
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
            <div class="nota" style="margin-top:8px">Obligatorio: dominio, tipo, KM y al menos un trabajo o repuesto.</div>
          </section>
        </div>
      </div>`;

    const $ = id => document.getElementById(id);
    const pintarResumen = () => {
      const horas = s.tareas.reduce((a, t) => a + Number(t.horas || 0) * Number(t.cantidad || 1), 0);
      $('n-resumen').innerHTML = `
        <div class="dato"><div class="et">Trabajos</div><div class="va">${s.tareas.length}</div></div>
        <div class="dato"><div class="et">Total horas</div><div class="va">${num(horas)} h</div></div>
        <div class="dato"><div class="et">Repuestos</div><div class="va">${s.repuestos.length}</div></div>
        ${s.pedidos.length ? `<div class="dato"><div class="et">A pedir a Depósito</div><div class="va">${s.pedidos.length}</div></div>` : ''}`;
    };
    const pintarTareas = () => {
      $('n-tareas').innerHTML = s.tareas.length ? s.tareas.map((t, i) => `<tr><td>${i + 1}</td>
        <td>${esc(t.descripcion)}${t.categoria ? `<div class="nota">${esc(t.categoria)}</div>` : '<div class="nota">A mano</div>'}</td>
        <td class="num"><input class="cant-input" data-cant-t="${i}" value="${String(t.cantidad).replace('.', ',')}" inputmode="decimal" aria-label="Cantidad de ${esc(t.descripcion)}"></td>
        <td class="num">${num(t.horas)}</td><td class="num" data-total-t="${i}">${num(t.horas * t.cantidad)}</td>
        <td><button class="btn-texto" data-quitar-t="${i}">Quitar</button></td></tr>`).join('')
        : '<tr><td colspan="6" class="vacio">Sin trabajos todavía.</td></tr>';
      pintarResumen();
    };
    const pintarReps = () => {
      $('n-reps').innerHTML = s.repuestos.length || s.pedidos.length ? s.repuestos.map((r, i) => `<tr><td>${esc(r.codigo)}</td><td>${esc(r.descripcion)}</td>
        <td class="num">${num(r.cantidad)}</td><td class="num">${num(r.disponible)}</td><td><button class="btn-texto" data-quitar-r="${i}">Quitar</button></td></tr>`).join('')
        + s.pedidos.map((r, i) => `<tr><td>${esc(r.codigo)}</td><td>${esc(r.descripcion)}<div><span class="chip ambar">A pedir a Depósito</span>${r.nota ? ` <span class="nota">${esc(r.nota)}</span>` : ''}</div></td>
        <td class="num">${num(r.cantidad)}</td><td class="num">—</td><td><button class="btn-texto" data-quitar-p="${i}">Quitar</button></td></tr>`).join('')
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

    const elegirUnidad = async u => {
      s.unidad = u;
      $('n-unidad').value = u ? u.dominio : '';
      if (u) $('n-cliente').value = String(u.cliente_id);
      $('n-datos-unidad').innerHTML = u ? `
        <div class="dato"><div class="et">Cliente</div><div class="va">${esc(u.cliente ? u.cliente.nombre : '—')}</div></div>
        <div class="dato"><div class="et">INT</div><div class="va">${esc(u.interno || '—')}</div></div>
        <div class="dato"><div class="et">Chasis</div><div class="va">${esc(u.chasis || '—')}</div></div>
        <div class="dato"><div class="et">Marca y modelo</div><div class="va">${esc([u.marca && u.marca.nombre, u.modelo && u.modelo.nombre].filter(Boolean).join(' ') || '—')}</div></div>` : '';
      if (u && u.tipo && !s.tareas.some(t => t.tempario_id)) { $('n-tipo').value = u.tipo; s.tipo = u.tipo; await cargarTempario(); }
    };
    const bUnidad = autocompletarUnidad($('n-unidad'), {
      clienteId: () => $('n-cliente').value,
      alElegir: u => { elegirUnidad(u); $('n-km').focus(); },
      alEscribir: () => { if (s.unidad) { s.unidad = null; $('n-datos-unidad').innerHTML = ''; } }
    });
    $('n-cliente').addEventListener('change', ev => {
      bUnidad.olvidar();
      if (s.unidad && String(s.unidad.cliente_id) !== ev.target.value) { elegirUnidad(null); }
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
      const cant = parseNum($('n-tarea-cant').value);
      if (!texto) return;
      if (!(cant > 0)) return toast('La cantidad tiene que ser mayor a cero', 'error');
      const x = buscarEnTempario(await tempario(s.tipo), texto);
      if (x) s.tareas.push({ tempario_id: x.id, descripcion: x.tarea, horas: Number(x.horas), cantidad: cant, categoria: x.categoria ? x.categoria.nombre : '' });
      else { const m = await pedirTareaAMano(texto); if (!m) return; s.tareas.push(Object.assign(m, { cantidad: cant })); }
      $('n-buscar-tarea').value = ''; $('n-tarea-cant').value = '1'; pintarTareas(); $('n-buscar-tarea').focus();
    });
    on(main, 'input', '[data-cant-t]', (ev, inp) => {
      const i = Number(inp.dataset.cantT), c = parseNum(inp.value);
      if (c > 0) { s.tareas[i].cantidad = c; main.querySelector(`[data-total-t="${i}"]`).textContent = num(s.tareas[i].horas * c); pintarResumen(); }
    });
    let repElegido = null;
    autocompletarRepuesto($('n-rep-cod'), { alElegir: r => { repElegido = r; $('n-rep-cant').focus(); },
                                           alEscribir: () => { repElegido = null; } });
    $('f-rep').addEventListener('submit', async ev => {
      ev.preventDefault();
      const cod = $('n-rep-cod').value.trim(), cant = parseNum($('n-rep-cant').value);
      if (!cod) return;
      if (!(cant > 0)) return toast('Indicá una cantidad mayor a cero', 'error');
      try {
        const r = repElegido || (await Api.rpc('consultar_stock', { p_codigo: cod }))[0];
        if (!r) return toast('No existe un repuesto con ese código: elegilo de la lista', 'error');
        const yaPedido = s.repuestos.filter(x => x.codigo === r.codigo).reduce((a, x) => a + x.cantidad, 0);
        const libre = Number(r.disponible) - yaPedido;
        if (cant > libre) {
          // No alcanza: se carga lo que hay (si quiere) y el resto se le pide a Depósito al guardar.
          const d = await decidirFaltante({ descripcion: r.descripcion, codigo: r.codigo, cantidad: cant, disponible: libre, alGuardar: true });
          if (!d) return;
          if (d.cargar > 0) s.repuestos.push({ codigo: r.codigo, descripcion: r.descripcion, cantidad: d.cargar, disponible: Number(r.disponible) });
          s.pedidos.push({ codigo: r.codigo, descripcion: r.descripcion, cantidad: d.pedir, nota: d.nota });
        } else {
          s.repuestos.push({ codigo: r.codigo, descripcion: r.descripcion, cantidad: cant, disponible: Number(r.disponible) });
        }
        repElegido = null; $('n-rep-cod').value = ''; $('n-rep-cant').value = ''; pintarReps(); $('n-rep-cod').focus();
      } catch (e) { toast(errMsg(e), 'error'); }
    });
    on(main, 'click', '[data-quitar-t]', (ev, b) => { s.tareas.splice(Number(b.dataset.quitarT), 1); pintarTareas(); });
    on(main, 'click', '[data-quitar-r]', (ev, b) => { s.repuestos.splice(Number(b.dataset.quitarR), 1); pintarReps(); });
    on(main, 'click', '[data-quitar-p]', (ev, b) => { s.pedidos.splice(Number(b.dataset.quitarP), 1); pintarReps(); });
    $('n-guardar').addEventListener('click', async ev => {
      const err = $('n-error');
      const falta = [];
      if (!s.unidad && $('n-unidad').value.trim()) {
        const u = await unidadExacta($('n-unidad').value, $('n-cliente').value).catch(() => null);
        if (u) await elegirUnidad(u);
      }
      if (!s.unidad) falta.push('dominio (elegilo de la lista)');
      if (!$('n-tipo').value) falta.push('tipo de unidad');
      const km = parseInt(String($('n-km').value).replace(/\D/g, ''), 10);
      if (isNaN(km)) falta.push('KM');
      if (!s.tareas.length && !s.repuestos.length) falta.push('al menos un trabajo o repuesto cargado');
      if (falta.length) { err.textContent = 'Falta: ' + falta.join(', ') + '.'; err.classList.remove('oculto'); return; }
      err.classList.add('oculto');
      ev.target.disabled = true; ev.target.textContent = 'Guardando…';
      try {
        const id = await Api.rpc('crear_ot', {
          p_unidad_id: s.unidad.id, p_km: km, p_tipo: $('n-tipo').value,
          p_tareas: s.tareas.map(t => t.tempario_id ? { tempario_id: t.tempario_id, cantidad: t.cantidad }
                                                    : { descripcion: t.descripcion, horas: t.horas, cantidad: t.cantidad }),
          p_repuestos: s.repuestos.map(r => ({ codigo: r.codigo, cantidad: r.cantidad })),
          p_observaciones: $('n-obs').value.trim() || null, p_presupuesto: $('n-presupuesto').value.trim() || null,
          p_ot_cliente: $('n-otcliente').value.trim() || null, p_hora_ingreso: $('n-hora').value || null
        });
        let fallos = 0;
        for (const p of s.pedidos) {
          try { await pedirADeposito(id, p.codigo, p.cantidad, null, p.nota); } catch (e2) { fallos++; }
        }
        if (fallos) toast(`OT guardada, pero ${fallos} pedido${fallos === 1 ? '' : 's'} a Depósito no se pudo enviar: pedilo desde la OT.`, 'error');
        else toast(s.pedidos.length ? `OT guardada. Se pidieron ${s.pedidos.length} repuesto${s.pedidos.length === 1 ? '' : 's'} a Depósito.` : 'OT guardada');
        ir('#/ot/' + id);
      } catch (e) {
        err.textContent = errMsg(e); err.classList.remove('oculto');
        ev.target.disabled = false; ev.target.textContent = 'Guardar OT';
      }
    });
  }, ['OFICINA', 'ADMINISTRADOR']);

  // ---------------- Solicitudes de tareas: aprobar y rechazar ----------------
  async function aprobar(sol, listaMecanicos) {
    const opciones = [['', 'Sin asignar por ahora']].concat(listaMecanicos.map(m => [m.id, m.nombre]));
    const campos = [{ id: 'mec', label: 'Asignar a', tipo: 'select', opciones, valor: sol.mecanico ? sol.mecanico.id : '' }];
    if (!sol.tempario_id) campos.push({ id: 'horas', label: 'Horas por unidad (la tarea no está en el tempario)', inputmode: 'decimal', obligatorio: true });
    const v = await modal({ titulo: 'Aprobar solicitud', textoOk: 'Aprobar',
      html: `<p><b>${esc(sol.tarea_propuesta)}</b>${Number(sol.cantidad) !== 1 ? ' × ' + num(sol.cantidad) : ''}</p><p class="nota">Falla: ${esc(sol.falla)}</p>`, campos });
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
  const selSolicitud = 'id,falla,tarea_propuesta,cantidad,tempario_id,estado,motivo_rechazo,creado_en,resuelta_en,' +
                       'ot:ordenes_trabajo(id,numero,unidad:unidades(dominio)),mecanico:usuarios!solicitudes_mecanico_id_fkey(id,nombre)';
  const selSolicitudOT = 'id,unidad_texto,km,tipo,tareas,repuestos,observaciones,estado,motivo_rechazo,creado_en,resuelta_en,' +
                         'unidad:unidades(id,dominio,interno,cliente:clientes(nombre)),ot:ordenes_trabajo(id,numero),' +
                         'mecanico:usuarios!solicitudes_de_ot_mecanico_id_fkey(id,nombre)';

  // Pedido de un mecánico para hacer una tarea sin asignar: aprobar (queda asignada) o rechazar con motivo.
  async function resolverPedidoTarea(id, aprobar, quien, que) {
    let motivo = null;
    if (!aprobar) {
      const v = await modal({ titulo: 'Rechazar pedido de tarea', textoOk: 'Rechazar', peligro: true,
        html: `<p><b>${esc(quien)}</b> pidió hacer "${esc(que)}".</p>`,
        campos: [{ id: 'motivo', label: 'Motivo (le llega al mecánico)', tipo: 'textarea', obligatorio: true }] });
      if (!v) return false;
      motivo = v.motivo.trim();
    }
    try {
      await Api.rpc('resolver_pedido_tarea', { p_id: Number(id), p_aprobar: aprobar, p_motivo: motivo });
      toast(aprobar ? `Tarea asignada a ${quien}` : 'Pedido rechazado');
      return true;
    } catch (e) { toast(errMsg(e), 'error'); return false; }
  }
  const selPedidoTarea = 'id,descripcion,ot_id,ot_numero,dominio,creado_en,mecanico:usuarios!pedidos_tarea_mecanico_id_fkey(nombre)';

  ruta(/^#\/solicitudes$/, async main => {
    const [pend, resueltas, mecs, pedidosOT, pedTareas] = await Promise.all([
      Api.select('solicitudes', { select: selSolicitud, estado: 'eq.PENDIENTE', order: 'creado_en' }),
      Api.select('solicitudes', { select: selSolicitud, estado: 'neq.PENDIENTE', order: 'resuelta_en.desc', limit: 30 }),
      mecanicos(),
      esAdmin() ? Api.select('solicitudes_de_ot', { select: selSolicitudOT, order: 'creado_en.desc', limit: 30 }) : Promise.resolve([]),
      Api.select('pedidos_tarea', { select: selPedidoTarea, estado: 'eq.PENDIENTE', order: 'creado_en' })
    ]);
    const otPend = pedidosOT.filter(s => s.estado === 'PENDIENTE');
    const otResueltas = pedidosOT.filter(s => s.estado !== 'PENDIENTE').slice(0, 10);
    main.innerHTML = `
      <div class="encabezado"><div><h1>Solicitudes</h1>
        <div class="sub">${esAdmin() ? `${otPend.length} pedidos de OT, ` : ''}${pedTareas.length} pedidos de tarea y ${pend.length} tareas nuevas pendientes</div></div></div>
      <h2 style="margin:0 0 10px">Mecánicos que piden una tarea</h2>
      <div class="lista-tareas" style="margin-bottom:20px">${pedTareas.length ? pedTareas.map(p => `
        <div class="tarea-card">
          <div class="linea1"><span><a href="#/ot/${p.ot_id}">${esc(nroOT(p.ot_numero))}</a> · ${esc(p.dominio || '')} · ${fechaHora(p.creado_en)}</span><span class="chip ambar">Para revisar</span></div>
          <div class="titulo">${esc(p.descripcion)}</div>
          <div class="linea3">La pide <b>${esc(p.mecanico ? p.mecanico.nombre : '')}</b>. Si la aprobás, queda asignada a él.</div>
          <div class="acciones" style="margin-top:6px"><button class="btn btn-verde" data-asignar-pt="${p.id}">Aprobar y asignar</button>
            <button class="btn btn-peligro" data-rechazar-pt="${p.id}">Rechazar</button></div>
        </div>`).join('') : '<div class="tarjeta vacio">No hay pedidos de tareas.</div>'}</div>
      ${esAdmin() ? `<h2 style="margin:0 0 10px">Pedidos de OT nueva</h2>
        <div class="lista-tareas" style="margin-bottom:20px">${otPend.length ? otPend.map(s => `
          <a class="tarea-card" href="#/solicitud-ot/${s.id}">
            <div class="linea1"><span>${esc(s.mecanico ? s.mecanico.nombre : '')} · ${fechaHora(s.creado_en)}</span><span class="chip ambar">Para revisar</span></div>
            <div class="titulo">${esc(s.unidad ? s.unidad.dominio + ' · ' + (s.unidad.cliente ? s.unidad.cliente.nombre : '') : s.unidad_texto)}</div>
            <div class="linea3">${esc(s.tipo)} · KM ${num(s.km, 0)} · ${s.tareas.length} trabajos · ${s.repuestos.length} repuestos</div>
          </a>`).join('') : '<div class="tarjeta vacio">No hay pedidos de OT para revisar.</div>'}</div>` : ''}
      <h2 style="margin:0 0 10px">Tareas pedidas en OT abiertas</h2>
      <div class="lista-tareas">${pend.length ? pend.map((s, i) => `
        <div class="tarea-card">
          <div class="linea1"><span><a href="#/ot/${s.ot.id}">${esc(nroOT(s.ot.numero))}</a> · ${esc(s.ot.unidad ? s.ot.unidad.dominio : '')} · ${esc(s.mecanico ? s.mecanico.nombre : '')} · ${fechaHora(s.creado_en)}</span></div>
          <div class="titulo">${esc(s.tarea_propuesta)}${Number(s.cantidad) !== 1 ? ' × ' + num(s.cantidad) : ''}</div>
          <div class="linea3">Falla: ${esc(s.falla)}</div>
          <div class="acciones" style="margin-top:6px"><button class="btn btn-verde" data-aprobar="${i}">Aprobar</button>
            <button class="btn btn-peligro" data-rechazar="${i}">Rechazar</button></div>
        </div>`).join('') : '<div class="tarjeta vacio">No hay tareas pendientes.</div>'}</div>
      <h2 style="margin:24px 0 10px">Resueltas recientemente</h2>
      <div class="tabla-caja"><table><thead><tr><th>Qué</th><th>Mecánico</th><th>Detalle</th><th>Resultado</th></tr></thead><tbody>
        ${otResueltas.map(s => `<tr><td>Pedido de OT</td><td>${esc(s.mecanico ? s.mecanico.nombre : '')}</td>
          <td>${esc(s.unidad ? s.unidad.dominio : s.unidad_texto)}</td><td>${s.estado === 'APROBADA'
            ? `<span class="chip verde">Aceptada</span> ${s.ot ? `<a href="#/ot/${s.ot.id}">${esc(nroOT(s.ot.numero))}</a>` : ''}`
            : `<span class="chip rojo">Rechazada</span> <span class="nota">${esc(s.motivo_rechazo)}</span>`}</td></tr>`).join('')}
        ${resueltas.map(s => `<tr><td>Tarea en ${esc(nroOT(s.ot.numero))}</td><td>${esc(s.mecanico ? s.mecanico.nombre : '')}</td>
          <td>${esc(s.tarea_propuesta)}</td><td>${s.estado === 'APROBADA' ? '<span class="chip verde">Aprobada</span>' :
          `<span class="chip rojo">Rechazada</span> <span class="nota">${esc(s.motivo_rechazo)}</span>`}</td></tr>`).join('')}
        ${!resueltas.length && !otResueltas.length ? '<tr><td colspan="4" class="vacio">Sin solicitudes resueltas.</td></tr>' : ''}</tbody></table></div>`;
    on(main, 'click', '[data-aprobar]', async (ev, b) => { if (await aprobar(pend[Number(b.dataset.aprobar)], mecs)) navegar(); });
    on(main, 'click', '[data-rechazar]', async (ev, b) => { if (await rechazar(pend[Number(b.dataset.rechazar)])) navegar(); });
    const pt = id => pedTareas.find(x => String(x.id) === id) || {};
    on(main, 'click', '[data-asignar-pt]', async (ev, b) => {
      const p = pt(b.dataset.asignarPt);
      if (await resolverPedidoTarea(p.id, true, p.mecanico ? p.mecanico.nombre : '', p.descripcion)) navegar();
    });
    on(main, 'click', '[data-rechazar-pt]', async (ev, b) => {
      const p = pt(b.dataset.rechazarPt);
      if (await resolverPedidoTarea(p.id, false, p.mecanico ? p.mecanico.nombre : '', p.descripcion)) navegar();
    });
  }, ['OFICINA', 'ADMINISTRADOR']);

  // ---------------- Revisar un pedido de OT del mecánico (Administrador) ----------------
  ruta(/^#\/solicitud-ot\/(\d+)$/, async (main, id) => {
    const filas = await Api.select('solicitudes_de_ot', { select: selSolicitudOT, id: 'eq.' + id });
    const s = filas[0];
    if (!s) { main.innerHTML = '<div class="tarjeta">No se encontró el pedido.</div>'; return; }
    const pendiente = s.estado === 'PENDIENTE';
    const [stock] = await Promise.all([
      s.repuestos.length ? Api.select('stock_disponible', { select: 'codigo,disponible',
        codigo: 'in.(' + s.repuestos.map(r => '"' + String(r.codigo).replace(/"/g, '') + '"').join(',') + ')' }) : Promise.resolve([])
    ]);
    const disp = new Map(stock.map(x => [x.codigo, Number(x.disponible)]));
    const temp = pendiente ? await tempario(s.tipo) : [];
    const horasTemp = new Map(temp.map(x => [x.id, Number(x.horas)]));
    const dis = pendiente ? '' : 'disabled';

    main.innerHTML = `
      <a class="volver" href="#/solicitudes">${ICONOS.atras} Solicitudes</a>
      <div class="encabezado"><div><h1>Pedido de OT</h1>
        <div class="sub">De ${esc(s.mecanico ? s.mecanico.nombre : '')} · ${fechaHora(s.creado_en)} · las tareas quedan sin asignar al aceptarla</div></div>
        <div class="acciones">${pendiente ? '<span class="chip ambar">Para revisar</span>' : s.estado === 'APROBADA'
          ? `<span class="chip verde">Aceptada</span> ${s.ot ? `<a class="btn" href="#/ot/${s.ot.id}">Ver ${esc(nroOT(s.ot.numero))}</a>` : ''}`
          : `<span class="chip rojo">Rechazada</span>`}</div></div>
      ${s.estado === 'RECHAZADA' ? `<div class="error-box">Motivo: ${esc(s.motivo_rechazo)}</div>` : ''}
      <section class="tarjeta"><h2>Vehículo</h2>
        ${s.unidad ? `<div class="datos" style="margin-bottom:12px">
            <div class="dato"><div class="et">Cliente</div><div class="va">${esc(s.unidad.cliente ? s.unidad.cliente.nombre : '')}</div></div>
            <div class="dato"><div class="et">Dominio</div><div class="va">${esc(s.unidad.dominio)}</div></div>
            <div class="dato"><div class="et">INT</div><div class="va">${esc(s.unidad.interno || '—')}</div></div></div>`
          : `<div class="aviso-box">El mecánico escribió: <b>${esc(s.unidad_texto)}</b>. Elegí la unidad${pendiente ? '; si no está, cargala primero en <a href="#/clientes">Clientes y unidades</a>' : ''}.</div>
            ${pendiente ? `<div class="campo"><label for="r-unidad" class="obligatorio">Unidad</label>
              <input id="r-unidad" placeholder="Escribí dominio, INT o chasis"></div>
              <div id="r-datos-unidad" class="datos" style="margin-bottom:12px"></div>` : ''}`}
        <div class="fila-campos">
          <div class="campo"><label for="r-tipo">Tipo de unidad</label><select id="r-tipo" ${dis}>${TIPOS.map(t => `<option ${t === s.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="campo"><label for="r-km">KM</label><input id="r-km" inputmode="numeric" value="${esc(s.km)}" ${dis}></div>
        </div>
        <div class="campo"><label for="r-obs">Observaciones</label><textarea id="r-obs" ${dis}>${esc(s.observaciones || '')}</textarea></div>
      </section>
      <section class="tarjeta"><h2>Trabajos</h2>
        <div class="tabla-caja"><table><thead><tr><th>Incluir</th><th>Tarea</th><th class="num">Cant.</th><th class="num">Hs c/u</th></tr></thead><tbody>
          ${s.tareas.map((t, i) => `<tr><td><label class="check"><input type="checkbox" data-inc-t="${i}" checked ${dis} aria-label="Incluir ${esc(t.descripcion)}"></label></td>
            <td>${esc(t.descripcion)}<div class="nota">${t.tempario_id ? esc(t.categoria || 'Tempario') : 'A mano: poné las horas'}</div></td>
            <td class="num"><input class="cant-input" data-cant-t="${i}" value="${String(t.cantidad || 1).replace('.', ',')}" inputmode="decimal" ${dis} aria-label="Cantidad"></td>
            <td class="num"><input class="cant-input" data-horas-t="${i}" value="${t.tempario_id ? String(horasTemp.get(t.tempario_id) ?? t.horas ?? '').replace('.', ',') : (t.horas != null ? String(t.horas).replace('.', ',') : '')}"
              inputmode="decimal" ${dis} aria-label="Horas por unidad" placeholder="0"></td></tr>`).join('') || '<tr><td colspan="4" class="vacio">Sin trabajos.</td></tr>'}
        </tbody></table></div>
      </section>
      <section class="tarjeta"><h2>Repuestos</h2>
        <div class="tabla-caja"><table><thead><tr><th>Incluir</th><th>Código</th><th>Repuesto</th><th class="num">Cant.</th><th class="num">Stock hoy</th></tr></thead><tbody>
          ${s.repuestos.map((r, i) => `<tr><td><label class="check"><input type="checkbox" data-inc-r="${i}" checked ${dis} aria-label="Incluir ${esc(r.descripcion)}"></label></td>
            <td>${esc(r.codigo)}</td><td>${esc(r.descripcion)}</td>
            <td class="num"><input class="cant-input" data-cant-r="${i}" value="${String(r.cantidad).replace('.', ',')}" inputmode="decimal" ${dis} aria-label="Cantidad"></td>
            <td class="num" style="color:${(disp.get(r.codigo) || 0) >= Number(r.cantidad) ? 'var(--verde)' : 'var(--rojo)'};font-weight:600">${num(disp.get(r.codigo) || 0)}</td></tr>`).join('')
            || '<tr><td colspan="5" class="vacio">Sin repuestos.</td></tr>'}
        </tbody></table></div>
        ${pendiente && s.repuestos.length ? '<div class="nota" style="margin-top:6px">Al aceptar se descuenta el stock. Lo que no alcance se carga hasta donde haya y el resto se le pide a Depósito.</div>' : ''}
      </section>
      <div class="error-box oculto" id="r-error"></div>
      ${pendiente ? `<div class="acciones" style="justify-content:flex-end;margin-bottom:24px">
        <button class="btn btn-peligro" data-accion="rechazar">Rechazar</button>
        <button class="btn btn-verde" data-accion="aceptar">Aceptar y crear OT</button></div>` : ''}`;

    if (!pendiente) return;
    const err = document.getElementById('r-error');
    let unidadElegida = null;
    const mostrarUnidad = u => {
      unidadElegida = u;
      const caja = document.getElementById('r-datos-unidad');
      if (caja) caja.innerHTML = u ? `
        <div class="dato"><div class="et">Cliente</div><div class="va">${esc(u.cliente ? u.cliente.nombre : '—')}</div></div>
        <div class="dato"><div class="et">INT</div><div class="va">${esc(u.interno || '—')}</div></div>
        <div class="dato"><div class="et">Marca y modelo</div><div class="va">${esc([u.marca && u.marca.nombre, u.modelo && u.modelo.nombre].filter(Boolean).join(' ') || '—')}</div></div>` : '';
    };
    if (document.getElementById('r-unidad')) {
      autocompletarUnidad(document.getElementById('r-unidad'), {
        alElegir: u => { mostrarUnidad(u); if (u.tipo) document.getElementById('r-tipo').value = u.tipo; },
        alEscribir: () => { if (unidadElegida) mostrarUnidad(null); }
      });
    }
    const mostrar = m => { err.textContent = m; err.classList.remove('oculto'); };
    on(main, 'click', '[data-accion=rechazar]', async () => {
      const v = await modal({ titulo: 'Rechazar pedido de OT', textoOk: 'Rechazar', peligro: true,
        campos: [{ id: 'motivo', label: 'Motivo (le llega al mecánico)', tipo: 'textarea', obligatorio: true }] });
      if (!v) return;
      try { await Api.rpc('rechazar_solicitud_ot', { p_id: s.id, p_motivo: v.motivo.trim() }); toast('Pedido rechazado'); ir('#/solicitudes'); }
      catch (e) { toast(errMsg(e), 'error'); }
    });
    on(main, 'click', '[data-accion=aceptar]', async (ev, b) => {
      err.classList.add('oculto');
      const unidadInp = document.getElementById('r-unidad');
      if (unidadInp && !unidadElegida && unidadInp.value.trim()) {
        const u = await unidadExacta(unidadInp.value).catch(() => null);
        if (u) mostrarUnidad(u);
      }
      if (unidadInp && !unidadElegida) return mostrar('Elegí la unidad de la lista.');
      const km = parseInt(String(document.getElementById('r-km').value).replace(/\D/g, ''), 10);
      if (isNaN(km)) return mostrar('El KM no es válido.');
      const tareas = [];
      for (const [i, t] of s.tareas.entries()) {
        if (!main.querySelector(`[data-inc-t="${i}"]`).checked) continue;
        const cant = parseNum(main.querySelector(`[data-cant-t="${i}"]`).value);
        const hTxt = main.querySelector(`[data-horas-t="${i}"]`).value;
        const h = hTxt.trim() === '' ? 0 : parseNum(hTxt);
        if (!(cant > 0)) return mostrar(`Revisá la cantidad de "${t.descripcion}".`);
        if (!(h >= 0)) return mostrar(`Revisá las horas de "${t.descripcion}".`);
        tareas.push(t.tempario_id ? { tempario_id: t.tempario_id, horas: h, cantidad: cant } : { descripcion: t.descripcion, horas: h, cantidad: cant });
      }
      const repuestos = [], aPedir = [];
      const libre = new Map(disp);
      for (const [i, r] of s.repuestos.entries()) {
        if (!main.querySelector(`[data-inc-r="${i}"]`).checked) continue;
        const cant = parseNum(main.querySelector(`[data-cant-r="${i}"]`).value);
        if (!(cant > 0)) return mostrar(`Revisá la cantidad de ${r.codigo}.`);
        // Lo que hay se carga; lo que falta se le pide a Depósito.
        const hay = Math.max(0, libre.get(r.codigo) || 0);
        const carga = Math.min(cant, hay);
        if (carga > 0) { repuestos.push({ codigo: r.codigo, cantidad: carga }); libre.set(r.codigo, hay - carga); }
        if (cant > carga) aPedir.push({ codigo: r.codigo, cantidad: Math.round((cant - carga) * 100) / 100 });
      }
      if (!tareas.length && !repuestos.length && !aPedir.length) return mostrar('La OT necesita al menos un trabajo o un repuesto.');
      b.disabled = true;
      try {
        const otId = await Api.rpc('aprobar_solicitud_ot', {
          p_id: s.id, p_unidad_id: unidadInp ? unidadElegida.id : null, p_km: km,
          p_tipo: document.getElementById('r-tipo').value, p_tareas: tareas, p_repuestos: repuestos,
          p_observaciones: document.getElementById('r-obs').value.trim() || null });
        let fallos = 0;
        for (const p of aPedir) {
          try { await pedirADeposito(otId, p.codigo, p.cantidad, null, `Del pedido de OT de ${s.mecanico ? s.mecanico.nombre : 'un mecánico'}`); }
          catch (e2) { fallos++; }
        }
        toast(fallos ? `OT creada, pero ${fallos} pedido${fallos === 1 ? '' : 's'} a Depósito no se pudo enviar.`
                     : aPedir.length ? `OT creada. Se pidieron ${aPedir.length} repuesto${aPedir.length === 1 ? '' : 's'} a Depósito.` : 'OT creada. Asigná las tareas a los mecánicos.',
              fallos ? 'error' : undefined);
        ir('#/ot/' + otId);
      } catch (e) { mostrar(errMsg(e)); b.disabled = false; }
    });
  }, ['ADMINISTRADOR']);

  // ---------------- Detalle de OT ----------------
  async function cargarOT(id) {
    const [ots, tareas, reps] = await Promise.all([
      Api.select('ordenes_trabajo', { select: '*,unidad:unidades(id,dominio,interno,chasis,tipo,marca:marcas(nombre),modelo:modelos(nombre)),cliente:clientes(nombre,cuit,telefono),' +
                                              'solicitante:usuarios!ordenes_trabajo_solicitada_por_fkey(nombre),' +
                                              'pausas:pausas_ot(id,motivo,detalle,inicio,fin,pausador:usuarios!pausas_ot_pausada_por_fkey(nombre),reanudador:usuarios!pausas_ot_reanudada_por_fkey(nombre))',
                                      id: 'eq.' + id }),
      Api.select('tareas_ot', { select: 'id,renglon,descripcion,horas,cantidad,horas_total,estado,tempario(categoria:categorias_tempario(nombre)),asignaciones(mecanico_id,terminada_en,usuario:usuarios(nombre))',
                                ot_id: 'eq.' + id, order: 'renglon' }),
      Api.select('repuestos_ot', { select: 'id,codigo,cantidad,tarea_id,cargado_en,estado,entregado_en,repuesto:repuestos(descripcion),cargador:usuarios!repuestos_ot_cargado_por_fkey(nombre),entregador:usuarios!repuestos_ot_entregado_por_fkey(nombre)',
                                   ot_id: 'eq.' + id, order: 'id' })
    ]);
    const butacas = tareas.length ? await Api.select('butacas_tarea', { select: 'tarea_id,butaca,trabajos', tarea_id: 'in.(' + tareas.map(t => t.id).join(',') + ')' }) : [];
    for (const t of tareas) t.butacas = butacas.filter(b => b.tarea_id === t.id);
    return { ot: ots[0], tareas, reps };
  }

  ruta(/^#\/ot\/(\d+)$/, async (main, id) => {
    const { ot, tareas, reps } = await cargarOT(id);
    if (!ot) { main.innerHTML = '<div class="tarjeta">No se encontró la OT.</div>'; return; }
    const puede = esOficina();
    const [mecs, sols, reales, pedidos, pedTareas] = await Promise.all([
      puede ? mecanicos() : Promise.resolve([]),
      puede ? Api.select('solicitudes', { select: selSolicitud, ot_id: 'eq.' + id, estado: 'eq.PENDIENTE', order: 'creado_en' }) : Promise.resolve([]),
      esAdmin() ? Api.select('horas_reales', { select: 'tarea_id,mecanico,horas_reales,en_curso', ot_id: 'eq.' + id }) : Promise.resolve([]),
      Api.select('pedidos_repuesto', { select: 'id,descripcion,codigo,cantidad,estado,nota,detalle,creado_en,pedidor:usuarios!pedidos_repuesto_pedido_por_fkey(nombre)', ot_id: 'eq.' + id, order: 'creado_en.desc' }),
      puede ? Api.select('pedidos_tarea', { select: 'id,tarea_id,descripcion,mecanico:usuarios!pedidos_tarea_mecanico_id_fkey(nombre)', ot_id: 'eq.' + id, estado: 'eq.PENDIENTE', order: 'creado_en' }) : Promise.resolve([])
    ]);
    const u = ot.unidad || {};
    const entrega = App.tiene('DEPOSITO') || esAdmin();
    const pendientesEntrega = reps.filter(r => r.estado !== 'ENTREGADO');
    const pausa = pausaAbierta(ot);
    const pausasViejas = (ot.pausas || []).filter(p => p.fin).sort((a, b) => new Date(b.inicio) - new Date(a.inicio));
    const totalHoras = tareas.reduce((a, t) => a + Number(t.horas_total || 0), 0);
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
      ${pausa ? `<div class="pausa-banner">
        <div><div class="titulo">OT pausada · ${esc(textoMotivo(pausa.motivo))}</div>
          <div class="det">Por ${esc(pausa.pausador ? pausa.pausador.nombre : '')} el ${hora(pausa.inicio)}${pausa.detalle ? ' · ' + esc(pausa.detalle) : ''}</div></div>
        ${puede ? '<button class="btn btn-primario" data-accion="reanudar">Reanudar OT</button>' : ''}</div>` : ''}
      ${sols.length ? `<section class="tarjeta" style="border-color:var(--ambar-borde);background:var(--ambar)"><h2>Solicitudes pendientes</h2>
        ${sols.map((s, i) => `<div class="repuesto-fila"><div class="info"><div class="desc">${esc(s.tarea_propuesta)}${Number(s.cantidad) !== 1 ? ' × ' + num(s.cantidad) : ''}</div>
          <div class="cod">${esc(s.mecanico ? s.mecanico.nombre : '')} · Falla: ${esc(s.falla)}</div></div>
          <button class="btn btn-verde btn-chico" data-aprobar="${i}">Aprobar</button>
          <button class="btn btn-peligro btn-chico" data-rechazar="${i}">Rechazar</button></div>`).join('')}</section>` : ''}
      <div class="dos-col">
        <div class="principal">
          <section class="tarjeta"><h2>Trabajos y servicios</h2>
            <div class="tabla-caja"><table><thead><tr><th>#</th><th style="min-width:180px">Tarea</th><th class="num">Cant.</th><th class="num">Hs c/u</th><th class="num">Hs total</th><th>Mecánicos</th><th>Estado</th>
              ${esAdmin() ? '<th>Horas reales</th>' : ''}${puede ? '<th></th>' : ''}</tr></thead><tbody>
            ${tareas.length ? tareas.map(t => {
              const asig = t.asignaciones || [];
              const libres = mecs.filter(m => !asig.some(a => a.mecanico_id === m.id));
              return `<tr><td>${t.renglon}</td>
                <td>${esc(t.descripcion)}${t.tempario && t.tempario.categoria ? `<div class="nota">${esc(t.tempario.categoria.nombre)}</div>` : '<div class="nota">A mano</div>'}
                  ${t.butacas.length ? `<div class="nota">Butacas: ${esc(resumenButacas(t.butacas))}</div>` : ''}
                  ${puede && (t.butacas.length || esTareaButaca(t.descripcion)) && !['CERRADA', 'PRUEBA'].includes(ot.estado) ? `<a href="#/butacas/${t.id}" class="nota">${t.butacas.length ? 'Cambiar butacas' : 'Marcar butacas en el plano'}</a>` : ''}</td>
                <td class="num">${num(t.cantidad)}</td><td class="num">${num(t.horas)}</td><td class="num"><b>${num(t.horas_total)}</b></td>
                <td>${asig.map(a => `<span class="chip" style="margin:2px">${esc(a.usuario ? a.usuario.nombre : '')}${a.terminada_en ? ' ✓' : ''}${puede ? `<button class="chip-x" data-desasignar="${t.id}" data-mec="${a.mecanico_id}" aria-label="Quitar a ${esc(a.usuario ? a.usuario.nombre : '')}">×</button>` : ''}</span>`).join('')}
                  ${puede && asig.length < 2 && libres.length ? `<select data-asignar="${t.id}" aria-label="Asignar mecánico" style="width:auto;min-height:36px;margin-top:4px">
                    <option value="">${asig.length ? '+ segundo mecánico' : 'Asignar…'}</option>${libres.map(m => `<option value="${m.id}">${esc(m.nombre)}</option>`).join('')}</select>` : ''}
                  ${!asig.length && !puede ? '<span class="nota">Sin asignar</span>' : ''}
                  ${pedTareas.filter(p => p.tarea_id === t.id).map(p => `<div class="nota" style="margin-top:4px">Pide hacerla: <b>${esc(p.mecanico ? p.mecanico.nombre : '')}</b>
                    <button class="btn-texto" data-asignar-pt="${p.id}">Asignar</button> <button class="btn-texto" data-rechazar-pt="${p.id}">Rechazar</button></div>`).join('')}</td>
                <td>${chipEstadoTarea(t.estado)}</td>
                ${esAdmin() ? `<td>${(realesPorTarea[t.id] || []).map(r => `<div class="nota">${esc(r.mecanico)}: ${num(r.horas_reales)} h${r.en_curso ? ' (en curso)' : ''}</div>`).join('') || '<span class="nota">—</span>'}</td>` : ''}
                ${puede ? `<td style="white-space:nowrap"><button class="btn-texto" data-editar-tarea="${t.id}">Editar</button><button class="btn-texto" data-quitar-tarea="${t.id}">Quitar</button></td>` : ''}</tr>`;
            }).join('') : `<tr><td colspan="9" class="vacio">Sin trabajos.</td></tr>`}
            </tbody></table></div>
            <div style="margin-top:10px;font-weight:600">Total horas (tempario): ${num(totalHoras)} h</div>
            ${puede ? `<form id="f-agregar-tarea" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
              <input id="o-tarea" list="dl-o-tareas" placeholder="Agregar tarea: buscá en el tempario o escribila" autocomplete="off" style="flex:3 1 260px">
              <datalist id="dl-o-tareas">${temp.map(x => `<option value="${esc(claveTarea(x))}">${num(x.horas)} h</option>`).join('')}</datalist>
              <input id="o-tarea-cant" value="1" inputmode="decimal" aria-label="Cantidad" title="Cantidad" style="flex:0 0 80px;text-align:center">
              <button class="btn" type="submit">Agregar</button></form>` : ''}
          </section>
          <section class="tarjeta">
            <div class="encabezado" style="margin-bottom:10px"><h2>Repuestos</h2>
              ${entrega && pendientesEntrega.length ? `<button class="btn btn-verde btn-chico" data-entregar-todos>Marcar entregados (${pendientesEntrega.length})</button>` : ''}</div>
            <div class="tabla-caja"><table><thead><tr><th>Código</th><th>Repuesto</th><th class="num">Cantidad</th><th>Tarea</th><th>Cargó</th><th>Entrega</th>${puede ? '<th></th>' : ''}</tr></thead><tbody>
              ${reps.length ? reps.map(r => `<tr><td>${esc(r.codigo)}</td><td>${esc(r.repuesto ? r.repuesto.descripcion : '')}</td><td class="num">${num(r.cantidad)}</td>
                <td>${r.tarea_id ? '#' + renglonDe.get(r.tarea_id) : '—'}</td><td>${esc(r.cargador ? r.cargador.nombre : '')}<div class="nota">${fechaHora(r.cargado_en)}</div></td>
                <td>${r.estado === 'ENTREGADO'
                  ? `<span class="chip verde">Entregado</span><div class="nota">${esc(r.entregador ? r.entregador.nombre : '')} ${fechaHora(r.entregado_en)}</div>`
                  : `<span class="chip ambar">Pendiente</span>${entrega ? ` <button class="btn-texto" data-entregar="${r.id}">Entregar</button>` : ''}`}</td>
                ${puede ? `<td><button class="btn-texto" data-quitar-rep="${r.id}">Quitar</button></td>` : ''}</tr>`).join('')
                : `<tr><td colspan="7" class="vacio">Sin repuestos cargados.</td></tr>`}
            </tbody></table></div>
            ${puede ? `<form id="f-agregar-rep" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
              <input id="o-rep-cod" placeholder="Código o descripción" style="flex:2 1 220px">
              <input id="o-rep-cant" placeholder="Cantidad" inputmode="decimal" style="flex:0 1 110px" autocomplete="off">
              <button class="btn" type="submit">Agregar repuesto</button></form>` : ''}
          </section>
          ${pedidos.length || pausasViejas.length ? `<section class="tarjeta"><h2>Pausas y pedidos de repuesto</h2>
            ${pedidos.length ? `<div class="tabla-caja" style="margin-bottom:12px"><table><thead><tr><th>Repuesto pedido</th><th class="num">Cant.</th><th>Pidió</th><th>Estado</th></tr></thead><tbody>
              ${pedidos.map(p => `<tr><td>${esc(p.descripcion)}${p.codigo ? `<div class="nota">${esc(p.codigo)}</div>` : '<div class="nota">No está en la lista</div>'}${p.detalle ? `<div class="nota">Nota: ${esc(p.detalle)}</div>` : ''}</td>
                <td class="num">${num(p.cantidad)}</td><td>${esc(p.pedidor ? p.pedidor.nombre : '')}<div class="nota">${fechaHora(p.creado_en)}</div></td>
                <td>${p.estado === 'RESUELTO' ? `<span class="chip verde">Resuelto</span>${p.nota ? ` <span class="nota">${esc(p.nota)}</span>` : ''}` : '<span class="chip ambar">Pendiente</span>'}</td></tr>`).join('')}
              </tbody></table></div>` : ''}
            ${pausasViejas.map(p => `<div class="nota" style="margin-bottom:4px">• ${esc(textoMotivo(p.motivo))}${p.detalle ? ' (' + esc(p.detalle) + ')' : ''}: ${hora(p.inicio)} → ${hora(p.fin)} · pausó ${esc(p.pausador ? p.pausador.nombre : '')}, reanudó ${esc(p.reanudador ? p.reanudador.nombre : '')}</div>`).join('')}
          </section>` : ''}
        </div>
        <div class="secundaria">
          <section class="tarjeta"><h2>Datos de la OT</h2>
            <div class="datos" style="margin-bottom:14px">
              <div class="dato"><div class="et">Cliente</div><div class="va">${esc(ot.cliente ? ot.cliente.nombre : '')}</div></div>
              <div class="dato"><div class="et">Dominio</div><div class="va">${esc(u.dominio)}</div></div>
              <div class="dato"><div class="et">INT</div><div class="va">${esc(u.interno || '—')}</div></div>
              <div class="dato"><div class="et">Chasis</div><div class="va">${esc(u.chasis || '—')}</div></div>
              <div class="dato"><div class="et">Marca y modelo</div><div class="va">${esc([u.marca && u.marca.nombre, u.modelo && u.modelo.nombre].filter(Boolean).join(' ') || '—')}</div></div>
              ${puede && esAdmin() ? '' : `<div class="dato"><div class="et">Ingreso</div><div class="va">${fecha(ot.fecha_ingreso)}${ot.hora_ingreso ? ' ' + esc(ot.hora_ingreso.slice(0, 5)) : ''}</div></div>`}
              ${ot.solicitante ? `<div class="dato"><div class="et">Pedida por</div><div class="va">${esc(ot.solicitante.nombre)}</div></div>` : ''}
            </div>
            <form id="f-datos">
              ${puede && esAdmin() ? `<div class="fila-campos">
                <div class="campo"><label for="o-fing" class="obligatorio">Fecha de ingreso</label><input id="o-fing" type="date" value="${esc(ot.fecha_ingreso || '')}" max="${hoyISO()}"></div>
                <div class="campo"><label for="o-hing">Hora de ingreso</label><input id="o-hing" type="time" value="${esc((ot.hora_ingreso || '').slice(0, 5))}"></div>
              </div>` : ''}
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

    // Entrega de repuestos: Depósito o Administrador.
    const entregar = async ids => {
      try { const n = await Api.rpc('entregar_repuestos', { p_ids: ids }); toast(n === 1 ? 'Repuesto entregado' : `${n} repuestos entregados`); navegar(); }
      catch (e) { toast(errMsg(e), 'error'); }
    };
    on(main, 'click', '[data-entregar]', (ev, b) => entregar([Number(b.dataset.entregar)]));
    on(main, 'click', '[data-entregar-todos]', () => entregar(pendientesEntrega.map(r => r.id)));

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
    on(main, 'click', '[data-accion=reanudar]', async () => {
      const ok = await confirmar('¿Reanudar la OT? Los mecánicos vuelven a poder iniciar sus tareas.', { titulo: 'Reanudar OT', textoOk: 'Reanudar' });
      if (!ok) return;
      try { await Api.rpc('reanudar_ot', { p_ot_id: Number(id) }); toast('OT reanudada'); recargar(); }
      catch (e) { toast(errMsg(e), 'error'); }
    });
    document.getElementById('f-datos').addEventListener('submit', async ev => {
      ev.preventDefault();
      const km = parseInt(String(document.getElementById('o-km').value).replace(/\D/g, ''), 10);
      if (isNaN(km)) return toast('El KM no es válido', 'error');
      const v = x => document.getElementById(x).value.trim() || null;
      const cambios = { km, nro_factura: v('o-fac'), fecha_salida: v('o-fsal'), hora_salida: v('o-hsal'),
                        presupuesto: v('o-pres'), ot_cliente: v('o-otc'), observaciones: v('o-obs') };
      if (document.getElementById('o-fing')) {
        const fi = v('o-fing');
        if (!fi) return toast('La fecha de ingreso no puede quedar vacía', 'error');
        if (fi > hoyISO()) return toast('La fecha de ingreso no puede ser posterior a hoy', 'error');
        if (cambios.fecha_salida && cambios.fecha_salida < fi) return toast('La fecha de salida no puede ser anterior a la de ingreso', 'error');
        cambios.fecha_ingreso = fi; cambios.hora_ingreso = v('o-hing');
      }
      try {
        await Api.update('ordenes_trabajo', { id: 'eq.' + id }, cambios);
        toast('Datos guardados'); recargar();
      } catch (e) { toast(errMsg(e), 'error'); }
    });
    on(main, 'click', '[data-asignar-pt], [data-rechazar-pt]', async (ev, b) => {
      const aprobar = 'asignarPt' in b.dataset;
      const p = pedTareas.find(x => String(x.id) === (aprobar ? b.dataset.asignarPt : b.dataset.rechazarPt)) || {};
      if (await resolverPedidoTarea(p.id, aprobar, p.mecanico ? p.mecanico.nombre : '', p.descripcion)) recargar();
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
        { id: 'cant', label: 'Cantidad (ej. 2 si es por lado)', valor: String(t.cantidad).replace('.', ','), inputmode: 'decimal', obligatorio: true },
        { id: 'horas', label: 'Horas por unidad', valor: String(t.horas).replace('.', ','), inputmode: 'decimal', obligatorio: true }] });
      if (!v) return;
      const h = parseNum(v.horas), c = parseNum(v.cant);
      if (!(h >= 0)) return toast('Las horas no son válidas', 'error');
      if (!(c > 0)) return toast('La cantidad tiene que ser mayor a cero', 'error');
      try { await Api.update('tareas_ot', { id: 'eq.' + t.id }, { descripcion: v.desc.trim(), horas: h, cantidad: c }); toast('Tarea actualizada'); recargar(); }
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
      const cant = parseNum(document.getElementById('o-tarea-cant').value);
      if (!texto) return;
      if (!(cant > 0)) return toast('La cantidad tiene que ser mayor a cero', 'error');
      const x = buscarEnTempario(temp, texto);
      let fila;
      if (x) fila = { ot_id: Number(id), tempario_id: x.id, cantidad: cant };
      else { const m = await pedirTareaAMano(texto); if (!m) return; fila = { ot_id: Number(id), descripcion: m.descripcion, horas: m.horas, cantidad: cant }; }
      try { await Api.insert('tareas_ot', fila); toast('Tarea agregada'); recargar(); }
      catch (e) { toast(errMsg(e), 'error'); }
    });
    let repElegido = null;
    autocompletarRepuesto(document.getElementById('o-rep-cod'), {
      alElegir: r => { repElegido = r; document.getElementById('o-rep-cant').focus(); },
      alEscribir: () => { repElegido = null; } });
    document.getElementById('f-agregar-rep').addEventListener('submit', async ev => {
      ev.preventDefault();
      const cod = document.getElementById('o-rep-cod').value.trim(), cant = parseNum(document.getElementById('o-rep-cant').value);
      if (!cod) return;
      if (!(cant > 0)) return toast('Indicá una cantidad mayor a cero', 'error');
      try {
        const r = (await Api.rpc('consultar_stock', { p_codigo: repElegido ? repElegido.codigo : cod }))[0];
        if (!r) return toast('No existe un repuesto con ese código: elegilo de la lista', 'error');
        if (cant > Number(r.disponible)) return faltaEnOT(r, cant, Number(r.disponible));
        try { await Api.insert('repuestos_ot', { ot_id: Number(id), codigo: r.codigo, cantidad: cant }); }
        catch (e) { if (esFaltaDeStock(e)) return faltaEnOT(r, cant, 0); throw e; }
        toast('Repuesto agregado'); recargar();
      } catch (e) { toast(errMsg(e), 'error'); }
    });
    async function faltaEnOT(r, cant, disp) {
      const d = await decidirFaltante({ descripcion: r.descripcion, codigo: r.codigo, cantidad: cant, disponible: disp });
      if (!d) return;
      try {
        if (d.cargar > 0) await Api.insert('repuestos_ot', { ot_id: Number(id), codigo: r.codigo, cantidad: d.cargar });
        await pedirADeposito(id, r.codigo, d.pedir, null, d.nota);
        toast(d.cargar > 0 ? `Se cargaron ${num(d.cargar)} y se pidieron ${num(d.pedir)} a Depósito` : `Pedido a Depósito: ${r.descripcion} × ${num(d.pedir)}`);
        recargar();
      } catch (e) { toast(errMsg(e), 'error'); }
    }
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

  // ---------------- Impresión / PDF: siempre en una sola hoja A4 ----------------
  function ajustarHoja() {
    const hoja = document.getElementById('hoja'), cont = document.getElementById('hoja-contenido');
    if (!hoja || !cont) return;
    const es = getComputedStyle(hoja);
    // Margen de seguridad: la hoja impresa mide medio milímetro menos que en pantalla.
    const disponible = (hoja.clientHeight - parseFloat(es.paddingTop) - parseFloat(es.paddingBottom)) * 0.985;
    const alto = z => { cont.style.zoom = String(z); return cont.getBoundingClientRect().height; };
    if (alto(1) <= disponible) { cont.style.zoom = '1'; return; }
    // Busca el mayor tamaño de letra que entra en la hoja.
    let bajo = 0.35, alto1 = 1;
    for (let i = 0; i < 12; i++) {
      const medio = (bajo + alto1) / 2;
      if (alto(medio) <= disponible) bajo = medio; else alto1 = medio;
    }
    cont.style.zoom = String(Math.floor(bajo * 1000) / 1000);
  }

  ruta(/^#\/imprimir\/(\d+)$/, async (main, id) => {
    const { ot, tareas, reps } = await cargarOT(id);
    if (!ot) { main.innerHTML = '<div class="tarjeta">No se encontró la OT.</div>'; return; }
    const u = ot.unidad || {};
    const total = tareas.reduce((a, t) => a + Number(t.horas_total || 0), 0);
    const tituloAnterior = document.title;
    document.title = nroOT(ot.numero) + ' - ' + (u.dominio || '');
    st.limpiar.push(() => { document.title = tituloAnterior; window.removeEventListener('beforeprint', ajustarHoja); });
    main.innerHTML = `
      <div class="acciones no-imprimir" style="margin-bottom:12px">
        <a class="btn" href="#/ot/${ot.id}">${ICONOS.atras} Volver a la OT</a>
        <button class="btn btn-primario" onclick="window.print()">Imprimir / Guardar PDF</button>
        <span class="nota">Siempre sale en una sola hoja A4. Para PDF, elegí "Guardar como PDF" en la impresora.</span>
      </div>
      <div class="hoja-marco"><div class="hoja" id="hoja"><div class="hoja-contenido" id="hoja-contenido">
        <h1>ORDEN DE REPARACIÓN DE VEHÍCULO</h1>
        <div class="empresa">${esc(cfg.empresa)}</div>
        <table><tr><th>N° OT</th><td><b>${esc(nroOT(ot.numero))}</b></td><th>Presupuesto</th><td>${esc(ot.presupuesto || '')}</td><th>OT cliente</th><td>${esc(ot.ot_cliente || '')}</td></tr>
          <tr><th>Fecha ingreso</th><td>${fecha(ot.fecha_ingreso)}</td><th>Hora ingreso</th><td>${esc((ot.hora_ingreso || '').slice(0, 5))}</td><th>N° FAC</th><td>${esc(ot.nro_factura || '')}</td></tr>
          <tr><th>Fecha salida</th><td>${fecha(ot.fecha_salida)}</td><th>Hora salida</th><td>${esc((ot.hora_salida || '').slice(0, 5))}</td><th>Estado</th><td>${esc(ot.estado)}</td></tr></table>
        <div class="seccion">DATOS DEL VEHÍCULO</div>
        <table><tr><th>Cliente</th><th>Marca</th><th>Modelo</th><th>Dominio</th><th>INT</th><th>Chasis</th><th>KM</th><th>Tipo</th></tr>
          <tr><td>${esc(ot.cliente ? ot.cliente.nombre : '')}</td><td>${esc(u.marca ? u.marca.nombre : '')}</td><td>${esc(u.modelo ? u.modelo.nombre : '')}</td>
          <td>${esc(u.dominio)}</td><td>${esc(u.interno || '')}</td><td>${esc(u.chasis || '')}</td><td>${num(ot.km, 0)}</td><td>${esc(ot.tipo)}</td></tr></table>
        <div class="seccion">TRABAJO Y SERVICIO</div>
        <table><tr><th style="width:6%">#</th><th>Descripción</th><th style="width:10%">CANT.</th><th style="width:12%">HS</th></tr>
          ${tareas.map(t => `<tr><td>${t.renglon}</td><td>${esc(t.descripcion)}${t.butacas.length ? `<div style="font-size:.85em">Butacas: ${esc(resumenButacas(t.butacas))}</div>` : ''}</td><td style="text-align:right">${num(t.cantidad)}</td><td style="text-align:right">${num(t.horas_total)}</td></tr>`).join('') || '<tr><td colspan="4">—</td></tr>'}
          <tr><th colspan="3" style="text-align:right">TOTAL HS</th><th style="text-align:right">${num(total)}</th></tr></table>
        <div class="seccion">REPUESTOS</div>
        <table><tr><th style="width:24%">Código</th><th>Repuesto</th><th style="width:12%">Cantidad</th></tr>
          ${reps.map(r => `<tr><td>${esc(r.codigo)}</td><td>${esc(r.repuesto ? r.repuesto.descripcion : '')}</td><td style="text-align:right">${num(r.cantidad)}</td></tr>`).join('') || '<tr><td colspan="3">—</td></tr>'}</table>
        ${ot.observaciones ? `<div class="seccion">OBSERVACIONES</div><div class="caja" style="min-height:0">${esc(ot.observaciones)}</div>` : ''}
        <div class="firmas">
          <div><div class="seccion">CHECK INGRESO · INSPECCIÓN VISUAL</div><div style="font-size:9pt">G: Golpe / R: Rayado / F: Faltante</div><div class="caja"></div></div>
          <div><div class="seccion">ENTREGA</div>
            <div>Firma:</div><div class="linea-firma"></div><div>Aclaración:</div><div class="linea-firma"></div>
            <div>DNI:</div><div class="linea-firma"></div><div>Fecha de retiro:</div><div class="linea-firma"></div></div>
        </div>
      </div></div></div>`;
    ajustarHoja();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(ajustarHoja);
    window.addEventListener('beforeprint', ajustarHoja);
  }, ['OFICINA', 'ADMINISTRADOR', 'DEPOSITO']);
})();
