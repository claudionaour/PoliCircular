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
