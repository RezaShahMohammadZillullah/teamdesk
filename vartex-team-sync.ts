/**
 * Drop-in ESM/TypeScript Express route for teamdesk.vartexengg.com (server.ts)
 * Live-syncs team profiles from https://www.vartexengg.com/team.html (with 5-minute cache).
 *
 * Usage in server.ts (right after app.get('/api/health', ...)):
 *   import { registerVartexTeamRoute } from './server-routes/vartex-team-sync.ts';
 *   registerVartexTeamRoute(app);
 */

import type { Express, Request, Response } from 'express';

const ALLOWED_HOSTS = new Set(['www.vartexengg.com', 'vartexengg.com']);
const DEFAULT_SOURCE_URL = 'https://www.vartexengg.com/team.html';
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface VartexTeamMember {
  avatar: string;
  name: string;
  role: string;
  bio: string;
}

interface CachedRoster {
  members: VartexTeamMember[];
  sourceUrl: string;
  syncedAt: string;
  expiresAt: number;
}

let cachedRoster: CachedRoster | null = null;

function decodeEntities(input: string): string {
  return String(input || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseVartexTeamHtml(html: string): VartexTeamMember[] {
  const members: VartexTeamMember[] = [];
  const marker = '<div class="team-card">';
  let cursor = 0;

  while (cursor < html.length) {
    const start = html.indexOf(marker, cursor);
    if (start === -1) break;

    const nextStart = html.indexOf(marker, start + marker.length);
    const sectionEnd = html.indexOf('</section>', start);
    let end = html.length;
    if (nextStart !== -1 && (sectionEnd === -1 || nextStart < sectionEnd)) {
      end = nextStart;
    } else if (sectionEnd !== -1) {
      end = sectionEnd;
    }

    const chunk = html.slice(start, end);
    const avatarMatch = chunk.match(/<div\s+class="avatar"[^>]*>([\s\S]*?)<\/div>/i);
    const nameMatch = chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const roleMatch = chunk.match(/<p\s+class="role"[^>]*>([\s\S]*?)<\/p>/i);
    const bioMatch = chunk.match(/<p\s+class="role"[^>]*>[\s\S]*?<\/p>\s*<p[^>]*>([\s\S]*?)<\/p>/i);

    const name = nameMatch ? decodeEntities(nameMatch[1]) : '';
    if (name) {
      members.push({
        avatar: avatarMatch ? decodeEntities(avatarMatch[1]) : 'VE',
        name,
        role: roleMatch ? decodeEntities(roleMatch[1]) : '',
        bio: bioMatch ? decodeEntities(bioMatch[1]) : '',
      });
    }
    cursor = start + marker.length;
  }

  return members;
}

export function registerVartexTeamRoute(app: Express): void {
  app.get('/api/vartex-team', async (req: Request, res: Response) => {
    let sourceUrl = DEFAULT_SOURCE_URL;
    if (typeof req.query.source === 'string' && req.query.source.trim()) {
      try {
        const parsed = new URL(req.query.source.trim());
        if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
          res.status(400).json({ ok: false, error: 'Unsupported source domain' });
          return;
        }
        sourceUrl = parsed.toString();
      } catch (_err) {
        res.status(400).json({ ok: false, error: 'Invalid source URL' });
        return;
      }
    }

    const now = Date.now();
    const force = req.query.refresh === '1';
    if (!force && cachedRoster && cachedRoster.sourceUrl === sourceUrl && cachedRoster.expiresAt > now) {
      res.json({
        ok: true,
        cached: true,
        sourceUrl: cachedRoster.sourceUrl,
        syncedAt: cachedRoster.syncedAt,
        count: cachedRoster.members.length,
        members: cachedRoster.members,
      });
      return;
    }

    try {
      const response = await fetch(sourceUrl, {
        headers: { 'User-Agent': 'VartexTeamDeskSync/1.0', Accept: 'text/html' },
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) throw new Error('Upstream HTTP ' + response.status);
      const html = await response.text();
      const members = parseVartexTeamHtml(html);
      if (!members.length) throw new Error('No .team-card entries parsed');

      cachedRoster = {
        members,
        sourceUrl,
        syncedAt: new Date().toISOString(),
        expiresAt: now + CACHE_TTL_MS,
      };
      res.json({
        ok: true,
        cached: false,
        sourceUrl,
        syncedAt: cachedRoster.syncedAt,
        count: members.length,
        members,
      });
    } catch (err) {
      if (cachedRoster && cachedRoster.members.length) {
        res.json({
          ok: true,
          cached: true,
          stale: true,
          sourceUrl: cachedRoster.sourceUrl,
          syncedAt: cachedRoster.syncedAt,
          count: cachedRoster.members.length,
          members: cachedRoster.members,
        });
        return;
      }
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Fetch failed',
      });
    }
  });
}
