import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, Info, Printer, Scale } from 'lucide-react';
import {
  getCommunityParticipationCounts,
  listImpactRecords,
} from '../../services/treeImpactService';
import { listActiveCommunes } from '../../services/territorialService';
import { exportImpactCsv } from '../../utils/csvExport';
import { SupabaseSetupNotice } from '../../components/SupabaseSetupNotice';
import type { Commune, ImpactRecord } from '../../types/domain';

export const ImpactPage: React.FC = () => {
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [selectedCommuneId, setSelectedCommuneId] = useState('');
  const [records, setRecords] = useState<ImpactRecord[]>([]);
  const [counts, setCounts] = useState({ participantsCount: 0, organizationsCount: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listActiveCommunes().then(setCommunes).catch(() => {});
    getCommunityParticipationCounts().then(setCounts).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    listImpactRecords(selectedCommuneId || undefined)
      .then(setRecords)
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [selectedCommuneId]);

  const stats = useMemo(() => {
    let totalUnits = 0;
    let gifts = 0;
    let exchanges = 0;
    let measuredKg = 0;
    let estimatedKg = 0;
    const byCategory = new Map<string, number>();
    const bySector = new Map<string, number>();
    const byMonth = new Map<string, number>();

    for (const r of records) {
      totalUnits += r.quantity;
      if (r.modality === 'gift') gifts += 1;
      else exchanges += 1;

      if (r.weight_type === 'measured') measuredKg += Number(r.weight_kg);
      else estimatedKg += Number(r.weight_kg);

      const catName = r.categories?.name || 'Otros';
      byCategory.set(catName, (byCategory.get(catName) ?? 0) + r.quantity);

      const secName = r.sectors?.name || r.communes?.name || 'Referencia comunal';
      bySector.set(secName, (bySector.get(secName) ?? 0) + r.quantity);

      const monthKey = r.created_at.slice(0, 7);
      byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + r.quantity);
    }

    return {
      totalUnits,
      gifts,
      exchanges,
      measuredKg,
      estimatedKg,
      categories: Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]),
      sectors: Array.from(bySector.entries()).sort((a, b) => b[1] - a[1]),
      months: Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [records]);

  const selectedCommuneName =
    communes.find((c) => c.id === selectedCommuneId)?.name || 'Todas las comunas';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <SupabaseSetupNotice />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#102C49]">
            Impacto Circular
          </h1>
          <p className="text-sm text-slate-600">
            Seguimiento transparente de reutilización comunitaria. Nunca mezclamos estimaciones con mediciones reales.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={selectedCommuneId}
            onChange={(e) => setSelectedCommuneId(e.target.value)}
            aria-label="Filtrar impacto por comuna"
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-[#102C49]"
          >
            <option value="">Todas las comunas</option>
            {communes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => exportImpactCsv(records, selectedCommuneName)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#102C49] text-white text-xs font-semibold hover:bg-[#0B2036]"
          >
            <Download className="h-4 w-4" />
            <span>Descargar informe CSV</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-[#102C49] hover:bg-[#F4F6F8]"
          >
            <Printer className="h-4 w-4" />
            <span>Imprimir reporte</span>
          </button>
        </div>
      </div>

      {/* KPI principales */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="rounded-2xl bg-white border border-slate-200 p-5">
          <span className="text-xs text-slate-500 block">Productos reutilizados</span>
          <span className="font-mono text-2xl font-bold text-[#102C49] tabular-nums mt-1 block">
            {stats.totalUnits}
          </span>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-5">
          <span className="text-xs text-slate-500 block">Regalos completados</span>
          <span className="font-mono text-2xl font-bold text-[#1E7E48] tabular-nums mt-1 block">
            {stats.gifts}
          </span>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-5">
          <span className="text-xs text-slate-500 block">Intercambios realizados</span>
          <span className="font-mono text-2xl font-bold text-[#F28C28] tabular-nums mt-1 block">
            {stats.exchanges}
          </span>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-5">
          <span className="text-xs text-slate-500 block">Usuarios participantes</span>
          <span className="font-mono text-2xl font-bold text-[#102C49] tabular-nums mt-1 block">
            {counts.participantsCount}
          </span>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200 p-5">
          <span className="text-xs text-slate-500 block">Organizaciones / Escuelas</span>
          <span className="font-mono text-2xl font-bold text-[#102C49] tabular-nums mt-1 block">
            {counts.organizationsCount}
          </span>
        </div>
      </div>

      {/* Separación estricta: Peso Medido vs Peso Estimado */}
      <div className="grid md:grid-cols-2 gap-6">
        <section className="rounded-2xl bg-white border border-[#1E7E48]/40 p-6 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#1E7E48] bg-[#E6F4EA] px-2.5 py-1 rounded-lg">
              PESO MEDIDO (pesaje real)
            </span>
            <Scale className="h-5 w-5 text-[#1E7E48]" />
          </div>
          <p className="font-mono text-3xl font-bold text-[#102C49] tabular-nums pt-2">
            {stats.measuredKg.toFixed(2)} kg
          </p>
          <p className="text-xs text-slate-600">
            Corresponde exclusivamente a entregas pesadas físicamente y declaradas al confirmar la operación.
          </p>
        </section>

        <section className="rounded-2xl bg-white border border-slate-200 p-6 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#102C49] bg-[#F4F6F8] px-2.5 py-1 rounded-lg">
              PESO ESTIMADO (metodología de referencia)
            </span>
            <Info className="h-5 w-5 text-[#F28C28]" />
          </div>
          <p className="font-mono text-3xl font-bold text-[#102C49] tabular-nums pt-2">
            {stats.estimatedKg.toFixed(2)} kg
          </p>
          <p className="text-xs text-slate-600">
            Calculado mediante pesos de referencia por categoría cuando no existió pesaje real. No representa medición directa.
          </p>
        </section>
      </div>

      {/* Gráficos por categoría, sector y evolución mensual */}
      {loading ? (
        <div className="h-48 rounded-2xl bg-white border border-slate-200 animate-pulse" />
      ) : (
        <div className="grid lg:grid-cols-3 gap-6">
          <section className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4">
            <div className="flex items-center gap-2 font-display font-bold text-sm text-[#102C49]">
              <BarChart3 className="h-4 w-4 text-[#F28C28]" />
              <h2>Categorías con mayor reutilización</h2>
            </div>
            {stats.categories.length === 0 ? (
              <p className="text-xs text-slate-500">Sin operaciones registradas aún.</p>
            ) : (
              <div className="space-y-3">
                {stats.categories.slice(0, 6).map(([name, qty]) => {
                  const pct = Math.round((qty / Math.max(1, stats.totalUnits)) * 100);
                  return (
                    <div key={name} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium text-[#102C49]">{name}</span>
                        <span className="font-mono tabular-nums text-slate-600">{qty} u. ({pct}%)</span>
                      </div>
                      <div className="h-2 rounded-full bg-[#F4F6F8] overflow-hidden">
                        <div className="h-full bg-[#F28C28]" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4">
            <h2 className="font-display font-bold text-sm text-[#102C49]">
              Sectores con mayor participación
            </h2>
            {stats.sectors.length === 0 ? (
              <p className="text-xs text-slate-500">Sin registros por sector aún.</p>
            ) : (
              <div className="space-y-3">
                {stats.sectors.slice(0, 6).map(([name, qty]) => {
                  const pct = Math.round((qty / Math.max(1, stats.totalUnits)) * 100);
                  return (
                    <div key={name} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-medium text-[#102C49]">{name}</span>
                        <span className="font-mono tabular-nums text-slate-600">{qty} u.</span>
                      </div>
                      <div className="h-2 rounded-full bg-[#F4F6F8] overflow-hidden">
                        <div className="h-full bg-[#1E7E48]" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4">
            <h2 className="font-display font-bold text-sm text-[#102C49]">Evolución mensual</h2>
            {stats.months.length === 0 ? (
              <p className="text-xs text-slate-500">Los datos aparecerán al finalizar operaciones.</p>
            ) : (
              <div className="space-y-2.5">
                {stats.months.map(([month, qty]) => (
                  <div key={month} className="flex items-center justify-between text-xs border-b border-slate-100 pb-2">
                    <span className="font-mono text-slate-600">{month}</span>
                    <span className="font-mono font-bold text-[#102C49] tabular-nums">{qty} productos</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
