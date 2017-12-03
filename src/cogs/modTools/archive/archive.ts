import { messageToExtra } from "../../utils/failToDetail";
import { IHashMap } from "../../../types/Interfaces";
import { ISimpleCmdParseResult, replaceAll, simpleCmdParse } from "../../utils/text";
import { IModule } from "../../../types/ModuleLoader";
import { Plugin } from "../../plugin";
import { Message, Guild, SnowflakeUtil, Attachment, TextChannel, User } from "discord.js";
import { EmbedType, getLogger, IEmbedOptionsField, resolveGuildChannel, resolveGuildMember, IEmbed } from "../../utils/utils";
import { getDB } from "../../utils/db";
import { generateLocalizedEmbed, localizeForUser } from "../../utils/ez-i18n";
import { ArchiveDBController, convertToDBMessage, IDBMessage, IEmulatedContents } from "./dbController";
import { getPreferenceValue } from "../../utils/guildPrefs";

const PREFIX = "!archive";
const MSG_PREFIX = "!message";
const POSSIBLE_TARGETS = ["user", "channel", "guild"];
// targetting:
//  user & resolvableUser
//  guild & resolvableUser
//  channel & resolvableChannel & resolvableUser?
const SNOWFLAKE_REGEXP = /^[0-9]{18}$/;
const TARGETTING = Object.freeze({
	RESOLVABLE_USER: {
		MENTION: /^<@!?([0-9]{18})>$/,
	},
	RESOLVABLE_CHANNEL: {
		MENTION: /^<#([0-9]{18})>$/
	}
});

const DEFAULT_LENGTH = 50; // lines per file
const MESSAGES_LIMIT = 1000;

interface IMessagesToDBTestOptions {
	banned?: {
		authors?: string[];
		channels?: string[];
		guilds?: string[];
	};
	bots: boolean;
}

class ModToolsArchive extends Plugin implements IModule {
	public get signature() {
		return "snowball.modtools.archive";
	}

	log = getLogger("MessagesToDBTest");
	db = getDB();
	options: IMessagesToDBTestOptions;
	controller: ArchiveDBController;

	constructor(options: IMessagesToDBTestOptions) {
		super({
			"message": (msg: Message) => this.onMessage(msg)
		}, true);
		this.options = options || {};
		this.log("info", "The settings are:", options);
	}

	async onMessage(msg: Message) {
		if(this.options.bots !== undefined && !this.options.bots && msg.author.bot) { return; }
		if(!!this.options.banned) {
			if(!!this.options.banned.authors && this.options.banned.authors.includes(msg.author.id)) {
				return;
			} else if(!!this.options.banned.channels && this.options.banned.channels.includes(msg.channel.id)) {
				return;
			} else if(!!this.options.banned.guilds && !!msg.guild && this.options.banned.guilds.includes(msg.guild.id)) {
				return;
			}
		}
		try {
			await this.recordMessage(msg);
		} catch(err) {
			$snowball.captureException(err, { extra: messageToExtra(msg) });
			this.log("err", "Failed to push message", err);
		}
		try {
			await this.handleCommand(msg);
		} catch(err) {
			$snowball.captureException(err, { extra: messageToExtra(msg) });
			this.log("err", "Handling commands failure", err);
		}
	}

	async handleCommand(msg: Message) {
		if(!msg.content.startsWith(PREFIX) && !msg.content.startsWith(MSG_PREFIX)) {
			return;
		}

		if((await getPreferenceValue(msg.guild, "features:archive:enabled", true)) === false) {
			this.log("info", `Access to the feature archive denied in guild ${msg.guild.id} (requested-in: ${msg.id})`);
			return;
		}

		const parsed = simpleCmdParse(msg.content);

		switch(parsed.command) {
			case PREFIX: return msg.member.permissions.has("MANAGE_MESSAGES") && await this.subcmd_archive(msg, parsed);
			case MSG_PREFIX: return await this.subcmd_message(msg, parsed);
		}
	}

