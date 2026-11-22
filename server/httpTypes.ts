export interface AppRequest {
  method: string;
  originalUrl: string;
  path?: string;
  params: Record<string, string>;
  query: Record<string, any>;
  body: any;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}

export interface AppResponse {
  status(code: number): AppResponse;
  json(body: unknown): AppResponse | void;
  send(body: unknown): AppResponse | void;
  setHeader(name: string, value: string): void;
}

export type AppNextFunction = (err?: unknown) => void;

export type AppMiddleware = (
  req: any,
  res: any,
  next: AppNextFunction
) => void;

export type AppErrorMiddleware = (
  err: unknown,
  req: any,
  res: any,
  next: AppNextFunction
) => void;

export interface HttpApp {
  use(fn: AppMiddleware | AppErrorMiddleware): void;
  get(path: string, ...handlers: AppMiddleware[]): void;
  post(path: string, ...handlers: AppMiddleware[]): void;
  put(path: string, ...handlers: AppMiddleware[]): void;
  delete(path: string, ...handlers: AppMiddleware[]): void;
}
