// MDE · Taller — administración: tempario, usuarios y reportes.
(() => {
  const { st, cfg, esc, num, parseNum, nroOT, fecha, hoyISO, errMsg, toast, modal, confirmar, TIPOS, ROLES, duracionTexto, ruta, on, navegar } = App;

  // ---------------- Tempario ----------------
  let fTipo = '', fCat = '', fTexto = '', vistaTemp = 'lista';
  let loteT = [], loteTRevisado = false, defTipo = 'PESADA', defCat = '';
  const normTipo = t => {
    const x = String(t || '').trim().toUpperCase().replace('Ú', 'U');
    return x === 'MINIBUS' ? 'MINIBÚS' : (x === 'LIVIANA' || x === 'PESADA') ? x : '';
  };
  const filaVacia = () => ({ tipo: '', categoria: '', tarea: '', horas: '' });

  ruta(/^#\/tempario$/, async main => {
    const [temp, cats] = await Promise.all([
      Api.select('tempario', { select: 'id,tipo,tarea,horas,activo,categoria_id,categoria:categorias_tempario(nombre)', order: 'tarea' }),
      Api.select('categorias_tempario', { select: 'id,nombre', order: 'nombre' })
    ]);
    if (!defCat && cats[0]) defCat = cats[0].nombre;
    main.innerHTML = `
      <div class="encabezado"><div><h1>Tempario</h1><div class="sub">${temp.length} tareas · lo que se carga acá queda disponible al instante para las OT</div></div></div>
      <div class="pestanas"><button class="pestana ${vistaTemp === 'lista' ? 'activa' : ''}" data-v="lista">Ver y editar</button>
        <button class="pestana ${vistaTemp === 'lote' ? 'activa' : ''}" data-v="lote">Agregar servicios (varios a la vez)</button></div>
      <div id="t-cont"></div>`;
    on(main, 'click', '[data-v]', (ev, b) => { vistaTemp = b.dataset.v; navegar(); });
    const cont = document.getElementById('t-cont');

    if (vistaTemp === 'lista') {
      cont.innerHTML = `
        <div class="fila-campos">
          <div class="campo"><label for="t-tipo">Tipo</label><select id="t-tipo"><option value="">Todos</option>${TIPOS.map(t => `<option ${t === fTipo ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="campo"><label for="t-cat">Categoría</label><select id="t-cat"><option value="">Todas</option>${cats.map(c => `<option value="${c.id}" ${String(c.id) === fCat ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></div>
          <div class="campo"><label for="t-texto">Buscar</label><input id="t-texto" type="search" value="${esc(fTexto)}" placeholder="Nombre de la tarea"></div>
        </div>
        <div class="tabla-caja"><table><thead><tr><th>Tipo</th><th>Categoría</th><th>Tarea</th><th class="num">Horas</th><th>Activa</th><th></th></tr></thead><tbody id="t-body"></tbody></table></div>
        <div class="nota" style="margin-top:6px">Una tarea inactiva no aparece al armar OT nuevas, pero queda en las OT anteriores.</div>`;
      const pintar = () => {
        const q = fTexto.trim().toUpperCase();
        const lista = temp.filter(t => (!fTipo || t.tipo === fTipo) && (!fCat || String(t.categoria_id) === fCat) && (!q || t.tarea.toUpperCase().includes(q)));
        document.getElementById('t-body').innerHTML = lista.map(t => `<tr${t.activo ? '' : ' style="opacity:.55"'}><td>${esc(t.tipo)}</td>
          <td>${esc(t.categoria ? t.categoria.nombre : '')}</td><td>${esc(t.tarea)}</td>
          <td class="num"><input data-horas="${t.id}" value="${String(t.horas).replace('.', ',')}" inputmode="decimal" style="max-width:90px;text-align:right" aria-label="Horas de ${esc(t.tarea)}"></td>
          <td><label class="check"><input type="checkbox" data-activo="${t.id}" ${t.activo ? 'checked' : ''}> <span class="oculto">Activa</span></label></td>
          <td><button class="btn-texto" data-editar="${t.id}">Editar</button></td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Sin resultados.</td></tr>';
      };
      pintar();
      document.getElementById('t-tipo').addEventListener('change', ev => { fTipo = ev.target.value; pintar(); });
      document.getElementById('t-cat').addEventListener('change', ev => { fCat = ev.target.value; pintar(); });
      document.getElementById('t-texto').addEventListener('input', ev => { fTexto = ev.target.value; pintar(); });
      on(cont, 'change', '[data-horas]', async (ev, inp) => {
        const h = parseNum(inp.value), t = temp.find(x => String(x.id) === inp.dataset.horas);
        if (!(h > 0)) { toast('Las horas tienen que ser mayores a cero', 'error'); inp.value = String(t.horas).replace('.', ','); return; }
        try { await Api.update('tempario', { id: 'eq.' + t.id }, { horas: h }); t.horas = h; toast('Horas actualizadas: ' + t.tarea); }
        catch (e) { toast(errMsg(e), 'error'); }
      });
      on(cont, 'change', '[data-activo]', async (ev, cb) => {
        const t = temp.find(x => String(x.id) === cb.dataset.activo);
        try { await Api.update('tempario', { id: 'eq.' + t.id }, { activo: cb.checked }); t.activo = cb.checked; pintar(); }
        catch (e) { toast(errMsg(e), 'error'); cb.checked = !cb.checked; }
      });
      on(cont, 'click', '[data-editar]', async (ev, b) => {
        const t = temp.find(x => String(x.id) === b.dataset.editar);
        const v = await modal({ titulo: 'Editar tarea', textoOk: 'Guardar', campos: [
          { id: 'tipo', label: 'Tipo', tipo: 'select', opciones: TIPOS, valor: t.tipo },
          { id: 'cat', label: 'Categoría', tipo: 'select', opciones: cats.map(c => [c.id, c.nombre]), valor: t.categoria_id },
          { id: 'tarea', label: 'Tarea', valor: t.tarea, obligatorio: true },
          { id: 'horas', label: 'Horas', valor: String(t.horas).replace('.', ','), inputmode: 'decimal', obligatorio: true }] });
        if (!v) return;
        const h = parseNum(v.horas);
        if (!(h > 0)) return toast('Las horas tienen que ser mayores a cero', 'error');
        try { await Api.update('tempario', { id: 'eq.' + t.id }, { tipo: v.tipo, categoria_id: Number(v.cat), tarea: v.tarea.trim(), horas: h }); toast('Tarea guardada'); navegar(); }
        catch (e) { toast(errMsg(e), 'error'); }
      });
      return;
    }

    // ---- Carga por lote ----
    if (!loteT.length) loteT = [filaVacia()];
    const catNombres = cats.map(c => c.nombre);
    const existentes = new Set(temp.map(t => `${t.tipo}|${(t.categoria ? t.categoria.nombre : '').toUpperCase()}|${t.tarea.trim().toUpperCase()}`));
    const pintarLote = () => {
      const ok = loteTRevisado && loteT.every(f => f.estado === 'ok');
      cont.innerHTML = `
        <section class="tarjeta"><h2>Agregar servicios al tempario</h2>
          <p class="nota">Completá la tabla o pegá filas desde Excel con las columnas: tipo, categoría, tarea, horas. Si pegás solo tarea y horas, se usan el tipo y la categoría de abajo.</p>
          <div class="fila-campos">
            <div class="campo"><label for="d-tipo">Tipo por defecto</label><select id="d-tipo">${TIPOS.map(t => `<option ${t === defTipo ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
            <div class="campo"><label for="d-cat">Categoría por defecto</label><input id="d-cat" list="dl-cats" value="${esc(defCat)}" autocomplete="off"></div>
          </div>
          <datalist id="dl-cats">${catNombres.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>
          <div class="tabla-caja"><table><thead><tr><th>#</th><th>Tipo</th><th>Categoría</th><th>Tarea</th><th class="num">Horas</th><th>Revisión</th><th></th></tr></thead><tbody>
            ${loteT.map((f, i) => `<tr class="${f.estado === 'ok' ? 'bien' : f.estado ? 'mal' : ''}"><td>${i + 1}</td>
              <td><select data-f="${i}" data-k="tipo" aria-label="Tipo fila ${i + 1}"><option value="">(por defecto)</option>${TIPOS.map(t => `<option ${t === f.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
              <td><input data-f="${i}" data-k="categoria" list="dl-cats" value="${esc(f.categoria)}" placeholder="(por defecto)" autocomplete="off" aria-label="Categoría fila ${i + 1}"></td>
              <td><input data-f="${i}" data-k="tarea" value="${esc(f.tarea)}" autocomplete="off" style="min-width:220px" aria-label="Tarea fila ${i + 1}"></td>
              <td><input data-f="${i}" data-k="horas" value="${esc(f.horas)}" inputmode="decimal" style="max-width:80px;text-align:right" autocomplete="off" aria-label="Horas fila ${i + 1}"></td>
              <td>${f.estado === 'ok' ? '<span class="chip verde">OK</span>' : f.estado ? `<span style="color:var(--rojo);font-weight:600">${esc(f.estado)}</span>` : ''}</td>
              <td><button class="btn-texto" data-quitar="${i}">Quitar</button></td></tr>`).join('')}
          </tbody></table></div>
          <div class="acciones" style="margin-top:10px"><button class="btn" data-accion="fila">+ Agregar fila</button>
            <button class="btn" data-accion="vaciar">Vaciar tabla</button></div>
          <details style="margin-top:14px"><summary style="cursor:pointer;font-weight:600">Pegar desde Excel</summary>
            <textarea id="t-pegar" style="margin-top:8px" placeholder="PESADA	MOTOR	Cambio de bomba de agua	4"></textarea>
            <button class="btn" data-accion="pegar" style="margin-top:8px">Pasar a la tabla</button></details>
          <div class="acciones" style="margin-top:16px;justify-content:flex-end">
            <button class="btn" data-accion="revisar">Revisar</button>
            <button class="btn btn-primario" data-accion="guardar" ${ok ? '' : 'disabled'}>Guardar ${loteT.length} servicio${loteT.length === 1 ? '' : 's'}</button></div>
          ${loteTRevisado && !ok ? '<div class="error-box">Hay filas con problemas (en rojo). Corregilas y volvé a revisar.</div>' : ''}
        </section>`;
    };
    pintarLote();
    on(cont, 'input', '[data-f]', (ev, el) => { loteT[Number(el.dataset.f)][el.dataset.k] = el.value; loteTRevisado = false; });
    on(cont, 'change', 'select[data-f]', (ev, el) => { loteT[Number(el.dataset.f)][el.dataset.k] = el.value; loteTRevisado = false; });
    on(cont, 'change', '#d-tipo', (ev, el) => { defTipo = el.value; loteTRevisado = false; });
    on(cont, 'input', '#d-cat', (ev, el) => { defCat = el.value; loteTRevisado = false; });
    on(cont, 'click', '[data-accion=fila]', () => { loteT.push(filaVacia()); loteTRevisado = false; pintarLote(); });
    on(cont, 'click', '[data-accion=vaciar]', () => { loteT = [filaVacia()]; loteTRevisado = false; pintarLote(); });
    on(cont, 'click', '[data-quitar]', (ev, b) => { loteT.splice(Number(b.dataset.quitar), 1); if (!loteT.length) loteT.push(filaVacia()); loteTRevisado = false; pintarLote(); });
    on(cont, 'click', '[data-accion=pegar]', () => {
      const filas = String(document.getElementById('t-pegar').value || '').split(/\r?\n/).map(l => l.split(/\t|;/).map(x => x.trim())).filter(c => c.some(Boolean));
      const nuevas = [];
      for (const c of filas) {
        if (c.length >= 4 && !isNaN(parseNum(c[3]))) nuevas.push({ tipo: normTipo(c[0]), categoria: c[1], tarea: c[2], horas: c[3] });
        else if (c.length >= 2 && !isNaN(parseNum(c[c.length - 1]))) nuevas.push({ tipo: '', categoria: '', tarea: c[0], horas: c[c.length - 1] });
      }
      if (!nuevas.length) return toast('No se encontraron filas válidas para pegar', 'error');
      loteT = loteT.filter(f => f.tarea || f.horas).concat(nuevas);
      loteTRevisado = false; pintarLote(); toast(`${nuevas.length} filas agregadas`);
    });
    on(cont, 'click', '[data-accion=revisar]', () => {
      loteT = loteT.filter(f => String(f.tarea).trim() || String(f.horas).trim());
      if (!loteT.length) loteT = [filaVacia()];
      const vistos = new Set();
      for (const f of loteT) {
        const tipo = normTipo(f.tipo) || defTipo;
        const cat = String(f.categoria || defCat || '').trim().toUpperCase();
        const tarea = String(f.tarea || '').trim();
        const h = parseNum(f.horas);
        const clave = `${tipo}|${cat}|${tarea.toUpperCase()}`;
        f.tipoFinal = tipo; f.catFinal = cat; f.tareaFinal = tarea; f.horasFinal = h;
        if (!tarea) f.estado = 'Falta la tarea';
        else if (!cat) f.estado = 'Falta la categoría';
        else if (!(h > 0)) f.estado = 'Horas inválidas';
        else if (existentes.has(clave)) f.estado = 'Ya existe en el tempario';
        else if (vistos.has(clave)) f.estado = 'Repetida en la tabla';
        else f.estado = 'ok';
        vistos.add(clave);
      }
      loteTRevisado = true; pintarLote();
    });
    on(cont, 'click', '[data-accion=guardar]', async (ev, b) => {
      b.disabled = true;
      try {
        const porNombre = new Map(cats.map(c => [c.nombre.toUpperCase(), c.id]));
        const faltan = [...new Set(loteT.map(f => f.catFinal).filter(c => !porNombre.has(c)))];
        if (faltan.length) {
          const nuevas = await Api.insert('categorias_tempario', faltan.map(n => ({ nombre: n })));
          for (const c of nuevas) porNombre.set(c.nombre.toUpperCase(), c.id);
        }
        await Api.insert('tempario', loteT.map(f => ({ tipo: f.tipoFinal, categoria_id: porNombre.get(f.catFinal), tarea: f.tareaFinal,
                                                        horas: f.horasFinal, creado_por: st.usuarioId })));
        toast(`${loteT.length} servicios agregados al tempario`);
        loteT = [filaVacia()]; loteTRevisado = false; vistaTemp = 'lista'; navegar();
      } catch (e) { toast(errMsg(e), 'error'); b.disabled = false; }
    });
  }, ['ADMINISTRADOR']);

  // ---------------- Usuarios ----------------
  const usuarioDe = u => u.email ? (u.email.endsWith('@' + cfg.dominioUsuarios) ? u.email.split('@')[0] : u.email) : '';
  async function sinFuncion(e) {
    if (e && (e.status === 404 || e.status === 0)) {
      await modal({ titulo: 'Falta activar la creación de usuarios', soloCerrar: true, textoOk: 'Entendido',
        html: `<p>Mientras tanto, creá el usuario en Supabase: <b>Authentication → Users → Add user</b>. Usá como email
          <b>usuario@${esc(cfg.dominioUsuarios)}</b> (por ejemplo juan@${esc(cfg.dominioUsuarios)}), una contraseña y marcá <b>Auto Confirm</b>.</p>
          <p>Después volvé acá: el usuario aparece en la lista para asignarle los roles.</p>` });
      return true;
    }
    return false;
  }

  ruta(/^#\/usuarios$/, async main => {
    const usuarios = await Api.select('usuarios', { select: 'id,nombre,email,activo,roles:usuario_roles(rol)', order: 'nombre' }).catch(() =>
      Api.select('usuarios', { select: 'id,nombre,activo,roles:usuario_roles(rol)', order: 'nombre' }));
    main.innerHTML = `
      <div class="encabezado"><div><h1>Usuarios</h1><div class="sub">Marcá los roles de cada persona. Un usuario puede tener más de un rol.</div></div>
        <div class="acciones"><button class="btn btn-primario" data-accion="nuevo">Nuevo usuario</button></div></div>
      <div class="tabla-caja"><table><thead><tr><th>Nombre</th><th>Usuario</th>${ROLES.map(([, t]) => `<th>${t}</th>`).join('')}<th>Activo</th><th></th></tr></thead><tbody>
        ${usuarios.map(u => {
          const roles = (u.roles || []).map(r => r.rol);
          const yo = u.id === st.usuarioId;
          return `<tr><td><b>${esc(u.nombre)}</b>${yo ? ' <span class="nota">(vos)</span>' : ''}</td><td>${esc(usuarioDe(u))}</td>
            ${ROLES.map(([r, t]) => `<td><label class="check"><input type="checkbox" data-u="${u.id}" data-rol="${r}" ${roles.includes(r) ? 'checked' : ''}
              ${yo && r === 'ADMINISTRADOR' ? 'disabled' : ''} aria-label="${t} para ${esc(u.nombre)}"></label></td>`).join('')}
            <td><label class="check"><input type="checkbox" data-activo="${u.id}" ${u.activo ? 'checked' : ''} ${yo ? 'disabled' : ''} aria-label="Activo"></label></td>
            <td style="white-space:nowrap"><button class="btn-texto" data-renombrar="${u.id}">Nombre</button>
              <button class="btn-texto" data-clave="${u.id}">Contraseña</button></td></tr>`;
        }).join('') || '<tr><td colspan="8" class="vacio">Sin usuarios.</td></tr>'}
      </tbody></table></div>
      <div class="nota" style="margin-top:8px">Un usuario sin roles no puede entrar. Desactivar a alguien le quita el acceso sin borrar su historial.</div>`;

    on(main, 'change', '[data-rol]', async (ev, cb) => {
      try {
        if (cb.checked) await Api.insert('usuario_roles', { usuario_id: cb.dataset.u, rol: cb.dataset.rol });
        else await Api.remove('usuario_roles', { usuario_id: 'eq.' + cb.dataset.u, rol: 'eq.' + cb.dataset.rol });
        toast('Roles actualizados');
      } catch (e) { toast(errMsg(e), 'error'); cb.checked = !cb.checked; }
    });
    on(main, 'change', '[data-activo]', async (ev, cb) => {
      try { await Api.update('usuarios', { id: 'eq.' + cb.dataset.activo }, { activo: cb.checked }); toast(cb.checked ? 'Usuario activado' : 'Usuario desactivado'); }
      catch (e) { toast(errMsg(e), 'error'); cb.checked = !cb.checked; }
    });
    on(main, 'click', '[data-renombrar]', async (ev, b) => {
      const u = usuarios.find(x => x.id === b.dataset.renombrar);
      const v = await modal({ titulo: 'Cambiar nombre', textoOk: 'Guardar', campos: [{ id: 'n', label: 'Nombre y apellido', valor: u.nombre, obligatorio: true }] });
      if (!v) return;
      try { await Api.update('usuarios', { id: 'eq.' + u.id }, { nombre: v.n.trim() }); toast('Nombre actualizado'); navegar(); }
      catch (e) { toast(errMsg(e), 'error'); }
    });
    on(main, 'click', '[data-clave]', async (ev, b) => {
      const u = usuarios.find(x => x.id === b.dataset.clave);
      const v = await modal({ titulo: 'Nueva contraseña para ' + u.nombre, textoOk: 'Cambiar',
        campos: [{ id: 'p', label: 'Contraseña nueva (mínimo 6 caracteres)', tipo: 'password', autocomplete: 'new-password', obligatorio: true }] });
      if (!v) return;
      if (v.p.length < 6) return toast('La contraseña tiene que tener al menos 6 caracteres', 'error');
      try { await Api.funcion('crear-usuario', { accion: 'password', id: u.id, password: v.p }); toast('Contraseña cambiada'); }
      catch (e) { if (!(await sinFuncion(e))) toast(errMsg(e), 'error'); }
    });
    on(main, 'click', '[data-accion=nuevo]', async () => {
      const v = await modal({ titulo: 'Nuevo usuario', textoOk: 'Crear', campos: [
        { id: 'nombre', label: 'Nombre y apellido', obligatorio: true },
        { id: 'usuario', label: 'Usuario para entrar (ej. juan) o email', obligatorio: true, autocomplete: 'off' },
        { id: 'p', label: 'Contraseña (mínimo 6 caracteres)', tipo: 'password', autocomplete: 'new-password', obligatorio: true },
        { id: 'rol', label: 'Rol', tipo: 'select', opciones: [['MECANICO', 'Mecánico'], ['OFICINA', 'Oficina'], ['DEPOSITO', 'Depósito'],
          ['MECANICO,DEPOSITO', 'Mecánico y Depósito'], ['ADMINISTRADOR', 'Administrador']], valor: 'MECANICO' }] });
      if (!v) return;
      if (v.p.length < 6) return toast('La contraseña tiene que tener al menos 6 caracteres', 'error');
      const usuario = v.usuario.trim().toLowerCase().replace(/\s+/g, '');
      try {
        await Api.funcion('crear-usuario', { accion: 'crear', nombre: v.nombre.trim(), usuario, password: v.p, roles: v.rol.split(',') });
        toast(`Usuario creado: entra con "${usuario}"`); navegar();
      } catch (e) { if (!(await sinFuncion(e))) toast(errMsg(e), 'error'); }
    });
  }, ['ADMINISTRADOR']);

  // ---------------- Reportes ----------------
  let rDesde = '', rHasta = '';
  async function porPartes(ids, fn) {
    const out = [];
    for (let i = 0; i < ids.length; i += 120) out.push(...await fn(ids.slice(i, i + 120)));
    return out;
  }
  ruta(/^#\/reportes$/, async main => {
    if (!rDesde) { const h = hoyISO(); rDesde = h.slice(0, 8) + '01'; rHasta = h; }
    main.innerHTML = `
      <div class="encabezado"><div><h1>Reportes</h1><div class="sub">Por OT ingresadas en el período. Las horas reales son solo para control interno.</div></div></div>
      <form id="f-rep" class="fila-campos" style="align-items:end">
        <div class="campo"><label for="r-desde">Desde</label><input id="r-desde" type="date" value="${rDesde}"></div>
        <div class="campo"><label for="r-hasta">Hasta</label><input id="r-hasta" type="date" value="${rHasta}"></div>
        <div class="campo"><button class="btn btn-primario" type="submit">Ver</button></div>
      </form>
      <div id="r-res"><div class="vacio">Cargando…</div></div>
      <div id="r-pausas"></div>`;
    document.getElementById('f-rep').addEventListener('submit', ev => {
      ev.preventDefault(); rDesde = document.getElementById('r-desde').value; rHasta = document.getElementById('r-hasta').value; navegar(); });

    // Pausas del período (por fecha de la pausa): tiempo perdido por motivo y por mecánico.
    Api.rpc('reporte_pausas', { p_desde: rDesde, p_hasta: rHasta }).then(pausas => {
      const caja = document.getElementById('r-pausas');
      if (!caja) return;
      const sumar = (clave) => {
        const o = {};
        for (const p of pausas) { const k = p[clave] || '—'; const x = o[k] = o[k] || { n: 0, min: 0 }; x.n++; x.min += Number(p.minutos); }
        return Object.entries(o).sort((a, b) => b[1].min - a[1].min);
      };
      const fh = d => d ? new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
      const tabla = (titulo, filas) => `<div><h3 style="margin:0 0 6px">${titulo}</h3><div class="tabla-caja"><table><thead><tr><th>${titulo === 'Por motivo' ? 'Motivo' : 'Mecánico'}</th><th class="num">Pausas</th><th class="num">Tiempo</th></tr></thead><tbody>
        ${filas.map(([k, x]) => `<tr><td><b>${esc(k)}</b></td><td class="num">${x.n}</td><td class="num">${duracionTexto(x.min)}</td></tr>`).join('') || '<tr><td colspan="3" class="vacio">Sin pausas.</td></tr>'}</tbody></table></div></div>`;
      caja.innerHTML = `<h2 style="margin:22px 0 10px">Pausas de OT en el período</h2>
        <div class="dos-col" style="gap:16px;margin-bottom:12px">${tabla('Por motivo', sumar('motivo'))}${tabla('Por mecánico', sumar('pauso'))}</div>
        <div class="tabla-caja"><table><thead><tr><th>OT</th><th>Motivo</th><th>Pausó</th><th>Desde</th><th>Hasta</th><th class="num">Duración</th><th>Reanudó</th></tr></thead><tbody>
          ${pausas.map(p => `<tr><td><a href="#/ot/${p.ot_id}">${esc(nroOT(p.ot_numero))}</a><div class="nota">${esc(p.dominio || '')} · ${esc(p.cliente || '')}</div></td>
            <td>${esc(p.motivo)}${p.detalle ? `<div class="nota">${esc(p.detalle)}</div>` : ''}</td><td>${esc(p.pauso || '')}</td>
            <td>${fh(p.inicio)}</td><td>${p.fin ? fh(p.fin) : '<b>sigue pausada</b>'}</td><td class="num">${duracionTexto(p.minutos)}</td><td>${esc(p.reanudo || '')}</td></tr>`).join('')
            || '<tr><td colspan="7" class="vacio">No hubo pausas en el período.</td></tr>'}
        </tbody></table></div>`;
    }).catch(e => { const caja = document.getElementById('r-pausas'); if (caja) caja.innerHTML = `<div class="error-box">${esc(errMsg(e))}</div>`; });

    const ots = await Api.select('ordenes_trabajo', {
      select: 'id,numero,estado,cliente:clientes(nombre),tareas:tareas_ot(id,horas_total,estado)',
      and: `(fecha_ingreso.gte.${rDesde},fecha_ingreso.lte.${rHasta})`, estado: 'neq.PRUEBA', order: 'numero' });
    const otIds = ots.map(o => o.id);
    const tareas = ots.flatMap(o => (o.tareas || []).map(t => Object.assign({ ot: o }, t)));
    const tareaPorId = new Map(tareas.map(t => [t.id, t]));
    const [reales, asig] = await Promise.all([
      porPartes(otIds, ids => Api.select('horas_reales', { select: 'tarea_id,mecanico_id,mecanico,horas_reales', ot_id: `in.(${ids.join(',')})` })),
      porPartes(tareas.map(t => t.id), ids => Api.select('asignaciones', { select: 'tarea_id,mecanico_id,terminada_en,usuario:usuarios(nombre)', tarea_id: `in.(${ids.join(',')})` }))
    ]);

    const totalHoras = tareas.reduce((a, t) => a + Number(t.horas_total || 0), 0);
    const porEstado = {};
    for (const o of ots) porEstado[o.estado] = (porEstado[o.estado] || 0) + 1;

    const clientes = {};
    for (const o of ots) {
      const k = o.cliente ? o.cliente.nombre : '—';
      const c = clientes[k] = clientes[k] || { ots: 0, horas: 0, tareas: 0, hechas: 0 };
      c.ots++; for (const t of o.tareas || []) { c.horas += Number(t.horas_total || 0); c.tareas++; if (t.estado === 'HECHA') c.hechas++; }
    }
    const mecs = {};
    for (const a of asig) {
      const m = mecs[a.mecanico_id] = mecs[a.mecanico_id] || { nombre: a.usuario ? a.usuario.nombre : '', asignadas: 0, terminadas: 0, horasTemp: 0, horasReal: 0 };
      m.asignadas++; if (a.terminada_en) m.terminadas++;
      const t = tareaPorId.get(a.tarea_id); if (t) m.horasTemp += Number(t.horas_total || 0);
    }
    for (const r of reales) {
      const m = mecs[r.mecanico_id] = mecs[r.mecanico_id] || { nombre: r.mecanico, asignadas: 0, terminadas: 0, horasTemp: 0, horasReal: 0 };
      m.horasReal += Number(r.horas_reales || 0);
    }
    const pct = (a, b) => b > 0 ? Math.round(a / b * 100) + '%' : '—';

    document.getElementById('r-res').innerHTML = `
      <section class="tarjeta"><h2>Período</h2><div class="datos">
        <div class="dato"><div class="et">OT ingresadas</div><div class="va">${ots.length}</div></div>
        <div class="dato"><div class="et">Horas de tempario</div><div class="va">${num(totalHoras)} h</div></div>
        <div class="dato"><div class="et">Tareas hechas</div><div class="va">${tareas.filter(t => t.estado === 'HECHA').length} de ${tareas.length}</div></div>
        ${Object.entries(porEstado).map(([e, n]) => `<div class="dato"><div class="et">${esc(e)}</div><div class="va">${n}</div></div>`).join('')}
      </div></section>
      <h2 style="margin:18px 0 10px">Por mecánico</h2>
      <div class="tabla-caja"><table><thead><tr><th>Mecánico</th><th class="num">Tareas asignadas</th><th class="num">Terminadas</th>
        <th class="num">Horas tempario</th><th class="num">Horas reales</th><th class="num">Real / tempario</th></tr></thead><tbody>
        ${Object.values(mecs).sort((a, b) => a.nombre.localeCompare(b.nombre)).map(m => `<tr><td><b>${esc(m.nombre)}</b></td><td class="num">${m.asignadas}</td>
          <td class="num">${m.terminadas}</td><td class="num">${num(m.horasTemp)}</td><td class="num">${num(m.horasReal)}</td><td class="num">${pct(m.horasReal, m.horasTemp)}</td></tr>`).join('')
          || '<tr><td colspan="6" class="vacio">Sin datos en el período.</td></tr>'}</tbody></table></div>
      <div class="nota" style="margin-top:6px">En tareas compartidas, las horas de tempario cuentan para los dos mecánicos. Menos de 100% = más rápido que el tempario.</div>
      <h2 style="margin:18px 0 10px">Por cliente</h2>
      <div class="tabla-caja"><table><thead><tr><th>Cliente</th><th class="num">OT</th><th class="num">Tareas</th><th class="num">Hechas</th><th class="num">Horas tempario</th></tr></thead><tbody>
        ${Object.entries(clientes).sort((a, b) => b[1].horas - a[1].horas).map(([n, c]) => `<tr><td><b>${esc(n)}</b></td><td class="num">${c.ots}</td>
          <td class="num">${c.tareas}</td><td class="num">${c.hechas}</td><td class="num">${num(c.horas)}</td></tr>`).join('')
          || '<tr><td colspan="5" class="vacio">Sin datos en el período.</td></tr>'}</tbody></table></div>`;
  }, ['ADMINISTRADOR']);
})();
