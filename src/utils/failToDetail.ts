import { DMChannel, GroupDMChannel, Guild, GuildMember, Message, TextChannel, User } from "discord.js";

type Extra = { [key: string]: any };

export function messageToExtra(msg: Message, extra?: Extra) {
    return {
		...extra,
        guild: msg.guild ? guildToExtra(msg.guild) : undefined,
        channel: channelToExtra(msg.channel),
        user: userToExtra(msg.author),
        msgContent: msg.content,
        msgId: msg.id
    };
}

export function guildToExtra(guild: Guild, extra?: Extra) {
	return {
		...extra,
		guildId: guild.id,
		guildName: guild.name
	};
}

export function channelToExtra(channel: TextChannel | DMChannel | GroupDMChannel, extra?: Extra) {
	return {
		...extra,
		channelName: channel instanceof TextChannel ? channel.name : undefined,
		channelId: channel.id,
		channelType: channel.type
	};
}

export function userToExtra(user: User, extra?: Extra) {
	return {
		...extra,
		username: user.tag,
		userId: user.id,
		bot: user.bot
	};
}

export function memberToExtra(guild: GuildMember, extra?: Extra) {
	return {
		...extra,
		memberNick: guild.nickname,
		memberJoinedAt: guild.joinedTimestamp
	};
}
