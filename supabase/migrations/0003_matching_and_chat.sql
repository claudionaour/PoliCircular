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
