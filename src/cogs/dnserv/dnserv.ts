import { IModule } from "@sb-types/ModuleLoader/Interfaces";
import { Plugin } from "@cogs/plugin";
import { MessageReaction, User, VoiceChannel, Guild } from "discord.js";
import { getMessageMember } from "@utils/utils";
import { ErrorMessages } from "@sb-types/Consts";
import * as getLogger from "loggy";
import { DateTime } from "luxon";

const STAR = "⭐";
const DEFAULT_TIMEZONE = "Europe/Moscow";

// As we don't have Russian yet
const MEMBERS_STRING = "{members, plural, one {# участник} few {# участника} other {# участников}}";

interface IPluginOptions {
	serverId: string;
	statsChannels: StatsChannels;
	timezone?: string;
}

type StatsChannels = Partial<{
	members: string;
	time: string;
}>;

export class DNServReborn extends Plugin implements IModule {
	public get signature() {
		return "snowball.partners.dnserv";
	}

	private readonly _serverId: string;
	private readonly _statsChannels?: StatsChannels;
	private readonly _timeZone: string;


	private _statsInterval?: NodeJS.Timer;
	private _pendingInterval?: NodeJS.Timer;

	private static readonly _log = getLogger("dnSERV Reborn");

	constructor(options: Partial<IPluginOptions>) {
		super({
			"messageReactionAdd": (reaction, user) => this._removeSelfStar(reaction, user)
		}, true);

		const {
			serverId,
			statsChannels,
			timezone
		} = options;

		if (!serverId) {
			throw new Error("dnSERV server ID is not specified");
		}

		this._serverId = serverId;
		this._statsChannels = statsChannels;
		this._timeZone = timezone || DEFAULT_TIMEZONE;
	}

	public async init() {
		const statsChannels = this._statsChannels;

		const dnGuild = $discordBot.guilds.get(
			this._serverId
		);

		if (!dnGuild) {
			DNServReborn._log("warn", "Server not found");

			return;
		}

		if (statsChannels) {
			const membersChannel = this._findStatChannel(
				dnGuild, statsChannels.members
			);

			const timeChannel = this._findStatChannel(
				dnGuild, statsChannels.time
			);

			const update = 
				() => this._updateStatsChannels(
					dnGuild,
					membersChannel,
					timeChannel
				);

			await update();

			this._pendingInterval = setTimeout(
				async () => {
					await update();

					this._statsInterval = setInterval(
						async () => update(),
						60000
					);
				},
				60000 - (new Date() .getSeconds() * 1000)
			);
		}

		this.handleEvents();
	}

	private _findStatChannel(dnGuild: Guild, id?: string) {
		if (!id) {
			return undefined;
		}

		const channel = dnGuild.channels.get(id);
	
		if (channel === null) {
			throw new Error("Members channel not found");
		} else if (!(channel instanceof VoiceChannel)) {
			throw new Error(
				"Stats channels can only be locked voice channels"
			);
		}

		return channel;
	}

	private async _updateStatsChannels(
		dnGuild: Guild,
		membersChannel?: VoiceChannel,
		timeChannel?: VoiceChannel
	) {

		if (membersChannel) {
			await membersChannel.setName(
				$localizer.formatString(
					"ru-RU",
					MEMBERS_STRING, {
						members: dnGuild.memberCount
					}
				)
			);
		}

		if (timeChannel) {
			const timezone = this._timeZone;

			await timeChannel.setName(
				DateTime.fromMillis(Date.now())
					.setZone(timezone)
					.setLocale("ru-RU")
					.toLocaleString(DateTime.DATETIME_MED)
			);
		}

		return true;
	}

	private async _removeSelfStar(reaction: MessageReaction, user: User) {
		DNServReborn._log("info", reaction, user);

		// Remove self-assigned stars

		const { message } = reaction;

		if (
			message.channel.type !== "text" ||
			message.guild.id !== this._serverId ||
			reaction.emoji.name !== STAR
		) {
			return;
		}

		const messageSender = await getMessageMember(message);

		if (!messageSender) {
			return;
		}

		if (messageSender.id === user.id) {
			await reaction.users.remove(messageSender);
		}
	}

	public async unload() {
		if (!$modLoader.isPendingUnload(this.signature)) {
			throw new Error(
				ErrorMessages.NOT_PENDING_UNLOAD
			);
		}

		if (this._pendingInterval) {
			clearTimeout(this._pendingInterval);
		}

		if (this._statsInterval) {
			clearInterval(this._statsInterval);
		}

		this.unhandleEvents();

		return true;
	}
}

export default DNServReborn;
