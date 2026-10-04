// MDE · Taller — pantallas del mecánico (celular).
(() => {
  const { st, esc, num, parseNum, nroOT, fechaHora, duracion, chipEstadoTarea, errMsg, toast, modal, confirmar,
          ICONOS, ruta, ir, on, navegar } = App;

  let pestana = 'pendientes';

  // ---------------- Mis tareas ----------------
  ruta(/^#\/tareas$/, async main => {
    const [asig, abiertos] = await Promise.all([
      Api.select('asignaciones', {
        select: 'terminada_en,tarea:tareas_ot(id,descripcion,horas,estado,renglon,' +
                'ot:ordenes_trabajo(id,numero,estado,tipo,unidad:unidades(dominio,interno),cliente:clientes(nombre)),' +
                'companeros:asignaciones(mecanico_id,usuario:usuarios(nombre)))',
        mecanico_id: 'eq.' + st.usuarioId
      }),
      Api.select('registros_tiempo', { select: 'tarea_id,inicio', mecanico_id: 'eq.' + st.usuarioId, fin: 'is.null' })
    ]);
    const corriendo = new Map(abiertos.map(r => [r.tarea_id, r.inicio]));
    const items = asig.filter(a => a.tarea && a.tarea.ot).map(a => {
      const t = a.tarea;
      const hecha = !!a.terminada_en || t.estado === 'HECHA';
      const otCerrada = ['CERRADA', 'PRUEBA'].includes(t.ot.estado);
      let grupo = 'pendientes';
      if (hecha) grupo = 'hechas';
      else if (corriendo.has(t.id)) grupo = 'curso';
      else if (otCerrada) grupo = 'ocultas';
      return { t, grupo, a };
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
          const estado = grupo === 'curso' ? '<span class="chip azul">En curso</span>' : chipEstadoTarea(grupo === 'hechas' ? 'HECHA' : t.estado);
          return `<a class="tarea-card ${grupo === 'curso' ? 'en-curso' : ''}" href="#/tarea/${t.id}">
            <div class="linea1"><span>${esc(nroOT(t.ot.numero))} · ${esc(t.ot.unidad ? t.ot.unidad.dominio : '')}</span>${estado}</div>
            <div class="titulo">${esc(t.descripcion)}</div>
            <div class="linea3">${esc(t.ot.cliente ? t.ot.cliente.nombre : '')} · ${esc(t.ot.tipo)} · Tempario ${num(t.horas)} h${otros.length ? ' · con ' + esc(otros.join(', ')) : ''}</div>
          </a>`;
        }).join('') : `<div class="tarjeta vacio">${pestana === 'pendientes' ? 'No tenés tareas pendientes.' : pestana === 'curso' ? 'No tenés tareas en curso.' : 'Todavía no terminaste tareas.'}</div>`}
      </div>`;
    on(main, 'click', '[data-p]', (ev, b) => { pestana = b.dataset.p; navegar(); });
  }, ['MECANICO']);

  // ---------------- Detalle de tarea ----------------
  ruta(/^#\/tarea\/(\d+)$/, async (main, id) => {
    const [tareas, registros, repuestos] = await Promise.all([
      Api.select('tareas_ot', {
        select: 'id,descripcion,horas,estado,ot_id,tempario(categoria:categorias_tempario(nombre)),' +
                'ot:ordenes_trabajo(id,numero,estado,tipo,km,observaciones,unidad:unidades(dominio,interno,chasis,marca:marcas(nombre),modelo:modelos(nombre)),cliente:clientes(nombre)),' +
                'asignaciones(mecanico_id,terminada_en,usuario:usuarios(nombre))',
        id: 'eq.' + id
      }),
      Api.select('registros_tiempo', { select: 'inicio,fin', tarea_id: 'eq.' + id, mecanico_id: 'eq.' + st.usuarioId, order: 'inicio' }),
      Api.select('repuestos_ot', { select: 'id,codigo,cantidad,cargado_en,repuesto:repuestos(descripcion)', tarea_id: 'eq.' + id, order: 'id' })
    ]);
    const t = tareas[0];
    if (!t) { main.innerHTML = '<div class="tarjeta">No se encontró la tarea o no está asignada a vos.</div>'; return; }
    const ot = t.ot, u = ot.unidad || {};
    const mia = (t.asignaciones || []).find(a => a.mecanico_id === st.usuarioId);
    const otros = (t.asignaciones || []).filter(a => a.mecanico_id !== st.usuarioId);
    const abierto = registros.find(r => !r.fin);
    const terminadaYo = mia && mia.terminada_en;
    const otCerrada = ['CERRADA', 'PRUEBA'].includes(ot.estado);
    const acumulado = () => registros.reduce((s, r) => s + ((r.fin ? new Date(r.fin) : new Date()) - new Date(r.inicio)), 0);
    const categoria = t.tempario && t.tempario.categoria ? t.tempario.categoria.nombre : '';

    let botones = '';
    if (otCerrada) {
      botones = `<div class="aviso-box">La ${esc(nroOT(ot.numero))} está ${esc(ot.estado.toLowerCase())}: no se pueden hacer cambios.</div>`;
    } else if (!mia) {
      botones = '<div class="aviso-box">Esta tarea no está asignada a vos.</div>';
    } else if (terminadaYo) {
      botones = `<div class="ok-box">Terminaste tu parte de esta tarea.</div>
        <button class="btn" data-accion="iniciar">Reabrir y seguir trabajando</button>`;
    } else if (abierto) {
      botones = `<div class="botones-2"><button class="btn btn-grande" data-accion="pausar">Pausar</button>
        <button class="btn btn-verde btn-grande" data-accion="terminar">Terminar tarea</button></div>`;
    } else {
      botones = `<div class="botones-2"><button class="btn btn-primario btn-grande" data-accion="iniciar">${registros.length ? 'Reanudar' : 'Iniciar'}</button>
        <button class="btn btn-verde btn-grande" data-accion="terminar">Terminar tarea</button></div>`;
    }
    const editable = mia && !otCerrada;

    main.innerHTML = `
      <div class="cabecera-tarea">
        <a class="volver" href="#/tareas">${ICONOS.atras} Mis tareas</a>
        <div class="sub">${esc(nroOT(ot.numero))} · ${esc(ot.cliente ? ot.cliente.nombre : '')}${categoria ? ' · ' + esc(categoria) : ''}</div>
        <h1 style="margin:4px 0 10px">${esc(t.descripcion)}</h1>
        <div class="datos">
          <div class="dato"><div class="et">Dominio</div><div class="va">${esc(u.dominio)}</div></div>
          <div class="dato"><div class="et">INT</div><div class="va">${esc(u.interno || '—')}</div></div>
          <div class="dato"><div class="et">KM</div><div class="va">${num(ot.km, 0)}</div></div>
          <div class="dato"><div class="et">Tempario</div><div class="va">${num(t.horas)} h</div></div>
          <div class="dato"><div class="et">Unidad</div><div class="va">${esc([u.marca && u.marca.nombre, u.modelo && u.modelo.nombre].filter(Boolean).join(' ') || ot.tipo)}</div></div>
          ${otros.length ? `<div class="dato"><div class="et">Compañero</div><div class="va">${esc(otros.map(o => o.usuario && o.usuario.nombre).join(', '))}</div></div>` : ''}
        </div>
        ${ot.observaciones ? `<div class="sub" style="margin-top:10px">Obs.: ${esc(ot.observaciones)}</div>` : ''}
      </div>
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
              <div class="cod">Cód. ${esc(r.codigo)} · Cant. ${num(r.cantidad)}</div></div>
            ${editable ? `<button class="btn btn-chico" data-editar="${r.id}" data-cant="${r.cantidad}" aria-label="Modificar cantidad">${ICONOS.lapiz}</button>
              <button class="btn btn-chico btn-peligro" data-quitar="${r.id}" aria-label="Quitar repuesto">Quitar</button>` : ''}
          </div>`).join('') : '<div class="vacio">Todavía no cargaste repuestos en esta tarea.</div>'}
        ${editable && repuestos.length ? '<div class="nota">Si modificás o quitás un repuesto, se avisa a Oficina y Administración.</div>' : ''}
      </section>
      ${editable ? `<div style="display:flex;flex-direction:column;gap:8px">
        <a class="btn btn-primario btn-grande" href="#/escanear/${t.id}">${ICONOS.escanear} Escanear repuesto</a>
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
    on(main, 'click', '[data-accion=pausar]', () => accion('pausar_tarea', 'Tarea en pausa'));
    on(main, 'click', '[data-accion=terminar]', async () => {
      const ok = await confirmar('¿Terminaste tu parte de esta tarea? Se detiene el cronómetro.', { titulo: 'Terminar tarea', textoOk: 'Sí, terminar' });
      if (ok) accion('terminar_tarea', otros.length ? 'Listo. La tarea queda hecha cuando termine tu compañero.' : 'Tarea terminada');
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
      } catch (e) { toast(errMsg(e), 'error'); }
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
        <label for="codigo">O escribí el código</label>
        <div style="display:flex;gap:8px"><input id="codigo" autocomplete="off" autocapitalize="characters" spellcheck="false">
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
        res.innerHTML = `<div class="error-box">No existe un repuesto con el código <b>${esc(codigo)}</b>. Pedile a Depósito que lo cargue.</div>
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
        <button class="btn btn-primario btn-grande" data-accion="cargar" ${disp > 0 ? '' : 'disabled'}>Cargar a la tarea</button>
        ${disp > 0 ? '' : '<div class="nota" style="margin-top:8px">No hay stock: no se puede cargar.</div>'}
        <button class="btn" style="margin-top:8px;width:100%" data-accion="otro">Escanear otro</button>
      </section>`;
      res.dataset.codigo = r.codigo;
      res.dataset.disponible = disp;
      res.dataset.descripcion = r.descripcion;
    }

    async function iniciarCamara() {
      const cont = document.getElementById('camara');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        cont.innerHTML = '<div style="padding:16px;text-align:center">La cámara no está disponible. Escribí el código abajo.</div>';
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
        cont.innerHTML = `<div style="padding:16px;text-align:center">No se pudo usar la cámara${e && e.name === 'NotAllowedError' ? ' (permiso denegado)' : ''}. Escribí el código abajo.</div>`;
      }
    }

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
      if (c > disp) return mostrar(`No alcanza el stock: hay ${num(disp)} y pediste ${num(c)}.`);
      b.disabled = true;
      try {
        await Api.insert('repuestos_ot', { ot_id: t.ot_id, tarea_id: t.id, codigo: res.dataset.codigo, cantidad: c });
        toast(`Cargado: ${res.dataset.descripcion} × ${num(c)}`);
        ir('#/tarea/' + t.id);
      } catch (e) { mostrar(errMsg(e)); b.disabled = false; }
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
        <div class="error-box oculto" id="err-sol"></div>
        <button class="btn btn-primario btn-grande" type="submit">Enviar a Oficina</button>
      </form>`;
    document.getElementById('f-sol').addEventListener('submit', async ev => {
      ev.preventDefault();
      const falla = document.getElementById('falla').value.trim();
      const prop = document.getElementById('propuesta').value.trim();
      const err = document.getElementById('err-sol');
      if (!falla || !prop) { err.textContent = 'Completá la falla y la tarea propuesta.'; err.classList.remove('oculto'); return; }
      const elegido = opciones.get(prop);
      const btn = ev.target.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await Api.insert('solicitudes', {
          ot_id: ot.id, tarea_origen_id: tareaId ? Number(tareaId) : null, falla,
          tarea_propuesta: elegido ? elegido.tarea : prop, tempario_id: elegido ? elegido.id : null
        });
        toast('Solicitud enviada a Oficina');
        ir('#/mis-solicitudes');
      } catch (e) { err.textContent = errMsg(e); err.classList.remove('oculto'); btn.disabled = false; }
    });
  }, ['MECANICO']);

  // ---------------- Mis solicitudes ----------------
  ruta(/^#\/mis-solicitudes$/, async main => {
    const sols = await Api.select('solicitudes', {
      select: 'id,falla,tarea_propuesta,estado,motivo_rechazo,creado_en,ot:ordenes_trabajo(numero)',
      mecanico_id: 'eq.' + st.usuarioId, order: 'creado_en.desc', limit: 50 });
    const chip = e => e === 'APROBADA' ? '<span class="chip verde">Aprobada</span>' :
      e === 'RECHAZADA' ? '<span class="chip rojo">Rechazada</span>' : '<span class="chip">Pendiente</span>';
    main.innerHTML = `
      <div class="encabezado"><div><h1>Mis solicitudes</h1><div class="sub">Para pedir una tarea nueva, entrá a una de tus tareas.</div></div></div>
      <div class="lista-tareas">${sols.length ? sols.map(s => `
        <div class="tarea-card">
          <div class="linea1"><span>${esc(nroOT(s.ot ? s.ot.numero : ''))} · ${fechaHora(s.creado_en)}</span>${chip(s.estado)}</div>
          <div class="titulo">${esc(s.tarea_propuesta)}</div>
          <div class="linea3">Falla: ${esc(s.falla)}</div>
          ${s.estado === 'RECHAZADA' ? `<div class="linea3"><b>Motivo:</b> ${esc(s.motivo_rechazo)}</div>` : ''}
        </div>`).join('') : '<div class="tarjeta vacio">No enviaste solicitudes.</div>'}</div>`;
  }, ['MECANICO']);
})();
