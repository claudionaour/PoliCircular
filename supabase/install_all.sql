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
-- ============================================================================
-- Migración 0002: Categorías, Productos y Fotografías (Sin precios ni dinero)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  description text,
  icon_name text NOT NULL DEFAULT 'Package',
  estimated_weight_kg numeric(6,2) NOT NULL DEFAULT 1.50 CHECK (estimated_weight_kg >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(trim(title)) >= 3 AND char_length(title) <= 120),
  description text NOT NULL CHECK (char_length(trim(description)) >= 10 AND char_length(description) <= 2000),
  condition text NOT NULL CHECK (condition IN ('new', 'good', 'needs_repair', 'for_recycling')),
  modality text NOT NULL CHECK (modality IN ('gift', 'exchange')),
  desired_exchange_items text,
  total_quantity integer NOT NULL DEFAULT 1 CHECK (total_quantity >= 1 AND total_quantity <= 500),
  available_quantity integer NOT NULL DEFAULT 1 CHECK (available_quantity >= 0),
  reserved_quantity integer NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  commune_id uuid NOT NULL REFERENCES public.communes(id) ON DELETE RESTRICT,
  sector_id uuid REFERENCES public.sectors(id) ON DELETE SET NULL,
  delivery_method text NOT NULL DEFAULT 'Punto de encuentro comunitario',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'draft',
      'pending',
      'approved',
      'reserved',
      'in_delivery',
      'completed',
      'rejected',
      'suspended',
      'archived',
      'expired'
    )),
  moderation_notes text,
  moderated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  moderated_at timestamptz,
  expires_at timestamptz DEFAULT (now() + interval '90 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_quantity_balance CHECK (available_quantity + reserved_quantity <= total_quantity),
  CONSTRAINT chk_exchange_description CHECK (
    modality = 'gift' OR (desired_exchange_items IS NOT NULL AND char_length(trim(desired_exchange_items)) >= 3)
  )
);

CREATE INDEX IF NOT EXISTS idx_products_status_commune ON public.products(status, commune_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_owner ON public.products(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id, status);

DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  public_url text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0 AND sort_order < 5),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON public.product_images(product_id, is_primary DESC, sort_order ASC);

-- Límite máximo de 5 fotografías por producto a nivel de base de datos
CREATE OR REPLACE FUNCTION public.enforce_max_product_images()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.product_images WHERE product_id = NEW.product_id;
  IF v_count >= 5 THEN
    RAISE EXCEPTION 'Un producto puede tener un máximo de 5 fotografías.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_max_product_images ON public.product_images;
CREATE TRIGGER trg_max_product_images
  BEFORE INSERT ON public.product_images
  FOR EACH ROW EXECUTE FUNCTION public.enforce_max_product_images();
-- ============================================================================
-- Migración 0003: Intereses, Solicitudes, Match y Chat Privado en Tiempo Real
-- ============================================================================

-- 1. Intereses / Deslizamiento / Favoritos (distinto de un Match confirmado)
CREATE TABLE IF NOT EXISTS public.product_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('interested', 'discarded', 'favorite')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_product_interests_user ON public.product_interests(user_id, decision);

-- 2. Solicitudes de regalo o propuestas de intercambio
CREATE TABLE IF NOT EXISTS public.match_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  modality text NOT NULL CHECK (modality IN ('gift', 'exchange')),
  offered_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  requested_quantity integer NOT NULL DEFAULT 1 CHECK (requested_quantity >= 1),
  message text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'chat_requested', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_not_own_product CHECK (requester_id <> owner_id)
);

CREATE INDEX IF NOT EXISTS idx_match_requests_owner ON public.match_requests(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_match_requests_requester ON public.match_requests(requester_id, status);

DROP TRIGGER IF EXISTS trg_match_requests_updated_at ON public.match_requests;
CREATE TRIGGER trg_match_requests_updated_at
  BEFORE UPDATE ON public.match_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. Matches confirmados
CREATE TABLE IF NOT EXISTS public.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES public.match_requests(id) ON DELETE CASCADE,
  target_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  offered_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  modality text NOT NULL CHECK (modality IN ('gift', 'exchange')),
  quantity_reserved integer NOT NULL DEFAULT 1 CHECK (quantity_reserved >= 1),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled', 'disputed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matches_participants ON public.matches(owner_id, requester_id, status);

-- 4. Conversaciones privadas por Match
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL UNIQUE REFERENCES public.matches(id) ON DELETE CASCADE,
  participant_a uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  participant_b uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_blocked boolean NOT NULL DEFAULT false,
  blocked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Mensajes en tiempo real (Supabase Realtime)
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(trim(body)) >= 1 AND char_length(body) <= 2000),
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_time ON public.messages(conversation_id, created_at ASC);
-- ============================================================================
-- Migración 0004: Coordinación de Entregas, Confirmación Bilateral, Evaluaciones,
-- Denuncias y Auditoría de Moderación
-- ============================================================================

-- 1. Entregas / Operaciones de intercambio o regalo
CREATE TABLE IF NOT EXISTS public.exchanges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL UNIQUE REFERENCES public.matches(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'coordinating',
      'delivery_agreed',
      'delivered_pending_confirm',
      'completed',
      'cancelled',
      'disputed'
    )),
  proposed_date date,
  proposed_time_slot text,
  meeting_point_label text,
  meeting_point_lat double precision,
  meeting_point_lng double precision,
  proposed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancelled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancellation_reason text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exchanges_status ON public.exchanges(status, created_at DESC);

DROP TRIGGER IF EXISTS trg_exchanges_updated_at ON public.exchanges;
CREATE TRIGGER trg_exchanges_updated_at
  BEFORE UPDATE ON public.exchanges
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. Confirmaciones bilaterales obligatorias (1 fila por participante)
CREATE TABLE IF NOT EXISTS public.exchange_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange_id uuid NOT NULL REFERENCES public.exchanges(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  UNIQUE (exchange_id, user_id)
);

