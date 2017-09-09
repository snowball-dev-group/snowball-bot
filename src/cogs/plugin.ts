import { Message, Channel, Emoji, Guild, User, GuildMember, Snowflake, Collection, MessageReaction, Role } from "discord.js";

export interface IEventsMap {
	/**
	 * Emitted whenever a channel is created.
	 */
	channelCreate?: ((channel:Channel) => any)|Array<((channel:Channel) => any)>;
	/**
	 * Emitted whenever a channel is deleted.
	 */
	channelDelete?: ((channel:Channel) => any)|Array<((channel:Channel) => any)>;
	/**
	 * Emitted whenever the pins of a channel are updated. Due to the nature of the WebSocket event, not much information can be provided easily here - you need to manually check the pins yourself.
	 */
	channelPinsUpdate?: ((channel:Channel, time:Date) => any)|Array<((channel:Channel, time:Date) => any)>;
	/**
	 * Emitted whenever a channel is updated - e.g. name change, topic change
	 */
	channelUpdate?: ((oldChannel:Channel, newChannel:Channel) => any)|Array<((oldChannel:Channel, newChannel:Channel) => any)>;
	/**
	 * Emitted when the client's WebSocket disconnects and will no longer attempt to reconnect.
	 */
	disconnect?: ((closeEvent) => any)|Array<((closeEvent) => any)>;
	/**
	 * Emitted whenever a custom emoji is created in a guild.
	 * 
	 */
	emojiCreate?: ((emoji:Emoji) => any)|Array<((emoji:Emoji) => any)>;
	/**
	 * Emitted whenever a custom guild emoji is deleted.
	 */
	emojiDelete?: ((emoji:Emoji) => any)|Array<((emoji:Emoji) => any)>;
	/**
	 * Emitted whenever a custom guild emoji is updated.
	 */
	emojiUpdate?: ((oldEmoji:Emoji, newEmoji:Emoji) => any)|Array<((oldEmoji:Emoji, newEmoji:Emoji) => any)>;
	/**
	 * Emitted whenever a member is banned from a guild.
	 */
	guildBanAdd?: ((guild:Guild, user:User) => any)|Array<((guild:Guild, user:User) => any)>;
	/**
	 * Emitted whenever a member is unbanned from a guild.
	 */
	guildBanRemove?: ((guild:Guild, user:User) => any)|Array<((guild:Guild, user:User) => any)>;
	/**
	 * Emitted whenever the client joins a guild.
	 */
	guildCreate?: ((guild:Guild) => any)|Array<((guild:Guild) => any)>;
	/**
	 * Emitted whenever a guild is deleted/left.
	 */
	guildDelete?: ((guild:Guild) => any)|Array<((guild:Guild) => any)>;
	/**
	 * Emitted whenever a user joins a guild.
	 */
	guildMemberAdd?: ((member:GuildMember) => any)|Array<((member:GuildMember) => any)>;
	/**
	 * Emitted whenever a member becomes available in a large guild.
	 */
	guildMemberAvailable?: ((member:GuildMember) => any)|Array<((member:GuildMember) => any)>;
	/**
	 * Emitted whenever a member leaves a guild, or is kicked.
	 */
	guildMemberRemove?: ((member:GuildMember) => any)|Array<((member:GuildMember) => any)>;
	/**
	 * Emitted whenever a chunk of guild members is received (all members come from the same guild).
	 */
	guildMembersChunk?: ((members:Collection<Snowflake, GuildMember>, guild:Guild) => any)|Array<((members:Collection<Snowflake, GuildMember>, guild:Guild) => any)>;
	/**
	 * Emitted once a guild member starts/stops speaking.
	 */
	guildMemberSpeaking?: ((member:GuildMember, speaking:boolean) => any)|Array<((member:GuildMember, speaking:boolean) => any)>;
	/**
	 * Emitted whenever a guild member changes - i.e. new role, removed role, nickname.
	 */
	guildMemberUpdate?: ((oldMember:GuildMember, newMember:GuildMember) => any)|Array<((oldMember:GuildMember, newMember:GuildMember) => any)>;
	/**
	 * Emitted whenever a guild becomes unavailable, likely due to a server outage.
	 */
	guildUnavailable?: ((guild:Guild) => any)|Array<((guild:Guild) => any)>;
	/**
	 * Emitted whenever a guild is updated - e.g. name change.
	 */
	guildUpdate?: ((oldGuild:Guild, newGuild:Guild) => any)|Array<((oldGuild:Guild, newGuild:Guild) => any)>;
	/**
	 * Emitted whenever a message is created.
	 */
	message?: ((message:Message) => any)|Array<((message:Message) => any)>;
	/**
	 * Emitted whenever a message is deleted.
	 */
	messageDelete?: ((message:Message) => any)|Array<((message:Message) => any)>;
	/**
	 * Emitted whenever messages are deleted in bulk.
	 */
	messageDeleteBulk?: ((messages:Collection<Snowflake, Message>) => any)|Array<((messages:Collection<Snowflake, Message>) => any)>;
	/**
	 * Emitted whenever a reaction is added to a message.
	 */
	messageReactionAdd?: ((messageReaction:MessageReaction, user:User) => any)|Array<((messageReaction:MessageReaction, user:User) => any)>;
	/**
	 * Emitted whenever a reaction is removed from a message.
	 */
	messageReactionRemove?: ((messageReaction:MessageReaction, user:User) => any)|Array<((messageReaction:MessageReaction, user:User) => any)>;
	/**
	 * Emitted whenever all reactions are removed from a message.
	 */
	messageReactionRemoveAll?: ((message:Message) => any)|Array<((message:Message) => any)>;
	/**
	 * Emitted whenever a message is updated - e.g. embed or content change.
	 */
	messageUpdate?: ((oldMessage:Message, newMessage:Message) => any)|Array<((oldMessage:Message, newMessage:Message) => any)>;
	/**
	 * Emitted whenever a guild member's presence changes, or they change one of their details.
	 */
	presenceUpdate?: ((oldMember:GuildMember, newMember:GuildMember) => any)|Array<((oldMember:GuildMember, newMember:GuildMember) => any)>;
	/**
	 * Emitted whenever the client tries to reconnect to the WebSocket.
	 */
	reconnecting?: (() => any)|Array<(() => any)>;
	/**
	 * Emitted whenever a WebSocket resumes.
	 */
	resume?: ((replayed:number) => any)|Array<((replayed:number) => any)>;
	/**
	 * Emitted whenever a role is created.
	 */
	roleCreate?: ((role:Role) => any)|Array<((role:Role) => any)>;
	/**
	 * Emitted whenever a guild role is deleted.
	 */
	roleDelete?: ((role:Role) => any)|Array<((role:Role) => any)>;
	/**
	 * Emitted whenever a guild role is updated.
	 */
	roleUpdate?: ((oldRole:Role, newRole:Role) => any)|Array<((oldRole:Role, newRole:Role) => any)>;
	/**
	 * Emitted whenever a user starts typing in a channel.
	 */
	typingStart?: ((channel:Channel, user:User) => any)|Array<((channel:Channel, user:User) => any)>;
	/**
	 * Emitted whenever a user stops typing in a channel.
	 */
	typingStop?: ((channel:Channel, user:User) => any)|Array<((channel:Channel, user:User) => any)>;
	/**
	 * Emitted whenever a user's details (e.g. username) are changed.
	 */
	userUpdate?: ((oldUser:User, newUser:User) => any)|Array<((oldUser:User, newUser:User) => any)>;
	/**
	 * Emitted whenever a user changes voice state - e.g. joins/leaves a channel, mutes/unmutes.
	 */
	voiceStateUpdate?: ((oldMember:GuildMember, newMember:GuildMember) => any)|Array<((oldMember:GuildMember, newMember:GuildMember) => any)>;
}

export class Plugin {
	private eventsMap:IEventsMap;

	constructor(events: IEventsMap, dontAutoHandle = false) {
		this.eventsMap = events;
		if(!dontAutoHandle) {
			this.handleEvents();
		}
	}

	handleEvents() {
		for(let key in this.eventsMap) {
			let val = this.eventsMap[key];
			if(Array.isArray(val)) {
				for(let handler of val) {
					discordBot.on(key, handler);
				}
			} else {
				discordBot.on(key, val);
			}
		}
	}

	unhandleEvents() {
		for(let key in this.eventsMap) {
			let val = this.eventsMap[key];
			if(Array.isArray(val)) {
				for(let handler of val) {
					discordBot.removeListener(key, handler);
				}
			} else {
				discordBot.removeListener(key, val);
			}
		}
	}
}