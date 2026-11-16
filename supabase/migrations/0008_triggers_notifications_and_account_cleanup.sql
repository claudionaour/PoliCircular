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