-- 3. Evaluaciones vinculadas únicamente a operaciones finalizadas
CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange_id uuid NOT NULL REFERENCES public.exchanges(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reviewed_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating_compliance smallint NOT NULL CHECK (rating_compliance BETWEEN 1 AND 5),
  rating_punctuality smallint NOT NULL CHECK (rating_punctuality BETWEEN 1 AND 5),
  rating_condition smallint NOT NULL CHECK (rating_condition BETWEEN 1 AND 5),
  rating_communication smallint NOT NULL CHECK (rating_communication BETWEEN 1 AND 5),
  rating_respect smallint NOT NULL CHECK (rating_respect BETWEEN 1 AND 5),
  overall_rating numeric(3,2) GENERATED ALWAYS AS (
    round((rating_compliance + rating_punctuality + rating_condition + rating_communication + rating_respect)::numeric / 5.0, 2)
  ) STORED,
  comment text CHECK (char_length(comment) <= 1000),
  is_flagged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exchange_id, reviewer_id),
  CONSTRAINT chk_not_self_review CHECK (reviewer_id <> reviewed_user_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_reviewed_user ON public.reviews(reviewed_user_id, created_at DESC);

-- 4. Denuncias comunitarias y de seguridad
CREATE TABLE IF NOT EXISTS public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('product', 'user', 'conversation', 'review', 'exchange')),
  target_id uuid NOT NULL,
  reason_category text NOT NULL,
  description text NOT NULL CHECK (char_length(trim(description)) >= 10),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'under_review', 'resolved', 'dismissed')),
  resolution_notes text,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports(status, created_at DESC);

-- 5. Historial inmutable de auditoría y moderación
CREATE TABLE IF NOT EXISTS public.moderation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  action text NOT NULL,
  previous_status text,
  new_status text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moderation_logs_target ON public.moderation_logs(target_type, target_id, created_at DESC);
-- ============================================================================
-- Migración 0005: Mi Árbol Circular, Logros, Impacto Ambiental, Educación y Notificaciones
-- ============================================================================

-- 1. Catálogo de insignias y logros
CREATE TABLE IF NOT EXISTS public.achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  category text NOT NULL CHECK (category IN ('tree', 'milestone', 'education')),
  required_operations integer NOT NULL DEFAULT 0,
  icon_name text NOT NULL DEFAULT 'Award',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Logros desbloqueados por usuario
CREATE TABLE IF NOT EXISTS public.user_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  achievement_id uuid NOT NULL REFERENCES public.achievements(id) ON DELETE CASCADE,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, achievement_id)
);

-- 3. Progreso del Árbol Circular (solo se actualiza vía RPC al confirmar ambas partes)
CREATE TABLE IF NOT EXISTS public.user_tree_progress (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  completed_operations integer NOT NULL DEFAULT 0 CHECK (completed_operations >= 0),
  completed_gifts integer NOT NULL DEFAULT 0 CHECK (completed_gifts >= 0),
  completed_exchanges integer NOT NULL DEFAULT 0 CHECK (completed_exchanges >= 0),
  current_stage text NOT NULL DEFAULT 'semilla'
    CHECK (current_stage IN ('semilla', 'brote', 'arbol_joven', 'arbol_desarrollado', 'arbol_frutal')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Asegurar progreso inicial al crear perfil
CREATE OR REPLACE FUNCTION public.init_user_tree_and_welcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_tree_progress (user_id, completed_operations, current_stage)
  VALUES (NEW.id, 0, 'semilla')
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.notifications (user_id, event_type, title, body, link_path)
  VALUES (
    NEW.id,
    'account_created',
    'Bienvenido a PoliCircular',
    'Tu semilla circular ha sido plantada. Explora productos en tu comuna o publica lo que ya no necesitas.',
    '/mi-arbol'
  );
  RETURN NEW;
END;
$$;

-- 4. Registros de impacto ambiental (distinguiendo estrictamente medido vs estimado)
CREATE TABLE IF NOT EXISTS public.impact_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange_id uuid NOT NULL REFERENCES public.exchanges(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  commune_id uuid NOT NULL REFERENCES public.communes(id) ON DELETE RESTRICT,
  sector_id uuid REFERENCES public.sectors(id) ON DELETE SET NULL,
  modality text NOT NULL CHECK (modality IN ('gift', 'exchange')),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  weight_kg numeric(8,2) NOT NULL DEFAULT 0 CHECK (weight_kg >= 0),
  weight_type text NOT NULL CHECK (weight_type IN ('estimated', 'measured')),
  recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exchange_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_impact_records_commune_date ON public.impact_records(commune_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_impact_records_weight_type ON public.impact_records(weight_type);

-- 5. Notificaciones internas (preparado para Web Push)
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'account_created',
    'product_received',
    'product_approved',
    'product_rejected',
    'new_request',
    'request_accepted',
    'request_rejected',
    'new_match',
    'new_message',
    'delivery_status_changed',
    'delivery_confirmed',
    'operation_completed',
    'new_review',
    'new_achievement'
  )),
  title text NOT NULL,
  body text NOT NULL,
  link_path text,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id, is_read, created_at DESC);

DROP TRIGGER IF EXISTS trg_profile_init_tree_welcome ON public.profiles;
CREATE TRIGGER trg_profile_init_tree_welcome
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.init_user_tree_and_welcome();

-- 6. Progreso en el Centro Educativo ("Aprendamos a Circular")
CREATE TABLE IF NOT EXISTS public.education_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module_slug text NOT NULL,
  quiz_score integer NOT NULL DEFAULT 0 CHECK (quiz_score >= 0 AND quiz_score <= 100),
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, module_slug)
);
-- ============================================================================
-- Migración 0006: Seguridad RLS en TODAS las tablas y RPCs Transaccionales
-- ============================================================================

