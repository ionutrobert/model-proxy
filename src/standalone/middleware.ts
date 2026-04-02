// ============================================================================
// Express Middleware
// ============================================================================

import { Request, Response, NextFunction } from 'express';

// ============================================================================
// Logging Middleware
// ============================================================================

export function createLoggingMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();
    
    // Store original end function
    const originalEnd = res.end;
    
    // Override end function to capture response
    res.end = function(chunk: unknown, encoding?: BufferEncoding | (() => void), callback?: () => void): Response {
      const duration = Date.now() - start;
      const timestamp = new Date().toISOString();
      const method = req.method;
      const path = req.path;
      const status = res.statusCode;

      // Determine log level based on status
      const emoji = status >= 500 ? '❌' : status >= 400 ? '⚠️' : '✅';

      console.log(
        `[${timestamp}] ${emoji} ${method} ${path} - ${status} (${duration}ms)`
      );

      // Call original end with proper context - cast to any to handle overloaded signature
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalEnd as any).call(res, chunk, encoding, callback);
    } as Response['end'];

    next();
  };
}

// ============================================================================
// Error Handling Middleware
// ============================================================================

interface ApiError extends Error {
  statusCode?: number;
  code?: string;
  type?: string;
}

export function createErrorMiddleware() {
  return (
    err: ApiError,
    req: Request,
    res: Response,
    _next: NextFunction
  ): void => {
    const statusCode = err.statusCode || 500;
    const errorResponse = {
      error: {
        message: err.message || 'Internal server error',
        type: err.type || 'server_error',
        code: err.code || 'internal_error',
      },
    };

    // Log error
    if (statusCode >= 500) {
      console.error(`[ERROR] ${req.method} ${req.path}:`, err);
    } else {
      console.warn(`[WARN] ${req.method} ${req.path}:`, err.message);
    }

    res.status(statusCode).json(errorResponse);
  };
}

// ============================================================================
// Rate Limiting Middleware (Simple in-memory)
// ============================================================================

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

export function createRateLimitMiddleware(
  windowMs: number = 60000,
  maxRequests: number = 100
) {
  const store: RateLimitStore = {};

  // Clean up old entries every minute
  setInterval(() => {
    const now = Date.now();
    for (const key in store) {
      if (store[key].resetTime < now) {
        delete store[key];
      }
    }
  }, 60000);

  return (req: Request, res: Response, next: NextFunction): void => {
    // Get client IP
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    // Initialize or reset counter
    if (!store[clientIp] || store[clientIp].resetTime < now) {
      store[clientIp] = {
        count: 1,
        resetTime: now + windowMs,
      };
    } else {
      store[clientIp].count++;
    }

    // Check limit
    if (store[clientIp].count > maxRequests) {
      res.status(429).json({
        error: {
          message: 'Rate limit exceeded',
          type: 'rate_limit_error',
          code: 'rate_limit_exceeded',
        },
      });
      return;
    }

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - store[clientIp].count));
    res.setHeader('X-RateLimit-Reset', store[clientIp].resetTime);

    next();
  };
}

// ============================================================================
// Request ID Middleware
// ============================================================================

export function createRequestIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Generate request ID if not present
    const requestId = req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Set request ID on request object
    (req as any).requestId = requestId;
    
    // Set response header
    res.setHeader('X-Request-Id', requestId);
    
    next();
  };
}

// ============================================================================
// Security Headers Middleware
// ============================================================================

export function createSecurityHeadersMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    
    // XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // Strict transport security (in production)
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    
    next();
  };
}
