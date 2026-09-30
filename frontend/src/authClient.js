// Native MySQL & JWT Auth Client (100% self-hosted, no Supabase dependency)

const STORAGE_KEY = "taskflow_auth_session";
const listeners = new Set();

function getStoredSession() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setStoredSession(session) {
  try {
    if (session) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch (e) {
    console.error("Failed to update localStorage", e);
  }
}

function notifyListeners(event, session) {
  listeners.forEach((callback) => {
    try {
      callback(event, session);
    } catch (e) {
      console.error("Auth listener error", e);
    }
  });
}

export const authClient = {
  auth: {
    async getSession() {
      const session = getStoredSession();
      return { data: { session }, error: null };
    },

    onAuthStateChange(callback) {
      listeners.add(callback);
      const session = getStoredSession();
      setTimeout(() => callback(session ? "SIGNED_IN" : "INITIAL", session), 0);

      return {
        data: {
          subscription: {
            unsubscribe: () => {
              listeners.delete(callback);
            },
          },
        },
      };
    },

    async signInWithPassword({ email, password }) {
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) {
          return { data: null, error: new Error(data.message || "Login failed") };
        }

        const session = {
          access_token: data.token,
          user: {
            id: data.user.id,
            email: data.user.email,
            user_metadata: {
              display_name: data.user.display_name,
            },
          },
        };

        setStoredSession(session);
        notifyListeners("SIGNED_IN", session);
        return { data: { user: session.user, session }, error: null };
      } catch (err) {
        return { data: null, error: err };
      }
    },

    async signUp({ email, password, options }) {
      try {
        const displayName = options?.data?.display_name || "";
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, display_name: displayName }),
        });
        const data = await res.json();
        if (!res.ok) {
          return { data: null, error: new Error(data.message || "Registration failed") };
        }

        const session = {
          access_token: data.token,
          user: {
            id: data.user.id,
            email: data.user.email,
            user_metadata: {
              display_name: data.user.display_name,
            },
          },
        };

        setStoredSession(session);
        notifyListeners("SIGNED_IN", session);
        return { data: { user: session.user, session }, error: null };
      } catch (err) {
        return { data: null, error: err };
      }
    },

    async signOut() {
      setStoredSession(null);
      notifyListeners("SIGNED_OUT", null);
      return { error: null };
    },

    async updateUser({ password }) {
      const session = getStoredSession();
      if (!session?.access_token) {
        return { error: new Error("Not authenticated") };
      }
      try {
        const res = await fetch("/api/auth/update-password", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ password }),
        });
        const data = await res.json();
        if (!res.ok) {
          return { error: new Error(data.message || "Failed to update password") };
        }
        return { error: null };
      } catch (err) {
        return { error: err };
      }
    },
  },
};
