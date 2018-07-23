import { IModule } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message, Guild, GuildMember, Role, TextChannel, DMChannel, DiscordAPIError, Emoji } from "discord.js";
import { EmbedType, IEmbedOptionsField, resolveGuildRole, escapeDiscordMarkdown, resolveEmojiMap } from "../utils/utils";
import { default as fetch } from "node-fetch";
import { createConfirmationMessage, waitForMessages } from "../utils/interactive";
import { parse as parseURI } from "url";
import { replaceAll, reverseString, startsWith } from "../utils/text";
import { command } from "../utils/help";
import { localizeForUser, generateLocalizedEmbed, localizeForGuild } from "../utils/ez-i18n";
import { randomString } from "../utils/random";
import { IPCMessage, INullableHashMap } from "../../types/Types";
import { messageToExtra } from "../utils/failToDetail";
import * as ua from "universal-analytics";
import * as getLogger from "loggy";
import { GuildsDBController, IGuildRow, IGuildCustomize } from "@cogs/guilds/dbController";

const DEFAULT_TABLE_NAME = "guilds";

const BANNED_HOSTS = ["goo.gl", "grabify.link", "bit.ly"];
const EMOJI_NAME_REGEXP = /[a-z0-9\_\-]{2,36}/i;
const EMOJI_ACCESSIBLE_FORMATS = [".png", ".webp", ".jpg", ".gif"];
const EMOJI_MAXSIZE = 262144; // bytes

function isHostBanned(host: string) {
	if (host.startsWith("www.")) {
		host = host.slice("www.".length);
	}
	return BANNED_HOSTS.includes(host);
}

export interface IGuildsModuleConfig {
	emojis: {
		greenTick: string;
		redTick: string;
	};
	tableName?: string;
}

const BASE_PREFIX = "!guilds";
const CMD_GUILDS_LIST = `${BASE_PREFIX} list`;
const CMD_GUILDS_CREATE = `${BASE_PREFIX} create`;
const CMD_GUILDS_EDIT = `${BASE_PREFIX} edit`;
const CMD_GUILDS_DELETE = `${BASE_PREFIX} delete`;
const CMD_GUILDS_INFO = `${BASE_PREFIX} info`;
const CMD_GUILDS_INVITE = `${BASE_PREFIX} invite`;
const CMD_GUILDS_MEMBERS = `${BASE_PREFIX} members`;
const DEFAULT_ROLE_PREFIX = `!`;
const HELP_CATEGORY = "GUILDS";

const enum SHARDING_MESSAGE_TYPE {
	BASE_PREFIX = "guilds:",
	RULES_ACCEPTED = "guilds:rules:accept",
	RULES_REJECTED = "guilds:rules:reject",
	PENDING_INVITE_CLEAR = "guilds:rules:pending_clear",
	PENDING_INVITE_CREATE = "guilds:rules:pending"
}

function isServerAdmin(member: GuildMember) {
	return member.permissions.has(["MANAGE_CHANNELS", "MANAGE_ROLES"], true);
}

function rightsCheck(member: GuildMember, row?: IGuildRow, noAdmins = false) {
	const checkA = isServerAdmin(member);
	let checkB = false;
	if (row) {
		const cz = <IGuildCustomize> JSON.parse(row.customize);
		checkB = row.ownerId === member.id || member.id === $botConfig.botOwner;
		if (!noAdmins) {
			checkB = checkB || (cz.admins && cz.admins.includes(member.id));
		}
	}
	return checkA || checkB;
}

function helpCheck(msg: Message) {
	return msg.channel.type === "text" && rightsCheck(msg.member);
}

function defHelpCheck(msg: Message) {
	return msg.channel.type === "text";
}

@command(HELP_CATEGORY, BASE_PREFIX.slice(1), "loc:GUILDS_META_JOINLEAVE", {
	"loc:GUILDS_META_GUILDNAME": {
		optional: false,
		description: "loc:GUILDS_META_JOINLEAVE_ARG0_DESC"
	}
}, defHelpCheck)
@command(HELP_CATEGORY, CMD_GUILDS_CREATE.slice(1), "loc:GUILDS_META_CREATE", {
	"loc:GUILDS_META_GUILDNAME": {
		optional: false,
		description: "loc:GUILDS_META_CREATE_ARG0_DESC"
	},
	"loc:GUILDS_META_CREATE_ARG1": {
		optional: true,
		description: "loc:GUILDS_META_CREATE_ARG1_DESC"
	}
}, helpCheck)
@command(HELP_CATEGORY, CMD_GUILDS_EDIT.slice(1), "loc:GUILDS_META_EDIT", {
	"loc:GUILDS_META_GUILDNAME": {
		optional: false,
		description: "loc:GUILDS_META_EDIT_ARG0_DESC"
	},
	"loc:GUILDS_META_EDIT_ARG1": {
		optional: false,
		description: "loc:GUILDS_META_EDIT_ARG1_DESC"
	},
	"loc:GUILDS_META_EDIT_ARG2": {
		optional: false,
		description: "loc:GUILDS_META_EDIT_ARG2_DESC"
	}
}, helpCheck)
@command(HELP_CATEGORY, CMD_GUILDS_INVITE.slice(1), "loc:GUILDS_META_INVITE", {
	"loc:GUILDS_META_GUILDNAME": {
		optional: false,
		description: "loc:GUILDS_META_INVITE_ARG0_DESC"
	},
	"loc:GUILDS_META_INVITE_ARG1": {
		optional: true,
		description: "loc:GUILDS_META_INVITE_ARG1_DESC"
	},
	"loc:GUILDS_META_INVITE_ARG2": {
		optional: false,
		description: "loc:GUILDS_META_INVITE_ARG2_DESC"
	}
})
@command(HELP_CATEGORY, CMD_GUILDS_DELETE.slice(1), "loc:GUILDS_META_DELETE", {
	"loc:GUILDS_META_GUILDNAME": {
		optional: false,
		description: "loc:GUILDS_META_DELETE_ARG0_DESC"
	}
}, helpCheck)
@command(HELP_CATEGORY, CMD_GUILDS_LIST.slice(1), "loc:GUILDS_META_LIST", {
	"loc:GUILDS_META_LIST_ARG0": {
		optional: true,
		description: "loc:GUILDS_META_LIST_ARG0_DESC"
	}
}, defHelpCheck)
@command(HELP_CATEGORY, CMD_GUILDS_INFO.slice(1), "loc:GUILDS_META_INFO", {
	"loc:GUILDS_META_GUILDNAME": {
		optional: true,
		description: "loc:GUILDS_META_INFO_ARG0_DESC"
	}
}, defHelpCheck)
class Guilds extends Plugin implements IModule {
	public get signature() {
		return "snowball.features.guilds";
	}

	private readonly log = getLogger("Guilds");

	private readonly _config: IGuildsModuleConfig;

	private _processMessageListener?: ((msg: any) => void);
	private readonly _pendingInvites: INullableHashMap<{ code: string; }> = Object.create(null);

	private readonly _dbController: GuildsDBController;

	constructor(config: IGuildsModuleConfig) {
		super({
			"message": (msg: Message) => this._onMessage(msg)
		}, true);

		if (!config) { throw new Error("No config passed"); }

		if ($botConfig.sharded) {
			this._addProcessMessageListener();
		}

		config.emojis = <any> resolveEmojiMap(
			config.emojis,
			$discordBot.emojis,
			true
		);

		this._dbController = new GuildsDBController(
			config.tableName || DEFAULT_TABLE_NAME
		);

		this._config = config;
	}

