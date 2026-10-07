// MDE · Taller — plano de butacas (minibús 19+1): qué butaca se trabajó y qué se le hizo.
(() => {
  const { st, esc, num, nroOT, errMsg, toast, modal, esOficina, tiene, ICONOS, TRABAJOS_BUTACA,
          ordenButaca, nombreButaca, textoTrabajos, ruta, ir, on } = App;

  // Distribución (frente arriba): izquierda ventanilla y pasillo, derecha una por fila; última fila de 4.
  const COL = [26, 82, 138, 194];
  const FILA = r => 150 + (r - 1) * 66;
  const ASIENTOS = [{ id: 'COND', x: COL[0], y: 70, etiqueta: 'Cond.' }];
  for (let r = 1; r <= 5; r++) {
    const base = (r - 1) * 3;
    ASIENTOS.push({ id: String(base + 1), x: COL[0], y: FILA(r) }, { id: String(base + 2), x: COL[1], y: FILA(r) },
                  { id: String(base + 3), x: COL[3], y: FILA(r) });
  }
  ASIENTOS.push({ id: '16', x: COL[0], y: FILA(6) }, { id: '17', x: COL[1], y: FILA(6) },
                { id: '18', x: COL[2], y: FILA(6) }, { id: '19', x: COL[3], y: FILA(6) });

  function plano(marcadas, editable) {
    const asiento = a => {
      const m = marcadas.get(a.id);
      const etiqueta = a.etiqueta || a.id;
      return `<g class="butaca${m ? ' sel' : ''}" data-butaca="${a.id}" ${editable ? 'role="button" tabindex="0"' : ''}
          aria-label="${esc(nombreButaca(a.id))}${m ? ': ' + esc(textoTrabajos(m)) : ''}">
        <rect class="asiento" x="${a.x}" y="${a.y}" width="52" height="52" rx="9"/>
        <rect class="respaldo" x="${a.x + 4}" y="${a.y + 40}" width="44" height="9" rx="4"/>
        <text x="${a.x + 26}" y="${a.y + 29}" text-anchor="middle">${esc(etiqueta)}</text>
        ${m ? `<circle class="insignia" cx="${a.x + 48}" cy="${a.y + 4}" r="10"/><text class="insignia-n" x="${a.x + 48}" y="${a.y + 8}" text-anchor="middle">${m.length}</text>` : ''}
      </g>`;
    };
    return `<svg class="plano-butacas" viewBox="0 0 280 600" role="group" aria-label="Plano de butacas del minibús">
      <rect class="carroceria" x="8" y="8" width="264" height="584" rx="34"/>
      <rect class="parabrisas" x="30" y="20" width="220" height="12" rx="6"/>
      <text class="rotulo" x="140" y="52" text-anchor="middle">FRENTE</text>
      <circle class="volante" cx="52" cy="58" r="8"/>
      <line class="puerta" x1="268" y1="66" x2="268" y2="130"/>
      <text class="rotulo" x="236" y="102" text-anchor="middle">Puerta</text>
      ${ASIENTOS.map(asiento).join('')}
    </svg>`;
  }

  ruta(/^#\/butacas\/(\d+)$/, async (main, id) => {
    const [tareas, filas] = await Promise.all([
      Api.select('tareas_ot', { select: 'id,descripcion,cantidad,horas,ot_id,asignaciones(mecanico_id),ot:ordenes_trabajo(id,numero,estado,unidad:unidades(dominio,interno))', id: 'eq.' + id }),
      Api.select('butacas_tarea', { select: 'butaca,trabajos', tarea_id: 'eq.' + id })
    ]);
    const t = tareas[0];
    if (!t) { main.innerHTML = '<div class="tarjeta">No se encontró la tarea.</div>'; return; }
    const mia = (t.asignaciones || []).some(a => a.mecanico_id === st.usuarioId);
    const cerrada = ['CERRADA', 'PRUEBA'].includes(t.ot.estado);
    const editable = !cerrada && (mia || esOficina());
    const volver = mia && tiene('MECANICO') ? '#/tarea/' + t.id : '#/ot/' + t.ot_id;
    const marcadas = new Map(filas.map(f => [f.butaca, f.trabajos]));
    let cambios = false;

    main.innerHTML = `
      <a class="volver" href="${volver}">${ICONOS.atras} Volver</a>
      <h1 style="margin:4px 0">Butacas</h1>
      <div class="nota" style="margin-bottom:12px">${esc(nroOT(t.ot.numero))} · ${esc(t.ot.unidad ? t.ot.unidad.dominio : '')} · ${esc(t.descripcion)}</div>
      ${cerrada ? '<div class="aviso-box">La OT está cerrada: solo se puede ver.</div>' : ''}
      ${editable ? '<div class="nota" style="margin-bottom:10px">Tocá la butaca y marcá qué se le hizo. Cada butaca marcada suma 1 a la cantidad de la tarea.</div>' : ''}
      <div class="plano-caja" id="plano"></div>
      <section class="tarjeta" style="margin-top:12px">
        <h3 id="b-titulo"></h3>
        <div id="b-lista"></div>
      </section>
      ${editable ? `<div class="error-box oculto" id="b-error"></div>
        <button class="btn btn-primario btn-grande" data-accion="guardar" style="width:100%">Guardar butacas</button>` : ''}`;

    const pintar = () => {
      document.getElementById('plano').innerHTML = plano(marcadas, editable);
      const lista = [...marcadas.entries()].sort((a, b) => ordenButaca(a[0]) - ordenButaca(b[0]));
      document.getElementById('b-titulo').textContent = lista.length ? `Marcadas: ${lista.length}` : 'Sin butacas marcadas';
      document.getElementById('b-lista').innerHTML = lista.length ? lista.map(([b, tr]) => `<div class="repuesto-fila">
          <div class="info"><div class="desc">${esc(nombreButaca(b))}</div><div class="cod">${esc(textoTrabajos(tr))}</div></div>
          ${editable ? `<button class="btn btn-chico" data-butaca="${b}">Cambiar</button>` : ''}</div>`).join('')
        : `<div class="vacio">${editable ? 'Tocá una butaca en el plano para marcarla.' : 'No hay butacas marcadas.'}</div>`;
    };
    pintar();
    if (!editable) return;

    const elegir = async b => {
      const actual = marcadas.get(b) || [];
      const pendiente = modal({ titulo: nombreButaca(b), textoOk: 'Listo', textoCancelar: 'Cancelar',
        html: `<p class="nota" style="margin-top:0">Marcá lo que se le hizo. Si destildás todo, la butaca se quita.</p>
          <div class="opciones-motivo">${TRABAJOS_BUTACA.map(([v, l]) => `<label class="opcion"><input type="checkbox" data-trab="${esc(v)}" ${actual.includes(v) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>` });
      const checks = [...document.querySelectorAll('.modal [data-trab]')];
      if (!await pendiente) return;
      const elegidos = checks.filter(c => c.checked).map(c => c.dataset.trab);
      if (elegidos.length) marcadas.set(b, elegidos); else marcadas.delete(b);
      cambios = true;
      pintar();
    };
    on(main, 'click', '[data-butaca]', (ev, el) => elegir(el.dataset.butaca));
    on(main, 'keydown', 'g[data-butaca]', (ev, el) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); elegir(el.dataset.butaca); } });
    on(main, 'click', '[data-accion=guardar]', async (ev, btn) => {
      const err = document.getElementById('b-error');
      err.classList.add('oculto');
      btn.disabled = true;
      try {
        const n = await Api.rpc('guardar_butacas', { p_tarea_id: t.id,
          p_butacas: [...marcadas.entries()].map(([butaca, trabajos]) => ({ butaca, trabajos })) });
        toast(n ? `Butacas guardadas: ${n}. La tarea queda con cantidad ${num(n)}.` : 'Se quitaron las butacas');
        cambios = false;
        ir(volver);
      } catch (e) { err.textContent = errMsg(e); err.classList.remove('oculto'); btn.disabled = false; }
    });
    st.limpiar.push(() => { if (cambios) toast('Las butacas no se guardaron', 'error'); });
  }, ['MECANICO', 'OFICINA', 'ADMINISTRADOR']);
})();
