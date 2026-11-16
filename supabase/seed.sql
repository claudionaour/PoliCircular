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
