/**
 * 核心服务注册中心 (Service Registry)
 * 用于解耦 `main.ts` 中的各类管理器依赖
 */
export class ServiceRegistry {
	private services = new Map<string, unknown>();

	/**
	 * 注册一个服务实例
	 * @param key 服务的唯一标识符（通常是类名）
	 * @param service 服务实例
	 */
	register<T>(key: string, service: T): void {
		this.services.set(key, service);
	}

	/**
	 * 获取一个服务实例
	 * @param key 服务的唯一标识符
	 * @returns 服务实例
	 * @throws 如果服务未找到，抛出异常
	 */
	get<T>(key: string): T {
		const service = this.services.get(key);
		if (!service) {
			throw new Error(`Service '${key}' not found in registry`);
		}
		return service as T;
	}

	/**
	 * 获取一个可选的服务实例
	 * @param key 服务的唯一标识符
	 * @returns 服务实例，如果未找到则返回 undefined
	 */
	getOptional<T>(key: string): T | undefined {
		return this.services.get(key) as T | undefined;
	}

	/**
	 * 检查是否已注册指定服务
	 * @param key 服务的唯一标识符
	 */
	has(key: string): boolean {
		return this.services.has(key);
	}

	/**
	 * 清空所有注册的服务
	 */
	clear(): void {
		this.services.clear();
	}
}
