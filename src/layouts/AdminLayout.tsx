import React from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import {
  ArrowLeft,
  CheckSquare,
  Flag,
  GraduationCap,
  History,
  LayoutDashboard,
  MapPin,
  Shield,
  Users,
} from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../utils/formatters';

const ADMIN_NAV = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/moderacion', label: 'Publicaciones', icon: CheckSquare },
  { to: '/admin/usuarios', label: 'Usuarios', icon: Users },
  { to: '/admin/territorio', label: 'Territorio', icon: MapPin },
  { to: '/admin/educacion', label: 'Establecimientos', icon: GraduationCap },
  { to: '/admin/denuncias', label: 'Denuncias', icon: Flag },
  { to: '/admin/historial', label: 'Auditoría', icon: History },
];

export const AdminLayout: React.FC = () => {
  const { roles } = useAuth();
  const primaryRole = roles.includes('super_admin')
    ? 'super_admin'
    : roles.includes('admin')
      ? 'admin'
      : 'moderator';

  return (
    <div className="min-h-screen bg-[#F4F6F8] text-[#102C49] flex flex-col lg:flex-row">
      <aside className="w-full lg:w-64 bg-[#102C49] text-white shrink-0 flex flex-col">
        <div className="p-5 border-b border-white/10 flex items-center justify-between lg:block">
          <BrandLogo size="sm" lightText />
          <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-300">
            <Shield className="h-3.5 w-3.5 text-[#F28C28]" />
            <span>{ROLE_LABELS[primaryRole]}</span>
          </div>
        </div>

        <nav className="flex lg:flex-col overflow-x-auto lg:overflow-y-auto px-3 py-3 gap-1">
          {ADMIN_NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap shrink-0 transition-colors ${
                    isActive
                      ? 'bg-[#F28C28] text-white'
                      : 'text-slate-200 hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="mt-auto p-4 border-t border-white/10 hidden lg:block">
          <Link
            to="/inicio"
            className="flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Volver a la plataforma comunitaria</span>
          </Link>
        </div>
      </aside>

      <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
        <Outlet />
      </main>
    </div>
  );
};