	async subcmd_message(msg: Message, parsed: ISimpleCmdParseResult) {
		const msgId = parsed.subCommand;
		if(msg.content === PREFIX || !msgId) {
			return await msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "ARCHIVE_MESSAGE_HELP",
					formatOptions: {
						prefix: MSG_PREFIX
					}
				})
			});
		}

		if(!SNOWFLAKE_REGEXP.test(msgId)) {
			return await msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "ARCHIVE_MESSAGE_INVALID_ID")
			});
		}

		const message = await this.controller.getMessage(msgId);

		if(!message) {
			return await msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "ARCHIVE_MESSAGE_NOTFOUND")
			});
		}

		if(message.guildId !== msg.guild.id) {
			return;
		}

		const channel = await this.resolveGuildChannel(message.channelId, msg.guild);

		if(!channel) {
			return await msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "ARCHIVE_MESSAGE_CHANNELNOTFOUND")
			});
		}

		if(!channel.permissionsFor(msg.member).has(["READ_MESSAGES", "READ_MESSAGE_HISTORY"])) {
			return await msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "ARCHIVE_MESSAGE_NOPERMISSIONS")
			});
		}

		const originalMessage = await (async () => {
			try { return await (<TextChannel>channel).fetchMessage(message.messageId); } catch(err) { return undefined; }
		})();

		if(!originalMessage && msg.member.permissions.has("MANAGE_MESSAGES")) {
			return await msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "NO_PERMISSION")
			});
		}

		const author = (originalMessage && originalMessage.author) || await this.resolveUserTarget(message.authorId, msg.guild);
		const member = (originalMessage && originalMessage.member) || msg.guild.member(author);
		const other = message.other ? <IEmulatedContents>JSON.parse(message.other) : undefined;
		const date = originalMessage ? originalMessage.createdAt.toISOString() : SnowflakeUtil.deconstruct(message.messageId).date.toISOString();

		await msg.channel.send({
			embed: <IEmbed>{
				author: {
					icon_url: author ? author.displayAvatarURL : undefined,
					name: author ? `${author.tag}${member && member.nickname ? ` (${member.displayName})` : ""}` : message.authorId
				},
				color: member ? member.displayColor : undefined,
				title: await localizeForUser(msg.member, "ARCHIVE_MESSAGE_TITLE", {
					id: message.messageId
				}),
				description: message.content ? message.content : undefined,
				image: other && other.attachments.length === 1 ? {
					url: other.attachments[0].file.url
				} : undefined,
				fields: other && ((other.attachments && other.attachments.length > 1) || (other.embeds && other.embeds.length > 0)) ? await (async () => {
					const fields: IEmbedOptionsField[] = [];

					if(other.embeds && other.embeds.length > 0) {
						fields.push({
							inline: true,
							name: await localizeForUser(msg.member, "ARCHIVE_MESSAGE_FIELD_EMBEDS_TITLE"),
							value: await localizeForUser(msg.member, "ARCHIVE_MESSAGE_FIELD_EMBEDS_VALUE", {
								count: other.embeds.length
							})
						});
					}

					if(other.attachments && other.attachments.length > 1) {
						fields.push({
							inline: true,
							name: await localizeForUser(msg.member, "ARCHIVE_MESSAGE_FIELD_ATTACHMENTS_TITLE"),
							value: await (async () => {
								let str = "";
								for(const attachment of other.attachments) {
									str += (await localizeForUser(msg.member, "ARCHIVE_MESSAGE_FIELD_ATTACHMENTS_VALUE", {
										link: attachment.file.url,
										fileName: attachment.file.name
									})) + "\n";
								}
								return str;
							})()
						});
					}

					return fields;
				})() : undefined,
				footer: {
					text: `#${channel.name}`,
					icon_url: msg.guild.iconURL || undefined
				},
				timestamp: date
			}
		});

		if(other && other.embeds && other.embeds.length > 0) {
			for(const embed of other.embeds) {
				await msg.channel.send(await localizeForUser(msg.member, "ARCHIVE_MESSAGE_EMBEDMESSAGE_DESCRIPTION", {
					id: message.messageId
				}), {
						embed: <any>embed
					});
			}
		}
	}

	async subcmd_archive(msg: Message, parsed: ISimpleCmdParseResult) {
		if(msg.content === PREFIX) {
			return await msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "ARCHIVE_HELP",
					formatOptions: {
						limit: MESSAGES_LIMIT,
						prefix: PREFIX
					}
				})
			});
		}


		const target = parsed.subCommand;

		if(!target) { return; } // ???

		if(!POSSIBLE_TARGETS.includes(target.toLowerCase())) {
			return await msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
					key: "ARCHIVE_UNKNOWN_TARGET",
					formatOptions: {
						prefix: PREFIX
					}
				})
			});
		}

		let foundMessages: IDBMessage[] | undefined = undefined;
		let lines = DEFAULT_LENGTH;

		if(parsed.args && parsed.args.length >= 1 && /^[0-9]{1,4}$/.test(parsed.args[parsed.args.length - 1])) {
			lines = parseInt(parsed.args[parsed.args.length - 1], 10);
			parsed.args.splice(-1, 1);
			if(lines > MESSAGES_LIMIT) {
				return await msg.channel.send({
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
						key: "ARCHIVE_INVALID_LENGTH",
						formatOptions: {
							limit: MESSAGES_LIMIT
						}
					})
				});
			}
		}

		const caches: {
			users: IHashMap<User>,
			channels: IHashMap<TextChannel>
		} = {
				users: {},
				channels: {}
			};

		switch(target) {
			case "user": {
				if(!parsed.args || parsed.args.length === 0) {
					return await msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
							key: "ARCHIVE_REQUIRES_ARGS_USER",
							formatOptions: {
								prefix: PREFIX
							}
						})
					});
				}

				const resolvedTargets = await (async (toResolve: string[]) => {
					let resolved: string[] = [];
					for(let target of toResolve) {
						try {
							const resolvedTarget = (await this.resolveUserTarget(target, msg.guild)).id;
							resolved.push(resolvedTarget);
						} catch(err) {
							await msg.channel.send({
								embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
									key: "ARCHIVE_ERR_RESOLVING_USER",
									formatOptions: {
										search: replaceAll(target, "``", "''")
									}
								})
							});
							return undefined;
						}
					}
					return resolved;
				})(parsed.args);

				if(!resolvedTargets) {
					return;
				}

				foundMessages = await this.controller.search({
					guildId: msg.guild.id,
					authorId: resolvedTargets.length === 1 ? resolvedTargets[0] : resolvedTargets
				}, lines);
			} break;
			case "guild": {
				foundMessages = await this.controller.search({
					guildId: msg.guild.id
				}, lines);
			} break;
			case "channel": {
				let channels: string[] = [];
				let users: string[] = [];

				if(parsed.args && parsed.args.length > 0) {
					for(const target of parsed.args) {
						if(target.startsWith("u:")) {
							try {
								const user = await this.resolveUserTarget(target.slice("u:".length).trim(), msg.guild);
								caches.users[user.id] = user;
								users.push(user.id);
							} catch(err) {
								return await msg.channel.send({
									embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
										key: "ARCHIVE_ERR_RESOLVING_USER",
										formatOptions: {
											search: replaceAll(target, "``", "''")
										}
									})
								});
							}
						} else {
							try {
								const channel = await this.resolveGuildChannel(target, msg.guild);
								if(!channel) {
									throw new Error("No channel returned");
								} else if(!(channel instanceof TextChannel)) {
									return await msg.channel.send({
										embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
											key: "ARCHIVE_ERR_RESOLVING_CHANNEL_TYPEINVALID",
											formatOptions: {
												argument: replaceAll(target, "``", "''")
											}
										})
									});
								}
								caches.channels[channel.id] = channel;
								channels.push(channel.id);
							} catch(err) {
								return await msg.channel.send({
									embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
										key: "ARCHIVE_ERR_RESOLVING_CHANNEL",
										formatOptions: {
											search: replaceAll(target, "``", "''")
										}
									})
								});
							}
						}
					}
				}

				foundMessages = await this.controller.search({
					guildId: msg.guild.id,
					channelId: channels.length > 0 ? (channels.length === 1 ? channels[0] : channels) : msg.channel.id,
					authorId: users.length > 0 ? users : undefined
				}, lines);
			} break;
			default: {
				this.log("err", "Unknown target found", target);
				return;
			}
		}

		if(foundMessages && foundMessages.length > 0) { // easy filtering from sniffing other channels
			foundMessages = foundMessages.filter((m) => {
				const cachedChannel = (caches.channels[m.channelId] !== undefined ? caches.channels[m.channelId] : undefined);
				const channel = cachedChannel === undefined ? (caches.channels[m.channelId] = <TextChannel>msg.guild.channels.get(m.channelId) || null) : undefined;
				if(channel === null || channel === undefined) {
					return true;
				} else {
					return channel.permissionsFor(msg.member).has(["READ_MESSAGES", "READ_MESSAGE_HISTORY"]);
				}
			});
		} else {
			return await msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "ARCHIVE_ERR_NOTHINGFOUND")
			});
		}

		let result = await this.messagesToString(foundMessages.reverse(), caches.users);

		return await msg.channel.send(await localizeForUser(msg.member, "ARCHIVE_DONE", { lines: foundMessages.length }), new Attachment(Buffer.from(result), `archive_${Date.now()}.txt`));
	}

	async resolveUserTarget(resolvableUser: string, guild: Guild) {
		{
			const res = TARGETTING.RESOLVABLE_USER.MENTION.exec(resolvableUser);
			if(res && res.length === 2) {
				resolvableUser = res[1];
				// i removed returning as we really need to check if this user is exists
				// next stages will check if this user in the guild and then checks if it at least exists in discord api
				// then it returns ID, that's I guess good practice of resolving
			}
		}

		const resolvedMember = await resolveGuildMember(resolvableUser, guild, false, false);
		if(resolvedMember) { return resolvedMember.user; }

		if(!SNOWFLAKE_REGEXP.test(resolvableUser)) {
			throw new Error("Bad ID");
		}

		return (await $discordBot.fetchUser(resolvableUser));
	}

	async resolveGuildChannel(resolvableChannel: string, guild: Guild) {
		{
			const res = TARGETTING.RESOLVABLE_CHANNEL.MENTION.exec(resolvableChannel);
			if(res && res.length === 2) {
				resolvableChannel = res[1];
			}
		}

		const resolvedChannel = await resolveGuildChannel(resolvableChannel, guild, false);
		if(resolvableChannel) { return resolvedChannel; }

		throw new Error("Channel not found");
	}

	async messagesToString(messages: IDBMessage[], cache: IHashMap<User | null> = {}) {
		let str = "";
		for(const messageEntry of messages) {
			const parsedDate = (SnowflakeUtil.deconstruct(messageEntry.messageId)).date;
			str += `${parsedDate.toISOString()} (${messageEntry.guildId} / ${messageEntry.channelId} / ${messageEntry.authorId} / ${messageEntry.messageId}) `;

			let author = cache[messageEntry.authorId];
			if(!author && author !== null) {
				author = cache[messageEntry.authorId] = await (async () => {
					try { return await $discordBot.fetchUser(messageEntry.authorId); } catch(err) { return null; }
				})();
			}

			str += `${!author ? messageEntry.authorId : author.tag}: ${messageEntry.content}`;

			if(messageEntry.other) {
				const parsedContent = <IEmulatedContents>JSON.parse(messageEntry.other);
				if(parsedContent.attachments) {
					str += "\n";
					for(const attachment of parsedContent.attachments) {
						str += `  - [A][${attachment.file.name}][${attachment.id}]: ${attachment.file.url}\n`;
					}
					str += "\n";
				}
				if(parsedContent.embeds) {
					str += "\n";
					for(const embed of parsedContent.embeds) {
						str += `  - [E]: ${JSON.stringify(embed)}\n`;
					}
					str += "\n";
				}
			}
			str += "\n";
		}
		return str;
	}

	async recordMessage(msg: Message) {
		const payload = convertToDBMessage(msg);
		return await this.controller.insertMessage(payload);
	}

	async init() {
		this.controller = new ArchiveDBController();
		await this.controller.init();
		this.handleEvents();
	}

	async unload() {
		this.unhandleEvents();
		return true;
	}
}

module.exports = ModToolsArchive;
