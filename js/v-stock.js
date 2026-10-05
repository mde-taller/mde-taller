// MDE · Taller — stock y repuestos (Depósito, Administrador; Oficina solo consulta).
(() => {
  const { esc, num, parseNum, nroOT, fechaHora, tiene, esAdmin, limpiarCodigo, errMsg, toast, ruta, on, navegar } = App;

  let pestana = 'buscar', ultimaBusqueda = '';
  let lote = [{ codigo: '', cantidad: '', obs: '' }], loteRevisado = false, loteObsGeneral = '';

  // Busca repuestos por código (con o sin espacios). Devuelve Map codigo_limpio -> repuesto.
  async function buscarCodigos(codigos) {
    const limpios = [...new Set(codigos.map(limpiarCodigo).filter(Boolean))];
    const mapa = new Map();
    for (let i = 0; i < limpios.length; i += 100) {
      const parte = limpios.slice(i, i + 100).map(c => '"' + c.replace(/"/g, '') + '"').join(',');
      const filas = await Api.select('repuestos', { select: 'codigo,descripcion,codigo_limpio', codigo_limpio: 'in.(' + parte + ')' });
      for (const f of filas) mapa.set(f.codigo_limpio, f);
    }
    return mapa;
  }

  function parsePegado(texto) {
    return String(texto || '').split(/\r?\n/).map(l => l.split(/\t|;/).map(x => x.trim())).filter(c => c.some(Boolean));
  }

  let primeraVez = true;
  ruta(/^#\/stock$/, async main => {
    const edita = tiene('DEPOSITO') || esAdmin();
    const [pendientes, aEntregar] = await Promise.all([
      Api.select('pedidos_repuesto', { select: 'id', estado: 'eq.PENDIENTE' }),
      Api.select('repuestos_ot', { select: 'id', estado: 'eq.PENDIENTE' })]);
    if (!edita && !['buscar', 'movs', 'pedidos', 'entregar'].includes(pestana)) pestana = 'buscar';
    if (primeraVez && aEntregar.length) pestana = 'entregar';
    else if (primeraVez && pendientes.length) pestana = 'pedidos';
    primeraVez = false;
    const tabs = [['buscar', 'Buscar stock'], ['entregar', `Repuestos a entregar${aEntregar.length ? ' (' + aEntregar.length + ')' : ''}`],
                  ['pedidos', `Pedidos de repuestos${pendientes.length ? ' (' + pendientes.length + ')' : ''}`]]
      .concat(edita ? [['lote', 'Ingreso por lote'], ['ajuste', 'Ajuste o stock inicial'], ['nuevo', 'Nuevo repuesto']] : [])
      .concat([['movs', 'Movimientos']]);
    main.innerHTML = `
      <div class="encabezado"><div><h1>Stock y repuestos</h1>
        <div class="sub">${edita ? 'Las salidas se descuentan solas cuando se cargan repuestos en una OT.' : 'Consulta de stock.'}</div></div></div>
      <div class="pestanas">${tabs.map(([k, t]) => `<button class="pestana ${pestana === k ? 'activa' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>
      <div id="contenido"></div>`;
    on(main, 'click', '[data-tab]', (ev, b) => { pestana = b.dataset.tab; navegar(); });
    const cont = document.getElementById('contenido');

    // ---- Buscar ----
    if (pestana === 'buscar') {
      cont.innerHTML = `
        <form id="f-buscar" style="display:flex;gap:8px;margin-bottom:14px">
          <input id="b-texto" type="search" placeholder="Código o parte de la descripción" value="${esc(ultimaBusqueda)}" autocomplete="off">
          <button class="btn btn-primario" type="submit">Buscar</button></form>
        <div id="b-res"></div>`;
      const buscar = async () => {
        const txt = document.getElementById('b-texto').value.trim();
        ultimaBusqueda = txt;
        const res = document.getElementById('b-res');
        if (txt.length < 2) { res.innerHTML = '<div class="nota">Escribí al menos 2 letras o números.</div>'; return; }
        res.innerHTML = '<div class="vacio">Buscando…</div>';
        const limpio = txt.replace(/[,()*"]/g, ' ').trim();
        try {
          const [porTexto, porCodigo] = await Promise.all([
            Api.select('stock_disponible', { select: 'codigo,descripcion,stock_inicial,entradas,salidas,ajustes,disponible',
              or: `(codigo.ilike.*${limpio}*,descripcion.ilike.*${limpio}*)`, order: 'codigo', limit: 60 }),
            buscarCodigos([txt])
          ]);
          const exacto = [...porCodigo.values()][0];
          let filas = porTexto;
          if (exacto && !filas.some(f => f.codigo === exacto.codigo)) {
            filas = (await Api.select('stock_disponible', { select: 'codigo,descripcion,stock_inicial,entradas,salidas,ajustes,disponible',
                                                            codigo: 'eq.' + exacto.codigo })).concat(filas);
          }
          res.innerHTML = filas.length ? `<div class="tabla-caja"><table><thead><tr><th>Código</th><th>Repuesto</th><th class="num">Inicial</th>
            <th class="num">Entradas</th><th class="num">Salidas</th><th class="num">Ajustes</th><th class="num">Disponible</th></tr></thead><tbody>
            ${filas.map(f => `<tr><td>${esc(f.codigo)}</td><td>${esc(f.descripcion)}</td><td class="num">${num(f.stock_inicial)}</td>
              <td class="num">${num(f.entradas)}</td><td class="num">${num(f.salidas)}</td><td class="num">${num(f.ajustes)}</td>
              <td class="num"><b style="color:${Number(f.disponible) > 0 ? 'var(--verde)' : 'var(--rojo)'}">${num(f.disponible)}</b></td></tr>`).join('')}
            </tbody></table></div>${filas.length >= 60 ? '<div class="nota" style="margin-top:6px">Se muestran los primeros 60. Afiná la búsqueda.</div>' : ''}`
            : '<div class="tarjeta vacio">No se encontraron repuestos.</div>';
        } catch (e) { res.innerHTML = `<div class="error-box">${esc(errMsg(e))}</div>`; }
      };
      document.getElementById('f-buscar').addEventListener('submit', ev => { ev.preventDefault(); buscar(); });
      if (ultimaBusqueda) buscar();
      document.getElementById('b-texto').focus();
    }

    // ---- Ingreso por lote ----
    if (pestana === 'lote') {
      const pintar = () => {
        const ok = loteRevisado && lote.every(f => f.estado === 'ok');
        cont.innerHTML = `
          <section class="tarjeta"><h2>Ingreso de stock por lote</h2>
            <p class="nota">Cargá varias entradas juntas: escribilas en la tabla o pegá filas copiadas de un Excel (columnas: código, cantidad y, opcional, observación).</p>
            <div class="campo"><label for="l-obs">Observación para todo el lote (remito, proveedor)</label><input id="l-obs" value="${esc(loteObsGeneral)}"></div>
            <div class="tabla-caja"><table><thead><tr><th>#</th><th>Código</th><th class="num">Cantidad</th><th>Observación</th><th>Repuesto</th><th></th></tr></thead><tbody>
              ${lote.map((f, i) => `<tr class="${f.estado === 'ok' ? 'bien' : f.estado ? 'mal' : ''}"><td>${i + 1}</td>
                <td><input data-f="${i}" data-k="codigo" value="${esc(f.codigo)}" autocomplete="off" aria-label="Código fila ${i + 1}"></td>
                <td><input data-f="${i}" data-k="cantidad" value="${esc(f.cantidad)}" inputmode="decimal" autocomplete="off" style="max-width:110px;text-align:right" aria-label="Cantidad fila ${i + 1}"></td>
                <td><input data-f="${i}" data-k="obs" value="${esc(f.obs)}" autocomplete="off" aria-label="Observación fila ${i + 1}"></td>
                <td>${f.estado === 'ok' ? esc(f.descripcion) : f.estado ? `<span style="color:var(--rojo);font-weight:600">${esc(f.estado)}</span>` : ''}</td>
                <td><button class="btn-texto" data-quitar-fila="${i}" aria-label="Quitar fila ${i + 1}">Quitar</button></td></tr>`).join('')}
            </tbody></table></div>
            <div class="acciones" style="margin-top:10px"><button class="btn" data-accion="fila">+ Agregar fila</button>
              <button class="btn" data-accion="limpiar">Vaciar tabla</button></div>
            <details style="margin-top:14px"><summary style="cursor:pointer;font-weight:600">Pegar desde Excel</summary>
              <textarea id="l-pegar" placeholder="A9061800109	2	Remito 123" style="margin-top:8px"></textarea>
              <button class="btn" data-accion="pegar" style="margin-top:8px">Pasar a la tabla</button></details>
            <div class="acciones" style="margin-top:16px;justify-content:flex-end">
              <button class="btn" data-accion="revisar">Revisar</button>
              <button class="btn btn-primario" data-accion="guardar" ${ok ? '' : 'disabled'}>Guardar ingreso (${lote.length})</button></div>
            ${loteRevisado && !ok ? '<div class="error-box">Hay filas con problemas (en rojo). Corregilas y volvé a revisar.</div>' : ''}
          </section>`;
      };
      pintar();
      on(cont, 'input', '[data-f]', (ev, inp) => { lote[Number(inp.dataset.f)][inp.dataset.k] = inp.value; loteRevisado = false; });
      on(cont, 'input', '#l-obs', (ev, inp) => { loteObsGeneral = inp.value; });
      on(cont, 'click', '[data-accion=fila]', () => { lote.push({ codigo: '', cantidad: '', obs: '' }); loteRevisado = false; pintar(); });
      on(cont, 'click', '[data-accion=limpiar]', () => { lote = [{ codigo: '', cantidad: '', obs: '' }]; loteRevisado = false; pintar(); });
      on(cont, 'click', '[data-quitar-fila]', (ev, b) => { lote.splice(Number(b.dataset.quitarFila), 1); if (!lote.length) lote.push({ codigo: '', cantidad: '', obs: '' }); loteRevisado = false; pintar(); });
      on(cont, 'click', '[data-accion=pegar]', () => {
        const filas = parsePegado(document.getElementById('l-pegar').value)
          .filter(c => !isNaN(parseNum(c[1])))   // descarta encabezados
          .map(c => ({ codigo: c[0] || '', cantidad: c[1] || '', obs: c[2] || '' }));
        if (!filas.length) return toast('No se encontraron filas con código y cantidad', 'error');
        lote = lote.filter(f => f.codigo || f.cantidad).concat(filas);
        loteRevisado = false; pintar(); toast(`${filas.length} filas agregadas`);
      });
      on(cont, 'click', '[data-accion=revisar]', async () => {
        lote = lote.filter(f => f.codigo.trim() || String(f.cantidad).trim());
        if (!lote.length) { lote = [{ codigo: '', cantidad: '', obs: '' }]; pintar(); return; }
        try {
          const mapa = await buscarCodigos(lote.map(f => f.codigo));
          for (const f of lote) {
            const r = mapa.get(limpiarCodigo(f.codigo));
            const c = parseNum(f.cantidad);
            if (!f.codigo.trim()) f.estado = 'Falta el código';
            else if (!r) f.estado = 'El código no existe';
            else if (!(c > 0)) f.estado = 'Cantidad inválida';
            else { f.estado = 'ok'; f.descripcion = r.descripcion; f.codigoReal = r.codigo; }
          }
          loteRevisado = true; pintar();
        } catch (e) { toast(errMsg(e), 'error'); }
      });
      on(cont, 'click', '[data-accion=guardar]', async (ev, b) => {
        b.disabled = true;
        try {
          await Api.insert('movimientos_stock', lote.map(f => ({ tipo: 'ENTRADA', codigo: f.codigoReal, cantidad: parseNum(f.cantidad),
            observacion: (f.obs || loteObsGeneral || '').trim() || null })));
          toast(`Ingreso guardado: ${lote.length} repuestos`);
          lote = [{ codigo: '', cantidad: '', obs: '' }]; loteRevisado = false; loteObsGeneral = '';
          pestana = 'movs'; navegar();
        } catch (e) { toast(errMsg(e), 'error'); b.disabled = false; }
      });
    }

    // ---- Repuestos cargados en OT pendientes de entrega ----
    if (pestana === 'entregar') {
      const filas = await Api.select('repuestos_ot', {
        select: 'id,codigo,cantidad,cargado_en,repuesto:repuestos(descripcion),ot:ordenes_trabajo(id,numero,unidad:unidades(dominio,interno)),' +
                'tarea:tareas_ot(renglon,descripcion),cargador:usuarios!repuestos_ot_cargado_por_fkey(nombre)',
        estado: 'eq.PENDIENTE', order: 'cargado_en', limit: 300 });
      cont.innerHTML = `
        <p class="nota" style="margin-top:0">Repuestos cargados en las OT que todavía no se entregaron. El stock ya está descontado. Al marcarlos entregados, le llega el aviso a quien los cargó.</p>
        ${filas.length && edita ? `<div class="acciones" style="margin-bottom:10px">
          <label class="check"><input type="checkbox" id="e-todos"> Seleccionar todos</label>
          <button class="btn btn-verde" data-accion="entregar" disabled>Marcar entregados</button></div>` : ''}
        <div class="tabla-caja"><table><thead><tr>${edita ? '<th></th>' : ''}<th>Cargado</th><th>OT</th><th>Repuesto</th><th class="num">Cant.</th><th>Tarea</th><th>Cargó</th></tr></thead><tbody>
          ${filas.map(r => `<tr>${edita ? `<td><label class="check"><input type="checkbox" data-sel="${r.id}" aria-label="Seleccionar ${esc(r.codigo)}"></label></td>` : ''}
            <td>${fechaHora(r.cargado_en)}</td>
            <td>${r.ot ? `<a href="#/ot/${r.ot.id}">${esc(nroOT(r.ot.numero))}</a><div class="nota">${esc(r.ot.unidad ? r.ot.unidad.dominio + (r.ot.unidad.interno ? ' · INT ' + r.ot.unidad.interno : '') : '')}</div>` : ''}</td>
            <td><b>${esc(r.repuesto ? r.repuesto.descripcion : '')}</b><div class="nota">${esc(r.codigo)}</div></td>
            <td class="num">${num(r.cantidad)}</td>
            <td>${r.tarea ? '#' + r.tarea.renglon + ' ' + esc(r.tarea.descripcion) : '—'}</td>
            <td>${esc(r.cargador ? r.cargador.nombre : '')}</td></tr>`).join('')
            || `<tr><td colspan="7" class="vacio">No hay repuestos pendientes de entrega.</td></tr>`}
        </tbody></table></div>`;
      const boton = cont.querySelector('[data-accion=entregar]');
      const actualizar = () => {
        const n = cont.querySelectorAll('[data-sel]:checked').length;
        if (boton) { boton.disabled = !n; boton.textContent = n ? `Marcar entregados (${n})` : 'Marcar entregados'; }
      };
      on(cont, 'change', '[data-sel]', actualizar);
      on(cont, 'change', '#e-todos', (ev, cb) => { cont.querySelectorAll('[data-sel]').forEach(x => { x.checked = cb.checked; }); actualizar(); });
      if (boton) boton.addEventListener('click', async () => {
        const ids = [...cont.querySelectorAll('[data-sel]:checked')].map(x => Number(x.dataset.sel));
        boton.disabled = true;
        try { const n = await Api.rpc('entregar_repuestos', { p_ids: ids }); toast(`${n} repuesto${n === 1 ? '' : 's'} entregado${n === 1 ? '' : 's'}`); navegar(); }
        catch (e) { toast(errMsg(e), 'error'); boton.disabled = false; }
      });
    }

    // ---- Pedidos de repuestos de los mecánicos ----
    if (pestana === 'pedidos') {
      const pedidos = await Api.select('pedidos_repuesto', {
        select: 'id,descripcion,codigo,cantidad,estado,nota,creado_en,resuelto_en,ot:ordenes_trabajo(id,numero,unidad:unidades(dominio)),' +
                'pedidor:usuarios!pedidos_repuesto_pedido_por_fkey(nombre),resolvio:usuarios!pedidos_repuesto_resuelto_por_fkey(nombre)',
        order: 'estado.asc,creado_en.desc', limit: 80 });
      const codigos = [...new Set(pedidos.filter(p => p.codigo && p.estado === 'PENDIENTE').map(p => p.codigo))];
      const stock = codigos.length ? await Api.select('stock_disponible', { select: 'codigo,disponible',
        codigo: 'in.(' + codigos.map(c => '"' + c.replace(/"/g, '') + '"').join(',') + ')' }) : [];
      const disp = new Map(stock.map(x => [x.codigo, Number(x.disponible)]));
      const pend = pedidos.filter(p => p.estado === 'PENDIENTE'), hechos = pedidos.filter(p => p.estado !== 'PENDIENTE').slice(0, 30);
      cont.innerHTML = `
        <p class="nota" style="margin-top:0">Los piden los mecánicos al pausar una OT por falta de repuesto. Cuando lo tengas, marcalo como resuelto: le llega el aviso al mecánico.</p>
        <div class="tabla-caja" style="margin-bottom:20px"><table><thead><tr><th>Pedido</th><th>Repuesto</th><th class="num">Cant.</th><th class="num">Stock</th><th>OT</th><th>Pidió</th>${edita ? '<th></th>' : ''}</tr></thead><tbody>
          ${pend.map(p => `<tr><td>${fechaHora(p.creado_en)}</td>
            <td><b>${esc(p.descripcion)}</b><div class="nota">${p.codigo ? esc(p.codigo) : 'No está en la lista: hay que conseguirlo'}</div></td>
            <td class="num">${num(p.cantidad)}</td>
            <td class="num">${p.codigo ? `<b style="color:${(disp.get(p.codigo) || 0) >= Number(p.cantidad) ? 'var(--verde)' : 'var(--rojo)'}">${num(disp.get(p.codigo) || 0)}</b>` : '—'}</td>
            <td>${p.ot ? `<a href="#/ot/${p.ot.id}">${esc(nroOT(p.ot.numero))}</a><div class="nota">${esc(p.ot.unidad ? p.ot.unidad.dominio : '')}</div>` : ''}</td>
            <td>${esc(p.pedidor ? p.pedidor.nombre : '')}</td>
            ${edita ? `<td><button class="btn btn-verde btn-chico" data-resolver="${p.id}">Resuelto</button></td>` : ''}</tr>`).join('')
            || `<tr><td colspan="7" class="vacio">No hay pedidos pendientes.</td></tr>`}
        </tbody></table></div>
        <h2 style="margin:0 0 10px">Resueltos</h2>
        <div class="tabla-caja"><table><thead><tr><th>Resuelto</th><th>Repuesto</th><th class="num">Cant.</th><th>OT</th><th>Pidió</th><th>Resolvió</th></tr></thead><tbody>
          ${hechos.map(p => `<tr><td>${fechaHora(p.resuelto_en)}</td><td>${esc(p.descripcion)}${p.nota ? `<div class="nota">${esc(p.nota)}</div>` : ''}</td>
            <td class="num">${num(p.cantidad)}</td><td>${p.ot ? esc(nroOT(p.ot.numero)) : ''}</td><td>${esc(p.pedidor ? p.pedidor.nombre : '')}</td>
            <td>${esc(p.resolvio ? p.resolvio.nombre : '')}</td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Sin pedidos resueltos.</td></tr>'}
        </tbody></table></div>`;
      on(cont, 'click', '[data-resolver]', async (ev, b) => {
        const p = pend.find(x => String(x.id) === b.dataset.resolver);
        const v = await App.modal({ titulo: 'Pedido resuelto', textoOk: 'Marcar resuelto',
          html: `<p><b>${esc(p.descripcion)}</b> × ${num(p.cantidad)} para ${esc(p.ot ? nroOT(p.ot.numero) : '')}</p>
                 <p class="nota">Si entró al depósito, cargalo antes en "Ingreso por lote" para que tenga stock.</p>`,
          campos: [{ id: 'nota', label: 'Nota para el mecánico (opcional)', valor: '' }] });
        if (!v) return;
        try { await Api.rpc('resolver_pedido_repuesto', { p_id: p.id, p_nota: v.nota.trim() || null }); toast('Pedido resuelto: se avisó al mecánico'); navegar(); }
        catch (e) { toast(errMsg(e), 'error'); }
      });
    }

    // ---- Ajuste / stock inicial ----
    if (pestana === 'ajuste') {
      cont.innerHTML = `<form id="f-ajuste" class="tarjeta" style="max-width:560px"><h2>Ajuste o stock inicial</h2>
        <div class="campo"><label for="a-tipo">Tipo</label><select id="a-tipo">
          <option value="AJUSTE">Ajuste (suma o resta: usá negativo para restar)</option>
          <option value="STOCK INICIAL">Stock inicial (se carga una sola vez por repuesto)</option></select></div>
        <div class="campo"><label for="a-cod" class="obligatorio">Código</label><input id="a-cod" placeholder="Código o descripción"></div>
        <div class="campo"><label for="a-cant" class="obligatorio">Cantidad</label><input id="a-cant" inputmode="decimal" autocomplete="off" placeholder="Ej.: 5  ó  -2"></div>
        <div class="campo"><label for="a-obs" class="obligatorio">Motivo</label><input id="a-obs" placeholder="Conteo, rotura, corrección…"></div>
        <div id="a-info"></div>
        <button class="btn btn-primario" type="submit">Guardar</button></form>`;
      App.autocompletarRepuesto(document.getElementById('a-cod'), { alElegir: () => document.getElementById('a-cant').focus() });
      document.getElementById('f-ajuste').addEventListener('submit', async ev => {
        ev.preventDefault();
        const tipo = document.getElementById('a-tipo').value;
        const cod = document.getElementById('a-cod').value.trim(), c = parseNum(document.getElementById('a-cant').value);
        const obs = document.getElementById('a-obs').value.trim();
        const info = document.getElementById('a-info');
        const mal = m => { info.innerHTML = `<div class="error-box">${esc(m)}</div>`; };
        if (!cod || isNaN(c) || !obs) return mal('Completá código, cantidad y motivo.');
        if (tipo === 'AJUSTE' && c === 0) return mal('El ajuste no puede ser cero.');
        if (tipo === 'STOCK INICIAL' && !(c > 0)) return mal('El stock inicial tiene que ser mayor a cero.');
        try {
          const r = (await Api.rpc('consultar_stock', { p_codigo: cod }))[0];
          if (!r) return mal('No existe un repuesto con ese código.');
          if (tipo === 'AJUSTE' && Number(r.disponible) + c < 0) return mal(`El ajuste deja el stock en negativo (hay ${num(r.disponible)}).`);
          if (tipo === 'STOCK INICIAL') {
            const previo = await Api.select('movimientos_stock', { select: 'id', codigo: 'eq.' + r.codigo, tipo: 'eq.STOCK INICIAL', limit: 1 });
            if (previo.length) return mal('Este repuesto ya tiene stock inicial. Usá un ajuste.');
          }
          await Api.insert('movimientos_stock', { tipo, codigo: r.codigo, cantidad: c, observacion: obs });
          toast(`Guardado. ${r.descripcion}: stock ${num(Number(r.disponible) + c)}`);
          ev.target.reset(); info.innerHTML = '';
        } catch (e) { mal(errMsg(e)); }
      });
    }

    // ---- Nuevo repuesto ----
    if (pestana === 'nuevo') {
      cont.innerHTML = `<form id="f-nuevo" class="tarjeta" style="max-width:560px"><h2>Nuevo repuesto</h2>
        <div class="campo"><label for="r-cod" class="obligatorio">Código (el mismo del código de barras)</label><input id="r-cod" autocomplete="off"></div>
        <div class="campo"><label for="r-desc" class="obligatorio">Descripción</label><input id="r-desc" autocomplete="off"></div>
        <div id="r-info"></div>
        <button class="btn btn-primario" type="submit">Guardar repuesto</button></form>`;
      document.getElementById('f-nuevo').addEventListener('submit', async ev => {
        ev.preventDefault();
        const cod = document.getElementById('r-cod').value.trim().toUpperCase(), desc = document.getElementById('r-desc').value.trim().toUpperCase();
        const info = document.getElementById('r-info');
        if (!cod || !desc) { info.innerHTML = '<div class="error-box">Completá código y descripción.</div>'; return; }
        try {
          const existe = await buscarCodigos([cod]);
          if (existe.size) { info.innerHTML = `<div class="error-box">Ya existe: ${esc([...existe.values()][0].codigo)} · ${esc([...existe.values()][0].descripcion)}</div>`; return; }
          await Api.insert('repuestos', { codigo: cod, descripcion: desc });
          toast('Repuesto agregado'); ev.target.reset(); info.innerHTML = '';
        } catch (e) { info.innerHTML = `<div class="error-box">${esc(errMsg(e))}</div>`; }
      });
    }

    // ---- Movimientos ----
    if (pestana === 'movs') {
      const movs = await Api.select('movimientos_stock', {
        select: 'fecha,tipo,codigo,cantidad,observacion,usuario_nombre,usuario:usuarios(nombre),ot:ordenes_trabajo(id,numero),repuesto:repuestos(descripcion)',
        order: 'fecha.desc', limit: 80 });
      cont.innerHTML = `<div class="tabla-caja"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Código</th><th>Repuesto</th><th class="num">Cantidad</th><th>OT</th><th>Usuario</th><th>Observación</th></tr></thead><tbody>
        ${movs.map(m => `<tr><td>${fechaHora(m.fecha)}</td><td><span class="chip ${m.tipo === 'SALIDA' ? 'ambar' : m.tipo === 'ENTRADA' ? 'verde' : ''}">${esc(m.tipo)}</span></td>
          <td>${esc(m.codigo)}</td><td>${esc(m.repuesto ? m.repuesto.descripcion : '')}</td>
          <td class="num">${m.tipo === 'SALIDA' ? '−' : ''}${num(m.cantidad)}</td><td>${m.ot ? `<a href="#/ot/${m.ot.id}">${esc(nroOT(m.ot.numero))}</a>` : ''}</td>
          <td>${esc(m.usuario ? m.usuario.nombre : (m.usuario_nombre || ''))}</td><td>${esc(m.observacion || '')}</td></tr>`).join('')
          || '<tr><td colspan="8" class="vacio">Sin movimientos.</td></tr>'}</tbody></table></div>
        <div class="nota" style="margin-top:6px">Últimos 80 movimientos.</div>`;
    }
  }, ['DEPOSITO', 'ADMINISTRADOR', 'OFICINA']);
})();
