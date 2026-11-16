import React, { useCallback, useEffect, useState } from 'react';
import { listAllCommunes, listSectorsByCommune } from '../../services/territorialService';
import { saveCommuneAdmin, saveSectorAdmin } from '../../services/adminService';
import type { Commune, Sector } from '../../types/domain';

export const AdminTerritorialPage: React.FC = () => {
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [selectedCommuneId, setSelectedCommuneId] = useState('');
  const [sectors, setSectors] = useState<Sector[]>([]);

  const [newCommuneName, setNewCommuneName] = useState('');
  const [newCommuneRegion, setNewCommuneRegion] = useState('Los Lagos');
  const [newSectorName, setNewSectorName] = useState('');
  const [newSectorDesc, setNewSectorDesc] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadCommunes = useCallback(async () => {
    const list = await listAllCommunes();
    setCommunes(list);
    if (!selectedCommuneId && list[0]) {
      setSelectedCommuneId(list[0].id);
    }
  }, [selectedCommuneId]);

  useEffect(() => {
    loadCommunes().catch(() => {});
  }, [loadCommunes]);

  const loadSectors = useCallback(async () => {
    if (!selectedCommuneId) return;
    const list = await listSectorsByCommune(selectedCommuneId, false);
    setSectors(list);
  }, [selectedCommuneId]);

  useEffect(() => {
    loadSectors().catch(() => {});
  }, [loadSectors]);

  const handleToggleCommune = async (c: Commune) => {
    setError(null);
    try {
      await saveCommuneAdmin({ ...c, is_active: !c.is_active });
      await loadCommunes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No autorizado para editar comunas.');
    }
  };

  const handleAddCommune = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommuneName.trim()) return;
    setError(null);
    try {
      await saveCommuneAdmin({
        name: newCommuneName,
        region: newCommuneRegion,
        is_active: true,
      });
      setNewCommuneName('');
      await loadCommunes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creando comuna.');
    }
  };

  const handleAddSector = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCommuneId || !newSectorName.trim()) return;
    setError(null);
    try {
      await saveSectorAdmin({
        commune_id: selectedCommuneId,
        name: newSectorName,
        description: newSectorDesc,
        is_active: true,
      });
      setNewSectorName('');
      setNewSectorDesc('');
      await loadSectors();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creando sector.');
    }
  };

  const handleToggleSector = async (s: Sector) => {
    setError(null);
    try {
      await saveSectorAdmin({
        id: s.id,
        commune_id: s.commune_id,
        name: s.name,
        description: s.description || undefined,
        approx_lat: s.approx_lat,
        approx_lng: s.approx_lng,
        is_active: !s.is_active,
      });
      await loadSectors();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error actualizando sector.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#102C49]">Gestión territorial</h1>
        <p className="text-sm text-slate-600">
          Administra comunas activas de Chiloé y Chile y define sectores validados localmente sin inventar límites geográficos.
        </p>
      </div>

      {error && <div className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Comunas */}
        <section className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4">
          <h2 className="font-display font-bold text-base text-[#102C49]">Comunas</h2>
          <form onSubmit={handleAddCommune} className="flex gap-2">
            <input
              type="text"
              value={newCommuneName}
              onChange={(e) => setNewCommuneName(e.target.value)}
              placeholder="Nueva comuna..."
              className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs"
            />
            <input
              type="text"
              value={newCommuneRegion}
              onChange={(e) => setNewCommuneRegion(e.target.value)}
              placeholder="Región"
              className="w-32 rounded-xl border border-slate-300 px-3 py-2 text-xs"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-[#102C49] text-white text-xs font-semibold"
            >
              Agregar
            </button>
          </form>

          <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
            {communes.map((c) => (
              <div key={c.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setSelectedCommuneId(c.id)}
                  className={`text-left font-semibold ${
                    selectedCommuneId === c.id ? 'text-[#F28C28]' : 'text-[#102C49]'
                  }`}
                >
                  {c.name} <span className="font-normal text-slate-500">({c.region})</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleCommune(c)}
                  className={`px-3 py-1 rounded-lg font-semibold ${
                    c.is_active
                      ? 'bg-[#E6F4EA] text-[#1E7E48]'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {c.is_active ? 'Activa' : 'Inactiva'}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Sectores de la comuna seleccionada */}
        <section className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4">
          <h2 className="font-display font-bold text-base text-[#102C49]">
            Sectores administrables ({communes.find((c) => c.id === selectedCommuneId)?.name || '—'})
          </h2>
          <form onSubmit={handleAddSector} className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={newSectorName}
                onChange={(e) => setNewSectorName(e.target.value)}
                placeholder="Nombre del sector validado..."
                className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#F28C28] text-white text-xs font-semibold"
              >
                Crear sector
              </button>
            </div>
            <input
              type="text"
              value={newSectorDesc}
              onChange={(e) => setNewSectorDesc(e.target.value)}
              placeholder="Referencia breve (opcional)"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
            />
          </form>

          <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
            {sectors.length === 0 ? (
              <p className="text-xs text-slate-500 py-4">Sin sectores registrados en esta comuna.</p>
            ) : (
              sectors.map((s) => (
                <div key={s.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="font-semibold text-[#102C49]">{s.name}</div>
                    {s.description && <div className="text-slate-500">{s.description}</div>}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleSector(s)}
                    className={`px-3 py-1 rounded-lg font-semibold ${
                      s.is_active
                        ? 'bg-[#E6F4EA] text-[#1E7E48]'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {s.is_active ? 'Activo' : 'Desactivado'}
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
