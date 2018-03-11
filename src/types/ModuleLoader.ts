import { EventEmitter } from "events";
import logger = require("loggy");
import { INullableHashMap } from "./Types";
import { ISchemaObject } from "./Typer";
import { isAbsolute } from "path";

// #region Interfaces and enums

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

export const SCHEMA_MODULEINFO: ISchemaObject = {
	type: "object",
	elementSchema: {
		type: "object",
		schema: {
			"name": { type: "string" },
			"path": { type: "string" },
			"options": { type: "any", optional: true }
		}
	}
};

export interface IModuleLoaderConfig {
	/**
	 * Base path of modules to load
	 * Uses require.resolve to get correct path and check for errors
	 * @example `"./cogs/"`
	 */
	basePath: string;
	/**
	 * Names of modules that should be loaded by default
	 * @example `["Whitelist", "Ping"]`
	 */
	defaultSet: string[];
	/**
	 * Pre-filled registry with info about modules
	 */
	registry: INullableHashMap<IModuleInfo>;
	/**
	 * Name of module loaded
	 * Will be used in log
	 * @example MyCoolModuleLoader
	 */
	name: string;
}

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

// #endregion

// #region Module Keeper

export class ModuleBase<T> extends EventEmitter {
	/**
	 * Base information about module
	 */
	public readonly info: IModuleInfo;

	/**
	 * Loaded module
	 * Will be empty if module isn't loaded yet
	 */
	public base?: IModule & T;

	/**
	 * Module's signature used to identify this module by other modules
	 */
	public signature: string | null = null;

	/**
	 * Module loading state
	 */
	public state: ModuleLoadState = ModuleLoadState.Ready;

	constructor(info: IModuleInfo) {
		super();
		this.info = info;
	}

	/**
	 * Function to load module
	 * @returns Promise which'll be resolved with this module's base once module is loaded
	 */
	public async load() {
		if (this.state !== ModuleLoadState.Ready && this.state !== ModuleLoadState.Unloaded && this.state !== ModuleLoadState.Destroyed) {
			throw new Error("Module is already loaded or pending loading");
		}

		this.state = ModuleLoadState.Initializing;

		try {
			const mod = require(this.info.path);
			if (!isClass(mod)) {
				throw new Error("The module has returned value of invalid type and will not be stated as loaded");
			}

			const base = new mod(this.info.options);

			if (base) {
				if (typeof base.unload !== "function") {
					throw new Error("The module has no `unload` function and will not be stated as loaded");
				}

				this.base = base;
				this.signature = base.signature;
				this.state = ModuleLoadState.Loaded;

				if (!base.init) {
					this.state = ModuleLoadState.Initialized;
					this.emit("initialized", base);
				}
			} else {
				throw new Error("The module has not returned any value and will not be stated as loaded");
			}

			this.emit("loaded", this.signature, this.base);
		} catch (err) {
			this.emit("error", {
				state: "load#initialize",
				error: err
			});
			throw err;
		}

		return this;
	}

	/**
	 * Initializes the module
	 */
	public async init() {
		if (this.state !== ModuleLoadState.Loaded) { throw new Error("Module is not loaded to initializate it"); }
		this.emit("initialization");
		if (this.base && this.base.init) { await this.base.init(); }
		this.state = ModuleLoadState.Initialized;
		this.emit("initialized", this.base, this.signature);
		return this;
	}

