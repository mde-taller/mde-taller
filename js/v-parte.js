// MDE · Taller — Parte diario (Oficina y Administrador): OT activas, esperando repuestos,
// unidades en trabajo y cuánto hace que cada unidad está en el taller, con semáforo.
(() => {
  const { st, esc, nroOT, chipEstadoOT, duracionTexto, errMsg, toast, esAdmin, ruta, on } = App;

  const H24 = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  const hora = d => new Date(d).toLocaleTimeString('es-AR', H24);
  const fechaCorta = d => new Date(d).toLocaleString('es-AR', Object.assign({ day: '2-digit', month: '2-digit' }, H24)).replace(',', '');
  const fd = s => s ? s.split('-').reverse().join('/') : '';
  const minDesde = d => (Date.now() - new Date(d).getTime()) / 60000;
  let orden = 'antigua';   // 'antigua': de la más antigua a la más nueva; 'nueva': al revés
  try { orden = localStorage.getItem('mde-parte-orden') === 'nueva' ? 'nueva' : 'antigua'; } catch (e) { /* sin almacenamiento */ }
  // Filtro de estado: 'ACTIVAS' (todas las activas) o un estado puntual.
  const ACTIVOS = ['ABIERTA', 'EN DIAGNÓSTICO', 'EN REPARACIÓN', 'ESPERANDO REPUESTOS'];
  const FILTROS = [['ACTIVAS', 'Todas las activas'], ...ACTIVOS.map(e => [e, e.charAt(0) + e.slice(1).toLowerCase()]),
    ['FINALIZADA', 'Finalizadas'], ['FACTURADA', 'Facturadas'], ['CERRADA', 'Cerradas']];
  let filtro = 'ACTIVAS';
  try { const f = localStorage.getItem('mde-parte-estado'); if (FILTROS.some(([v]) => v === f)) filtro = f; } catch (e) { /* sin almacenamiento */ }
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

  const NIVELES = {
    verde: { clase: 'sem-verde', texto: 'En tiempo' },
    amarillo: { clase: 'sem-amarillo', texto: 'Atención' },
    rojo: { clase: 'sem-rojo', texto: 'Demorada' }
  };

  function paginaImpresion() {
    const s = document.createElement('style');
    s.textContent = '@media print { @page { size: A4 portrait; margin: 10mm; } }';
    document.head.appendChild(s);
    st.limpiar.push(() => s.remove());
  }

  // Qué está pasando ahora con la OT.
  function ahora(o) {
    if (o.salida) return `<div class="parte-ahora quieta"><b>${o.estado === 'CERRADA' ? 'Cerrada' : o.estado === 'FACTURADA' ? 'Facturada' : 'Finalizada'}</b>
      <div class="nota">${esc(fd(o.fecha_salida))}${o.hora_salida ? ' ' + esc(o.hora_salida.slice(0, 5)) : ''}</div></div>`;
    if (o.trabajando) return `<div class="parte-ahora trabajo"><b>Trabajando:</b> ${esc(o.trabajando)}</div>`;
    if (o.pausa) return `<div class="parte-ahora pausa"><b>Pausada:</b> ${esc(o.pausa.motivo)}${o.pausa.detalle ? ' · ' + esc(o.pausa.detalle) : ''}
      <div class="nota">desde ${esc(fechaCorta(o.pausa.desde))} (${duracionTexto(minDesde(o.pausa.desde))})</div></div>`;
    if (o.estado === 'ESPERANDO REPUESTOS') return `<div class="parte-ahora pausa"><b>Esperando repuestos</b></div>`;
    return `<div class="parte-ahora quieta">Sin trabajo en este momento
      <div class="nota">${o.ultimo_trabajo ? 'último trabajo ' + esc(fechaCorta(o.ultimo_trabajo)) : 'todavía no se trabajó'}</div></div>`;
  }
  function repuestosTexto(o) {
    const p = [];
    if (o.pedidos_pendientes) p.push(plural(o.pedidos_pendientes, 'pedido a Depósito', 'pedidos a Depósito'));
    if (o.repuestos_sin_entregar) p.push(plural(o.repuestos_sin_entregar, 'repuesto sin entregar', 'repuestos sin entregar'));
    return p.length ? `<div class="nota">${p.join(' · ')}</div>` : '';
  }

  ruta(/^#\/parte-diario$/, async main => {
    paginaImpresion();
    main.innerHTML = '<div class="vacio">Cargando…</div>';
    let datos = null, otras = null;   // otras: OT del estado elegido cuando no es uno activo

    const pintar = () => {
      const amarillo = Number(datos.dias_amarillo) || 3, rojo = Number(datos.dias_rojo) || 7;
      const nivel = dias => dias >= rojo ? 'rojo' : dias >= amarillo ? 'amarillo' : 'verde';
      const preparar = l => l.map(o => {
        const min = o.salida ? (new Date(o.salida) - new Date(o.ingreso)) / 60000 : minDesde(o.ingreso);
        return Object.assign({}, o, { min, nivel: nivel(min / 1440) });
      }).sort((a, b) => orden === 'nueva' ? new Date(b.ingreso) - new Date(a.ingreso) : new Date(a.ingreso) - new Date(b.ingreso));
      const ots = preparar(datos.ots);
      const lista = filtro === 'ACTIVAS' ? ots : ACTIVOS.includes(filtro) ? ots.filter(o => o.estado === filtro) : preparar((otras && otras.ots) || []);
      const textoFiltro = (FILTROS.find(([v]) => v === filtro) || [])[1] || '';
      const cerradas = !ACTIVOS.includes(filtro) && filtro !== 'ACTIVAS';
      const porEstado = e => ots.filter(o => o.estado === e).length;
      const esperando = ots.filter(o => o.estado === 'ESPERANDO REPUESTOS');
      const enTrabajo = ots.filter(o => o.trabajando);
      const pausadas = ots.filter(o => o.pausa);
      const pedidos = ots.reduce((a, o) => a + Number(o.pedidos_pendientes || 0), 0);
      const sinEntregar = ots.reduce((a, o) => a + Number(o.repuestos_sin_entregar || 0), 0);
      const cuenta = { verde: 0, amarillo: 0, rojo: 0 };
      lista.forEach(o => { cuenta[o.nivel]++; });
      const detalleEstados = [['ABIERTA', 'abierta', 'abiertas'], ['EN DIAGNÓSTICO', 'en diagnóstico', 'en diagnóstico'],
        ['EN REPARACIÓN', 'en reparación', 'en reparación'], ['ESPERANDO REPUESTOS', 'esperando repuestos', 'esperando repuestos']]
        .map(([e, s1, s2]) => porEstado(e) ? `${porEstado(e)} ${porEstado(e) === 1 ? s1 : s2}` : '').filter(Boolean).join(' · ');
      const total = lista.length || 1;
      const promedio = lista.length ? lista.reduce((a, o) => a + o.min, 0) / lista.length : null;
      const fechaLarga = new Date(datos.ahora).toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

      main.innerHTML = `
        <div class="encabezado">
          <div><div class="informe-empresa">MDE Electromecánica</div><h1>Parte diario</h1>
            <div class="sub">${esc(fechaLarga.charAt(0).toUpperCase() + fechaLarga.slice(1))} · actualizado a las ${esc(hora(datos.ahora))}
              <span class="solo-imprimir">· emitido por ${esc(st.nombre)}</span></div></div>
          <div class="acciones no-imprimir">
            <button class="btn" data-accion="actualizar">Actualizar</button>
            <button class="btn btn-primario" data-accion="imprimir">Imprimir / PDF</button></div>
        </div>
        <section class="kpis">
          <div class="kpi"><div class="kpi-et">OT activas</div><div class="kpi-va">${ots.length}</div>
            <div class="kpi-sub">${detalleEstados || 'no hay OT abiertas'}</div></div>
          <div class="kpi"><div class="kpi-et">Esperando repuestos</div><div class="kpi-va">${esperando.length}</div>
            <div class="kpi-sub">${pedidos || sinEntregar ? [pedidos ? plural(pedidos, 'pedido a Depósito sin resolver', 'pedidos a Depósito sin resolver') : '', sinEntregar ? plural(sinEntregar, 'repuesto sin entregar', 'repuestos sin entregar') : ''].filter(Boolean).join(' · ') : 'sin pedidos pendientes'}</div></div>
          <div class="kpi"><div class="kpi-et">Unidades en trabajo ahora</div><div class="kpi-va">${enTrabajo.length}</div>
            <div class="kpi-sub">${plural(Number(datos.mecanicos_trabajando), 'mecánico con el cronómetro en marcha', 'mecánicos con el cronómetro en marcha')}${pausadas.length ? ' · ' + plural(pausadas.length, 'OT pausada', 'OT pausadas') : ''}</div></div>
          <div class="kpi"><div class="kpi-et">Hoy</div><div class="kpi-va">${datos.ingresaron_hoy} <span class="kpi-unidad">${datos.ingresaron_hoy === 1 ? 'ingresó' : 'ingresaron'}</span></div>
            <div class="kpi-sub">${plural(Number(datos.finalizadas_hoy), 'finalizada', 'finalizadas')}</div></div>
        </section>

        <section class="tarjeta">
          <div class="parte-semaforo-cab"><h2>Tiempo en el taller${filtro === 'ACTIVAS' ? '' : ' · ' + esc(textoFiltro)}</h2>
            <div class="nota">${promedio == null ? '' : 'Promedio: ' + duracionTexto(promedio)}</div></div>
          ${lista.length ? `<div class="sem-barra" role="img" aria-label="${cuenta.verde} en tiempo, ${cuenta.amarillo} en atención, ${cuenta.rojo} demoradas">
            ${['rojo', 'amarillo', 'verde'].filter(n => cuenta[n]).map(n => `<div class="${NIVELES[n].clase}" style="flex:${cuenta[n] / total}"><span>${cuenta[n]}</span></div>`).join('')}
          </div>` : ''}
          <div class="sem-leyenda">
            <span><i class="sem-k sem-rojo"></i><b>${cuenta.rojo}</b> Demoradas · ${rojo} días o más</span>
            <span><i class="sem-k sem-amarillo"></i><b>${cuenta.amarillo}</b> Atención · de ${amarillo} a ${rojo} días</span>
            <span><i class="sem-k sem-verde"></i><b>${cuenta.verde}</b> En tiempo · menos de ${amarillo} días</span>
          </div>
        </section>

        <section class="tarjeta parte-unidades">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
            <h2 style="margin:0">${cerradas ? 'OT ' + esc(textoFiltro.toLowerCase()) : 'Unidades en el taller'}${!cerradas && filtro !== 'ACTIVAS' ? ' · ' + esc(textoFiltro) : ''} (${lista.length}) <span class="nota" style="font-family:var(--texto);font-weight:400">· por fecha de ingreso, ${orden === 'nueva' ? 'de la más nueva a la más antigua' : 'de la más antigua a la más nueva'}</span></h2>
            <div class="no-imprimir" style="display:flex;gap:12px;flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:6px;font-weight:600">Estado
              <select id="p-estado" style="width:auto">${FILTROS.map(([v, t]) => `<option value="${v}" ${v === filtro ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
            <label style="display:flex;align-items:center;gap:6px;font-weight:600">Ordenar
              <select id="p-orden" style="width:auto">
                <option value="antigua" ${orden === 'antigua' ? 'selected' : ''}>Más antigua primero</option>
                <option value="nueva" ${orden === 'nueva' ? 'selected' : ''}>Más nueva primero</option>
              </select></label></div>
          </div>
          ${lista.length ? `
          <div class="tabla-caja parte-tabla"><table><thead><tr>
            <th style="min-width:150px">En el taller</th><th>OT</th><th>Interno</th><th>Patente</th><th>Cliente</th><th>Estado</th><th style="min-width:220px">Ahora</th><th class="num">Tareas</th><th>Mecánicos</th>
          </tr></thead><tbody>
            ${lista.map(o => `<tr class="clic ${NIVELES[o.nivel].clase}-fila" data-ir="${o.id}">
              <td><span class="sem-chip ${NIVELES[o.nivel].clase}">${duracionTexto(o.min)}</span><div class="nota">${NIVELES[o.nivel].texto}</div><div class="nota">ingresó ${esc(fd(o.fecha_ingreso).slice(0, 5))}${o.hora_ingreso ? ' ' + esc(o.hora_ingreso.slice(0, 5)) : ''}</div></td>
              <td style="white-space:nowrap"><b>${esc(nroOT(o.numero))}</b></td><td>${esc(o.interno || '')}</td>
              <td style="white-space:nowrap">${esc(o.dominio || '')}</td><td>${esc(o.cliente || '')}</td>
              <td>${chipEstadoOT(o.estado)}</td><td>${ahora(o)}${repuestosTexto(o)}</td>
              <td class="num" style="white-space:nowrap">${o.tareas_hechas}/${o.tareas}</td><td>${esc(o.mecanicos || '—')}</td></tr>`).join('')}
          </tbody></table></div>
          <div class="parte-lista">
            ${lista.map(o => `<a class="parte-card ${NIVELES[o.nivel].clase}-fila" href="#/ot/${o.id}">
              <div class="arriba"><span class="sem-chip ${NIVELES[o.nivel].clase}">${duracionTexto(o.min)}</span>
                <span class="nota">${NIVELES[o.nivel].texto}</span><span class="pc-ot">${esc(nroOT(o.numero))}</span></div>
              <div class="pc-unidad"><b>${esc(o.dominio || '')}</b>${o.interno ? ' · INT ' + esc(o.interno) : ''} · ${esc(o.cliente || '')}</div>
              <div class="pc-estado">${chipEstadoOT(o.estado)} <span class="nota">${o.tareas_hechas}/${o.tareas} tareas</span></div>
              ${ahora(o)}${repuestosTexto(o)}
            </a>`).join('')}
          </div>` : `<div class="vacio">${filtro === 'ACTIVAS' ? 'No hay unidades en el taller.' : 'No hay OT en ese estado.'}</div>`}
        </section>

        ${esAdmin() ? `<form id="p-colores" class="tarjeta no-imprimir">
          <h3>Colores del semáforo</h3>
          <div class="fila-campos" style="align-items:end">
            <div class="campo"><label for="p-amarillo">Amarillo desde (días)</label><input id="p-amarillo" type="number" min="1" step="1" value="${amarillo}"></div>
            <div class="campo"><label for="p-rojo">Rojo desde (días)</label><input id="p-rojo" type="number" min="2" step="1" value="${rojo}"></div>
            <div class="campo"><button class="btn" type="submit">Guardar</button></div>
          </div>
          <div class="nota">Solo el Administrador puede cambiarlos. Se aplican para todos.</div>
        </form>` : ''}
        <div class="nota informe-pie">"En el taller": desde la fecha y hora de ingreso de la OT hasta ahora. OT activas: abiertas, en diagnóstico, en reparación y esperando repuestos. La pantalla se actualiza sola cada minuto.</div>`;
    };

    const cargar = async () => {
      try {
        const necesitaOtras = !ACTIVOS.includes(filtro) && filtro !== 'ACTIVAS';
        [datos, otras] = await Promise.all([Api.rpc('parte_diario'), necesitaOtras ? Api.rpc('parte_diario', { p_estado: filtro }) : Promise.resolve(null)]);
        pintar();
      }
      catch (e) { if (!datos) main.innerHTML = `<div class="error-box">${esc(errMsg(e))}</div>`; else toast(errMsg(e), 'error'); }
    };
    await cargar();
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && !main.querySelector('#p-colores input:focus')) cargar(); }, 60000);
    st.limpiar.push(() => clearInterval(timer));

    on(main, 'click', '[data-accion=imprimir]', () => window.print());
    on(main, 'change', '#p-estado', (ev, sel) => {
      filtro = sel.value;
      try { localStorage.setItem('mde-parte-estado', filtro); } catch (e) { /* sin almacenamiento */ }
      cargar();
    });
    on(main, 'change', '#p-orden', (ev, sel) => {
      orden = sel.value === 'nueva' ? 'nueva' : 'antigua';
      try { localStorage.setItem('mde-parte-orden', orden); } catch (e) { /* sin almacenamiento */ }
      pintar();
    });
    on(main, 'click', '[data-accion=actualizar]', () => cargar());
    on(main, 'click', 'tr[data-ir]', (ev, tr) => { location.hash = '#/ot/' + tr.dataset.ir; });
    on(main, 'submit', '#p-colores', async ev => {
      ev.preventDefault();
      const a = parseInt(document.getElementById('p-amarillo').value, 10), r = parseInt(document.getElementById('p-rojo').value, 10);
      if (!(a >= 1) || !(r > a)) { toast('El rojo tiene que ser mayor que el amarillo', 'error'); return; }
      try {
        await Api.update('configuracion', { clave: 'eq.parte_dias_amarillo' }, { valor: String(a) });
        await Api.update('configuracion', { clave: 'eq.parte_dias_rojo' }, { valor: String(r) });
        toast('Colores guardados'); await cargar();
      } catch (e) { toast(errMsg(e), 'error'); }
    });
  }, ['ADMINISTRADOR', 'OFICINA']);
})();
