import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

async function main() {
  if (!url || !anonKey || url.includes('tu-proyecto.supabase.co') || anonKey.includes('tu-supabase-anon-public-key')) {
    console.error('❌ Faltan las credenciales reales en .env / entorno:');
    console.error('   - VITE_SUPABASE_URL');
    console.error('   - VITE_SUPABASE_ANON_KEY');
    process.exit(1);
  }

  const supabase = createClient(url, anonKey);

  console.log(`Verificando conexión con Supabase en ${url}...`);

  const { data: communes, error: communeError } = await supabase
    .from('communes')
    .select('id, name, region, is_active')
    .order('name');

  if (communeError) {
    console.error('❌ Error consultando tabla communes:', communeError.message);
    console.error('   Asegúrate de haber ejecutado supabase/install_all.sql en el SQL Editor.');
    process.exit(1);
  }

  const { count: categoriesCount, error: catError } = await supabase
    .from('categories')
    .select('id', { count: 'exact', head: true });

  if (catError) {
    console.error('❌ Error consultando tabla categories:', catError.message);
    process.exit(1);
  }

  const { count: achievementsCount, error: achError } = await supabase
    .from('achievements')
    .select('id', { count: 'exact', head: true });

  if (achError) {
    console.error('❌ Error consultando tabla achievements:', achError.message);
    process.exit(1);
  }

  const castro = communes?.find((c) => c.name === 'Castro' && c.is_active);
  console.log(`✅ Conexión operativa con Supabase.`);
  console.log(`   - Comunas cargadas: ${communes?.length ?? 0} (Castro activo: ${castro ? 'Sí' : 'No'})`);
  console.log(`   - Categorías cargadas: ${categoriesCount ?? 0}`);
  console.log(`   - Insignias cargadas: ${achievementsCount ?? 0}`);
}

main().catch((err) => {
  console.error('❌ Error inesperado verificando Supabase:', err);
  process.exit(1);
});
