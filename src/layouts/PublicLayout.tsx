import React from 'react';
import { Link, Outlet } from 'react-router-dom';
import { BrandLogo } from '../components/BrandLogo';
import { OfflineIndicator } from '../components/OfflineIndicator';
import { useAuth } from '../context/AuthContext';

export const PublicLayout: React.FC = () => {
  const { user } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#102C49]">
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <Link to="/" className="shrink-0 focus-visible:outline-2 focus-visible:outline-[#F28C28] rounded-lg">
            <BrandLogo size="md" />
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <Link to="/explorar" className="hover:text-[#102C49] transition-colors whitespace-nowrap shrink-0">
              Explorar
            </Link>
            <Link to="/impacto" className="hover:text-[#102C49] transition-colors whitespace-nowrap shrink-0">
              Impacto Circular
            </Link>
            <Link to="/educacion" className="hover:text-[#102C49] transition-colors whitespace-nowrap shrink-0">
              Centro Educativo
            </Link>
            <Link to="/reglas-comunitarias" className="hover:text-[#102C49] transition-colors whitespace-nowrap shrink-0">
              Reglas y Privacidad
            </Link>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            {user ? (
              <Link
                to="/inicio"
                className="px-4 py-2 rounded-xl bg-[#102C49] text-white text-sm font-semibold hover:bg-[#0B2036] transition-colors whitespace-nowrap shrink-0"
              >
                Mi espacio
              </Link>
            ) : (
              <Link
                to="/iniciar-sesion"
                className="px-4 py-2 rounded-xl bg-[#102C49] text-white text-sm font-semibold hover:bg-[#0B2036] transition-colors whitespace-nowrap shrink-0"
              >
                Iniciar sesión
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-[#F4F6F8] py-10 text-sm text-slate-600">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <BrandLogo size="sm" />
            <p className="text-xs text-slate-500 max-w-md">
              Plataforma comunitaria y educativa de economía circular sin uso de dinero. Nacida en Castro, Archipiélago de Chiloé, Chile.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-6 text-xs font-medium text-slate-600">
            <Link to="/explorar" className="hover:text-[#102C49]">
              Explorar catálogo
            </Link>
            <Link to="/educacion" className="hover:text-[#102C49]">
              Aprendamos a Circular
            </Link>
            <Link to="/impacto" className="hover:text-[#102C49]">
              Impacto Circular
            </Link>
            <Link to="/reglas-comunitarias" className="hover:text-[#102C49]">
              Términos, privacidad y reglas
            </Link>
          </div>
        </div>
      </footer>

      <OfflineIndicator />
    </div>
  );
};
