-- ============================================================================
-- Migración 0001: Territorio, Perfiles, Privacidad de Contacto y Roles
-- Zona horaria por defecto: America/Santiago
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Comunas (escalable a todo Chiloé y Chile)
CREATE TABLE IF NOT EXISTS public.communes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  region text NOT NULL DEFAULT 'Los Lagos',
  country text NOT NULL DEFAULT 'Chile',
  timezone text NOT NULL DEFAULT 'America/Santiago',
  latitude double precision,
  longitude double precision,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, region)
);

-- 2. Sectores administrables por comuna (sin inventar límites geográficos)
CREATE TABLE IF NOT EXISTS public.sectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id uuid NOT NULL REFERENCES public.communes(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  approx_lat double precision,
  approx_lng double precision,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (commune_id, name)
);

CREATE INDEX IF NOT EXISTS idx_sectors_commune_active ON public.sectors(commune_id, is_active);

-- 3. Establecimientos educacionales / instituciones supervisadas
CREATE TABLE IF NOT EXISTS public.educational_institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  institution_code text,
  commune_id uuid REFERENCES public.communes(id) ON DELETE SET NULL,
  sector_id uuid REFERENCES public.sectors(id) ON DELETE SET NULL,
  responsible_name text NOT NULL,
  badge_level text NOT NULL DEFAULT 'none'
    CHECK (badge_level IN ('none', 'escuela_circular', 'curso_reutilizador', 'comunidad_sustentable', 'embajador_circular')),
  is_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Perfiles públicos seguros (NO incluye teléfono, correo ni domicilio particular)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  username text NOT NULL UNIQUE CHECK (char_length(username) >= 3 AND username ~ '^[a-zA-Z0-9_.-]+$'),
  avatar_url text,
  bio text,
  commune_id uuid REFERENCES public.communes(id) ON DELETE SET NULL,
  sector_id uuid REFERENCES public.sectors(id) ON DELETE SET NULL,
  account_type text NOT NULL DEFAULT 'individual'
    CHECK (account_type IN ('individual', 'organization', 'educational')),
  institution_id uuid REFERENCES public.educational_institutions(id) ON DELETE SET NULL,
  institution_name text,
  institution_description text,
  responsible_person text,
  institutional_code text,
  is_minor_supervised boolean NOT NULL DEFAULT false,
  guardian_authorization_note text,
  is_suspended boolean NOT NULL DEFAULT false,
  suspension_reason text,
  reputation_avg numeric(3,2) NOT NULL DEFAULT 0.00,
  reputation_count integer NOT NULL DEFAULT 0,
  terms_accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_commune_sector ON public.profiles(commune_id, sector_id);

-- 5. Datos privados de contacto (separados para garantizar que nunca se expongan públicamente)
CREATE TABLE IF NOT EXISTS public.profile_private_contacts (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  private_email text,
  private_phone text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 6. Roles separados del perfil (ningún usuario puede autoasignarse privilegios)
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'moderator', 'admin', 'super_admin')),
  assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Trigger automático al registrarse un usuario en auth.users:
-- Crea perfil, rol base 'user', progreso semilla del árbol y notificación de bienvenida
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username text;
  v_full_name text;
  v_account_type text;
  v_commune_id uuid;
  v_sector_id uuid;
  v_is_minor boolean;
BEGIN
  v_full_name := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), 'Usuario PoliCircular');
  v_username := COALESCE(
    NULLIF(regexp_replace(lower(NEW.raw_user_meta_data->>'username'), '[^a-z0-9_.-]', '', 'g'), ''),
    'usuario_' || substr(replace(NEW.id::text, '-', ''), 1, 8)
  );
  v_account_type := CASE
    WHEN NEW.raw_user_meta_data->>'account_type' IN ('individual', 'organization', 'educational')
    THEN NEW.raw_user_meta_data->>'account_type'
    ELSE 'individual'
  END;

  BEGIN
    v_commune_id := NULLIF(NEW.raw_user_meta_data->>'commune_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_commune_id := NULL;
  END;

  BEGIN
    v_sector_id := NULLIF(NEW.raw_user_meta_data->>'sector_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_sector_id := NULL;
  END;

  v_is_minor := COALESCE((NEW.raw_user_meta_data->>'is_minor_supervised')::boolean, false);

  INSERT INTO public.profiles (
    id, full_name, username, commune_id, sector_id, account_type,
    institution_name, institution_description, responsible_person, institutional_code,
    is_minor_supervised, guardian_authorization_note, terms_accepted_at
  )
  VALUES (
    NEW.id,
    v_full_name,
    v_username,
    v_commune_id,
    v_sector_id,
    v_account_type,
    NULLIF(NEW.raw_user_meta_data->>'institution_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'institution_description', ''),
    NULLIF(NEW.raw_user_meta_data->>'responsible_person', ''),
    NULLIF(NEW.raw_user_meta_data->>'institutional_code', ''),
    v_is_minor,
    NULLIF(NEW.raw_user_meta_data->>'guardian_authorization_note', ''),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profile_private_contacts (user_id, private_email, private_phone)
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'private_phone', '')
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- Rol base estricto: siempre 'user'
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
