import { Message, MessageReaction, User, TextChannel, GuildMember, DMChannel } from "discord.js";

export async function createConfirmationMessage(embed, originalMsg: Message): Promise<boolean> {
	let _confirmationMessage: Message | undefined = undefined;
	try {
		_confirmationMessage = await originalMsg.channel.send("", {
			embed
		}) as Message;
	} catch (err) {
		return false;
	}

	if (!_confirmationMessage) {
		return false;
	}

	try {
		await _confirmationMessage.react("✅");
		await _confirmationMessage.react("❌");
	} catch (err) {
		return false;
	}

	let reaction: MessageReaction | undefined = undefined;
	try {
		reaction = (await _confirmationMessage.awaitReactions((reaction: MessageReaction, user: User) => {
			if (user.id !== originalMsg.author.id) { return false; }
			if (reaction.emoji.name !== "✅" && reaction.emoji.name !== "❌") {
				return false;
			}
			return true;
		}, {
				maxEmojis: 1,
				maxUsers: 1,
				max: 1,
				errors: ["time"],
				time: 60000
			})).first();
	} catch (err) {
		reaction = undefined;
	}

	_confirmationMessage.delete();

	if (!reaction || reaction.emoji.name !== "✅") {
		return false;
	}

	return true;
}

interface ICustomConfirmationRules {
	// default predefine
	max: number; maxEmojis: number; maxUsers: number;

	variants: string[]; time: number;

	whoCanReact?: Array<User | GuildMember>;
}

export async function createCustomizeConfirmationMessage(embed, channel: TextChannel, rules: ICustomConfirmationRules) {
	const _confirmationMessage: Message = await channel.send("", {
		embed
	}) as Message;

	try {
		for (let i = 0, rl = rules.variants.length; i < rl; i++) {
			await _confirmationMessage.react(rules.variants[i]);
		}
	} catch (err) {
		_confirmationMessage.delete();
		throw new Error("Cannot react!");
	}

	return _confirmationMessage.awaitReactions((reaction: MessageReaction, user: User) => {
		if (!rules.variants.includes(reaction.emoji.name)) { return false; }
		if (rules.whoCanReact) {
			return !!rules.whoCanReact.find(u => u.id === user.id);
		}
		return true;
	});
}

interface ICustomWaitMessageOptions {
	variants: string[]; time: number;
	max?: number; maxMatches: number; authors: string[];
}

export async function waitForMessages(channel: TextChannel | DMChannel, rules: ICustomWaitMessageOptions) {
	return channel.awaitMessages(
		(msg: Message) => {
			return rules.authors.includes(msg.author.id) && rules.variants.includes(msg.content);
		}, {
			errors: ["time"],
			maxProcessed: rules.maxMatches,
			time: rules.time,
			max: rules.max
		}
	);
}
