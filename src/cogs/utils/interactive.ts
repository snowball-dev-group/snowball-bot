import { Message, MessageReaction, User, TextChannel, GuildMember, DMChannel } from "discord.js";
import { getMessageMember, getMessageMemberOrAuthor, IEmbed } from "@cogs/utils/utils";
import * as Bluebird from "bluebird";
import * as getLogger from "loggy";

const LOG = getLogger("Utils:Interactive");

const ERR_INVALID_PROMISE = "Invalid promise, expected onCancel to be passed";

function yesNo(bool: boolean) {
	return bool ? "Yes" : "No";
}

const enum EMOJI {
	WHITE_CHECK_MARK = "✅",
	RED_CROSS_MARK = "❌"
}

export function createConfirmationMessage(embed: IEmbed, originalMsg: Message) : Bluebird<boolean> {
	let logContext = `(CMS / 0:${originalMsg.id})`;

	return new Bluebird(async (resolve, _reject, onCancel) => {
		let confirmMsg: Message | undefined;

		try {
			confirmMsg = <Message> await originalMsg.channel.send(
				"", {
					embed: <any> embed
				}
			);
		} catch (err) {
			LOG("info", `${logContext} Message sending failure`, err.message);

			return false;
		}

		logContext = `(CMD / 1:${confirmMsg.id})`;

		const author = await getMessageMemberOrAuthor(originalMsg);

		if (!author) {
			throw new Error("Cannot get original message author");
		}

		const isText = confirmMsg.channel.type === "text";

		let canUseMessages = true;
		let canUseReactions = true;

		if (isText) {
			LOG("info", `${logContext} Is text channel, check permissions...`);

			const myPermissions = await getPermissions(confirmMsg);

			if (!myPermissions) {
				throw new Error("Failed to check bot's permissions in the channel");
			}

			canUseReactions = myPermissions.has("ADD_REACTIONS");

			const authorPermissions = await getPermissions(originalMsg);

			if (!authorPermissions) {
				throw new Error("Failed to check author's permissions in the channel");
			}

			canUseMessages = authorPermissions.has("SEND_MESSAGES");
		}

		LOG("info", `${logContext} Can use messages? ${yesNo(canUseMessages)}`);
		LOG("info", `${logContext} Can use reactions? ${yesNo(canUseReactions)}`);

		if (!canUseMessages && !canUseReactions) {
			LOG("warn", `${logContext} Cannot use any of the methods to confirm message`);

			throw new Error("No method to confirm action is found");
		}

		const promises: Array<Bluebird<boolean>> = [];

		const messageConfirmed = messageWaiter2(confirmMsg, author.id);
		const reactionConfirmed = reactionWaiter(confirmMsg, author.id);

		messageConfirmed.then(
			cancel(reactionConfirmed)
		);

		reactionConfirmed.then(
			cancel(messageConfirmed)
		);

		const race = Bluebird.race(promises);

		if (onCancel) { onCancel(() => race.cancel()); }

		race.then(resolve);
	});
}

function cancel<T>(promise: Bluebird<T>) {
	return (val: T) => {
		if (promise.isPending()) {
			promise.cancel();
		}

		return val;
	};
}

async function getPermissions(msg: Message) {
	const member = await getMessageMember(msg);

	if (!member) {
		throw new Error("Cannot find author as a member of the server");
	}

	return member.permissionsIn(msg.channel);
}

// #region Reaction Waiter

function reactionWaiter(confirmationMessage: Message, authorId: string) : Bluebird<boolean> {
	const logContext = `(RWT / ${confirmationMessage.id})`;

	return new Bluebird.Promise(async (resolve, _reject, onCancel) => {
		if (!onCancel) { throw new Error(ERR_INVALID_PROMISE); }

		try {
			LOG("info", `${logContext} Add reactions to message`);

			await confirmationMessage.react(EMOJI.WHITE_CHECK_MARK);
			await confirmationMessage.react(EMOJI.RED_CROSS_MARK);
		} catch (err) {
			return false;
		}

		const reactionCollection = collectReaction(confirmationMessage, authorId);

		onCancel(() => reactionCollection.cancel());

		const res = await reactionCollection;

		resolve(
			res ? res.emoji.name === EMOJI.WHITE_CHECK_MARK : false
		);
	});
}