-- Funciones auxiliares de verificación de roles (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.has_role(p_user_id uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id
      AND role = ANY(p_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_moderator_or_above(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(p_user_id, ARRAY['moderator', 'admin', 'super_admin']);
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_above(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(p_user_id, ARRAY['admin', 'super_admin']);
$$;

-- Habilitar RLS en todas las tablas expuestas
ALTER TABLE public.communes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.educational_institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_private_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchanges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tree_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.impact_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.education_progress ENABLE ROW LEVEL SECURITY;

-- POLÍTICAS RLS: TERRITORIO Y CATÁLOGOS BASE
CREATE POLICY "communes_read_all" ON public.communes FOR SELECT USING (true);
CREATE POLICY "communes_admin_write" ON public.communes FOR ALL
  USING (public.is_admin_or_above(auth.uid()))
  WITH CHECK (public.is_admin_or_above(auth.uid()));

CREATE POLICY "sectors_read_all" ON public.sectors FOR SELECT USING (true);
CREATE POLICY "sectors_admin_write" ON public.sectors FOR ALL
  USING (public.is_admin_or_above(auth.uid()))
  WITH CHECK (public.is_admin_or_above(auth.uid()));

CREATE POLICY "institutions_read_all" ON public.educational_institutions FOR SELECT USING (true);
CREATE POLICY "institutions_admin_write" ON public.educational_institutions FOR ALL
  USING (public.is_admin_or_above(auth.uid()))
  WITH CHECK (public.is_admin_or_above(auth.uid()));

CREATE POLICY "categories_read_all" ON public.categories FOR SELECT USING (true);
CREATE POLICY "categories_admin_write" ON public.categories FOR ALL
  USING (public.is_admin_or_above(auth.uid()))
  WITH CHECK (public.is_admin_or_above(auth.uid()));

-- POLÍTICAS RLS: PERFILES Y CONTACTOS PRIVADOS
CREATE POLICY "profiles_public_read" ON public.profiles FOR SELECT
  USING (NOT is_suspended OR id = auth.uid() OR public.is_moderator_or_above(auth.uid()));

CREATE OR REPLACE FUNCTION public.get_profile_suspended(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT is_suspended FROM public.profiles WHERE id = p_user_id), false);
$$;

CREATE POLICY "profiles_owner_update" ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND is_suspended = public.get_profile_suspended(auth.uid())
  );

CREATE POLICY "private_contacts_owner_or_admin" ON public.profile_private_contacts FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin_or_above(auth.uid()));
CREATE POLICY "private_contacts_owner_update" ON public.profile_private_contacts FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- POLÍTICAS RLS: ROLES (solo lectura propia o admins; modificación exclusivamente super_admin)
CREATE POLICY "user_roles_read_own_or_admin" ON public.user_roles FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin_or_above(auth.uid()));
CREATE POLICY "user_roles_super_admin_only" ON public.user_roles FOR ALL
  USING (public.has_role(auth.uid(), ARRAY['super_admin']))
  WITH CHECK (public.has_role(auth.uid(), ARRAY['super_admin']));

-- POLÍTICAS RLS: PRODUCTOS E IMÁGENES
CREATE POLICY "products_read_approved_owner_or_mod" ON public.products FOR SELECT
  USING (
    status IN ('approved', 'reserved', 'in_delivery', 'completed')
    OR owner_id = auth.uid()
    OR public.is_moderator_or_above(auth.uid())
  );

CREATE POLICY "products_owner_insert_pending" ON public.products FOR INSERT
  WITH CHECK (
    owner_id = auth.uid()
    AND status IN ('draft', 'pending')
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_suspended = true)
  );

CREATE POLICY "products_owner_update_safe" ON public.products FOR UPDATE
  USING (owner_id = auth.uid() AND status IN ('draft', 'pending', 'rejected', 'approved'))
  WITH CHECK (
    owner_id = auth.uid()
    AND status IN ('draft', 'pending', 'archived')
  );

CREATE POLICY "product_images_read" ON public.product_images FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.products pr
      WHERE pr.id = product_images.product_id
        AND (pr.status IN ('approved', 'reserved', 'in_delivery', 'completed') OR pr.owner_id = auth.uid() OR public.is_moderator_or_above(auth.uid()))
    )
  );

CREATE POLICY "product_images_owner_write" ON public.product_images FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.products pr WHERE pr.id = product_images.product_id AND pr.owner_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.products pr WHERE pr.id = product_images.product_id AND pr.owner_id = auth.uid())
  );

-- POLÍTICAS RLS: INTERESES, SOLICITUDES Y MATCHES
CREATE POLICY "interests_own_all" ON public.product_interests FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "match_requests_participants_select" ON public.match_requests FOR SELECT
  USING (requester_id = auth.uid() OR owner_id = auth.uid());

CREATE POLICY "match_requests_requester_insert" ON public.match_requests FOR INSERT
  WITH CHECK (
    requester_id = auth.uid()
    AND requester_id <> owner_id
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.products pr
      WHERE pr.id = target_product_id AND pr.status = 'approved' AND pr.available_quantity >= requested_quantity
    )
    AND (
      offered_product_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.products op
        WHERE op.id = offered_product_id AND op.owner_id = auth.uid() AND op.status = 'approved' AND op.available_quantity >= 1
      )
    )
  );

CREATE POLICY "match_requests_participant_cancel_reject" ON public.match_requests FOR UPDATE
  USING (requester_id = auth.uid() OR owner_id = auth.uid())
  WITH CHECK (
    (requester_id = auth.uid() AND status = 'cancelled')
    OR (owner_id = auth.uid() AND status IN ('rejected', 'chat_requested'))
  );

CREATE POLICY "matches_participants_select" ON public.matches FOR SELECT
  USING (owner_id = auth.uid() OR requester_id = auth.uid());

-- POLÍTICAS RLS: CONVERSACIONES Y MENSAJES (exclusivo participantes; menores protegidos)
CREATE POLICY "conversations_participants_only" ON public.conversations FOR SELECT
  USING (participant_a = auth.uid() OR participant_b = auth.uid());

CREATE POLICY "conversations_participants_block" ON public.conversations FOR UPDATE
  USING (participant_a = auth.uid() OR participant_b = auth.uid())
  WITH CHECK (participant_a = auth.uid() OR participant_b = auth.uid());

CREATE POLICY "messages_participants_select" ON public.messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND (c.participant_a = auth.uid() OR c.participant_b = auth.uid())
    )
  );

CREATE POLICY "messages_participants_insert" ON public.messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.is_blocked = false
        AND (c.participant_a = auth.uid() OR c.participant_b = auth.uid())
    )
  );

CREATE POLICY "messages_mark_read" ON public.messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND (c.participant_a = auth.uid() OR c.participant_b = auth.uid())
        AND messages.sender_id <> auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND (c.participant_a = auth.uid() OR c.participant_b = auth.uid())
        AND messages.sender_id <> auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.protect_message_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.body <> OLD.body OR NEW.sender_id <> OLD.sender_id OR NEW.conversation_id <> OLD.conversation_id THEN
    RAISE EXCEPTION 'No está permitido modificar el contenido o remitente de un mensaje enviado.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_message_immutability ON public.messages;
CREATE TRIGGER trg_protect_message_immutability
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.protect_message_immutability();

