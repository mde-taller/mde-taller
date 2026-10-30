// MDE · Taller — chat interno: General (todo el taller) y privados entre dos personas.
(() => {
  const { st, esc, errMsg, toast, ruta, on, ICONOS, actualizarChat } = App;
  const ROLES_TODOS = ['ADMINISTRADOR', 'OFICINA', 'DEPOSITO', 'MECANICO'];

  const H24 = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  const mismoDia = (a, b) => a.toDateString() === b.toDateString();
  function cuando(d) {
    if (!d) return '';
    const x = new Date(d), hoy = new Date(), ayer = new Date(Date.now() - 86400000);
    if (mismoDia(x, hoy)) return x.toLocaleTimeString('es-AR', H24);
    if (mismoDia(x, ayer)) return 'ayer';
    return x.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  }
  const diaTexto = d => {
    const x = new Date(d), hoy = new Date(), ayer = new Date(Date.now() - 86400000);
    if (mismoDia(x, hoy)) return 'Hoy';
    if (mismoDia(x, ayer)) return 'Ayer';
    return x.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit' });
  };
  const iniciales = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  // Los links que alguien escriba se pueden tocar.
  const conLinks = t => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

  // ---------------- Lista de conversaciones ----------------
  ruta(/^#\/chat$/, async main => {
    const pintar = lista => {
      main.innerHTML = `
        <div class="encabezado"><div><h1>Chat</h1><div class="sub">General para todo el taller, o tocá una persona para hablar en privado.</div></div></div>
        <div class="chat-lista">
          ${lista.map(c => `<a class="chat-conv ${c.sin_leer ? 'nuevo' : ''}" href="#/chat/${encodeURIComponent(c.conversacion)}">
            <span class="chat-avatar ${c.conversacion === 'general' ? 'general' : ''}">${c.conversacion === 'general' ? ICONOS.chat : esc(iniciales(c.nombre))}</span>
            <span class="chat-conv-txt"><span class="chat-conv-nombre">${esc(c.nombre)}</span>
              <span class="chat-conv-ult">${c.ultimo_texto ? (c.conversacion === 'general' && c.ultimo_de ? esc(c.ultimo_de.split(' ')[0]) + ': ' : '') + esc(c.ultimo_texto) : '<i>Sin mensajes</i>'}</span></span>
            <span class="chat-conv-der"><span class="nota">${esc(cuando(c.ultimo_en))}</span>
              ${c.sin_leer ? `<span class="chat-num">${c.sin_leer > 99 ? '99+' : c.sin_leer}</span>` : ''}</span>
          </a>`).join('')}
        </div>`;
    };
    const cargar = async () => {
      try { pintar(await Api.rpc('chat_conversaciones')); actualizarChat(); }
      catch (e) { main.innerHTML = `<div class="error-box">${esc(errMsg(e))}</div>`; }
    };
    await cargar();
    const iv = setInterval(() => { if (!document.hidden) cargar(); }, 15000);
    st.limpiar.push(() => clearInterval(iv));
  }, ROLES_TODOS);

  // ---------------- Una conversación ----------------
  ruta(/^#\/chat\/([^/]+)$/, async (main, conv) => {
    conv = decodeURIComponent(conv);
    const lista = await Api.rpc('chat_conversaciones');
    const c = lista.find(x => x.conversacion === conv);
    if (!c) { main.innerHTML = '<div class="tarjeta">No se encontró la conversación. <a href="#/chat">Volver al chat</a></div>'; return; }
    const general = conv === 'general';
    let mensajes = [], ultimo = 0, enviando = false;

    main.innerHTML = `
      <div class="chat-caja">
        <div class="chat-cab">
          <a class="volver" href="#/chat" style="margin:0">${ICONOS.atras} Chat</a>
          <span class="chat-avatar chico ${general ? 'general' : ''}">${general ? ICONOS.chat : esc(iniciales(c.nombre))}</span>
          <b>${esc(c.nombre)}</b>
        </div>
        <div class="chat-mensajes" id="chat-msgs" aria-live="polite"><div class="vacio">Cargando…</div></div>
        <form class="chat-form" id="chat-form">
          <textarea id="chat-texto" rows="1" maxlength="2000" placeholder="Escribí un mensaje…" aria-label="Mensaje"></textarea>
          <button class="btn btn-primario" type="submit">Enviar</button>
        </form>
      </div>`;
    const caja = document.getElementById('chat-msgs');
    const texto = document.getElementById('chat-texto');

    const pintar = () => {
      const abajo = caja.scrollHeight - caja.scrollTop - caja.clientHeight < 80;
      if (!mensajes.length) { caja.innerHTML = `<div class="vacio">${general ? 'Todavía no hay mensajes. ¡Escribí el primero!' : 'Todavía no hablaron. Escribí un mensaje.'}</div>`; return; }
      let html = '', diaAnt = '', deAnt = '';
      for (const m of mensajes) {
        const dia = diaTexto(m.creado_en);
        if (dia !== diaAnt) { html += `<div class="chat-dia"><span>${esc(dia.charAt(0).toUpperCase() + dia.slice(1))}</span></div>`; diaAnt = dia; deAnt = ''; }
        const mio = m.de === st.usuarioId;
        const mostrarNombre = general && !mio && m.de !== deAnt;
        html += `<div class="chat-msg ${mio ? 'mio' : ''}">
          ${mostrarNombre ? `<div class="chat-de">${esc(m.nombre)}</div>` : ''}
          <div class="chat-burbuja">${conLinks(m.texto)}<span class="chat-hora">${esc(new Date(m.creado_en).toLocaleTimeString('es-AR', H24))}</span></div></div>`;
        deAnt = m.de;
      }
      caja.innerHTML = html;
      if (abajo || !pintar.yaBajo) { caja.scrollTop = caja.scrollHeight; pintar.yaBajo = true; }
    };
    const traer = async () => {
      try {
        const nuevos = await Api.rpc('chat_leer', { p_conversacion: conv, p_desde: ultimo });
        if (nuevos.length) {
          mensajes = mensajes.concat(nuevos.filter(n => !mensajes.some(m => m.id === n.id)));
          ultimo = mensajes[mensajes.length - 1].id;
          pintar(); actualizarChat();
        } else if (!mensajes.length) pintar();
      } catch (e) { if (!mensajes.length) caja.innerHTML = `<div class="error-box">${esc(errMsg(e))}</div>`; }
    };
    await traer();
    const iv = setInterval(() => { if (!document.hidden) traer(); }, 5000);
    st.limpiar.push(() => clearInterval(iv));

    const enviar = async () => {
      const t = texto.value.trim();
      if (!t || enviando) return;
      enviando = true;
      try {
        await Api.rpc('chat_enviar', { p_conversacion: conv, p_texto: t });
        texto.value = ''; texto.style.height = '';
        pintar.yaBajo = false;
        await traer();
      } catch (e) { toast(errMsg(e), 'error'); }
      finally { enviando = false; texto.focus(); }
    };
    document.getElementById('chat-form').addEventListener('submit', ev => { ev.preventDefault(); enviar(); });
    // Enter envía; Shift+Enter hace un renglón nuevo (en la compu).
    texto.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey && !('ontouchstart' in window)) { ev.preventDefault(); enviar(); } });
    texto.addEventListener('input', () => { texto.style.height = ''; texto.style.height = Math.min(texto.scrollHeight, 140) + 'px'; });
  }, ROLES_TODOS);
})();
