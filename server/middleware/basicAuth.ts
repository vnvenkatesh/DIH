import { Request, Response, NextFunction } from 'express';
import { compare } from 'bcryptjs';
import pool from '../db.js';

export interface BasicAuthRequest extends Request {
    user?: { id: number; username: string; role: 'Admin' | 'AppUser' };
}

export async function requireBasicAuth(req: BasicAuthRequest, res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Document Intelligence Hub"');
        res.status(401).json({ error: 'Basic authentication required' });
        return;
    }

    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1) {
        res.status(401).json({ error: 'Invalid credentials format' });
        return;
    }

    const username = decoded.slice(0, colonIndex);
    const password = decoded.slice(colonIndex + 1);

    if (!username || !password) {
        res.status(401).json({ error: 'Username and password are required' });
        return;
    }

    try {
        const { rows } = await pool.query(
            'SELECT id, username, password_hash, role FROM users WHERE LOWER(username) = LOWER($1)',
            [username]
        );

        if (rows.length === 0 || !(await compare(password, rows[0].password_hash))) {
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }

        req.user = { id: rows[0].id, username: rows[0].username, role: rows[0].role };
        next();
    } catch (err: unknown) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
}