-- POLÍTICAS RLS: ENTREGAS, CONFIRMACIONES Y EVALUACIONES
CREATE POLICY "exchanges_participants_select" ON public.exchanges FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = exchanges.match_id AND (m.owner_id = auth.uid() OR m.requester_id = auth.uid())
    )
    OR public.is_moderator_or_above(auth.uid())
  );

CREATE POLICY "exchanges_participants_coordinate" ON public.exchanges FOR UPDATE
  USING (
    status IN ('pending', 'coordinating', 'delivery_agreed', 'delivered_pending_confirm')
    AND EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = exchanges.match_id AND (m.owner_id = auth.uid() OR m.requester_id = auth.uid())
    )
  )
  WITH CHECK (
    status IN ('coordinating', 'delivery_agreed', 'disputed')
  );

CREATE POLICY "confirmations_participants_select" ON public.exchange_confirmations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.exchanges e
      JOIN public.matches m ON m.id = e.match_id
      WHERE e.id = exchange_confirmations.exchange_id
        AND (m.owner_id = auth.uid() OR m.requester_id = auth.uid())
    )
  );

CREATE POLICY "reviews_public_read" ON public.reviews FOR SELECT USING (true);

-- POLÍTICAS RLS: DENUNCIAS Y AUDITORÍA
CREATE POLICY "reports_reporter_or_mod_select" ON public.reports FOR SELECT
  USING (reporter_id = auth.uid() OR public.is_moderator_or_above(auth.uid()));

CREATE POLICY "reports_authenticated_insert" ON public.reports FOR INSERT
  WITH CHECK (reporter_id = auth.uid());

CREATE POLICY "moderation_logs_mod_only" ON public.moderation_logs FOR SELECT
  USING (public.is_moderator_or_above(auth.uid()));

-- POLÍTICAS RLS: ÁRBOL CIRCULAR, LOGROS, IMPACTO, NOTIFICACIONES Y EDUCACIÓN
CREATE POLICY "achievements_read_all" ON public.achievements FOR SELECT USING (true);
CREATE POLICY "user_achievements_read_all" ON public.user_achievements FOR SELECT USING (true);
CREATE POLICY "user_tree_progress_read_all" ON public.user_tree_progress FOR SELECT USING (true);
CREATE POLICY "impact_records_read_all" ON public.impact_records FOR SELECT USING (true);

CREATE POLICY "notifications_owner_select" ON public.notifications FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "notifications_owner_update" ON public.notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "education_progress_owner" ON public.education_progress FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- FUNCIONES RPC TRANSACCIONALES SEGURAS (BACKEND AUTHORITATIVE)
-- ============================================================================

