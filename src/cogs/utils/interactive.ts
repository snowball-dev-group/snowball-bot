import { Message, MessageReaction, User, TextChannel, GuildMember, DMChannel } from "discord.js";
import { getMessageMember, getMessageMemberOrAuthor } from "@cogs/utils/utils";

export async function createConfirmationMessage(embed, originalMsg: Message): Promise<boolean> {
	let confirmMsg: Message | undefined = undefined;

	try {
		confirmMsg = <Message> await originalMsg.channel.send("", { embed });
	} catch (err) {
		return false;
	}

	const author = await getMessageMemberOrAuthor(originalMsg);

	if (!author) {
		throw new Error("Can't get original message author");
	}

	const isText = confirmMsg.channel.type === "text";

	let canUseMessages = true;
	let canUseReactions = true;

	if (isText) {
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
	}

	if (!canUseMessages && !canUseReactions) {
		// what we supposed to do???
		return false;
	}

	let messageWaiterCancelFunc: () => void | undefined;
	let messageWaiterPromise: Promise<boolean> | undefined;

	if (canUseMessages) {
		const result = await createMessageWaiter(
			confirmMsg,
			author.id
		);

		messageWaiterCancelFunc = result.cancel;
		messageWaiterPromise = result.promise;
	}

	const promises: Array<Promise<boolean>> = [];

	if (messageWaiterPromise) { promises.push(messageWaiterPromise); }

	if (canUseReactions) {
		const reactionWaiterPromise = reactionWaiter(confirmMsg, author.id, (cancel) => {
			if (!messageWaiterPromise) { return; }

			messageWaiterPromise.then(val => {
				cancel();

				return val;
			});
		});

		reactionWaiterPromise.then((val) => {
			if (messageWaiterCancelFunc) {
				messageWaiterCancelFunc();
			}

			return val;
		});

		promises.push(
			reactionWaiterPromise
		);
	}

	if (promises.length === 0) {
		throw new Error("No methods available for confirmation");
	}

	return Promise.race(promises);
}

type CancellationCallback = (cancel: () => void) => void;

async function reactionWaiter(confirmationMessage: Message, authorId: string, cancelCb: CancellationCallback) {
	// set reactions
	try {
		await confirmationMessage.react("✅");
		await confirmationMessage.react("❌");
	} catch (err) {
		return false;
	}

	// collect
	const reaction = await collectReaction(confirmationMessage, authorId, cancelCb);

	// check
	return reaction ? reaction.emoji.name === "✅" : false;
}

function collectReaction(confirmationMessage: Message, authorId: string, cancelCb: CancellationCallback) : Promise<MessageReaction | undefined> {
	return new Promise(
		(resolve) => {
			const collector = confirmationMessage.createReactionCollector(
				(reaction: MessageReaction, user: User) => {
					if (user.id !== authorId) { return false; }

					if (reaction.emoji.name !== "✅" && reaction.emoji.name !== "❌") {
						return false;
					}

					return true;
				}, {
					max: 1,
					maxEmojis: 1,
					maxUsers: 1,
					time: 60000
				}
			);

			let isCanceled = false;

			cancelCb(async () => {
				if (isCanceled) {
					throw new Error("Could not cancel cancelled");
				}

				isCanceled = true;

				collector.stop("cancelled using callback");

				confirmationMessage.reactions.remove("✅");
				confirmationMessage.reactions.remove("❌");

				resolve();
			});

			collector.once("end", (collected) => {
				if (isCanceled) { return; }

				resolve(collected.first());
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
	return new Promise<IMessageWaiterInitResult>((resolve) => {
		const promise = messageWaiter(confirmationMessage, authorId, (cancel) => {
			resolve({ promise, cancel });
		});
	});
}

async function messageWaiter(confirmationMessage: Message, authorId: string, cancelCb: CancellationCallback) {
	const message = await collectMessage(confirmationMessage, authorId, cancelCb);

	return message ? message.content === "y" : false;
}

function collectMessage(confirmationMessage: Message, authorId: string, cancelCb: CancellationCallback) : Promise<Message | undefined> {
	return new Promise(
		(resolve) => {
			const collector = confirmationMessage.channel.createMessageCollector(
				(msg: Message) => msg.author.id === authorId && (msg.content === "y" || msg.content === "n"), {
					time: 60000
				}
			);

			let isCanceled = false;

			cancelCb(() => {
				isCanceled = true;

				collector.stop("cancelled");

				resolve();
			});

			collector.on("end", (collection) => {
				if (isCanceled) { return; }

				resolve(collection.first());
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
