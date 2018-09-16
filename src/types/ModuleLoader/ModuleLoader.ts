import { INullableHashMap } from "@sb-types/Types";
import { ISchemaObject } from "@sb-types/Typer";
import * as logger from "loggy";
import * as path from "path";
import * as Interfaces from "@sb-types/ModuleLoader/Interfaces";
import { ModuleBase } from "@sb-types/ModuleLoader/ModuleBase";

// #region Interfaces and enums

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
	registry: INullableHashMap<Interfaces.IModuleInfo>;
	/**
	 * Name of module loaded
	 * Will be used in log
	 * @example MyCoolModuleLoader
	 */
	name: string;
}

// #endregion

// #region Module Keeper

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
	public registry: INullableHashMap<Interfaces.IModuleInfo> = Object.create(null);
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

		// tslint:disable-next-line:early-exit
		if (!path.isAbsolute(this.config.basePath)) {
			this.config.basePath = path.join(
				process.cwd(),
				this.config.basePath
			);
		}
	}

	/**
	 * Add new module to registry
	 * @param info Information about module
	 */
	public register(info: Interfaces.IModuleInfo) {
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
			for (let i = 0, l = name.length; i < l; i++) {
				await this.load(name[i], clearRequireCache);
			}

			return this;
		}

		if (!this.registry[name]) {
			const reason = "Module not found in registry. Use `ModuleLoader#register` to put your module into registry";
			this.log("err", `[Load] attempt to load module "${name}" failed: ${reason}`);

			throw new Error(reason);
		}

		if (this.loadedModulesRegistry[name]) {
			const reason = "Module already loaded";
			this.log("err", `[Load] attempt to load module "${name}" failed: ${reason}`);

			throw new Error(reason);
		}

		const moduleInfo = this.registry[name];
		if (!moduleInfo) {
			this.log("err", "[Load] module found in registry, but returned undefined value");

			throw new Error("No module info");
		}

		if (!path.isAbsolute(moduleInfo.path)) {
			moduleInfo.path = `${this.config.basePath}/${moduleInfo.path}`;
		}

		try {
			moduleInfo.path = require.resolve(moduleInfo.path);
			this.log("info", `[Load] path converted: "${moduleInfo.path}" (module can be loaded)`);
		} catch (err) {
			this.log("err", "[Load] path conversation failed (module can't be loaded)");

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
				this.log("err", `[Load] signature violation found: "${moduleKeeper.info.name}" - violation "${violation}" caused unload`);

				await moduleKeeper.unload("signature_violation");

				return this;
			}

			if (moduleKeeper.signature) {
				// typescript workaround
				this.signaturesRegistry[moduleKeeper.signature] = moduleKeeper;
			}
		} catch (err) {
			this.log("err", `[Load] module "${moduleKeeper.info.name}" rejected loading`);
			throw err;
		}

		this.log("ok", `[Load] module "${moduleKeeper.info.name}" resolved (loading complete)`);
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
			for (let i = 0, l = name.length; i < l; i++) {
				await this.unload(name[i], reason);
			}

			return this;
		}

		if (!this.loadedModulesRegistry[name]) {
			const reason = "Module not found or not loaded yet";
			this.log("err", `[Unload] check failed: ${reason}`);
			throw new Error(reason);
		}

		const moduleKeeper = this.loadedModulesRegistry[name];

		if (moduleKeeper == null) {
			this.log("warn", `[Unload] check failed: registry member is already \`${moduleKeeper}\``);

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
			this.log("err", `[Unload] module "${name}" rejected to unload:`, err);
			throw err;
		}

		this.log("ok", `[Unload] module "${name}" successfully unloaded`);

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
			if (keeper.state === Interfaces.ModuleLoadState.Loaded) {
				toInit.push(keeper);
			}
		}

		this.log("info", "Entering initialization state...");

		for (const keeper of toInit) {
			try {
				await keeper.initialize();
			} catch (err) {
				this.log("warn", `Failed to initialize module "${keeper.info.name}":`, err);

				keeper.unload();
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
		if (!keeper) {
			return undefined;
		}

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
* @param arr Array of module info entries
*/
export function convertToModulesMap(arr: Interfaces.IModuleInfo[]) {
	const modulesMap: INullableHashMap<Interfaces.IModuleInfo> = Object.create(null);

	for (let i = 0, l = arr.length; i < l; i++) {
		const moduleInfo = arr[i];

		modulesMap[moduleInfo.name] = moduleInfo;
	}

	return modulesMap;
}

// #endregion
