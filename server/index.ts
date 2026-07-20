import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import helmet from "helmet";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "node:http";

const app = express();
const httpServer = createServer(app);

// Most production hosts (Render, Railway, Fly.io, Heroku, etc.) put the app
// behind a reverse proxy, so req.ip would otherwise resolve to the proxy's
// address for every request. Trusting the first proxy hop lets Express read
// the real client IP from X-Forwarded-For — required for the rate limiters
// in routes.ts to apply per-client instead of lumping every user into one
// shared bucket.
app.set("trust proxy", 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc).
// The CSP default-src is locked to 'self'; the extra origins below are the
// only third parties this app actually loads: Google Fonts / Fontshare for
// webfonts, Stripe.js/Elements for the platform-fee card payment flow, and
// cdnjs (Swagger UI assets for the /api/docs page).
// crossOriginEmbedderPolicy is disabled because it breaks the Stripe iframe.
const isDevelopment = process.env.NODE_ENV !== "production";
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          ...(isDevelopment ? ["'unsafe-inline'"] : []),
          "https://js.stripe.com",
          "https://cdnjs.cloudflare.com",
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://api.fontshare.com",
          "https://cdnjs.cloudflare.com",
        ],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com",
          "https://api.fontshare.com",
          "https://cdn.fontshare.com",
        ],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://api.stripe.com"],
        frameSrc: ["https://js.stripe.com", "https://hooks.stripe.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
  }),
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      // SECURITY: never log response bodies for auth/fee/message/notification/contact
      // endpoints — these can contain session tokens, phone numbers, emails, or
      // other PII/payment data that shouldn't end up in server logs.
      const isSensitivePath =
        /^\/api\/auth\//.test(path) ||
        /^\/api\/(bids|listings)\/.*\/(contact|messages)/.test(path) ||
        /^\/api\/fees\//.test(path) ||
        /^\/api\/listings\/.*\/fees/.test(path) ||
        /^\/api\/notifications/.test(path);
      if (capturedJsonResponse && !isSensitivePath) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;

    // Always log the full error server-side.
    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    // Only surface the error's own message to the client for expected 4xx
    // errors (e.g. a thrown validation error with an explicit status). For
    // 5xx errors — unhandled exceptions, DB failures, etc. — never leak
    // internal error text to the client; return a generic message instead.
    const message = status < 500 ? err.message || "Request failed" : "Internal Server Error";

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  // Loopback-only is fine for local dev, but a real host/container needs to
  // accept connections from outside itself — bind to all interfaces in
  // production unless HOST is explicitly overridden.
  const defaultHost = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
  httpServer.listen(
    {
      port,
      host: process.env.HOST || defaultHost,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
