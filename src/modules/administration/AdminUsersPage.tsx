import React, { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { listUsersForAdmin, toggleUserSuspensionRpc } from '../../services/adminService';
import { ACCOUNT_TYPE_LABELS, formatChileDate } from '../../utils/formatters';
import type { Profile } from '../../types/domain';

export const AdminUsersPage: React.FC = () => {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<Profile[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listUsersForAdmin(search);
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando usuarios.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const handleToggle = async (u: Profile) => {
    setError(null);
    try {
      await toggleUserSuspensionRpc(
        u.id,
        !u.is_suspended,
        reasons[u.id] || (u.is_suspended ? 'Reactivación administrativa' : 'Suspensión preventiva')
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No tienes permisos para suspender cuentas.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#102C49]">Gestión de usuarios</h1>
          <p className="text-sm text-slate-600">
            Consulta cuentas registradas, supervisa suspensiones y reactiva usuarios cuando corresponda.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nombre o usuario..."
            className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2 text-xs"
          />
        </div>
      </div>

      {error && <div className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      {loading ? (
        <div className="h-40 rounded-2xl bg-white border border-slate-200 animate-pulse" />
      ) : (
        <div className="rounded-2xl bg-white border border-slate-200 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-3 px-4 font-semibold">Usuario</th>
                <th className="py-3 px-4 font-semibold">Tipo</th>
                <th className="py-3 px-4 font-semibold">Comuna</th>
                <th className="py-3 px-4 font-semibold">Reputación</th>
                <th className="py-3 px-4 font-semibold">Registro</th>
                <th className="py-3 px-4 font-semibold">Estado</th>
                <th className="py-3 px-4 font-semibold text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-[#F4F6F8]/60">
                  <td className="py-3 px-4">
                    <div className="font-bold text-[#102C49]">{u.full_name}</div>
                    <div className="text-slate-500">@{u.username}</div>
                  </td>
                  <td className="py-3 px-4">{ACCOUNT_TYPE_LABELS[u.account_type]}</td>
                  <td className="py-3 px-4">{u.communes?.name || '—'}</td>
                  <td className="py-3 px-4 font-mono tabular-nums">
                    {Number(u.reputation_avg).toFixed(1)} ({u.reputation_count})
                  </td>
                  <td className="py-3 px-4">{formatChileDate(u.created_at)}</td>
                  <td className="py-3 px-4">
                    <span className={u.is_suspended ? 'text-red-700 font-semibold' : 'text-[#1E7E48] font-semibold'}>
                      {u.is_suspended ? 'Suspendida' : 'Activa'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right space-x-2">
                    <input
                      type="text"
                      value={reasons[u.id] ?? ''}
                      onChange={(e) => setReasons((prev) => ({ ...prev, [u.id]: e.target.value }))}
                      placeholder="Motivo..."
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs w-36"
                    />
                    <button
                      type="button"
                      onClick={() => handleToggle(u)}
                      className={`px-3 py-1.5 rounded-lg font-semibold ${
                        u.is_suspended
                          ? 'bg-[#1E7E48] text-white'
                          : 'border border-red-300 text-red-700 hover:bg-red-50'
                      }`}
                    >
                      {u.is_suspended ? 'Reactivar' : 'Suspender'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