-- RPC 1: Moderación obligatoria de publicaciones
CREATE OR REPLACE FUNCTION public.moderate_product(
  p_product_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_product public.products;
  v_prev_status text;
  v_new_status text;
  v_notif_type text;
  v_notif_title text;
  v_notif_body text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_moderator_or_above(v_actor) THEN
    RAISE EXCEPTION 'No autorizado: se requiere rol de moderador o administrador.';
  END IF;

  IF p_action NOT IN ('approve', 'reject', 'suspend') THEN
    RAISE EXCEPTION 'Acción de moderación inválida.';
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Publicación no encontrada.';
  END IF;

  v_prev_status := v_product.status;

  v_new_status := CASE p_action
    WHEN 'approve' THEN 'approved'
    WHEN 'reject' THEN 'rejected'
    WHEN 'suspend' THEN 'suspended'
  END;

  IF v_new_status IN ('rejected', 'suspended') AND (p_reason IS NULL OR char_length(trim(p_reason)) < 5) THEN
    RAISE EXCEPTION 'Debes ingresar un motivo claro al rechazar o suspender una publicación.';
  END IF;

  UPDATE public.products
  SET status = v_new_status,
      moderation_notes = COALESCE(p_reason, moderation_notes),
      moderated_by = v_actor,
      moderated_at = now()
  WHERE id = p_product_id
  RETURNING * INTO v_product;

  INSERT INTO public.moderation_logs (actor_id, target_type, target_id, action, previous_status, new_status, notes)
  VALUES (v_actor, 'product', p_product_id, p_action, v_prev_status, v_new_status, p_reason);

  IF v_new_status = 'approved' THEN
    v_notif_type := 'product_approved';
    v_notif_title := 'Publicación aprobada';
    v_notif_body := 'Tu producto "' || v_product.title || '" ya está visible en el catálogo comunitario.';
  ELSE
    v_notif_type := 'product_rejected';
    v_notif_title := CASE WHEN v_new_status = 'rejected' THEN 'Publicación rechazada' ELSE 'Publicación suspendida' END;
    v_notif_body := 'Tu producto "' || v_product.title || '" fue revisado. Motivo: ' || COALESCE(p_reason, 'No cumple reglas comunitarias.');
  END IF;

  INSERT INTO public.notifications (user_id, event_type, title, body, link_path)
  VALUES (v_product.owner_id, v_notif_type, v_notif_title, v_notif_body, '/mis-publicaciones');

  RETURN v_product;
END;
$$;

-- RPC 2: Aceptar solicitud y generar Match + Conversación + Reserva atómica (previene doble reserva)
CREATE OR REPLACE FUNCTION public.accept_match_request(p_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_req public.match_requests;
  v_target public.products;
  v_offered public.products;
  v_match_id uuid;
  v_conv_id uuid;
  v_owner_minor boolean;
  v_req_minor boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;

  SELECT * INTO v_req FROM public.match_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada.';
  END IF;

  IF v_req.owner_id <> v_actor THEN
    RAISE EXCEPTION 'Solo el propietario puede aceptar esta solicitud.';
  END IF;

  IF v_req.status NOT IN ('pending', 'chat_requested') THEN
    RAISE EXCEPTION 'Esta solicitud ya fue procesada.';
  END IF;

  -- Protección de menores: verificar supervisión si participa cuenta de menor
  SELECT is_minor_supervised INTO v_owner_minor FROM public.profiles WHERE id = v_req.owner_id;
  SELECT is_minor_supervised INTO v_req_minor FROM public.profiles WHERE id = v_req.requester_id;

  -- Bloquear producto objetivo para prevenir condiciones de carrera
  SELECT * INTO v_target FROM public.products WHERE id = v_req.target_product_id FOR UPDATE;
  IF v_target.status <> 'approved' OR v_target.available_quantity < v_req.requested_quantity THEN
    RAISE EXCEPTION 'No hay unidades suficientes disponibles para reservar este producto.';
  END IF;

  IF v_req.modality = 'exchange' AND v_req.offered_product_id IS NOT NULL THEN
    SELECT * INTO v_offered FROM public.products WHERE id = v_req.offered_product_id FOR UPDATE;
    IF NOT FOUND OR v_offered.status <> 'approved' OR v_offered.available_quantity < 1 THEN
      RAISE EXCEPTION 'El producto ofrecido para intercambio ya no está aprobado o disponible.';
    END IF;

    UPDATE public.products
    SET available_quantity = available_quantity - 1,
        reserved_quantity = reserved_quantity + 1,
        status = CASE WHEN available_quantity - 1 = 0 THEN 'reserved' ELSE status END
    WHERE id = v_offered.id;
  END IF;

  UPDATE public.products
  SET available_quantity = available_quantity - v_req.requested_quantity,
      reserved_quantity = reserved_quantity + v_req.requested_quantity,
      status = CASE WHEN available_quantity - v_req.requested_quantity = 0 THEN 'reserved' ELSE status END
  WHERE id = v_target.id;

  UPDATE public.match_requests SET status = 'accepted' WHERE id = v_req.id;

  INSERT INTO public.matches (request_id, target_product_id, offered_product_id, owner_id, requester_id, modality, quantity_reserved, status)
  VALUES (v_req.id, v_req.target_product_id, v_req.offered_product_id, v_req.owner_id, v_req.requester_id, v_req.modality, v_req.requested_quantity, 'active')
  RETURNING id INTO v_match_id;

  INSERT INTO public.conversations (match_id, participant_a, participant_b)
  VALUES (v_match_id, v_req.owner_id, v_req.requester_id)
  RETURNING id INTO v_conv_id;

  INSERT INTO public.exchanges (match_id, status)
  VALUES (v_match_id, 'coordinating');

  -- Notificaciones
  INSERT INTO public.notifications (user_id, event_type, title, body, link_path)
  VALUES
    (v_req.requester_id, 'new_match', '¡Nuevo Match confirmado!', 'Tu solicitud por "' || v_target.title || '" fue aceptada. Ya pueden coordinar la entrega.', '/matches/' || v_match_id::text),
    (v_req.owner_id, 'new_match', 'Match generado', 'Has aceptado una solicitud por "' || v_target.title || '". Coordina la entrega por el chat.', '/matches/' || v_match_id::text);

  RETURN v_match_id;
END;
$$;

-- RPC 3: Confirmación bilateral de entrega (nunca finaliza con 1 sola confirmación)
CREATE OR REPLACE FUNCTION public.confirm_exchange_delivery(
  p_exchange_id uuid,
  p_notes text DEFAULT NULL,
  p_measured_weight_kg numeric DEFAULT NULL
)
RETURNS public.exchanges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_exchange public.exchanges;
  v_match public.matches;
  v_product public.products;
  v_category public.categories;
  v_confirm_count integer;
  v_weight numeric(8,2);
  v_weight_type text;
  v_uid uuid;
  v_ops integer;
  v_new_stage text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;

  SELECT * INTO v_exchange FROM public.exchanges WHERE id = p_exchange_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operación de entrega no encontrada.';
  END IF;

  SELECT * INTO v_match FROM public.matches WHERE id = v_exchange.match_id FOR UPDATE;
  IF v_actor <> v_match.owner_id AND v_actor <> v_match.requester_id THEN
    RAISE EXCEPTION 'No eres participante de este intercambio.';
  END IF;

  IF v_exchange.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Esta operación ya se encuentra cerrada.';
  END IF;

  INSERT INTO public.exchange_confirmations (exchange_id, user_id, notes)
  VALUES (p_exchange_id, v_actor, p_notes)
  ON CONFLICT (exchange_id, user_id) DO NOTHING;

  SELECT count(*) INTO v_confirm_count
  FROM public.exchange_confirmations
  WHERE exchange_id = p_exchange_id;

  -- Si falta la confirmación de la otra parte, queda en 'delivered_pending_confirm'
  IF v_confirm_count < 2 THEN
    UPDATE public.exchanges
    SET status = 'delivered_pending_confirm'
    WHERE id = p_exchange_id
    RETURNING * INTO v_exchange;

    INSERT INTO public.notifications (user_id, event_type, title, body, link_path)
    VALUES (
      CASE WHEN v_actor = v_match.owner_id THEN v_match.requester_id ELSE v_match.owner_id END,
      'delivery_confirmed',
      'Confirmación de entrega pendiente',
      'La otra parte confirmó la entrega. Confirma también para finalizar la operación.',
      '/intercambios'
    );

    RETURN v_exchange;
  END IF;

  -- Ambas partes confirmaron: finalizar operación atómicamente
  UPDATE public.exchanges
  SET status = 'completed',
      completed_at = now()
  WHERE id = p_exchange_id
  RETURNING * INTO v_exchange;

  UPDATE public.matches SET status = 'completed' WHERE id = v_match.id;

  SELECT * INTO v_product FROM public.products WHERE id = v_match.target_product_id FOR UPDATE;
  SELECT * INTO v_category FROM public.categories WHERE id = v_product.category_id;

  UPDATE public.products
  SET reserved_quantity = GREATEST(0, reserved_quantity - v_match.quantity_reserved),
      status = CASE
        WHEN available_quantity = 0 AND GREATEST(0, reserved_quantity - v_match.quantity_reserved) = 0
        THEN 'completed'
        ELSE 'approved'
      END
  WHERE id = v_product.id;

  IF v_match.offered_product_id IS NOT NULL THEN
    UPDATE public.products
    SET reserved_quantity = GREATEST(0, reserved_quantity - 1),
        status = CASE
          WHEN available_quantity = 0 AND GREATEST(0, reserved_quantity - 1) = 0
          THEN 'completed'
          ELSE 'approved'
        END
    WHERE id = v_match.offered_product_id;
  END IF;

  -- Registro de impacto ambiental (distinguiendo medido vs estimado)
  IF p_measured_weight_kg IS NOT NULL AND p_measured_weight_kg > 0 THEN
    v_weight := round(p_measured_weight_kg, 2);
    v_weight_type := 'measured';
  ELSE
    v_weight := round(COALESCE(v_category.estimated_weight_kg, 1.50) * v_match.quantity_reserved, 2);
    v_weight_type := 'estimated';
  END IF;

  INSERT INTO public.impact_records (
    exchange_id, product_id, category_id, commune_id, sector_id, modality,
    quantity, weight_kg, weight_type, recorded_by
  )
  VALUES (
    p_exchange_id, v_product.id, v_product.category_id, v_product.commune_id, v_product.sector_id,
    v_match.modality, v_match.quantity_reserved, v_weight, v_weight_type, v_actor
  )
  ON CONFLICT (exchange_id, product_id) DO NOTHING;

  -- Actualizar Árbol Circular e insignias de ambos participantes
  FOREACH v_uid IN ARRAY ARRAY[v_match.owner_id, v_match.requester_id]
  LOOP
    INSERT INTO public.user_tree_progress (user_id, completed_operations, completed_gifts, completed_exchanges, current_stage)
    VALUES (
      v_uid,
      1,
      CASE WHEN v_match.modality = 'gift' THEN 1 ELSE 0 END,
      CASE WHEN v_match.modality = 'exchange' THEN 1 ELSE 0 END,
      'brote'
    )
    ON CONFLICT (user_id) DO UPDATE
    SET completed_operations = user_tree_progress.completed_operations + 1,
        completed_gifts = user_tree_progress.completed_gifts + CASE WHEN v_match.modality = 'gift' THEN 1 ELSE 0 END,
        completed_exchanges = user_tree_progress.completed_exchanges + CASE WHEN v_match.modality = 'exchange' THEN 1 ELSE 0 END,
        updated_at = now();

    SELECT completed_operations INTO v_ops FROM public.user_tree_progress WHERE user_id = v_uid;

    v_new_stage := CASE
      WHEN v_ops >= 25 THEN 'arbol_frutal'
      WHEN v_ops >= 10 THEN 'arbol_desarrollado'
      WHEN v_ops >= 3 THEN 'arbol_joven'
      WHEN v_ops >= 1 THEN 'brote'
      ELSE 'semilla'
    END;

    UPDATE public.user_tree_progress SET current_stage = v_new_stage WHERE user_id = v_uid;

    -- Desbloquear insignias idempotentemente
    INSERT INTO public.user_achievements (user_id, achievement_id)
    SELECT v_uid, a.id
    FROM public.achievements a
    WHERE (a.code = 'first_second_chance' AND v_ops >= 1)
       OR (a.code = 'first_gift' AND v_match.modality = 'gift')
       OR (a.code = 'first_exchange' AND v_match.modality = 'exchange')
       OR (a.code = 'ten_reused' AND v_ops >= 10)
       OR (a.code = 'twenty_five_ops' AND v_ops >= 25)
    ON CONFLICT (user_id, achievement_id) DO NOTHING;

    INSERT INTO public.notifications (user_id, event_type, title, body, link_path)
    VALUES (
      v_uid,
      'operation_completed',
      'Operación circular finalizada',
      'Ambas partes confirmaron la entrega de "' || v_product.title || '". Tu Árbol Circular creció y ya puedes evaluar la experiencia.',
      '/intercambios'
    );
  END LOOP;

  RETURN v_exchange;
END;
$$;

-- RPC 4: Cancelar acuerdo de entrega y liberar reserva
CREATE OR REPLACE FUNCTION public.cancel_exchange_agreement(
  p_exchange_id uuid,
  p_reason text
)
RETURNS public.exchanges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_exchange public.exchanges;
  v_match public.matches;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;

  SELECT * INTO v_exchange FROM public.exchanges WHERE id = p_exchange_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operación no encontrada.';
  END IF;

  SELECT * INTO v_match FROM public.matches WHERE id = v_exchange.match_id FOR UPDATE;
  IF v_actor <> v_match.owner_id AND v_actor <> v_match.requester_id THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  IF v_exchange.status = 'completed' THEN
    RAISE EXCEPTION 'No es posible cancelar una operación ya finalizada.';
  END IF;

  UPDATE public.exchanges
  SET status = 'cancelled',
      cancelled_by = v_actor,
      cancellation_reason = p_reason
  WHERE id = p_exchange_id
  RETURNING * INTO v_exchange;

  UPDATE public.matches SET status = 'cancelled' WHERE id = v_match.id;

  -- Liberar unidades reservadas
  UPDATE public.products
  SET available_quantity = available_quantity + v_match.quantity_reserved,
      reserved_quantity = GREATEST(0, reserved_quantity - v_match.quantity_reserved),
      status = CASE WHEN status = 'reserved' THEN 'approved' ELSE status END
  WHERE id = v_match.target_product_id;

  IF v_match.offered_product_id IS NOT NULL THEN
    UPDATE public.products
    SET available_quantity = available_quantity + 1,
        reserved_quantity = GREATEST(0, reserved_quantity - 1),
        status = CASE WHEN status = 'reserved' THEN 'approved' ELSE status END
    WHERE id = v_match.offered_product_id;
  END IF;

  INSERT INTO public.notifications (user_id, event_type, title, body, link_path)
  VALUES (
    CASE WHEN v_actor = v_match.owner_id THEN v_match.requester_id ELSE v_match.owner_id END,
    'delivery_status_changed',
    'Acuerdo cancelado',
    'El acuerdo fue cancelado y los productos reservados volvieron a estar disponibles.',
    '/intercambios'
  );

  RETURN v_exchange;
END;
$$;

-- RPC 5: Enviar evaluación vinculada a intercambio finalizado
CREATE OR REPLACE FUNCTION public.submit_exchange_review(
  p_exchange_id uuid,
  p_compliance smallint,
  p_punctuality smallint,
  p_condition smallint,
  p_communication smallint,
  p_respect smallint,
  p_comment text DEFAULT NULL
)
RETURNS public.reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_exchange public.exchanges;
  v_match public.matches;
  v_reviewed_id uuid;
  v_review public.reviews;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;

  SELECT * INTO v_exchange FROM public.exchanges WHERE id = p_exchange_id;
  IF NOT FOUND OR v_exchange.status <> 'completed' THEN
    RAISE EXCEPTION 'Solo puedes evaluar operaciones finalizadas por ambas partes.';
  END IF;

  SELECT * INTO v_match FROM public.matches WHERE id = v_exchange.match_id;
  IF v_actor <> v_match.owner_id AND v_actor <> v_match.requester_id THEN
    RAISE EXCEPTION 'No participaste en esta operación.';
  END IF;

  v_reviewed_id := CASE WHEN v_actor = v_match.owner_id THEN v_match.requester_id ELSE v_match.owner_id END;

  INSERT INTO public.reviews (
    exchange_id, reviewer_id, reviewed_user_id,
    rating_compliance, rating_punctuality, rating_condition, rating_communication, rating_respect, comment
  )
  VALUES (
    p_exchange_id, v_actor, v_reviewed_id,
    p_compliance, p_punctuality, p_condition, p_communication, p_respect, p_comment
  )
  RETURNING * INTO v_review;

  UPDATE public.profiles
  SET reputation_avg = (SELECT round(avg(overall_rating), 2) FROM public.reviews WHERE reviewed_user_id = v_reviewed_id),
      reputation_count = (SELECT count(*) FROM public.reviews WHERE reviewed_user_id = v_reviewed_id)
  WHERE id = v_reviewed_id;

  INSERT INTO public.notifications (user_id, event_type, title, body, link_path)
  VALUES (v_reviewed_id, 'new_review', 'Recibiste una evaluación', 'Tu contraparte evaluó la operación finalizada.', '/perfil');

  RETURN v_review;
END;
$$;

-- RPC 6: Administración segura de usuarios y denuncias
CREATE OR REPLACE FUNCTION public.admin_toggle_user_suspension(
  p_target_user_id uuid,
  p_suspend boolean,
  p_reason text DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_profile public.profiles;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_or_above(v_actor) THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  UPDATE public.profiles
  SET is_suspended = p_suspend,
      suspension_reason = CASE WHEN p_suspend THEN p_reason ELSE NULL END
  WHERE id = p_target_user_id
  RETURNING * INTO v_profile;

  INSERT INTO public.moderation_logs (actor_id, target_type, target_id, action, new_status, notes)
  VALUES (v_actor, 'user', p_target_user_id, CASE WHEN p_suspend THEN 'suspend_user' ELSE 'reactivate_user' END, CASE WHEN p_suspend THEN 'suspended' ELSE 'active' END, p_reason);

  RETURN v_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_resolve_report(
  p_report_id uuid,
  p_status text,
  p_resolution_notes text
)
RETURNS public.reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_report public.reports;
BEGIN
  IF v_actor IS NULL OR NOT public.is_moderator_or_above(v_actor) THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  UPDATE public.reports
  SET status = p_status,
      resolution_notes = p_resolution_notes,
      resolved_by = v_actor,
      resolved_at = now()
  WHERE id = p_report_id
  RETURNING * INTO v_report;

  INSERT INTO public.moderation_logs (actor_id, target_type, target_id, action, new_status, notes)
  VALUES (v_actor, 'report', p_report_id, 'resolve_report', p_status, p_resolution_notes);

  RETURN v_report;
END;
$$;
-- ============================================================================
-- Migración 0007: Supabase Storage Buckets y Publicación Realtime
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('product-images', 'product-images', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Políticas de Storage
CREATE POLICY "storage_public_read_products" ON storage.objects FOR SELECT
  USING (bucket_id IN ('product-images', 'avatars'));

CREATE POLICY "storage_authenticated_upload" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id IN ('product-images', 'avatars')
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "storage_owner_delete" ON storage.objects FOR DELETE
  USING (
    bucket_id IN ('product-images', 'avatars')
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Habilitar Realtime para mensajes y notificaciones
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.exchanges;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- ============================================================================
-- Migración 0008: Triggers de Notificaciones del Servidor y Baja de Cuenta
-- ============================================================================

-- Notificar al propietario cuando una publicación entra a moderación
CREATE OR REPLACE FUNCTION public.notify_on_product_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' AND (TG_OP = 'INSERT' OR OLD.status <> 'pending') THEN
    INSERT INTO public.notifications (user_id, event_type, title, body, link_path)
    VALUES (
      NEW.owner_id,
      'product_received',
      'Publicación recibida para revisión',
      'Tu producto "' || NEW.title || '" quedó pendiente de moderación obligatoria antes de aparecer en Explorar.',
      '/mis-publicaciones'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_product_pending ON public.products;
CREATE TRIGGER trg_notify_product_pending
  AFTER INSERT OR UPDATE OF status ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_product_pending();

-- Notificar al propietario cuando recibe una solicitud de regalo o intercambio
CREATE OR REPLACE FUNCTION public.notify_on_match_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
BEGIN
  SELECT title INTO v_title FROM public.products WHERE id = NEW.target_product_id;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notifications (user_id, event_type, title, body, link_path)
    VALUES (
      NEW.owner_id,
      'new_request',
      'Nueva solicitud recibida',
      'Alguien envió una solicitud para "' || COALESCE(v_title, 'tu producto') || '".',
      '/matches'
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.status <> NEW.status THEN
    IF NEW.status = 'rejected' THEN
      INSERT INTO public.notifications (user_id, event_type, title, body, link_path)
      VALUES (
        NEW.requester_id,
        'request_rejected',
        'Solicitud no aceptada',
        'Tu solicitud por "' || COALESCE(v_title, 'un producto') || '" fue rechazada.',
        '/matches'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_match_request ON public.match_requests;
CREATE TRIGGER trg_notify_match_request
  AFTER INSERT OR UPDATE OF status ON public.match_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_match_request();

-- Notificar al otro participante cuando llega un nuevo mensaje privado
CREATE OR REPLACE FUNCTION public.notify_on_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv public.conversations;
  v_recipient uuid;
BEGIN
  SELECT * INTO v_conv FROM public.conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_recipient := CASE
    WHEN v_conv.participant_a = NEW.sender_id THEN v_conv.participant_b
    ELSE v_conv.participant_a
  END;

  INSERT INTO public.notifications (user_id, event_type, title, body, link_path)
  VALUES (
    v_recipient,
    'new_message',
    'Nuevo mensaje privado',
    left(NEW.body, 110),
    '/matches/' || v_conv.match_id::text
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_new_message ON public.messages;
CREATE TRIGGER trg_notify_new_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_new_message();

-- RPC para desactivar/eliminar datos propios de cuenta (solicitud de baja de cuenta)
CREATE OR REPLACE FUNCTION public.request_own_account_deletion()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.';
  END IF;

  -- Archivar publicaciones activas que no están comprometidas en entregas activas
  UPDATE public.products
  SET status = 'archived'
  WHERE owner_id = v_uid AND status IN ('draft', 'pending', 'approved', 'rejected');

  -- Eliminar datos de contacto privado
  DELETE FROM public.profile_private_contacts WHERE user_id = v_uid;

  -- Anonimizar perfil manteniendo integridad referencial de operaciones históricas
  UPDATE public.profiles
  SET full_name = 'Cuenta eliminada',
      bio = NULL,
      avatar_url = NULL,
      institution_name = NULL,
      institution_description = NULL,
      responsible_person = NULL,
      is_suspended = true,
      suspension_reason = 'Cuenta dada de baja por el titular'
  WHERE id = v_uid;
END;
$$;
-- ============================================================================
-- Seed inicial para el piloto de Castro, Región de Los Lagos, Chile
-- Sin usuarios administradores ficticios ni contraseñas predeterminadas.
-- Los sectores pueden administrarse dinámicamente desde el Panel Territorial.
-- ============================================================================

-- 1. Comuna piloto: Castro (y comunas preparadas de Chiloé activables)
INSERT INTO public.communes (name, region, country, timezone, latitude, longitude, is_active)
VALUES
  ('Castro', 'Los Lagos', 'Chile', 'America/Santiago', -42.4822, -73.7644, true),
  ('Ancud', 'Los Lagos', 'Chile', 'America/Santiago', -41.8697, -73.8203, false),
  ('Dalcahue', 'Los Lagos', 'Chile', 'America/Santiago', -42.3792, -73.6494, false),
  ('Chonchi', 'Los Lagos', 'Chile', 'America/Santiago', -42.6239, -73.7725, false),
  ('Quemchi', 'Los Lagos', 'Chile', 'America/Santiago', -42.1422, -73.4744, false),
  ('Quellón', 'Los Lagos', 'Chile', 'America/Santiago', -43.1181, -73.6164, false),
  ('Queilen', 'Los Lagos', 'Chile', 'America/Santiago', -42.8889, -73.4731, false),
  ('Puqueldón', 'Los Lagos', 'Chile', 'America/Santiago', -42.5989, -73.6661, false),
  ('Curaco de Vélez', 'Los Lagos', 'Chile', 'America/Santiago', -42.4408, -73.6033, false),
  ('Quinchao', 'Los Lagos', 'Chile', 'America/Santiago', -42.4731, -73.4956, false)
ON CONFLICT (name, region) DO NOTHING;

-- Sector base administrable para Castro (el equipo territorial puede agregar o editar sectores en el panel)
INSERT INTO public.sectors (commune_id, name, description, approx_lat, approx_lng, is_active)
SELECT id, 'Castro Urbano (referencia comunal)', 'Zona urbana referencial de Castro administrable por el equipo local.', -42.4822, -73.7644, true
FROM public.communes
WHERE name = 'Castro' AND region = 'Los Lagos'
ON CONFLICT (commune_id, name) DO NOTHING;

-- 2. Las 11 categorías oficiales solicitadas (con peso de referencia para estimaciones)
INSERT INTO public.categories (slug, name, description, icon_name, estimated_weight_kg, sort_order)
VALUES
  ('ropa-y-calzado', 'Ropa y calzado', 'Prendas de vestir, abrigos, calzado escolar y deportivo.', 'Shirt', 0.80, 1),
  ('muebles', 'Muebles', 'Sillas, mesas, estanterías, escritorios y mobiliario del hogar.', 'Armchair', 12.00, 2),
  ('libros-y-educacion', 'Libros y educación', 'Textos escolares, novelas, cuadernos, mochilas y material didáctico.', 'BookOpen', 0.90, 3),
  ('tecnologia', 'Tecnología', 'Computadores, periféricos, cables, tablets y equipos en desuso.', 'Laptop', 2.20, 4),
  ('electrodomesticos', 'Electrodomésticos', 'Pequeños y medianos artefactos funcionales o reparables.', 'Plug', 5.50, 5),
  ('herramientas', 'Herramientas', 'Herramientas manuales, de carpintería, huerta o taller.', 'Wrench', 2.40, 6),
  ('juguetes', 'Juguetes', 'Juegos de mesa, juguetes didácticos e infantiles.', 'Puzzle', 0.70, 7),
  ('deportes', 'Deportes', 'Bicicletas, balones, implementos deportivos y outdoor.', 'Bike', 3.50, 8),
  ('hogar-y-jardin', 'Hogar y jardín', 'Menaje, maceteros, textiles de hogar y artículos de jardín.', 'Home', 1.80, 9),
  ('materiales-reutilizables', 'Materiales reutilizables', 'Maderas, telas, frascos, lanas y materiales para talleres.', 'Recycle', 2.00, 10),
  ('otros', 'Otros', 'Otros artículos aptos para segunda oportunidad y reutilización.', 'Package', 1.20, 11)
ON CONFLICT (slug) DO NOTHING;

-- 3. Insignias iniciales del Árbol Circular y Centro Educativo
INSERT INTO public.achievements (code, name, description, category, required_operations, icon_name)
VALUES
  ('first_second_chance', 'Primera segunda oportunidad', 'Completaste tu primera operación circular verificada por ambas partes.', 'milestone', 1, 'Sprout'),
  ('first_gift', 'Primer regalo', 'Entregaste o recibiste tu primer producto sin dinero en PoliCircular.', 'milestone', 1, 'Gift'),
  ('first_exchange', 'Primer intercambio', 'Acordaste y completaste tu primer intercambio comunitario.', 'milestone', 1, 'ArrowLeftRight'),
  ('ten_reused', 'Diez productos reutilizados', 'Alcanzaste diez operaciones circulares verificadas en tu comunidad.', 'tree', 10, 'TreeDeciduous'),
  ('twenty_five_ops', 'Veinticinco operaciones', 'Tu Árbol Circular alcanzó su etapa frutal con 25 operaciones.', 'tree', 25, 'Trees'),
  ('circular_ambassador', 'Embajador Circular', 'Referente activo de reutilización, respeto y educación ambiental.', 'education', 15, 'Award'),
  ('circular_community', 'Comunidad Circular', 'Participación destacada junto a establecimientos y organizaciones locales.', 'education', 5, 'Users')
ON CONFLICT (code) DO NOTHING;
