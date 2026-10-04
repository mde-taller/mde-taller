// Conexión a la base de datos (Supabase).
// La clave "publishable" está pensada para ir en la app: los datos los protegen
// el inicio de sesión y los permisos por rol. Nunca poner acá la clave "secret".
window.MDE_CONFIG = {
  url: 'https://kxtsgmptqjxamaokrimx.supabase.co',
  key: 'sb_publishable_9cmnx0n92JiSDtzmzWNHkQ_l0hwnsSf',
  // Si alguien entra con un usuario sin "@" (ej. "juan"), se usa juan@mde.local
  dominioUsuarios: 'mde.local',
  empresa: 'MDE Electromecánica'
};
