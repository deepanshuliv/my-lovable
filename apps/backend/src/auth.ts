import { verifyToken } from '@clerk/backend';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '@repo/db';
import { CLERK_AUTHORIZED_PARTIES, CLERK_SECRET_KEY } from './config';
import { param } from './utils/http';

declare global {
  
  namespace Express {
    interface Request {
            userId?: string;
    }
  }
}

export function isAuthConfigured(): boolean {
  return Boolean(CLERK_SECRET_KEY);
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const trimmed = header.trim();
  
  if (trimmed.toLowerCase().startsWith('bearer ')) {
    return trimmed.slice(7).trim() || null;
  }
  
  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!CLERK_SECRET_KEY) {
    console.log('[AUTH_UNCONFIGURED] , CLERK_SECRET_KEY is not set');
    return res.status(503).json({ msg: 'authentication is not configured on this server' });
  }

  const token = bearer(req);
  if (!token) return res.status(401).json({ msg: 'please sign in' });

  try {
    const payload = await verifyToken(token, {
      secretKey: CLERK_SECRET_KEY,
      
      ...(CLERK_AUTHORIZED_PARTIES.length ? { authorizedParties: CLERK_AUTHORIZED_PARTIES } : {}),
    });

    if (!payload.sub) return res.status(401).json({ msg: 'please sign in' });

    req.userId = payload.sub;
    return next();
  } catch (error) {

    console.log('[AUTH_REJECTED] , ', String((error as Error).message).slice(0, 200));
    return res.status(401).json({ msg: 'please sign in' });
  }
}

async function requireProjectOwner(req: Request, res: Response, next: NextFunction) {
  const projectId = param(req, 'projectId');
  if (!projectId) return res.status(400).json({ msg: 'please provide valid projectId' });
  if (!req.userId) return res.status(401).json({ msg: 'please sign in' });

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });

    if (!project || project.ownerId !== req.userId) {
      return res.status(404).json({ msg: 'unknown project' });
    }

    return next();
  } catch (error) {

    console.log('[OWNERSHIP_LOOKUP_FAILED] , ', String(error).slice(0, 200));
    return res.status(503).json({ msg: 'unavailable' });
  }
}

export const requireProjectAccess = [requireAuth, requireProjectOwner];