function collectReaction(confirmationMessage: Message, authorId: string) : Bluebird<MessageReaction | undefined> {
	return new Bluebird((resolve, _reject, onCancel) => {
		if (!onCancel) { throw new Error("Invalid promise, expected onCancel to be passed"); }

		const logContext = `(RCL / ${confirmationMessage.id})`;

			LOG("info", `${logContext} Creating the collector...`);

			const collector = confirmationMessage.createReactionCollector(
				(reaction: MessageReaction, user: User) => {
					LOG("info", `${logContext} Reaction: ${reaction.emoji.name}. User ID: ${user.id}`);

					if (user.id !== authorId) { return false; }

					if (reaction.emoji.name !== "✅" && reaction.emoji.name !== "❌") {
						return false;
					}

					LOG("info", `${logContext} Reaction is accepted and will be collected`);

					return true;
				}, {
					max: 1,
					maxEmojis: 1,
					maxUsers: 1,
					time: 60000
				}
			);

			let isCanceled = false;

			collector.once("end", (collected) => {
				if (isCanceled) { return; }

				LOG("ok", `${logContext} Done - ${collected.size} messages collected`);

				resolve(collected.first());
			});

			LOG("info", `${logContext} Collector created, confirming acknowledgement...`);

			if (!onCancel) { return; }

			onCancel(async () => {
				if (isCanceled) {
					throw new Error("Could not cancel cancelled");
				}

				LOG(`info`, `${logContext} Cancelling collection...`);

				isCanceled = true;

				collector.stop("cancelled using callback");

				confirmationMessage.reactions.remove("✅");
				confirmationMessage.reactions.remove("❌");

				LOG("ok", `${logContext} Collection cancelled`);

				resolve();
			});
	});
}

// #endregion

//#region Message Waiter

function messageWaiter2(confirmationMessage: Message, authorId: string) {
	const logContext = `(MWT / ${confirmationMessage.id})`;

	return new Bluebird<boolean>(async (resolve, _reject, onCancel) => {
		if (!onCancel) { throw new Error(ERR_INVALID_PROMISE); }

		LOG("info", `${logContext} Collect the messages...`);

		const collectectMes	= collectMessage1(confirmationMessage, authorId);

		onCancel(() => collectectMes.cancel());

		const message = await collectectMes;

		resolve(
			message ? messageToBool(message) : false
		);
	});
}

function messageToBool(msg: Message) : boolean {
	return msg.content === "y" ? true : false;
}

function collectMessage1(confirmationMessage: Message, authorId: string) {
	const logContext = `(MCL / ${confirmationMessage.id})`;

	return new Bluebird<Message>((resolve, _reject, onCancel) => {
		if (!onCancel) { throw new Error(ERR_INVALID_PROMISE); }

		LOG("info", `${logContext} Create the collector...`);

		const collector = confirmationMessage.channel.createMessageCollector(
			collectorCallback(authorId)
		);

		let isCanceled = false;

		collector.once("collect", () => {
			LOG("ok", `${logContext} Element collected. Stop collection...`);

			collector.stop("collected");
		});

		collector.once("end", (collected) => {
			if (isCanceled) { return; }

			LOG("ok", `${logContext} Done - ${collected.size} reactions collected`);

			resolve(collected.first());
		});

		onCancel(() => {
			isCanceled = true;

			LOG("info", `${logContext} Cancel collection...`);

			collector.stop("cancelled");

			resolve();

			LOG("ok", `${logContext} Collection canceled`);
		});
	});
}

function collectorCallback(authorId: string) : (msg: Message) => boolean {
	// load languages possibly

	const logContext = `(MCB / ${authorId})`;

	return (msg: Message) => {
		LOG("info", `${logContext} Message ID: ${msg.id}. Author ID: ${msg.author.id}`);

		if (msg.author.id !== authorId) { return false; }

		const res = msg.content === "y" || msg.content === "n";

		if (res) {
			LOG("info", `${logContext} Accept message into collection`);
		}

		return res;
	};
}

//#endregion

interface ICustomConfirmationRules {
	// default predefine
	max: number; maxEmojis: number; maxUsers: number;

	variants: string[]; time: number;

	whoCanReact?: Array<User | GuildMember>;
}

export async function createCustomizeConfirmationMessage(embed, channel: TextChannel, rules: ICustomConfirmationRules) {
	const _confirmationMessage = <Message> await channel.send("", { embed });

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