	/**
	 * Function to unload or complete destroy module if it has no unload method.
	 * @param reason Reason of unloading which'll be transmitted to module. By default "unload"
	 * @returns Promise which'll be resolved with this module's base once module is unloaded or destroyed
	 */
	public async unload(reason: any = "unload") {
		if (this.state !== ModuleLoadState.Initialized) { throw new Error("Module is not loaded"); }

		const signature = this.signature;

		this.emit("unloading", signature);
		this.signature = null;

		if (!this.base) {
			this.emit("error", {
				state: "unload",
				error: new Error("Module was already unloaded, base variable is `undefined`")
			});
			this.state = ModuleLoadState.Unloaded;
		} else if (typeof this.base.unload !== "function") {
			// ! Deprecated, there will be check on modules loading

			try {
				for (const key in this.base) {
					// this.base[key] = undefined;
					delete this.base[key];
				}

				this.base = undefined;
				this.state = ModuleLoadState.Destroyed;
				this.emit("destroyed", signature);
			} catch (err) {
				this.emit("error", {
					state: "unload#destoy",
					error: err
				});
			}

			this.state = ModuleLoadState.Destroyed;
		} else {
			try {
				const unloaded = await this.base.unload(reason);
				if (unloaded) {
					this.base = undefined;
					this.state = ModuleLoadState.Unloaded;
				} else {
					throw new Error("Returned `false`: that means module has troubles with unloading");
				}
			} catch (err) {
				this.emit("error", {
					state: "unload#unload",
					error: err
				});
			}
		}

		this.emit("unloaded", signature);

		return this;
	}

	/**
	 * Shortcut for checking if module already initialized or you need to wait for it.
	 * If module already initialized, then immediately calls the callback.
	 * Otherwise subscribes you to the `initialized` event
	 */
	public onInit(callback: (base: T) => void) {
		if (this.state === ModuleLoadState.Initialized && this.base) {
			callback(this.base);
			return this;
		}
		return this.on("initialized", callback);
	}

	/**
	 * Clears require cache for this module.
	 * Useful while reloading module:
	 *   In this case module file will be read from disk
	 * @returns This module's base
	 */
	public clearRequireCache() {
		if (require.cache[this.info.path]) { delete require.cache[this.info.path]; }
		return this;
	}
}

// #endregion

// #region Module loader

/**
 * Snowball's core module loader.
 * Loads all modules
 */
export class ModuleLoader {
	/**
	 * Basic configuration used at loader initialization
	 */
	public readonly config: IModuleLoaderConfig;
	/**
	 * Registry with modules
	 */
	public registry: INullableHashMap<IModuleInfo> = Object.create(null);
	/**
	 * Registry with currently loaded modules
	 */
	public loadedModulesRegistry: INullableHashMap<ModuleBase<any>> = Object.create(null);

	/**
	 * Registry with currently loaded modules by signature
	 */
	public signaturesRegistry: INullableHashMap<ModuleBase<any>> = Object.create(null);

	private readonly _pendingInitialization: INullableHashMap<boolean> = Object.create(null);
	private readonly _pendingUnload: INullableHashMap<boolean> = Object.create(null);

	private readonly log: logger.ILogFunction;

	constructor(config: IModuleLoaderConfig) {
		this.config = config;
		this.log = logger(config.name);

		this.log("info", "Registering modules");
		for (const registryName in config.registry) {
			const moduleInfo = config.registry[registryName]!;
			this.register(moduleInfo);
		}

		this.config.basePath = isAbsolute(this.config.basePath) ? this.config.basePath : `${__dirname}/../${this.config.basePath}`;
	}

	/**
	 * Add new module to registry
	 * @param info Information about module
	 */
	public register(info: IModuleInfo) {
		this.log("info", "Registered new module", process.env.NODE_ENV === "development" ? info : `"${info.name}" - "${info.path}"`);
		this.registry[info.name] = info;
		return this;
	}

