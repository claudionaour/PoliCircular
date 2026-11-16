import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../services/supabase';
import { fetchUserProfile, fetchUserRoles, signOutUser } from '../services/authService';
import type { Profile, UserRole } from '../types/domain';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: UserRole[];
  loading: boolean;
  isModerator: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<UserRole[]>(['user']);
  const [loading, setLoading] = useState<boolean>(isSupabaseConfigured);

  const loadUserData = useCallback(async (uid: string) => {
    try {
      const [prof, userRoles] = await Promise.all([
        fetchUserProfile(uid),
        fetchUserRoles(uid),
      ]);
      setProfile(prof);
      setRoles(userRoles);
    } catch {
      setProfile(null);
      setRoles(['user']);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }

    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      const sess = data.session;
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        await loadUserData(sess.user.id);
      }
      if (active) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, sess) => {
      if (!active) return;
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        await loadUserData(sess.user.id);
      } else {
        setProfile(null);
        setRoles(['user']);
      }
      setLoading(false);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [loadUserData]);

  const refreshProfile = useCallback(async () => {
    if (user) {
      await loadUserData(user.id);
    }
  }, [user, loadUserData]);

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    await signOutUser();
    setSession(null);
    setUser(null);
    setProfile(null);
    setRoles(['user']);
  }, []);

  const isSuperAdmin = roles.includes('super_admin');
  const isAdmin = isSuperAdmin || roles.includes('admin');
  const isModerator = isAdmin || roles.includes('moderator');

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        roles,
        loading,
        isModerator,
        isAdmin,
        isSuperAdmin,
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe utilizarse dentro de AuthProvider.');
  }
  return ctx;
}
