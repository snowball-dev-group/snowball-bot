import { EventEmitter } from "events";
import { ModuleLoader, IModuleInfo } from "./ModuleLoader";
import { ILocalizerOptions, Localizer } from "./Localizer";
import logger = require("loggy");
import * as djs from "discord.js";

export interface IBotConfig {
    /**
     * Bot token
     */
    token: string;
    /**
     * Name of bot
     */
    name: string;
    /**
     * discord's Snowflake ID of bot owner
     */
    botOwner: string;
    /**
     * Modules to automatic load
     */
    autoLoad: string[];
    /**
     * Array of modules info
     */
    modules: IModuleInfo[];
    /**
     * Discord Client's config
     */
    djs_config: djs.ClientOptions;
    /**
     * Localizator options
     */
    localizerOptions: ILocalizerOptions;
    /**
     * Sharding options
     */
    shardingOptions: {
        enabled:boolean;
        shards:number;
    };
}

export interface IPublicBotConfig {
    /**
     * Name of bot
     */
    name: string;
    /**
     * ID of bot owner
     */
    botOwner: string;
    /**
     * Bot is runned in sharded mode
     */
    sharded: boolean;
    /**
     * Main shard
     */
    mainShard: boolean;
    /**
     * Shard ID
     */
    shardId: number;
    /**
     * Total Shards
     */
    shardsCount: number;
}

export interface IInternalConfig {
    /**
     * Currently runned shards
     */
    shardsCount: number;
    /**
     * Current Shard ID
     */
    shardId: number;
}

declare global {
    /**
     * Bot itself
     */
    // tslint:disable-next-line:no-unused-variable
    const discordBot: djs.Client;

    /**
     * Public bot config visible to all modules
     */
    // tslint:disable-next-line:no-unused-variable
    const botConfig: IPublicBotConfig;

    /**
     * Localizer
     */
    // tslint:disable-next-line:no-unused-variable
    const localizer: Localizer;

    /**
     * Module Loader
     */
    // tslint:disable-next-line:no-unused-variable
    const modLoader: ModuleLoader;
}

export class SnowballBot extends EventEmitter {
    /**
     * Module loader
     */
    modLoader: ModuleLoader;
    /**
     * Configuration
     */
    config: IBotConfig;
    /**
     * Internal configuration
     */
    internalConfiguration: IInternalConfig;
    /**
     * Discord Bot
     */
    discordBot: djs.Client;

    log:Function = logger("::SnowballBot");

    constructor(config: IBotConfig, internalConfig:IInternalConfig) {
        super();
        this.config = config;
        this.internalConfiguration = internalConfig;
        this.log = logger(`${config.name}:SnowballBot`);
    }

    /**
     * Convert modules object to Map object
     * @param obj {Array} Array of module info entries
     */
    _convertToModulesMap(obj: IModuleInfo[]) {
        let modulesMap = new Map();
        obj.forEach((moduleInfo) => {
            modulesMap.set(moduleInfo.name, moduleInfo);
        });
        return modulesMap;
    }

    /**
     * Prepare module loader
     * It will load all modules / plugins
     */
    async prepareModLoader() {
        this.modLoader = new ModuleLoader({
            basePath: "./cogs/",
            name: `${this.config.name}:ModLoader`,
            defaultSet: this.config.autoLoad,
            registry: new Map<string, IModuleInfo>(this._convertToModulesMap(this.config.modules))
        });
        await this.modLoader.loadModules();

        // Public module loader
        Object.defineProperty(global, "modLoader", {
            configurable: false, enumerable: false,
            writable: true, value: this.modLoader
        });
    }

    /**
     * Prepare global client variable and client itself
     */
    prepareDiscordClient() {
        let publicBotConfig:IPublicBotConfig = {
            name: this.config.name,
            botOwner: this.config.botOwner,
            mainShard: true,
            sharded: false,
            shardId: 1,
            shardsCount: 1
        };

        // checking options
        let djsOptions = this.config.djs_config || {};

        { // checking shards count
            let shardCount = this.internalConfiguration.shardsCount;
            if(shardCount > 0) {
                this.log("warn", "WARNING! Running in sharding mode is still expiremental, please use it with risk!");
                publicBotConfig.sharded = true;
            } else {
                throw new Error("Invalid shards count");
            }
        }

        { // checking shard id
            let shardId = this.internalConfiguration.shardId;
            if(shardId >= 0) {
                this.log("info", "Running as shard", shardId);
                if(shardId === 0) {
                    publicBotConfig.mainShard = true;
                }
                publicBotConfig.shardId = shardId;
            } else {
                throw new Error("Invalid shard id");
            }
        }

        djsOptions.shardId = this.internalConfiguration.shardId;
        djsOptions.shardCount = this.internalConfiguration.shardsCount;

        this.log("info", "Preparing Discord client");

        // Making new Discord Client
        this.discordBot = new djs.Client(djsOptions);

        // Setting max listeners
        this.discordBot.setMaxListeners(100);

        this.discordBot.on("error", (err) => {
            this.log("err", "Error at Discord client", err);
        });

        // Global bot variable, which should be used by plugins
        Object.defineProperty(global, "discordBot", {
            configurable: false, enumerable: false,
            writable: true, value: this.discordBot
        });

        // Public bot config
        Object.defineProperty(global, "botConfig", {
            configurable: false, enumerable: false,
            writable: true, value: publicBotConfig
        });
    }

    async prepareLocalizator() {
        let localizer = new Localizer(`${this.config.name}:Localizer`, this.config.localizerOptions);
        await localizer.init();
        Object.defineProperty(global, "localizer", {
            configurable: false, enumerable: false,
            writable: false, value: localizer
        });
    }

    /**
     * Connect to Discord
     * @returns {Promise}
     */
    async connect() {
        this.log("info", "Connecting to Discord...");
        // Just calling method
        return await this.discordBot.login(this.config.token);
    }
}