	private _addProcessMessageListener() {
		this._processMessageListener = (msg) => {
			if (typeof msg !== "object") { return; }

			if (
				msg.type &&
				!msg.type.startsWith(SHARDING_MESSAGE_TYPE.BASE_PREFIX)
			) {
				return;
			}

			if (!msg.payload) { return; }

			if (!msg.payload.uid) { return; }

			if (msg.type === SHARDING_MESSAGE_TYPE.PENDING_INVITE_CLEAR) {
				if (!this._pendingInvites[msg.payload.uid]) { return; }

				delete this._pendingInvites[msg.payload.uid];
			} else if (msg.type === SHARDING_MESSAGE_TYPE.PENDING_INVITE_CREATE) {
				if (!msg.payload.code) { return; }

				this._pendingInvites[msg.payload.uid] = {
					code: msg.payload.code
				};
			}
		};

		process.on("message", this._processMessageListener);
	}

	// ==============================
	// Messages handling
	// ==============================

	private async _onMessage(msg: Message) {
		if (msg.channel.type === "dm") { return this._handleDMCode(msg); }
		try {
			if (msg.content.startsWith(BASE_PREFIX)) {
				if (msg.content === BASE_PREFIX) {
					return await this._sendHelp(<TextChannel> msg.channel, undefined, msg.member);
				} else if (startsWith(msg.content, CMD_GUILDS_LIST)) {
					return await this._getGuildsList(msg);
				} else if (startsWith(msg.content, CMD_GUILDS_CREATE)) {
					return await this._createGuild(msg);
				} else if (startsWith(msg.content, CMD_GUILDS_EDIT)) {
					return await this._editGuild(msg);
				} else if (startsWith(msg.content, CMD_GUILDS_DELETE)) {
					return await this._deleteGuild(msg);
				} else if (startsWith(msg.content, CMD_GUILDS_INFO)) {
					return await this._getGuildInfo(msg);
				} else if (startsWith(msg.content, CMD_GUILDS_INVITE)) {
					return await this._inviteToGuild(msg);
				} else if (startsWith(msg.content, CMD_GUILDS_MEMBERS)) {
					return await this._membersControl(msg);
				}
				return await this._joinLeaveGuild(msg);
			}
		} catch (err) {
			this.log("err", "Error at running cmd", msg.content, "\n", err);
			$snowball.captureException(err, { extra: messageToExtra(msg) });
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_RUNNINGFAILED")
			});
		}
	}

	// ==============================
	// Handlers
	// ==============================

	private async _handleDMCode(msg: Message) {
		if (msg.channel.type !== "dm") { return; } // non-dm msg
		if (!process.send) { return; } // non-sharded run

		const pendingInvite = this._pendingInvites[msg.author.id];
		if (!pendingInvite) { return; } // no pending invites
		if (pendingInvite.code.toLowerCase() === msg.content.toLowerCase()) {
			process.send({
				type: SHARDING_MESSAGE_TYPE.RULES_ACCEPTED,
				payload: {
					uid: msg.author.id
				}
			});
		} else if (msg.content === "-") {
			process.send({
				type: SHARDING_MESSAGE_TYPE.RULES_REJECTED,
				payload: {
					uid: msg.author.id
				}
			});
		}
	}

	private async _sendHelp(channel: TextChannel, article: string = "guilds", member: GuildMember) {
		let str = "";
		switch (article) {
			case "guilds": {
				str = await localizeForUser(member, "GUILDS_ARTICLE_GENERAL", {
					prefix: BASE_PREFIX
				});
			} break;
			case CMD_GUILDS_CREATE: {
				str = await localizeForUser(member, "GUILDS_ARTICLE_CREATE", {
					prefix: CMD_GUILDS_CREATE
				});
			} break;
			case CMD_GUILDS_EDIT: {
				str = await localizeForUser(member, "GUILDS_ARTICLE_EDIT", {
					prefix: CMD_GUILDS_EDIT
				});
			} break;
			case CMD_GUILDS_INFO: {
				str = await localizeForUser(member, "GUILDS_ARTICLE_INFO", {
					prefix: CMD_GUILDS_INFO
				});
			} break;
			case CMD_GUILDS_LIST: {
				str = await localizeForUser(member, "GUILDS_ARTICLE_LIST", {
					prefix: CMD_GUILDS_LIST
				});
			} break;
			case CMD_GUILDS_DELETE: {
				str = await localizeForUser(member, "GUILDS_ARTICLE_DELETE", {
					prefix: CMD_GUILDS_DELETE
				});
			} break;
		}
		return channel.send({
			embed: await generateLocalizedEmbed(EmbedType.Information, member, {
				custom: true,
				string: str
			})
		});
	}

	private async _createGuild(msg: Message) {
		// !guilds create Overwatch, !Overwatch
		if (msg.content === CMD_GUILDS_CREATE) {
			return this._sendHelp(<TextChannel> msg.channel, CMD_GUILDS_CREATE, msg.member);
		}

		if (!rightsCheck(msg.member)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_NOPERMISSIONS")
			});
		}

		const args = msg.content.slice(CMD_GUILDS_CREATE.length).split(",").map(arg => arg.trim());
		if (args.length > 2) {
			// Overwatch, Overwatch, friends!
			const fields: IEmbedOptionsField[] = [];
			if ((msg.content.match(/\,/g) || []).length > 1) {
				fields.push({
					name: await localizeForUser(msg.member, "GUILDS_CREATE_FIELD_TIP"),
					value: await localizeForUser(msg.member, "GUILDS_CREATE_FILED_TIP_TEXT"),
				});
			}
			fields.push({
				name: await localizeForUser(msg.member, "GUILDS_CREATE_FIELDS_USAGE"),
				value: await localizeForUser(msg.member, "GUILDS_CREATE_FIELDS_USAGE_TEXT", {
					prefix: CMD_GUILDS_CREATE
				})
			});
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_WRONGARGSCOUNT", {
					fields: []
				})
			});
		}

		if (["create", "edit", "invite", "delete", "list", "info"].includes(args[0].toLowerCase())) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_RESERVEDNAME")
			});
		}

		// search if we already having role with this name
		let dbRow: IGuildRow | undefined = await this._getGuildRow(msg.guild, args[0]);

		if (dbRow) {
			if (!msg.guild.roles.has(dbRow.roleId)) {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_ALREADYFOUND_NOROLE")
				});
			}
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_ALREADYFOUND_ROLE")
			});
		}

		let role: Role | undefined = undefined;

		if (args.length === 1) {
			const roleName = `${DEFAULT_ROLE_PREFIX}${args[0]}`;

			// creating role
			const _confirmationEmbed = await generateLocalizedEmbed(EmbedType.Progress, msg.member, {
				key: "GUILDS_CREATE_ROLECREATING_CONFIRMATION",
				formatOptions: {
					roleName
				}
			});

			const confirmation = await createConfirmationMessage(_confirmationEmbed, msg);

			if (!confirmation) {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CANCELED")
				});
			}

			role = await msg.guild.roles.create({
				data: {
					permissions: [],
					hoist: false, mentionable: false,
					name: roleName
				},
				reason: await localizeForGuild(msg.guild, "GUILDS_AUDITLOG_ROLE_CREATED", {
					initiator: msg.author.tag,
					guildName: args[0]
				})
			});
		} else {
			role = resolveGuildRole(args[1], msg.guild, false, false);
			if (!role) {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_RESOLVINGFAILED")
				});
			}
		}

		try {
			await msg.member.roles.add(role, await localizeForGuild(msg.guild, "GUILDS_AUDITLOG_CREATED_OWNER", {
				guildName: args[0]
			}));
		} catch (err) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_ROLEASSIGNATIONFAILED")
			});
		}

		await this._createGuildRow(msg.guild, args[0], msg.member.id, role.id);

		dbRow = await this._getGuildRow(msg.guild, args[0]);

		if (!dbRow) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_DBERROR")
			});
		}

		await this._updateGuildRow(dbRow);

		return msg.channel.send({
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "GUILDS_CREATE_DONE")
		});
	}

	private async _editGuild(msg: Message) {
		// !guilds edit Overwatch, description, Для фанатов этой отвратительной игры
		if (msg.content === CMD_GUILDS_EDIT) {
			return this._sendHelp(<TextChannel> msg.channel, CMD_GUILDS_EDIT, msg.member);
		}

		const args = msg.content.slice(CMD_GUILDS_EDIT.length).split(",");

		let guildName = "", editableParam = "", content = "";
		// due to issues w/ typescript I made them ""

		{
			// nice argument parsing
			let currentElem: string; let i = 0;
			while ((currentElem = args.splice(0, 1)[0]) !== undefined) {
				if (++i === 3) { break; }
				switch (i) {
					case 1: {
						guildName = currentElem.trim();
					} break;
					case 2: {
						editableParam = currentElem.trim();
						content = args.join(",").trim();
					} break;
				}
			}
		}

		if (["image", "description", "rules", "welcome_msg_channel", "welcome_msg", "icon", "owner", "google-ua", "private", "invite_only", "add_admin", "add_adm", "remove_admin", "rm_admin", "delete_admin", "add_emoji"].indexOf(editableParam) === -1) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_INVALIDPARAM")
			});
		}

		let dbRow: IGuildRow | undefined = undefined;
		try {
			dbRow = await this._getGuildRow(msg.guild, guildName);
		} catch (err) {
			this.log("err", "Failed to get guild", err);
			dbRow = undefined;
		}

		if (!dbRow) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "GUILDS_EDIT_GUILDNOTFOUND")
			});
		}

		if (!rightsCheck(msg.member, dbRow)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_NOPERMISSIONS")
			});
		}

		const customize = <IGuildCustomize> JSON.parse(dbRow.customize);

		const isCalledByAdmin = !rightsCheck(msg.member, dbRow, true);

		let doneString = "";

		switch (editableParam) {
			case "image": case "icon": {
				// fetching first
				if (!content.startsWith("http://") && !content.startsWith("https://")) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_INVALIDLINK")
					});
				}
				const resolved = parseURI(content);
				if (resolved.hostname && isHostBanned(resolved.hostname)) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_INVALIDLINK")
					});
				}
				try {
					await fetch(encodeURI(content), {
						method: "GET"
					});
				} catch (err) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_IMAGELOADINGFAILED")
					});
				}
				if (editableParam === "image") {
					customize.image_url = content;
				} else {
					customize.icon_url = content;
				}
				doneString = await localizeForUser(msg.member, "GUILDS_EDIT_IMAGESET");
			} break;
			case "rules": {
				content = content.replace("@everyone", "@\u200Beveryone").replace("@here", "@\u200Bhere");
				customize.rules = content;
				doneString = await localizeForUser(msg.member, "GUILDS_EDIT_RULESSET");
			} break;
			case "welcome_msg_channel": {
				const channel = $discordBot.channels.get(content);
				if (!channel) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_CHANNELNOTFOUND")
					});
				}
				if (channel.type !== "text") {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_WRONGCHANNEL")
					});
				}
				if ((<TextChannel> channel).guild.id !== msg.guild.id) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_OTHERCHANNEL")
					});
				}
				customize.welcome_msg_channel = content;
				doneString = await localizeForUser(msg.member, "GUILDS_EDIT_WELCOMECHANNELSET");
			} break;
			case "welcome_msg": {
				content = content.replace("@everyone", "@\u200Beveryone").replace("@here", "@\u200Bhere");
				if (!content.includes("{usermention}") && !content.includes("{username}")) {
					let confirmation = false;
					try {
						confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_NOUSERMENTION"), msg);
					} catch (err) {
						confirmation = false;
					}

					if (confirmation) {
						return msg.channel.send({
							embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CANCELED")
						});
					}
				}
				customize.welcome_msg = content;
				doneString = await localizeForUser(msg.member, "GUILDS_EDIT_WELCOMEMSGSET");
			} break;
			case "description": {
				content = content.replace("@everyone", "@\u200Beveryone").replace("@here", "@\u200Bhere");
				dbRow.description = content;
				doneString = await localizeForUser(msg.member, "GUILDS_EDIT_DESCRIPTIONSET");
			} break;
			case "owner": {
				if (isCalledByAdmin) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_OWNERERR")
					});
				}
				const serverAdmin = isServerAdmin(msg.member);
				if (content.startsWith("<@") && content.endsWith(">")) {
					content = content.slice(2).slice(0, -1);
					if (content.startsWith("!")) {
						content = content.slice(1);
					}
				}
				const member = msg.guild.members.get(content);
				if (!member) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_MEMBERNOTFOUND")
					});
				}
				if (member.id === dbRow.ownerId) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
							key: "GUILDS_EDIT_TRANSFEROWNERSHIPTOOWNER",
							formatOptions: {
								serverAdmin
							}
						})
					});
				}
				const confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Question, msg.member, {
					key: "GUILDS_EDIT_TRANSFERCONFIRMATION",
					formatOptions: {
						username: escapeDiscordMarkdown(member.displayName, true)
					}
				}), msg);
				if (!confirmation) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "GUILDS_CANCELED")
					});
				}
				dbRow.ownerId = member.id;
				if (customize.admins && customize.admins.includes(member.id)) {
					customize.admins.splice(customize.admins.indexOf(member.id), 1);
				}
				doneString = await localizeForUser(msg.member, "GUILDS_EDIT_TRANSFERDONE", {
					serverAdmin
				});
			} break;
			case "google-ua": {
				if (isCalledByAdmin) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_NOPERMS")
					});
				}
				if (!content.startsWith("UA-")) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_GOOGLEUAWRONGCODE")
					});
				}
				customize.ua = content;
				doneString = await localizeForUser(msg.member, "GUILDS_EDIT_GOOGLEUADONE");
			} break;
			case "invite_only": case "private": {
				if (isCalledByAdmin) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_NOPERMS")
					});
				}

				if (!["true", "false"].includes(content)) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_TRUEFALSEERR")
					});
				}

				if (content === "true" && customize.invite_only) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
							key: "GUILDS_EDIT_IOALREADY",
							formatOptions: {
								ioAlreadyEnabled: true
							}
						})
					});
				} else if (content === "false" && !customize.invite_only) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
							key: "GUILDS_EDIT_IOALREADY",
							formatOptions: {
								ioAlreadyEnabled: false
							}
						})
					});
				}

				customize.invite_only = content === "true";

				doneString = await localizeForUser(msg.member, "GUILDS_EDIT_IOCHANGED", {
					ioEnabled: customize.invite_only
				});
			} break;
			case "add_admin": case "add_adm": {
				if (isCalledByAdmin) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_ADDADMPERMS")
					});
				}
				if (msg.mentions.members.size === 0) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_ADDADMNOMENTIONS")
					});
				}
				if (msg.mentions.members.size > 1) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_ADDADMSINGLEMENTION")
					});
				}
				if (!customize.admins) { customize.admins = []; }
				const mention = msg.mentions.members.first().id;
				if (customize.admins.includes(mention)) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_ADDADMNOTGUILDMEMBER")
					});
				}
				customize.admins.push(mention);
			} break;
			case "remove_admin": case "rm_admin": case "delete_admin": case "rm_adm": {
				if (isCalledByAdmin) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_RMADMPERMS")
					});
				}
				if (msg.mentions.members.size === 0) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_NOMENTIONS")
					});
				}
				if (msg.mentions.members.size > 1) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_SINGLEMENTION")
					});
				}
				if (!customize.admins) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_RMNOADMINS")
					});
				}
				const mention = msg.mentions.members.first().id;
				customize.admins.splice(customize.admins.indexOf(mention), 1);
			} break;
			case "add_emoji": {
				if (!EMOJI_NAME_REGEXP.test(content)) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_INVALIDEMOJINAME")
					});
				}
				if (msg.attachments.size === 0) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_NOATTACHMENT")
					});
				} else if (msg.attachments.size > 1) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_TOOMANYATTACHMENTS")
					});
				}

				const attachment = msg.attachments.first();

				if (!EMOJI_ACCESSIBLE_FORMATS.find(t => attachment.url.endsWith(t))) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_INVALIDTYPE")
					});
				} else if ((<number> attachment["size"]) > EMOJI_MAXSIZE) {
					// by some reason discord.js has no typedefs for `size`
					return msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
							key: "GUILDS_EDIT_INVALIDSIZE",
							formatOptions: {
								maxSizeKB: EMOJI_MAXSIZE / 1024
							}
						})
					});
				}

				const botsRole = msg.guild.me.roles.find(r => r.managed);

				let emoji: Emoji;
				try {
					emoji = await msg.guild.emojis.create(attachment.url, content, {
						roles: [dbRow.roleId, botsRole]
					});
				} catch (err) {
					if (err instanceof DiscordAPIError) {
						let key = "GUILDS_EDIT_EMOJIOTHERERR";
						switch (err.code) {
							case 50013: { key = "GUILDS_EDIT_NOEMOJIPERMISSIONS"; } break;
							case 30008: { key = "GUILDS_EDIT_NOSLOTS"; } break;
							case 20001: { key = "GUILDS_EDIT_BADFORBOT"; } break;
							case 50035: { key = `GUILDS_EDIT_INVALIDFORM_${err.message.includes("File cannot be larger than") ? "SIZE" : "OTHER"}`; }
							default: {
								$snowball.captureException(new Error("Can't add emoji"), {
									extra: {
										err, name: content, uri: attachment.url
									}
								});
							} break;
						}

						return msg.channel.send({
							embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, key)
						});
					}

					// ???
					$snowball.captureException(err);
					return;
				}

				if (!emoji) { return; }

				doneString = await localizeForUser(msg.member, "GUILDS_EDIT_EMOJICREATED", {
					name: emoji.name,
					emoji: botsRole ? emoji.toString() : ""
				});
			} break;
		}

		dbRow.customize = JSON.stringify(customize);

		await this._updateGuildRow(dbRow);

		return msg.channel.send({
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
				custom: true,
				string: doneString
			})
		});
	}

	private async _deleteGuild(msg: Message) {
		const guildName = msg.content.slice(CMD_GUILDS_DELETE.length).trim();
		if (guildName === "") {
			return this._sendHelp(<TextChannel> msg.channel, CMD_GUILDS_DELETE, msg.member);
		}

		let dbRow: IGuildRow | undefined = undefined;
		try {
			dbRow = await this._getGuildRow(msg.guild, guildName);
		} catch (err) {
			this.log("err", "Failed to get guild", err);
			dbRow = undefined;
		}

		if (!dbRow) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "GUILDS_EDIT_GUILDNOTFOUND")
			});
		}

		if (!rightsCheck(msg.member, dbRow, true)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_NOPERMISSIONS")
			});
		}

		const confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, "GUILDS_DELETE_CONFIRMATION");
		const confirmation = await createConfirmationMessage(confirmationEmbed, msg);

		if (!confirmation) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "GUILDS_CANCELED")
			});
		}

		await this._deleteGuildRow(dbRow);

		return msg.channel.send({
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "GUILDS_DELETE_DONE")
		});
	}

	private async _joinLeaveGuild(msg: Message) {
		// !guilds Overwatch
		const guildName = msg.content.slice(BASE_PREFIX.length).trim();
		if (guildName.length === 0) {
			return this._sendHelp(<TextChannel> msg.channel, undefined, msg.member);
		}

		let dbRow: IGuildRow | undefined = undefined;
		try {
			dbRow = await this._getGuildRow(msg.guild, guildName);
		} catch (err) {
			this.log("err", "Failed to get guild", err);
			dbRow = undefined;
		}

		if (!dbRow) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_GUILDNOTFOUND")
			});
		}

		const role = msg.guild.roles.get(dbRow.roleId);

		if (!role) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_LEAVE_NOROLE")
			});
		}

		if (!msg.member.roles.has(dbRow.roleId)) {
			await this._joinGuild(msg, dbRow, role, guildName);
		} else {
			await this._leaveGuild(msg, dbRow, role, guildName);
		}
	}

	private async _leaveGuild(msg: Message, dbRow: IGuildRow | undefined, role: Role | undefined, guildName: string) {
		if (!dbRow || !role) { return; }

		const cz = <IGuildCustomize> JSON.parse(dbRow.customize);

		if (dbRow.ownerId === msg.member.id || (cz.admins && cz.admins.includes(msg.member.id))) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_LEAVE_ADMIN")
			});
		}

		let visitor: ua.Visitor | undefined = undefined;
		if (cz.ua) {
			visitor = ua(cz.ua, msg.guild.id, {
				strictCidFormat: false,
				https: true,
				uid: msg.member.id
			});
		}

		let str = await localizeForUser(msg.member, "GUILDS_LEAVE_CONFIRMATION", {
			guildName: escapeDiscordMarkdown(dbRow.name, true)
		});

		if (cz.invite_only) {
			str += "\n";
			str += await localizeForUser(msg.member, "GUILDS_LEAVE_INVITEWARNING");
		}

		const confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
			custom: true,
			string: str
		});

		const confirmation = await createConfirmationMessage(confirmationEmbed, msg);
		if (!confirmation) {
			visitor && visitor.event("Members", "Saved from leave", msg.member.id).send();
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "GUILDS_CANCELED")
			});
		}

		try {
			dbRow = await this._getGuildRow(msg.guild, guildName);
		} catch (err) {
			this.log("err", "Failed to get guild", err);
			dbRow = undefined;
		}

		if (!dbRow) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_LEAVE_ALREADYDESTROYED")
			});
		}

		role = msg.guild.roles.get(dbRow.roleId);

		if (!role) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_LEAVE_ALREADYDELETEDROLE")
			});
		}

		try {
			await msg.member.roles.remove(role, await localizeForGuild(msg.guild, "GUILDS_AUDITLOG_LEFT_GUILD", {
				guildName: dbRow.name
			}));
			visitor && visitor.event("Members", "Left", msg.member.id).send();
		} catch (err) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_LEAVE_ROLEFAILED")
			});
		}

		return msg.channel.send({
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
				key: "GUILDS_LEAVE_DONE",
				formatOptions: {
					guildName: escapeDiscordMarkdown(dbRow.name, true)
				}
			})
		});
	}

	private async _joinGuild(msg: Message, dbRow: IGuildRow | undefined, role: Role | undefined, guildName: string) {
		if (!dbRow || !role) { return; }

		const getEmbed = async (str: string) => {
			return generateLocalizedEmbed(EmbedType.Progress, msg.member, {
				custom: true,
				string: str
			}, {
				author: {
					icon_url: msg.author.avatarURL({ format: "webp", size: 128 }),
					name: msg.member.displayName
				}
			});
		};

		let cz = <IGuildCustomize> JSON.parse(dbRow.customize);

		let visitor: ua.Visitor | undefined = undefined;
		if (cz.ua) {
			visitor = ua(cz.ua, msg.guild.id, {
				strictCidFormat: false,
				https: true,
				uid: msg.member.id
			});
		}

		if (cz.invite_only && (!cz.invites || !cz.invites.includes(msg.member.id))) {
			visitor && visitor.event("Members", "Not invited join attempt", msg.member.id).send();
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_JOIN_IOERR")
			});
		}

		if (cz.banned && Array.isArray(cz.banned) && cz.banned.includes(msg.member.id)) {
			visitor && visitor.event("Members", "Banned join attempt", msg.member.id).send();
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_JOIN_BANNEDERR")
			});
		}

		const _msg = <Message> await msg.channel.send({
			embed: await getEmbed(await localizeForUser(msg.member, "GUILDS_JOIN_PROGRESS", {
				guildName: escapeDiscordMarkdown(dbRow.name, true)
			}))
		});

		if (cz.rules) {
			const code = (randomString(6)).toUpperCase();

			let __msg: Message | undefined = undefined;

			// reuse?
			const embedTitle = await localizeForUser(msg.member, "GUILDS_JOIN_RULES_TITLE", {
				guildName: escapeDiscordMarkdown(dbRow.name, true)
			});

			try {
				__msg = <Message> await msg.author.send({
					embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
						custom: true,
						string: cz.rules
					}, {
						universalTitle: embedTitle,
						fields: [{
							name: await localizeForUser(msg.member, "GUILDS_JOIN_RULES_FIELDS_CODE"),
							value: code
						}],
						footerText: await localizeForUser(msg.member, "GUILDS_JOIN_RULES_FOOTER_TEXT")
					})
				});
			} catch (err) {
				return _msg.edit({
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
						key: "GUILDS_JOIN_FAILED_DM",
						formatOptions: {
							guildName: escapeDiscordMarkdown(dbRow.name, true)
						}
					})
				});
			}

			await _msg.edit({
				embed: await getEmbed(await localizeForUser(msg.member, "GUILDS_JOIN_PROGRESS_RULES", {
					guildName: escapeDiscordMarkdown(dbRow.name, true)
				}))
			});

			let confirmed = false;
			if (!$botConfig.sharded) {
				try {
					const msgs = await waitForMessages(<DMChannel> __msg.channel, {
						time: 60 * 1000,
						variants: [code, code.toLowerCase(), "-"],
						maxMatches: 1,
						max: 1,
						authors: [msg.author.id]
					});
					confirmed = msgs.first().content.toLowerCase() === code.toLowerCase();
				} catch (err) {
					confirmed = false;
				}
			} else if (process.send) {
				process.send({
					type: SHARDING_MESSAGE_TYPE.PENDING_INVITE_CREATE,
					payload: {
						uid: msg.author.id,
						code
					}
				});

				confirmed = await (new Promise<boolean>((res) => {
					let t: NodeJS.Timer; // predefines
					let resolve: (v: boolean) => void;

					const listener = (ipcMsg: IPCMessage<{
						uid: string
					}>) => {

						// We actully could not use variable statements
						// because TypeScript doesn't find them relative
						// so if it would be a separate variable, then we
						// would not be able to check `ipcMsg.type` on bottom

						if (
							(typeof ipcMsg !== "object" || !ipcMsg.payload) ||
							(ipcMsg.type !== SHARDING_MESSAGE_TYPE.RULES_ACCEPTED &&
								ipcMsg.type !== SHARDING_MESSAGE_TYPE.RULES_REJECTED) ||
							ipcMsg.payload.uid !== msg.author.id
						) {
							return;
						}

						clearTimeout(t);

						resolve(ipcMsg.type === SHARDING_MESSAGE_TYPE.RULES_ACCEPTED);
					};

					resolve = (v) => {
						if (process.send) {
							process.send({
								type: SHARDING_MESSAGE_TYPE.PENDING_INVITE_CLEAR,
								payload: { uid: msg.author.id }
							});
						}

						process.removeListener("message", listener);

						return res(v);
					};

					t = setTimeout(() => resolve(false), 60000);

					process.on("message", listener);
				}));
			} else {
				throw new Error("UNEXPECTED BEHAVIOR: Sharded run, but process.send isn't present");
			}

			if (!confirmed) {
				await msg.author.send({
					embed: await generateLocalizedEmbed(EmbedType.Warning, msg.member, {
						key: "GUILDS_JOIN_FAILED_RULES_DM",
						formatOptions: {
							guildName: escapeDiscordMarkdown(dbRow.name, true)
						}
					})
				});
				visitor && visitor.event("Members", "Rules rejected", msg.member.id).send();
				return _msg.edit({
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
						key: "GUILDS_JOIN_FAILED_RULES",
						formatOptions: {
							guildName: escapeDiscordMarkdown(dbRow.name, true)
						}
					})
				});
			}

			await __msg.edit({
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
					custom: true,
					string: cz.rules
				}, {
					universalTitle: embedTitle,
					footerText: await localizeForUser(msg.member, "GUILDS_JOIN_RULES_FOOTER_TEXT_OK")
				})
			});

			visitor && visitor.event("Members", "Rules accepted", msg.member.id).send();
		}

		try {
			dbRow = await this._getGuildRow(msg.guild, guildName);
		} catch (err) {
			this.log("err", "Failed to get guild", err);
			$snowball.captureException(err, { extra: messageToExtra(msg) });
			dbRow = undefined;
		}

		if (!dbRow) {
			return _msg.edit({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_JOIN_FAILED_DESTROYED")
			});
		}

		role = msg.guild.roles.get(dbRow.roleId);

		cz = <IGuildCustomize> JSON.parse(dbRow.customize);

		if (!role) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_JOIN_FAILED_ROLEDELETED")
			});
		}

		try {
			await msg.member.roles.add(role, await localizeForGuild(msg.guild, "GUILDS_AUDITLOG_JOINED_GUILD", {
				guildName: dbRow.name
			}));
			visitor && visitor.event("Members", "Joined", msg.member.id).send();
		} catch (err) {
			return _msg.edit({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_JOIN_FAILED_ROLEASSIGN")
			});
		}

		if (cz.welcome_msg && cz.welcome_msg_channel) {
			const channel = msg.guild.channels.get(cz.welcome_msg_channel);
			if (!channel || channel.type !== "text") { return; }
			await (<TextChannel> channel).send(cz.welcome_msg.replace("{usermention}", `<@${msg.author.id}>`).replace("{username}", escapeDiscordMarkdown(msg.author.username, true)));
		}

		if (cz.invite_only) {
			const invites = cz.invites!;
			invites.splice(invites.indexOf(msg.member.id), 1);
			cz.invites = invites;
			dbRow.customize = JSON.stringify(cz);
			await this._updateGuildRow(dbRow);
		}

		if (cz.rules) {
			await msg.author.send({
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
					key: "GUILDS_JOIN_JOINED_RULES_DM",
					formatOptions: {
						guildName: escapeDiscordMarkdown(dbRow.name, true),
						serverName: escapeDiscordMarkdown(msg.guild.name, true)
					}
				}, { universalTitle: await localizeForUser(msg.member, "GUILDS_JOIN_JOINED_RULES_DM_TITLE") })
			});
		}

		return _msg.edit({
			embed: await generateLocalizedEmbed(EmbedType.Tada, msg.member, {
				key: "GUILDS_JOIN_DONE",
				formatOptions: {
					guildName: escapeDiscordMarkdown(dbRow.name, true)
				}
			}, {
				author: {
					icon_url: msg.author.displayAvatarURL({ format: "webp", size: 128 }),
					name: msg.member.displayName
				}
			})
		});
	}

	private async _getGuildInfo(msg: Message) {
		const guildName = msg.content.slice(CMD_GUILDS_INFO.length).trim();
		if (guildName.length === 0) {
			return this._sendHelp(<TextChannel> msg.channel, CMD_GUILDS_INFO, msg.member);
		}

		let dbRow: IGuildRow | undefined = undefined;
		try {
			dbRow = await this._getGuildRow(msg.guild, guildName);
		} catch (err) {
			this.log("err", "Failed to get guild", err);
			$snowball.captureException(err, { extra: messageToExtra(msg) });
			dbRow = undefined;
		}

		if (!dbRow) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_GUILDNOTFOUND")
			});
		}

		const role = msg.guild.roles.get(dbRow.roleId);
		if (!role) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_INFO_FAILED_ROLEFAILURE")
			});
		}

		const guildAuthor = msg.guild.members.get(dbRow.ownerId);

		const fields: IEmbedOptionsField[] = [];

		const guildMembers = msg.guild.members.filter(member => dbRow ? member.roles.has(dbRow.roleId) : false);

		fields.push({
			name: await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_MEMBERS"),
			value: await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_MEMBERS_VALUE", {
				count: guildMembers.size
			}),
			inline: true
		});

		const isMember = msg.member.roles.has(dbRow.roleId);

		fields.push({
			name: await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_MEMBER"),
			value: await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_MEMBER_VALUE", {
				member: isMember,
				greenTick: this._config.emojis.greenTick,
				redTick: this._config.emojis.redTick
			}),
			inline: true
		});

		const cz = <IGuildCustomize> JSON.parse(dbRow.customize);

		if (cz.invite_only) {
			let str = "";
			if (isMember) {
				if (dbRow.ownerId === msg.member.id) {
					str = await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_IOSTATUS_VALUE_OWNER");
				} else if (rightsCheck(msg.member, dbRow)) {
					str = await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_IOSTATUS_VALUE_ADMIN");
				} else {
					str = await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_IOSTATUS_VALUE_MEMBER");
				}
			} else {
				str = await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_IOSTATUS_VALUE_INVITED", {
					invited: cz.invites ? cz.invites.includes(msg.author.id) : false,
					greenTick: this._config.emojis.greenTick,
					redTick: this._config.emojis.redTick
				});
			}
			fields.push({
				name: await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_IOSTATUS"),
				value: str
			});
		}

		return msg.channel.send({
			embed: await generateLocalizedEmbed(EmbedType.Empty, msg.member, {
				custom: true,
				string: dbRow.description || await localizeForUser(msg.member, "GUILDS_INFO_DESCRIPTIONPLACEHOLDER")
			}, {
					fields,
					author: guildAuthor ? {
						icon_url: guildAuthor.user.displayAvatarURL({ format: "webp", size: 128 }),
						name: guildAuthor.displayName
					} : {
							icon_url: msg.guild.iconURL({ format: "webp", size: 128 }),
							name: msg.guild.name
						},
					imageUrl: cz.image_url,
					thumbUrl: cz.icon_url,
					title: dbRow.name,
					footer: {
						icon_url: msg.guild.iconURL({ format: "webp", size: 128 }),
						text: msg.guild.name
					},
					ts: role.createdAt
				})
		});
	}

	private async _membersControl(msg: Message) {
		if (msg.content === CMD_GUILDS_MEMBERS) { return; } // TODO: add instructions lata?
		let args = msg.content.split(",").map(arg => arg.trim());
		args[0] = args[0].slice(CMD_GUILDS_MEMBERS.length).trim();
		args = args.filter(arg => arg.trim() !== "");
		// !guilds members guildName, [list/kick/add] <@mention>
		// guildName, list
		// guildName, kick, @mention
		// guildName, add, @mention
		// guildName, ban, @mention
		if (args.length < 2) { return; }

		let dbRow: IGuildRow | undefined = undefined;
		try {
			dbRow = await this._getGuildRow(msg.guild, args[0]);
		} catch (err) {
			this.log("err", "Failed to get guild", err);
			$snowball.captureException(err, { extra: messageToExtra(msg) });
			dbRow = undefined;
		}

		if (!dbRow) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_GUILDNOTFOUND")
			});
		}

		if (!msg.guild.roles.has(dbRow.roleId)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_INFO_FAILED_ROLEFAILURE")
			});
		}

		if (args[1] === "list") {
			return this._membersControlAction(msg, dbRow, "list");
		} else if (["kick", "ban", "unban"].includes(args[1]) && args.length > 2) {
			if (msg.mentions.users.size === 0) {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_MEMBERSCONTROL_NOMENTIONS")
				});
			}
			if (!rightsCheck(msg.member, dbRow, false)) {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_NOPERMISSIONS")
				});
			}
			return this._membersControlAction(msg, dbRow, <"kick" | "ban" | "unban"> args[1]);
		}
	}

	private static _membersControlFixString(str: string) { return replaceAll(str, "`", "'"); }

	private async _membersControlAction(msg: Message, dbRow: IGuildRow, action: "list" | "kick" | "ban" | "unban" | "add") {
		let statusMsg = <Message> await msg.channel.send({
			embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "GUILDS_MEMBERSCONTROL_LOADING")
		});

		const members = msg.guild.members.filter(m => m.roles.has(dbRow.roleId));

		const cz = <IGuildCustomize> JSON.parse(dbRow.customize);

		let visitor: ua.Visitor | undefined = undefined;
		if (cz.ua) {
			visitor = ua(cz.ua, msg.guild.id, {
				strictCidFormat: false,
				https: true,
				uid: msg.member.id
			});
		}

		switch (action) {
			case "list": {
				let str = `# ${await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_LIST", {
					guildName: Guilds._membersControlFixString(dbRow.name)
				})}`;

				let ownerStr: string | undefined;
				const admins: string[] = [];
				const otherMembers: string[] = [];

				for (const member of members.values()) {
					const memberEntry = `- ${Guilds._membersControlFixString(member.displayName)}`;

					const isOwner = rightsCheck(member, dbRow, true);
					if (isOwner) {
						ownerStr = memberEntry;
						continue;
					} // owner

					if (!isOwner && rightsCheck(member, dbRow, false)) {
						admins.push(memberEntry);
						continue;
					}

					otherMembers.push(memberEntry);
				}

				let membersStr = "";
				membersStr += `## ${await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_LIST_OWNER")}`;
				membersStr += `- ${ownerStr || "[Owner left](This guild is owned by server)"}\n\n`;

				if (admins.length > 0) {
					membersStr += `## ${await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_LIST_ADMINS")}\n`;
					membersStr += `${admins.join("\n")}\n\n`;
				}

				membersStr += `## ${await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_LIST_EVERYONE")}\n`;
				membersStr += otherMembers.join("\n");

				str += `\n\n${membersStr}`;

				statusMsg = await statusMsg.edit({
					embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "GUILDS_MEMBERSCONTROL_SENDING")
				});

				try {
					await msg.author.send(str, {
						split: true,
						code: "md"
					});
					statusMsg = await statusMsg.edit({
						embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "GUILDS_MEMBERSCONTROL_SENT")
					});
				} catch (err) {
					statusMsg = await statusMsg.edit({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_MEMBERSCONTROL_SENDINGERR")
					});
				}
			} break;
			case "kick": case "ban": case "unban": {
				if (msg.mentions.users.size > 20) {
					statusMsg = await statusMsg.edit({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_MEMBERSCONTROL_MAXMENTIONS")
					});
				}

				let str = "";
				let affected = 0;

				if (action === "unban" && (!cz.banned || cz.banned.length === 0)) {
					statusMsg = await statusMsg.edit({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_MEMBERSCONTROL_NONEBANNED")
					});
				}

				for (const mention of msg.mentions.users.values()) {
					const member = msg.guild.members.get(mention.id);
					let adminRemoved = false;

					if (!member) {
						str += `${await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_NOTAMEMBEROFSERVER", {
							username: escapeDiscordMarkdown(mention.username, true)
						})}\n`;
						continue;
					}

					if (rightsCheck(msg.member, dbRow, true)) {
						// command called by admin or guild owner
						if (rightsCheck(member, dbRow, false)) {
							const cz = <IGuildCustomize> JSON.parse(dbRow.customize);
							const index = (cz.admins || []).indexOf(member.id);
							if (index < 0) {
								str += `${await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_SERVERADM", {
									username: escapeDiscordMarkdown(mention.username, true)
								})}\n`;
								continue;
							}
							cz.admins.splice(index, 1);
							dbRow.customize = JSON.stringify(cz);
							await this._updateGuildRow(dbRow);
							adminRemoved = true;
						}
					} else if (rightsCheck(member, dbRow, false)) {
						str += `${await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_GUILDADMOROWNR", {
							username: escapeDiscordMarkdown(mention.username, true)
						})}\n`;
						continue;
					}

					if (!member.roles.has(dbRow.roleId)) {
						if (action === "kick") {
							str += `${await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_NOTAMEMBER", {
								username: escapeDiscordMarkdown(member.displayName, true)
							})}\n`;
							continue;
						}
					} else {
						await member.roles.remove(dbRow.roleId, await localizeForGuild(msg.guild, action === "kick" ? "GUILDS_AUDITLOG_KICKED" : "GUILDS_AUDITLOG_BANNED", {
							initiator: msg.author.tag,
							guildName: dbRow.name
						}));
					}

					if (action === "kick") {
						str += `${await localizeForUser(msg.member, adminRemoved ? "GUILDS_MEMBERSCONTROL_KICKEDADMITEM" : "GUILDS_MEMBERSCONTROL_KICKEDITEM", {
							username: escapeDiscordMarkdown(member.displayName, true)
						})}\n`;
						visitor && visitor.event("Users Management", "Member kicked", member.id).send();
					} else if (action === "ban") {
						if (!cz.banned) { cz.banned = []; }
						cz.banned.push(member.id);
						str += `${await localizeForUser(msg.member, adminRemoved ? "GUILDS_MEMBERSCONTROL_BANNEDADMITEM" : "GUILDS_MEMBERSCONTROL_BANNEDITEM", {
							username: escapeDiscordMarkdown(member.displayName, true)
						})}\n`;
						visitor && visitor.event("Users Management", "Member banned", member.id).send();
					} else if (action === "unban") {
						if (!cz.banned) { break; }
						const index = cz.banned.indexOf(member.id);
						if (index === -1) {
							str += `${await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_NOTBANNED", {
								username: escapeDiscordMarkdown(member.displayName, true)
							})}\n`;
							continue;
						}
						cz.banned.splice(index, 1);
						str += `${await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_UNBANNEDITEM", {
							username: escapeDiscordMarkdown(member.displayName, true)
						})}\n`;
					}
					affected++;
				}
				if (action === "ban" || action === "unban") {
					if (cz.banned && cz.banned.length === 0) {
						delete cz.banned;
					}
					dbRow.customize = JSON.stringify(cz);
					await this._updateGuildRow(dbRow);
				}
				statusMsg = await statusMsg.edit({
					embed: await generateLocalizedEmbed(affected === 0 ? EmbedType.Error : EmbedType.OK, msg.member, {
						custom: true,
						string: str
					}, {
						title: await localizeForUser(msg.member, action === "kick" ? "GUILDS_MEMBERSCONTROL_KICKED" : (action === "ban" ? "GUILDS_MEMBERSCONTROL_BANNED" : "GUILDS_MEMBERSCONTROL_UNBANNED"), {
							members: affected
						})
					})
				});
			} break;
		}
	}

	private async _inviteToGuild(msg: Message) {
		if (msg.content === CMD_GUILDS_INVITE) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "GUILDS_INVITE_INFO")
			});
		}

		const args = msg.content.split(",").map(arg => arg.trim());
		if (args.length === 1) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "GUILDS_INVITE_USAGE",
					formatOptions: {
						prefix: CMD_GUILDS_INVITE
					}
				})
			});
		}

		args[0] = args[0].slice(CMD_GUILDS_INVITE.length + 1);

		let dbRow: IGuildRow | undefined = undefined;
		try {
			dbRow = await this._getGuildRow(msg.guild, args[0]);
			// args[0] supposed to be guild name
		} catch (err) {
			this.log("err", "Failed to get guild", err);
			$snowball.captureException(err, { extra: messageToExtra(msg) });
			dbRow = undefined;
		}

		if (!dbRow) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_GUILDNOTFOUND")
			});
		}

		const isRevoke = args[1] === "revoke";

		const cz = <IGuildCustomize> JSON.parse(dbRow.customize);

		if (!rightsCheck(msg.member, dbRow)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_NOPERMISSIONS")
			});
		}

		if (msg.mentions.users.size === 0) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_INVITE_NOMENTIONS")
			});
		}

		if (!cz.invites && isRevoke) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_INVITE_NOINVITES")
			});
		}

		let invited = 0;
		let revoked = 0;
		let str = "";

		if (isRevoke && cz.invites) {
			const a = cz.invites.length;
			for (const [uid, mention] of msg.mentions.users) {
				const index = cz.invites.indexOf(uid);
				if (index === -1) {
					str += `${await localizeForUser(msg.member, "GUILDS_INVITE_NOTINVITED", {
						username: escapeDiscordMarkdown(mention.username, true)
					})}\n`;
					continue;
				}
				cz.invites.splice(index, 1);
				str += `${await localizeForUser(msg.member, "GUILDS_INVITE_REVOKEDITEM", {
					username: escapeDiscordMarkdown(mention.username, true)
				})}\n`;
			}
			for (const uid of cz.invites) {
				const index = cz.invites.indexOf(uid);
				const member = msg.guild.members.get(uid);
				if (member) {
					if (!member.roles.has(dbRow.roleId)) {
						continue;
					} else {
						str += `${await localizeForUser(msg.member, "GUILDS_INVITE_AUTOREVOKED_1", {
							username: escapeDiscordMarkdown(member.displayName, true)
						})}\n`;
					}
				} else {
					str += `${await localizeForUser(msg.member, "GUILDS_INVITE_AUTOREVOKED", {
						id: `${uid}`
					})}\n`;
				}
				cz.invites.splice(index, 1);
			}
			revoked = a - cz.invites.length;
		} else {
			if (!cz.invites) { cz.invites = []; }
			for (const [userId, userObj] of msg.mentions.users) {
				const member = msg.guild.members.get(userId);
				if (!member) {
					str += `${await localizeForUser(msg.member, "GUILDS_INVITE_NOTAMEMBER", {
						username: escapeDiscordMarkdown(userObj.username, true)
					})}\n`;
					continue;
				}
				if (member.roles.has(dbRow.roleId)) {
					str += `${await localizeForUser(msg.member, "GUILDS_INVITE_GUILDMEMBER", {
						username: escapeDiscordMarkdown(userObj.username, true)
					})}\n`;
					continue;
				}
				if (cz.invites.includes(userId)) {
					str += `${await localizeForUser(msg.member, "GUILDS_INVITE_ALREADYINVITED", {
						username: escapeDiscordMarkdown(userObj.username, true)
					})}\n`;
					continue;
				}
				cz.invites.push(userId);
				try {
					await member.send({
						embed: await generateLocalizedEmbed(EmbedType.Information, member, {
							key: "GUILDS_INVITE_INVITEMSG",
							formatOptions: {
								prefix: BASE_PREFIX,
								guildName: escapeDiscordMarkdown(dbRow.name, true),
								serverName: escapeDiscordMarkdown(msg.guild.name, true),
								RAWguildName: dbRow.name
							}
						})
					});
					str += `${await localizeForUser(msg.member, "GUILDS_INVITE_INVITESENT", {
						username: escapeDiscordMarkdown(member.displayName, true)
					})}\n`;
				} catch (err) {
					str += `${await localizeForUser(msg.member, "GUILDS_INVITE_NOTSENT", {
						username: escapeDiscordMarkdown(member.displayName, true)
					})}\n`;
				}
				invited++;
			}
		}

		dbRow.customize = JSON.stringify(cz);

		await this._updateGuildRow(dbRow);

		if (isRevoke) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(revoked === 0 ? EmbedType.Error : EmbedType.OK, msg.member, {
					custom: true, string: str
				}, { title: await localizeForUser(msg.member, "GUILDS_INVITE_REVOKED", { revoked }) })
			});
		} else {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(invited === 0 ? EmbedType.Error : EmbedType.OK, msg.member, {
					custom: true, string: str
				}, { title: await localizeForUser(msg.member, "GUILDS_INVITE_INVITED", { invited }) })
			});
		}
	}

	private async _getGuildsList(msg: Message) {
		const pageVal = msg.content.slice(CMD_GUILDS_LIST.length);
		let list = 1;
		if (pageVal !== "") {
			list = Math.max(1, Math.abs(Math.round(parseInt(pageVal, 10))));
			if (isNaN(list)) {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_LIST_WRONGUSAGE")
				});
			}
		}

		const dbResp = await this._getGuilds(msg.guild, (10 * list) - 10, 10);
		if (dbResp.rows.length === 0) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "GUILDS_LIST_EMPTYPAGE")
			});
		}

		const fields: IEmbedOptionsField[] = [];
		for (const row of dbResp.rows) {
			fields.push({
				inline: false,
				name: row.name,
				value: row.description && row.description.length > 0 ? row.description : await localizeForUser(msg.member, "GUILDS_LIST_DESCRIPTIONPLACEHOLDER")
			});
		}

		return msg.channel.send({
			embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
				key: "GUILDS_LIST_JOININFO",
				formatOptions: {
					prefix: BASE_PREFIX
				}
			}, { informationTitle: await localizeForUser(msg.member, "GUILDS_LIST_PAGE", { list }), fields })
		});
	}

	// ==============================
	// DB functions
	// ==============================

	private _createGID() { return reverseString(Date.now().toString(16)); }

	/**
	 * @deprecated
	 */
	private async _getGuilds(guild: Guild, offset: number = 0, limit: number = 10) {
		return this._dbController.getGuilds(
			guild, offset, limit
		);
	}

	/**
	 * @deprecated
	 */
	private async _getGuildRow(guild: Guild, name: string) : Promise<IGuildRow> {
		return this._dbController.getGuild(guild, name);
	}

	/**
	 * @deprecated
	 */
	private async _updateGuildRow(guildRow: IGuildRow) : Promise<void> {
		return this._dbController.updateGuild(guildRow);
	}

	/**
	 * @deprecated
	 */
	private async _createGuildRow(guild: Guild, name: string, ownerId: string, roleId: string) : Promise<void> {
		return this._dbController.createGuild(guild, name, ownerId, roleId);
	}

	/**
	 * @deprecated
	 */
	private async _deleteGuildRow(guildRow: IGuildRow) : Promise<void> {
		return this._dbController.deleteGuild(guildRow);
	}

	// private async _getOrCreateGuildRow(guild: Guild, name: string) {
	// 	let element = await this._getGuildRow(guild, name);
	// 	if (!element) {
	// 		await this._createGuildRow(guild, name);
	// 		element = await this._getGuildRow(guild, name);
	// 		if (!element) {
	// 			throw new Error("Can't create guild row at current moment.");
	// 		}
	// 	}
	// 	return element;
	// }

	// ==============================
	// Plugin functions
	// ==============================

	public async init() {
		if (!$modLoader.isPendingInitialization(this.signature)) {
			throw new Error("This module doesn't pending initialization");
		}

		await this._dbController.init();

		this.log("ok", "Loaded and ready to work");
		this.handleEvents();
	}

	public async unload() {
		if (!$modLoader.isPendingUnload(this.signature)) {
			throw new Error("This module doesn't pending unload");
		}

		if (this._processMessageListener) {
			// removing listeners
			process.removeListener("message", this._processMessageListener);
		}
		this.unhandleEvents();
		return true;
	}
}

module.exports = Guilds;
