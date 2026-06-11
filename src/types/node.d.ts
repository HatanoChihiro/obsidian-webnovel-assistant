/**
 * Node.js 模块类型声明
 * 避免在 Obsidian 插件中引入完整的 @types/node 导致类型冲突
 */

declare module 'fs' {
    export function existsSync(path: string): boolean;
    export function writeFileSync(path: string, data: string | Uint8Array, options?: { encoding?: string; mode?: number; flag?: string } | string | null): void;
    export function mkdirSync(path: string, options?: { recursive?: boolean; mode?: number | string }): string | undefined;
    export function unlinkSync(path: string): void;
    export function readFile(path: string, encoding: string, callback: (err: Error | null, data: string) => void): void;
    export function rmdirSync(path: string, options?: { recursive?: boolean }): void;
    export function readFileSync(path: string, options?: { encoding?: string; flag?: string } | string | null): string | Uint8Array;
}

declare module 'path' {
    export function join(...paths: string[]): string;
    export function dirname(path: string): string;
    export function extname(path: string): string;
    export function basename(path: string, ext?: string): string;
}

declare module 'http' {
    export interface Server {
        listen(port: number, hostname?: string, callback?: () => void): this;
        close(callback?: (err?: Error) => void): this;
        on(event: string, listener: (...args: unknown[]) => void): this;
        removeAllListeners(event?: string): this;
    }

    export interface IncomingMessage {
        url?: string;
        method?: string;
    }

    export interface ServerResponse {
        writeHead(statusCode: number, headers?: Record<string, string | string[]>): this;
        end(data?: string | Uint8Array, encoding?: string, callback?: () => void): this;
    }

    export function createServer(requestListener?: (req: IncomingMessage, res: ServerResponse) => void): Server;
}
