import { EventEmitter } from "events";
import logger = require("loggy");
import { cbFunctionToPromise } from "../cogs/utils/utils";
import * as _async from "async";

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

export interface IConfig {
    /**
     * Base path of modules to load
     * Uses require.resolve to get correct path and check for errors
     * @example ./cogs/
     */
    basePath: string;
    /**
     * Names of modules for fast load after registry'll be filled with values
     */
    fastLoad: Array<string>;
    /**
     * Pre-filled registry with info about modules
     */
    registry: Map<string, IModuleInfo>;
    /**
     * Name of module loaded
     * Will be used in log
     */
    name: string;
}

export interface IModule {
    /**
     * Unload function
     */
    unload(): Promise<boolean>;
}

export class Module extends EventEmitter {
    /**
     * Base information about module
     */
    info:IModuleInfo;
    /**
     * Loaded module
     * Will be empty if module isn't loaded yet
     */
    base?: IModule;
    /**
     * State of module loading
     * @returns {Boolean} true if loaded, else false
     */
    loaded:boolean = false;

    constructor(info: IModuleInfo) {
        super();
        this.info = info;
    }

    /**
     * Function to load module
     * @returns {Promise} Promise which'll be resolved once module is loaded
     */
    load() {
        return new Promise((res, rej) => {
            try {
                //let l = logger(this.info.name);
                let mod = require(this.info.path);
                this.base = new mod(this.info.options);
                this.loaded = true;
                this.emit("loaded", this.base);
                res(this.base);
            } catch (err) {
                this.emit("error", {
                    state: "load#initialize",
                    error: err
                });
                rej(err);
            }
        });
    }

    /**
     * Function to unload or complete destroy module if it has no unload method
     * Very important to keep unload function in your module, else unloading can cause exceptions at running
     * @param reason Reason of unloading which'll be transmitted to module, by default "unload"
     * @returns {Promise} Promise which'll be resolved once module is unloaded or destroyed
     */
    unload(reason:any="unload") {
        return new Promise((res, rej) => {
            if(!this.loaded) { return rej(new Error("Module not loaded")); };
            if(!this.base) {
                this.emit("error", {
                    state: "unload",
                    error: new Error("Module was already unloaded, base variable was undefined")
                });
                return res();
            }
            if(typeof this.base.unload !== "function") {
                try {
                    for (const key of Object.keys(this.base)) {
                        this.base[key] = undefined;
                        delete this.base[key];
                    }
                    this.base = undefined;
                    this.emit("unloaded");
                    this.emit("destroyed");
                } catch (err) {
                    this.emit("error", {
                        state: "unload#destoy",
                        error: err
                    });
                }
            } else {
                this.base.unload().then((unloaded) => {
                    if(unloaded) {
                        this.emit("unloaded");
                        this.base = undefined;
                    }
                });
            }
        });
    }
}

export class ModuleLoader {
    /**
     * Basic configuration used at loader initialization
     */
    config:IConfig;
    /**
     * Registry with modules
     */
    registry:Map<string, IModuleInfo> = new Map<string, IModuleInfo>();
    /**
     * Registry with currently loaded modules
     */
    loadedModulesRegistry:Map<string, Module> = new Map<string, Module>();

    log:Function;

    constructor(config: IConfig) {
        this.config = config;
        this.log = logger(config.name);
        
        this.log("info", "Registering modules");
        config.registry.forEach((value) => {
            this.register(value);
        });

        this.log("info", "Starting fast load");
        this.config.fastLoad.forEach((name) => {
            this.load(name);
        });
    }

    /**
     * Add new module to registry
     * @param info Information about module
     */
    register(info:IModuleInfo) {
        this.registry.set(info.name, info);
        this.log("info", "Registered new module", info);
    }


    /**
     * Load module by this name in registry
     * @param name Name in registry
     * @returns {Promise} Promise which'll be resolved once module is loaded
     */
    async load(name:string) {
        if(!this.registry.has(name)) {
            let reason = "Module not found in registry. Use `ModuleLoader#register` to put your module in registry";
            this.log("err", "#load: attempt to load module", name, "failed:", reason);
            throw new Error(reason);
        }
        if(this.loadedModulesRegistry.has(name)) {
            let reason = "Module already loaded";
            this.log("err", "#load: attempt to load module", name, "failed:", reason);
            throw new Error(reason);
        }
        let moduleInfo = this.registry.get(name);
        if(!moduleInfo) {
            this.log("err", "#load: module found in registry, but returned undefined value");
            throw new Error("No module info");
        }
        moduleInfo.path = __dirname + "/../" + this.config.basePath + moduleInfo.path;
        
        try {
            moduleInfo.path = require.resolve(moduleInfo.path);
            this.log("info", "#load: path converted:", moduleInfo.path, "(module can be loaded)");
        } catch (err) {
            this.log("err", "#load: path conversation failed (module can't be loaded)");
            throw err;
        }

        let module = new Module(moduleInfo);
        try {
            await module.load();
        } catch (err) {
            this.log("err", "#load: module", module.info.name, " rejected loading:", err);
            throw err;
        }
        this.log("ok", "#load: module", module.info.name, "resolved (loading complete)");
        this.loadedModulesRegistry.set(module.info.name, module);
    }

    /**
     * Unload module by this name in currently loaded modules registry
     * @param name Name of loaded module
     * @returns {Promise} Promise which'll be resolved once module is unloaded and removed from modules with loaded registry
     */
    async unload(name:string, skipCallingUnload:boolean = false) {
        if(!this.loadedModulesRegistry.has(name)) {
            let reason = "Module not found or not loaded yet";
            this.log("err", "#unload: check failed: ", reason);
            throw new Error(reason);
        }
        let m = this.loadedModulesRegistry.get(name);
        if(skipCallingUnload) {
            this.log("warn", "#unload: skiping calling `unload` method");
            this.loadedModulesRegistry.delete(name);
        } else {
            if(!m) {
                this.log("warn", "#unload: check failed: registry member is already undefined");
                this.loadedModulesRegistry.delete(name);
                return;
            }
            try {
                await m.unload();
            } catch (err) {
                this.log("err", "#unload: module", name, "rejected to unload:", err);
                throw err;
            }
            this.log("ok", "#unload: module", name, "successfully unloaded");
            this.loadedModulesRegistry.delete(name);
        }
    }

    /**
     * Unloads ALL modules
     */
    async unloadAll() {
        let allModulesNames = Array.from(this.loadedModulesRegistry.keys());
        await cbFunctionToPromise(_async.forEach, allModulesNames, async (moduleName:string, cb:Function) => {
            await this.unload(moduleName);
            cb();
        });
    }
}