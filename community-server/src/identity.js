const MAIN_BACKEND_URL = (process.env.REMUS_MAIN_BACKEND_URL || "http://localhost:3001").replace(/\/$/, "");
const CACHE_TTL_MS = 5_000;

const tokenCache = new Map();

// Cleanup expired token cache entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of tokenCache.entries()) {
    if (entry.expiresAt <= now) {
      tokenCache.delete(token);
    }
  }
}, 60 * 1000);

async function verifyWithMainBackend(token) {
  const response = await fetch(`${MAIN_BACKEND_URL}/api/auth/verify`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  return payload?.user || null;
}

export async function resolveUserFromToken(token) {
  if (!token) return null;

  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  const user = await verifyWithMainBackend(token);
  if (!user) return null;

  tokenCache.set(token, {
    user,
    expiresAt: Date.now() + CACHE_TTL_MS
  });

  return user;
}

export async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }

  try {
    const user = await resolveUserFromToken(token);
    if (!user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    req.auth = {
      token,
      user
    };

    return next();
  } catch {
    return res.status(503).json({ error: "Main backend auth verification unavailable" });
  }
}

export function socketAuth(io, onAuthenticated) {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error("Missing token"));
    }

    try {
      const user = await resolveUserFromToken(token);
      if (!user) {
        return next(new Error("Invalid token"));
      }

      socket.user = user;
      if (typeof onAuthenticated === "function") {
        onAuthenticated(user);
      }

      return next();
    } catch {
      return next(new Error("Main backend auth verification unavailable"));
    }
  });
}

export function getMainBackendUrl() {
  return MAIN_BACKEND_URL;
}
