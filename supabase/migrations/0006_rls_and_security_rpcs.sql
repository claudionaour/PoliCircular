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
