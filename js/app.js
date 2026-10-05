// MDE · Taller — núcleo de la app: sesión, estructura, navegación y utilidades.
window.App = (() => {
  const cfg = window.MDE_CONFIG;
  const st = {
    usuarioId: null, nombre: '', roles: [], prefijo: 'OT-',
    noLeidos: 0, limpiar: [], vistas: {}, rutaActual: ''
  };

  // ---------------- Utilidades ----------------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n, dec) => n == null || n === '' ? '' :
    Number(n).toLocaleString('es-AR', { maximumFractionDigits: dec == null ? 2 : dec });
  const parseNum = s => {
    s = String(s == null ? '' : s).trim();
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    return Number(s);
  };
  const nroOT = n => n == null ? '' : st.prefijo + String(n).padStart(6, '0');
  const fecha = d => {
    if (!d) return '';
    const x = d.length === 10 ? new Date(d + 'T00:00:00') : new Date(d);
    return x.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  const fechaHora = d => d ? new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  const hoyISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const horaActual = () => new Date().toTimeString().slice(0, 5);
  const duracion = ms => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return [h, m, x].map(v => String(v).padStart(2, '0')).join(':');
  };
  const tiene = r => st.roles.includes(r);
  const esAdmin = () => tiene('ADMINISTRADOR');
  const esOficina = () => tiene('OFICINA') || tiene('ADMINISTRADOR');
  const veTodas = () => esOficina() || tiene('DEPOSITO');
  const limpiarCodigo = c => String(c || '').replace(/\s+/g, '').toUpperCase();

  const ESTADOS_OT = ['ABIERTA', 'EN DIAGNÓSTICO', 'EN REPARACIÓN', 'ESPERANDO REPUESTOS', 'FINALIZADA', 'CERRADA', 'PRUEBA'];
  const TIPOS = ['LIVIANA', 'PESADA', 'MINIBÚS'];
  const ROLES = [['ADMINISTRADOR', 'Administrador'], ['OFICINA', 'Oficina'], ['DEPOSITO', 'Depósito'], ['MECANICO', 'Mecánico']];
  const MOTIVOS = [['FALTA DE REPUESTO', 'Falta de repuesto'], ['ESPERA DEL CLIENTE', 'Espera del cliente'],
                   ['FIN DE JORNADA', 'Fin de jornada'], ['TRABAJO EXTERNO', 'Trabajo externo'], ['OTRO', 'Otro']];
  const textoMotivo = m => (MOTIVOS.find(x => x[0] === m) || [m, m])[1];
  // Pausa abierta de una OT (las pausas vienen embebidas en la consulta de la OT)
  const pausaAbierta = ot => ot && Array.isArray(ot.pausas) ? ot.pausas.find(p => !p.fin) || null : null;
  const chipPausa = p => p ? `<span class="chip rojo">Pausada · ${esc(textoMotivo(p.motivo))}</span>` : '';

  function chipEstadoOT(e) {
    const c = { 'ABIERTA': '', 'EN DIAGNÓSTICO': 'ambar', 'EN REPARACIÓN': 'azul', 'ESPERANDO REPUESTOS': 'ambar',
                'FINALIZADA': 'verde', 'CERRADA': 'oscuro', 'PRUEBA': '' }[e] || '';
    return `<span class="chip ${c}">${esc(e)}</span>`;
  }
  function chipEstadoTarea(e) {
    const c = { 'PENDIENTE': '', 'EN CURSO': 'azul', 'PAUSADA': 'ambar', 'HECHA': 'verde' }[e] || '';
    const t = { 'PENDIENTE': 'Pendiente', 'EN CURSO': 'En curso', 'PAUSADA': 'Pausada', 'HECHA': 'Hecha' }[e] || e;
    return `<span class="chip ${c}">${esc(t)}</span>`;
  }

  function errMsg(e) {
    if (!e) return '';
    const m = e.message || String(e);
    if (/row-level security|permission denied/i.test(m)) return 'No tenés permiso para hacer esto.';
    if (/duplicate key/i.test(m)) {
      if (/dominio/i.test(m)) return 'Ese dominio ya está cargado.';
      if (/tempario/i.test(m)) return 'Esa tarea ya existe para ese tipo y categoría.';
      if (/repuestos_pkey|codigo_limpio/i.test(m)) return 'Ya existe un repuesto con ese código.';
      return 'Ya existe un registro igual.';
    }
    if (/foreign key/i.test(m)) return 'No se puede: hay datos que dependen de este registro.';
    if (/Invalid login credentials/i.test(m)) return 'Usuario o contraseña incorrectos.';
    if (/Email not confirmed/i.test(m)) return 'El usuario no está confirmado. Pedile al Administrador que lo confirme.';
    return m;
  }

  // ---------------- Avisos en pantalla ----------------
  function toast(msg, tipo) {
    const cont = document.getElementById('toast');
    const el = document.createElement('div');
    el.className = 't' + (tipo === 'error' ? ' error' : '');
    el.textContent = msg;
    cont.appendChild(el);
    setTimeout(() => el.remove(), tipo === 'error' ? 6000 : 3000);
  }

  // Ventana modal genérica. campos: [{id, label, tipo, valor, opciones, ayuda, obligatorio}]
  function modal({ titulo, html, campos, textoOk, textoCancelar, peligro, soloCerrar }) {
    return new Promise(resolve => {
      const fondo = document.createElement('div');
      fondo.className = 'modal-fondo';
      const camposHtml = (campos || []).map(c => {
        const id = 'm-' + c.id;
        let input;
        if (c.tipo === 'select') {
          input = `<select id="${id}">${c.opciones.map(o => {
            const [v, t] = Array.isArray(o) ? o : [o, o];
            return `<option value="${esc(v)}" ${String(v) === String(c.valor) ? 'selected' : ''}>${esc(t)}</option>`;
          }).join('')}</select>`;
        } else if (c.tipo === 'textarea') {
          input = `<textarea id="${id}">${esc(c.valor || '')}</textarea>`;
        } else {
          input = `<input id="${id}" type="${c.tipo || 'text'}" value="${esc(c.valor == null ? '' : c.valor)}"
                    ${c.inputmode ? `inputmode="${c.inputmode}"` : ''} ${c.autocomplete ? `autocomplete="${c.autocomplete}"` : ''}>`;
        }
        return `<div class="campo"><label for="${id}" class="${c.obligatorio ? 'obligatorio' : ''}">${esc(c.label)}</label>${input}
                ${c.ayuda ? `<div class="nota">${esc(c.ayuda)}</div>` : ''}</div>`;
      }).join('');
      fondo.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-titulo">
        <h2 id="m-titulo">${esc(titulo || '')}</h2>
        ${html || ''}${camposHtml}
        <div class="error-box oculto" id="m-error"></div>
        <div class="acciones">
          ${soloCerrar ? '' : `<button class="btn" data-m="no">${esc(textoCancelar || 'Cancelar')}</button>`}
          <button class="btn ${peligro ? 'btn-peligro' : 'btn-primario'}" data-m="si">${esc(textoOk || 'Aceptar')}</button>
        </div></div>`;
      document.body.appendChild(fondo);
      const primero = fondo.querySelector('input, select, textarea');
      (primero || fondo.querySelector('[data-m=si]')).focus();
      const cerrar = v => { fondo.remove(); document.removeEventListener('keydown', tecla); resolve(v); };
      const leer = () => {
        const o = {};
        for (const c of (campos || [])) o[c.id] = fondo.querySelector('#m-' + c.id).value;
        return o;
      };
      const aceptar = () => {
        if (!campos) return cerrar(true);
        const v = leer();
        const falta = (campos || []).find(c => c.obligatorio && !String(v[c.id]).trim());
        if (falta) {
          const err = fondo.querySelector('#m-error');
          err.textContent = 'Completá: ' + falta.label;
          err.classList.remove('oculto');
          return;
        }
        cerrar(v);
      };
      function tecla(ev) {
        if (ev.key === 'Escape') cerrar(campos ? null : false);
        if (ev.key === 'Enter' && ev.target.tagName !== 'TEXTAREA') { ev.preventDefault(); aceptar(); }
      }
      document.addEventListener('keydown', tecla);
      fondo.addEventListener('click', ev => {
        const b = ev.target.closest('[data-m]');
        if (ev.target === fondo) return cerrar(campos ? null : false);
        if (!b) return;
        if (b.dataset.m === 'no') cerrar(campos ? null : false);
        else aceptar();
      });
    });
  }
  const confirmar = (mensaje, opciones) => modal(Object.assign({ titulo: 'Confirmar', html: `<p>${esc(mensaje)}</p>` }, opciones || {}));

  // ---------------- Buscador desplegable de repuestos ----------------
  // Mientras se escribe el código o la descripción, muestra los repuestos que coinciden.
  // alElegir(repuesto) recibe { codigo, descripcion, disponible }.
  let acContador = 0;
  function resaltar(texto, buscado) {
    const t = String(texto || '');
    const b = String(buscado || '').trim();
    if (!b) return esc(t);
    const palabras = b.split(/\s+/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!palabras.length) return esc(t);
    const re = new RegExp('(' + palabras.join('|') + ')', 'ig');
    return t.split(re).map((parte, i) => i % 2 ? `<mark>${esc(parte)}</mark>` : esc(parte)).join('');
  }
  function resaltarCodigo(codigo, buscado) {
    const limpio = String(buscado || '').replace(/\s+/g, '').toUpperCase();
    const c = String(codigo || '');
    if (!limpio) return esc(c);
    // Ubica la coincidencia ignorando espacios del código
    const mapa = []; let sinEsp = '';
    for (let i = 0; i < c.length; i++) if (!/\s/.test(c[i])) { mapa.push(i); sinEsp += c[i].toUpperCase(); }
    const p = sinEsp.indexOf(limpio);
    if (p < 0) return esc(c);
    const ini = mapa[p], fin = mapa[p + limpio.length - 1] + 1;
    return esc(c.slice(0, ini)) + '<mark>' + esc(c.slice(ini, fin)) + '</mark>' + esc(c.slice(fin));
  }
  function autocompletarRepuesto(input, { alElegir, alEscribir } = {}) {
    const id = 'ac-' + (++acContador);
    const caja = document.createElement('div');
    caja.className = 'ac-caja';
    input.parentNode.insertBefore(caja, input);
    caja.appendChild(input);
    const lista = document.createElement('ul');
    lista.className = 'ac-lista oculto';
    lista.id = id;
    lista.setAttribute('role', 'listbox');
    caja.appendChild(lista);
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', id);
    input.setAttribute('aria-expanded', 'false');
    let items = [], activo = -1, timer = null, consulta = 0, buscado = '';

    const cerrar = () => { lista.classList.add('oculto'); input.setAttribute('aria-expanded', 'false'); activo = -1; };
    const marcar = i => {
      activo = i;
      lista.querySelectorAll('li[data-i]').forEach(li => li.setAttribute('aria-selected', String(Number(li.dataset.i) === i)));
      const li = lista.querySelector(`li[data-i="${i}"]`);
      if (li) { li.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', li.id); }
    };
    const pintar = () => {
      if (!items.length) {
        lista.innerHTML = `<li class="ac-vacio">No hay repuestos con "${esc(buscado)}"</li>`;
      } else {
        lista.innerHTML = items.map((r, i) => `<li role="option" id="${id}-${i}" data-i="${i}" aria-selected="false">
          <span class="ac-cod">${resaltarCodigo(r.codigo, buscado)}</span>
          <span class="ac-desc">${resaltar(r.descripcion, buscado)}</span>
          <span class="ac-stock ${Number(r.disponible) > 0 ? 'hay' : ''}">Stock ${num(r.disponible)}</span></li>`).join('');
      }
      lista.classList.remove('oculto');
      input.setAttribute('aria-expanded', 'true');
      activo = -1;
    };
    const elegir = i => {
      const r = items[i];
      if (!r) return;
      input.value = r.codigo;
      cerrar();
      if (alElegir) alElegir(r);
    };
    const buscar = async () => {
      buscado = input.value.trim();
      if (buscado.length < 2) { cerrar(); return; }
      const n = ++consulta;
      try {
        const r = await Api.rpc('buscar_repuestos', { p_texto: buscado, p_limite: 12 });
        if (n !== consulta || document.activeElement !== input) return;
        items = r || [];
        pintar();
      } catch (e) { /* sin conexión: se ignora */ }
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(buscar, 220);
      if (alEscribir) alEscribir(input.value);
    });
    input.addEventListener('focus', () => { if (input.value.trim().length >= 2 && items.length) pintar(); });
    input.addEventListener('keydown', ev => {
      const abierta = !lista.classList.contains('oculto') && items.length;
      if (ev.key === 'ArrowDown' && abierta) { ev.preventDefault(); marcar(Math.min(activo + 1, items.length - 1)); }
      else if (ev.key === 'ArrowUp' && abierta) { ev.preventDefault(); marcar(Math.max(activo - 1, 0)); }
      else if (ev.key === 'Enter' && abierta && activo >= 0) { ev.preventDefault(); ev.stopPropagation(); elegir(activo); }
      else if (ev.key === 'Escape' && !lista.classList.contains('oculto')) { ev.stopPropagation(); cerrar(); }
    });
    lista.addEventListener('pointerdown', ev => {
      const li = ev.target.closest('li[data-i]');
      ev.preventDefault();
      if (li) elegir(Number(li.dataset.i));
    });
    input.addEventListener('blur', () => setTimeout(cerrar, 120));
    return { cerrar, limpiar: () => { input.value = ''; items = []; cerrar(); } };
  }

  // ---------------- Estructura ----------------
  const ICONOS = {
    menu: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    campana: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    lista: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    escanear: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3M7 8v8M10 8v8M13 8v8M17 8v8"/></svg>',
    pedido: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    solicitudes: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 4h8l4 4v12H4V4h4M8 4v4h8M8 13h8M8 17h5"/></svg>',
    pausa: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 5v14M15 5v14"/></svg>',
    atras: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>',
    lapiz: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>'
  };

  function menuItems() {
    const items = [];
    if (tiene('MECANICO')) {
      items.push(['grupo', 'Mecánico']);
      items.push(['#/tareas', 'Mis tareas']);
      items.push(['#/pedir-ot', 'Pedir OT nueva']);
      items.push(['#/mis-solicitudes', 'Mis solicitudes']);
    }
    if (veTodas()) {
      items.push(['grupo', 'Taller']);
      items.push(['#/ots', 'Órdenes de trabajo']);
      if (esOficina()) {
        items.push(['#/ot-nueva', 'Nueva OT']);
        items.push(['#/solicitudes', 'Solicitudes']);
        items.push(['#/clientes', 'Clientes y unidades']);
      }
      items.push(['#/stock', 'Stock y repuestos']);
    }
    if (esAdmin()) {
      items.push(['grupo', 'Administración']);
      items.push(['#/tempario', 'Tempario']);
      items.push(['#/usuarios', 'Usuarios']);
      items.push(['#/reportes', 'Reportes']);
    }
    items.push(['grupo', 'General']);
    items.push(['#/avisos', 'Avisos']);
    return items;
  }

  function armarEstructura() {
    const soloMecanico = tiene('MECANICO') && !veTodas();
    document.body.classList.toggle('con-inferior', tiene('MECANICO'));
    const app = document.getElementById('app');
    app.innerHTML = `
      <header class="top">
        <button class="icono-btn" id="btn-menu" aria-label="Abrir menú">${ICONOS.menu}</button>
        <div class="marca">MDE · Taller</div>
        <span class="quien">${esc(st.nombre)}</span>
        <a href="#/avisos" class="icono-btn" aria-label="Avisos">${ICONOS.campana}<span class="badge oculto" id="badge-top"></span></a>
      </header>
      <div class="cuerpo">
        <nav class="lateral" id="lateral" aria-label="Menú">
          ${menuItems().map(([h, t]) => h === 'grupo' ? `<div class="grupo">${esc(t)}</div>` : `<a href="${h}">${esc(t)}</a>`).join('')}
          <button class="salir" id="btn-salir">Salir</button>
        </nav>
        <main id="main"></main>
      </div>
      <nav class="inferior" aria-label="Accesos rápidos">
        <a href="#/tareas">${ICONOS.lista}Tareas</a>
        <a href="#/pedir-ot">${ICONOS.pedido}Pedir OT</a>
        <a href="#/mis-solicitudes">${ICONOS.solicitudes}Solicitudes</a>
        <a href="#/avisos">${ICONOS.campana}Avisos<span class="badge oculto" id="badge-inf"></span></a>
      </nav>`;
    if (soloMecanico) document.getElementById('btn-menu').classList.add('oculto');
    document.getElementById('btn-menu').addEventListener('click', () => document.getElementById('lateral').classList.toggle('abierto'));
    document.getElementById('lateral').addEventListener('click', ev => {
      if (ev.target.closest('a')) document.getElementById('lateral').classList.remove('abierto');
    });
    document.getElementById('btn-salir').addEventListener('click', salir);
  }

  function marcarActivo(hash) {
    const base = '#/' + (hash.split('/')[1] || '');
    const alias = { '#/tarea': '#/tareas', '#/escanear': '#/tareas', '#/pausar': '#/tareas', '#/solicitar': '#/tareas',
                    '#/ot': '#/ots', '#/imprimir': '#/ots', '#/solicitud-ot': '#/solicitudes' };
    document.querySelectorAll('.lateral a, .inferior a').forEach(a => {
      a.classList.toggle('activo', a.getAttribute('href') === (alias[base] || base));
    });
  }

  // ---------------- Avisos (contador) ----------------
  async function actualizarAvisos() {
    if (!st.usuarioId) return;
    try {
      const filas = await Api.select('avisos', { select: 'id', leido: 'is.false' });
      st.noLeidos = filas.length;
      for (const id of ['badge-top', 'badge-inf']) {
        const b = document.getElementById(id);
        if (!b) continue;
        b.textContent = st.noLeidos > 99 ? '99+' : st.noLeidos;
        b.classList.toggle('oculto', st.noLeidos === 0);
      }
    } catch (e) { /* sin conexión: se reintenta en el próximo ciclo */ }
  }

  // ---------------- Navegación ----------------
  const rutas = [];
  function ruta(patron, vista, roles) { rutas.push({ patron, vista, roles }); }

  function inicio() {
    if (veTodas()) return '#/ots';
    if (tiene('MECANICO')) return '#/tareas';
    return '#/avisos';
  }

  async function navegar() {
    const hash = location.hash || inicio();
    for (const f of st.limpiar.splice(0)) { try { f(); } catch (e) { /* nada */ } }
    const viejo = document.getElementById('main');
    if (!viejo) return;
    // Cada pantalla arranca con un contenedor nuevo, sin los eventos de la anterior.
    const main = viejo.cloneNode(false);
    viejo.replaceWith(main);
    marcarActivo(hash);
    for (const r of rutas) {
      const m = hash.match(r.patron);
      if (!m) continue;
      if (r.roles && !r.roles.some(tiene)) { main.innerHTML = '<div class="tarjeta">No tenés acceso a esta sección.</div>'; return; }
      st.rutaActual = hash;
      main.innerHTML = '<div class="vacio">Cargando…</div>';
      window.scrollTo(0, 0);
      try { await r.vista(main, ...m.slice(1)); }
      catch (e) {
        console.error(e);
        if (st.rutaActual === hash) main.innerHTML = `<div class="error-box">No se pudo cargar: ${esc(errMsg(e))}</div>
          <button class="btn" onclick="location.reload()">Reintentar</button>`;
      }
      actualizarAvisos();
      return;
    }
    location.hash = inicio();
  }

  function ir(h) { if (location.hash === h) navegar(); else location.hash = h; }

  // Delegación de eventos: on(root, 'click', '[data-accion=x]', fn)
  function on(root, evento, selector, fn) {
    root.addEventListener(evento, ev => {
      const el = ev.target.closest(selector);
      if (el && root.contains(el)) fn(ev, el);
    });
  }

  // ---------------- Sesión ----------------
  function pantallaIngreso(mensaje) {
    document.body.classList.remove('con-inferior');
    document.getElementById('app').innerHTML = `
      <div class="login">
        <form id="f-login" autocomplete="on">
          <h1>MDE · Taller</h1>
          <div class="sub">${esc(cfg.empresa)}</div>
          <div class="campo"><label for="l-usuario">Usuario o email</label>
            <input id="l-usuario" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></div>
          <div class="campo"><label for="l-clave">Contraseña</label>
            <input id="l-clave" name="password" type="password" autocomplete="current-password" required></div>
          <div class="error-box ${mensaje ? '' : 'oculto'}" id="l-error">${esc(mensaje || '')}</div>
          <button class="btn btn-primario btn-grande" type="submit">Entrar</button>
        </form>
      </div>`;
    document.getElementById('f-login').addEventListener('submit', async ev => {
      ev.preventDefault();
      const u = document.getElementById('l-usuario').value.trim();
      const p = document.getElementById('l-clave').value;
      const err = document.getElementById('l-error');
      const btn = ev.target.querySelector('button');
      btn.disabled = true; btn.textContent = 'Entrando…'; err.classList.add('oculto');
      try {
        const email = u.includes('@') ? u : (u.toLowerCase() + '@' + cfg.dominioUsuarios);
        await Api.login(email, p);
        await arrancar();
      } catch (e) {
        err.textContent = errMsg(e); err.classList.remove('oculto');
        btn.disabled = false; btn.textContent = 'Entrar';
      }
    });
    document.getElementById('l-usuario').focus();
  }

  async function salir() {
    st.usuarioId = null; st.roles = [];
    await Api.logout();
    location.hash = '';
    pantallaIngreso();
  }

  let intervaloAvisos = null;
  async function arrancar() {
    if (!Api.sesion) return pantallaIngreso();
    st.usuarioId = Api.usuarioId;
    try {
      const [yo, roles, cfgFilas] = await Promise.all([
        Api.select('usuarios', { select: 'nombre,activo', id: 'eq.' + st.usuarioId }),
        Api.select('usuario_roles', { select: 'rol', usuario_id: 'eq.' + st.usuarioId }),
        Api.select('configuracion', { select: 'clave,valor' }).catch(() => [])
      ]);
      st.nombre = (yo[0] && yo[0].nombre) || '';
      st.roles = roles.map(r => r.rol);
      const pref = cfgFilas.find(c => c.clave === 'prefijo_ot');
      if (pref) st.prefijo = pref.valor || '';
      if (yo[0] && yo[0].activo === false) { await Api.logout(); return pantallaIngreso('Tu usuario está desactivado.'); }
      if (!st.roles.length) {
        await Api.logout();
        return pantallaIngreso('Tu usuario todavía no tiene un rol asignado. Pedile al Administrador que te lo asigne.');
      }
    } catch (e) {
      if (!Api.sesion) return pantallaIngreso('Tu sesión venció. Volvé a entrar.');
      document.getElementById('app').innerHTML = `<div style="padding:24px"><div class="error-box">No se pudo conectar: ${esc(errMsg(e))}</div>
        <button class="btn" onclick="location.reload()">Reintentar</button></div>`;
      return;
    }
    armarEstructura();
    if (!location.hash || location.hash === '#/' || location.hash === '#') location.hash = inicio();
    else navegar();
    clearInterval(intervaloAvisos);
    intervaloAvisos = setInterval(actualizarAvisos, 45000);
  }

  window.addEventListener('hashchange', () => { if (st.usuarioId) navegar(); });
  window.addEventListener('mde:sesion-vencida', () => { if (!Api.sesion && st.usuarioId) { st.usuarioId = null; pantallaIngreso('Tu sesión venció. Volvé a entrar.'); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) actualizarAvisos(); });

  // ---------------- Vista: Avisos ----------------
  ruta(/^#\/avisos$/, async main => {
    const avisos = await Api.select('avisos', { select: 'id,tipo,mensaje,ot_id,leido,creado_en', order: 'creado_en.desc', limit: 100 });
    main.innerHTML = `
      <div class="encabezado"><div><h1>Avisos</h1><div class="sub">${avisos.filter(a => !a.leido).length} sin leer</div></div>
        <div class="acciones">${avisos.some(a => !a.leido) ? '<button class="btn" data-accion="leer-todo">Marcar todo como leído</button>' : ''}</div></div>
      <div class="tarjeta">${avisos.length ? avisos.map(a => `
        <div class="aviso-item ${a.leido ? '' : 'nuevo'}"><span class="punto"></span>
          <div><div>${esc(a.mensaje)}</div>
          <div class="cuando">${fechaHora(a.creado_en)}${a.ot_id && veTodas() ? ` · <a href="#/ot/${a.ot_id}">Ver OT</a>` : ''}</div></div></div>`).join('')
        : '<div class="vacio">No tenés avisos.</div>'}</div>`;
    on(main, 'click', '[data-accion=leer-todo]', async () => {
      try { await Api.update('avisos', { leido: 'is.false' }, { leido: true }); toast('Avisos marcados como leídos'); navegar(); }
      catch (e) { toast(errMsg(e), 'error'); }
    });
  }, null);

  // ---------------- Arranque ----------------
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  return {
    st, cfg, esc, num, parseNum, nroOT, fecha, fechaHora, hoyISO, horaActual, duracion, tiene, esAdmin, esOficina,
    veTodas, limpiarCodigo, chipEstadoOT, chipEstadoTarea, errMsg, toast, modal, confirmar, ICONOS, ESTADOS_OT,
    TIPOS, ROLES, MOTIVOS, textoMotivo, pausaAbierta, chipPausa, autocompletarRepuesto,
    ruta, ir, on, navegar, actualizarAvisos, arrancar
  };
})();
