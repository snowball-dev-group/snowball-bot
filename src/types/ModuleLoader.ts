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

export interface IConfig {
	/**
	 * Base path of modules to load
	 * Uses require.resolve to get correct path and check for errors
	 * @example ./cogs/
	 */
	basePath: string;
	/**
	 * Names of modules that should be loaded by default
	 */
	defaultSet: string[];
	/**
	 * Pre-filled registry with info about modules
	 */
	registry: IHashMap<IModuleInfo>;
	/**
	 * Name of module loaded
	 * Will be used in log
	 */
	name: string;
	/**
	 * Will be all modules loaded as queue or they should be loaded in parallel
	 */
	queueModuleLoading?: boolean;
}

export interface IModule {
	/**
	 * Unload function
	 */
	unload(reason?: string): Promise<boolean>;
}

export class Module extends EventEmitter {
	/**
	 * Base information about module
	 */
	info: IModuleInfo;
	/**
	 * Loaded module
	 * Will be empty if module isn't loaded yet
	 */
	base?: IModule;
	/**
	 * State of module loading
	 * @returns {Boolean} true if loaded, else false
	 */
	loaded: boolean = false;

	constructor(info: IModuleInfo) {
		super();
		this.info = info;
	}

	/**
	 * Function to load module
	 * @returns {Promise} Promise which'll be resolved once module is loaded
	 */
	async load() {
		try {
			let mod = require(this.info.path);
			this.base = new mod(this.info.options);
			if(this.base && this.base["init"] && typeof this.base["init"] === "function") {
				await this.base["init"]();
			}
			this.loaded = true;
			this.emit("loaded", this.base);
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
		if(!this.loaded) { throw new Error("Module not loaded"); }
		if(!this.base) {
			this.emit("error", {
				state: "unload",
				error: new Error("Module was already unloaded, base variable was undefined")
			});
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

export class ModuleLoader {
	/**
	 * Basic configuration used at loader initialization
	 */
	config: IConfig;
	/**
	 * Registry with modules
	 */
	registry: IHashMap<IModuleInfo> = {};
	/**
	 * Registry with currently loaded modules
	 */
	loadedModulesRegistry: IHashMap<Module> = {};

	log: Function;

	constructor(config: IConfig) {
		this.config = config;
		this.log = logger(config.name);

		this.log("info", "Registering modules");
		for(let i in config.registry) {
			let value = config.registry[i];
			this.register(value);
		}
	}

	/**
	 * Add new module to registry
	 * @param info Information about module
	 */
	register(info: IModuleInfo) {
		this.registry[info.name] = info;
		this.log("info", "Registered new module", process.env["NODE_ENV"] === "development" ? info : `"${info.name}" - "${info.path}"`);
	}

	/**
	 * Load module by this name in registry
	 * @param name Name in registry
	 * @returns {Promise} Promise which'll be resolved once module is loaded
	 */
	async load(name: string) {
		if(!this.registry[name]) {
			let reason = "Module not found in registry. Use `ModuleLoader#register` to put your module in registry";
			this.log("err", "#load: attempt to load module", name, "failed:", reason);
			throw new Error(reason);
		}
		if(this.loadedModulesRegistry[name]) {
			let reason = "Module already loaded";
			this.log("err", "#load: attempt to load module", name, "failed:", reason);
			throw new Error(reason);
		}
		let moduleInfo = this.registry[name];
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

		let mod = new Module(moduleInfo);
		try {
			await mod.load();
		} catch(err) {
			this.log("err", "#load: module", mod.info.name, " rejected loading:", err);
			throw err;
		}
		this.log("ok", "#load: module", mod.info.name, "resolved (loading complete)");
		this.loadedModulesRegistry[mod.info.name] = mod;
	}

	/**
	 * Unload module by this name in currently loaded modules registry
	 * @param name Name of loaded module
	 * @returns {Promise} Promise which'll be resolved once module is unloaded and removed from modules with loaded registry
	 */
	async unload(name: string, skipCallingUnload: boolean = false) {
		if(!this.loadedModulesRegistry[name]) {
			let reason = "Module not found or not loaded yet";
			this.log("err", "#unload: check failed: ", reason);
			throw new Error(reason);
		}
		let m = this.loadedModulesRegistry[name];
		if(skipCallingUnload) {
			this.log("warn", "#unload: skiping calling `unload` method");
			delete this.loadedModulesRegistry[name];
		} else {
			if(!m) {
				this.log("warn", "#unload: check failed: registry member is already undefined");
				delete this.loadedModulesRegistry.delete[name];
				return;
			}
			try {
				await m.unload();
			} catch(err) {
				this.log("err", "#unload: module", name, "rejected to unload:", err);
				throw err;
			}
			this.log("ok", "#unload: module", name, "successfully unloaded");
			delete this.loadedModulesRegistry[name];
		}
	}

	async loadModules(forceAll = false) {
		let toLoad: string[] = [];
		if(forceAll) {
			toLoad = Array.from(Object.keys(this.config.registry));
		} else {
			toLoad = this.config.defaultSet;
		}

		this.log("info", "Loading started");
		this.log("info", !!this.config.queueModuleLoading ? "Queue mode enabled" : "Parallel mode enabled");
		for(let modName of toLoad) {
			let loadingPromise = this.load(modName);
			if(!!this.config.queueModuleLoading) {
				await loadingPromise;
			}
		}
	}

	/**
	 * Unloads ALL modules
	 */
	async unloadAll() {
		this.log("info", "Unloading started");
		for(let moduleName in this.loadedModulesRegistry) {
			await this.unload(moduleName);
		}
	}
}

/**
* Convert modules object to Map object
* @param obj {Array} Array of module info entries
*/
export function convertToModulesMap(obj: IModuleInfo[]) {
	let modulesMap: IHashMap<IModuleInfo> = {};
	for(let moduleInfo of obj) {
		modulesMap[moduleInfo.name] = moduleInfo;
	}
	return modulesMap;
}