	/**
	 * Load module by this name in registry
	 * @param name Name(s) in registry
	 * @param clearRequireCache Require cache cleaning. `true` if `require` cache needed to be cleared before load
	 * @returns Promise which'll be resolved once module is loaded
	 */
	public async load(name: string | string[], clearRequireCache = false) {
		if (Array.isArray(name)) {
			for (const n of name) { await this.load(n, clearRequireCache); }
			return this;
		}

		if (!this.registry[name]) {
			const reason = "Module not found in registry. Use `ModuleLoader#register` to put your module into registry";
			this.log("err", `#load: attempt to load module "${name}" failed: ${reason}`);
			throw new Error(reason);
		}

		if (this.loadedModulesRegistry[name]) {
			const reason = "Module already loaded";
			this.log("err", `#load: attempt to load module "${name}" failed: ${reason}`);
			throw new Error(reason);
		}

		const moduleInfo = this.registry[name];
		if (!moduleInfo) {
			this.log("err", "#load: module found in registry, but returned undefined value");
			throw new Error("No module info");
		}

		moduleInfo.path = isAbsolute(moduleInfo.path) ? moduleInfo.path : `${this.config.basePath}/${moduleInfo.path}`;

		try {
			moduleInfo.path = require.resolve(moduleInfo.path);
			this.log("info", `#load: path converted: "${moduleInfo.path}" (module can be loaded)`);
		} catch (err) {
			this.log("err", "#load: path conversation failed (module can't be loaded)");
			throw err;
		}

		const moduleKeeper = new ModuleBase<any>(moduleInfo);
		const keeperLogPrefix = `ModuleKeeper(${moduleInfo.name}) =>`;

		// handling events
		moduleKeeper.on("error", (errInfo: any) => {
			this.log("err", `${keeperLogPrefix} ERROR:`, errInfo);
		}).on("initialization", () => {
			this.log("info", `${keeperLogPrefix} INITIALIZATION`);
			const signature = moduleKeeper.signature;
			if (signature) { this._pendingInitialization[signature] = true; }
		}).on("initialized", () => {
			this.log("ok", `${keeperLogPrefix} INITIALIZED`);
			const signature = moduleKeeper.signature;
			if (signature) { this._pendingInitialization[signature] = false; }
		}).on("loaded", (signature: string | null) => {
			this.log("ok", `${keeperLogPrefix} LOADED: ${signature}`);
			if (signature) { this._pendingUnload[signature] = false; }
		}).on("unloading", (signature: string | null) => {
			this.log("info", `${keeperLogPrefix} UNLOADING: had signature ${signature}`);
			if (signature) { this._pendingUnload[signature] = true; }
		}).on("unloaded", (signature: string | null) => {
			this.log("ok", `${keeperLogPrefix} UNLOADED: had signature ${signature}`);
			if (signature) { this._pendingUnload[signature] = false; }
		}).on("destroyed", () => {
			this.log("err", `${keeperLogPrefix} DESTROYED`);
			this.log("err", `${keeperLogPrefix} WARNING: Destroying is deprecated and may cause problems in future. Please change your code and add unload function.`);
		});

		try {
			if (clearRequireCache) {
				moduleKeeper.clearRequireCache();
			}

			await moduleKeeper.load();

			let violation: string | null = null;
			if (!moduleKeeper.signature) {
				violation = "empty signature";
			} else if (this.signaturesRegistry[moduleKeeper.signature]) {
				violation = `signature "${moduleKeeper.signature}" already registered`;
			}

			if (violation) {
				// any signature violation is unacceptable
				this.log("err", `#load: signature violation found: "${moduleKeeper.info.name}" - violation "${violation}" caused unload`);
				await moduleKeeper.unload("signature_violation");
				return this;
			}

			if (moduleKeeper.signature) {
				// typescript workaround
				this.signaturesRegistry[moduleKeeper.signature] = moduleKeeper;
			}
		} catch (err) {
			this.log("err", `#load: module "${moduleKeeper.info.name}" rejected loading`);
			throw err;
		}

		this.log("ok", `#load: module "${moduleKeeper.info.name}" resolved (loading complete)`);
		this.loadedModulesRegistry[moduleKeeper.info.name] = moduleKeeper;

		return this;
	}

