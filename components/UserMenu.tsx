"use client";

import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

export default function UserMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);

      if (user) {
        // Fetch profile data
        const { data } = await supabase
          .from('guests')
          .select('*')
          .eq('id', user.id)
          .single();
        
        setProfile(data);
      }
    };

    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsOpen(false);
    router.push('/');
    router.refresh();
  };

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <a
          href="/auth/login"
          className="text-neutral hover:text-primary transition-colors px-4 py-2"
        >
          Sign In
        </a>
        <a
          href="/auth/register"
          className="bg-primary text-base px-6 py-2 rounded-full hover:bg-primary/90 transition-colors"
        >
          Sign Up
        </a>
      </div>
    );
  }

  const displayName = profile 
    ? `${profile.first_name} ${profile.last_name}`
    : user.email?.split('@')[0];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-neutral hover:text-primary transition-colors"
      >
        <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
          <span className="text-primary font-semibold">
            {profile?.first_name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase()}
          </span>
        </div>
        <span className="hidden md:block font-medium">{displayName}</span>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-xl z-50 py-2 border border-neutral/10">
            <div className="px-4 py-3 border-b border-neutral/10">
              <p className="text-sm font-semibold text-neutral">{displayName}</p>
              <p className="text-xs text-neutral/60">{user.email}</p>
            </div>
            
            <a
              href="/manage"
              className="block px-4 py-2 text-sm text-neutral hover:bg-neutral/5 transition-colors"
              onClick={() => setIsOpen(false)}
            >
              My Bookings
            </a>
            
            <a
              href="/profile"
              className="block px-4 py-2 text-sm text-neutral hover:bg-neutral/5 transition-colors"
              onClick={() => setIsOpen(false)}
            >
              Profile Settings
            </a>
            
            <div className="border-t border-neutral/10 mt-2 pt-2">
              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
