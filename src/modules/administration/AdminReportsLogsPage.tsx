import React, { useCallback, useEffect, useState } from 'react';
import {
  listModerationLogs,
  listReportsAdmin,
  resolveReportRpc,
} from '../../services/adminService';
import { formatChileDateTime } from '../../utils/formatters';
import type { ModerationLog, ReportRecord } from '../../types/domain';

export const AdminReportsPage: React.FC = () => {
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await listReportsAdmin();
      setReports(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando denuncias.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleResolve = async (id: string, status: 'under_review' | 'resolved' | 'dismissed') => {
    setError(null);
    const note = notes[id] || '';
    if (note.trim().length < 5) {
      setError('Ingresa una resolución o nota de trazabilidad.');
      return;
    }
    try {
      await resolveReportRpc(id, status, note);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la denuncia.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#102C49]">Gestión de denuncias</h1>
        <p className="text-sm text-slate-600">
          Revisa reportes de publicaciones, usuarios, conversaciones, evaluaciones o entregas.
        </p>
      </div>

      {error && <div className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      <div className="space-y-4">
        {reports.length === 0 ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
            No existen denuncias registradas.
          </div>
        ) : (
          reports.map((rep) => (
            <div key={rep.id} className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-[#102C49]">
                  Tipo: {rep.target_type} · {rep.reason_category}
                </span>
                <span className="font-semibold text-[#F28C28]">Estado: {rep.status}</span>
              </div>
              <p className="text-sm text-slate-700">{rep.description}</p>
              <p className="text-slate-500">
                Reportado por: {rep.reporter?.full_name || 'Usuario'} · {formatChileDateTime(rep.created_at)}
              </p>
              {rep.resolution_notes && (
                <p className="bg-[#F4F6F8] p-2.5 rounded-xl text-slate-700">
                  <strong>Resolución:</strong> {rep.resolution_notes}
                </p>
              )}

              <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-slate-100">
                <input
                  type="text"
                  value={notes[rep.id] ?? ''}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [rep.id]: e.target.value }))}
                  placeholder="Registra la decisión administrativa..."
                  className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleResolve(rep.id, 'under_review')}
                    className="px-3 py-2 rounded-xl border border-slate-300 font-semibold"
                  >
                    En revisión
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResolve(rep.id, 'resolved')}
                    className="px-3 py-2 rounded-xl bg-[#1E7E48] text-white font-semibold"
                  >
                    Resolver
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResolve(rep.id, 'dismissed')}
                    className="px-3 py-2 rounded-xl bg-slate-700 text-white font-semibold"
                  >
                    Desestimar
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export const AdminHistoryPage: React.FC = () => {
  const [logs, setLogs] = useState<ModerationLog[]>([]);

  useEffect(() => {
    listModerationLogs().then(setLogs).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#102C49]">Historial de auditoría</h1>
        <p className="text-sm text-slate-600">
          Registro trazable de aprobaciones, rechazos, suspensiones y resoluciones administrativas.
        </p>
      </div>

      <div className="rounded-2xl bg-white border border-slate-200 overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-3 px-4 font-semibold">Fecha</th>
              <th className="py-3 px-4 font-semibold">Actor</th>
              <th className="py-3 px-4 font-semibold">Acción</th>
              <th className="py-3 px-4 font-semibold">Objetivo</th>
              <th className="py-3 px-4 font-semibold">Cambio</th>
              <th className="py-3 px-4 font-semibold">Notas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 px-4 text-center text-slate-500">
                  Sin registros de moderación aún.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id}>
                  <td className="py-3 px-4 font-mono">{formatChileDateTime(log.created_at)}</td>
                  <td className="py-3 px-4">{log.actor?.full_name || 'Moderador'}</td>
                  <td className="py-3 px-4 font-semibold text-[#102C49]">{log.action}</td>
                  <td className="py-3 px-4">{log.target_type}</td>
                  <td className="py-3 px-4">
                    {log.previous_status || '—'} → {log.new_status || '—'}
                  </td>
                  <td className="py-3 px-4 text-slate-600">{log.notes || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