	/**
	 * Unload module by this name in currently loaded modules registry
	 * @param name Name(s) of loaded module(s)
	 * @param reason Reason to unload module
	 * @param clearRequireCache `true` if `require` cache of this module file needed to cleared after unload. This works only if `skipCallingUnload` is `false`!
	 * @returns Promise which'll be resolved once module is unloaded and removed from modules with loaded registry
	 */
	public async unload(name: string | string[], reason: string = "manual", clearRequireCache = false) {
		if (Array.isArray(name)) {
			for (const n of name) { await this.unload(n, reason); }
			return this;
		}

		if (!this.loadedModulesRegistry[name]) {
			const reason = "Module not found or not loaded yet";
			this.log("err", `#unload: check failed: ${reason}`);
			throw new Error(reason);
		}

		const moduleKeeper = this.loadedModulesRegistry[name];

		if (moduleKeeper == null) {
			this.log("warn", `#unload: check failed: registry member is already \`${moduleKeeper}\``);
			delete this.loadedModulesRegistry[name];
			return this;
		}

		if (moduleKeeper.signature) {
			delete this.signaturesRegistry[moduleKeeper.signature];
		}

		try {
			await moduleKeeper.unload(reason);
			if (clearRequireCache) {
				moduleKeeper.clearRequireCache();
			}
		} catch (err) {
			this.log("err", `#unload: module "${name}" rejected to unload:`, err);
			throw err;
		}

		this.log("ok", `#unload: module "${name}" successfully unloaded`);

		delete this.loadedModulesRegistry[name];

		return this;
	}

	/**
	 * Loads modules from registry with `require` cache clearing
	 * By default loads only set passed as `defaultSet`
	 * @param forceAll Use `true` to force load ALL modules in registry
	 */
	public async loadModules(forceAll = false) {
		let toLoad: string[] = [];
		if (forceAll) {
			toLoad = Object.keys(this.config.registry);
		} else {
			toLoad = this.config.defaultSet;
		}

		this.log("info", "Loading started...");

		const toInit: Array<ModuleBase<any>> = [];

		for (const modName of toLoad) {
			await this.load(modName, true);

			const keeper = this.loadedModulesRegistry[modName];

			// because we have nullable hash map
			if (!keeper) { continue; }

			// modules that have no init functions are considered as initializated after load
			if (keeper.state === ModuleLoadState.Loaded) {
				toInit.push(keeper);
			}
		}

		this.log("info", "Entering initialization state...");

		for (const keeper of toInit) {
			try {
				await keeper.init();
			} catch (err) {
				this.log("warn", `Failed to initialize module "${keeper.info.name}":`, err);
			}
		}

		return this;
	}

	/**
	 * Returns module's base by selected signature with prefered type
	 * @param searchArg The searchable argument
	 * @param argType Type of the argument (`signature` by default)
	 * @returns `undefined` if module not found or base not loaded, otherwise `T`
	 */
	public findBase<T>(searchArg: string, argType: "signature" | "name" = "signature") {
		const keeper = this.findKeeper<T>(searchArg, argType);
		if (!keeper) { return undefined; }
		return keeper.base;
	}

	/**
	 * Returns module's keeper by selected signature or name.
	 * @param searchArg The searchable argument
	 * @param argType Type of the argument (`signature by default`)
	 */
	public findKeeper<T>(searchArg: string, argType: "signature" | "name" = "signature") {
		switch (argType) {
			case "name": { return <ModuleBase<T> | undefined> this.loadedModulesRegistry[searchArg]; }
			case "signature": { return <ModuleBase<T> | undefined> this.signaturesRegistry[searchArg]; }
			default: { throw new Error(`Invalid search argument type - ${argType}`); }
		}
	}

	/**
	 * Checks if module is pending unload
	 * @param signature Signature of a module to check
	 */
	public isPendingUnload(signature: string): boolean {
		return !!this._pendingUnload[signature];
	}

	/**
	 * 
	 * @param signature Signature of a module to unload
	 */
	public isPendingInitialization(signature: string): boolean {
		return !!this._pendingInitialization[signature];
	}
}

// #endregion

// #region Functions

/**
* Convert modules object to Map object
* @param obj Array of module info entries
*/
export function convertToModulesMap(obj: IModuleInfo[]) {
	const modulesMap: INullableHashMap<IModuleInfo> = Object.create(null);
	for (const moduleInfo of obj) { modulesMap[moduleInfo.name] = moduleInfo; }
	return modulesMap;
}

const CLASS_REGEXP = /^\s*class\s+/;

/**
 * Checks if passed object is ES6 class
 * @param obj Object to check
 */
function isClass(obj: any): obj is Function {
	return typeof obj === "function" && typeof obj.toString === "function" && CLASS_REGEXP.test(obj.toString());
}

// #endregion
