import * as Interfaces from "@sb-types/ModuleLoader/Interfaces";
import { EventEmitter } from "events";
import { isClass } from "@utils/extensions";

export class ModuleBase<T> extends EventEmitter {
	/**
	 * Base information about module
	 */
	public readonly info: Interfaces.IModuleInfo;

	/**
	 * Loaded module
	 * Will be empty if module isn't loaded yet
	 */
	public base?: Interfaces.IModule & T;

	/**
	 * Module's signature used to identify this module by other modules
	 */
	public signature: string | null = null;

	/**
	 * Module loading state
	 */
	public state: Interfaces.ModuleLoadState = Interfaces.ModuleLoadState.Ready;

	constructor(info: Interfaces.IModuleInfo) {
		super();
		this.info = info;
	}

	/**
	 * Function to load module
	 * @fires ModuleBase<T>#loaded
	 * @fires ModuleBase<T>#initialized
	 * @fires ModuleBase<T>#error
	 * @returns Promise which'll be resolved with this module's base once module is loaded
	 */
	public async load() {
		if (this.state !== Interfaces.ModuleLoadState.Ready && this.state !== Interfaces.ModuleLoadState.Unloaded && this.state !== Interfaces.ModuleLoadState.Destroyed) {
			throw new Error("Module is already loaded or pending loading");
		}

		this.state = Interfaces.ModuleLoadState.Initializing;

		try {
			let mod = require(this.info.path);

			if (typeof mod === "object" && mod.default) {
				mod = mod.default;
			}

			if (!isClass(mod)) {
				throw new Error("The module has returned value of invalid type and will not be stated as loaded");
			}

			const base = new mod(this.info.options);

			if (!base) {
				throw new Error("The module has not returned any value and will not be stated as loaded");
			}

			if (typeof base.unload !== "function") {
				throw new Error("The module has no `unload` function and will not be stated as loaded");
			}

			this.base = base;
			this.signature = base.signature;
			this.state = Interfaces.ModuleLoadState.Loaded;

			this.emit("loaded", this.signature, this.base);

			if (!base.init) {
				this.state = Interfaces.ModuleLoadState.Initialized;
				this.emit("initialized", base);
			}
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
	 * @fires ModuleBase<T>#initialization
	 * @fires ModuleBase<T>#initialized
	 */
	public async initialize() {
		if (this.state !== Interfaces.ModuleLoadState.Loaded) {
			throw new Error("Module is not loaded to initializate it");
		}

		this.emit("initialization");

		if (this.base && this.base.init) {
			await this.base.init();
		}

		this.state = Interfaces.ModuleLoadState.Initialized;

		this.emit("initialized", this.base, this.signature);

		return this;
	}

	/**
	 * Function to unload or complete destroy module if it has no unload method.
	 * @param reason Reason of unloading which'll be transmitted to module. By default "unload"
	 * @fires ModuleBase<T>#unloading
	 * @fires ModuleBase<T>#error
	 * @fires ModuleBase<T>#destroyed
	 * @fires ModuleBase<T>#unloaded
	 * @returns Promise which'll be resolved with this module's base once module is unloaded or destroyed
	 */
	public async unload(reason: any = "unload") {
		if (
			this.state !== Interfaces.ModuleLoadState.Initialized &&
			this.state !== Interfaces.ModuleLoadState.Loaded
		) {
			throw new Error("Module is not loaded");
		}

		const signature = this.signature;

		this.emit("unloading", signature);
		this.signature = null;

		if (!this.base) {
			this.emit("error", {
				state: "unload",
				error: new Error("Module was already unloaded, base variable is `undefined`")
			});

			this.state = Interfaces.ModuleLoadState.Unloaded;
		} else if (typeof this.base.unload !== "function") {
			// ! Deprecated, there will be check on modules loading

			try {
				for (const key in this.base) {
					// this.base[key] = undefined;
					delete this.base[key];
				}

				this.base = undefined;
				this.state = Interfaces.ModuleLoadState.Destroyed;

				this.emit("destroyed", signature);
			} catch (err) {
				this.emit("error", {
					state: "unload#destoy",
					error: err
				});
			}

			this.state = Interfaces.ModuleLoadState.Destroyed;
		} else {
			try {
				const unloaded = await this.base.unload(reason);
				if (unloaded) {
					this.base = undefined;
					this.state = Interfaces.ModuleLoadState.Unloaded;
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
	 * Shortcut for checking if module is already initialized or you need to wait for it.
	 * 
	 * If module is already initialized, then immediately calls the callback.
	 * Otherwise subscribes you to the `initialized` event
	 * @listens ModuleBase<T>#initialized
	 */
	public onInit(callback: (base: T) => void) {
		if (this.state === Interfaces.ModuleLoadState.Initialized && this.base) {
			callback(this.base);

			return this;
		}

		return this.once("initialized", callback);
	}

	/**
	 * Shortcut for checking if module is already loaded or you need to wait for it.
	 * 
	 * If module is already loaded, then immediately calls the callback.
	 * Otehrwise subscribes you to the `loaded` event
	 * @param callback The callback function that will be called with `base`
	 * @listens ModuleBase<T>#loaded
	 */
	public onLoad(callback: (base: T) => void) {
		if (this.state === Interfaces.ModuleLoadState.Loaded && this.base) {
			callback(this.base);

			return this;
		}

		return this.once("loaded", (_sig, base) => callback(base));
	}

	/**
	 * Clears require cache for this module.
	 * Useful while reloading module:
	 *   In this case module file will be read from disk
	 * @returns This module's base
	 */
	public clearRequireCache() {
		if (require.cache[this.info.path]) {
			delete require.cache[this.info.path];
		}

		return this;
	}
}

export default ModuleBase;
