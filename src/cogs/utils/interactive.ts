import { Message, MessageReaction, User, TextChannel, GuildMember, DMChannel } from "discord.js";
import { getMessageMember, getMessageMemberOrAuthor } from "@cogs/utils/utils";
import * as getLogger from "loggy";

const LOG = getLogger("Utils:Interactive");

function yesNo(bool: boolean) {
	return bool ? "Yes" : "No";
}

export async function createConfirmationMessage(embed, originalMsg: Message): Promise<boolean> {
	let confirmMsg: Message | undefined = undefined;

	try {
		confirmMsg = <Message> await originalMsg.channel.send("", { embed });
	} catch (err) {
		return false;
	}

	const logContext = `(CFM / ${confirmMsg.id})`;

	const author = await getMessageMemberOrAuthor(originalMsg);

	if (!author) {
		throw new Error("Can't get original message author");
	}

	const isText = confirmMsg.channel.type === "text";

	let canUseMessages = true;
	let canUseReactions = true;

	if (isText) {
		LOG("info", `${logContext} Is text channel, checking permissions...`);

		const myPermissions = await (async () => {
			const bot = await getMessageMember(confirmMsg);
	
			if (!bot) {
				throw new Error("Could not find bot as a member of the server");
			}
	
			return bot.permissionsIn(confirmMsg.channel);
		})();

		const authorPermissions = await (async () => {
			const member = author instanceof GuildMember ? author : await getMessageMember(originalMsg);

			if (!member) {
				throw new Error("Could not find author as a member of the server");
			}
	
			return member.permissionsIn(confirmMsg.channel);
		})();

		if (!myPermissions || !authorPermissions) {
			throw new Error("Could not check some permissions");
		}

		canUseMessages = authorPermissions.has("SEND_MESSAGES");
		canUseReactions = myPermissions.has("ADD_REACTIONS");

		LOG("info", `${logContext} Can use reactions? ${yesNo(canUseReactions)}`);
		LOG("info", `${logContext} Can use messages? ${yesNo(canUseMessages)}`);
	}

	if (!canUseMessages && !canUseReactions) {
		LOG("warn", `${logContext} Cannot use any actions, returning false`);

		// what we supposed to do???

		return false;
	}

	let messageWaiterCancelFunc: () => void | undefined;
	let messageWaiterPromise: Promise<boolean> | undefined;

	if (canUseMessages) {
		LOG("info", `${logContext} Creating messages waiter...`);

		const result = await createMessageWaiter(
			confirmMsg,
			author.id
		);

		messageWaiterCancelFunc = result.cancel;
		messageWaiterPromise = result.promise;

		LOG("ok", `${logContext} Created messages waiter!`);
	}

	const promises: Array<Promise<boolean>> = [];

	if (messageWaiterPromise) { promises.push(messageWaiterPromise); }

	if (canUseReactions) {
		LOG("info", `${logContext} Creating reactions waiter...`);

		const reactionWaiterPromise = reactionWaiter(confirmMsg, author.id, (cancel) => {
			if (!messageWaiterPromise) { return; }

			messageWaiterPromise.then(val => {
				cancel();

				return val;
			});
		});

		LOG("info", `${logContext} Initialized reaction waiter promise`);

		reactionWaiterPromise.then((val) => {
			if (messageWaiterCancelFunc) {
				LOG("info", `${logContext} We're faster than messages waiter, cancelling it...`);
				messageWaiterCancelFunc();
			}

			return val;
		});

		promises.push(
			reactionWaiterPromise
		);

		LOG("ok", `${logContext} Created reactions waiter`);
	}

	if (promises.length === 0) {
		throw new Error("No methods available for confirmation");
	}

	LOG("info", `${logContext} Race starting`);

	return Promise.race(promises);
}

type CancellationCallback = (cancel: () => void) => void;

async function reactionWaiter(confirmationMessage: Message, authorId: string, cancelCb: CancellationCallback) {
	const logContext = `(RWT / ${confirmationMessage.id})`;

	// set reactions
	try {
		LOG("info", "Using reactions on the message...");

		await confirmationMessage.react("✅");
		await confirmationMessage.react("❌");
	} catch (err) {
		return false;
	}

	LOG("ok", `${logContext} Reactions set w/o errors, collecting reaction...`);

	// collect
	const reaction = await collectReaction(confirmationMessage, authorId, cancelCb);

	LOG("info", `${logContext} Collection done, the result is ${reaction ? "reaction" : "empty"}`);

	// check
	return reaction ? reaction.emoji.name === "✅" : false;
}

function collectReaction(confirmationMessage: Message, authorId: string, cancelCb: CancellationCallback) : Promise<MessageReaction | undefined> {
	return new Promise(
		(resolve) => {
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

				LOG("ok", `${logContext} Collection complete`);

				resolve(collected.first());
			});

			LOG("info", `${logContext} Collector created, confirming acknowledgement...`);

			cancelCb(async () => {
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
		}
	);
}

//#region Message Waiter

interface IMessageWaiterInitResult {
	cancel(): void;
	promise: Promise<boolean>;
}

function createMessageWaiter(confirmationMessage: Message, authorId: string) {
	const logContext = `(CMW / ${confirmationMessage.id})`;

	return new Promise<IMessageWaiterInitResult>((resolve) => {
		let promise;

		LOG("info", `${logContext} Creating the waiter, resolving on acknowledge`);

		promise = messageWaiter(confirmationMessage, authorId, (cancel) => {
			LOG("ok", `${logContext} Acknowledged. Waiter is ready`);

			resolve({ promise, cancel });
		});
	});
}

async function messageWaiter(confirmationMessage: Message, authorId: string, cancelCb: CancellationCallback) {
	const logContext = `(MWT / ${confirmationMessage.id})`;

	LOG("info", `${logContext} Collecting the messages`);

	const message = await collectMessage(confirmationMessage, authorId, cancelCb);

	LOG("ok", `${logContext} The collection is done. The result is ${message ? message.content : "nothing"}`);

	return message ? message.content === "y" : false;
}

function collectMessage(confirmationMessage: Message, authorId: string, cancelCb: CancellationCallback) : Promise<Message | undefined> {
	const logContext = `(MCL / ${confirmationMessage.id})`;

	return new Promise(
		(resolve) => {
			LOG("info", `${logContext} Creating the collector...`);

			const collector = confirmationMessage.channel.createMessageCollector(
				(msg: Message) => {
					LOG("info_trace", `${logContext} Message ID ${msg.id}. Author ID: ${msg.author.id}`);

					if (msg.author.id !== authorId) { return false; }

					const res = msg.content === "y" || msg.content === "n";

					if (res) {
						LOG("info_trace", `${logContext} Message is accepted and will be collected`);
					}

					return res;
				}, {
					time: 60000
				}
			);

			let isCanceled = false;

			collector.once("collect", (...args: any[]) => {
				LOG("ok", `${logContext} Collected element`, args);
				collector.stop("collected");
			});

			collector.on("end", (collection) => {
				if (isCanceled) { return; }

				LOG("ok", `${logContext} Collection complete`);

				resolve(collection.first());
			});

			LOG("info", `${logContext} Collector creating, confirming acknowledgement...`);

			cancelCb(() => {
				isCanceled = true;

				LOG("info", `${logContext} Cancelling collection...`);

				collector.stop("cancelled");

				resolve();

				LOG("ok", `${logContext} Collecting cancelled`);
			});
		}
	);
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
