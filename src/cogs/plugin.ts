import { Message, Channel, Emoji, Guild, User, GuildMember, Snowflake, Collection, MessageReaction, Role } from "discord.js";

export interface IEventsMap <T> {
	/**
	 * Emitted whenever a channel is created.
	 */
	channelCreate?: ((channel: Channel) => T) | Array<((channel: Channel) => T)>;
	/**
	 * Emitted whenever a channel is deleted.
	 */
	channelDelete?: ((channel: Channel) => T) | Array<((channel: Channel) => T)>;
	/**
	 * Emitted whenever the pins of a channel are updated. Due to the nature of the WebSocket event, not much information can be provided easily here - you need to manually check the pins yourself.
	 */
	channelPinsUpdate?: ((channel: Channel, time: Date) => T) | Array<((channel: Channel, time: Date) => T)>;
	/**
	 * Emitted whenever a channel is updated - e.g. name change, topic change
	 */
	channelUpdate?: ((oldChannel: Channel, newChannel: Channel) => T) | Array<((oldChannel: Channel, newChannel: Channel) => T)>;
	/**
	 * Emitted when the client's WebSocket disconnects and will no longer attempt to reconnect.
	 */
	disconnect?: ((closeEvent) => T) | Array<((closeEvent) => T)>;
	/**
	 * Emitted whenever a custom emoji is created in a guild.
	 * 
	 */
	emojiCreate?: ((emoji: Emoji) => T) | Array<((emoji: Emoji) => T)>;
	/**
	 * Emitted whenever a custom guild emoji is deleted.
	 */
	emojiDelete?: ((emoji: Emoji) => T) | Array<((emoji: Emoji) => T)>;
	/**
	 * Emitted whenever a custom guild emoji is updated.
	 */
	emojiUpdate?: ((oldEmoji: Emoji, newEmoji: Emoji) => T) | Array<((oldEmoji: Emoji, newEmoji: Emoji) => T)>;
	/**
	 * Emitted whenever a member is banned from a guild.
	 */
	guildBanAdd?: ((guild: Guild, user: User) => T) | Array<((guild: Guild, user: User) => T)>;
	/**
	 * Emitted whenever a member is unbanned from a guild.
	 */
	guildBanRemove?: ((guild: Guild, user: User) => T) | Array<((guild: Guild, user: User) => T)>;
	/**
	 * Emitted whenever the client joins a guild.
	 */
	guildCreate?: ((guild: Guild) => T) | Array<((guild: Guild) => T)>;
	/**
	 * Emitted whenever a guild is deleted/left.
	 */
	guildDelete?: ((guild: Guild) => T) | Array<((guild: Guild) => T)>;
	/**
	 * Emitted whenever a user joins a guild.
	 */
	guildMemberAdd?: ((member: GuildMember) => T) | Array<((member: GuildMember) => T)>;
	/**
	 * Emitted whenever a member becomes available in a large guild.
	 */
	guildMemberAvailable?: ((member: GuildMember) => T) | Array<((member: GuildMember) => T)>;
	/**
	 * Emitted whenever a member leaves a guild, or is kicked.
	 */
	guildMemberRemove?: ((member: GuildMember) => T) | Array<((member: GuildMember) => T)>;
	/**
	 * Emitted whenever a chunk of guild members is received (all members come from the same guild).
	 */
	guildMembersChunk?: ((members: Collection<Snowflake, GuildMember>, guild: Guild) => T) | Array<((members: Collection<Snowflake, GuildMember>, guild: Guild) => T)>;
	/**
	 * Emitted once a guild member starts/stops speaking.
	 */
	guildMemberSpeaking?: ((member: GuildMember, speaking: boolean) => T) | Array<((member: GuildMember, speaking: boolean) => T)>;
	/**
	 * Emitted whenever a guild member changes - i.e. new role, removed role, nickname.
	 */
	guildMemberUpdate?: ((oldMember: GuildMember, newMember: GuildMember) => T) | Array<((oldMember: GuildMember, newMember: GuildMember) => T)>;
	/**
	 * Emitted whenever a guild becomes unavailable, likely due to a server outage.
	 */
	guildUnavailable?: ((guild: Guild) => T) | Array<((guild: Guild) => T)>;
	/**
	 * Emitted whenever a guild is updated - e.g. name change.
	 */
	guildUpdate?: ((oldGuild: Guild, newGuild: Guild) => T) | Array<((oldGuild: Guild, newGuild: Guild) => T)>;
	/**
	 * Emitted whenever a message is created.
	 */
	message?: ((message: Message) => T) | Array<((message: Message) => T)>;
	/**
	 * Emitted whenever a message is deleted.
	 */
	messageDelete?: ((message: Message) => T) | Array<((message: Message) => T)>;
	/**
	 * Emitted whenever messages are deleted in bulk.
	 */
	messageDeleteBulk?: ((messages: Collection<Snowflake, Message>) => T) | Array<((messages: Collection<Snowflake, Message>) => T)>;
	/**
	 * Emitted whenever a reaction is added to a message.
	 */
	messageReactionAdd?: ((messageReaction: MessageReaction, user: User) => T) | Array<((messageReaction: MessageReaction, user: User) => T)>;
	/**
	 * Emitted whenever a reaction is removed from a message.
	 */
	messageReactionRemove?: ((messageReaction: MessageReaction, user: User) => T) | Array<((messageReaction: MessageReaction, user: User) => T)>;
	/**
	 * Emitted whenever all reactions are removed from a message.
	 */
	messageReactionRemoveAll?: ((message: Message) => T) | Array<((message: Message) => T)>;
	/**
	 * Emitted whenever a message is updated - e.g. embed or content change.
	 */
	messageUpdate?: ((oldMessage: Message, newMessage: Message) => T) | Array<((oldMessage: Message, newMessage: Message) => T)>;
	/**
	 * Emitted whenever a guild member's presence changes, or they change one of their details.
	 */
	presenceUpdate?: ((oldMember: GuildMember, newMember: GuildMember) => T) | Array<((oldMember: GuildMember, newMember: GuildMember) => T)>;
	/**
	 * Emitted whenever the client tries to reconnect to the WebSocket.
	 */
	reconnecting?: (() => T) | Array<(() => T)>;
	/**
	 * Emitted whenever a WebSocket resumes.
	 */
	resume?: ((replayed: number) => T) | Array<((replayed: number) => T)>;
	/**
	 * Emitted whenever a role is created.
	 */
	roleCreate?: ((role: Role) => T) | Array<((role: Role) => T)>;
	/**
	 * Emitted whenever a guild role is deleted.
	 */
	roleDelete?: ((role: Role) => T) | Array<((role: Role) => T)>;
	/**
	 * Emitted whenever a guild role is updated.
	 */
	roleUpdate?: ((oldRole: Role, newRole: Role) => T) | Array<((oldRole: Role, newRole: Role) => T)>;
	/**
	 * Emitted whenever a user starts typing in a channel.
	 */
	typingStart?: ((channel: Channel, user: User) => T) | Array<((channel: Channel, user: User) => T)>;
	/**
	 * Emitted whenever a user stops typing in a channel.
	 */
	typingStop?: ((channel: Channel, user: User) => T) | Array<((channel: Channel, user: User) => T)>;
	/**
	 * Emitted whenever a user's details (e.g. username) are changed.
	 */
	userUpdate?: ((oldUser: User, newUser: User) => T) | Array<((oldUser: User, newUser: User) => T)>;
	/**
	 * Emitted whenever a user changes voice state - e.g. joins/leaves a channel, mutes/unmutes.
	 */
	voiceStateUpdate?: ((oldMember: GuildMember, newMember: GuildMember) => T) | Array<((oldMember: GuildMember, newMember: GuildMember) => T)>;
}

export class Plugin {
	private readonly _eventsMap: IEventsMap<any>;

	constructor(events: IEventsMap<any>, dontAutoHandle = false) {
		this._eventsMap = events;
		if (!dontAutoHandle) {
			this.handleEvents();
		}
	}

	public handleEvents() {
		const keys = Object.keys(this._eventsMap);

		for (let i = 0, l = keys.length; i < l; i++) {
			const key = keys[i];
			const val = this._eventsMap[key];

			if (!Array.isArray(val)) {
				$discordBot.on(key, val);
				continue;
			}

			for (const handler of val) {
				$discordBot.on(key, handler);
			}
		}
	}

	unhandleEvents() {
		const keys = Object.keys(this._eventsMap);

		for (let i = 0, l = keys.length; i < l; i++) {
			const key = keys[i];
			const val = this._eventsMap[key];

			if (!Array.isArray(val)) {
				$discordBot.removeListener(key, val);
				continue;
				
			}

			for (const handler of val) {
				$discordBot.removeListener(key, handler);
			}
		}
	}
}
