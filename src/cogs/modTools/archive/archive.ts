import { simpleCmdParse } from "../../utils/text";
import { IModule } from "../../../types/ModuleLoader";
import { Plugin } from "../../plugin";
import { Message, Guild, SnowflakeUtil, Attachment } from "discord.js";
import { EmbedType, escapeDiscordMarkdown, getLogger, resolveGuildChannel, resolveGuildMember } from "../../utils/utils";
import { getDB } from "../../utils/db";
import { generateLocalizedEmbed } from "../../utils/ez-i18n";
import { ArchiveDBController, convertToDBMessage, IDBMessage, IEmulatedContents } from "./dbController";
import { getPreferenceValue } from "../../utils/guildPrefs";

const PREFIX = "!archive";
const POSSIBLE_TARGETS = ["user", "channel", "guild"];
// targetting:
//  user & resolvableUser
//  guild & resolvableUser
//  channel & resolvableChannel & resolvableUser?
const SNOWFLAKE_REGEXP = /[0-9]{18}/;
const TARGETTING = Object.freeze({
	RESOLVABLE_USER: {
		MENTION: /^<@!?([0-9]{18})>$/,
	},
	RESOLVABLE_CHANNEL: {
		MENTION: /^<#([0-9]{18})>$/
	}
});
const DEFAULT_LENGTH = 50; // lines per file

interface IMessagesToDBTestOptions {
	banned?: {
		authors?: string[];
		channels?: string[];
		guilds?: string[];
	};
	bots: boolean;
}

class MessagesToDBTest extends Plugin implements IModule {
	public get signature() {
		return "snowball.tests.messages_to_db";
	}

	log = getLogger("MessagesToDBTest");
	db = getDB();
	options: IMessagesToDBTestOptions;
	controller: ArchiveDBController;

	constructor(options: IMessagesToDBTestOptions) {
		super({
			"message": (msg: Message) => this.onMessage(msg)
		}, true);
		if(!options) { throw new Error("No options given"); }
		this.options = options || { };
		this.log("info", "The settings are:", options);
	}

	async onMessage(msg: Message) {
		if(!this.options.bots && msg.author.bot) { return; }
		if(!!this.options.banned) {
			if(!!this.options.banned.authors && this.options.banned.authors.includes(msg.author.id)) {
				this.log("warn", `Don't pushing message from ${msg.author.id} since it included in banned authors`);
				return;
			} else if(!!this.options.banned.channels && this.options.banned.channels.includes(msg.channel.id)) {
				this.log("warn", `Don't pushing message from ${msg.channel.id} channel since it included in banned channels`);
				return;
			} else if(!!this.options.banned.guilds && !!msg.guild && this.options.banned.guilds.includes(msg.guild.id)) {
				this.log("warn", `Don't pushing message from ${msg.guild.id} guild since it included in banned channels`);
				return;
			}
		}
		const start = Date.now();
		const _ret = await this.recordMessage(msg);
		this.log("ok", `Pushed message ${msg.id} (AID: ${msg.author.id}, CID: ${msg.channel.id}, GID: ${msg.guild ? msg.guild.id : "dm"}) in ${Date.now() - start}ms`, _ret);

		try {
			await this.handleCommand(msg);
		} catch (err) {
			this.log("err", "Handling commands failure", err);
		}
	}

	async handleCommand(msg: Message) {
		if(!msg.content.startsWith(PREFIX)) {
			return;
		}

		if(!msg.member.permissions.has("MANAGE_MESSAGES")) {
			return;
		}

		if(!getPreferenceValue(msg.guild, "features:archive:enabled", true)) {
			this.log("info", `Access to the feature archive denied in guild ${msg.guild.id} (requested-in: ${msg.id})`);
			return;
		}

		if(msg.content === PREFIX) {
			return await msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "ARCHIVE_HELP")
			});
		}

		const parsed = simpleCmdParse(msg.content);
		const target = parsed.subCommand;

		if(!target) { return; } // ???

		if(!POSSIBLE_TARGETS.includes(target.toLowerCase())) {
			return await msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "ARCHIVE_UNKNOWN_TARGET")
			});
		}

		this.log("info", "Parsed command:", parsed);

		let foundMessages:IDBMessage[]|undefined = undefined;
		let lines = DEFAULT_LENGTH;

		if(parsed.args && parsed.args.length >= 1 && /^[0-9]{1,4}$/.test(parsed.args[parsed.args.length - 1])) {
			lines = parseInt(parsed.args[parsed.args.length - 1], 10);
			parsed.args.splice(-1, 1);
			if(lines > 1000) {
				return;
			}
		}

		this.log("info", "After-line result:", parsed);

		switch(target) {
			case "user": {
				if(!parsed.args || parsed.args.length === 0) {
					// TODO: add message about no arguments
					return;
				}

				const resolvedTargets = await (async (toResolve: string[]) => {
					let resolved: string[] = [];
					for(let target of toResolve) {
						try {
							const resolvedTarget = (await this.resolveUserTarget(target, msg.guild)).id;
							this.log("ok", "Resolved target -", resolvedTarget);
							resolved.push(resolvedTarget);
						} catch (err) {
							this.log("err", "Resolving failed", err);
							await msg.channel.send({
								embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
									key: "ARCHIVE_ERR_RESOLVING",
									formatOptions: {
										argument: escapeDiscordMarkdown(target, true)
									}
								})
							});
							return undefined;
						}
					}
					return resolved;
				})(parsed.args);

				if(!resolvedTargets) {
					this.log("info", "No resolved target returned");
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
					// checking all the ids!
					for(const target of parsed.args) {
						if(target.startsWith("u:")) {
							// usertarget
							try {
								users.push((await this.resolveUserTarget(target.slice("u:".length).trim(), msg.guild)).id);
							} catch (err) {
								this.log("err", "Error resolving user", err);
								// TODO: invalid user message
								return;
							}
						} else {
							try {
								const channel = await this.resolveGuildChannel(target, msg.guild);
								if(!channel) {
									// TODO: add message about wrong channel
									throw new Error("No channel returned");
								} else if(channel.type !== "text") {
									// TODO: add message about wrong channel type!!
									throw new Error("Invalid channel type");
								}
								channels.push(channel.id);
							} catch (err) {
								this.log("err", "Error resolving channel", err);
								// TODO: channel error
								return;
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
			} break;
		}

		if(!foundMessages || foundMessages.length === 0) {
			// TODO: nothing found message
			this.log("warn", "Returned no messages, possible searching failure.");
			return;
		}

		let result = await this.messagesToString(foundMessages.reverse());

		await msg.channel.send({
			file: new Attachment(Buffer.from(result), `archive_${Date.now()}.txt`)
		});
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
		if(resolvedMember) { return resolvedMember; }

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

	async messagesToString(messages: IDBMessage[]) {
		let str = "";
		for(const messageEntry of messages) {
			const parsedDate = (SnowflakeUtil.deconstruct(messageEntry.messageId)).date;
			str += `${parsedDate.toISOString()} (${messageEntry.guildId} / ${messageEntry.channelId} / ${messageEntry.authorId} / ${messageEntry.messageId}) ${messageEntry.content}`;
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

module.exports = MessagesToDBTest;
