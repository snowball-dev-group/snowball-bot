import { IModule } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message, Guild, GuildMember, Role, TextChannel, DMChannel, DiscordAPIError, Emoji } from "discord.js";
import { getLogger, EmbedType, IEmbedOptionsField, resolveGuildRole, escapeDiscordMarkdown } from "../utils/utils";
import { getDB, createTableBySchema } from "../utils/db";
import { default as fetch } from "node-fetch";
import { createConfirmationMessage, waitForMessages } from "../utils/interactive";
import * as ua from "universal-analytics";
import { parse as parseURI } from "url";
import { replaceAll } from "../utils/text";
import { command } from "../utils/help";
import { localizeForUser, generateLocalizedEmbed, localizeForGuild } from "../utils/ez-i18n";
import { randomString } from "../utils/random";
import { IPCMessage, INullableHashMap } from "../../types/Types";
import { messageToExtra } from "../utils/failToDetail";

const TABLE_NAME = "guilds";

const TABLE_SCHEMA = {
	// unique guild id
	"gid": "string",
	// discord guild snowflake
	"guildId": "string",
	// guild role id
	"roleId": "string",
	// owner discord id
	"ownerId": "string",
	// guild name
	"name": "string",
	// description
	"description": "string",
	// guild styles
	"customize": {
		type: "TEXT"
	}
};

const BANNED_HOSTS = ["goo.gl", "grabify.link", "bit.ly"];
const EMOJI_NAME_REGEXP = /[a-z0-9\_\-]{2,36}/i;
const EMOJI_ACCESSIBLE_FORMATS = [".png", ".webp", ".jpg", ".gif"];

function isHostBanned(host: string) {
	if(host.startsWith("www.")) {
		host = host.slice("www.".length);
	}
	return BANNED_HOSTS.includes(host);
}

export interface IGuildsModuleConfig {
	emojis: {
		greenTick: string;
		redTick: string;
	};
}

export interface IGuildRow {
	/**
	 * Discord Guild SNOWFLAKE
	 */
	guildId: string;
	/**
	 * Discord Role SNOWFLAKE
	 */
	roleId: string;
	/**
	 * Name of Guild
	 */
	name: string;
	/**
	 * Description of guild
	 */
	description: string;
	/**
	 * Customize JSON
	 */
	customize: string | any;
	/**
	 * Unique Guild ID
	 */
	gid: string;
	/**
	 * Owner ID
	 */
	ownerId: string;
}

export interface IGuildCustomize {
	/**
	 * Guild admins who can control it
	 */
	admins: string[];
	/**
	 * Is this guild private?
	 */
	invite_only?: boolean;
	/**
	 * Google Analystic key
	*/
	ua?: string;
	/**
	 * Welcome message
	 */
	welcome_msg?: string;
	/**
	 * Channel for welcome message
	 */
	welcome_msg_channel?: string;
	/**
	 * Guild invites
	 * (for private guilds)
	 */
	invites?: string[];
	/**
	 * Big image in information block
	 */
	image_url?: string;
	/**
	 * Icon URL
	 */
	icon_url?: string;
	/**
	 * Guild rules
	 */
	rules?: string;
	/**
	 * Banned users
	 */
	banned?: string[];
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

function isServerAdmin(member: GuildMember) {
	return member.permissions.has(["MANAGE_CHANNELS", "MANAGE_ROLES"], true);
}

function rightsCheck(member: GuildMember, row?: IGuildRow, noAdmins = false) {
	const checkA = isServerAdmin(member);
	let checkB = false;
	if(row) {
		const cz = JSON.parse(row.customize) as IGuildCustomize;
		checkB = row.ownerId === member.id || member.id === $botConfig.botOwner;
		if(!noAdmins) {
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

	log = getLogger("Guilds");
	db = getDB();

	config: IGuildsModuleConfig;

	pendingInvites: INullableHashMap<{ code: string; }> = Object.create(null);
	processMessageListener?: ((msg: any) => void);

	constructor(config: IGuildsModuleConfig) {
		super({
			"message": (msg: Message) => this.onMessage(msg)
		}, true);

		if(!config) {
			throw new Error("No config passed");
		}

		if($botConfig.sharded) {
			this.processMessageListener = (msg) => {
				if(typeof msg !== "object") { return; }
				if(msg.type && !msg.type.startsWith("guilds:")) { return; }
				if(msg.type === "guilds:rules:pending_clear" && msg.payload) {
					// payload: <{uid: string}>
					if(!msg.payload.uid) { return; }
					if(!this.pendingInvites[msg.payload.uid]) { return; }
					delete this.pendingInvites[msg.payload.uid];
				} else if(msg.type === "guilds:rules:pending" && msg.payload) {
					if(!msg.payload.uid || !msg.payload.code) { return; }
					this.pendingInvites[msg.payload.uid] = { code: msg.payload.code };
				}
			};
			process.on("message", this.processMessageListener);
		}

		for(const emojiName in config.emojis) {
			const emojiId = config.emojis[emojiName];
			const emoji = $discordBot.emojis.get(emojiId);
			if(!emoji) { throw new Error(`Emoji "${emojiName}" by ID "${emojiId}" wasn't found`); }
			config.emojis[emojiName] = emoji.toString();
		}

		this.config = config;

		// this.init();
	}

	// ==============================
	// Messages handling
	// ==============================

	async onMessage(msg: Message) {
		if(msg.channel.type === "dm") {
			await this.dmCodeHandler(msg);
			return;
		}
		try {
			if(msg.content === BASE_PREFIX) {
				await this.sendHelp(msg.channel as TextChannel, undefined, msg.member);
			} else if(msg.content.startsWith(BASE_PREFIX)) {
				if(this.startsOrEqual(msg.content, CMD_GUILDS_LIST)) {
					await this.getGuildsList(msg);
				} else if(this.startsOrEqual(msg.content, CMD_GUILDS_CREATE)) {
					await this.createGuild(msg);
				} else if(this.startsOrEqual(msg.content, CMD_GUILDS_EDIT)) {
					await this.editGuild(msg);
				} else if(this.startsOrEqual(msg.content, CMD_GUILDS_DELETE)) {
					await this.deleteGuild(msg);
				} else if(this.startsOrEqual(msg.content, CMD_GUILDS_INFO)) {
					await this.getGuildInfo(msg);
				} else if(this.startsOrEqual(msg.content, CMD_GUILDS_INVITE)) {
					await this.inviteToGuild(msg);
				} else if(this.startsOrEqual(msg.content, CMD_GUILDS_MEMBERS)) {
					await this.membersControl(msg);
				} else {
					await this.joinLeaveGuild(msg);
				}
			}
		} catch(err) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_RUNNINGFAILED")
			});
			this.log("err", "Error at running cmd", msg.content, "\n", err);
			$snowball.captureException(err, { extra: messageToExtra(msg) });
		}
	}

