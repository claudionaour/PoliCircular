import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LogIn } from 'lucide-react';
import { signInUser } from '../../services/authService';
import { isSupabaseConfigured } from '../../services/supabase';
import { SupabaseSetupNotice } from '../../components/SupabaseSetupNotice';

const loginSchema = z.object({
  email: z.string().email('Ingresa un correo electrónico válido.'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  const fromPath = (location.state as { from?: string } | null)?.from || '/inicio';

  const onSubmit = async (values: LoginFormValues) => {
    setServerError(null);
    try {
      await signInUser(values.email, values.password);
      navigate(fromPath, { replace: true });
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : 'No fue posible iniciar sesión. Verifica tus datos.'
      );
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <div className="mb-6">
        <SupabaseSetupNotice />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
        <div className="flex items-center gap-2.5 mb-2">
          <LogIn className="h-5 w-5 text-[#F28C28]" />
          <h1 className="font-display text-2xl font-bold text-[#102C49]">Iniciar sesión</h1>
        </div>
        <p className="text-sm text-slate-600 mb-6">
          Ingresa con tu correo verificado para publicar, proponer intercambios y revisar tu Árbol Circular.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#102C49] mb-1.5">
              Correo electrónico
            </label>
            <input
              type="email"
              autoComplete="email"
              {...register('email')}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-[#102C49] focus:outline-none"
              placeholder="nombre@correo.cl"
            />
            {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-[#102C49]">Contraseña</label>
              <Link to="/recuperar-contrasena" className="text-xs font-medium text-[#F28C28] hover:underline">
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
            <input
              type="password"
              autoComplete="current-password"
              {...register('password')}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-[#102C49] focus:outline-none"
            />
            {errors.password && (
              <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
            )}
          </div>

          {serverError && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-800">
              {serverError}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !isSupabaseConfigured}
            className="w-full rounded-xl bg-[#102C49] py-3 text-sm font-semibold text-white hover:bg-[#0B2036] transition-colors disabled:opacity-50 min-h-[44px]"
          >
            {isSubmitting ? 'Ingresando...' : 'Iniciar sesión'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-600">
          ¿Aún no tienes cuenta?{' '}
          <Link to="/registro" className="font-semibold text-[#F28C28] hover:underline">
            Crear cuenta gratuita
          </Link>
        </p>
      </div>
    </div>
  );
};
