import { IModule } from "@sb-types/ModuleLoader/Interfaces";
import { Message, Guild } from "discord.js";
import { INullableHashMap } from "../../../types/Types";
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

	private readonly _prefixesCache: INullableHashMap<string[]> = Object.create(null);
	private readonly _messagesCache: INullableHashMap<ICachedCheck> = Object.create(null);
	private readonly _dbController: PrefixAllDBController = new PrefixAllDBController();
	private readonly _defaultPrefix: string;
	private readonly _messagesCacheDestructionTime: number;

	constructor(options?: IPrefixAllOptions) {
		if (coreInitialized) {
			throw new Error("You couldn't initialize this module second time. Please unload currently loaded module and try again");
		}

		options = <IPrefixAllOptions> {
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

		if (cached) { // by some reason we got call, when it was already cached?
			const cachedResult = cached.result;
			if (!cached.destructTimer) {
				// okay, it's borked, let's re-cache it
				delete this._messagesCache[ctx.id];

				return this._cacheMessage(ctx, cachedResult);
			}

			return cachedResult;
		}

		// function to execute once timer fires
		const destructionFunction = (() => {
			const cached = this._messagesCache[ctx.id];
			if (cached) {
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

	private async _getGuildPrefix(guild: Guild, defaultReplacement = true) {
		let cachedPrefixes = this._prefixesCache[guild.id];

		if (typeof cachedPrefixes === "undefined") {
			cachedPrefixes = this._prefixesCache[guild.id] = await this._dbController.getPrefixes(guild);
		}

		if (cachedPrefixes === null) { return defaultReplacement ? [this._defaultPrefix] : null; }

		return cachedPrefixes;
	}

	/**
	 * Checks if message starts with guild's prefixes
	 * @param message Message to check
	 */
	public async checkPrefix(message: Message) {
		const cached = this._messagesCache[message.id];
		if (cached) { // slight optimization
			return cached.result;
		}

		// no cached version
		if (!message.content || message.content.length === 0) {
			// that's absolutely no-no
			return this._cacheMessage(message, false);
		}

		if (!message.guild) { // only default prefix
			return this._cacheMessage(message, message.content.startsWith(this._defaultPrefix) && this.defaultPrefix);
		}

		const guildPrefix = await this._getGuildPrefix(message.guild);

		if (!guildPrefix) {
			// rare case, when absolutely no prefixes, even no default one
			return this._cacheMessage(message, false);
		}

		const foundPrefix = guildPrefix.find(prefix => message.content.startsWith(prefix));

		if (!foundPrefix) {
			return this._cacheMessage(message, false);
		}

		return this._cacheMessage(message, foundPrefix);
	}

	public async getPrefixes(guild: Guild) {
		if (!guild) { return [this.defaultPrefix]; }

		return this._getGuildPrefix(guild);
	}

	public async setPrefixes(guild: Guild, prefixes: string[] | null) {
		await this._dbController.setPrefixes(guild, prefixes);
		const newPrefixes = await this._dbController.getPrefixes(guild);
		if (!newPrefixes) { return this._prefixesCache[guild.id] = null; }

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
