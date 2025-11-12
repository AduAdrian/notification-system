import compression from 'compression';
import { Request, Response } from 'express';
import { createLogger } from '@notification-system/utils';

const logger = createLogger('compression-middleware');

/**
 * Compression middleware configuration
 * Uses gzip/deflate compression to reduce response sizes
 */
export const compressionMiddleware = compression({
  // Compression level (0-9)
  // Higher values = better compression but more CPU intensive
  level: 6,

  // Only compress responses larger than 1KB
  threshold: 1024,

  // Filter function to determine if response should be compressed
  filter: (req: Request, res: Response): boolean => {
    // Don't compress if explicitly disabled
    if (req.headers['x-no-compression']) {
      return false;
    }

    // Don't compress streaming responses
    if (res.getHeader('Content-Type')?.toString().includes('stream')) {
      return false;
    }

    // Don't compress images that are already compressed
    const contentType = res.getHeader('Content-Type')?.toString() || '';
    const compressedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'video/',
      'audio/',
    ];

    if (compressedTypes.some((type) => contentType.includes(type))) {
      return false;
    }

    // Use default compression filter for everything else
    return compression.filter(req, res);
  },

  // Add compression headers
  chunkSize: 16384, // 16KB chunks
  memLevel: 8, // Memory level (1-9)
  strategy: 0, // Compression strategy (default)
});

/**
 * Middleware to log compression statistics
 */
export const compressionStatsMiddleware = (req: Request, res: Response, next: Function) => {
  const startTime = Date.now();
  const originalSend = res.send;

  res.send = function (data: any): Response {
    const uncompressedSize = Buffer.byteLength(JSON.stringify(data || ''));
    const compressed = res.getHeader('Content-Encoding') === 'gzip';

    if (compressed) {
      const duration = Date.now() - startTime;
      const compressedSize = parseInt(res.getHeader('Content-Length')?.toString() || '0');
      const ratio = compressedSize > 0 ? ((1 - compressedSize / uncompressedSize) * 100).toFixed(2) : 0;

      logger.debug('Response compressed', {
        path: req.path,
        method: req.method,
        uncompressedSize: `${(uncompressedSize / 1024).toFixed(2)}KB`,
        compressedSize: `${(compressedSize / 1024).toFixed(2)}KB`,
        ratio: `${ratio}%`,
        duration: `${duration}ms`,
      });
    }

    return originalSend.call(this, data);
  };

  next();
};

export default compressionMiddleware;
