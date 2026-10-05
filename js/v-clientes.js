// MDE · Taller — clientes y unidades (Oficina y Administrador).
(() => {
  const { esc, errMsg, toast, modal, TIPOS, ruta, on, navegar } = App;

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
