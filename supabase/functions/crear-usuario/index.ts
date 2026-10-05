// Función de Supabase "crear-usuario": la usa la pantalla Usuarios de la app.
// Solo el Administrador puede: crear usuarios (accion "crear") y cambiar contraseñas (accion "password").
// La clave de servicio la pone Supabase automáticamente; nunca va dentro de la app.
import { createClient } from 'npm:@supabase/supabase-js@2';

const DOMINIO = 'mde.local';
const ROLES = ['ADMINISTRADOR', 'OFICINA', 'DEPOSITO', 'MECANICO'];
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Clave de servicio: la pone Supabase en el entorno de la función (formato nuevo o anterior).
function claveServicio(): string {
  const directa = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (directa) return directa;
  try {
    const nuevas = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    return nuevas.default || Object.values(nuevas)[0] as string || '';
  } catch { return ''; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, claveServicio(), { auth: { persistSession: false } });
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: quien } = await admin.auth.getUser(jwt);
    if (!quien?.user) return json({ error: 'Tenés que iniciar sesión' }, 401);
    const { data: rol } = await admin.from('usuario_roles').select('rol')
      .eq('usuario_id', quien.user.id).eq('rol', 'ADMINISTRADOR').maybeSingle();
    if (!rol) return json({ error: 'Solo el Administrador puede hacer esto' }, 403);

    const b = await req.json();
    if (b.accion === 'password') {
      if (!b.id || !b.password || String(b.password).length < 6) return json({ error: 'Contraseña inválida (mínimo 6 caracteres)' }, 400);
      const { error } = await admin.auth.admin.updateUserById(b.id, { password: b.password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (b.accion === 'crear') {
      const nombre = String(b.nombre || '').trim();
      const usuario = String(b.usuario || '').trim().toLowerCase();
      const password = String(b.password || '');
      const roles = (Array.isArray(b.roles) ? b.roles : []).filter((r: string) => ROLES.includes(r));
      if (!nombre || !usuario || password.length < 6) return json({ error: 'Faltan datos: nombre, usuario y contraseña (mínimo 6)' }, 400);
      if (!/^[a-z0-9._@-]+$/.test(usuario)) return json({ error: 'El usuario solo puede tener letras, números, punto, guion o @' }, 400);
      const email = usuario.includes('@') ? usuario : `${usuario}@${DOMINIO}`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nombre } });
      if (error) return json({ error: /already/i.test(error.message) ? 'Ese usuario ya existe' : error.message }, 400);
      await admin.from('usuarios').upsert({ id: data.user.id, nombre });
      if (roles.length) {
        const { error: e2 } = await admin.from('usuario_roles').insert(roles.map((r: string) => ({ usuario_id: data.user.id, rol: r })));
        if (e2) return json({ error: 'Usuario creado, pero no se pudieron asignar los roles: ' + e2.message }, 400);
      }
      return json({ id: data.user.id, email });
    }
    return json({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
