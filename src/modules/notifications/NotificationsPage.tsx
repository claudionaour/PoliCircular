import React from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext';
import { formatChileDateTime } from '../../utils/formatters';

export const NotificationsPage: React.FC = () => {
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead } = useNotifications();

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#102C49]">Notificaciones</h1>
          <p className="text-sm text-slate-600 tabular-nums">
            {unreadCount} sin leer · Historial de eventos en tiempo real
          </p>
        </div>

        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => markAllAsRead()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-[#102C49] hover:bg-[#F4F6F8]"
          >
            <CheckCheck className="h-4 w-4 text-[#1E7E48]" />
            <span>Marcar todas como leídas</span>
          </button>
        )}
      </div>

      {loading ? (
        <div className="h-32 rounded-2xl bg-white border border-slate-200 animate-pulse" />
      ) : notifications.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center space-y-2">
          <Bell className="h-8 w-8 text-slate-300 mx-auto" />
          <p className="font-display font-bold text-sm text-[#102C49]">Sin notificaciones aún</p>
          <p className="text-xs text-slate-500">
            Recibirás avisos cuando aprueben tus publicaciones, recibas solicitudes, mensajes o logros.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`p-4 flex items-start justify-between gap-4 ${
                n.is_read ? 'bg-white' : 'bg-[#FFF8F1]/60'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-display font-bold text-sm text-[#102C49]">{n.title}</h2>
                  {!n.is_read && (
                    <span className="text-[11px] font-semibold text-[#F28C28]">Nueva</span>
                  )}
                </div>
                <p className="text-xs text-slate-600">{n.body}</p>
                <p className="text-[11px] text-slate-400">{formatChileDateTime(n.created_at)}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {n.link_path && (
                  <Link
                    to={n.link_path}
                    onClick={() => !n.is_read && markAsRead(n.id)}
                    className="px-3 py-1.5 rounded-lg bg-[#102C49] text-white text-xs font-semibold"
                  >
                    Ver
                  </Link>
                )}
                {!n.is_read && (
                  <button
                    type="button"
                    onClick={() => markAsRead(n.id)}
                    className="text-xs font-medium text-slate-500 hover:text-[#102C49]"
                  >
                    Leída
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
