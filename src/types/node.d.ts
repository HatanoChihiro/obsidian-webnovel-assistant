/**
 * Node.js 模块类型声明
 * 
 * 本文件为 Electron/Node.js 环境中的模块提供类型定义
 * 这些模块通过 window.require() 在桌面端动态加载
 */

/**
 * 扩展 Window 接口以支持 Node.js require 和 moment
 */
declare global {
	/**
	 * Node.js 全局命名空间
	 */
	namespace NodeJS {
		interface ErrnoException extends Error {
			errno?: number;
			code?: string;
			path?: string;
			syscall?: string;
			stack?: string;
		}
	}

	interface Window {
		/**
		 * Node.js require 函数
		 * 仅在 Electron 桌面端可用
		 */
		require: {
			(module: 'fs'): NodeFS;
			(module: 'http'): NodeHTTP;
			(module: 'path'): NodePath;
			(module: string): unknown;
		};
		
		/**
		 * Moment.js 日期处理库
		 * Obsidian 内置提供
		 */
		moment: typeof import('moment');
	}
}

/**
 * Node.js fs (文件系统) 模块接口
 */
export interface NodeFS {
	/**
	 * 同步检查路径是否存在
	 * @param path - 文件或目录路径
	 * @returns 路径是否存在
	 */
	existsSync(path: string): boolean;
	
	/**
	 * 同步创建目录
	 * @param path - 目录路径
	 * @param options - 创建选项
	 */
	mkdirSync(path: string, options?: { recursive?: boolean }): void;
	
	/**
	 * 同步写入文件
	 * @param path - 文件路径
	 * @param data - 文件内容
	 * @param encoding - 字符编码
	 */
	writeFileSync(path: string, data: string, encoding: string): void;
	
	/**
	 * 同步读取文件
	 * @param path - 文件路径
	 * @param encoding - 字符编码
	 * @returns 文件内容
	 */
	readFileSync(path: string, encoding: string): string;
}

/**
 * HTTP 请求对象接口
 */
export interface NodeHTTPRequest {
	url: string;
	method?: string;
	headers?: Record<string, string | string[]>;
}

/**
 * HTTP 响应对象接口
 */
export interface NodeHTTPResponse {
	writeHead(statusCode: number, headers?: Record<string, string>): void;
	end(data?: string): void;
}

/**
 * HTTP 服务器接口
 */
export interface NodeHTTPServer {
	listen(port: number, hostname: string, callback?: () => void): void;
	close(): void;
	on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): void;
}

/**
 * Node.js http 模块接口
 */
export interface NodeHTTP {
	/**
	 * 创建 HTTP 服务器
	 * @param requestListener - 请求处理函数
	 * @returns HTTP 服务器实例
	 */
	createServer(requestListener: (req: NodeHTTPRequest, res: NodeHTTPResponse) => void): NodeHTTPServer;
}

/**
 * Node.js path 模块接口
 */
export interface NodePath {
	/**
	 * 拼接路径
	 * @param paths - 路径片段
	 * @returns 拼接后的路径
	 */
	join(...paths: string[]): string;
	
	/**
	 * 获取目录名
	 * @param path - 文件路径
	 * @returns 目录路径
	 */
	dirname(path: string): string;
	
	/**
	 * 获取文件名
	 * @param path - 文件路径
	 * @returns 文件名(包含扩展名)
	 */
	basename(path: string): string;
}

// 确保此文件被视为模块
export {};