	startsOrEqual(str: string, to: string) {
		return str === to || str.startsWith(to);
	}

	// ==============================
	// Handlers
	// ==============================

	async dmCodeHandler(msg: Message) {
		if(msg.channel.type !== "dm") { return; } // non-dm msg
		if(!process.send) { return; } // non-sharded run

		const pendingInvite = this.pendingInvites[msg.author.id];
		if(!pendingInvite) { return; } // no pending invites
		if(pendingInvite.code.toLowerCase() === msg.content.toLowerCase()) {
			process.send({
				type: "guilds:rules:accept",
				payload: {
					uid: msg.author.id
				}
			});
		} else if(msg.content === "-") {
			process.send({
				type: "guilds:rules:reject",
				payload: {
					uid: msg.author.id
				}
			});
		}
	}

	async sendHelp(channel: TextChannel, article: string = "guilds", member: GuildMember) {
		let str = "";
		switch(article) {
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
		return channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Information, member, {
				custom: true,
				string: str
			})
		});
	}

	async createGuild(msg: Message) {
		// !guilds create Overwatch, !Overwatch
		if(msg.content === CMD_GUILDS_CREATE) {
			this.sendHelp(msg.channel as TextChannel, CMD_GUILDS_CREATE, msg.member);
			return;
		}

		if(!rightsCheck(msg.member)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_NOPERMISSIONS")
			});
			return;
		}

		const args = msg.content.slice(CMD_GUILDS_CREATE.length).split(",").map(arg => arg.trim());
		if(args.length > 2) {
			// Overwatch, Overwatch, friends!
			const fields: IEmbedOptionsField[] = [];
			if((msg.content.match(/\,/g) || []).length > 1) {
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
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_WRONGARGSCOUNT", {
					fields: []
				})
			});
			return;
		}

		if(["create", "edit", "invite", "delete", "list", "info"].includes(args[0].toLowerCase())) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_RESERVEDNAME")
			});
			return;
		}

		// search if we already having role with this name
		let dbRow: IGuildRow | undefined = await this.getGuildRow(msg.guild, args[0]);

		if(dbRow) {
			if(!msg.guild.roles.has(dbRow.roleId)) {
				return msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_ALREADYFOUND_NOROLE")
				});
			}
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_ALREADYFOUND_ROLE")
			});
			return;
		}

		let role: Role | undefined = undefined;

		if(args.length === 1) {
			const roleName = `${DEFAULT_ROLE_PREFIX}${args[0]}`;

			// creating role
			const _confirmationEmbed = await generateLocalizedEmbed(EmbedType.Progress, msg.member, {
				key: "GUILDS_CREATE_ROLECREATING_CONFIRMATION",
				formatOptions: {
					roleName
				}
			});

			const confirmation = await createConfirmationMessage(_confirmationEmbed, msg);

			if(!confirmation) {
				await msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CANCELED")
				});
				return;
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
			role = resolveGuildRole(args[1], msg.guild);
			if(!role) {
				await msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_RESOLVINGFAILED")
				});
				return;
			}
		}

		try {
			await msg.member.addRole(role, await localizeForGuild(msg.guild, "GUILDS_AUDITLOG_CREATED_OWNER", {
				guildName: args[0]
			}));
		} catch(err) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_ROLEASSIGNATIONFAILED")
			});
			return;
		}

		await this.createGuildRow(msg.guild, args[0]);

		dbRow = await this.getGuildRow(msg.guild, args[0]);

		if(!dbRow) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CREATE_DBERROR")
			});
			return;
		}

		dbRow.roleId = role.id;
		dbRow.name = args[0];
		dbRow.customize = "{}";
		dbRow.ownerId = msg.member.id;

		await this.updateGuildRow(dbRow);

		await msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "GUILDS_CREATE_DONE")
		});
	}

	async editGuild(msg: Message) {
		// !guilds edit Overwatch, description, Для фанатов этой отвратительной игры
		if(msg.content === CMD_GUILDS_EDIT) {
			this.sendHelp(msg.channel as TextChannel, CMD_GUILDS_EDIT, msg.member);
			return;
		}

		const args = msg.content.slice(CMD_GUILDS_EDIT.length).split(",");

		let guildName = "", editableParam = "", content = "";
		// due to issues w/ typescript I made them ""

		{
			// nice argument parsing
			let currentElem: string; let i = 0;
			while((currentElem = args.splice(0, 1)[0]) !== undefined) {
				i++; if(i === 3) {
					break;
				}
				switch(i) {
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

		if(["image", "description", "rules", "welcome_msg_channel", "welcome_msg", "icon", "owner", "google-ua", "private", "invite_only", "add_admin", "add_adm", "remove_admin", "rm_admin", "delete_admin", "add_emoji", "remove_emoji"].indexOf(editableParam) === -1) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_INVALIDPARAM")
			});
			return;
		}

		let dbRow: IGuildRow | undefined = undefined;
		try {
			dbRow = await this.getGuildRow(msg.guild, guildName);
		} catch(err) {
			this.log("err", "Failed to get guild", err);
			dbRow = undefined;
		}

		if(!dbRow) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "GUILDS_EDIT_GUILDNOTFOUND")
			});
			return;
		}

		if(!rightsCheck(msg.member, dbRow)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_NOPERMISSIONS")
			});
			return;
		}

		const customize = JSON.parse(dbRow.customize) as IGuildCustomize;

		const isCalledByAdmin = !rightsCheck(msg.member, dbRow, true);

		let doneString = "";

		switch(editableParam) {
			case "image": case "icon": {
				// fetching first
				if(!content.startsWith("http://") && !content.startsWith("https://")) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_INVALIDLINK")
					});
					return;
				}
				const resolved = parseURI(content);
				if(resolved.hostname && isHostBanned(resolved.hostname)) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_INVALIDLINK")
					});
					return;
				}
				try {
					await fetch(encodeURI(content), {
						method: "GET"
					});
				} catch(err) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_IMAGELOADINGFAILED")
					});
					return;
				}
				if(editableParam === "image") {
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
				if(!channel) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_CHANNELNOTFOUND")
					});
					return;
				}
				if(channel.type !== "text") {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_WRONGCHANNEL")
					});
					return;
				}
				if((channel as TextChannel).guild.id !== msg.guild.id) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_OTHERCHANNEL")
					});
					return;
				}
				customize.welcome_msg_channel = content;
				doneString = await localizeForUser(msg.member, "GUILDS_EDIT_WELCOMECHANNELSET");
			} break;
			case "welcome_msg": {
				content = content.replace("@everyone", "@\u200Beveryone").replace("@here", "@\u200Bhere");
				if(!content.includes("{usermention}") && !content.includes("{username}")) {
					let confirmation = false;
					try {
						confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_NOUSERMENTION"), msg);
					} catch(err) {
						confirmation = false;
					}

					if(confirmation) {
						msg.channel.send("", {
							embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_CANCELED")
						});
						return;
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
				if(isCalledByAdmin) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_OWNERERR")
					});
					return;
				}
				const serverAdmin = isServerAdmin(msg.member);
				if(content.startsWith("<@") && content.endsWith(">")) {
					content = content.slice(2).slice(0, -1);
					if(content.startsWith("!")) {
						content = content.slice(1);
					}
				}
				const member = msg.guild.members.get(content);
				if(!member) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_MEMBERNOTFOUND")
					});
					return;
				}
				if(member.id === dbRow.ownerId) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
							key: "GUILDS_EDIT_TRANSFEROWNERSHIPTOOWNER",
							formatOptions: {
								serverAdmin
							}
						})
					});
					return;
				}
				const confirmation = await createConfirmationMessage(await generateLocalizedEmbed(EmbedType.Question, msg.member, {
					key: "GUILDS_EDIT_TRANSFERCONFIRMATION",
					formatOptions: {
						username: escapeDiscordMarkdown(member.displayName, true)
					}
				}), msg);
				if(!confirmation) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "GUILDS_CANCELED")
					});
					return;
				}
				dbRow.ownerId = member.id;
				if(customize.admins && customize.admins.includes(member.id)) {
					customize.admins.splice(customize.admins.indexOf(member.id), 1);
				}
				doneString = await localizeForUser(msg.member, "GUILDS_EDIT_TRANSFERDONE", {
					serverAdmin
				});
			} break;
			case "google-ua": {
				if(isCalledByAdmin) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_NOPERMS")
					});
					return;
				}
				if(!content.startsWith("UA-")) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_GOOGLEUAWRONGCODE")
					});
					return;
				}
				customize.ua = content;
				doneString = await localizeForUser(msg.member, "GUILDS_EDIT_GOOGLEUADONE");
			} break;
			case "invite_only": case "private": {
				if(isCalledByAdmin) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_NOPERMS")
					});
					return;
				}

				if(!["true", "false"].includes(content)) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_TRUEFALSEERR")
					});
					return;
				}

				if(content === "true" && customize.invite_only) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
							key: "GUILDS_EDIT_IOALREADY",
							formatOptions: {
								ioAlreadyEnabled: true
							}
						})
					});
					return;
				} else if(content === "false" && !customize.invite_only) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
							key: "GUILDS_EDIT_IOALREADY",
							formatOptions: {
								ioAlreadyEnabled: false
							}
						})
					});
					return;
				}

				customize.invite_only = content === "true";

				doneString = await localizeForUser(msg.member, "GUILDS_EDIT_IOCHANGED", {
					ioEnabled: customize.invite_only
				});
			} break;
			case "add_admin": case "add_adm": {
				if(isCalledByAdmin) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_ADDADMPERMS")
					});
					return;
				}
				if(msg.mentions.members.size === 0) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_ADDADMNOMENTIONS")
					});
					return;
				}
				if(msg.mentions.members.size > 1) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_ADDADMSINGLEMENTION")
					});
					return;
				}
				if(!customize.admins) {
					customize.admins = [] as string[];
				}
				const mention = msg.mentions.members.first().id;
				if(customize.admins.includes(mention)) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_ADDADMNOTGUILDMEMBER")
					});
					return;
				}
				customize.admins.push(mention);
			} break;
			case "remove_admin": case "rm_admin": case "delete_admin": case "rm_adm": {
				if(isCalledByAdmin) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_RMADMPERMS")
					});
					return;
				}
				if(msg.mentions.members.size === 0) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_NOMENTIONS")
					});
					return;
				}
				if(msg.mentions.members.size > 1) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_SINGLEMENTION")
					});
					return;
				}
				if(!customize.admins) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_RMNOADMINS")
					});
					return;
				}
				const mention = msg.mentions.members.first().id;
				customize.admins.splice(customize.admins.indexOf(mention), 1);
			} break;
			case "add_emoji": {
				if(!EMOJI_NAME_REGEXP.test(content)) {
					msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_INVALIDEMOJINAME")
					});
					return;
				}
				if(msg.attachments.size === 0) {
					msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_NOATTACHMENT")
					});
					return;
				} else if(msg.attachments.size > 1) {
					msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_TOOMANYATTACHMENTS")
					});
					return;
				}

				const attachment = msg.attachments.first();
				if(!EMOJI_ACCESSIBLE_FORMATS.find(t => attachment.url.endsWith(t))) {
					msg.channel.send({
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_INVALIDTYPE")
					});
					return;
				}

				const botsRole = msg.guild.me.roles.find(r => r.managed);

				let emoji: Emoji;
				try {
					emoji = await msg.guild.emojis.create(attachment.url, content, {
						roles: [dbRow.roleId, botsRole]
					});
				} catch(err) {
					if(err instanceof DiscordAPIError) {
						let key = "GUILDS_EDIT_EMOJIOTHERERR";
						switch(err.code) {
							case 50013: { key = "GUILDS_EDIT_NOEMOJIPERMISSIONS"; } break;
							case 30008: { key = "GUILDS_EDIT_NOSLOTS"; } break;
							case 20001: { key = "GUILDS_EDIT_BADFORBOT"; } break;
							default: {
								$snowball.captureException(new Error("Can't add emoji"), {
									extra: {
										err, name: content, uri: attachment.url
									}
								});
							} break;
						}

						msg.channel.send({
							embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, key)
						});
						return;
					}

					// ???
					$snowball.captureException(err);
					return;
				}

				if(!emoji) {
					// th
					return;
				}

				doneString = await localizeForUser(msg.member, "GUILDS_EDIT_EMOJICREATED", {
					name: emoji.name,
					emoji: botsRole ? emoji.toString() : ""
				});
			} break;
		}

		dbRow.customize = JSON.stringify(customize);

		await this.updateGuildRow(dbRow);

		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
				custom: true,
				string: doneString
			})
		});
	}

	async deleteGuild(msg: Message) {
		const guildName = msg.content.slice(CMD_GUILDS_DELETE.length).trim();
		if(guildName === "") {
			this.sendHelp(msg.channel as TextChannel, CMD_GUILDS_DELETE, msg.member);
			return;
		}

		let dbRow: IGuildRow | undefined = undefined;
		try {
			dbRow = await this.getGuildRow(msg.guild, guildName);
		} catch(err) {
			this.log("err", "Failed to get guild", err);
			dbRow = undefined;
		}

		if(!dbRow) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "GUILDS_EDIT_GUILDNOTFOUND")
			});
			return;
		}

		if(!rightsCheck(msg.member, dbRow, true)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_NOPERMISSIONS")
			});
			return;
		}

		const confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, "GUILDS_DELETE_CONFIRMATION");
		const confirmation = await createConfirmationMessage(confirmationEmbed, msg);

		if(!confirmation) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "GUILDS_CANCELED")
			});
			return;
		}

		await this.deleteGuildRow(dbRow);

		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "GUILDS_DELETE_DONE")
		});
	}

	async joinLeaveGuild(msg: Message) {
		// !guilds Overwatch
		const guildName = msg.content.slice(BASE_PREFIX.length).trim();
		if(guildName.length === 0) {
			this.sendHelp(msg.channel as TextChannel, undefined, msg.member);
			return;
		}

		let dbRow: IGuildRow | undefined = undefined;
		try {
			dbRow = await this.getGuildRow(msg.guild, guildName);
		} catch(err) {
			this.log("err", "Failed to get guild", err);
			dbRow = undefined;
		}

		if(!dbRow) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_GUILDNOTFOUND")
			});
			return;
		}

		const role = msg.guild.roles.get(dbRow.roleId);

		if(!role) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_LEAVE_NOROLE")
			});
			return;
		}

		if(!msg.member.roles.has(dbRow.roleId)) {
			await this.joinGuild(msg, dbRow, role, guildName);
		} else {
			await this.leaveGuild(msg, dbRow, role, guildName);
		}
	}

	async leaveGuild(msg: Message, dbRow: IGuildRow | undefined, role: Role | undefined, guildName: string) {
		if(!dbRow || !role) { return; }

		const cz = JSON.parse(dbRow.customize) as IGuildCustomize;

		if(dbRow.ownerId === msg.member.id || (cz.admins && cz.admins.includes(msg.member.id))) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_LEAVE_ADMIN")
			});
			return;
		}

		let visitor: ua.Visitor | undefined = undefined;
		if(cz.ua) {
			visitor = ua(cz.ua, msg.guild.id, {
				strictCidFormat: false,
				https: true,
				uid: msg.member.id
			});
		}

		let str = await localizeForUser(msg.member, "GUILDS_LEAVE_CONFIRMATION", {
			guildName: escapeDiscordMarkdown(dbRow.name, true)
		});

		if(cz.invite_only) {
			str += "\n";
			str += await localizeForUser(msg.member, "GUILDS_LEAVE_INVITEWARNING");
		}

		const confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
			custom: true,
			string: str
		});

		const confirmation = await createConfirmationMessage(confirmationEmbed, msg);
		if(!confirmation) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "GUILDS_CANCELED")
			});
			if(visitor) {
				visitor.event("Members", "Saved from leave", msg.member.id).send();
			}
			return;
		}

		try {
			dbRow = await this.getGuildRow(msg.guild, guildName);
		} catch(err) {
			this.log("err", "Failed to get guild", err);
			dbRow = undefined;
		}

		if(!dbRow) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_LEAVE_ALREADYDESTROYED")
			});
			return;
		}

		role = msg.guild.roles.get(dbRow.roleId);

		if(!role) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_LEAVE_ALREADYDELETEDROLE")
			});
			return;
		}

		try {
			await msg.member.removeRole(role, await localizeForGuild(msg.guild, "GUILDS_AUDITLOG_LEFT_GUILD", {
				guildName: dbRow.name
			}));
			if(visitor) {
				visitor.event("Members", "Left", msg.member.id).send();
			}
		} catch(err) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_LEAVE_ROLEFAILED")
			});
			return;
		}

		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
				key: "GUILDS_LEAVE_DONE",
				formatOptions: {
					guildName: escapeDiscordMarkdown(dbRow.name, true)
				}
			})
		});
	}

	async joinGuild(msg: Message, dbRow: IGuildRow | undefined, role: Role | undefined, guildName: string) {
		if(!dbRow || !role) { return; }

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

		let cz = JSON.parse(dbRow.customize) as IGuildCustomize;

		let visitor: ua.Visitor | undefined = undefined;
		if(cz.ua) {
			visitor = ua(cz.ua, msg.guild.id, {
				strictCidFormat: false,
				https: true,
				uid: msg.member.id
			});
		}

		if(cz.invite_only && (!cz.invites || !(cz.invites as string[]).includes(msg.member.id))) {
			if(visitor) {
				visitor.event("Members", "Not invited join attempt", msg.member.id).send();
			}
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_JOIN_IOERR")
			});
			return;
		}

		if(cz.banned && Array.isArray(cz.banned) && cz.banned.includes(msg.member.id)) {
			if(visitor) {
				visitor.event("Members", "Banned join attempt", msg.member.id).send();
			}
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_JOIN_BANNEDERR")
			});
			return;
		}

		const _msg = (await msg.channel.send("", {
			embed: await getEmbed(await localizeForUser(msg.member, "GUILDS_JOIN_PROGRESS", {
				guildName: escapeDiscordMarkdown(dbRow.name, true)
			}))
		})) as Message;

		let _dmRulesMsg: Message | undefined = undefined;

		if(cz.rules) {
			const code = (randomString(6)).toUpperCase();

			let __msg: Message | undefined = undefined;

			try {
				__msg = (await msg.author.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
						custom: true,
						string: cz.rules
					}, {
							title: await localizeForUser(msg.member, "GUILDS_JOIN_RULES_TITLE", {
								guildName: escapeDiscordMarkdown(dbRow.name, true)
							}),
							fields: [{
								name: await localizeForUser(msg.member, "GUILDS_JOIN_RULES_FIELDS_CODE"),
								value: code
							}],
							footerText: await localizeForUser(msg.member, "GUILDS_JOIN_RULES_FOOTER_TEXT")
						})
				})) as Message;
			} catch(err) {
				await _msg.edit("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
						key: "GUILDS_JOIN_FAILED_DM",
						formatOptions: {
							guildName: escapeDiscordMarkdown(dbRow.name, true)
						}
					})
				});
				return;
			}

			await _msg.edit("", {
				embed: await getEmbed(await localizeForUser(msg.member, "GUILDS_JOIN_PROGRESS_RULES", {
					guildName: escapeDiscordMarkdown(dbRow.name, true)
				}))
			});

			let confirmed = false;
			if(!$botConfig.sharded) {
				try {
					const msgs = await waitForMessages(__msg.channel as DMChannel, {
						time: 60 * 1000,
						variants: [code, code.toLowerCase(), "-"],
						maxMatches: 1,
						max: 1,
						authors: [msg.author.id]
					});
					confirmed = msgs.first().content.toLowerCase() === code.toLowerCase();
				} catch(err) {
					confirmed = false;
				}
			} else if(process.send) {
				process.send({
					type: "guilds:rules:pending",
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
						if(typeof ipcMsg !== "object") { return; }
						if((ipcMsg.type === "guilds:rules:accept" || ipcMsg.type === "guilds:rules:reject") && ipcMsg.payload) {
							if(ipcMsg.payload.uid && ipcMsg.payload.uid === msg.author.id) {
								clearTimeout(t);
								resolve(ipcMsg.type === "guilds:rules:accept");
							}
						}
					};

					resolve = (v) => {
						if(process.send) {
							process.send({
								type: "guilds:rules:pending_clear",
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

			if(!confirmed) {
				await _msg.edit("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
						key: "GUILDS_JOIN_FAILED_RULES",
						formatOptions: {
							guildName: escapeDiscordMarkdown(dbRow.name, true)
						}
					})
				});
				await msg.author.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Warning, msg.member, {
						key: "GUILDS_JOIN_FAILED_RULES_DM",
						formatOptions: {
							guildName: escapeDiscordMarkdown(dbRow.name, true)
						}
					})
				});
				if(visitor) {
					visitor.event("Members", "Rules rejected", msg.member.id).send();
				}
				return;
			} else {
				_dmRulesMsg = (await msg.author.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "GUILDS_JOIN_DONE_RULES_DM")
				})) as Message;
				if(visitor) {
					visitor.event("Members", "Rules accepted", msg.member.id).send();
				}
			}
		}

		try {
			dbRow = await this.getGuildRow(msg.guild, guildName);
		} catch(err) {
			this.log("err", "Failed to get guild", err);
			$snowball.captureException(err, { extra: messageToExtra(msg) });
			dbRow = undefined;
		}

		if(!dbRow) {
			await _msg.edit("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_JOIN_FAILED_DESTROYED")
			});
			return;
		}

		role = msg.guild.roles.get(dbRow.roleId);

		cz = JSON.parse(dbRow.customize) as IGuildCustomize;

		if(!role) {
			await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_JOIN_FAILED_ROLEDELETED")
			});
			return;
		}

		try {
			await msg.member.addRole(role, await localizeForGuild(msg.guild, "GUILDS_AUDITLOG_JOINED_GUILD", {
				guildName: dbRow.name
			}));
			if(visitor) {
				visitor.event("Members", "Joined", msg.member.id).send();
			}
		} catch(err) {
			await _msg.edit("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_JOIN_FAILED_ROLEASSIGN")
			});
			return;
		}

		if(cz.welcome_msg && cz.welcome_msg_channel) {
			const channel = msg.guild.channels.get(cz.welcome_msg_channel);
			if(!channel || channel.type !== "text") {
				return;
			}
			await (channel as TextChannel).send(cz.welcome_msg.replace("{usermention}", `<@${msg.author.id}>`).replace("{username}", escapeDiscordMarkdown(msg.author.username, true)));
		}

		if(cz.invite_only) {
			const invites = (cz.invites as string[]);
			invites.splice(invites.indexOf(msg.member.id), 1);
			cz.invites = invites;
			dbRow.customize = JSON.stringify(cz);
			await this.updateGuildRow(dbRow);
		}

		await _msg.edit("", {
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

		if(_dmRulesMsg) {
			await _dmRulesMsg.edit("", {
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
					key: "GUILDS_JOIN_JOINED_RULES_DM",
					formatOptions: {
						guildName: escapeDiscordMarkdown(dbRow.name, true),
						serverName: escapeDiscordMarkdown(msg.guild.name, true)
					}
				})
			});
		}
	}

	async getGuildInfo(msg: Message) {
		const guildName = msg.content.slice(CMD_GUILDS_INFO.length).trim();
		if(guildName.length === 0) {
			this.sendHelp(msg.channel as TextChannel, CMD_GUILDS_INFO, msg.member);
			return;
		}

		let dbRow: IGuildRow | undefined = undefined;
		try {
			dbRow = await this.getGuildRow(msg.guild, guildName);
		} catch(err) {
			this.log("err", "Failed to get guild", err);
			$snowball.captureException(err, { extra: messageToExtra(msg) });
			dbRow = undefined;
		}

		if(!dbRow) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_GUILDNOTFOUND")
			});
			return;
		}

		const role = msg.guild.roles.get(dbRow.roleId);
		if(!role) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_INFO_FAILED_ROLEFAILURE")
			});
			return;
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
				greenTick: this.config.emojis.greenTick,
				redTick: this.config.emojis.redTick
			}),
			inline: true
		});

		const cz = JSON.parse(dbRow.customize) as IGuildCustomize;

		if(cz.invite_only) {
			let str = "";
			if(isMember) {
				if(dbRow.ownerId === msg.member.id) {
					str = await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_IOSTATUS_VALUE_OWNER");
				} else if(rightsCheck(msg.member, dbRow)) {
					str = await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_IOSTATUS_VALUE_ADMIN");
				} else {
					str = await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_IOSTATUS_VALUE_MEMBER");
				}
			} else {
				str = await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_IOSTATUS_VALUE_INVITED", {
					invited: cz.invites ? cz.invites.includes(msg.author.id) : false,
					greenTick: this.config.emojis.greenTick,
					redTick: this.config.emojis.redTick
				});
			}
			fields.push({
				name: await localizeForUser(msg.member, "GUILDS_INFO_FIELDS_IOSTATUS"),
				value: str
			});
		}

		msg.channel.send("", {
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

	async membersControl(msg: Message) {
		if(msg.content === CMD_GUILDS_MEMBERS) { return; } // TODO: add instructions lata?
		let args = msg.content.split(",").map(arg => arg.trim());
		args[0] = args[0].slice(CMD_GUILDS_MEMBERS.length).trim();
		args = args.filter(arg => arg.trim() !== "");
		// !guilds members guildName, [list/kick/add] <@mention>
		// guildName, list
		// guildName, kick, @mention
		// guildName, add, @mention
		// guildName, ban, @mention
		if(args.length < 2) {
			// something
			return;
		}

		let dbRow: IGuildRow | undefined = undefined;
		try {
			dbRow = await this.getGuildRow(msg.guild, args[0]);
		} catch(err) {
			this.log("err", "Failed to get guild", err);
			$snowball.captureException(err, { extra: messageToExtra(msg) });
			dbRow = undefined;
		}

		if(!dbRow) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_GUILDNOTFOUND")
			});
			return;
		}

		if(!msg.guild.roles.has(dbRow.roleId)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_INFO_FAILED_ROLEFAILURE")
			});
			return;
		}

		if(args[1] === "list") {
			await this.membersControlAction(msg, dbRow, "list");
			return;
		} else if(["kick", "ban", "unban"].includes(args[1]) && args.length > 2) {
			if(msg.mentions.users.size === 0) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_MEMBERSCONTROL_NOMENTIONS")
				});
				return;
			}
			if(!rightsCheck(msg.member, dbRow, false)) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_NOPERMISSIONS")
				});
				return;
			}
			await this.membersControlAction(msg, dbRow, args[1] as "kick" | "ban" | "unban");
		}
	}

	membersControl_fixString(str: string) {
		return replaceAll(str, "`", "'");
	}

	async membersControlAction(msg: Message, dbRow: IGuildRow, action: "list" | "kick" | "ban" | "unban" | "add") {
		let statusMsg = (await msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "GUILDS_MEMBERSCONTROL_LOADING")
		})) as Message;

		const members = msg.guild.members.filter(m => m.roles.has(dbRow.roleId));

		const cz = JSON.parse(dbRow.customize) as IGuildCustomize;

		let visitor: ua.Visitor | undefined = undefined;
		if(cz.ua) {
			visitor = ua(cz.ua, msg.guild.id, {
				strictCidFormat: false,
				https: true,
				uid: msg.member.id
			});
		}

		switch(action) {
			case "list": {
				let str = "# " + await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_LIST", {
					guildName: this.membersControl_fixString(dbRow.name)
				});

				let ownerStr: string | undefined;
				const admins: string[] = [];
				const otherMembers: string[] = [];

				for(const member of members.values()) {
					const memberEntry = `- ${this.membersControl_fixString(member.displayName)}`;

					const isOwner = rightsCheck(member, dbRow, true);
					if(isOwner) {
						ownerStr = memberEntry;
						continue;
					} // owner

					if(!isOwner && rightsCheck(member, dbRow, false)) {
						admins.push(memberEntry);
						continue;
					}

					otherMembers.push(memberEntry);
				}

				let membersStr = "";
				membersStr += "## " + (await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_LIST_OWNER")) + "\n";
				membersStr += `- ${ownerStr || "[Owner left](This guild is owned by server)"}\n\n`;

				if(admins.length > 0) {
					membersStr += "## " + (await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_LIST_ADMINS")) + "\n";
					membersStr += admins.join("\n") + "\n\n";
				}

				membersStr += "## " + (await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_LIST_EVERYONE")) + "\n";
				membersStr += otherMembers.join("\n");

				str += `\n\n${membersStr}`;

				statusMsg = (await statusMsg.edit("", {
					embed: await generateLocalizedEmbed(EmbedType.Progress, msg.member, "GUILDS_MEMBERSCONTROL_SENDING")
				})) as Message;

				try {
					await msg.author.send(str, {
						split: true,
						code: "md"
					});
					statusMsg = (await statusMsg.edit("", {
						embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "GUILDS_MEMBERSCONTROL_SENT")
					})) as Message;
				} catch(err) {
					statusMsg = (await statusMsg.edit("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_MEMBERSCONTROL_SENDINGERR")
					})) as Message;
				}
			} break;
			case "kick": case "ban": case "unban": {
				if(msg.mentions.users.size > 20) {
					statusMsg = (await statusMsg.edit("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_MEMBERSCONTROL_MAXMENTIONS")
					})) as Message;
					return;
				}

				let str = "";
				let affected = 0;

				if(action === "unban" && (!cz.banned || cz.banned.length === 0)) {
					statusMsg = (await statusMsg.edit("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_MEMBERSCONTROL_NONEBANNED")
					})) as Message;
					return;
				}

				for(const mention of msg.mentions.users.values()) {
					const member = msg.guild.members.get(mention.id);
					let adminRemoved = false;

					if(!member) {
						str += (await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_NOTAMEMBEROFSERVER", {
							username: escapeDiscordMarkdown(mention.username, true)
						})) + "\n";
						continue;
					}

					if(rightsCheck(msg.member, dbRow, true)) {
						// command called by admin or guild owner
						if(rightsCheck(member, dbRow, false)) {
							const cz = JSON.parse(dbRow.customize) as IGuildCustomize;
							const index = (cz.admins || []).indexOf(member.id);
							if(index < 0) {
								str += (await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_SERVERADM", {
									username: escapeDiscordMarkdown(mention.username, true)
								})) + "\n";
								continue;
							}
							cz.admins.splice(index, 1);
							dbRow.customize = JSON.stringify(cz);
							await this.updateGuildRow(dbRow);
							adminRemoved = true;
						}
					} else {
						if(rightsCheck(member, dbRow, false)) {
							str += (await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_GUILDADMOROWNR", {
								username: escapeDiscordMarkdown(mention.username, true)
							})) + "\n";
							continue;
						}
					}

					if(!member.roles.has(dbRow.roleId)) {
						if(action === "kick") {
							str += (await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_NOTAMEMBER", {
								username: escapeDiscordMarkdown(member.displayName, true)
							})) + "\n";
							continue;
						}
					} else {
						await member.removeRole(dbRow.roleId, await localizeForGuild(msg.guild, action === "kick" ? "GUILDS_AUDITLOG_KICKED" : "GUILDS_AUDITLOG_BANNED", {
							initiator: msg.author.tag,
							guildName: dbRow.name
						}));
					}

					if(action === "kick") {
						str += (await localizeForUser(msg.member, adminRemoved ? "GUILDS_MEMBERSCONTROL_KICKEDADMITEM" : "GUILDS_MEMBERSCONTROL_KICKEDITEM", {
							username: escapeDiscordMarkdown(member.displayName, true)
						})) + "\n";
						if(visitor) {
							visitor.event("Users Management", "Member kicked", member.id).send();
						}
					} else if(action === "ban") {
						if(!cz.banned) { cz.banned = []; }
						cz.banned.push(member.id);
						str += (await localizeForUser(msg.member, adminRemoved ? "GUILDS_MEMBERSCONTROL_BANNEDADMITEM" : "GUILDS_MEMBERSCONTROL_BANNEDITEM", {
							username: escapeDiscordMarkdown(member.displayName, true)
						})) + "\n";
						if(visitor) {
							visitor.event("Users Management", "Member banned", member.id).send();
						}
					} else if(action === "unban") {
						if(!cz.banned) { break; }
						const index = cz.banned.indexOf(member.id);
						if(index === -1) {
							str += (await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_NOTBANNED", {
								username: escapeDiscordMarkdown(member.displayName, true)
							})) + "\n";
							continue;
						}
						cz.banned.splice(index, 1);
						str += (await localizeForUser(msg.member, "GUILDS_MEMBERSCONTROL_UNBANNEDITEM", {
							username: escapeDiscordMarkdown(member.displayName, true)
						})) + "\n";
					}
					affected++;
				}
				if(action === "ban" || action === "unban") {
					if(cz.banned && cz.banned.length === 0) {
						delete cz.banned;
					}
					dbRow.customize = JSON.stringify(cz);
					await this.updateGuildRow(dbRow);
				}
				statusMsg = (await statusMsg.edit("", {
					embed: await generateLocalizedEmbed(affected === 0 ? EmbedType.Error : EmbedType.OK, msg.member, {
						custom: true,
						string: str
					}, {
							title: await localizeForUser(msg.member, action === "kick" ? "GUILDS_MEMBERSCONTROL_KICKED" : (action === "ban" ? "GUILDS_MEMBERSCONTROL_BANNED" : "GUILDS_MEMBERSCONTROL_UNBANNED"), {
								members: affected
							})
						})
				})) as Message;
			} break;
		}
	}

	async inviteToGuild(msg: Message) {
		if(msg.content === CMD_GUILDS_INVITE) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "GUILDS_INVITE_INFO")
			});
			return;
		}

		const args = msg.content.split(",").map(arg => arg.trim());
		if(args.length === 1) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "GUILDS_INVITE_USAGE",
					formatOptions: {
						prefix: CMD_GUILDS_INVITE
					}
				})
			});
			return;
		}

		args[0] = args[0].slice(CMD_GUILDS_INVITE.length + 1);

		let dbRow: IGuildRow | undefined = undefined;
		try {
			dbRow = await this.getGuildRow(msg.guild, args[0]);
			// args[0] supposed to be guild name
		} catch(err) {
			this.log("err", "Failed to get guild", err);
			$snowball.captureException(err, { extra: messageToExtra(msg) });
			dbRow = undefined;
		}

		if(!dbRow) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_GUILDNOTFOUND")
			});
			return;
		}

		const isRevoke = args[1] === "revoke";

		const cz = JSON.parse(dbRow.customize) as IGuildCustomize;

		if(!rightsCheck(msg.member, dbRow)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_NOPERMISSIONS")
			});
			return;
		}

		if(msg.mentions.users.size === 0) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_INVITE_NOMENTIONS")
			});
			return;
		}

		if(!cz.invites && isRevoke) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_INVITE_NOINVITES")
			});
			return;
		}

		let invited = 0;
		let revoked = 0;
		let str = "";

		if(isRevoke && cz.invites) {
			const a = cz.invites.length;
			for(const [uid, mention] of msg.mentions.users) {
				const index = cz.invites.indexOf(uid);
				if(index === -1) {
					str += (await localizeForUser(msg.member, "GUILDS_INVITE_NOTINVITED", {
						username: escapeDiscordMarkdown(mention.username, true)
					})) + "\n";
					continue;
				}
				cz.invites.splice(index, 1);
				str += (await localizeForUser(msg.member, "GUILDS_INVITE_REVOKEDITEM", {
					username: escapeDiscordMarkdown(mention.username, true)
				})) + "\n";
			}
			for(const uid of cz.invites) {
				const index = cz.invites.indexOf(uid);
				const member = msg.guild.members.get(uid);
				if(member) {
					if(!member.roles.has(dbRow.roleId)) {
						continue;
					} else {
						str += (await localizeForUser(msg.member, "GUILDS_INVITE_AUTOREVOKED_1", {
							username: escapeDiscordMarkdown(member.displayName, true)
						})) + "\n";
					}
				} else {
					str += (await localizeForUser(msg.member, "GUILDS_INVITE_AUTOREVOKED", {
						id: uid + ""
					})) + "\n";
				}
				cz.invites.splice(index, 1);
			}
			revoked = a - cz.invites.length;
		} else {
			if(!cz.invites) { cz.invites = [] as string[]; }
			for(const [userId, userObj] of msg.mentions.users) {
				const member = msg.guild.members.get(userId);
				if(!member) {
					str += (await localizeForUser(msg.member, "GUILDS_INVITE_NOTAMEMBER", {
						username: escapeDiscordMarkdown(userObj.username, true)
					})) + "\n";
					continue;
				}
				if(member.roles.has(dbRow.roleId)) {
					str += (await localizeForUser(msg.member, "GUILDS_INVITE_GUILDMEMBER", {
						username: escapeDiscordMarkdown(userObj.username, true)
					})) + "\n";
					continue;
				}
				if(cz.invites.includes(userId)) {
					str += (await localizeForUser(msg.member, "GUILDS_INVITE_ALREADYINVITED", {
						username: escapeDiscordMarkdown(userObj.username, true)
					})) + "\n";
					continue;
				}
				cz.invites.push(userId);
				try {
					await member.send("", {
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
					str += (await localizeForUser(msg.member, "GUILDS_INVITE_INVITESENT", {
						username: escapeDiscordMarkdown(member.displayName, true)
					})) + "\n";
				} catch(err) {
					str += (await localizeForUser(msg.member, "GUILDS_INVITE_NOTSENT", {
						username: escapeDiscordMarkdown(member.displayName, true)
					})) + "\n";
				}
				invited++;
			}
		}

		dbRow.customize = JSON.stringify(cz);

		await this.updateGuildRow(dbRow);

		if(isRevoke) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(revoked === 0 ? EmbedType.Error : EmbedType.OK, msg.member, {
					custom: true, string: str
				}, {
						title: await localizeForUser(msg.member, "GUILDS_INVITE_REVOKED", { revoked })
					})
			});
		} else {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(invited === 0 ? EmbedType.Error : EmbedType.OK, msg.member, {
					custom: true, string: str
				}, {
						title: await localizeForUser(msg.member, "GUILDS_INVITE_INVITED", { invited })
					})
			});
		}
	}

	async getGuildsList(msg: Message) {
		const pageVal = msg.content.slice(CMD_GUILDS_LIST.length);
		let list = 1;
		if(pageVal !== "") {
			list = Math.max(1, Math.abs(Math.round(parseInt(pageVal, 10))));
			if(isNaN(list)) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_LIST_WRONGUSAGE")
				});
				return;
			}
		}

		const dbResp = await this.getGuilds(msg.guild, (10 * list) - 10, 10);
		if(dbResp.rows.length === 0) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "GUILDS_LIST_EMPTYPAGE")
			});
			return;
		}

		const fields: IEmbedOptionsField[] = [];
		for(const row of dbResp.rows) {
			fields.push({
				inline: false,
				name: row.name,
				value: row.description && row.description.length > 0 ? row.description : await localizeForUser(msg.member, "GUILDS_LIST_DESCRIPTIONPLACEHOLDER")
			});
		}

		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
				key: "GUILDS_LIST_JOININFO",
				formatOptions: {
					prefix: BASE_PREFIX
				}
			}, {
					informationTitle: await localizeForUser(msg.member, "GUILDS_LIST_PAGE", {
						list
					}),
					fields,
				})
		});
	}

	// ==============================
	// DB functions
	// ==============================

	getGID() {
		// very unique IDs
		return Date.now().toString(16).split("").reverse().join("");
	}

	async getGuilds(guild: Guild, offset: number = 0, limit: number = 10) {
		return {
			offset: offset,
			nextOffset: offset + limit,
			rows: await this.db(TABLE_NAME).where({
				guildId: guild.id
			}).offset(offset).limit(limit) as IGuildRow[]
		};
	}

	async getGuildRow(guild: Guild, name: string) {
		return await this.db(TABLE_NAME).where({
			guildId: guild.id,
			name: name
		}).first(...Object.keys(TABLE_SCHEMA)) as IGuildRow;
	}

	async updateGuildRow(guildRow: IGuildRow) {
		return this.db(TABLE_NAME).where({
			gid: guildRow.gid
		}).update(guildRow);
	}

	async createGuildRow(guild: Guild, name: string) {
		return this.db(TABLE_NAME).insert({
			guildId: guild.id,
			name: name,
			customize: "{}",
			roleId: "-1",
			description: "",
			gid: this.getGID()
		} as IGuildRow);
	}

	async deleteGuildRow(guildRow: IGuildRow) {
		return this.db(TABLE_NAME).delete().where({
			gid: guildRow.gid
		});
	}

	async getOrCreateGuildRow(guild: Guild, name: string) {
		let element = await this.getGuildRow(guild, name);
		if(!element) {
			await this.createGuildRow(guild, name);
			element = await this.getGuildRow(guild, name);
			if(!element) {
				throw new Error("Can't create guild row at current moment.");
			}
		}
		return element;
	}

	// ==============================
	// Plugin functions
	// ==============================

	async init() {
		let status = false;
		try {
			this.log("info", "Fetching table status...");
			status = await this.db.schema.hasTable(TABLE_NAME);
		} catch(err) {
			this.log("err", "Can't get table status", err);
			$snowball.captureException(err);
			return;
		}

		if(!status) {
			this.log("info", "Table not exists in DB, creating...");
			try {
				await createTableBySchema(TABLE_NAME, TABLE_SCHEMA);
			} catch(err) {
				this.log("err", "Can't create table by schema", err);
				$snowball.captureException(err);
				return;
			}
		} else {
			this.log("info", "Table exists in DB");
		}

		this.log("ok", "Loaded and ready to work");
		this.handleEvents();
	}

	async unload() {
		if(this.processMessageListener) {
			// removing listeners
			process.removeListener("message", this.processMessageListener);
		}
		this.unhandleEvents();
		return true;
	}
}

module.exports = Guilds;
