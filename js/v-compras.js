// MDE · Taller — compras: proveedores y órdenes de compra (Oficina, Depósito y Administrador).
//   Circuito: BORRADOR → PARA APROBAR → EMITIDA → RECIBIDA PARCIAL → RECIBIDA (o ANULADA).
//   Una OC puede ir a una OT (una OT puede tener varias), a Stock o a Insumos del taller.
window.Compras = (() => {
  const { st, cfg, esc, num, parseNum, nroOT, fecha, fechaHora, tiene, esAdmin, veTodas, errMsg, toast, modal, confirmar,
          ICONOS, autocompletar, autocompletarRepuesto, ruta, ir, on, navegar } = App;

  const ROLES = ['OFICINA', 'ADMINISTRADOR', 'DEPOSITO'];
  const ESTADOS = ['BORRADOR', 'PARA APROBAR', 'EMITIDA', 'RECIBIDA PARCIAL', 'RECIBIDA', 'ANULADA'];
  const ABIERTAS = ['BORRADOR', 'PARA APROBAR', 'EMITIDA', 'RECIBIDA PARCIAL'];
  const EMITIDAS = ['EMITIDA', 'RECIBIDA PARCIAL', 'RECIBIDA'];
  const DESTINOS = [['OT', 'Una OT'], ['STOCK', 'Stock'], ['INSUMOS', 'Insumos del taller']];
  const IVAS = [21, 10.5, 27, 0];
  const OT_CERRADA = ['CERRADA', 'FACTURADA', 'PRUEBA'];
  const puedeArmar = () => veTodas();                                   // Oficina, Depósito, Administrador
  const puedeRecibir = () => tiene('DEPOSITO') || esAdmin();

  // ---------------- Formatos ----------------
  const nroOC = n => n == null ? '' : (st.prefijoOC == null ? 'OC-' : st.prefijoOC) + String(n).padStart(6, '0');
  const pesos = n => '$ ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const precioTexto = n => n == null || n === '' || isNaN(n) ? '' : Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cantTexto = n => n == null || n === '' || isNaN(n) ? '' : String(Math.round(Number(n) * 100) / 100).replace('.', ',');
  const textoIVA = a => num(a, 1) + ' %';
  // Precio escrito a mano: "12.500,50", "12500,5", "12.500" (punto de miles) o "12500.5".
  const parsePrecio = s => {
    s = String(s == null ? '' : s).replace(/\$/g, '').replace(/\s+/g, '');
    if (!s) return NaN;
    if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'));
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
    return Number(s);
  };

  // Totales como en una factura: subtotal por renglón redondeado y el IVA por alícuota sobre el neto
  // de esa alícuota. Se calcula en centavos para que dé exactamente lo mismo que la base de datos.
  const centavos = x => Math.round(Number(x || 0) * 100);
  function totales(lineas) {
    const base = new Map(); let neto = 0;
    const subs = lineas.map(l => {
      const c = Math.round(centavos(l.cantidad) * centavos(l.precio_unitario) / 100);
      neto += c;
      const a = Number(l.alicuota_iva) || 0;
      base.set(a, (base.get(a) || 0) + c);
      return c / 100;
    });
    const ivas = [...base.entries()].sort((a, b) => b[0] - a[0])
      .map(([alic, b]) => ({ alic, base: b / 100, cent: Math.round(b * Math.round(alic * 10) / 1000) }));
    const ivaCent = ivas.reduce((s, x) => s + x.cent, 0);
    return { subs, neto: neto / 100, ivas: ivas.map(x => ({ alic: x.alic, base: x.base, iva: x.cent / 100 })), iva: ivaCent / 100, total: (neto + ivaCent) / 100 };
  }
  const htmlTotales = t => `<div class="oc-totales">
      <div><span>Subtotal sin IVA</span><b>${pesos(t.neto)}</b></div>
      ${t.ivas.filter(x => x.alic > 0).map(x => `<div><span>IVA ${textoIVA(x.alic)}</span><b>${pesos(x.iva)}</b></div>`).join('')}
      <div class="total"><span>Total</span><b>${pesos(t.total)}</b></div></div>`;

  function chipOC(o) {
    const c = { 'BORRADOR': '', 'PARA APROBAR': 'ambar', 'EMITIDA': 'azul', 'RECIBIDA PARCIAL': 'celeste', 'RECIBIDA': 'verde', 'ANULADA': 'rojo' }[o.estado] || '';
    return `<span class="chip ${c}">${esc(o.estado === 'RECIBIDA' && o.cerrada_en ? 'RECIBIDA · CON FALTANTE' : o.estado)}</span>`;
  }
  const textoOT = ot => !ot ? '' : nroOT(ot.numero) + (ot.unidad && ot.unidad.dominio ? ' · ' + ot.unidad.dominio : '') + (ot.unidad && ot.unidad.interno ? ' · INT ' + ot.unidad.interno : '');
  function destinoHTML(o, conEnlace = true) {
    if (o.destino === 'STOCK') return 'Stock';
    if (o.destino === 'INSUMOS') return 'Insumos del taller';
    if (!o.ot) return 'OT (eliminada)';
    return conEnlace ? `<a href="#/ot/${o.ot.id}">${esc(textoOT(o.ot))}</a>` : esc(textoOT(o.ot));
  }

  // Si la base todavía no tiene el paso 26, las pantallas de compras avisan en lugar de romperse.
  const faltaBase = e => /ordenes_compra|proveedores|does not exist|Could not find|schema cache|PGRST20/i.test((e && e.message) || '');
  const AVISO_BASE = `<div class="aviso-box">Para usar Compras falta correr en Supabase el paso 26 de la base de datos
    (<b>base-de-datos/26_ordenes_compra.sql</b>). Después de correrlo, recargá la página.</div>`;
  const protegida = fn => async (main, ...args) => {
    try { await fn(main, ...args); }
    catch (e) { if (!faltaBase(e)) throw e; console.error(e); main.innerHTML = AVISO_BASE; }
  };

  // ---------------- Consultas ----------------
  const SEL_OC = 'id,numero,estado,destino,ot_id,proveedor_id,fecha,entrega_estimada,condicion_pago,observaciones,nro_factura,' +
    'creado_en,enviada_en,aprobada_en,cerrada_en,motivo_cierre,anulada_en,motivo_anulacion,importe_total,' +
    'proveedor:proveedores!ordenes_compra_proveedor_id_fkey(id,nombre,cuit,telefono,email,direccion,contacto,condicion_pago,activo),' +
    'ot:ordenes_trabajo!ordenes_compra_ot_id_fkey(id,numero,estado,unidad:unidades(dominio,interno),cliente:clientes(nombre)),' +
    'creador:usuarios!ordenes_compra_creado_por_fkey(nombre:nombre_visible),enviador:usuarios!ordenes_compra_enviada_por_fkey(nombre:nombre_visible),' +
    'aprobador:usuarios!ordenes_compra_aprobada_por_fkey(nombre:nombre_visible),anulador:usuarios!ordenes_compra_anulada_por_fkey(nombre:nombre_visible),' +
    'cerrador:usuarios!ordenes_compra_cerrada_por_fkey(nombre:nombre_visible),' +
    'lineas:ordenes_compra_lineas!ordenes_compra_lineas_oc_id_fkey(id,renglon,codigo,descripcion,cantidad,precio_unitario,alicuota_iva,cantidad_recibida,pedido_id,' +
      'pedido:pedidos_repuesto!ordenes_compra_lineas_pedido_id_fkey(id,estado,pedidor:usuarios!pedidos_repuesto_pedido_por_fkey(nombre:nombre_visible))),' +
    'recepciones:ordenes_compra_recepciones!ordenes_compra_recepciones_oc_id_fkey(id,remito,observacion,ingreso_id,creado_en,creador:usuarios!ordenes_compra_recepciones_creado_por_fkey(nombre:nombre_visible),' +
      'items:ordenes_compra_recepcion_items!ordenes_compra_recepcion_items_recepcion_id_fkey(id,linea_id,cantidad,pedido_id,pedido:pedidos_repuesto!ordenes_compra_recepcion_items_pedido_id_fkey(id,estado,codigo,descripcion,cantidad,detalle))),' +
    'historial:ordenes_compra_historial!ordenes_compra_historial_oc_id_fkey(id,creado_en,tipo,detalle,usuario:usuarios!ordenes_compra_historial_usuario_id_fkey(nombre:nombre_visible))';

  async function cargarOC(id) {
    const oc = (await Api.select('ordenes_compra', { select: SEL_OC, id: 'eq.' + id }))[0];
    if (!oc) return null;
    oc.lineas = (oc.lineas || []).sort((a, b) => a.renglon - b.renglon);
    oc.recepciones = (oc.recepciones || []).sort((a, b) => new Date(a.creado_en) - new Date(b.creado_en));
    oc.historial = (oc.historial || []).sort((a, b) => a.id - b.id);
    return oc;
  }

  // Pedidos de repuesto que ya están cubiertos por una OC: un renglón de una OC vigente
  // (ni anulada ni cerrada con faltante) o algo que ya llegó por una OC. Devuelve Map pedido_id → OC.
  async function pedidosEnOC(ids, excluirOc) {
    const m = new Map();
    if (!ids.length) return m;
    const lista = 'in.(' + ids.join(',') + ')';
    const [lineas, items] = await Promise.all([
      Api.select('ordenes_compra_lineas', { select: 'pedido_id,oc:ordenes_compra!ordenes_compra_lineas_oc_id_fkey(id,numero,estado,cerrada_en)', pedido_id: lista }),
      Api.select('ordenes_compra_recepcion_items', { select: 'pedido_id,recepcion:ordenes_compra_recepciones!ordenes_compra_recepcion_items_recepcion_id_fkey(oc:ordenes_compra!ordenes_compra_recepciones_oc_id_fkey(id,numero,estado,cerrada_en))', pedido_id: lista })]);
    for (const l of lineas) if (l.oc && l.oc.estado !== 'ANULADA' && !l.oc.cerrada_en && l.oc.id !== excluirOc) m.set(l.pedido_id, l.oc);
    for (const i of items) { const oc = i.recepcion && i.recepcion.oc; if (oc) m.set(i.pedido_id, oc); }
    return m;
  }

  // Pedidos de repuesto pendientes (de OT abiertas) que todavía no tienen orden de compra.
  async function pedidosSinOC() {
    const peds = await Api.select('pedidos_repuesto', {
      select: 'id,ot_id,codigo,descripcion,cantidad,creado_en,ot:ordenes_trabajo!pedidos_repuesto_ot_id_fkey(id,numero,estado,unidad:unidades(dominio,interno),cliente:clientes(nombre))',
      estado: 'eq.PENDIENTE', order: 'creado_en' });
    const vivos = peds.filter(p => p.ot && !OT_CERRADA.includes(p.ot.estado));
    const en = await pedidosEnOC(vivos.map(p => p.id));
    const sin = vivos.filter(p => !en.has(p.id));
    const codigos = [...new Set(sin.map(p => p.codigo).filter(Boolean))];
    const stock = new Map();
    if (codigos.length) {
      try {
        const filas = await Api.select('stock_disponible', { select: 'codigo,disponible', codigo: 'in.(' + codigos.map(c => '"' + c.replace(/"/g, '') + '"').join(',') + ')' });
        for (const f of filas) stock.set(f.codigo, Number(f.disponible));
      } catch (e) { /* sin dato de stock */ }
    }
    for (const p of sin) p.stock = p.codigo ? (stock.get(p.codigo) || 0) : null;
    return sin;
  }

  // Último precio comprado de un repuesto (de cualquier OC no anulada).
  async function ultimoPrecio(codigo) {
    const r = await Api.select('ordenes_compra_lineas', {
      select: 'precio_unitario,alicuota_iva,oc:ordenes_compra!ordenes_compra_lineas_oc_id_fkey!inner(numero,estado,fecha,proveedor:proveedores!ordenes_compra_proveedor_id_fkey(nombre))',
      codigo: 'eq.' + codigo, precio_unitario: 'not.is.null', 'oc.estado': 'neq.ANULADA', order: 'id.desc', limit: 1 });
    return r[0] || null;
  }

  // ---------------- Proveedores ----------------
  async function formProveedor(p, previo) {
    const val = k => previo ? previo[k] : (p ? p[k] || '' : '');
    const v = await modal({ titulo: p ? 'Editar proveedor' : 'Nuevo proveedor', textoOk: 'Guardar', campos: [
      { id: 'nombre', label: 'Proveedor (razón social o nombre)', valor: val('nombre'), obligatorio: true },
      { id: 'cuit', label: 'CUIT', valor: val('cuit'), inputmode: 'numeric', ayuda: '11 números, con o sin guiones' },
      { id: 'telefono', label: 'Teléfono', valor: val('telefono'), inputmode: 'tel' },
      { id: 'email', label: 'Email', valor: val('email'), inputmode: 'email' },
      { id: 'contacto', label: 'Contacto (vendedor)', valor: val('contacto') },
      { id: 'direccion', label: 'Dirección', valor: val('direccion') },
      { id: 'condicion_pago', label: 'Condición de pago habitual', valor: val('condicion_pago'), ayuda: 'Ej.: Contado · Cuenta corriente 30 días. Se propone sola al armar la OC.' },
      { id: 'observaciones', label: 'Observaciones', tipo: 'textarea', valor: val('observaciones') }] });
    if (!v) return null;
    const fila = {};
    for (const k of ['nombre', 'cuit', 'telefono', 'email', 'contacto', 'direccion', 'condicion_pago', 'observaciones']) fila[k] = v[k].trim() || null;
    try {
      const r = p ? await Api.update('proveedores', { id: 'eq.' + p.id }, fila) : await Api.insert('proveedores', fila);
      toast('Proveedor guardado');
      return r[0];
    } catch (e) {
      toast(errMsg(e), 'error');
      return formProveedor(p, v);    // vuelve a abrir el formulario con lo que había escrito
    }
  }

  let filtroProv = '';
  ruta(/^#\/proveedores$/, protegida(async main => {
    const admin = esAdmin();
    const [provs, ocs, emp] = await Promise.all([
      Api.select('proveedores', { select: 'id,nombre,cuit,telefono,email,direccion,contacto,condicion_pago,observaciones,activo', order: 'nombre' }),
      Api.select('ordenes_compra', { select: 'proveedor_id,estado' }),
      admin ? Api.select('configuracion', { select: 'clave,valor',
        clave: 'in.(empresa_razon_social,empresa_cuit,empresa_direccion,empresa_telefono,empresa_email,nro_oc_inicial)' }) : Promise.resolve([])]);
    const cuenta = {};
    for (const o of ocs) if (o.estado !== 'ANULADA') cuenta[o.proveedor_id] = (cuenta[o.proveedor_id] || 0) + 1;
    const conOC = new Set(ocs.map(o => o.proveedor_id));
    const e = Object.fromEntries(emp.map(c => [c.clave, c.valor || '']));
    main.innerHTML = `
      <div class="encabezado"><div><h1>Proveedores</h1><div class="sub" id="pv-cuenta"></div></div>
        <div class="acciones"><a class="btn" href="#/compras">Órdenes de compra</a><button class="btn btn-primario" data-accion="nuevo">Nuevo proveedor</button></div></div>
      <div class="campo" style="max-width:420px"><label for="pv-buscar">Buscar</label>
        <input id="pv-buscar" type="search" placeholder="Nombre, CUIT, contacto…" value="${esc(filtroProv)}"></div>
      <div class="tabla-caja"><table><thead><tr><th>Proveedor</th><th>CUIT</th><th>Teléfono</th><th>Email</th><th>Contacto</th><th>Condición de pago</th><th class="num">OC</th><th></th></tr></thead>
        <tbody id="pv-tbody"></tbody></table></div>
      ${admin ? `<section class="tarjeta" style="margin-top:16px"><h2>Datos de la empresa en la orden de compra</h2>
        <div class="nota" style="margin-bottom:10px">Es lo que sale arriba en la OC impresa. Solo lo cambia el Administrador.</div>
        <form id="f-emp"><div class="fila-campos">
          <div class="campo"><label for="emp-rs">Razón social</label><input id="emp-rs" value="${esc(e.empresa_razon_social)}"></div>
          <div class="campo"><label for="emp-cuit">CUIT</label><input id="emp-cuit" inputmode="numeric" value="${esc(e.empresa_cuit)}"></div>
          <div class="campo"><label for="emp-dir">Dirección</label><input id="emp-dir" value="${esc(e.empresa_direccion)}"></div>
          <div class="campo"><label for="emp-tel">Teléfono</label><input id="emp-tel" inputmode="tel" value="${esc(e.empresa_telefono)}"></div>
          <div class="campo"><label for="emp-mail">Email</label><input id="emp-mail" inputmode="email" value="${esc(e.empresa_email)}"></div>
          <div class="campo"><label for="emp-nro">N° de la primera OC</label><input id="emp-nro" inputmode="numeric" value="${esc(e.nro_oc_inicial)}" placeholder="1">
            <div class="nota">Si ya venían numerando en papel. Solo cuenta si es mayor que la última OC.</div></div>
        </div><button class="btn btn-primario" type="submit">Guardar datos de la empresa</button></form></section>` : ''}`;
    const pintar = () => {
      const q = filtroProv.trim().toUpperCase();
      const lista = provs.filter(p => !q || [p.nombre, p.cuit, p.contacto, p.email, p.telefono].some(x => String(x || '').toUpperCase().includes(q)));
      document.getElementById('pv-cuenta').textContent = `${provs.filter(p => p.activo).length} activos${provs.some(p => !p.activo) ? ` · ${provs.filter(p => !p.activo).length} desactivados` : ''}`;
      document.getElementById('pv-tbody').innerHTML = lista.length ? lista.map(p => `<tr style="${p.activo ? '' : 'opacity:.6'}">
        <td><b>${esc(p.nombre)}</b>${p.activo ? '' : ' <span class="chip">Desactivado</span>'}${p.direccion ? `<div class="nota">${esc(p.direccion)}</div>` : ''}${p.observaciones ? `<div class="nota">${esc(p.observaciones)}</div>` : ''}</td>
        <td style="white-space:nowrap">${esc(p.cuit || '—')}</td><td>${esc(p.telefono || '—')}</td><td>${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '—'}</td>
        <td>${esc(p.contacto || '—')}</td><td>${esc(p.condicion_pago || '—')}</td>
        <td class="num">${cuenta[p.id] ? `<a href="#/compras" data-ver-oc="${p.id}">${cuenta[p.id]}</a>` : '0'}</td>
        <td style="white-space:nowrap"><button class="btn-texto" data-editar="${p.id}">Editar</button>
          <button class="btn-texto" data-activo="${p.id}">${p.activo ? 'Desactivar' : 'Activar'}</button>
          ${admin && !conOC.has(p.id) ? `<button class="btn-texto" style="color:var(--rojo)" data-borrar="${p.id}">Eliminar</button>` : ''}</td></tr>`).join('')
        : `<tr><td colspan="8" class="vacio">${provs.length ? 'No hay proveedores con esa búsqueda.' : 'Todavía no hay proveedores. Cargá el primero con "Nuevo proveedor".'}</td></tr>`;
    };
    pintar();
    const deId = x => provs.find(p => String(p.id) === String(x));
    document.getElementById('pv-buscar').addEventListener('input', ev => { filtroProv = ev.target.value; pintar(); });
    on(main, 'click', '[data-accion=nuevo]', async () => { if (await formProveedor(null)) navegar(); });
    on(main, 'click', '[data-editar]', async (ev, b) => { if (await formProveedor(deId(b.dataset.editar))) navegar(); });
    on(main, 'click', '[data-ver-oc]', (ev, a) => { ev.preventDefault(); filtro.texto = deId(a.dataset.verOc).nombre; filtro.estado = 'todas'; ir('#/compras'); });
    on(main, 'click', '[data-activo]', async (ev, b) => {
      const p = deId(b.dataset.activo);
      try { await Api.update('proveedores', { id: 'eq.' + p.id }, { activo: !p.activo }); toast(p.activo ? 'Proveedor desactivado: ya no aparece para armar OC' : 'Proveedor activado'); navegar(); }
      catch (e) { toast(errMsg(e), 'error'); }
    });
    on(main, 'click', '[data-borrar]', async (ev, b) => {
      const p = deId(b.dataset.borrar);
      if (!(await confirmar(`¿Eliminar el proveedor ${p.nombre}? No se puede deshacer.`, { titulo: 'Eliminar proveedor', textoOk: 'Eliminar', peligro: true }))) return;
      try {
        const r = await Api.remove('proveedores', { id: 'eq.' + p.id });
        if (!r.length) throw new Error('No tenés permiso para hacer esto.');
        toast('Proveedor eliminado'); navegar();
      } catch (e) { toast(errMsg(e), 'error'); }
    });
    const fEmp = document.getElementById('f-emp');
    if (fEmp) fEmp.addEventListener('submit', async ev => {
      ev.preventDefault();
      const val = id => document.getElementById(id).value.trim();
      const nro = val('emp-nro');
      if (nro && !/^\d+$/.test(nro)) return toast('El N° de la primera OC tiene que ser un número', 'error');
      const cambios = { empresa_razon_social: val('emp-rs'), empresa_cuit: val('emp-cuit'), empresa_direccion: val('emp-dir'),
                        empresa_telefono: val('emp-tel'), empresa_email: val('emp-mail'), nro_oc_inicial: nro };
      try {
        await Promise.all(Object.entries(cambios).filter(([k, v]) => (e[k] || '') !== v)
          .map(([k, v]) => Api.update('configuracion', { clave: 'eq.' + k }, { valor: v })));
        toast('Datos de la empresa guardados'); navegar();
      } catch (er) { toast(errMsg(er), 'error'); }
    });
  }), ROLES);

  // ---------------- Lista de órdenes de compra ----------------
  const filtro = { estado: 'abiertas', destino: '', texto: '' };
  ruta(/^#\/compras$/, protegida(async main => {
    const params = { select: 'id,numero,estado,destino,fecha,entrega_estimada,nro_factura,cerrada_en,importe_total,' +
                             'proveedor:proveedores!ordenes_compra_proveedor_id_fkey(nombre),ot:ordenes_trabajo!ordenes_compra_ot_id_fkey(id,numero,unidad:unidades(dominio,interno))', order: 'numero.desc' };
    if (filtro.estado === 'abiertas') params.estado = 'in.(' + ABIERTAS.map(e => `"${e}"`).join(',') + ')';
    else if (filtro.estado !== 'todas') params.estado = 'eq.' + filtro.estado;
    else params.limit = 1000;
    if (filtro.destino) params.destino = 'eq.' + filtro.destino;
    const [ocs, sinOC] = await Promise.all([Api.select('ordenes_compra', params), puedeArmar() ? pedidosSinOC() : Promise.resolve([])]);

    const porOT = new Map();
    for (const p of sinOC) {
      if (!porOT.has(p.ot_id)) porOT.set(p.ot_id, { ot: p.ot, items: [] });
      porOT.get(p.ot_id).items.push(p);
    }
    const paraAprobar = ocs.filter(o => o.estado === 'PARA APROBAR').length;
    main.innerHTML = `
      <div class="encabezado"><div><h1>Órdenes de compra</h1><div class="sub" id="oc-cuenta"></div></div>
        <div class="acciones"><a class="btn" href="#/proveedores">Proveedores</a>
          ${puedeArmar() ? '<a class="btn btn-primario" href="#/oc-nueva">Nueva OC</a>' : ''}</div></div>
      ${esAdmin() && paraAprobar ? `<div class="aviso-box"><b>${paraAprobar} orden${paraAprobar === 1 ? '' : 'es'} de compra para aprobar.</b> Abrila, revisala y tocá Aprobar o Rechazar.</div>` : ''}
      ${porOT.size ? `<section class="tarjeta" style="border-color:var(--ambar-borde);background:var(--ambar)">
        <h2>Pedidos de repuesto sin orden de compra (${sinOC.length})</h2>
        ${[...porOT.values()].map(g => `<div class="repuesto-fila"><div class="info">
            <div class="desc"><a href="#/ot/${g.ot.id}">${esc(nroOT(g.ot.numero))}</a> · ${esc(g.ot.unidad ? g.ot.unidad.dominio : '')}${g.ot.cliente ? ' · ' + esc(g.ot.cliente.nombre) : ''}</div>
            <div class="cod">${g.items.map(p => `${esc(p.descripcion)} × ${num(p.cantidad)}${p.stock > 0 ? ` <b style="color:var(--verde)">(hay ${num(p.stock)} en stock)</b>` : ''}`).join(' · ')}</div></div>
          <a class="btn btn-chico btn-primario" href="#/oc-nueva/ot/${g.ot.id}/pedidos">Armar OC</a></div>`).join('')}
      </section>` : ''}
      <div class="fila-campos">
        <div class="campo"><label for="oc-estado">Estado</label><select id="oc-estado">
          <option value="abiertas">Abiertas (sin recibidas ni anuladas)</option><option value="todas">Todas</option>
          ${ESTADOS.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join('')}</select></div>
        <div class="campo"><label for="oc-destino">Destino</label><select id="oc-destino"><option value="">Todos</option>
          ${DESTINOS.map(([v, t]) => `<option value="${v}" ${filtro.destino === v ? 'selected' : ''}>${v === 'OT' ? 'OT' : esc(t)}</option>`).join('')}</select></div>
        <div class="campo"><label for="oc-texto">Buscar</label>
          <input id="oc-texto" type="search" placeholder="N° de OC, proveedor, OT, dominio o factura" value="${esc(filtro.texto)}"></div>
      </div>
      <div class="tabla-caja"><table><thead><tr><th>N° OC</th><th>Fecha</th><th>Proveedor</th><th>Destino</th><th>Estado</th><th class="num">Total</th><th>Entrega est.</th></tr></thead>
        <tbody id="oc-tbody"></tbody></table></div>
      <div style="margin-top:10px;font-weight:600" id="oc-total"></div>`;
    document.getElementById('oc-estado').value = filtro.estado;
    const pintar = () => {
      const q = filtro.texto.trim().toUpperCase();
      const lista = ocs.filter(o => !q || [nroOC(o.numero), String(o.numero), o.proveedor && o.proveedor.nombre, o.nro_factura,
        o.ot && nroOT(o.ot.numero), o.ot && String(o.ot.numero), o.ot && o.ot.unidad && o.ot.unidad.dominio, o.ot && o.ot.unidad && o.ot.unidad.interno,
        o.destino === 'STOCK' ? 'STOCK' : o.destino === 'INSUMOS' ? 'INSUMOS DEL TALLER' : '']
        .some(v => String(v || '').toUpperCase().includes(q)));
      document.getElementById('oc-cuenta').textContent = `${lista.length} OC${paraAprobar ? ` · ${paraAprobar} para aprobar` : ''}`;
      document.getElementById('oc-tbody').innerHTML = lista.length ? lista.map(o => `<tr class="clic" data-oc="${o.id}">
        <td style="white-space:nowrap"><b>${esc(nroOC(o.numero))}</b>${o.nro_factura ? `<div class="nota">Fact. ${esc(o.nro_factura)}</div>` : ''}</td><td>${fecha(o.fecha)}</td>
        <td>${esc(o.proveedor ? o.proveedor.nombre : '')}</td><td>${destinoHTML(o)}</td><td>${chipOC(o)}</td>
        <td class="num">${o.estado === 'ANULADA' ? `<s>${pesos(o.importe_total)}</s>` : pesos(o.importe_total)}</td>
        <td>${o.entrega_estimada ? fecha(o.entrega_estimada) : ''}</td></tr>`).join('')
        : `<tr><td colspan="7" class="vacio">No hay órdenes de compra para mostrar.</td></tr>`;
      const total = lista.filter(o => o.estado !== 'ANULADA').reduce((s, o) => s + Number(o.importe_total || 0), 0);
      document.getElementById('oc-total').textContent = lista.length ? `Total de la lista (sin anuladas): ${pesos(total)}` : '';
    };
    pintar();
    document.getElementById('oc-estado').addEventListener('change', ev => { filtro.estado = ev.target.value; navegar(); });
    document.getElementById('oc-destino').addEventListener('change', ev => { filtro.destino = ev.target.value; navegar(); });
    document.getElementById('oc-texto').addEventListener('input', ev => { filtro.texto = ev.target.value; pintar(); });
    on(main, 'click', 'tr[data-oc]', (ev, tr) => { if (!ev.target.closest('a')) ir('#/oc/' + tr.dataset.oc); });
  }), ROLES);

  // ---------------- Armar / modificar una OC (borrador) ----------------
  ruta(/^#\/oc-nueva(?:\/ot\/(\d+)(\/pedidos)?)?$/, protegida(async (main, otId, conPedidos) => {
    if (!puedeArmar()) { main.innerHTML = '<div class="tarjeta">No tenés acceso a esta sección.</div>'; return; }
    await editor(main, null, { otId: otId ? Number(otId) : null, agregarPedidos: !!conPedidos });
  }), ROLES);

  ruta(/^#\/oc\/(\d+)$/, protegida(async (main, id) => {
    const oc = await cargarOC(id);
    if (!oc) { main.innerHTML = '<div class="tarjeta">No se encontró la orden de compra. <a href="#/compras">Volver a Órdenes de compra</a></div>'; return; }
    if (oc.estado === 'BORRADOR' && puedeArmar()) return editor(main, oc, {});
    return vista(main, oc);
  }), ROLES);

  async function editor(main, oc, { otId, agregarPedidos }) {
    const SEL_OT = 'id,numero,estado,unidad:unidades(dominio,interno),cliente:clientes(nombre)';
    const [provs, ots] = await Promise.all([
      Api.select('proveedores', { select: 'id,nombre,cuit,condicion_pago,activo', order: 'nombre' }),
      Api.select('ordenes_trabajo', { select: SEL_OT, estado: 'not.in.(CERRADA,FACTURADA,PRUEBA)', order: 'numero.desc', limit: 1000 })]);
    let otInicial = oc ? oc.ot : null;
    if (!oc && otId) otInicial = ots.find(o => o.id === otId) || (await Api.select('ordenes_trabajo', { select: SEL_OT, id: 'eq.' + otId }))[0] || null;
    const s = {
      destino: oc ? oc.destino : 'OT',
      ot: otInicial,
      lineas: oc ? oc.lineas.map(l => ({ codigo: l.codigo || '', descripcion: l.descripcion, cantidad: Number(l.cantidad),
        precio_unitario: l.precio_unitario == null ? null : Number(l.precio_unitario), alicuota_iva: Number(l.alicuota_iva),
        pedido_id: l.pedido_id || null, nota: l.pedido ? 'Pedido de ' + (l.pedido.pedidor ? l.pedido.pedidor.nombre : 'la OT') : '', ultimo: '' })) : []
    };
    const volver = !oc && otId ? `#/ot/${otId}` : '#/compras';
    // Si la rechazaron, se muestra el motivo hasta que se vuelva a enviar.
    const hist = oc ? oc.historial : [];
    const iRech = hist.map(h => h.tipo).lastIndexOf('RECHAZADA');
    const rechazo = iRech >= 0 && hist.slice(iRech + 1).every(h => h.tipo !== 'ENVIADA A APROBAR') ? hist[iRech] : null;
    const otCerrada = s.ot && OT_CERRADA.includes(s.ot.estado);
    const opcionesProv = () => `<option value="">Elegí el proveedor…</option>
      ${provs.filter(p => p.activo || (oc && p.id === oc.proveedor_id)).map(p => `<option value="${p.id}">${esc(p.nombre)}${p.cuit ? ' · ' + esc(p.cuit) : ''}${p.activo ? '' : ' (desactivado)'}</option>`).join('')}
      <option value="__nuevo">+ Nuevo proveedor…</option>`;

    main.innerHTML = `
      <a class="volver" href="${volver}">${ICONOS.atras} ${!oc && otId ? 'Volver a la OT' : 'Órdenes de compra'}</a>
      <div class="encabezado"><div><h1>${oc ? esc(nroOC(oc.numero)) : 'Nueva orden de compra'}</h1>
          <div class="sub">${oc ? `${chipOC(oc)} · ${fecha(oc.fecha)} · armó ${esc(oc.creador ? oc.creador.nombre : '')}` : 'Se guarda como borrador. Después se envía a aprobar.'}</div></div>
        <div class="acciones">${oc ? `<a class="btn" href="#/oc/${oc.id}/imprimir">Vista previa</a><button class="btn btn-peligro" data-accion="anular">Anular</button>` : ''}</div></div>
      ${rechazo ? `<div class="error-box"><b>El Administrador la rechazó</b> (${fechaHora(rechazo.creado_en)}): ${esc(rechazo.detalle || '')}. Corregila y volvé a enviarla.</div>` : ''}
      ${otCerrada ? `<div class="error-box">La ${esc(nroOT(s.ot.numero))} está ${esc(s.ot.estado.toLowerCase())}: no se le pueden hacer compras. Elegí otra OT u otro destino.</div>` : ''}
      <section class="tarjeta"><h2>Datos</h2>
        <div class="fila-campos">
          <div class="campo"><label for="e-prov" class="obligatorio">Proveedor</label><select id="e-prov">${opcionesProv()}</select></div>
          <div class="campo"><label for="e-destino" class="obligatorio">Destino</label><select id="e-destino">
            ${DESTINOS.map(([v, t]) => `<option value="${v}" ${s.destino === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
          <div class="campo" id="e-ot-campo"><label for="e-ot" class="obligatorio">OT</label>
            <input id="e-ot" placeholder="N° de OT, dominio o cliente" value="${esc(s.ot ? textoOT(s.ot) : '')}"><div class="nota" id="e-ot-sel"></div></div>
        </div>
        <div class="fila-campos">
          <div class="campo"><label for="e-cond">Condición de pago</label><input id="e-cond" value="${esc(oc ? oc.condicion_pago || '' : '')}" placeholder="Ej.: Cuenta corriente 30 días"></div>
          <div class="campo"><label for="e-ent">Entrega estimada</label><input id="e-ent" type="date" value="${esc(oc ? oc.entrega_estimada || '' : '')}"></div>
        </div>
      </section>
      <section class="tarjeta oculto" id="e-pedidos"></section>
      <section class="tarjeta"><h2>Renglones</h2>
        <div class="tabla-caja"><table><thead><tr><th>#</th><th>Código</th><th>Descripción</th><th class="num">Cant.</th><th class="num">Precio unit. sin IVA</th><th>IVA</th><th class="num">Subtotal</th><th></th></tr></thead>
          <tbody id="e-lineas"></tbody></table></div>
        <div style="margin-top:12px"><button class="btn" data-accion="agregar-linea">+ Agregar renglón</button></div>
        <div class="nota" style="margin-top:8px">Con código de la lista, al recibirlo entra al stock${s.destino === 'OT' ? ' y queda para entregar a la OT' : ''}. Sin código (tornería, servicios, insumos sueltos) solo queda registrado como recibido.</div>
        <div id="e-totales"></div>
      </section>
      <section class="tarjeta">
        <div class="campo"><label for="e-obs">Observaciones (salen impresas en la OC)</label><textarea id="e-obs">${esc(oc ? oc.observaciones || '' : '')}</textarea></div>
        <div class="error-box oculto" id="e-error"></div>
        <div class="acciones">
          <button class="btn btn-primario" data-accion="guardar">Guardar borrador</button>
          ${esAdmin() ? '<button class="btn btn-verde" data-accion="aprobar">Guardar, aprobar y emitir</button>'
                      : '<button class="btn" data-accion="enviar">Guardar y enviar a aprobar</button>'}
        </div>
        <div class="nota" style="margin-top:8px">${esAdmin() ? 'Al aprobarla pasa a EMITIDA (ya se puede mandar al proveedor) y se le avisa a Depósito qué va a llegar.'
                                                         : 'Al enviarla le llega un aviso al Administrador para que la apruebe. Hasta que la apruebe no se puede mandar al proveedor.'}</div>
      </section>
      ${hist.length ? `<section class="tarjeta"><h2>Historial</h2>${htmlHistorial(hist)}</section>` : ''}`;

    const selProv = document.getElementById('e-prov');
    selProv.value = oc ? String(oc.proveedor_id) : '';
    let provAnterior = selProv.value;
    const tb = document.getElementById('e-lineas');
    const v = id => document.getElementById(id).value.trim();
    const mostrarError = m => { const b = document.getElementById('e-error'); b.textContent = m; b.classList.toggle('oculto', !m); if (m) b.scrollIntoView({ block: 'nearest' }); };
    const focoEn = (i, c) => { const el = tb.querySelector(`tr[data-i="${i}"] [data-c=${c}]`); if (el) el.focus(); };

    // ----- OT -----
    const campoOT = document.getElementById('e-ot-campo');
    const pintarOT = () => {
      campoOT.classList.toggle('oculto', s.destino !== 'OT');
      document.getElementById('e-ot-sel').innerHTML = s.destino !== 'OT' ? '' : s.ot
        ? `${esc(s.ot.cliente ? s.ot.cliente.nombre : '')} · ${esc(s.ot.estado)} · <a href="#/ot/${s.ot.id}">ver OT</a>` : 'Elegí la OT de la lista';
    };
    const filtrarOTs = texto => {
      const q = String(texto || '').trim().toUpperCase().replace(/\s+/g, ' ');
      const r = ots.filter(o => !q || [textoOT(o), String(o.numero), o.cliente && o.cliente.nombre].some(x => String(x || '').toUpperCase().includes(q)));
      return r.slice(0, 30);
    };
    // Mientras se escribe en el campo, la OT queda "sin elegir"; al elegir otra distinta, los renglones
    // que venían de pedidos de la OT anterior se desvinculan.
    let otPrevia = null;
    const inpOT = document.getElementById('e-ot');
    autocompletar(inpOT, {
      buscar: async texto => filtrarOTs(otPrevia && texto === textoOT(otPrevia) ? '' : texto),
      minimo: 0,
      fila: o => `<span class="ac-cod">${esc(nroOT(o.numero))}${o.unidad ? ' · ' + esc(o.unidad.dominio) : ''}${o.unidad && o.unidad.interno ? ' · INT ' + esc(o.unidad.interno) : ''}</span>
        <span class="ac-tag">${esc(o.estado)}</span><span class="ac-desc">${esc(o.cliente ? o.cliente.nombre : '')}</span>`,
      valor: o => textoOT(o),
      vacio: b => b ? `No hay OT abiertas con "${b}"` : 'No hay OT abiertas',
      alElegir: o => cambiarOT(o),
      alEscribir: () => { if (s.ot) { otPrevia = s.ot; s.ot = null; pintarOT(); } }
    });
    inpOT.addEventListener('focus', () => { if (s.ot) otPrevia = s.ot; });
    inpOT.addEventListener('blur', () => setTimeout(() => {
      // Si salió del campo sin elegir y el texto quedó como estaba, vuelve la OT que tenía.
      if (!s.ot && otPrevia && inpOT.value.trim() === textoOT(otPrevia)) { s.ot = otPrevia; pintarOT(); }
    }, 250));
    function desvincularPedidos() {
      let n = 0;
      for (const l of s.lineas) if (l.pedido_id) { l.pedido_id = null; l.nota = ''; n++; }
      if (n) { toast(`${n} renglón${n === 1 ? '' : 'es'} dejaron de estar vinculados a pedidos de la OT anterior`); pintarLineas(); }
    }
    function cambiarOT(o) {
      const antes = s.ot || otPrevia;
      s.ot = o; otPrevia = null;
      pintarOT();
      if (!antes || antes.id !== o.id) { desvincularPedidos(); cargarPedidos(); }
    }
    document.getElementById('e-destino').addEventListener('change', ev => {
      s.destino = ev.target.value;
      if (s.destino !== 'OT') desvincularPedidos();
      pintarOT(); cargarPedidos();
    });

    // ----- Proveedor -----
    selProv.addEventListener('change', async () => {
      if (selProv.value === '__nuevo') {
        const p = await formProveedor(null);
        if (p) { provs.push(p); provs.sort((a, b) => a.nombre.localeCompare(b.nombre)); selProv.innerHTML = opcionesProv(); selProv.value = String(p.id); }
        else { selProv.value = provAnterior; return; }
      }
      provAnterior = selProv.value;
      const p = provs.find(x => String(x.id) === selProv.value);
      if (p && p.condicion_pago && !v('e-cond')) document.getElementById('e-cond').value = p.condicion_pago;
    });

    // ----- Pedidos de repuesto de la OT -----
    let pedidosOT = [];
    async function cargarPedidos() {
      pedidosOT = [];
      if (s.destino === 'OT' && s.ot) {
        try {
          const otPedida = s.ot.id;
          const peds = await Api.select('pedidos_repuesto', { select: 'id,codigo,descripcion,cantidad,detalle,creado_en,pedidor:usuarios!pedidos_repuesto_pedido_por_fkey(nombre:nombre_visible)',
                                                              ot_id: 'eq.' + otPedida, estado: 'eq.PENDIENTE', order: 'creado_en' });
          const en = await pedidosEnOC(peds.map(p => p.id), oc ? oc.id : null);
          if (!s.ot || s.ot.id !== otPedida) return;      // cambiaron de OT mientras se buscaba
          pedidosOT = peds.map(p => Object.assign(p, { enOC: en.get(p.id) || null }));
        } catch (e) { toast(errMsg(e), 'error'); }
      }
      pintarPedidos();
    }
    function pintarPedidos() {
      const caja = document.getElementById('e-pedidos');
      const libres = pedidosOT.filter(p => !p.enOC && !s.lineas.some(l => l.pedido_id === p.id));
      const enOtra = pedidosOT.filter(p => p.enOC);
      caja.classList.toggle('oculto', !libres.length && !enOtra.length);
      caja.innerHTML = `<div class="encabezado" style="margin-bottom:6px"><h2>Pedidos de repuesto de la OT sin comprar</h2>
          ${libres.length > 1 ? '<button class="btn btn-chico" data-ped-todos>Agregar todos</button>' : ''}</div>
        ${libres.map(p => `<div class="repuesto-fila"><div class="info"><div class="desc">${esc(p.descripcion)} × ${num(p.cantidad)}</div>
            <div class="cod">${p.codigo ? esc(p.codigo) : 'No está en la lista de repuestos'} · pidió ${esc(p.pedidor ? p.pedidor.nombre : '')} ${fechaHora(p.creado_en)}${p.detalle ? ' · ' + esc(p.detalle) : ''}</div></div>
          <button class="btn btn-chico" data-ped-agregar="${p.id}">Agregar</button></div>`).join('') || '<div class="nota">No quedan pedidos de esta OT sin orden de compra.</div>'}
        ${enOtra.length ? `<div class="nota" style="margin-top:8px">Ya están en otra OC: ${enOtra.map(p => `${esc(p.descripcion)} (<a href="#/oc/${p.enOC.id}">${esc(nroOC(p.enOC.numero))}</a>)`).join(' · ')}</div>` : ''}`;
    }
    async function agregarPedido(p) {
      const l = { codigo: p.codigo || '', descripcion: p.descripcion, cantidad: Number(p.cantidad), precio_unitario: null, alicuota_iva: 21,
                  pedido_id: p.id, nota: 'Pedido de ' + (p.pedidor ? p.pedidor.nombre : 'la OT'), ultimo: '' };
      s.lineas.push(l);
      if (l.codigo) completarPrecio(l);
    }
    on(document.getElementById('e-pedidos'), 'click', '[data-ped-agregar]', (ev, b) => {
      const p = pedidosOT.find(x => String(x.id) === b.dataset.pedAgregar);
      if (p) { agregarPedido(p); pintarLineas(); pintarPedidos(); }
    });
    on(document.getElementById('e-pedidos'), 'click', '[data-ped-todos]', () => {
      for (const p of pedidosOT.filter(x => !x.enOC && !s.lineas.some(l => l.pedido_id === x.id))) agregarPedido(p);
      pintarLineas(); pintarPedidos();
    });

    // ----- Renglones -----
    function pintarLineas() {
      const t = totalesEstado();
      tb.innerHTML = s.lineas.length ? s.lineas.map((l, i) => `<tr data-i="${i}">
          <td>${i + 1}</td>
          <td style="min-width:150px"><input data-c="codigo" value="${esc(l.codigo)}" placeholder="Opcional" aria-label="Código del renglón ${i + 1}"></td>
          <td style="min-width:240px"><input data-c="descripcion" value="${esc(l.descripcion)}" aria-label="Descripción del renglón ${i + 1}">
            <div class="nota" data-nota>${esc([l.nota, l.ultimo].filter(Boolean).join(' · '))}</div></td>
          <td><input data-c="cantidad" class="cant-input" inputmode="decimal" value="${esc(cantTexto(l.cantidad))}" aria-label="Cantidad del renglón ${i + 1}"></td>
          <td><input data-c="precio" inputmode="decimal" style="width:130px;text-align:right" value="${esc(precioTexto(l.precio_unitario))}" placeholder="0,00" aria-label="Precio unitario sin IVA del renglón ${i + 1}"></td>
          <td><select data-c="iva" style="width:auto" aria-label="IVA del renglón ${i + 1}">${IVAS.map(a => `<option value="${a}" ${Number(l.alicuota_iva) === a ? 'selected' : ''}>${textoIVA(a)}</option>`).join('')}</select></td>
          <td class="num" data-sub style="white-space:nowrap">${pesos(t.subs[i])}</td>
          <td><button class="btn-texto" data-quitar="${i}" aria-label="Quitar el renglón ${i + 1}">Quitar</button></td></tr>`).join('')
        : '<tr><td colspan="8" class="vacio">Todavía no hay renglones. Agregá uno o traé los pedidos de la OT.</td></tr>';
      tb.querySelectorAll('input[data-c=codigo]').forEach(inp => {
        const l = s.lineas[Number(inp.closest('tr').dataset.i)];
        autocompletarRepuesto(inp, { alElegir: r => elegirRepuesto(l, r), alEscribir: val => { l.codigo = val.trim(); } });
      });
      pintarTotales();
    }
    const totalesEstado = () => totales(s.lineas.map(l => ({ cantidad: l.cantidad > 0 ? l.cantidad : 0,
      precio_unitario: l.precio_unitario > 0 ? l.precio_unitario : 0, alicuota_iva: l.alicuota_iva })));
    function pintarTotales() {
      const t = totalesEstado();
      tb.querySelectorAll('tr[data-i]').forEach(tr => { const c = tr.querySelector('[data-sub]'); if (c) c.textContent = pesos(t.subs[Number(tr.dataset.i)]); });
      const sinPrecio = s.lineas.filter(l => l.precio_unitario == null).length;
      document.getElementById('e-totales').innerHTML = s.lineas.length ? htmlTotales(t)
        + (sinPrecio ? `<div class="nota" style="text-align:right">${sinPrecio} renglón${sinPrecio === 1 ? '' : 'es'} sin precio: se puede guardar el borrador, pero para aprobarla tienen que tener precio.</div>` : '') : '';
    }
    const filaDe = l => tb.querySelector(`tr[data-i="${s.lineas.indexOf(l)}"]`);
    async function completarPrecio(l) {
      try {
        const u = await ultimoPrecio(l.codigo);
        if (!u || !s.lineas.includes(l)) return;
        l.ultimo = `Último precio ${pesos(u.precio_unitario)} + IVA (${nroOC(u.oc.numero)}${u.oc.proveedor ? ', ' + u.oc.proveedor.nombre : ''})`;
        const sinPrecio = l.precio_unitario == null;
        if (sinPrecio) { l.precio_unitario = Number(u.precio_unitario); l.alicuota_iva = Number(u.alicuota_iva); }
        const tr = filaDe(l);
        if (tr) {
          tr.querySelector('[data-nota]').textContent = [l.nota, l.ultimo].filter(Boolean).join(' · ');
          if (sinPrecio) { tr.querySelector('[data-c=precio]').value = precioTexto(l.precio_unitario); tr.querySelector('[data-c=iva]').value = String(l.alicuota_iva); }
        }
        pintarTotales();
      } catch (e) { /* sin historial de precios */ }
    }
    function elegirRepuesto(l, r) {
      l.codigo = r.codigo; l.descripcion = r.descripcion; l.ultimo = '';
      const tr = filaDe(l);
      if (tr) {
        tr.querySelector('[data-c=descripcion]').value = r.descripcion;
        tr.querySelector('[data-nota]').textContent = l.nota || '';
        tr.querySelector('[data-c=cantidad]').focus();
      }
      completarPrecio(l);
    }
    const leerCampo = el => {
      const tr = el.closest('tr[data-i]');
      const l = tr && s.lineas[Number(tr.dataset.i)];
      if (!l) return;
      const c = el.dataset.c;
      if (c === 'descripcion') l.descripcion = el.value;
      else if (c === 'cantidad') l.cantidad = parseNum(el.value);
      else if (c === 'precio') l.precio_unitario = el.value.trim() === '' ? null : parsePrecio(el.value);
      else if (c === 'iva') l.alicuota_iva = Number(el.value);
      pintarTotales();
    };
    on(tb, 'input', '[data-c=descripcion], [data-c=cantidad], [data-c=precio]', (ev, el) => leerCampo(el));
    on(tb, 'change', '[data-c=iva]', (ev, el) => leerCampo(el));
    tb.addEventListener('focusout', ev => {
      const el = ev.target;
      if (!el.matches || !el.matches('[data-c=precio]')) return;
      const l = s.lineas[Number(el.closest('tr').dataset.i)];
      if (l && l.precio_unitario != null && !isNaN(l.precio_unitario)) el.value = precioTexto(l.precio_unitario);
    });
    on(tb, 'click', '[data-quitar]', (ev, b) => {
      s.lineas.splice(Number(b.dataset.quitar), 1);
      pintarLineas(); pintarPedidos();
    });
    on(main, 'click', '[data-accion=agregar-linea]', () => {
      s.lineas.push({ codigo: '', descripcion: '', cantidad: 1, precio_unitario: null, alicuota_iva: 21, pedido_id: null, nota: '', ultimo: '' });
      pintarLineas(); focoEn(s.lineas.length - 1, 'codigo');
    });

    // ----- Guardar -----
    function armar() {
      const err = [];
      const prov = selProv.value && selProv.value !== '__nuevo' ? Number(selProv.value) : null;
      if (!prov) err.push('Elegí el proveedor');
      if (s.destino === 'OT' && !s.ot) err.push('Elegí la OT de la lista');
      if (!s.lineas.length) err.push('Agregá al menos un renglón');
      s.lineas.forEach((l, i) => {
        if (!String(l.descripcion || '').trim() && !l.codigo) err.push(`Renglón ${i + 1}: escribí qué se compra`);
        if (!(l.cantidad > 0)) err.push(`Renglón ${i + 1}: la cantidad tiene que ser mayor a cero`);
        if (l.precio_unitario != null && !(l.precio_unitario >= 0)) err.push(`Renglón ${i + 1}: el precio no es válido`);
      });
      if (err.length) { mostrarError(err.join(' · ')); return null; }
      mostrarError('');
      return {
        datos: { proveedor_id: prov, destino: s.destino, ot_id: s.destino === 'OT' ? s.ot.id : null,
                 entrega_estimada: v('e-ent') || null, condicion_pago: v('e-cond') || null, observaciones: v('e-obs') || null },
        lineas: s.lineas.map(l => ({ codigo: l.codigo || null, descripcion: String(l.descripcion || '').trim() || null, cantidad: l.cantidad,
                                     precio_unitario: l.precio_unitario, alicuota_iva: l.alicuota_iva, pedido_id: l.pedido_id || null }))
      };
    }
    const botones = () => main.querySelectorAll('[data-accion=guardar], [data-accion=enviar], [data-accion=aprobar]');
    async function guardar(despues) {
      const x = armar();
      if (!x) return;
      botones().forEach(b => { b.disabled = true; });
      let id = oc ? oc.id : null;
      try { id = await Api.rpc('guardar_oc', { p_id: id, p_datos: x.datos, p_lineas: x.lineas }); }
      catch (e) { botones().forEach(b => { b.disabled = false; }); return mostrarError(errMsg(e)); }
      if (despues) {
        try {
          await Api.rpc(despues, { p_id: Number(id) });
          toast(despues === 'aprobar_oc' ? 'Orden de compra aprobada: ya está EMITIDA' : 'Enviada a aprobar: le llegó un aviso al Administrador');
        } catch (e) { toast('Se guardó el borrador, pero no se pudo ' + (despues === 'aprobar_oc' ? 'aprobar' : 'enviar') + ': ' + errMsg(e), 'error'); }
      } else toast(oc ? 'Borrador guardado' : 'Orden de compra creada como borrador');
      ir('#/oc/' + id);
    }
    on(main, 'click', '[data-accion=guardar]', () => guardar(null));
    on(main, 'click', '[data-accion=enviar]', () => guardar('enviar_oc'));
    on(main, 'click', '[data-accion=aprobar]', () => guardar('aprobar_oc'));
    on(main, 'click', '[data-accion=anular]', async () => { if (await anular(oc)) navegar(); });

    pintarOT();
    pintarLineas();
    await cargarPedidos();
    if (agregarPedidos) {
      const libres = pedidosOT.filter(p => !p.enOC);
      for (const p of libres) agregarPedido(p);
      if (libres.length) { pintarLineas(); pintarPedidos(); toast(`Se agregaron ${libres.length} pedido${libres.length === 1 ? '' : 's'} de la OT`); }
    }
    if (!oc && !selProv.value) selProv.focus();
  }

  // ---------------- Acciones ----------------
  async function anular(oc) {
    const v = await modal({ titulo: 'Anular ' + nroOC(oc.numero), textoOk: 'Anular orden de compra', textoCancelar: 'Volver', peligro: true,
      html: `<p class="nota">Queda en el historial como anulada. ${oc.estado === 'EMITIDA' ? 'Se le avisa a Depósito que no la reciba.' : ''}</p>`,
      campos: [{ id: 'motivo', label: '¿Por qué se anula?', tipo: 'textarea', obligatorio: true }] });
    if (!v) return false;
    try { await Api.rpc('anular_oc', { p_id: oc.id, p_motivo: v.motivo.trim() }); toast('Orden de compra anulada'); return true; }
    catch (e) { toast(errMsg(e), 'error'); return false; }
  }

  async function recibir(oc) {
    const pend = oc.lineas.filter(l => Number(l.cantidad_recibida) < Number(l.cantidad));
    const falta = l => Math.round((Number(l.cantidad) - Number(l.cantidad_recibida)) * 100) / 100;
    const html = `<p class="nota" style="margin-top:0">Lo que tiene código entra al stock${oc.destino === 'OT' ? ' y queda para entregar a la OT' : ''}.
        Corregí la cantidad si llegó menos; lo que no llegó, dejalo en 0.</p>
      <div class="tabla-caja" style="margin-bottom:12px"><table><thead><tr><th>Renglón</th><th class="num">Falta</th><th class="num">Llegó</th></tr></thead><tbody>
      ${pend.map(l => `<tr><td>${esc(l.descripcion)}<div class="nota">${l.codigo ? esc(l.codigo) : 'Sin código: no entra al stock'}</div></td>
        <td class="num">${num(falta(l))}</td>
        <td><input data-rc="${l.id}" class="cant-input" inputmode="decimal" value="${esc(cantTexto(falta(l)))}" aria-label="Cantidad que llegó de ${esc(l.descripcion)}"></td></tr>`).join('')}
      </tbody></table></div>`;
    const espera = modal({ titulo: 'Recibir mercadería · ' + nroOC(oc.numero), textoOk: 'Registrar recepción', html,
      campos: [{ id: 'remito', label: 'N° de remito', valor: '' }, { id: 'obs', label: 'Observación (opcional)', valor: '' }] });
    const cants = {};
    document.querySelectorAll('.modal [data-rc]').forEach(inp => {
      cants[inp.dataset.rc] = inp.value;
      inp.addEventListener('input', () => { cants[inp.dataset.rc] = inp.value; });
    });
    const v = await espera;
    if (!v) return false;
    const items = [];
    for (const l of pend) {
      const txt = String(cants[l.id] == null ? '' : cants[l.id]).trim();
      const c = txt === '' ? 0 : parseNum(txt);
      if (isNaN(c) || c < 0) { toast(`La cantidad de ${l.descripcion} no es válida`, 'error'); return false; }
      if (c > falta(l)) { toast(`De ${l.descripcion} faltaban ${num(falta(l))}: no se puede recibir ${num(c)}`, 'error'); return false; }
      if (c > 0) items.push({ linea_id: l.id, cantidad: c });
    }
    if (!items.length) { toast('Indicá la cantidad de al menos un renglón que llegó', 'error'); return false; }
    try {
      await Api.rpc('recibir_oc', { p_id: oc.id, p_remito: v.remito.trim() || null, p_items: items, p_observacion: v.obs.trim() || null });
      toast(oc.destino === 'OT' ? 'Recepción registrada: entró al stock y quedó para entregar a la OT' : 'Recepción registrada: entró al stock');
      return true;
    } catch (e) { toast(errMsg(e), 'error'); return false; }
  }

  function htmlHistorial(hist) {
    return hist.slice().reverse().map(h => `<div style="padding:6px 0;border-bottom:1px solid var(--linea)">
      <span class="nota">${fechaHora(h.creado_en)} · ${esc(h.usuario ? h.usuario.nombre : '')}</span>
      <div><b>${esc(h.tipo)}</b>${h.detalle ? ': ' + esc(h.detalle) : ''}</div></div>`).join('');
  }

  // ---------------- Ver una OC (para aprobar, emitida, recibida o anulada) ----------------
  function vista(main, oc) {
    const admin = esAdmin(), arma = puedeArmar();
    const recibido = oc.recepciones.length > 0;
    const t = totales(oc.lineas);
    const p = oc.proveedor || {};
    const emitida = EMITIDAS.includes(oc.estado);
    const entrega = tiene('DEPOSITO') || admin;
    const acciones = [`<a class="btn" href="#/oc/${oc.id}/imprimir">Imprimir / PDF</a>`];
    if (oc.estado === 'PARA APROBAR' && admin) acciones.push('<button class="btn btn-verde" data-accion="aprobar">Aprobar y emitir</button>', '<button class="btn btn-peligro" data-accion="rechazar">Rechazar</button>');
    if (['EMITIDA', 'RECIBIDA PARCIAL'].includes(oc.estado) && puedeRecibir()) acciones.push('<button class="btn btn-primario" data-accion="recibir">Recibir mercadería</button>');
    if (oc.estado === 'RECIBIDA PARCIAL' && arma) acciones.push('<button class="btn" data-accion="cerrar">Cerrar con faltante</button>');
    if ((oc.estado === 'PARA APROBAR' && arma) || (oc.estado === 'EMITIDA' && admin && !recibido)) acciones.push('<button class="btn" data-accion="borrador">Volver a borrador</button>');
    if (oc.estado !== 'ANULADA' && !recibido && (oc.estado === 'PARA APROBAR' ? arma : admin)) acciones.push('<button class="btn btn-peligro" data-accion="anular">Anular</button>');
    const estadoPedido = ped => !ped ? '' : ped.estado === 'PENDIENTE' ? '<span class="chip ambar">Falta entregar a la OT</span>'
      : ped.estado === 'RESUELTO' ? '<span class="chip verde">Entregado a la OT</span>' : '<span class="chip">Pedido cancelado</span>';
    const pedidos = new Map();
    for (const r of oc.recepciones) for (const i of r.items || []) if (i.pedido) pedidos.set(i.pedido.id, i.pedido);

    main.innerHTML = `
      <a class="volver no-imprimir" href="#/compras">${ICONOS.atras} Órdenes de compra</a>
      <div class="encabezado"><div><h1>${esc(nroOC(oc.numero))}</h1>
          <div class="sub">${chipOC(oc)} · ${esc(p.nombre || '')} · ${destinoHTML(oc)}</div></div>
        <div class="acciones">${acciones.join('')}</div></div>
      ${oc.estado === 'PARA APROBAR' ? `<div class="aviso-box">${admin ? '<b>Para aprobar.</b> Revisá proveedor, renglones y precios, y tocá Aprobar o Rechazar.'
          : `<b>Esperando la aprobación del Administrador.</b> La envió ${esc(oc.enviador ? oc.enviador.nombre : '')} el ${fechaHora(oc.enviada_en)}. Hasta que la apruebe no se manda al proveedor.`}</div>` : ''}
      ${oc.estado === 'ANULADA' ? `<div class="error-box"><b>Anulada</b> por ${esc(oc.anulador ? oc.anulador.nombre : '')} el ${fechaHora(oc.anulada_en)}: ${esc(oc.motivo_anulacion || '')}</div>` : ''}
      ${oc.cerrada_en ? `<div class="aviso-box"><b>Cerrada con faltante</b> por ${esc(oc.cerrador ? oc.cerrador.nombre : '')} el ${fechaHora(oc.cerrada_en)}: ${esc(oc.motivo_cierre || '')}</div>` : ''}
      <div class="dos-col">
        <div class="principal">
          <section class="tarjeta"><h2>Renglones</h2>
            <div class="tabla-caja"><table><thead><tr><th>#</th><th>Código</th><th>Descripción</th><th class="num">Cant.</th>${emitida ? '<th class="num">Recibido</th>' : ''}
              <th class="num">Precio unit.</th><th>IVA</th><th class="num">Subtotal</th></tr></thead><tbody>
              ${oc.lineas.map((l, i) => {
                const rec = Number(l.cantidad_recibida), cant = Number(l.cantidad);
                return `<tr><td>${l.renglon}</td><td style="white-space:nowrap">${esc(l.codigo || '—')}</td>
                  <td style="min-width:180px">${esc(l.descripcion)}${l.pedido ? `<div class="nota">Pedido de ${esc(l.pedido.pedidor ? l.pedido.pedidor.nombre : 'la OT')}</div>` : ''}${!l.codigo ? '<div class="nota">Sin código: no entra al stock</div>' : ''}</td>
                  <td class="num">${num(cant)}</td>
                  ${emitida ? `<td class="num">${rec >= cant ? `<span class="chip verde">${num(rec)} ✓</span>` : rec > 0 ? `<span class="chip celeste">${num(rec)}</span>` : '0'}</td>` : ''}
                  <td class="num" style="white-space:nowrap">${l.precio_unitario == null ? '<span class="nota">Sin precio</span>' : pesos(l.precio_unitario)}</td>
                  <td style="white-space:nowrap">${textoIVA(l.alicuota_iva)}</td><td class="num" style="white-space:nowrap">${pesos(t.subs[i])}</td></tr>`;
              }).join('')}
            </tbody></table></div>
            ${htmlTotales(t)}
          </section>
          ${emitida || recibido ? `<section class="tarjeta"><h2>Recepciones</h2>
            ${oc.recepciones.length ? oc.recepciones.map(r => `<div style="padding:8px 0;border-bottom:1px solid var(--linea)">
              <div class="encabezado" style="margin:0;align-items:center"><div><b>${fechaHora(r.creado_en)}</b>${r.remito ? ' · Remito ' + esc(r.remito) : ''} · recibió ${esc(r.creador ? r.creador.nombre : '')}</div>
                <div class="acciones">${r.ingreso_id ? `<a class="btn-texto" href="#/ingreso/${r.ingreso_id}">Ver ingreso de stock</a>` : ''}
                  ${puedeRecibir() && oc.estado !== 'ANULADA' ? `<button class="btn-texto" style="color:var(--rojo)" data-anular-rec="${r.id}">Anular recepción</button>` : ''}</div></div>
              ${r.observacion ? `<div class="nota">${esc(r.observacion)}</div>` : ''}
              ${(r.items || []).map(it => { const l = oc.lineas.find(x => x.id === it.linea_id) || {}; const ped = it.pedido && pedidos.get(it.pedido.id);
                return `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px">• ${esc(l.descripcion || '')} × ${num(it.cantidad)} ${estadoPedido(ped)}
                  ${ped && ped.estado === 'PENDIENTE' && entrega ? `<button class="btn-texto" data-entregar-ped="${ped.id}">Entregar a la OT</button>` : ''}</div>`; }).join('')}
            </div>`).join('') : '<div class="nota">Todavía no llegó nada.</div>'}
          </section>` : ''}
          <section class="tarjeta"><h2>Historial</h2>${htmlHistorial(oc.historial) || '<div class="nota">Sin movimientos.</div>'}</section>
        </div>
        <div class="secundaria">
          <section class="tarjeta"><h2>Proveedor</h2>
            <div class="datos">
              <div class="dato" style="grid-column:1/-1"><div class="et">Proveedor</div><div class="va">${esc(p.nombre || '')}${p.activo === false ? ' <span class="chip">Desactivado</span>' : ''}</div></div>
              <div class="dato"><div class="et">CUIT</div><div class="va">${esc(p.cuit || '—')}</div></div>
              <div class="dato"><div class="et">Teléfono</div><div class="va">${esc(p.telefono || '—')}</div></div>
              <div class="dato"><div class="et">Contacto</div><div class="va">${esc(p.contacto || '—')}</div></div>
              <div class="dato"><div class="et">Email</div><div class="va">${p.email ? `<a href="mailto:${esc(p.email)}?subject=${encodeURIComponent('Orden de compra ' + nroOC(oc.numero))}">${esc(p.email)}</a>` : '—'}</div></div>
            </div></section>
          <section class="tarjeta"><h2>Datos de la OC</h2>
            <div class="datos" style="margin-bottom:14px">
              <div class="dato"><div class="et">Fecha</div><div class="va">${fecha(oc.fecha)}</div></div>
              <div class="dato"><div class="et">Destino</div><div class="va">${destinoHTML(oc)}</div></div>
              ${oc.ot && oc.ot.cliente ? `<div class="dato"><div class="et">Cliente de la OT</div><div class="va">${esc(oc.ot.cliente.nombre)}</div></div>` : ''}
              <div class="dato"><div class="et">Condición de pago</div><div class="va">${esc(oc.condicion_pago || '—')}</div></div>
              <div class="dato"><div class="et">Armó</div><div class="va">${esc(oc.creador ? oc.creador.nombre : '—')}</div></div>
              <div class="dato"><div class="et">Aprobó</div><div class="va">${oc.aprobador ? esc(oc.aprobador.nombre) + `<div class="nota">${fechaHora(oc.aprobada_en)}</div>` : '—'}</div></div>
            </div>
            <form id="f-oc-datos">
              <div class="campo"><label for="d-fac">N° de factura del proveedor</label><input id="d-fac" value="${esc(oc.nro_factura || '')}" ${arma && oc.estado !== 'ANULADA' ? '' : 'disabled'}></div>
              <div class="campo"><label for="d-ent">Entrega estimada</label><input id="d-ent" type="date" value="${esc(oc.entrega_estimada || '')}" ${arma && oc.estado !== 'ANULADA' ? '' : 'disabled'}></div>
              <div class="campo"><label for="d-obs">Observaciones</label><textarea id="d-obs" ${arma && oc.estado !== 'ANULADA' ? '' : 'disabled'}>${esc(oc.observaciones || '')}</textarea></div>
              ${arma && oc.estado !== 'ANULADA' ? '<button class="btn btn-primario" type="submit" style="width:100%">Guardar datos</button>' : ''}
            </form></section>
        </div>
      </div>`;

    const hacer = async (fn, args, ok) => {
      try { await Api.rpc(fn, args); toast(ok); navegar(); }
      catch (e) { toast(errMsg(e), 'error'); }
    };
    on(main, 'click', '[data-accion=aprobar]', async () => {
      if (!(await confirmar(`¿Aprobar la ${nroOC(oc.numero)} a ${p.nombre} por ${pesos(t.total)}? Pasa a EMITIDA y se le avisa a Depósito.`, { titulo: 'Aprobar orden de compra', textoOk: 'Aprobar y emitir' }))) return;
      hacer('aprobar_oc', { p_id: oc.id }, 'Orden de compra aprobada: ya está EMITIDA');
    });
    on(main, 'click', '[data-accion=rechazar]', async () => {
      const v = await modal({ titulo: 'Rechazar ' + nroOC(oc.numero), textoOk: 'Rechazar', peligro: true,
        html: '<p class="nota">Vuelve a borrador y le llega el motivo a quien la armó.</p>',
        campos: [{ id: 'motivo', label: '¿Qué hay que corregir?', tipo: 'textarea', obligatorio: true }] });
      if (v) hacer('rechazar_oc', { p_id: oc.id, p_motivo: v.motivo.trim() }, 'Orden de compra rechazada');
    });
    on(main, 'click', '[data-accion=borrador]', async () => {
      const msj = oc.estado === 'EMITIDA' ? '¿Volver la orden de compra a borrador para corregirla? Se le avisa a Depósito que no la reciba hasta que se vuelva a emitir, y hay que aprobarla de nuevo.'
                                          : '¿Volver a borrador para corregirla? Después hay que enviarla a aprobar de nuevo.';
      if (await confirmar(msj, { titulo: 'Volver a borrador', textoOk: 'Volver a borrador' })) hacer('volver_oc_a_borrador', { p_id: oc.id }, 'La orden de compra volvió a borrador');
    });
    on(main, 'click', '[data-accion=anular]', async () => { if (await anular(oc)) navegar(); });
    on(main, 'click', '[data-accion=recibir]', async () => { if (await recibir(oc)) navegar(); });
    on(main, 'click', '[data-accion=cerrar]', async () => {
      const v = await modal({ titulo: 'Cerrar con faltante', textoOk: 'Cerrar orden de compra',
        html: `<p>No llegó: ${esc(oc.lineas.filter(l => Number(l.cantidad_recibida) < Number(l.cantidad)).map(l => `${l.descripcion} × ${num(Number(l.cantidad) - Number(l.cantidad_recibida))}`).join('; '))}</p>
               <p class="nota">Lo que falta deja de esperarse. Si era para una OT, los pedidos quedan libres para otra OC.</p>`,
        campos: [{ id: 'motivo', label: '¿Por qué no va a llegar el resto?', tipo: 'textarea', obligatorio: true }] });
      if (v) hacer('cerrar_oc_con_faltante', { p_id: oc.id, p_motivo: v.motivo.trim() }, 'Orden de compra cerrada con faltante');
    });
    on(main, 'click', '[data-anular-rec]', async (ev, b) => {
      const r = oc.recepciones.find(x => String(x.id) === b.dataset.anularRec);
      const v = await modal({ titulo: 'Anular recepción', textoOk: 'Anular recepción', textoCancelar: 'Volver', peligro: true,
        html: `<p>${fechaHora(r.creado_en)}${r.remito ? ' · Remito ' + esc(r.remito) : ''}</p>
               <p class="nota">Se descuenta del stock lo que entró y la OC vuelve a esperar esa mercadería. Si ya se entregó a la OT, primero hay que quitarlo de la OT.</p>`,
        campos: [{ id: 'motivo', label: '¿Por qué se anula?', tipo: 'textarea', obligatorio: true }] });
      if (v) hacer('anular_recepcion_oc', { p_recepcion_id: r.id, p_motivo: v.motivo.trim() }, 'Recepción anulada: el stock volvió atrás');
    });
    on(main, 'click', '[data-entregar-ped]', async (ev, b) => {
      const ped = pedidos.get(Number(b.dataset.entregarPed));
      if (ped && await App.accionPedido('entregar', ped)) navegar();
    });
    document.getElementById('f-oc-datos').addEventListener('submit', ev => {
      ev.preventDefault();
      const val = id => document.getElementById(id).value.trim() || null;
      hacer('modificar_oc_datos', { p_id: oc.id, p_datos: { nro_factura: val('d-fac'), entrega_estimada: val('d-ent'), observaciones: val('d-obs') } }, 'Datos guardados');
    });
  }

  // ---------------- Impresión / PDF (una hoja A4) ----------------
  function ajustarHoja() {
    const hoja = document.getElementById('hoja'), cont = document.getElementById('hoja-contenido');
    if (!hoja || !cont) return;
    const es = getComputedStyle(hoja);
    const disponible = (hoja.clientHeight - parseFloat(es.paddingTop) - parseFloat(es.paddingBottom)) * 0.985;
    const alto = z => { cont.style.zoom = String(z); return cont.getBoundingClientRect().height; };
    if (alto(1) <= disponible) { cont.style.zoom = '1'; return; }
    let bajo = 0.35, arriba = 1;
    for (let i = 0; i < 12; i++) { const m = (bajo + arriba) / 2; if (alto(m) <= disponible) bajo = m; else arriba = m; }
    cont.style.zoom = String(Math.floor(bajo * 1000) / 1000);
  }

  ruta(/^#\/oc\/(\d+)\/imprimir$/, protegida(async (main, id) => {
    const [oc, emp] = await Promise.all([cargarOC(id),
      Api.select('configuracion', { select: 'clave,valor', clave: 'in.(empresa_razon_social,empresa_cuit,empresa_direccion,empresa_telefono,empresa_email)' }).catch(() => [])]);
    if (!oc) { main.innerHTML = '<div class="tarjeta">No se encontró la orden de compra.</div>'; return; }
    const e = Object.fromEntries(emp.map(c => [c.clave, c.valor || '']));
    const p = oc.proveedor || {};
    const t = totales(oc.lineas);
    const valida = EMITIDAS.includes(oc.estado);
    const tituloAnterior = document.title;
    document.title = nroOC(oc.numero) + ' - ' + (p.nombre || '');
    st.limpiar.push(() => { document.title = tituloAnterior; window.removeEventListener('beforeprint', ajustarHoja); });
    const destino = oc.destino === 'OT' ? (oc.ot ? `${nroOT(oc.ot.numero)}${oc.ot.unidad ? ' · Dominio ' + oc.ot.unidad.dominio : ''}${oc.ot.unidad && oc.ot.unidad.interno ? ' · INT ' + oc.ot.unidad.interno : ''}` : 'OT')
      : oc.destino === 'STOCK' ? 'Stock' : 'Insumos del taller';
    main.innerHTML = `
      <div class="acciones no-imprimir" style="margin-bottom:12px">
        <a class="btn" href="#/oc/${oc.id}">${ICONOS.atras} Volver a la OC</a>
        <button class="btn btn-primario" data-accion="imprimir">Imprimir / Guardar PDF</button>
        <span class="nota">Para mandarla por mail o WhatsApp, elegí "Guardar como PDF" en la impresora.</span></div>
      ${valida ? '' : `<div class="aviso-box no-imprimir">Esta orden de compra está <b>${esc(oc.estado.toLowerCase())}</b>: sale marcada como NO VÁLIDA${oc.estado === 'ANULADA' ? '' : ' hasta que el Administrador la apruebe'}.</div>`}
      <div class="hoja-marco"><div class="hoja" id="hoja"><div class="hoja-contenido" id="hoja-contenido">
        <div class="oc-cab">
          <div><div class="oc-razon">${esc(e.empresa_razon_social || cfg.empresa)}</div>
            ${e.empresa_direccion ? `<div>${esc(e.empresa_direccion)}</div>` : ''}
            ${e.empresa_cuit ? `<div>CUIT ${esc(e.empresa_cuit)}</div>` : ''}
            ${e.empresa_telefono || e.empresa_email ? `<div>${esc([e.empresa_telefono && 'Tel. ' + e.empresa_telefono, e.empresa_email].filter(Boolean).join(' · '))}</div>` : ''}</div>
          <div class="oc-titulo"><h1>ORDEN DE COMPRA</h1><div class="oc-nro">N° ${esc(nroOC(oc.numero))}</div><div>Fecha: ${fecha(oc.fecha)}</div>
            ${valida ? '' : `<div class="oc-novalida">${oc.estado === 'ANULADA' ? 'ANULADA' : 'NO VÁLIDA · SIN APROBAR'}</div>`}</div>
        </div>
        <div class="seccion">PROVEEDOR</div>
        <table><tr><th style="width:17%">Proveedor</th><td colspan="3"><b>${esc(p.nombre || '')}</b></td></tr>
          <tr><th>CUIT</th><td>${esc(p.cuit || '')}</td><th style="width:13%">Teléfono</th><td>${esc(p.telefono || '')}</td></tr>
          <tr><th>Dirección</th><td>${esc(p.direccion || '')}</td><th>Email</th><td>${esc(p.email || '')}</td></tr>
          <tr><th>Contacto</th><td colspan="3">${esc(p.contacto || '')}</td></tr></table>
        <div class="seccion">CONDICIONES</div>
        <table><tr><th style="width:17%">Condición de pago</th><td>${esc(oc.condicion_pago || '')}</td><th style="width:17%">Entrega estimada</th><td>${fecha(oc.entrega_estimada)}</td></tr>
          <tr><th>Destino</th><td colspan="3">${esc(destino)}</td></tr></table>
        <div class="seccion">DETALLE</div>
        <table><tr><th style="width:5%">#</th><th style="width:15%">Código</th><th>Descripción</th><th style="width:8%">Cant.</th><th style="width:14%">Precio unit.</th><th style="width:8%">IVA</th><th style="width:15%">Subtotal</th></tr>
          ${oc.lineas.map((l, i) => `<tr><td>${l.renglon}</td><td>${esc(l.codigo || '')}</td><td>${esc(l.descripcion)}</td><td style="text-align:right">${num(l.cantidad)}</td>
            <td style="text-align:right;white-space:nowrap">${l.precio_unitario == null ? '' : pesos(l.precio_unitario)}</td><td style="text-align:right;white-space:nowrap">${textoIVA(l.alicuota_iva)}</td>
            <td style="text-align:right;white-space:nowrap">${pesos(t.subs[i])}</td></tr>`).join('') || '<tr><td colspan="7">—</td></tr>'}</table>
        <div class="oc-pie">
          <div class="oc-obs">${oc.observaciones ? `<div class="seccion" style="margin-top:0">OBSERVACIONES</div><div class="caja" style="min-height:0">${esc(oc.observaciones)}</div>` : ''}
            <div class="oc-leyenda">Por favor, indicar el N° de orden de compra en el remito y en la factura.</div></div>
          <table class="oc-tot"><tr><th>Subtotal sin IVA</th><td>${pesos(t.neto)}</td></tr>
            ${t.ivas.filter(x => x.alic > 0).map(x => `<tr><th>IVA ${textoIVA(x.alic)}</th><td>${pesos(x.iva)}</td></tr>`).join('')}
            <tr><th>TOTAL</th><td><b>${pesos(t.total)}</b></td></tr></table>
        </div>
        <div class="firmas">
          <div><div>Emitió:</div><div class="linea-firma"></div><div>${esc(oc.creador ? oc.creador.nombre : '')}</div></div>
          <div><div>Autorizó:</div><div class="linea-firma"></div><div>${esc(oc.aprobador ? oc.aprobador.nombre : '')}</div></div>
        </div>
      </div></div></div>`;
    on(main, 'click', '[data-accion=imprimir]', () => window.print());
    ajustarHoja();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(ajustarHoja);
    window.addEventListener('beforeprint', ajustarHoja);
  }), ROLES);

  // ---------------- Dentro de la OT (lo usa la pantalla de la OT) ----------------
  // OC de la OT y qué pedidos de repuesto ya están cubiertos por alguna.
  async function datosOT(otId) {
    const ocs = await Api.select('ordenes_compra', {
      select: 'id,numero,estado,fecha,cerrada_en,importe_total,proveedor:proveedores!ordenes_compra_proveedor_id_fkey(nombre),lineas:ordenes_compra_lineas!ordenes_compra_lineas_oc_id_fkey(pedido_id),' +
              'recepciones:ordenes_compra_recepciones!ordenes_compra_recepciones_oc_id_fkey(items:ordenes_compra_recepcion_items!ordenes_compra_recepcion_items_recepcion_id_fkey(pedido_id))',
      ot_id: 'eq.' + otId, order: 'numero' });
    const pedidoOC = new Map();
    for (const o of ocs) {
      if (o.estado === 'ANULADA') continue;
      if (!o.cerrada_en) for (const l of o.lineas || []) if (l.pedido_id) pedidoOC.set(l.pedido_id, o);
      for (const r of o.recepciones || []) for (const i of r.items || []) if (i.pedido_id) pedidoOC.set(i.pedido_id, o);
    }
    return { ocs, pedidoOC };
  }
  const seguro = fn => (...args) => { try { return fn(...args); } catch (e) { console.error(e); return ''; } };
  const chipPedidoOT = (datos, pedidoId) => {
    const o = datos && datos.pedidoOC.get(pedidoId);
    return o ? ` <a class="chip celeste" style="text-decoration:none" href="#/oc/${o.id}" title="Orden de compra">${esc(nroOC(o.numero))}</a>` : '';
  };
  function seccionOT(datos, ot, pedidos) {
    if (!datos) return '';
    const activa = !OT_CERRADA.includes(ot.estado);
    const sinOC = (pedidos || []).filter(p => p.estado === 'PENDIENTE' && !datos.pedidoOC.has(p.id));
    const total = datos.ocs.filter(o => o.estado !== 'ANULADA').reduce((s, o) => s + Number(o.importe_total || 0), 0);
    return `<section class="tarjeta no-imprimir"><div class="encabezado" style="margin-bottom:10px"><h2>Órdenes de compra</h2>
        ${puedeArmar() && activa ? `<a class="btn btn-chico" href="#/oc-nueva/ot/${ot.id}">Nueva OC</a>` : ''}</div>
      ${sinOC.length && puedeArmar() && activa ? `<div class="aviso-box">Hay ${sinOC.length} pedido${sinOC.length === 1 ? '' : 's'} de repuesto sin orden de compra.
        <a href="#/oc-nueva/ot/${ot.id}/pedidos"><b>Armar OC con ${sinOC.length === 1 ? 'el pedido' : 'los pedidos'}</b></a></div>` : ''}
      ${datos.ocs.length ? `<div class="tabla-caja"><table><thead><tr><th>N° OC</th><th>Fecha</th><th>Proveedor</th><th>Estado</th><th class="num">Total</th></tr></thead><tbody>
          ${datos.ocs.map(o => `<tr><td style="white-space:nowrap"><a href="#/oc/${o.id}"><b>${esc(nroOC(o.numero))}</b></a></td><td>${fecha(o.fecha)}</td>
            <td>${esc(o.proveedor ? o.proveedor.nombre : '')}</td><td>${chipOC(o)}</td>
            <td class="num" style="white-space:nowrap">${o.estado === 'ANULADA' ? `<s>${pesos(o.importe_total)}</s>` : pesos(o.importe_total)}</td></tr>`).join('')}
        </tbody></table></div>
        <div style="margin-top:10px;font-weight:600">Total en compras de esta OT (sin anuladas): ${pesos(total)}</div>`
        : '<div class="nota">Esta OT todavía no tiene órdenes de compra.</div>'}
    </section>`;
  }

  return { nroOC, pesos, chipOC, datosOT, seccionOT: seguro(seccionOT), chipPedidoOT: seguro(chipPedidoOT), faltaBase };
})();
