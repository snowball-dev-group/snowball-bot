import { IModule } from "@sb-types/ModuleLoader/Interfaces";
import * as getLogger from "loggy";
import { Guild, VoiceChannel } from "discord.js";
import { toGuildLocaleString, extendAndAssign, ExtensionAssignUnhandleFunction } from "@utils/ez-i18n";
import { DateTime } from "luxon";
import { ErrorMessages } from "@sb-types/Consts";

export interface IStatsChannelsSettings {
	guildId: string;
	channels: StatsChannelsSetting;
}

type StatsChannelsSetting = StatsChannelsProto<string>;

type StatsChannelsProto<T> = {
	members?: T;
	time?: T;
};

const CHANNEL_TYPES: Array<keyof StatsChannelsProto<any>> = ["members", "time"];

const SIGNATURE_BASE = "snowball.partners.dnserv.stats_channels";

const ONE_SECOND = 60000; // ms
const MEMBERS_STR = "{members, plural, one {# участник} few {# участника} other {# участников}}";

export class StatsChannels implements IModule {
	private static readonly _log = getLogger("dnSERV Reborn: StatsChannels");

	private readonly _signature: string;
	private readonly _settings: IStatsChannelsSettings;

	public get signature() {
		return this._signature;
	}

	private _i18nUnhandle?: ExtensionAssignUnhandleFunction;
	private _managedGuild: Guild;
	private _resolvedChannels: StatsChannelsProto<VoiceChannel>;
	private _scheduledIntervalInit?: NodeJS.Timer;
	private _updateInterval?: NodeJS.Timer;

	constructor(settings: IStatsChannelsSettings) {
		if (!settings) {
			throw new Error("No settings specified");
		}

		const { guildId, channels } = settings;

		if (!guildId) {
			throw new Error("No server ID specified in settings");
		} else if (!channels) {
			throw new Error("No stats channels specified");
		}

		this._signature = `${SIGNATURE_BASE}~${guildId}`;

		this._settings = settings;
	}

	public async init() {
		if (!$modLoader.isPendingInitialization(this.signature)) {
			throw new Error(
				ErrorMessages.NOT_PENDING_INITIALIZATION
			);
		}

		await this._initLocalization();

		const settings = this._settings;

		const guild = $discordBot.guilds.get(
			settings.guildId
		);

		if (!guild) {
			if ($botConfig.sharded) {
				StatsChannels._log("warn", "No guild for this plugin found");

				return;
			}

			throw new Error("Server not found");
		}

		const { channels } = settings;

		const resolvedChannels: ResolvedChannels = Object.create(null);

		for (let i = 0, l = CHANNEL_TYPES.length; i < l; i++) {
			const type = CHANNEL_TYPES[i];

			const id = channels[type];

			if (!id) {
				continue;
			}

			const channel = guild.channels.get(id);

			if (!channel) {
				throw new Error(`Cannot find channel with ID "${id}" for "${type}"`);
			}

			if (!(channel instanceof VoiceChannel)) {
				throw new Error(`Channel with ID "${id}" has invalid type. Channel must be voice-type`);
			}

			resolvedChannels[type] = channel;
		}

		this._managedGuild = guild;
		this._resolvedChannels = resolvedChannels;

		this._scheduledIntervalInit = setTimeout(
			() => this._initInterval(),
			StatsChannels._msUntilNextSecond()
		);
	}

	private async _initLocalization() {
		this._i18nUnhandle = await extendAndAssign(
			[__dirname, "i18n"],
			this.signature
		);
	}

	private async _initInterval() {
		if (this._updateInterval) {
			clearInterval(this._updateInterval);
		}

		this._updateInterval = setInterval(
			() => this._updateChannels(),
			ONE_SECOND
		);
	}

	private async _updateChannels() {
		const guild = this._managedGuild;

		if (!guild.available) {
			StatsChannels._log("warn", `Guild "${guild.id}" is unavailable`);

			return;
		}

		const resolvedChannels = this._resolvedChannels;

		this._updateMembersStatChannel(resolvedChannels.members);
		this._updateTimeStatChannel(resolvedChannels.time);
	}

	private async _updateMembersStatChannel(channel?: VoiceChannel) {
		if (!channel) { return; }

		if (this._deletionFearConfirms(channel, "time")) {
			return;
		}

		const generatedString = $localizer.formatString(
			"ru-RU", // currently this string
			MEMBERS_STR, {
				members: this._managedGuild.memberCount
			}
		);

		return StatsChannels._updateChannelName(
			channel,
			generatedString
		);
	}

	private async _updateTimeStatChannel(channel?: VoiceChannel) {
		if (!channel) { return; }

		if (this._deletionFearConfirms(channel, "members")) {
			return;
		}

		const generatedString = await toGuildLocaleString(
			this._managedGuild,
			Date.now(),
			DateTime.DATETIME_SHORT
		);

		return StatsChannels._updateChannelName(
			channel,
			generatedString
		);
	}

	private static async _updateChannelName(channel: VoiceChannel, str: string) {
		if (channel.name === str) {
			return;
		}

		return channel.setName(str);
	}

	private _deletionFearConfirms(channel: VoiceChannel, type: keyof ResolvedChannels) {
		if (channel.deleted) {
			delete this._resolvedChannels[type];

			StatsChannels._log(
				"warn",
				`Resolved channel with ID "${channel.id}" for "${type}" is deleted.`
			);

			return true;
		}

		return false;
	}

	private static _msUntilNextSecond() {
		const d = new Date();

		const currentMilliseconds =
			(d.getSeconds() * 1000)
			+ d.getMilliseconds();

		return ONE_SECOND - currentMilliseconds;
	}

	public async unload() {
		if (!$modLoader.isPendingUnload(this._signature)) {
			throw new Error(
				ErrorMessages.NOT_PENDING_UNLOAD
			);
		}

		const {
			_scheduledIntervalInit: scheduledInit,
			_updateInterval: interval,
			_i18nUnhandle: i18nUnhandle
		} = this;

		if (scheduledInit) {
			clearTimeout(scheduledInit);
		}

		if (interval) {
			clearInterval(interval);
		}

		if (i18nUnhandle) {
			i18nUnhandle();
		}

		return true;
	}
}

type ResolvedChannels = StatsChannelsProto<VoiceChannel>;

export default StatsChannels;
