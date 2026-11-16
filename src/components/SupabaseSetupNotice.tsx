import React from 'react';
import { Database, AlertCircle } from 'lucide-react';
import { isSupabaseConfigured } from '../services/supabase';

export const SupabaseSetupNotice: React.FC = () => {
  if (isSupabaseConfigured) return null;

  return (
    <div className="rounded-2xl border border-[#F28C28]/40 bg-[#FFF8F1] p-4 sm:p-5 text-sm text-[#102C49]">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-[#F28C28] shrink-0 mt-0.5" />
        <div className="space-y-2">
          <div className="flex items-center gap-2 font-display font-bold text-[#102C49]">
            <Database className="h-4 w-4 text-[#102C49]" />
            <span>Configuración de Supabase pendiente</span>
          </div>
          <p className="text-slate-700 leading-relaxed">
            PoliCircular requiere conexión real con PostgreSQL, Authentication, Storage y Realtime de Supabase.
            No se simulan datos en memoria ni en el navegador.
          </p>
          <div className="rounded-xl bg-white border border-slate-200 p-3 text-xs font-mono text-slate-700 space-y-1">
            <div>VITE_SUPABASE_URL=&quot;https://tu-proyecto.supabase.co&quot;</div>
            <div>VITE_SUPABASE_ANON_KEY=&quot;tu-clave-publica-anon&quot;</div>
          </div>
          <p className="text-xs text-slate-600">
            Ejecuta el script consolidado <code className="font-mono">supabase/install_all.sql</code> en el SQL Editor de tu proyecto Supabase y agrega ambas variables en tu archivo <code className="font-mono">.env</code> o en el panel de <strong>Secrets</strong> de AI Studio. Luego puedes verificar la conexión con <code className="font-mono">npm run verify:supabase</code>.
          </p>
        </div>
      </div>
    </div>
  );
};
