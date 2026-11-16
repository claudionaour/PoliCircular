import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { sendPasswordRecovery, updateUserPassword } from '../../services/authService';
import { isSupabaseConfigured } from '../../services/supabase';

export const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await sendPasswordRecovery(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible enviar el correo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <KeyRound className="h-5 w-5 text-[#F28C28]" />
          <h1 className="font-display text-xl font-bold text-[#102C49]">Recuperar contraseña</h1>
        </div>
        {sent ? (
          <div className="space-y-4 mt-4">
            <p className="text-sm text-slate-600">
              Si existe una cuenta asociada a <strong>{email}</strong>, recibirás un enlace para restablecer tu contraseña.
            </p>
            <Link to="/iniciar-sesion" className="inline-block text-sm font-semibold text-[#102C49] hover:underline">
              Volver a iniciar sesión
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            <div>
              <label className="block text-xs font-semibold text-[#102C49] mb-1.5">Correo electrónico</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm"
              />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading || !isSupabaseConfigured}
              className="w-full rounded-xl bg-[#102C49] py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? 'Enviando...' : 'Enviar enlace de recuperación'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export const ResetPasswordPage: React.FC = () => {
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError('Ingresa al menos 8 caracteres.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await updateUserPassword(password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible actualizar la contraseña.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
        <h1 className="font-display text-xl font-bold text-[#102C49]">Nueva contraseña</h1>
        {done ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-[#1E7E48]">Contraseña actualizada correctamente.</p>
            <Link to="/inicio" className="inline-block px-4 py-2 rounded-xl bg-[#102C49] text-white text-sm font-semibold">
              Ir a PoliCircular
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm"
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[#102C49] py-2.5 text-sm font-semibold text-white"
            >
              {loading ? 'Guardando...' : 'Actualizar contraseña'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
