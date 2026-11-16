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
