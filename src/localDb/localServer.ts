import type { DbInstance } from '../../server/db/types';
import type {
  AppErrorMiddleware,
  AppMiddleware,
  AppRequest,
  AppResponse,
  HttpApp,
} from '../../server/httpTypes';
import { registerRoutes } from '../../server/routes';
import { getBrowserDb, persistBrowserDb } from './browserDb';

interface RouteEntry {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  pattern: string;
  regex: RegExp;
  paramNames: string[];
  handlers: AppMiddleware[];
}

export interface LocalDispatchResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

function compileRoutePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const escapedSegments = pattern.split('/').map((seg) => {
    if (seg.startsWith(':')) {
      paramNames.push(seg.slice(1));
      return '([^/]+)';
    }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return {
    regex: new RegExp(`^${escapedSegments.join('/')}$`),
    paramNames,
  };
}

export class LocalHttpApp implements HttpApp {
  private middlewares: AppMiddleware[] = [];
  private errorMiddlewares: AppErrorMiddleware[] = [];
  private routes: RouteEntry[] = [];

  use(fn: AppMiddleware | AppErrorMiddleware): void {
    if (fn.length === 4) {
      this.errorMiddlewares.push(fn as AppErrorMiddleware);
    } else {
      this.middlewares.push(fn as AppMiddleware);
    }
  }

  get(path: string, ...handlers: AppMiddleware[]): void {
    this.addRoute('GET', path, handlers);
  }

  post(path: string, ...handlers: AppMiddleware[]): void {
    this.addRoute('POST', path, handlers);
  }

  put(path: string, ...handlers: AppMiddleware[]): void {
    this.addRoute('PUT', path, handlers);
  }

  delete(path: string, ...handlers: AppMiddleware[]): void {
    this.addRoute('DELETE', path, handlers);
  }

  private addRoute(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    pattern: string,
    handlers: AppMiddleware[]
  ): void {
    const { regex, paramNames } = compileRoutePattern(pattern);
    this.routes.push({ method, pattern, regex, paramNames, handlers });
  }

  dispatch(
    method: string,
    rawUrl: string,
    rawHeaders: Record<string, string> = {},
    rawBody: unknown = undefined
  ): LocalDispatchResult {
    const upperMethod = method.toUpperCase();
    const [pathname, searchString = ''] = rawUrl.split('?');
    const searchParams = new URLSearchParams(searchString);
    const query: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      query[key] = value;
    });

    const headers: Record<string, string | string[] | undefined> = {};
    for (const [k, v] of Object.entries(rawHeaders)) {
      headers[k.toLowerCase()] = v;
    }
    if (!headers['user-agent'] && typeof navigator !== 'undefined') {
      headers['user-agent'] = navigator.userAgent;
    }

    let parsedBody: Record<string, any> = {};
    if (typeof rawBody === 'string' && rawBody.trim().length > 0) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = {};
      }
    } else if (rawBody && typeof rawBody === 'object') {
      parsedBody = rawBody as Record<string, any>;
    }

    let matchedRoute: RouteEntry | null = null;
    const params: Record<string, string> = {};
    for (const route of this.routes) {
      if (route.method !== upperMethod) continue;
      const match = route.regex.exec(pathname);
      if (match) {
        matchedRoute = route;
        route.paramNames.forEach((name, idx) => {
          params[name] = decodeURIComponent(match[idx + 1] ?? '');
        });
        break;
      }
    }

    let statusCode = 200;
    const responseHeaders: Record<string, string> = {
      'content-type': 'application/json',
    };
    let responseBody: unknown = undefined;
    let sent = false;

    const req: AppRequest = {
      method: upperMethod,
      originalUrl: rawUrl,
      path: pathname,
      params,
      query,
      body: parsedBody,
      headers,
      ip: 'browser-local',
    };

    const res: AppResponse = {
      status(code: number): AppResponse {
        statusCode = code;
        return res;
      },
      json(body: unknown): AppResponse {
        responseBody = body;
        sent = true;
        return res;
      },
      send(body: unknown): AppResponse {
        responseBody = body;
        sent = true;
        return res;
      },
      setHeader(name: string, value: string): void {
        responseHeaders[name.toLowerCase()] = value;
      },
    };

    if (!matchedRoute) {
      return {
        status: 404,
        headers: responseHeaders,
        body: { error: `Route not found: ${upperMethod} ${pathname}` },
      };
    }

    const chain = [...this.middlewares, ...matchedRoute.handlers];
    let index = 0;

    const runErrorMiddlewares = (err: unknown) => {
      for (const errHandler of this.errorMiddlewares) {
        if (sent) break;
        let forwarded: unknown = undefined;
        let calledNext = false;
        errHandler(err, req, res, (nextErr?: unknown) => {
          calledNext = true;
          forwarded = nextErr;
        });
        if (!calledNext) break;
        if (forwarded !== undefined) err = forwarded;
      }
      if (!sent) {
        statusCode = 500;
        responseBody = { error: 'An unexpected error occurred' };
      }
    };

    const step = (err?: unknown): void => {
      if (err !== undefined) {
        runErrorMiddlewares(err);
        return;
      }
      if (sent || index >= chain.length) {
        return;
      }
      const fn = chain[index++];
      let nextCalled = false;
      let nextErr: unknown = undefined;
      try {
        fn(req, res, (e?: unknown) => {
          nextCalled = true;
          nextErr = e;
        });
      } catch (thrown) {
        runErrorMiddlewares(thrown);
        return;
      }
      if (nextCalled && !sent) {
        step(nextErr);
      }
    };

    step();

    return {
      status: statusCode,
      headers: responseHeaders,
      body: responseBody,
    };
  }
}

let cachedRouterDb: DbInstance | null = null;
let cachedRouterApp: LocalHttpApp | null = null;

export function buildLocalRouter(db: DbInstance): LocalHttpApp {
  const app = new LocalHttpApp();
  registerRoutes(app, db);
  return app;
}

function getOrBuildRouter(db: DbInstance): LocalHttpApp {
  if (cachedRouterApp && cachedRouterDb === db) {
    return cachedRouterApp;
  }
  cachedRouterDb = db;
  cachedRouterApp = buildLocalRouter(db);
  return cachedRouterApp;
}

export function resetLocalRouterCache(): void {
  cachedRouterDb = null;
  cachedRouterApp = null;
}

export async function dispatchLocalRequest(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body: unknown = undefined
): Promise<LocalDispatchResult> {
  const db = await getBrowserDb();
  const app = getOrBuildRouter(db);
  const result = app.dispatch(method, url, headers, body);

  const upperMethod = method.toUpperCase();
  if (
    (upperMethod === 'POST' || upperMethod === 'PUT' || upperMethod === 'DELETE') &&
    result.status < 400
  ) {
    await persistBrowserDb();
  }

  return result;
}
