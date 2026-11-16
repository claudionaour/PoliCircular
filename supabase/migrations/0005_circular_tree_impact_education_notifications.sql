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
