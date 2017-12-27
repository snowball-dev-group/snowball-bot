import { EventEmitter } from "events";
import logger = require("loggy");
import { IHashMap } from "./Interfaces";
import { ISchemaObject } from "./Typer";
import { isAbsolute } from "path";

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
	registry: IHashMap<IModuleInfo>;
	/**
	 * Name of module loaded
	 * Will be used in log
	 * @example MyCoolModuleLoader
	 */
	name: string;
	/**
	 * Will be all modules loaded as queue or they should be loaded in parallel
	 */
	queueModuleLoading?: boolean;
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

export class ModuleBase<T> extends EventEmitter {
	/**
	 * Base information about module
	 */
	readonly info: IModuleInfo;
	/**
	 * Loaded module
	 * Will be empty if module isn't loaded yet
	 */
	base?: IModule & T;
	/**
	 * Module's signature used to identify this module by other modules
	 */
	signature: string | null = null;
	/**
	 * Module loading state
	 */
	state: ModuleLoadState = ModuleLoadState.Ready;

	constructor(info: IModuleInfo) {
		super();
		this.info = info;
	}

	/**
	 * Function to load module
	 * @returns {Promise<ModuleBase>} Promise which'll be resolved with this module's base once module is loaded
	 */
	async load() {
		if(this.state !== ModuleLoadState.Ready && this.state !== ModuleLoadState.Unloaded && this.state !== ModuleLoadState.Destroyed) {
			throw new Error("Module is already loaded or loads. Unload it first!");
		}
		this.state = ModuleLoadState.Initializing;
		try {
			const mod = require(this.info.path);
			this.base = new mod(this.info.options);

			if(this.base) {
				const base = this.base;

				this.state = ModuleLoadState.Loaded;

				if(!base.init) {
					this.state = ModuleLoadState.Initialized;
					this.emit("initialized", base);
				}

				this.signature = base.signature;
			} else {
				throw new Error("Doesn't has any returning value");
			}
			
			this.emit("loaded", this.signature, this.base);
		} catch(err) {
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
	async init() {
		if(this.state !== ModuleLoadState.Loaded) { return; }
		if(this.base && this.base.init) { await this.base.init(); }
		this.state = ModuleLoadState.Initialized;
		this.emit("initialized", this.base);
	}

	/**
	 * Function to unload or complete destroy module if it has no unload method
	 * Very important to keep unload function in your module, else unloading can cause exceptions at running
	 * @param reason Reason of unloading which'll be transmitted to module. By default "unload"
	 * @returns {Promise<ModuleBase>} Promise which'll be resolved with this module's base once module is unloaded or destroyed
	 */
	async unload(reason: any = "unload") {
		if(this.state !== ModuleLoadState.Initialized) { throw new Error("Module is not loaded"); }

		this.signature = null;

		if(!this.base) {
			this.emit("error", {
				state: "unload",
				error: new Error("Module was already unloaded, base variable is `undefined`")
			});
			this.state = ModuleLoadState.Unloaded;
		} else if(typeof this.base.unload !== "function") {
			try {
				for(const key of Object.keys(this.base)) {
					this.base[key] = undefined;
					delete this.base[key];
				}
				this.base = undefined;
				this.state = ModuleLoadState.Destroyed;
				this.emit("destroyed");
				this.emit("unloaded");
			} catch(err) {
				this.emit("error", {
					state: "unload#destoy",
					error: err
				});
			}
			this.state = ModuleLoadState.Destroyed;
		} else {
			try {
				const unloaded = await this.base.unload(reason);
				if(unloaded) {
					this.emit("unloaded");
					this.base = undefined;
					this.state = ModuleLoadState.Unloaded;
				} else {
					throw new Error("Returned `false` what means module has troubles with unload");
				}
			} catch(err) {
				this.emit("error", {
					state: "unload#unload",
					error: err
				});
			}
		}
		return this;
	}

	/**
	 * Clears require cache for this module
	 * Useful while reloading module:
	 *   In this case module file will be read from disk
	 * @returns {ModuleBase} This module's base
	 */
	clearRequireCache() {
		if(require.cache[this.info.path]) {
			delete require.cache[this.info.path];
		}
		return this;
	}
}

/**
 * Snowball's core module loader
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
	public registry: IHashMap<IModuleInfo> = {};
	/**
	 * Registry with currently loaded modules
	 */
	public loadedModulesRegistry: IHashMap<ModuleBase<any>> = {};

	/**
	 * Registry with currently loaded modules by signature
	 */
	public signaturesRegistry: IHashMap<ModuleBase<any>> = {};

	private log: Function;

	constructor(config: IModuleLoaderConfig) {
		this.config = config;
		this.log = logger(config.name);

		this.log("info", "Registering modules");
		for(const registryName in config.registry) {
			const moduleInfo = config.registry[registryName];
			this.register(moduleInfo);
		}

		this.config.basePath = isAbsolute(this.config.basePath) ? this.config.basePath : `${__dirname}/../${this.config.basePath}`;
	}

	/**
	 * Add new module to registry
	 * @param {IModuleInfo} info Information about module
	 */
	register(info: IModuleInfo) {
		this.registry[info.name] = info;
		this.log("info", "Registered new module", process.env["NODE_ENV"] === "development" ? info : `"${info.name}" - "${info.path}"`);
	}

	/**
	 * Load module by this name in registry
	 * @param {string|string[]} name Name(s) in registry
	 * @param {boolean} clearRequireCache Require cache cleaning. `true` if `require` cache needed to be cleared before load
	 * @returns {Promise} Promise which'll be resolved once module is loaded
	 */
	async load(name: string | string[], clearRequireCache = false) {
		if(Array.isArray(name)) {
			for(const n of name) { await this.load(n, clearRequireCache); }
			return;
		}
		if(!this.registry[name]) {
			const reason = "Module not found in registry. Use `ModuleLoader#register` to put your module into registry";
			this.log("err", "#load: attempt to load module", name, "failed:", reason);
			throw new Error(reason);
		}
		if(this.loadedModulesRegistry[name]) {
			const reason = "Module already loaded";
			this.log("err", "#load: attempt to load module", name, "failed:", reason);
			throw new Error(reason);
		}

		const moduleInfo = this.registry[name];
		if(!moduleInfo) {
			this.log("err", "#load: module found in registry, but returned undefined value");
			throw new Error("No module info");
		}

		moduleInfo.path = isAbsolute(moduleInfo.path) ? moduleInfo.path : `${this.config.basePath}/${moduleInfo.path}`;

		try {
			moduleInfo.path = require.resolve(moduleInfo.path);
			this.log("info", "#load: path converted:", moduleInfo.path, "(module can be loaded)");
		} catch(err) {
			this.log("err", "#load: path conversation failed (module can't be loaded)");
			throw err;
		}

		const moduleKeeper = new ModuleBase<any>(moduleInfo);
		const keeperLogPrefix = `ModuleKeeper(${moduleInfo.name}) =>`;

		// handling events
		moduleKeeper.on("error", (errInfo: any) => {
			this.log("err", keeperLogPrefix, "ERROR:", errInfo);
		}).on("loaded", (signature: string) => {
			this.log("ok", keeperLogPrefix, "LOADED:", { signature });
		}).on("unloaded", () => {
			this.log("info", keeperLogPrefix, "UNLOADED");
		}).on("destroyed", () => {
			this.log("info", keeperLogPrefix, "DESTROYED");
			this.log("warn", keeperLogPrefix, "WARNING: Destroying should be avoided, it's totally unsafe and can lead to memory leaks. Please contact module maintainer and ask to fix this problem.");
		}).on("initialized", () => {
			this.log("info", keeperLogPrefix, "INITIALIZED");
		});

		try {
			if(clearRequireCache) {
				moduleKeeper.clearRequireCache();
			}

			await moduleKeeper.load();

			let violation:string|null = null;
			if(!moduleKeeper.signature) {
				violation = "empty signature";
			} else if(this.signaturesRegistry[moduleKeeper.signature]) {
				violation = "signature already registered";
			}

			if(violation) {
				// any signature violation is unacceptable
				this.log("err", "#load: signature violation found:", moduleKeeper.info.name, "-", violation, ", caused unload");
				await moduleKeeper.unload("signature_violation");
				return;
			}

			if(moduleKeeper.signature) {
				// typescript workaround
				this.signaturesRegistry[moduleKeeper.signature] = moduleKeeper;
			}
		} catch(err) {
			this.log("err", "#load: module", moduleKeeper.info.name, " rejected loading");
			throw err;
		}

		this.log("ok", "#load: module", moduleKeeper.info.name, "resolved (loading complete)");
		this.loadedModulesRegistry[moduleKeeper.info.name] = moduleKeeper;
	}

	/**
	 * Unload module by this name in currently loaded modules registry
	 * @param {string|string[]} name Name(s) of loaded module(s)
	 * @param {string} reason Reason to unload module
	 * @param {boolean} skipCallingUnload `true` if module should be unloaded without calling for unload method. Don't use it unless you know that module doesn't handles any events or doesn't has dynamic variables
	 * @param {boolean} clearRequireCache `true` if `require` cache of this module file needed to cleared after unload. This works only if `skipCallingUnload` is `false`!
	 * @returns {Promise} Promise which'll be resolved once module is unloaded and removed from modules with loaded registry
	 */
	async unload(name: string | string[], reason: string = "manual", skipCallingUnload: boolean = false, clearRequireCache = false) {
		if(Array.isArray(name)) {
			for(const n of name) { await this.unload(n, reason); }
			return;
		}

		if(!this.loadedModulesRegistry[name]) {
			const reason = "Module not found or not loaded yet";
			this.log("err", "#unload: check failed: ", reason);
			throw new Error(reason);
		}
		const moduleKeeper = this.loadedModulesRegistry[name];

		if(!moduleKeeper) {
			this.log("warn", "#unload: check failed: registry member is already `undefined`");
			delete this.loadedModulesRegistry[name];
			return;
		}

		if(moduleKeeper.signature) {
			delete this.signaturesRegistry[moduleKeeper.signature];
		}

		if(skipCallingUnload) {
			this.log("warn", "#unload: skiping calling `unload` method");
			delete this.loadedModulesRegistry[name];
		} else {
			try {
				await moduleKeeper.unload(reason);
				if(clearRequireCache) {
					moduleKeeper.clearRequireCache();
				}
			} catch(err) {
				this.log("err", "#unload: module", name, "rejected to unload:", err);
				throw err;
			}
			this.log("ok", "#unload: module", name, "successfully unloaded");
			delete this.loadedModulesRegistry[name];
		}
	}

	/**
	 * Loads modules from registry with `require` cache clearing
	 * By default loads only set passed as `defaultSet`
	 * @param {boolean} forceAll Use `true` to force load ALL modules in registry
	 */
	async loadModules(forceAll = false) {
		let toLoad: string[] = [];
		if(forceAll) {
			toLoad = Object.keys(this.config.registry);
		} else {
			toLoad = this.config.defaultSet;
		}

		this.log("info", "Loading started");

		const toInit:Array<ModuleBase<any>> = [];

		for(const modName of toLoad) {
			await this.load(modName, true);
			const keeper = this.loadedModulesRegistry[modName];
			if(!keeper) { continue; }
			if(keeper.state === ModuleLoadState.Loaded) {
				toInit.push(keeper);
			}
		}

		this.log("info", "Entering initialization state...");

		for(const keeper of toInit) {
			try {
				await keeper.init();
			} catch (err) {
				this.log("warn", "Failed to initialize module", keeper.info.name, err);
			}
		}
	}

	/**
	 * Unloads ALL modules
	 * @deprecated Use `unload` function instead
	 */
	async unloadAll() {
		return await this.unload(Object.keys(this.loadedModulesRegistry));
	}
}

/**
* Convert modules object to Map object
* @param obj {Array} Array of module info entries
*/
export function convertToModulesMap(obj: IModuleInfo[]) {
	const modulesMap: IHashMap<IModuleInfo> = {};
	for(const moduleInfo of obj) {
		modulesMap[moduleInfo.name] = moduleInfo;
	}
	return modulesMap;
}
