# PoliCircular

> **"Lo que ya no necesitas puede ser lo que alguien está buscando"**

Plataforma web y PWA comunitaria y educativa de economía circular nacida en **Castro, Archipiélago de Chiloé, Región de Los Lagos, Chile**. Permite regalar, intercambiar, reutilizar y recuperar productos **sin utilizar dinero**.

---

## Principios fundamentales

- **Cero operaciones monetarias:** sin precios, sin pagos, sin billeteras ni compraventa. Solo **Regalo gratuito** e **Intercambio directo**.
- **Moderación previa obligatoria:** ninguna publicación aparece en el catálogo público hasta ser aprobada mediante RPC segura en Supabase.
- **Privacidad y protección territorial:** nunca se exponen correos, teléfonos ni domicilios particulares; los mapas OpenStreetMap muestran sectores aproximados.
- **Protección de menores:** cuentas supervisadas con autorización registrada y restricción de comunicación irrestricta.
- **Confirmación bilateral:** ninguna entrega se finaliza ni suma al **Árbol Circular** o **Impacto Circular** hasta que ambas partes confirmen.
- **Transparencia ambiental:** diferencia estrictamente entre **PESO MEDIDO** (pesaje real) y **PESO ESTIMADO** (peso de referencia por categoría).

---

## Estructura del proyecto

- `public/` — Iconos PWA (`192x192`, `512x512`, `maskable`, `apple-touch-icon`) e `icon.svg`.
- `src/modules/` — Módulos independientes: `auth`, `profile`, `products`, `explore`, `matching`, `exchanges`, `reviews`, `circular-tree`, `impact`, `education`, `notifications`, `administration`.
- `src/services/` — Servicios tipados contra Supabase Auth, PostgreSQL, Storage, Realtime y RPCs.
- `src/layouts/` — `PublicLayout`, `AppLayout` (con barra inferior móvil de 5 accesos sin administración) y `AdminLayout`.
- `supabase/migrations/` — Migraciones SQL modulares (`0001` a `0008`) con tablas, índices, restricciones, triggers, RLS y funciones `SECURITY DEFINER`.
- `supabase/seed.sql` — Datos iniciales para Castro, comunas de Chiloé, 11 categorías e insignias del Árbol Circular.
- `tests/` — Pruebas de validación de reglas comunitarias y umbrales del Árbol Circular.

---

## Instalación y puesta en marcha

### 1. Variables de entorno

Copia `.env.example` a `.env` y configura tus credenciales públicas de Supabase:

```bash
VITE_SUPABASE_URL="https://tu-proyecto.supabase.co"
VITE_SUPABASE_ANON_KEY="tu-supabase-anon-public-key"
VITE_DEFAULT_TIMEZONE="America/Santiago"
```

> **Importante:** Nunca coloques la clave `service_role` en el frontend ni en variables `VITE_*`.

### 2. Base de datos y seguridad en Supabase

En el **SQL Editor** de tu proyecto Supabase, puedes ejecutar directamente el script consolidado:

- `supabase/install_all.sql` (contiene las migraciones `0001` a `0008` y `seed.sql` en orden)

O bien ejecutar manualmente archivo por archivo en orden:

1. `supabase/migrations/0001_territorial_and_profiles.sql`
2. `supabase/migrations/0002_categories_and_products.sql`
3. `supabase/migrations/0003_matching_and_chat.sql`
4. `supabase/migrations/0004_exchanges_reviews_and_moderation.sql`
5. `supabase/migrations/0005_circular_tree_impact_education_notifications.sql`
6. `supabase/migrations/0006_rls_and_security_rpcs.sql`
7. `supabase/migrations/0007_storage_and_realtime.sql`
8. `supabase/migrations/0008_triggers_notifications_and_account_cleanup.sql`
9. `supabase/seed.sql`

Para comprobar la conexión real desde consola:

```bash
npm run verify:supabase
```

### 3. Asignación inicial de roles administrativos

Por seguridad, el proyecto **no incluye usuarios administradores ni contraseñas predeterminadas**.  
Después de registrar la cuenta institucional o de coordinación en la app, asigna el rol correspondiente directamente desde el SQL Editor de Supabase:

```sql
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'super_admin'
FROM auth.users
WHERE email = 'tu-correo-administrador@dominio.cl'
ON CONFLICT (user_id, role) DO NOTHING;
```

Roles disponibles: `user`, `moderator`, `admin`, `super_admin`.

### 4. Desarrollo local y compilación

```bash
npm install
npm run dev
npm run lint
npm run build
```

### 5. Despliegue en Vercel

1. Conecta el repositorio en Vercel.
2. Define `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en **Environment Variables**.
3. Comando de build: `npm run build` · Directorio de salida: `dist`.
4. Configura una regla rewrite SPA (`/* -> /index.html`) si utilizas rutas directas en producción.
