import { IModule } from "@sb-types/ModuleLoader/ModuleLoader";
import { Plugin } from "@cogs/plugin";
import { Guild } from "discord.js";
import { INullableHashMap } from "@sb-types/Types";
import * as getLogger from "loggy";

export default class OfflineGuildsStorage extends Plugin implements IModule {
	public get signature() {
		return "snowball.core_features.offline_servers_storage";
	}

	private static readonly _log = getLogger("OfflineServersStorage");

	private readonly _offlineGuilds: INullableHashMap<boolean> = Object.create(null);

	constructor() {
		super({
			"guildUnavailable": (g) => this._onGuildUnavailable(g),
			"guildCreate": (g) => this._onGuildCreated(g)
		});
	}

	/**
	 * Checks if guild is currently unavailable
	 * @param guild Guild
	 */
	public isGuildUnavailable(guild: string | Guild) : boolean {
		if (guild instanceof Guild) {
			if (!this._offlineGuilds[guild.id] && !guild.available) {
				this._onGuildUnavailable(guild);
			}

			return !!this._offlineGuilds[guild.id];
		}

		return !!this._offlineGuilds[guild];
	}

	private _onGuildUnavailable(guild: Guild) {
		if (guild.available) { return; }
		
		const guildId = guild.id;

		if (this._offlineGuilds[guildId]) { return; }

		this._offlineGuilds[guild.id] = true;

		OfflineGuildsStorage._log("warn", `Guild is not available - ${guildId}`);
	}

	private _onGuildCreated(guild: Guild) {
		const guildId = guild.id;

		if (!this._offlineGuilds[guildId]) {
			if (!guild.available) {
				OfflineGuildsStorage._log(
					"info",
					`Reported that guild is available, but it is offline`,
					guildId
				);
				this._onGuildUnavailable(guild);
			}

			return;
		}

		this._offlineGuilds[guildId] = false;

		OfflineGuildsStorage._log("ok", `Guild is available - ${guildId}`);
	}

	public async unload() {
		this.unhandleEvents();

		return true;
	}
}
