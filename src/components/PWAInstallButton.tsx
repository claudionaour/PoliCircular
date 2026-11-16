import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-2 rounded-lg border border-[#102C49]/20 bg-white px-3.5 py-2 text-xs font-semibold text-[#102C49] hover:bg-[#F4F6F8] transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
      >
        <Download className="h-4 w-4 text-[#F28C28]" />
        {compact ? 'Instalar' : 'Instalar app'}
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-[#102C49]/20 bg-white px-3.5 py-2 text-xs font-semibold text-[#102C49] hover:bg-[#F4F6F8] transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
        >
          <Share className="h-4 w-4 text-[#F28C28]" />
          {compact ? 'Instalar' : 'Instalar en iOS'}
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-bold text-[#102C49]">
                  Instalar PoliCircular en iPhone o iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-2 text-slate-500 hover:text-[#102C49] rounded-lg"
                  aria-label="Cerrar guía de instalación"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <ol className="mt-4 space-y-2.5 text-sm text-slate-700 list-decimal list-inside">
                <li>
                  Toca el botón <strong>Compartir</strong> en la barra inferior de Safari.
                </li>
                <li>
                  Desliza hacia abajo y selecciona <strong>Agregar a inicio</strong>.
                </li>
                <li>Confirma tocando <strong>Agregar</strong> en la esquina superior derecha.</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-[#102C49] py-2.5 text-sm font-semibold text-white hover:bg-[#0B2036] transition-colors"
              >
                Entendido
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
