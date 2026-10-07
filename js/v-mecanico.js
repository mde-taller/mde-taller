// MDE · Taller — pantallas del mecánico (celular).
(() => {
  const { st, esc, num, parseNum, nroOT, fechaHora, duracion, chipEstadoTarea, errMsg, toast, modal, confirmar,
          ICONOS, MOTIVOS, textoMotivo, pausaAbierta, chipPausa, autocompletarRepuesto, autocompletarUnidad, unidadExacta,
          decidirFaltante, pedirADeposito, esFaltaDeStock, TIPOS, ruta, ir, on, navegar } = App;

  let pestana = 'pendientes';
  const hora = d => d ? new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  const horasTexto = t => Number(t.cantidad) !== 1
    ? `${num(t.cantidad)} × ${num(t.horas)} h = ${num(t.horas_total)} h` : `${num(t.horas)} h`;

  // ---------------- Mis tareas ----------------
  ruta(/^#\/tareas$/, async main => {
    const [asig, abiertos] = await Promise.all([
      Api.select('asignaciones', {
        select: 'terminada_en,tarea:tareas_ot(id,descripcion,horas,cantidad,horas_total,estado,renglon,' +
                'ot:ordenes_trabajo(id,numero,estado,tipo,unidad:unidades(dominio,interno),cliente:clientes(nombre),pausas:pausas_ot(motivo,fin)),' +
                'companeros:asignaciones(mecanico_id,usuario:usuarios(nombre)))',
        mecanico_id: 'eq.' + st.usuarioId
      }),
      Api.select('registros_tiempo', { select: 'tarea_id,inicio', mecanico_id: 'eq.' + st.usuarioId, fin: 'is.null' })
    ]);
    const corriendo = new Map(abiertos.map(r => [r.tarea_id, r.inicio]));
    const items = asig.filter(a => a.tarea && a.tarea.ot).map(a => {
      const t = a.tarea;
      const hecha = !!a.terminada_en || t.estado === 'HECHA';
      let grupo = 'pendientes';
      if (hecha) grupo = 'hechas';
      else if (corriendo.has(t.id)) grupo = 'curso';
      else if (['CERRADA', 'PRUEBA'].includes(t.ot.estado)) grupo = 'ocultas';
      return { t, grupo };
    });
    const cuenta = g => items.filter(i => i.grupo === g).length;
    const lista = items.filter(i => i.grupo === pestana)
      .sort((x, y) => (y.t.ot.numero - x.t.ot.numero) || (x.t.renglon - y.t.renglon))
      .slice(0, pestana === 'hechas' ? 40 : 200);

    main.innerHTML = `
      <div class="encabezado"><div><h1>Mis tareas</h1><div class="sub">${esc(st.nombre)}</div></div></div>
      <div class="pestanas" role="tablist">
        <button class="pestana ${pestana === 'pendientes' ? 'activa' : ''}" data-p="pendientes">Pendientes (${cuenta('pendientes')})</button>
        <button class="pestana ${pestana === 'curso' ? 'activa' : ''}" data-p="curso">En curso (${cuenta('curso')})</button>
        <button class="pestana ${pestana === 'hechas' ? 'activa' : ''}" data-p="hechas">Hechas</button>
      </div>
      <div class="lista-tareas">
        ${lista.length ? lista.map(({ t, grupo }) => {
          const otros = (t.companeros || []).filter(c => c.mecanico_id !== st.usuarioId).map(c => c.usuario && c.usuario.nombre).filter(Boolean);
          const pausa = grupo !== 'hechas' ? pausaAbierta(t.ot) : null;
          const estado = pausa ? chipPausa(pausa) : grupo === 'curso' ? '<span class="chip azul">En curso</span>' : chipEstadoTarea(grupo === 'hechas' ? 'HECHA' : t.estado);
          return `<a class="tarea-card ${grupo === 'curso' ? 'en-curso' : ''}" href="#/tarea/${t.id}">
            <div class="linea1"><span>${esc(nroOT(t.ot.numero))} · ${esc(t.ot.unidad ? t.ot.unidad.dominio : '')}</span>${estado}</div>
            <div class="titulo">${esc(t.descripcion)}${Number(t.cantidad) !== 1 ? ` <span style="color:var(--gris)">× ${num(t.cantidad)}</span>` : ''}</div>
            <div class="linea3">${esc(t.ot.cliente ? t.ot.cliente.nombre : '')} · ${esc(t.ot.tipo)} · Tempario ${horasTexto(t)}${otros.length ? ' · con ' + esc(otros.join(', ')) : ''}</div>
          </a>`;
        }).join('') : `<div class="tarjeta vacio">${pestana === 'pendientes' ? 'No tenés tareas pendientes.' : pestana === 'curso' ? 'No tenés tareas en curso.' : 'Todavía no terminaste tareas.'}</div>`}
      </div>`;
    on(main, 'click', '[data-p]', (ev, b) => { pestana = b.dataset.p; navegar(); });
  }, ['MECANICO']);

  // ---------------- Detalle de tarea ----------------
  ruta(/^#\/tarea\/(\d+)$/, async (main, id) => {
    const [tareas, registros, repuestos, pedidosTarea] = await Promise.all([
      Api.select('tareas_ot', {
        select: 'id,descripcion,horas,cantidad,horas_total,estado,ot_id,tempario(categoria:categorias_tempario(nombre)),' +
                'ot:ordenes_trabajo(id,numero,estado,tipo,km,observaciones,unidad:unidades(dominio,interno,chasis,marca:marcas(nombre),modelo:modelos(nombre)),cliente:clientes(nombre),' +
                'pausas:pausas_ot(id,motivo,detalle,inicio,fin,pausador:usuarios!pausas_ot_pausada_por_fkey(nombre))),' +
                'asignaciones(mecanico_id,terminada_en,usuario:usuarios(nombre))',
        id: 'eq.' + id
      }),
      Api.select('registros_tiempo', { select: 'inicio,fin', tarea_id: 'eq.' + id, mecanico_id: 'eq.' + st.usuarioId, order: 'inicio' }),
      Api.select('repuestos_ot', { select: 'id,codigo,cantidad,cargado_en,estado,repuesto:repuestos(descripcion)', tarea_id: 'eq.' + id, order: 'id' }),
      Api.select('pedidos_repuesto', { select: 'id,descripcion,codigo,cantidad,estado,nota,creado_en', tarea_id: 'eq.' + id, pausa_id: 'is.null', order: 'id' })
    ]);
    const t = tareas[0];
    if (!t) { main.innerHTML = '<div class="tarjeta">No se encontró la tarea o no está asignada a vos.</div>'; return; }
    const ot = t.ot, u = ot.unidad || {};
    const pausa = pausaAbierta(ot);
    const pedidos = pausa ? await Api.select('pedidos_repuesto', { select: 'descripcion,codigo,cantidad,estado,nota', ot_id: 'eq.' + ot.id, pausa_id: 'eq.' + pausa.id, order: 'id' }) : [];
    const mia = (t.asignaciones || []).find(a => a.mecanico_id === st.usuarioId);
    const otros = (t.asignaciones || []).filter(a => a.mecanico_id !== st.usuarioId);
    const abierto = registros.find(r => !r.fin);
    const terminadaYo = mia && mia.terminada_en;
    const otCerrada = ['CERRADA', 'PRUEBA'].includes(ot.estado);
    const acumulado = () => registros.reduce((s, r) => s + ((r.fin ? new Date(r.fin) : new Date()) - new Date(r.inicio)), 0);
    const categoria = t.tempario && t.tempario.categoria ? t.tempario.categoria.nombre : '';
    const editable = mia && !otCerrada;

    let botones = '';
    if (otCerrada) {
      botones = `<div class="aviso-box">La ${esc(nroOT(ot.numero))} está ${esc(ot.estado.toLowerCase())}: no se pueden hacer cambios.</div>`;
    } else if (!mia) {
      botones = '<div class="aviso-box">Esta tarea no está asignada a vos.</div>';
    } else if (pausa) {
      botones = '<div class="nota">La OT está pausada. Reanudala para seguir trabajando.</div>';
    } else if (terminadaYo) {
      botones = `<div class="ok-box">Terminaste tu parte de esta tarea.</div>
        <button class="btn" data-accion="iniciar">Reabrir y seguir trabajando</button>`;
    } else if (abierto) {
      botones = `<div class="botones-2"><button class="btn btn-grande" data-accion="pausar">Pausar mi tarea</button>
        <button class="btn btn-verde btn-grande" data-accion="terminar">Terminar tarea</button></div>`;
    } else {
      botones = `<div class="botones-2"><button class="btn btn-primario btn-grande" data-accion="iniciar">${registros.length ? 'Reanudar' : 'Iniciar'}</button>
        <button class="btn btn-verde btn-grande" data-accion="terminar">Terminar tarea</button></div>`;
    }

    main.innerHTML = `
      <div class="cabecera-tarea">
        <a class="volver" href="#/tareas">${ICONOS.atras} Mis tareas</a>
        <div class="sub">${esc(nroOT(ot.numero))} · ${esc(ot.cliente ? ot.cliente.nombre : '')}${categoria ? ' · ' + esc(categoria) : ''}</div>
        <h1 style="margin:4px 0 10px">${esc(t.descripcion)}</h1>
        <div class="datos">
          <div class="dato"><div class="et">Dominio</div><div class="va">${esc(u.dominio)}</div></div>
          <div class="dato"><div class="et">INT</div><div class="va">${esc(u.interno || '—')}</div></div>
          <div class="dato"><div class="et">KM</div><div class="va">${num(ot.km, 0)}</div></div>
          <div class="dato"><div class="et">Tempario</div><div class="va">${horasTexto(t)}</div></div>
          <div class="dato"><div class="et">Unidad</div><div class="va">${esc([u.marca && u.marca.nombre, u.modelo && u.modelo.nombre].filter(Boolean).join(' ') || ot.tipo)}</div></div>
          ${otros.length ? `<div class="dato"><div class="et">Compañero</div><div class="va">${esc(otros.map(o => o.usuario && o.usuario.nombre).join(', '))}</div></div>` : ''}
        </div>
        ${ot.observaciones ? `<div class="sub" style="margin-top:10px">Obs.: ${esc(ot.observaciones)}</div>` : ''}
      </div>
      ${pausa ? `<div class="pausa-banner">
        <div><div class="titulo">OT pausada · ${esc(textoMotivo(pausa.motivo))}</div>
          <div class="det">Por ${esc(pausa.pausador ? pausa.pausador.nombre : '')} el ${hora(pausa.inicio)}${pausa.detalle ? ' · ' + esc(pausa.detalle) : ''}</div>
          ${pedidos.map(p => `<div class="det">• ${esc(p.descripcion)} × ${num(p.cantidad)} — ${p.estado === 'RESUELTO' ? '<b>ya está</b>' + (p.nota ? ' (' + esc(p.nota) + ')' : '') : 'pedido a Depósito'}</div>`).join('')}</div>
        ${mia && !otCerrada ? '<button class="btn btn-primario" data-accion="reanudar-ot">Reanudar OT</button>' : ''}</div>` : ''}
      <section class="tarjeta">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
          <h3>Tiempo trabajado</h3><span class="nota">Solo control interno</span></div>
        <div class="reloj" id="reloj">${duracion(acumulado())}</div>
        ${botones}
      </section>
      <section class="tarjeta">
        <h3>Repuestos cargados</h3>
        ${repuestos.length ? repuestos.map(r => `
          <div class="repuesto-fila">
            <div class="info"><div class="desc">${esc(r.repuesto ? r.repuesto.descripcion : r.codigo)}</div>
              <div class="cod">Cód. ${esc(r.codigo)} · Cant. ${num(r.cantidad)}</div>
              <div style="margin-top:4px">${r.estado === 'ENTREGADO' ? '<span class="chip verde">Entregado</span>' : '<span class="chip ambar">Pendiente de entrega</span>'}</div></div>
            ${editable ? `<button class="btn btn-chico" data-editar="${r.id}" data-cant="${r.cantidad}" data-codigo="${esc(r.codigo)}" data-desc="${esc(r.repuesto ? r.repuesto.descripcion : r.codigo)}" aria-label="Modificar cantidad">${ICONOS.lapiz}</button>
              <button class="btn btn-chico btn-peligro" data-quitar="${r.id}" aria-label="Quitar repuesto">Quitar</button>` : ''}
          </div>`).join('') : '<div class="vacio">Todavía no cargaste repuestos en esta tarea.</div>'}
        ${editable && repuestos.length ? '<div class="nota">Si modificás o quitás un repuesto, se avisa a Oficina y Administración.</div>' : ''}
        ${pedidosTarea.length ? `<h3 style="margin-top:16px">Pedidos a Depósito</h3>
          ${pedidosTarea.map(p => `<div class="repuesto-fila"><div class="info"><div class="desc">${esc(p.descripcion)}</div>
            <div class="cod">Cód. ${esc(p.codigo || '—')} · Cant. ${num(p.cantidad)}</div>
            <div style="margin-top:4px">${p.estado === 'RESUELTO' ? '<span class="chip verde">Ya está</span>' + (p.nota ? ` <span class="nota">${esc(p.nota)}</span>` : '') : '<span class="chip ambar">Pedido</span>'}</div></div></div>`).join('')}
          ${pedidosTarea.some(p => p.estado === 'RESUELTO') && editable ? '<div class="nota">Cuando Depósito lo tiene, escanealo para cargarlo a la tarea.</div>' : ''}` : ''}
      </section>
      ${editable ? `<div style="display:flex;flex-direction:column;gap:8px">
        <a class="btn btn-primario btn-grande" href="#/escanear/${t.id}">${ICONOS.escanear} Escanear repuesto</a>
        ${pausa ? '' : `<a class="btn btn-grande" href="#/pausar/${ot.id}/${t.id}">${ICONOS.pausa} Pausar la OT (con motivo)</a>`}
        <a class="btn btn-grande" href="#/solicitar/${ot.id}/${t.id}">Encontré otra falla: solicitar tarea</a></div>` : ''}`;

    if (abierto) {
      const iv = setInterval(() => { const r = document.getElementById('reloj'); if (r) r.textContent = duracion(acumulado()); }, 1000);
      st.limpiar.push(() => clearInterval(iv));
    }

    const accion = async (fn, ok) => {
      try { await Api.rpc(fn, { p_tarea_id: Number(id) }); if (ok) toast(ok); navegar(); }
      catch (e) { toast(errMsg(e), 'error'); }
    };
    on(main, 'click', '[data-accion=iniciar]', () => accion('iniciar_tarea', 'Cronómetro en marcha'));
    on(main, 'click', '[data-accion=pausar]', () => accion('pausar_tarea', 'Tu tarea quedó en pausa'));
    on(main, 'click', '[data-accion=terminar]', async () => {
      const ok = await confirmar('¿Terminaste tu parte de esta tarea? Se detiene el cronómetro.', { titulo: 'Terminar tarea', textoOk: 'Sí, terminar' });
      if (ok) accion('terminar_tarea', otros.length ? 'Listo. La tarea queda hecha cuando termine tu compañero.' : 'Tarea terminada');
    });
    on(main, 'click', '[data-accion=reanudar-ot]', async () => {
      const ok = await confirmar('¿Reanudar la OT? Después iniciá tu tarea para que corra el cronómetro.', { titulo: 'Reanudar OT', textoOk: 'Reanudar' });
      if (!ok) return;
      try { await Api.rpc('reanudar_ot', { p_ot_id: ot.id }); toast('OT reanudada'); navegar(); }
      catch (e) { toast(errMsg(e), 'error'); }
    });
    on(main, 'click', '[data-editar]', async (ev, b) => {
      const v = await modal({ titulo: 'Modificar cantidad', textoOk: 'Guardar',
        campos: [{ id: 'cant', label: 'Cantidad (admite decimales)', valor: String(b.dataset.cant).replace('.', ','), inputmode: 'decimal', obligatorio: true }],
        html: '<p class="nota">Se avisa a Oficina y Administración del cambio.</p>' });
      if (!v) return;
      const c = parseNum(v.cant);
      if (!(c > 0)) return toast('La cantidad tiene que ser mayor a cero', 'error');
      try {
        const r = await Api.update('repuestos_ot', { id: 'eq.' + b.dataset.editar }, { cantidad: c });
        if (!r.length) throw new Error('No tenés permiso para hacer esto.');
        toast('Cantidad modificada'); navegar();
      } catch (e) {
        if (!esFaltaDeStock(e)) return toast(errMsg(e), 'error');
        // No alcanza el stock para subir la cantidad: cargar lo que hay y pedir el resto.
        const antes = Number(b.dataset.cant);
        let libre = 0;
        try { const x = (await Api.rpc('consultar_stock', { p_codigo: b.dataset.codigo }))[0]; libre = x ? Number(x.disponible) : 0; } catch (e2) { /* sigue con 0 */ }
        const d = await decidirFaltante({ descripcion: b.dataset.desc, codigo: b.dataset.codigo, cantidad: c - antes, disponible: libre });
        if (!d) return;
        try {
          if (d.cargar > 0) await Api.update('repuestos_ot', { id: 'eq.' + b.dataset.editar }, { cantidad: antes + d.cargar });
          await pedirADeposito(t.ot_id, b.dataset.codigo, d.pedir, t.id, d.nota);
          toast(d.cargar > 0 ? `Cantidad en ${num(antes + d.cargar)} y se pidieron ${num(d.pedir)} a Depósito` : `Se pidieron ${num(d.pedir)} a Depósito`);
          navegar();
        } catch (e3) { toast(errMsg(e3), 'error'); }
      }
    });
    on(main, 'click', '[data-quitar]', async (ev, b) => {
      const ok = await confirmar('¿Quitar este repuesto de la tarea? El stock vuelve y se avisa a Oficina y Administración.',
        { titulo: 'Quitar repuesto', textoOk: 'Quitar', peligro: true });
      if (!ok) return;
      try {
        const r = await Api.remove('repuestos_ot', { id: 'eq.' + b.dataset.quitar });
        if (!r.length) throw new Error('No tenés permiso para hacer esto.');
        toast('Repuesto quitado'); navegar();
      } catch (e) { toast(errMsg(e), 'error'); }
    });
  }, ['MECANICO']);

  // ---------------- Pausar la OT ----------------
  ruta(/^#\/pausar\/(\d+)(?:\/(\d+))?$/, async (main, otId, tareaId) => {
    const ots = await Api.select('ordenes_trabajo', { select: 'id,numero,estado,unidad:unidades(dominio),pausas:pausas_ot(motivo,fin)', id: 'eq.' + otId });
    const ot = ots[0];
    if (!ot) { main.innerHTML = '<div class="tarjeta">No se encontró la OT.</div>'; return; }
    const volver = tareaId ? '#/tarea/' + tareaId : '#/tareas';
    if (pausaAbierta(ot)) { main.innerHTML = `<div class="tarjeta">La OT ya está pausada. <a href="${volver}">Volver</a></div>`; return; }

    main.innerHTML = `
      <a class="volver" href="${volver}">${ICONOS.atras} Volver</a>
      <h1 style="margin:4px 0">Pausar la OT</h1>
      <div class="nota" style="margin-bottom:14px">${esc(nroOT(ot.numero))} · ${esc(ot.unidad ? ot.unidad.dominio : '')} · se frenan todos los cronómetros de la OT</div>
      <form id="f-pausa">
        <section class="tarjeta"><h2>Motivo</h2>
          <div class="opciones-motivo" role="radiogroup" aria-label="Motivo de la pausa">
            ${MOTIVOS.map(([v, t], i) => `<label class="opcion"><input type="radio" name="motivo" value="${v}" ${i === 0 ? 'checked' : ''}> ${esc(t)}</label>`).join('')}
          </div>
          <div class="campo" style="margin-top:14px"><label for="p-detalle" id="p-detalle-et">Detalle (opcional)</label>
            <textarea id="p-detalle" placeholder="Ej.: espera de presupuesto, se manda la tapa a rectificar…"></textarea></div>
        </section>
        <section class="tarjeta" id="p-repuestos"><h2>¿Qué repuesto falta?</h2>
          <p class="nota" style="margin-top:0">Buscalo por código o descripción. Si no está en la lista, escribí qué es. El pedido le llega a Depósito y al Administrador.</p>
          <div id="p-lineas"></div>
          <button class="btn" type="button" data-accion="linea">+ Agregar otro repuesto</button>
        </section>
        <div class="error-box oculto" id="p-error"></div>
        <button class="btn btn-primario btn-grande" type="submit">${ICONOS.pausa} Pausar OT</button>
      </form>`;

    const lineas = document.getElementById('p-lineas');
    const agregarLinea = () => {
      const div = document.createElement('div');
      div.className = 'linea-pedido';
      div.innerHTML = `<input class="l-texto" placeholder="Código o descripción" aria-label="Repuesto que falta">
        <input class="l-cant cant" value="1" inputmode="decimal" aria-label="Cantidad">
        <button class="btn btn-chico" type="button" data-quitar-linea aria-label="Quitar">×</button>`;
      lineas.appendChild(div);
      const inp = div.querySelector('.l-texto');
      autocompletarRepuesto(inp, {
        alElegir: r => { inp.dataset.codigo = r.codigo; div.querySelector('.l-cant').focus(); },
        alEscribir: () => { delete inp.dataset.codigo; }
      });
      return inp;
    };
    agregarLinea();
    const actualizar = () => {
      const m = main.querySelector('input[name=motivo]:checked').value;
      document.getElementById('p-repuestos').classList.toggle('oculto', m !== 'FALTA DE REPUESTO');
      const et = document.getElementById('p-detalle-et');
      et.textContent = m === 'OTRO' ? 'Motivo' : 'Detalle (opcional)';
      et.classList.toggle('obligatorio', m === 'OTRO');
    };
    actualizar();
    on(main, 'change', 'input[name=motivo]', actualizar);
    on(main, 'click', '[data-accion=linea]', () => agregarLinea().focus());
    // Enter en una línea de repuesto no envía el formulario.
    on(main, 'keydown', '.l-texto, .l-cant', ev => { if (ev.key === 'Enter') ev.preventDefault(); });
    on(main, 'click', '[data-quitar-linea]', (ev, b) => {
      b.closest('.linea-pedido').remove();
      if (!lineas.children.length) agregarLinea();
    });
    document.getElementById('f-pausa').addEventListener('submit', async ev => {
      ev.preventDefault();
      const err = document.getElementById('p-error');
      const mostrar = m => { err.textContent = m; err.classList.remove('oculto'); };
      err.classList.add('oculto');
      const motivo = main.querySelector('input[name=motivo]:checked').value;
      const detalle = document.getElementById('p-detalle').value.trim();
      if (motivo === 'OTRO' && !detalle) return mostrar('Escribí el motivo de la pausa.');
      let repuestos = [];
      if (motivo === 'FALTA DE REPUESTO') {
        for (const div of lineas.querySelectorAll('.linea-pedido')) {
          const inp = div.querySelector('.l-texto');
          const texto = inp.value.trim();
          const cant = parseNum(div.querySelector('.l-cant').value);
          if (!texto) continue;
          if (!(cant > 0)) return mostrar('Revisá las cantidades: tienen que ser mayores a cero.');
          repuestos.push(inp.dataset.codigo ? { codigo: inp.dataset.codigo, texto, cantidad: cant } : { texto, cantidad: cant });
        }
        if (!repuestos.length) return mostrar('Indicá qué repuesto falta.');
      }
      const btn = ev.target.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await Api.rpc('pausar_ot', { p_ot_id: ot.id, p_motivo: motivo, p_detalle: detalle || null,
                                     p_repuestos: repuestos, p_tarea_id: tareaId ? Number(tareaId) : null });
        toast(motivo === 'FALTA DE REPUESTO' ? 'OT pausada. El pedido le llegó a Depósito.' : 'OT pausada');
        ir(volver);
      } catch (e) { mostrar(errMsg(e)); btn.disabled = false; }
    });
  }, ['MECANICO']);

  // ---------------- Escanear repuesto ----------------
  function cargarScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  ruta(/^#\/escanear\/(\d+)$/, async (main, tareaId) => {
    const tareas = await Api.select('tareas_ot', {
      select: 'id,descripcion,ot_id,ot:ordenes_trabajo(numero,estado)', id: 'eq.' + tareaId });
    const t = tareas[0];
    if (!t) { main.innerHTML = '<div class="tarjeta">No se encontró la tarea.</div>'; return; }

    main.innerHTML = `
      <a class="volver" href="#/tarea/${t.id}">${ICONOS.atras} Volver a la tarea</a>
      <h1 style="margin:4px 0">Escanear repuesto</h1>
      <div class="nota" style="margin-bottom:12px">${esc(nroOT(t.ot.numero))} · ${esc(t.descripcion)}</div>
      <div class="camara" id="camara"><div>Iniciando cámara…</div></div>
      <div class="nota" id="estado-camara" style="margin:8px 0 12px">Apuntá al código de barras del repuesto.</div>
      <form id="f-codigo" class="campo">
        <label for="codigo">O buscalo: escribí el código o la descripción</label>
        <div style="display:flex;gap:8px"><input id="codigo" autocapitalize="characters" spellcheck="false" placeholder="Ej.: A906 o filtro aceite">
          <button class="btn" type="submit">Buscar</button></div>
      </form>
      <div id="resultado"></div>`;

    const estado = m => { const e = document.getElementById('estado-camara'); if (e) e.textContent = m; };
    let detener = () => {};
    let vivo = true;
    st.limpiar.push(() => { vivo = false; detener(); });

    async function buscar(codigo) {
      codigo = String(codigo || '').trim();
      if (!codigo) return;
      document.getElementById('codigo').value = codigo;
      const res = document.getElementById('resultado');
      res.innerHTML = '<div class="vacio">Buscando…</div>';
      let filas;
      try { filas = await Api.rpc('consultar_stock', { p_codigo: codigo }); }
      catch (e) { res.innerHTML = `<div class="error-box">${esc(errMsg(e))}</div>`; return; }
      const r = filas && filas[0];
      if (!r) {
        res.innerHTML = `<div class="error-box">No existe un repuesto con el código <b>${esc(codigo)}</b>. Probá escribir parte del código o de la descripción y elegilo de la lista.</div>
          <button class="btn" data-accion="otro">Escanear otro</button>`;
        return;
      }
      const disp = Number(r.disponible);
      res.innerHTML = `<section class="tarjeta">
        <div class="nota">Cód. ${esc(r.codigo)}</div>
        <h2 style="margin:2px 0 6px">${esc(r.descripcion)}</h2>
        <div style="font-weight:600;color:${disp > 0 ? 'var(--verde)' : 'var(--rojo)'}">Stock disponible: ${num(disp)}</div>
        <div class="campo" style="margin-top:14px"><label for="cant">Cantidad (admite decimales)</label>
          <div class="cantidad"><button class="btn" type="button" data-paso="-1" aria-label="Restar">−</button>
            <input id="cant" value="1" inputmode="decimal" autocomplete="off">
            <button class="btn" type="button" data-paso="1" aria-label="Sumar">+</button></div></div>
        <div class="error-box oculto" id="err-cargar"></div>
        ${disp > 0 ? '<button class="btn btn-primario btn-grande" data-accion="cargar">Cargar a la tarea</button>'
          : `<button class="btn btn-primario btn-grande" data-accion="pedir">Pedir a Depósito</button>
             <div class="nota" style="margin-top:8px">No hay stock. Pedilo y te avisan cuando esté. Si no podés seguir sin él, pausá la OT.</div>`}
        <button class="btn" style="margin-top:8px;width:100%" data-accion="otro">Escanear otro</button>
      </section>`;
      res.dataset.codigo = r.codigo;
      res.dataset.disponible = disp;
      res.dataset.descripcion = r.descripcion;
    }

    async function iniciarCamara() {
      const cont = document.getElementById('camara');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        cont.innerHTML = '<div style="padding:16px;text-align:center">La cámara no está disponible. Buscá el repuesto abajo.</div>';
        return;
      }
      const alDetectar = texto => {
        detener();
        if (navigator.vibrate) navigator.vibrate(80);
        estado('Código leído: ' + texto);
        buscar(texto);
      };
      try {
        if ('BarcodeDetector' in window) {
          let formatos = [];
          try { formatos = await window.BarcodeDetector.getSupportedFormats(); } catch (e) { formatos = []; }
          if (formatos.length) {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
            if (!vivo) { stream.getTracks().forEach(x => x.stop()); return; }
            cont.innerHTML = '<video playsinline muted autoplay></video><div class="marco"></div>';
            const video = cont.querySelector('video');
            video.srcObject = stream;
            await video.play().catch(() => {});
            const det = new window.BarcodeDetector({ formats: formatos });
            let activo = true;
            detener = () => { activo = false; stream.getTracks().forEach(x => x.stop()); };
            const ciclo = async () => {
              if (!activo) return;
              try { const r = await det.detect(video); if (r.length && r[0].rawValue) return alDetectar(r[0].rawValue); } catch (e) { /* cuadro no listo */ }
              setTimeout(ciclo, 200);
            };
            ciclo();
            return;
          }
        }
        // Celulares sin lector incorporado (por ejemplo iPhone): lector externo.
        await cargarScript('https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js');
        if (!vivo) return;
        cont.innerHTML = '<div id="lector" style="width:100%"></div>';
        const F = window.Html5QrcodeSupportedFormats || {};
        const formatos = ['CODE_128', 'CODE_39', 'CODE_93', 'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'ITF', 'CODABAR', 'QR_CODE']
          .map(k => F[k]).filter(v => v !== undefined);
        const lector = new window.Html5Qrcode('lector', formatos.length ? { formatsToSupport: formatos, verbose: false } : { verbose: false });
        let activo = true;
        detener = () => { if (activo) { activo = false; lector.stop().catch(() => {}); } };
        await lector.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 120 } },
          texto => { if (activo) alDetectar(texto); }, () => {});
      } catch (e) {
        cont.innerHTML = `<div style="padding:16px;text-align:center">No se pudo usar la cámara${e && e.name === 'NotAllowedError' ? ' (permiso denegado)' : ''}. Buscá el repuesto abajo.</div>`;
      }
    }

    autocompletarRepuesto(document.getElementById('codigo'), { alElegir: r => { detener(); buscar(r.codigo); } });
    document.getElementById('f-codigo').addEventListener('submit', ev => { ev.preventDefault(); detener(); buscar(document.getElementById('codigo').value); });
    on(main, 'click', '[data-paso]', (ev, b) => {
      const inp = document.getElementById('cant');
      const v = parseNum(inp.value);
      const n = Math.max(0, (isNaN(v) ? 0 : v) + Number(b.dataset.paso));
      inp.value = String(n).replace('.', ',');
    });
    on(main, 'click', '[data-accion=otro]', () => {
      document.getElementById('resultado').innerHTML = '';
      document.getElementById('codigo').value = '';
      estado('Apuntá al código de barras del repuesto.');
      iniciarCamara();
    });
    on(main, 'click', '[data-accion=cargar]', async (ev, b) => {
      const res = document.getElementById('resultado');
      const err = document.getElementById('err-cargar');
      const c = parseNum(document.getElementById('cant').value);
      const disp = Number(res.dataset.disponible);
      err.classList.add('oculto');
      const mostrar = m => { err.textContent = m; err.classList.remove('oculto'); };
      if (!(c > 0)) return mostrar('La cantidad tiene que ser mayor a cero.');
      if (c > disp) return pedirFaltante(c, disp, b);
      b.disabled = true;
      try {
        await Api.insert('repuestos_ot', { ot_id: t.ot_id, tarea_id: t.id, codigo: res.dataset.codigo, cantidad: c });
        toast(`Cargado: ${res.dataset.descripcion} × ${num(c)}. Queda pendiente de entrega.`);
        ir('#/tarea/' + t.id);
      } catch (e) {
        if (esFaltaDeStock(e)) { b.disabled = false; return pedirFaltante(c, 0, b); }
        mostrar(errMsg(e)); b.disabled = false;
      }
    });
    // Sin stock suficiente: carga lo que hay (si quiere) y pide el resto a Depósito.
    async function pedirFaltante(c, disp, b) {
      const res = document.getElementById('resultado');
      const err = document.getElementById('err-cargar');
      const d = await decidirFaltante({ descripcion: res.dataset.descripcion, codigo: res.dataset.codigo, cantidad: c, disponible: disp });
      if (!d) return;
      b.disabled = true;
      try {
        if (d.cargar > 0) await Api.insert('repuestos_ot', { ot_id: t.ot_id, tarea_id: t.id, codigo: res.dataset.codigo, cantidad: d.cargar });
        await pedirADeposito(t.ot_id, res.dataset.codigo, d.pedir, t.id, d.nota);
        toast(d.cargar > 0 ? `Cargaste ${num(d.cargar)} y pediste ${num(d.pedir)} a Depósito` : `Pedido a Depósito: ${res.dataset.descripcion} × ${num(d.pedir)}`);
        ir('#/tarea/' + t.id);
      } catch (e) { err.textContent = errMsg(e); err.classList.remove('oculto'); b.disabled = false; }
    }
    on(main, 'click', '[data-accion=pedir]', (ev, b) => {
      const c = parseNum(document.getElementById('cant').value);
      const err = document.getElementById('err-cargar');
      if (!(c > 0)) { err.textContent = 'La cantidad tiene que ser mayor a cero.'; err.classList.remove('oculto'); return; }
      pedirFaltante(c, 0, b);
    });
    iniciarCamara();
  }, ['MECANICO']);

  // ---------------- Solicitar tarea nueva ----------------
  ruta(/^#\/solicitar\/(\d+)(?:\/(\d+))?$/, async (main, otId, tareaId) => {
    const ots = await Api.select('ordenes_trabajo', { select: 'id,numero,tipo,estado,unidad:unidades(dominio)', id: 'eq.' + otId });
    const ot = ots[0];
    if (!ot) { main.innerHTML = '<div class="tarjeta">No se encontró la OT.</div>'; return; }
    const temp = await Api.select('tempario', {
      select: 'id,tarea,horas,categoria:categorias_tempario(nombre)', tipo: 'eq.' + ot.tipo, activo: 'is.true', order: 'tarea' });
    const opciones = new Map(temp.map(x => [`${x.tarea} · ${x.categoria ? x.categoria.nombre : ''}`, x]));

    main.innerHTML = `
      <a class="volver" href="${tareaId ? '#/tarea/' + tareaId : '#/tareas'}">${ICONOS.atras} Volver</a>
      <h1 style="margin:4px 0">Solicitar tarea nueva</h1>
      <div class="nota" style="margin-bottom:14px">${esc(nroOT(ot.numero))} · ${esc(ot.unidad ? ot.unidad.dominio : '')} · la aprueba Oficina</div>
      <form id="f-sol" class="tarjeta">
        <div class="campo"><label for="falla" class="obligatorio">Falla encontrada</label>
          <textarea id="falla" placeholder="Describí lo que encontraste"></textarea></div>
        <div class="campo"><label for="propuesta" class="obligatorio">Tarea propuesta</label>
          <input id="propuesta" list="dl-temp" placeholder="Buscá en el tempario o escribila" autocomplete="off">
          <datalist id="dl-temp">${[...opciones.keys()].map(k => `<option value="${esc(k)}"></option>`).join('')}</datalist>
          <div class="nota">Tempario de unidad ${esc(ot.tipo.toLowerCase())}.</div></div>
        <div class="campo" style="max-width:200px"><label for="sol-cant">Cantidad (ej. 2 si es "por lado")</label>
          <input id="sol-cant" value="1" inputmode="decimal" autocomplete="off"></div>
        <div class="error-box oculto" id="err-sol"></div>
        <button class="btn btn-primario btn-grande" type="submit">Enviar a Oficina</button>
      </form>`;
    document.getElementById('f-sol').addEventListener('submit', async ev => {
      ev.preventDefault();
      const falla = document.getElementById('falla').value.trim();
      const prop = document.getElementById('propuesta').value.trim();
      const cant = parseNum(document.getElementById('sol-cant').value);
      const err = document.getElementById('err-sol');
      if (!falla || !prop) { err.textContent = 'Completá la falla y la tarea propuesta.'; err.classList.remove('oculto'); return; }
      if (!(cant > 0)) { err.textContent = 'La cantidad tiene que ser mayor a cero.'; err.classList.remove('oculto'); return; }
      const elegido = opciones.get(prop);
      const btn = ev.target.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await Api.insert('solicitudes', {
          ot_id: ot.id, tarea_origen_id: tareaId ? Number(tareaId) : null, falla, cantidad: cant,
          tarea_propuesta: elegido ? elegido.tarea : prop, tempario_id: elegido ? elegido.id : null
        });
        toast('Solicitud enviada a Oficina');
        ir('#/mis-solicitudes');
      } catch (e) { err.textContent = errMsg(e); err.classList.remove('oculto'); btn.disabled = false; }
    });
  }, ['MECANICO']);

  // ---------------- Pedir una OT nueva (la acepta el Administrador) ----------------
  ruta(/^#\/pedir-ot$/, async main => {
    const clientes = await Api.select('clientes', { select: 'id,nombre', order: 'nombre' });
    const s = { unidad: null, tipo: '', tareas: [], repuestos: [], temp: [] };

    main.innerHTML = `
      <div class="encabezado"><div><h1>Pedir OT nueva</h1>
        <div class="sub">Cargá todo lo que sepas. La OT se crea cuando el Administrador la acepta.</div></div></div>
      <form id="f-pedir">
        <section class="tarjeta"><h2>Vehículo</h2>
          <div class="campo"><label for="q-unidad" class="obligatorio">Dominio</label>
            <input id="q-unidad" placeholder="Escribí dominio, INT o chasis" autocapitalize="characters"></div>
          <div id="q-datos-unidad" class="nota" style="margin:-4px 0 10px"></div>
          <div class="campo"><label for="q-cliente">Cliente</label><select id="q-cliente">
            <option value="">Todos los clientes</option>${clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}</select></div>
          <label class="check" style="margin-bottom:10px"><input type="checkbox" id="q-nueva"> La unidad no está en la lista</label>
          <div class="campo oculto" id="q-texto-caja"><label for="q-texto" class="obligatorio">Describí la unidad</label>
            <input id="q-texto" placeholder="Cliente, dominio, marca y modelo"></div>
          <div class="fila-campos">
            <div class="campo"><label for="q-tipo" class="obligatorio">Tipo de unidad</label><select id="q-tipo">
              <option value="">Elegí…</option>${TIPOS.map(t => `<option>${t}</option>`).join('')}</select></div>
            <div class="campo"><label for="q-km" class="obligatorio">KM</label><input id="q-km" inputmode="numeric" autocomplete="off"></div>
          </div>
        </section>
        <section class="tarjeta"><h2>Trabajos</h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
            <input id="q-tarea" list="dl-q-tareas" placeholder="Elegí primero el tipo de unidad" autocomplete="off" disabled style="flex:3 1 220px">
            <datalist id="dl-q-tareas"></datalist>
            <input id="q-tarea-cant" value="1" inputmode="decimal" aria-label="Cantidad" style="flex:0 0 80px;text-align:center">
            <button class="btn" type="button" data-accion="agregar-tarea">Agregar</button></div>
          <div class="nota" style="margin-bottom:8px">Cantidad: por ejemplo 2 si la tarea es "por lado" y se hacen los dos lados.</div>
          <div id="q-tareas"></div>
        </section>
        <section class="tarjeta"><h2>Repuestos <span class="nota">(opcional)</span></h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
            <input id="q-rep" placeholder="Código o descripción" style="flex:3 1 220px">
            <input id="q-rep-cant" value="1" inputmode="decimal" aria-label="Cantidad" style="flex:0 0 80px;text-align:center">
            <button class="btn" type="button" data-accion="agregar-rep">Agregar</button></div>
          <div id="q-reps"></div>
        </section>
        <section class="tarjeta">
          <div class="campo"><label for="q-obs">Observaciones</label><textarea id="q-obs"></textarea></div>
          <div class="error-box oculto" id="q-error"></div>
          <button class="btn btn-primario btn-grande" type="submit">Enviar al Administrador</button>
        </section>
      </form>`;
    const $ = id => document.getElementById(id);
    const pintarTareas = () => {
      $('q-tareas').innerHTML = s.tareas.length ? s.tareas.map((t, i) => `<div class="repuesto-fila">
        <div class="info"><div class="desc">${esc(t.descripcion)} <span style="color:var(--gris)">× ${num(t.cantidad)}</span></div>
          <div class="cod">${t.tempario_id ? esc(t.categoria) + ' · ' + num(t.horas) + ' h c/u' : 'A mano · el Administrador pone las horas'}</div></div>
        <button class="btn btn-chico" type="button" data-quitar-t="${i}">Quitar</button></div>`).join('')
        : '<div class="vacio">Sin trabajos todavía.</div>';
    };
    const pintarReps = () => {
      $('q-reps').innerHTML = s.repuestos.length ? s.repuestos.map((r, i) => `<div class="repuesto-fila">
        <div class="info"><div class="desc">${esc(r.descripcion)} <span style="color:var(--gris)">× ${num(r.cantidad)}</span></div>
          <div class="cod">Cód. ${esc(r.codigo)} · stock ${num(r.disponible)}</div>
          ${r.cantidad > r.disponible ? `<div class="nota" style="color:var(--rojo)">No alcanza el stock: ${r.disponible > 0 ? 'se carga lo que hay y el resto ' : ''}se le pide a Depósito al crear la OT.</div>` : ''}</div>
        <button class="btn btn-chico" type="button" data-quitar-r="${i}">Quitar</button></div>`).join('')
        : '<div class="vacio">Sin repuestos.</div>';
    };
    pintarTareas(); pintarReps();
    const cargarTempario = async () => {
      const inp = $('q-tarea');
      if (!s.tipo) { inp.disabled = true; $('dl-q-tareas').innerHTML = ''; return; }
      s.temp = await Api.select('tempario', { select: 'id,tarea,horas,categoria:categorias_tempario(nombre)', tipo: 'eq.' + s.tipo, activo: 'is.true', order: 'tarea' });
      $('dl-q-tareas').innerHTML = s.temp.map(x => `<option value="${esc(x.tarea + ' · ' + (x.categoria ? x.categoria.nombre : ''))}">${num(x.horas)} h</option>`).join('');
      inp.disabled = false; inp.placeholder = 'Buscá en el tempario o escribila';
    };
    const elegirUnidad = async u => {
      s.unidad = u;
      $('q-unidad').value = u ? u.dominio : '';
      if (u) $('q-cliente').value = String(u.cliente_id);
      $('q-datos-unidad').textContent = u ? [u.cliente && u.cliente.nombre, u.interno && 'INT ' + u.interno,
        [u.marca && u.marca.nombre, u.modelo && u.modelo.nombre].filter(Boolean).join(' ')].filter(Boolean).join(' · ') : '';
      if (u && u.tipo && !s.tareas.length) { $('q-tipo').value = u.tipo; s.tipo = u.tipo; await cargarTempario(); }
    };
    const bUnidad = autocompletarUnidad($('q-unidad'), {
      clienteId: () => $('q-cliente').value,
      alElegir: u => elegirUnidad(u),
      alEscribir: () => { if (s.unidad) { s.unidad = null; $('q-datos-unidad').textContent = ''; } }
    });
    // Enter en el dominio no envía el pedido.
    $('q-unidad').addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.defaultPrevented) ev.preventDefault(); });
    $('q-cliente').addEventListener('change', ev => {
      bUnidad.olvidar();
      if (s.unidad && String(s.unidad.cliente_id) !== ev.target.value) elegirUnidad(null);
    });
    $('q-nueva').addEventListener('change', ev => {
      $('q-texto-caja').classList.toggle('oculto', !ev.target.checked);
      $('q-unidad').disabled = ev.target.checked;
      if (ev.target.checked) { elegirUnidad(null); $('q-texto').focus(); }
    });
    $('q-tipo').addEventListener('change', async ev => {
      if (s.tareas.some(t => t.tempario_id) && ev.target.value !== s.tipo) {
        const ok = await confirmar('Cambiar el tipo de unidad quita las tareas del tempario ya agregadas. ¿Seguir?');
        if (!ok) { ev.target.value = s.tipo; return; }
        s.tareas = s.tareas.filter(t => !t.tempario_id); pintarTareas();
      }
      s.tipo = ev.target.value; await cargarTempario();
    });
    const agregarTarea = () => {
      const texto = $('q-tarea').value.trim();
      const cant = parseNum($('q-tarea-cant').value);
      if (!texto) return;
      if (!(cant > 0)) return toast('La cantidad tiene que ser mayor a cero', 'error');
      const x = s.temp.find(y => `${y.tarea} · ${y.categoria ? y.categoria.nombre : ''}` === texto)
        || s.temp.filter(y => y.tarea.toUpperCase() === texto.toUpperCase()).find((y, i, arr) => arr.length === 1);
      s.tareas.push(x ? { tempario_id: x.id, descripcion: x.tarea, horas: Number(x.horas), cantidad: cant, categoria: x.categoria ? x.categoria.nombre : '' }
                      : { descripcion: texto, cantidad: cant });
      $('q-tarea').value = ''; $('q-tarea-cant').value = '1'; pintarTareas(); $('q-tarea').focus();
    };
    let repElegido = null;
    autocompletarRepuesto($('q-rep'), { alElegir: r => { repElegido = r; $('q-rep-cant').focus(); $('q-rep-cant').select(); },
                                       alEscribir: () => { repElegido = null; } });
    const agregarRep = async () => {
      const cant = parseNum($('q-rep-cant').value);
      const texto = $('q-rep').value.trim();
      if (!texto) return;
      if (!(cant > 0)) return toast('La cantidad tiene que ser mayor a cero', 'error');
      let r = repElegido;
      if (!r) { try { r = (await Api.rpc('consultar_stock', { p_codigo: texto }))[0]; } catch (e) { r = null; } }
      if (!r) return toast('Elegí el repuesto de la lista. Si no está, anotalo en Observaciones.', 'error');
      s.repuestos.push({ codigo: r.codigo, descripcion: r.descripcion, cantidad: cant, disponible: Number(r.disponible) });
      repElegido = null; $('q-rep').value = ''; $('q-rep-cant').value = '1'; pintarReps(); $('q-rep').focus();
    };
    on(main, 'click', '[data-accion=agregar-tarea]', agregarTarea);
    on(main, 'click', '[data-accion=agregar-rep]', agregarRep);
    $('q-tarea').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); agregarTarea(); } });
    $('q-rep-cant').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); agregarRep(); } });
    $('q-rep').addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.defaultPrevented) { ev.preventDefault(); agregarRep(); } });
    $('q-tarea-cant').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); agregarTarea(); } });
    on(main, 'click', '[data-quitar-t]', (ev, b) => { s.tareas.splice(Number(b.dataset.quitarT), 1); pintarTareas(); });
    on(main, 'click', '[data-quitar-r]', (ev, b) => { s.repuestos.splice(Number(b.dataset.quitarR), 1); pintarReps(); });
    $('f-pedir').addEventListener('submit', async ev => {
      ev.preventDefault();
      const err = $('q-error');
      const nueva = $('q-nueva').checked;
      const falta = [];
      if (!nueva && !s.unidad && $('q-unidad').value.trim()) {
        const u = await unidadExacta($('q-unidad').value, $('q-cliente').value).catch(() => null);
        if (u) await elegirUnidad(u);
      }
      if (!nueva && !s.unidad) falta.push('dominio (elegilo de la lista)');
      if (nueva && !$('q-texto').value.trim()) falta.push('descripción de la unidad');
      if (!$('q-tipo').value) falta.push('tipo de unidad');
      const km = parseInt(String($('q-km').value).replace(/\D/g, ''), 10);
      if (isNaN(km)) falta.push('KM');
      if (!s.tareas.length && !s.repuestos.length) falta.push('al menos un trabajo o repuesto');
      if (falta.length) { err.textContent = 'Falta: ' + falta.join(', ') + '.'; err.classList.remove('oculto'); return; }
      err.classList.add('oculto');
      const btn = ev.target.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const cliente = clientes.find(c => String(c.id) === $('q-cliente').value);
        await Api.insert('solicitudes_de_ot', {
          mecanico_id: st.usuarioId,
          unidad_id: nueva ? null : s.unidad.id,
          unidad_texto: nueva ? [cliente ? cliente.nombre : '', $('q-texto').value.trim()].filter(Boolean).join(' · ') : null,
          km, tipo: $('q-tipo').value, observaciones: $('q-obs').value.trim() || null,
          tareas: s.tareas.map(t => t.tempario_id
            ? { tempario_id: t.tempario_id, descripcion: t.descripcion, horas: t.horas, cantidad: t.cantidad, categoria: t.categoria }
            : { descripcion: t.descripcion, cantidad: t.cantidad }),
          repuestos: s.repuestos.map(r => ({ codigo: r.codigo, descripcion: r.descripcion, cantidad: r.cantidad }))
        });
        toast('Pedido de OT enviado al Administrador');
        ir('#/mis-solicitudes');
      } catch (e) { err.textContent = errMsg(e); err.classList.remove('oculto'); btn.disabled = false; }
    });
  }, ['MECANICO']);

  // ---------------- Mis solicitudes ----------------
  ruta(/^#\/mis-solicitudes$/, async main => {
    const [sols, ots, pedidos] = await Promise.all([
      Api.select('solicitudes', { select: 'id,falla,tarea_propuesta,cantidad,estado,motivo_rechazo,creado_en,ot:ordenes_trabajo(numero)',
                                  mecanico_id: 'eq.' + st.usuarioId, order: 'creado_en.desc', limit: 30 }),
      Api.select('solicitudes_de_ot', { select: 'id,unidad_texto,km,tipo,tareas,repuestos,estado,motivo_rechazo,creado_en,unidad:unidades(dominio),ot:ordenes_trabajo(numero)',
                                        mecanico_id: 'eq.' + st.usuarioId, order: 'creado_en.desc', limit: 20 }),
      Api.select('pedidos_repuesto', { select: 'descripcion,codigo,cantidad,estado,nota,creado_en,ot:ordenes_trabajo(numero)',
                                       pedido_por: 'eq.' + st.usuarioId, order: 'creado_en.desc', limit: 20 })
    ]);
    const chip = e => e === 'APROBADA' ? '<span class="chip verde">Aceptada</span>' :
      e === 'RECHAZADA' ? '<span class="chip rojo">Rechazada</span>' : '<span class="chip">Pendiente</span>';
    main.innerHTML = `
      <div class="encabezado"><div><h1>Mis solicitudes</h1><div class="sub">Para pedir una tarea en una OT, entrá a una de tus tareas.</div></div>
        <div class="acciones"><a class="btn btn-primario" href="#/pedir-ot">Pedir OT nueva</a></div></div>
      <h2 style="margin:6px 0 10px">Pedidos de OT</h2>
      <div class="lista-tareas">${ots.length ? ots.map(s => `
        <div class="tarea-card">
          <div class="linea1"><span>${fechaHora(s.creado_en)} · ${esc(s.tipo)} · KM ${num(s.km, 0)}</span>${chip(s.estado)}</div>
          <div class="titulo">${esc(s.unidad ? s.unidad.dominio : s.unidad_texto)}</div>
          <div class="linea3">${s.tareas.length} trabajos · ${s.repuestos.length} repuestos${s.ot ? ' · se creó la <b>' + esc(nroOT(s.ot.numero)) + '</b>' : ''}</div>
          ${s.estado === 'RECHAZADA' ? `<div class="linea3"><b>Motivo:</b> ${esc(s.motivo_rechazo)}</div>` : ''}
        </div>`).join('') : '<div class="tarjeta vacio">No pediste OT.</div>'}</div>
      <h2 style="margin:20px 0 10px">Tareas pedidas</h2>
      <div class="lista-tareas">${sols.length ? sols.map(s => `
        <div class="tarea-card">
          <div class="linea1"><span>${esc(nroOT(s.ot ? s.ot.numero : ''))} · ${fechaHora(s.creado_en)}</span>${chip(s.estado)}</div>
          <div class="titulo">${esc(s.tarea_propuesta)}${Number(s.cantidad) !== 1 ? ' × ' + num(s.cantidad) : ''}</div>
          <div class="linea3">Falla: ${esc(s.falla)}</div>
          ${s.estado === 'RECHAZADA' ? `<div class="linea3"><b>Motivo:</b> ${esc(s.motivo_rechazo)}</div>` : ''}
        </div>`).join('') : '<div class="tarjeta vacio">No pediste tareas.</div>'}</div>
      <h2 style="margin:20px 0 10px">Repuestos pedidos</h2>
      <div class="lista-tareas">${pedidos.length ? pedidos.map(p => `
        <div class="tarea-card">
          <div class="linea1"><span>${esc(nroOT(p.ot ? p.ot.numero : ''))} · ${fechaHora(p.creado_en)}</span>
            ${p.estado === 'RESUELTO' ? '<span class="chip verde">Ya está</span>' : '<span class="chip">Pedido</span>'}</div>
          <div class="titulo">${esc(p.descripcion)} × ${num(p.cantidad)}</div>
          ${p.codigo ? `<div class="linea3">Cód. ${esc(p.codigo)}</div>` : ''}
          ${p.nota ? `<div class="linea3">Depósito: ${esc(p.nota)}</div>` : ''}
        </div>`).join('') : '<div class="tarjeta vacio">No pediste repuestos.</div>'}</div>`;
  }, ['MECANICO']);
})();
