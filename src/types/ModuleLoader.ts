import { EventEmitter } from "events";
import logger = require("loggy");
import { IHashMap } from "./Interfaces";
import { ISchemaObject } from "./Typer";

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
	 * Module initialized and will be loaded as soon as `load` function will be called
	 */
	Initialized,
	/**
	 * Module loads, calling `load` will throw an error
	 */
	Loading,
	/**
	 * Module is loaded and ready to use & work
	 */
	Loaded,
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
	state: ModuleLoadState = ModuleLoadState.Initialized;

	constructor(info: IModuleInfo) {
		super();
		this.info = info;
	}

	/**
	 * Function to load module
	 * @returns {Promise} Promise which'll be resolved once module is loaded
	 */
	async load() {
		this.state = ModuleLoadState.Loading;
		try {
			let mod = require(this.info.path);
			this.base = new mod(this.info.options);

			if(this.base) {
				const base = this.base;

				this.signature = base.signature;
				if(base.init) { await base.init(); }
			}

			this.state = ModuleLoadState.Loaded;
			this.emit("loaded", this.signature, this.base);
		} catch(err) {
			this.emit("error", {
				state: "load#initialize",
				error: err
			});
			throw err;
		}
	}

	/**
	 * Function to unload or complete destroy module if it has no unload method
	 * Very important to keep unload function in your module, else unloading can cause exceptions at running
	 * @param reason Reason of unloading which'll be transmitted to module, by default "unload"
	 * @returns {Promise} Promise which'll be resolved once module is unloaded or destroyed
	 */
	async unload(reason: any = "unload") {
		if(this.state !== ModuleLoadState.Loaded) { throw new Error("Module is not loaded"); }

		this.signature = null;

		if(!this.base) {
			this.emit("error", {
				state: "unload",
				error: new Error("Module was already unloaded, base variable is `undefined`")
			});
			this.state = ModuleLoadState.Unloaded;
			return;
		} else if(typeof this.base.unload !== "function") {
			try {
				for(const key of Object.keys(this.base)) {
					this.base[key] = undefined;
					delete this.base[key];
				}
				this.base = undefined;
				this.emit("unloaded");
				this.emit("destroyed");
			} catch(err) {
				this.emit("error", {
					state: "unload#destoy",
					error: err
				});
			}
			this.state = ModuleLoadState.Destroyed;
		} else {
			try {
				let unloaded = await this.base.unload(reason);
				if(unloaded) {
					this.emit("unloaded");
					this.base = undefined;
				}
			} catch(err) {
				this.emit("error", {
					state: "unload#unload",
					error: err
				});
			}
		}
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
	 * @returns {Promise} Promise which'll be resolved once module is loaded
	 */
	async load(name: string | string[]) {
		if(Array.isArray(name)) {
			for(const n of name) { await this.load(n); }
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

		moduleInfo.path = __dirname + "/../" + this.config.basePath + moduleInfo.path;

		try {
			moduleInfo.path = require.resolve(moduleInfo.path);
			this.log("info", "#load: path converted:", moduleInfo.path, "(module can be loaded)");
		} catch(err) {
			this.log("err", "#load: path conversation failed (module can't be loaded)");
			throw err;
		}

		const moduleKeeper = new ModuleBase(moduleInfo);

		try {
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
			this.log("err", "#load: module", moduleKeeper.info.name, " rejected loading:", err);
			throw err;
		}

		this.log("ok", "#load: module", moduleKeeper.info.name, "resolved (loading complete)");
		this.loadedModulesRegistry[moduleKeeper.info.name] = moduleKeeper;
	}

	/**
	 * Unload module by this name in currently loaded modules registry
	 * @param {string|string[]} name Name(s) of loaded module(s)
	 * @param {boolean} skipCallingUnload `true` if module should be unloaded without calling for unload method. Don't use it unless you know that module doesn't handles any events or doesn't has dynamic variables
	 * @returns {Promise} Promise which'll be resolved once module is unloaded and removed from modules with loaded registry
	 */
	async unload(name: string | string[], skipCallingUnload: boolean = false) {
		if(Array.isArray(name)) {
			for(const n of name) { await this.load(n); }
			return;
		}
		if(!this.loadedModulesRegistry[name]) {
			let reason = "Module not found or not loaded yet";
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
				await moduleKeeper.unload();
			} catch(err) {
				this.log("err", "#unload: module", name, "rejected to unload:", err);
				throw err;
			}
			this.log("ok", "#unload: module", name, "successfully unloaded");
			delete this.loadedModulesRegistry[name];
		}
	}

	/**
	 * Loads modules from registry
	 * By default loads only selected kit
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
		this.log("info", !!this.config.queueModuleLoading ? "Queue mode enabled" : "Parallel mode enabled");
		for(const modName of toLoad) {
			const loadingPromise = this.load(modName);
			if(!!this.config.queueModuleLoading) {
				await loadingPromise;
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