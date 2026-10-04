// Cliente mínimo para Supabase (inicio de sesión + base de datos), sin dependencias.
window.Api = (() => {
  const { url, key } = window.MDE_CONFIG;
  const CLAVE_SESION = 'mde_sesion';
  let sesion = null;
  try { sesion = JSON.parse(localStorage.getItem(CLAVE_SESION)); } catch (e) { sesion = null; }

  class ApiError extends Error {
    constructor(mensaje, status, code, details, hint) {
      super(mensaje);
      this.status = status; this.code = code; this.details = details; this.hint = hint;
    }
  }

  function guardar(s) {
    sesion = s;
    try {
      if (s) localStorage.setItem(CLAVE_SESION, JSON.stringify(s));
      else localStorage.removeItem(CLAVE_SESION);
    } catch (e) { /* sin almacenamiento: la sesión vive mientras la pestaña esté abierta */ }
  }

  async function auth(ruta, cuerpo, token) {
    let r;
    try {
      r = await fetch(url + '/auth/v1/' + ruta, {
        method: 'POST',
        headers: Object.assign({ apikey: key, 'Content-Type': 'application/json' },
                               token ? { Authorization: 'Bearer ' + token } : {}),
        body: JSON.stringify(cuerpo || {})
      });
    } catch (e) { throw new ApiError('Sin conexión. Revisá internet.', 0); }
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new ApiError(datos.error_description || datos.msg || datos.message || 'Error de acceso',
                         r.status, datos.error_code || datos.code);
    }
    return datos;
  }

  function sesionDesde(d) {
    return {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
      user: d.user
    };
  }

  async function login(email, password) {
    const d = await auth('token?grant_type=password', { email, password });
    guardar(sesionDesde(d));
    return sesion;
  }

  let refrescando = null;
  async function token() {
    if (!sesion) return null;
    if (sesion.expires_at - 60 > Date.now() / 1000) return sesion.access_token;
    if (!refrescando) {
      refrescando = auth('token?grant_type=refresh_token', { refresh_token: sesion.refresh_token })
        .then(d => { guardar(sesionDesde(d)); return sesion.access_token; })
        .catch(e => {
          if (e.status >= 400 && e.status < 500) { guardar(null); window.dispatchEvent(new Event('mde:sesion-vencida')); }
          throw e;
        })
        .finally(() => { refrescando = null; });
    }
    return refrescando;
  }

  async function logout() {
    const t = sesion && sesion.access_token;
    guardar(null);
    if (t) { try { await auth('logout', {}, t); } catch (e) { /* ya está cerrada localmente */ } }
  }

  function qs(params) {
    if (!params) return '';
    const partes = [];
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      const valores = Array.isArray(v) ? v : [v];
      for (const x of valores) partes.push(encodeURIComponent(k) + '=' + encodeURIComponent(x));
    }
    return partes.length ? '?' + partes.join('&') : '';
  }

  async function rest(metodo, ruta, opciones) {
    opciones = opciones || {};
    const t = await token();
    const headers = { apikey: key, 'Content-Type': 'application/json' };
    if (t) headers.Authorization = 'Bearer ' + t;
    if (opciones.prefer) headers.Prefer = opciones.prefer;
    let r;
    try {
      r = await fetch(url + '/rest/v1/' + ruta, {
        method: metodo,
        headers,
        body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body)
      });
    } catch (e) { throw new ApiError('Sin conexión. Revisá internet.', 0); }
    if (r.status === 204) return null;
    const texto = await r.text();
    let datos = null;
    try { datos = texto ? JSON.parse(texto) : null; } catch (e) { datos = { message: texto }; }
    if (!r.ok) {
      if (r.status === 401) window.dispatchEvent(new Event('mde:sesion-vencida'));
      throw new ApiError((datos && datos.message) || ('Error ' + r.status), r.status,
                         datos && datos.code, datos && datos.details, datos && datos.hint);
    }
    return datos;
  }

  async function funcion(nombre, cuerpo) {
    const t = await token();
    let r;
    try {
      r = await fetch(url + '/functions/v1/' + nombre, {
        method: 'POST',
        headers: { apikey: key, 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify(cuerpo || {})
      });
    } catch (e) { throw new ApiError('No se pudo contactar el servicio.', 0); }
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(datos.error || datos.message || ('Error ' + r.status), r.status);
    return datos;
  }

  return {
    get sesion() { return sesion; },
    get usuarioId() { return sesion && sesion.user && sesion.user.id; },
    ApiError, login, logout, token,
    select: (tabla, params) => rest('GET', tabla + qs(params)),
    insert: (tabla, filas, params) => rest('POST', tabla + qs(params), { body: filas, prefer: 'return=representation' }),
    update: (tabla, params, cambios) => rest('PATCH', tabla + qs(params), { body: cambios, prefer: 'return=representation' }),
    remove: (tabla, params) => rest('DELETE', tabla + qs(params), { prefer: 'return=representation' }),
    rpc: (fn, args) => rest('POST', 'rpc/' + fn, { body: args || {} }),
    funcion
  };
})();
