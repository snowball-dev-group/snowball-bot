export interface IModule {
	/**
	 * Signature of module for other modules
	 */
	readonly signature: string;
	init?(): Promise<void>;
	/**
	 * Unload function
	 */
	unload(reason?: string): Promise<boolean>;
}

export interface IModuleInfo {
	/**
	 * Name of module
	 */
	name: string;
	/**
	 * Path to module
	 */
	path: string;
	/**
	 * Options for plugin
	 */
	options: any;
}

export enum ModuleLoadState {
	/**
	 * Module is ready to load and will be loaded as soon as `load` function will be called
	 */
	Ready,
	/**
	 * Module loads, calling `load` will throw an error
	 */
	Initializing,
	/**
	 * Module is loaded, but not yet completely initialized
	 */
	Loaded,
	/**
	 * Module is loaded and initialized and ready to work
	 */
	Initialized,
	/**
	 * Module was unloaded using `unload` function call
	 */
	Unloaded,
	/**
	 * Module was unloaded but with `destroying` method
	 */
	Destroyed
}
