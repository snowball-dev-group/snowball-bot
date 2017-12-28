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

		options = <IPrefixAllOptions>{
			defaultPrefix: DEFAULT_PREFIX,
			messagesCacheDestructionTime: DEFAULT_MSGCACHE_DESTRUCTTIME,
			...options
		};

		this._defaultPrefix = options.defaultPrefix;
		this._messagesCacheDestructionTime = Math.max(Math.min(options.messagesCacheDestructionTime, 600000), 5000);

		coreInitialized = true;
	}

	public async init() {
		await this._dbController.init();
	}
	
	private _cacheMessage(ctx: Message, result: CheckResult): CheckResult {
		let cached = this._messagesCache[ctx.id]; // checking if there's cached version

		if(cached) { // by some reason we got call, when it was already cached?
			const cachedResult = cached.result;
			if(!cached.destructTimer) {
				// okay, it's borked, let's re-cache it
				delete this._messagesCache[ctx.id];
				return this._cacheMessage(ctx, cachedResult);
			}
			return cachedResult;
		}

		// function to execute once timer fires
		const destructionFunction = (() => {
			const cached = this._messagesCache[ctx.id];
			if(cached) {
				cached.destructTimer = null;
				delete this._messagesCache[ctx.id];
			}
		});

		cached = this._messagesCache[ctx.id] = {
			cachedAt: Date.now(),
			destructTimer: setTimeout(destructionFunction, this._messagesCacheDestructionTime),
			result
		};

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
	 * @param {Message} message Message to check
	 */
	public async checkPrefix(message: Message) {
		const cached = this._messagesCache[message.id];
		if(cached) { // slight optimization
			return cached.result;
		}
		
		// no cached version
		if(!message.content || message.content.length === 0) {
			// that's absolutely no-no
			return this._cacheMessage(message, false);
		}

		const guildPrefix = await this._getGuildPrefixPrefix(message.guild);

		if(!guildPrefix) {
			return this._cacheMessage(message, false);
		}

		const foundPrefix = guildPrefix.find(prefix => message.content.startsWith(prefix));

		if(!foundPrefix) {
			return this._cacheMessage(message, false);
		}

		return this._cacheMessage(message, foundPrefix);
	}

	public async getPrefixes(guild: Guild) {
		return await this._getGuildPrefixPrefix(guild);
	}

	public async setPrefixes(guild: Guild, prefixes: string[] | null) {
		await this._dbController.setPrefixes(guild, prefixes);
		const newPrefixes = await this._dbController.getPrefixes(guild);
		if(!newPrefixes) { return this._prefixesCache[guild.id] = null; }
		return this._prefixesCache[guild.id] = newPrefixes;
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
