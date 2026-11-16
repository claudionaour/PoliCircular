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
