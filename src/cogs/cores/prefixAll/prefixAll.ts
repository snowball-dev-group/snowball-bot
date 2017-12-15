import { IModule } from "../../../types/ModuleLoader";
import { Message, Guild } from "discord.js";
import { IHashMap } from "../../../types/Interfaces";
import { PrefixAllDBController } from "./dbController";

export const PREFIXALL_SIGNATURE = "snowball.core_features.prefixall";
export const DEFAULT_PREFIX = "!";
export const DEFAULT_MSGCACHE_DESTRUCTTIME = 60000;

// pls read it as PrefixAl'

let coreInitialized = false;

export default class PrefixAll implements IModule {
	public get signature() {
		return PREFIXALL_SIGNATURE;
	}

	public get defaultPrefix() {
		return this._defaultPrefix;
	}

	private _prefixesCache: IHashMap<string[] | undefined | null> = {};
	private _messagesCache: IHashMap<ICachedCheck | undefined> = {};
	private _dbController: PrefixAllDBController = new PrefixAllDBController();
	private _defaultPrefix: string;
	private _messagesCacheDestructionTime: number;

	constructor(options?: IPrefixAllOptions) {
		if(coreInitialized) {
			throw new Error("You couldn't initialize this module second time. Please unload currently loaded module and try again");
		}

		options = Object.assign(<IPrefixAllOptions>{
			defaultPrefix: DEFAULT_PREFIX,
			messagesCacheDestructionTime: DEFAULT_MSGCACHE_DESTRUCTTIME
		}, options);

		this._defaultPrefix = options.defaultPrefix;
		this._messagesCacheDestructionTime = Math.max(Math.min(options.messagesCacheDestructionTime, 600000), 5000);

		coreInitialized = true;
	}

	public async init() {
		await this._dbController.init();
	}
	
	private _cacheCheck(ctx: Message, result: CheckResult): CheckResult {
		// caches check and sets the destruction timer

		// function to execute once timer fires
		const destructionFunction = (() => {
			const cached = this._messagesCache[ctx.id];
			if(cached) {
				cached.destructTimer = null;
				delete this._messagesCache[ctx.id];
			}
		});

		let cached = this._messagesCache[ctx.id]; // checking if there's cached version
		if(!cached) { // if no, then creating one
			cached = this._messagesCache[ctx.id] = {
				cachedAt: Date.now(),
				destructTimer: setTimeout(destructionFunction, this._messagesCacheDestructionTime),
				result
			};
		} else if(cached && cached.destructTimer !== null && !cached.destructTimer) { // undefined?
			// 'th situation', but let's just recreate timer
			cached.destructTimer = setTimeout(destructionFunction, this._messagesCacheDestructionTime);
		} else {
			// who's attempted to do this?
			throw new Error("Already in cache and sheduled for destruction");
		}

		// returning caching result
		return cached.result;
	}

	private async _getGuildPrefixPrefix(guild: Guild, defaultReplacement = true) {
		let cachedPrefixes = this._prefixesCache[guild.id];

		if(typeof cachedPrefixes === "undefined") {
			cachedPrefixes = this._prefixesCache[guild.id] = await this._dbController.getPrefixes(guild);
		}

		if(cachedPrefixes === null) { return defaultReplacement ? [this._defaultPrefix] : null; }

		return cachedPrefixes;
	}

	/**
	 * Checks if message starts with guild's prefixes
	 * @param {Message} ctx Message to check
	 */
	public async checkPrefix(ctx: Message) {
		// as it will be called multipletimes, checking cached version and returning it's result
		const cachedCheckResult = this._messagesCache[ctx.id];
		if(cachedCheckResult) {
			return cachedCheckResult.result;
		}

		// instafails
		if(!ctx.content || ctx.content.length === 0) { return this._cacheCheck(ctx, false); }
		if(!ctx.guild && ctx.content.startsWith(this._defaultPrefix)) { return this._cacheCheck(ctx, false); }

		let prefixes = await this._getGuildPrefixPrefix(ctx.guild, true);

		if(prefixes === null) { return this._cacheCheck(ctx, ctx.content.startsWith(this._defaultPrefix) ? this._defaultPrefix : false); }

		return this._cacheCheck(ctx, (prefixes.find((prefix) => ctx.content.startsWith(prefix)) || false));
	}

	public async getPrefixes(guild: Guild) {
		return await this._getGuildPrefixPrefix(guild);
	}

	public async setPrefixes(guild: Guild, prefixes: string[] | null) {
		const rawRow = await this._dbController.setPrefixes(guild, prefixes);
		if(!rawRow.prefix) { return this._prefixesCache[guild.id] = null; }
		return this._prefixesCache[guild.id] = JSON.parse(rawRow.prefix);
	}

	public async unload() {
		coreInitialized = false;
		return true;
	}
}

/**
 * Cached version of {PrefixAll#checkPrefix} result
 */
interface ICachedCheck {
	/**
	 * Timestamp when cache was created
	 */
	cachedAt: number;
	/**
	 * Result that was returned by {PrefixAll#checkPrefix}
	 */
	result: CheckResult;
	/**
	 * Timer of destruction
	 */
	destructTimer: NodeJS.Timer | null;
}

/**
 * {PrefixAll} options
 */
interface IPrefixAllOptions {
	messagesCacheDestructionTime: number;
	defaultPrefix: string;
}

export type CheckResult = string | false;

module.exports = PrefixAll;
