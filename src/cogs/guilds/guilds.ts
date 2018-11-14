import * as Consts from "@cogs/guilds/consts";
import * as DBController from "@cogs/guilds/dbController";
import { Plugin } from "@cogs/plugin";
import { IModule } from "@sb-types/ModuleLoader/Interfaces";
import { INullableHashMap, IPCMessage } from "@sb-types/Types";
import * as avatar from "@utils/avatar";
import * as i18n from "@utils/ez-i18n";
import { messageToExtra } from "@utils/failToDetail";
import { command } from "@utils/help";
import * as interactive from "@utils/interactive";
import { randomString } from "@utils/random";
import * as text from "@utils/text";
import * as utils from "@utils/utils";
import * as djs from "discord.js";
import * as getLogger from "loggy";
import { default as fetch } from "node-fetch";
import { parse as parseURI } from "url";

const DEFAULT_TABLE_NAME = "guilds";

const EMOJI_NAME_REGEXP = /[a-z0-9\_\-]{2,36}/i;
const EMOJI_ACCESSIBLE_FORMATS = [".png", ".webp", ".jpg", ".gif"];
const EMOJI_MAXSIZE = 262144; // bytes

const MAX_MEMBERSCONTROL_MENTIONS = 10;

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
const DEFAULT_ROLE_PREFIX = "!";
const HELP_CATEGORY = "GUILDS";

function isServerAdmin(member: djs.GuildMember) {
	return member.permissions.has([
		"MANAGE_CHANNELS",
		"MANAGE_ROLES"
	], true);
}

function isGuildManager(member: djs.GuildMember, row?: DBController.IGuildRow, noAdmins = false) {
	const serverAdmin = isServerAdmin(member);

	let guildOwner = false;

	if (row) {
		const cz = <DBController.IGuildCustomize> JSON.parse(row.customize);

		guildOwner = row.ownerId === member.id || member.id === $botConfig.botOwner;

		if (!noAdmins) {
			guildOwner = guildOwner || (cz.admins && cz.admins.includes(member.id));
		}
	}

	return serverAdmin || guildOwner;
}

function helpCheck(msg: djs.Message) {
	return msg.channel.type === "text" && isGuildManager(msg.member);
}

function defHelpCheck(msg: djs.Message) {
	return msg.channel.type === "text";
}

@command(HELP_CATEGORY, BASE_PREFIX.slice(1), Consts.GUILD_HELP_KEYS.joinLeaveDesc, {
	[Consts.GUILD_HELP_KEYS.guildNameArg]: {
		optional: false,
		description: Consts.GUILD_HELP_KEYS.joinLeaveArg0Desc
	}
}, defHelpCheck)
@command(HELP_CATEGORY, CMD_GUILDS_CREATE.slice(1), Consts.GUILD_HELP_KEYS.createDesc, {
	[Consts.GUILD_HELP_KEYS.guildNameArg]: {
		optional: false,
		description: Consts.GUILD_HELP_KEYS.createArg0Desc
	},
	[Consts.GUILD_HELP_KEYS.createArg1]: {
		optional: true,
		description: Consts.GUILD_HELP_KEYS.createArg1Desc
	}
}, helpCheck)
@command(HELP_CATEGORY, CMD_GUILDS_EDIT.slice(1), Consts.GUILD_HELP_KEYS.editDesc, {
	[Consts.GUILD_HELP_KEYS.guildNameArg]: {
		optional: false,
		description: Consts.GUILD_HELP_KEYS.editArg0Desc
	},
	[Consts.GUILD_HELP_KEYS.editArg1]: {
		optional: false,
		description: Consts.GUILD_HELP_KEYS.editArg1Desc
	},
	[Consts.GUILD_HELP_KEYS.editArg2]: {
		optional: false,
		description: Consts.GUILD_HELP_KEYS.editArg2Desc
	}
}, helpCheck)
@command(HELP_CATEGORY, CMD_GUILDS_INVITE.slice(1), Consts.GUILD_HELP_KEYS.inviteDesc, {
	[Consts.GUILD_HELP_KEYS.guildNameArg]: {
		optional: false,
		description: Consts.GUILD_HELP_KEYS.inviteArg0Desc
	},
	[Consts.GUILD_HELP_KEYS.inviteArg1]: {
		optional: true,
		description: Consts.GUILD_HELP_KEYS.inviteArg1Desc
	},
	[Consts.GUILD_HELP_KEYS.inviteArg2]: {
		optional: false,
		description: Consts.GUILD_HELP_KEYS.inviteArg2Desc
	}
})
@command(HELP_CATEGORY, CMD_GUILDS_DELETE.slice(1), Consts.GUILD_HELP_KEYS.deleteDesc, {
	[Consts.GUILD_HELP_KEYS.guildNameArg]: {
		optional: false,
		description: Consts.GUILD_HELP_KEYS.deleteArg0Desc
	}
}, helpCheck)
@command(HELP_CATEGORY, CMD_GUILDS_LIST.slice(1), Consts.GUILD_HELP_KEYS.listDesc, {
	[Consts.GUILD_HELP_KEYS.listArg0]: {
		optional: true,
		description: `${Consts.GUILD_HELP_KEYS.listArg0Desc}`
	}
}, defHelpCheck)
@command(HELP_CATEGORY, CMD_GUILDS_INFO.slice(1), Consts.GUILD_HELP_KEYS.infoDesc, {
	[Consts.GUILD_HELP_KEYS.guildNameArg]: {
		optional: true,
		description: Consts.GUILD_HELP_KEYS.infoArg0Desc
	}
}, defHelpCheck)
class Guilds extends Plugin implements IModule {
	// FIXME: insert new lines anywhere UwU @done
	// FIXME: add flows support

	public get signature() {
		return "snowball.features.guilds";
	}

	// Sharded invites handling
	private _processMessageListener?: ((msg: any) => void);
	private readonly log = getLogger("Guilds");
	private readonly _config: IGuildsModuleConfig;

	private readonly _dbController: DBController.GuildsDBController;
	private readonly _pendingInvites: INullableHashMap<{ code: string; }> = Object.create(null);

	constructor(config: IGuildsModuleConfig) {
		super({
			"message": (msg: djs.Message) => this._onMessage(msg)
		}, true);

		if (!config) { throw new Error("No config passed"); }

		if ($botConfig.sharded) {
			this._addProcessMessageListener();
		}

		config.emojis = <any> utils.resolveEmojiMap(
			config.emojis,
			$discordBot.emojis,
			true
		);

		this._dbController = new DBController.GuildsDBController(
			config.tableName || DEFAULT_TABLE_NAME
		);

		this._config = config;
	}

	// #region Process/message listener

	private _addProcessMessageListener() {
		this._processMessageListener = (msg) => {
			if (typeof msg !== "object") { return; }

			if (
				msg.type &&
				!msg.type.startsWith(Consts.SHARDING_MESSAGE_TYPE.BASE_PREFIX)
			) {
				return;
			}

			if (!msg.payload) { return; }

			if (!msg.payload.uid) { return; }

			if (msg.type === Consts.SHARDING_MESSAGE_TYPE.PENDING_INVITE_CLEAR) {
				if (!this._pendingInvites[msg.payload.uid]) { return; }

				delete this._pendingInvites[msg.payload.uid];
			} else if (msg.type === Consts.SHARDING_MESSAGE_TYPE.PENDING_INVITE_CREATE) {
				if (!msg.payload.code) { return; }

				this._pendingInvites[msg.payload.uid] = {
					code: msg.payload.code
				};
			}
		};

		process.on("message", this._processMessageListener);
	}

	// #endregion

	// #region General message handler & router

	private async _onMessage(msg: djs.Message) {
		if (msg.channel.type === "dm") { return this._handleDMCode(msg); }

		try {
			if (msg.content.startsWith(BASE_PREFIX)) {
				if (msg.content === BASE_PREFIX) {
					return await this._sendHelp(<djs.TextChannel> msg.channel, undefined, msg.member);
				} else if (text.startsWith(msg.content, CMD_GUILDS_LIST)) {
					return await this._getGuildsList(msg);
				} else if (text.startsWith(msg.content, CMD_GUILDS_CREATE)) {
					return await this._createGuild(msg);
				} else if (text.startsWith(msg.content, CMD_GUILDS_EDIT)) {
					return await this._editGuild(msg);
				} else if (text.startsWith(msg.content, CMD_GUILDS_DELETE)) {
					return await this._deleteGuild(msg);
				} else if (text.startsWith(msg.content, CMD_GUILDS_INFO)) {
					return await this._getGuildInfo(msg);
				} else if (text.startsWith(msg.content, CMD_GUILDS_INVITE)) {
					return await this._inviteToGuild(msg);
				} else if (text.startsWith(msg.content, CMD_GUILDS_MEMBERS)) {
					return await this._membersControl(msg);
				}

				return await this._joinLeaveGuild(msg);
			}
		} catch (err) {
			this.log("err", "Error at running cmd", msg.content, "\n", err);
			$snowball.captureException(err, { extra: messageToExtra(msg) });

			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msg.member, "GUILDS_RUNNINGFAILED")
			});
		}
	}

	// #endregion

	// #region Handlers

	private async _handleDMCode(msg: djs.Message) {
		if (msg.channel.type !== "dm") { return; } // non-dm msg
		if (!process.send) { return; } // non-sharded run

		const pendingInvite = this._pendingInvites[msg.author.id];
		if (!pendingInvite) { return; } // no pending invites
		if (pendingInvite.code.toLowerCase() === msg.content.toLowerCase()) {
			process.send({
				type: Consts.SHARDING_MESSAGE_TYPE.RULES_ACCEPTED,
				payload: {
					uid: msg.author.id
				}
			});
		} else if (msg.content === "-") {
			process.send({
				type: Consts.SHARDING_MESSAGE_TYPE.RULES_REJECTED,
				payload: {
					uid: msg.author.id
				}
			});
		}
	}

	private async _sendHelp(channel: djs.TextChannel, cmd: string = BASE_PREFIX, member: djs.GuildMember) {
		let key: string | undefined;

		switch (cmd) {
			case CMD_GUILDS_CREATE: {
				key = "GUILDS_ARTICLE_CREATE";
			} break;
			case CMD_GUILDS_EDIT: {
				key = "GUILDS_ARTICLE_EDIT";
			} break;
			case CMD_GUILDS_INFO: {
				key = "GUILDS_ARTICLE_INFO";
			} break;
			case CMD_GUILDS_LIST: {
				key = "GUILDS_ARTICLE_LIST";
			} break;
			case CMD_GUILDS_DELETE: {
				key = "GUILDS_ARTICLE_DELETE";
			} break;
			case BASE_PREFIX: {
				key = "GUILDS_ARTICLE_GENERAL";
			} break;
			default: {
				throw new Error(
					`Article for command "${cmd}" not found`
				);
			}
		}

		return channel.send({
			embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Information, member, {
				key,
				formatOptions: {
					prefix: cmd
				}
			})
		});
	}

	// #endregion

	// #region Commands

	private async _createGuild(msg: djs.Message) {
		// !guilds create Overwatch, !Overwatch
		if (msg.content === CMD_GUILDS_CREATE) {
			return this._sendHelp(
				<djs.TextChannel> msg.channel,
				CMD_GUILDS_CREATE,
				msg.member
			);
		}

		if (!isGuildManager(msg.member)) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_NOPERMISSIONS"
				)
			});
		}

		const args = msg.content
			.slice(CMD_GUILDS_CREATE.length)
			.split(",")
			.map(arg => arg.trim());

		if (args.length > 2) {
			// Overwatch, Overwatch, friends!
			const fields: utils.IEmbedOptionsField[] = [];
			if ((msg.content.match(/\,/g) || []).length > 1) {
				fields.push({
					name: await i18n.localizeForUser(
						msg.member,
						"GUILDS_CREATE_FIELD_TIP"
					),
					value: await i18n.localizeForUser(
						msg.member,
						"GUILDS_CREATE_FILED_TIP_TEXT"
					),
				});
			}
			fields.push({
				name: await i18n.localizeForUser(
					msg.member, "GUILDS_CREATE_FIELDS_USAGE"
				),
				value: await i18n.localizeForUser(
					msg.member,
					"GUILDS_CREATE_FIELDS_USAGE_TEXT", {
						prefix: CMD_GUILDS_CREATE
					}
				)
			});

			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_CREATE_WRONGARGSCOUNT", {
						fields
					}
				)
			});
		}

		if (Consts.RESERVER_GUILD_NAMES.includes(args[0].toLowerCase())) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_CREATE_RESERVEDNAME"
				)
			});
		}

		// search if we already having role with this name
		let dbRow = await this._dbController.getGuild(
			msg.guild,
			args[0]
		);

		if (dbRow) {
			if (!msg.guild.roles.has(dbRow.roleId)) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(
						utils.EmbedType.Error,
						msg.member,
						"GUILDS_CREATE_ALREADYFOUND_NOROLE"
					)
				});
			}

			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_CREATE_ALREADYFOUND_ROLE"
				)
			});
		}

		let role: djs.Role | undefined;

		if (args.length === 1) {
			const roleName = `${DEFAULT_ROLE_PREFIX}${args[0]}`;

			// creating role
			const _confirmationEmbed = await i18n.generateLocalizedEmbed(
				utils.EmbedType.Progress,
				msg.member, {
					key: "GUILDS_CREATE_ROLECREATING_CONFIRMATION",
					formatOptions: {
						roleName
					}
				}
			);

			const confirmation = await interactive.createConfirmationMessage(
				_confirmationEmbed,
				msg
			);

			if (!confirmation) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(
						utils.EmbedType.Error,
						msg.member,
						"GUILDS_CANCELED"
					)
				});
			}

			role = await msg.guild.roles.create({
				data: {
					permissions: [],
					hoist: false, mentionable: false,
					name: roleName
				},
				reason: await i18n.localizeForGuild(
					msg.guild, "GUILDS_AUDITLOG_ROLE_CREATED", {
						initiator: msg.author.tag,
						guildName: args[0]
					}
				)
			});
		} else {
			role = utils.resolveGuildRole(
				args[1],
				msg.guild, {
					caseStrict: false,
					strict: false
				}
			);

			if (!role) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(
						utils.EmbedType.Error,
						msg.member,
						"GUILDS_CREATE_RESOLVINGFAILED"
					)
				});
			}
		}

		try {
			await msg.member.roles.add(
				role,
				await i18n.localizeForGuild(
					msg.guild,
					"GUILDS_AUDITLOG_CREATED_OWNER", {
						guildName: args[0]
					}
				)
			);
		} catch (err) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_CREATE_ROLEASSIGNATIONFAILED"
				)
			});
		}

		await this._dbController.createGuild(
			msg.guild,
			args[0],
			msg.member.id,
			role.id
		);

		dbRow = await this._dbController.getGuild(
			msg.guild, args[0]
		);

		if (!dbRow) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_CREATE_DBERROR"
				)
			});
		}

		return msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(
				utils.EmbedType.OK,
				msg.member,
				"GUILDS_CREATE_DONE"
			)
		});
	}

	private async _editGuild(msg: djs.Message) {
		// !guilds edit Overwatch, description, Для фанатов этой отвратительной игры
		if (msg.content === CMD_GUILDS_EDIT) {
			return this._sendHelp(<djs.TextChannel> msg.channel, CMD_GUILDS_EDIT, msg.member);
		}

		const args = msg.content.slice(CMD_GUILDS_EDIT.length).split(",");

		let guildName = "", editParam = "", content = "";
		// due to issues w/ typescript I made them ""

		{
			// nice argument parsing
			let currentElem: string;
			let i = 0;

			while ((currentElem = args.splice(0, 1)[0]) !== undefined) {
				if (++i === 3) { break; }
				switch (i) {
					case 1: {
						guildName = currentElem.trim();
					} break;
					case 2: {
						editParam = currentElem.trim();
						content = args.join(",").trim();
					} break;
				}
			}
		}

		if (Consts.EDITABLE_PARAMS.indexOf(editParam) === -1) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_EDIT_INVALIDPARAM"
				)
			});
		}

		let dbRow: NullableGuildRow;

		dbRow = await this._dbController.getGuild(
			msg.guild, guildName
		);

		if (!dbRow) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Information,
					msg.member,
					"GUILDS_EDIT_GUILDNOTFOUND"
				)
			});
		}

		if (!isGuildManager(msg.member, dbRow)) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_NOPERMISSIONS"
				)
			});
		}

		const customize = <DBController.IGuildCustomize> JSON.parse(dbRow.customize);

		const isCalledByAdmin = !isGuildManager(
			msg.member, dbRow, true
		);

		let doneString = "";

		switch (editParam) {
			case "image": case "icon": {
				// fetching first

				const isInvalidLink =
					!content.startsWith("http://") &&
					!content.startsWith("https://");

				if (isInvalidLink) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_INVALIDLINK"
						)
					});
				}

				const resolved = parseURI(content);

				const hostBanned =
					!resolved.hostname ||
					Consts.isHostBanned(resolved.hostname);

				if (hostBanned) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_INVALIDLINK"
						)
					});
				}

				try {
					// FIXME: strictly avoid fetching because it may leak the bot's IP
					await fetch(
						encodeURI(content), {
							method: "GET"
						}
					);
				} catch (err) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_IMAGELOADINGFAILED"
						)
					});
				}

				customize[editParam === "image" ? "image_url" : "icon_url"] =
					content;

				doneString = await i18n.localizeForUser(
					msg.member,
					"GUILDS_EDIT_IMAGESET"
				);
			} break;
			case "rules": {
				content = text.removeEveryoneMention(content);
				customize.rules = content;

				doneString = await i18n.localizeForUser(
					msg.member,
					"GUILDS_EDIT_RULESSET"
				);
			} break;
			case "welcome_msg_channel": {
				const channel = $discordBot.channels.get(content);

				if (!channel) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_CHANNELNOTFOUND"
						)
					});
				}

				if (channel.type !== "text") {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_WRONGCHANNEL"
						)
					});
				}

				if ((<djs.TextChannel> channel).guild.id !== msg.guild.id) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_OTHERCHANNEL"
						)
					});
				}

				customize.welcome_msg_channel = content;

				doneString = await i18n.localizeForUser(
					msg.member,
					"GUILDS_EDIT_WELCOMECHANNELSET"
				);
			} break;
			case "welcome_msg": {
				content = text.removeEveryoneMention(content);

				const noMentions =
					!content.includes("{usermention}") &&
					!content.includes("{username}");

				if (noMentions) {
					let confirmation = false;

					try {
						confirmation = await interactive.createConfirmationMessage(
							await i18n.generateLocalizedEmbed(
								utils.EmbedType.Error,
								msg.member,
								"GUILDS_EDIT_NOUSERMENTION"
							), msg
						);
					} catch (err) {
						confirmation = false;
					}

					if (confirmation) {
						return msg.channel.send({
							embed: await i18n.generateLocalizedEmbed(
								utils.EmbedType.Error,
								msg.member,
								"GUILDS_CANCELED"
							)
						});
					}
				}

				customize.welcome_msg = content;

				doneString = await i18n.localizeForUser(
					msg.member,
					"GUILDS_EDIT_WELCOMEMSGSET"
				);
			} break;
			case "description": {
				content = text.removeEveryoneMention(content);

				dbRow.description = content;

				doneString = await i18n.localizeForUser(
					msg.member,
					"GUILDS_EDIT_DESCRIPTIONSET"
				);
			} break;
			case "owner": {
				if (isCalledByAdmin) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_OWNERERR"
						)
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
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_MEMBERNOTFOUND"
						)
					});
				}

				if (member.id === dbRow.ownerId) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member, {
								key: "GUILDS_EDIT_TRANSFEROWNERSHIPTOOWNER",
								formatOptions: {
									serverAdmin
								}
							}
						)
					});
				}

				const confirmation = await interactive.createConfirmationMessage(
					await i18n.generateLocalizedEmbed(
						utils.EmbedType.Question,
						msg.member, {
							key: "GUILDS_EDIT_TRANSFERCONFIRMATION",
							formatOptions: {
								username: utils.escapeDiscordMarkdown(
									member.displayName, true
								)
							}
						}
					), msg
				);

				if (!confirmation) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.OK,
							msg.member,
							"GUILDS_CANCELED"
						)
					});
				}

				dbRow.ownerId = member.id;

				const admIndex = customize.admins ?
					customize.admins.indexOf(member.id) :
					-2;

				if (admIndex >= 0) {
					customize.admins.splice(customize.admins.indexOf(member.id), 1);
				}

				doneString = await i18n.localizeForUser(
					msg.member,
					"GUILDS_EDIT_TRANSFERDONE", {
						serverAdmin
					}
				);
			} break;
			case "invite_only": case "private": {
				if (isCalledByAdmin) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_NOPERMS"
						)
					});
				}

				if (!["true", "false"].includes(content)) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_TRUEFALSEERR"
						)
					});
				}

				if (content === "true" && customize.invite_only) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.OK, msg.member, {
								key: "GUILDS_EDIT_IOALREADY",
								formatOptions: {
									ioAlreadyEnabled: true
								}
							}
						)
					});
				} else if (content === "false" && !customize.invite_only) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.OK, msg.member, {
								key: "GUILDS_EDIT_IOALREADY",
								formatOptions: {
									ioAlreadyEnabled: false
								}
							}
						)
					});
				}

				customize.invite_only = content === "true";

				doneString = await i18n.localizeForUser(
					msg.member, "GUILDS_EDIT_IOCHANGED", {
						ioEnabled: customize.invite_only
					}
				);
			} break;
			case "invite_only_msg": {
				content = text.removeEveryoneMention(content);

				customize.invite_only_msg = content;

				doneString = await i18n.localizeForUser(
					msg.member,
					"GUILDS_EDIT_INVITE_ONLY_MSG_SET"
				);
			} break;
			case "add_admin": case "add_adm": {
				if (isCalledByAdmin) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_ADDADMPERMS"
						)
					});
				}

				if (msg.mentions.members.size === 0) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_ADDADMNOMENTIONS"
						)
					});
				}

				if (msg.mentions.members.size > 1) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_ADDADMSINGLEMENTION"
						)
					});
				}

				if (!customize.admins) {
					customize.admins = [];
				}

				const mention = msg.mentions.members.first()!.id;

				if (customize.admins.includes(mention)) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_ADDADMNOTGUILDMEMBER"
						)
					});
				}

				customize.admins.push(mention);
			} break;
			case "remove_admin": case "rm_admin": case "delete_admin": case "rm_adm": {
				if (isCalledByAdmin) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_RMADMPERMS"
						)
					});
				}

				if (msg.mentions.members.size === 0) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_NOMENTIONS"
						)
					});
				}

				if (msg.mentions.members.size > 1) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_SINGLEMENTION"
						)
					});
				}

				if (!customize.admins) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_RMNOADMINS"
						)
					});
				}

				const mention = msg.mentions.members.first()!.id;

				customize.admins.splice(customize.admins.indexOf(mention), 1);
			} break;
			case "add_emoji": {
				if (!EMOJI_NAME_REGEXP.test(content)) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_INVALIDEMOJINAME"
						)
					});
				}

				if (msg.attachments.size === 0) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_NOATTACHMENT"
						)
					});
				} else if (msg.attachments.size > 1) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_TOOMANYATTACHMENTS"
						)
					});
				}

				const attachment = msg.attachments.first()!;

				if (!EMOJI_ACCESSIBLE_FORMATS.find(t => attachment.url.endsWith(t))) {
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_INVALIDTYPE"
						)
					});
				} else if (attachment.size > EMOJI_MAXSIZE) {
					// by some reason discord.js has no typedefs for `size`
					return msg.channel.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member, {
								key: "GUILDS_EDIT_INVALIDSIZE",
								formatOptions: {
									maxSizeKB: EMOJI_MAXSIZE / 1024
								}
							}
						)
					});
				}

				const botsRole = msg.guild.me.roles.find(r => r.managed);

				let emoji: djs.Emoji;
				try {
					emoji = await msg.guild.emojis.create(
						attachment.url,
						content, {
							roles: [
								dbRow.roleId,
								botsRole
							]
						}
					);
				} catch (err) {
					if (err instanceof djs.DiscordAPIError) {
						return msg.channel.send({
							embed: await i18n.generateLocalizedEmbed(
								utils.EmbedType.Error,
								msg.member,
								Guilds._emojiAPIErrorStr(
									err, content, attachment
								)
							)
						});
					}

					$snowball.captureException(err);

					return;
				}

				if (!emoji) { return; }

				doneString = await i18n.localizeForUser(
					msg.member,
					"GUILDS_EDIT_EMOJICREATED", {
						name: emoji.name,
						emoji: botsRole ? emoji.toString() : ""
					}
				);
			} break;
		}

		dbRow.customize = JSON.stringify(customize);

		await this._dbController.updateGuild(dbRow);

		return msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(
				utils.EmbedType.OK, msg.member, {
					custom: true,
					string: doneString
				}
			)
		});
	}

	private static _emojiAPIErrorStr(err: djs.DiscordAPIError, content: string, attachment: djs.MessageAttachment) {
		switch (err.code) {
			case 50013:
				return "GUILDS_EDIT_NOEMOJIPERMISSIONS";
			case 30008:
				return "GUILDS_EDIT_NOSLOTS";
			case 20001:
				return "GUILDS_EDIT_BADFORBOT";
			case 50035: {
				const isSize = err.message.includes("File cannot be larger than");

				return `GUILDS_EDIT_INVALIDFORM_${
					isSize ? "SIZE" : "OTHER"
				}`;
			}
		}

		$snowball.captureException(
			new Error("Can't add emoji"), {
				extra: {
					err, name: content,
					uri: attachment
				}
			}
		);

		return "GUILDS_EDIT_EMOJIOTHERERR";
	}

	private async _deleteGuild(msg: djs.Message) {
		const guildName = msg.content.slice(CMD_GUILDS_DELETE.length).trim();

		if (guildName === "") {
			return this._sendHelp(
				<djs.TextChannel> msg.channel,
				CMD_GUILDS_DELETE,
				msg.member
			);
		}

		let dbRow: NullableGuildRow;

		try {
			dbRow = await this._dbController.getGuild(
				msg.guild, guildName
			);
		} catch (err) {
			this.log("err", "Failed to get guild", err);
			dbRow = undefined;
		}

		if (!dbRow) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Information,
					msg.member,
					"GUILDS_EDIT_GUILDNOTFOUND"
				)
			});
		}

		if (!isGuildManager(msg.member, dbRow, true)) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_NOPERMISSIONS"
				)
			});
		}

		const confirmation = await interactive.createConfirmationMessage(
			await i18n.generateLocalizedEmbed(
				utils.EmbedType.Question,
				msg.member,
				"GUILDS_DELETE_CONFIRMATION"
			), msg
		);

		if (!confirmation) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.OK,
					msg.member,
					"GUILDS_CANCELED"
				)
			});
		}

		await this._dbController.deleteGuild(dbRow);

		return msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(
				utils.EmbedType.OK,
				msg.member,
				"GUILDS_DELETE_DONE"
			)
		});
	}

	private async _joinLeaveGuild(msg: djs.Message) {
		// !guilds Overwatch
		const guildName = msg.content.slice(BASE_PREFIX.length).trim();

		if (guildName.length === 0) {
			return this._sendHelp(
				<djs.TextChannel> msg.channel,
				undefined,
				msg.member
			);
		}

		let dbRow: NullableGuildRow;

		try {
			dbRow = await this._dbController.getGuild(
				msg.guild, guildName
			);
		} catch (err) {
			this.log("err", "Failed to get guild", err);
			dbRow = undefined;
		}

		if (!dbRow) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_EDIT_GUILDNOTFOUND"
				)
			});
		}

		const role = msg.guild.roles.get(dbRow.roleId);

		if (!role) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_LEAVE_NOROLE"
				)
			});
		}

		if (!msg.member.roles.has(dbRow.roleId)) {
			await this._joinGuild(
				msg, dbRow,
				role,
				guildName
			);
		} else {
			await this._leaveGuild(
				msg, dbRow,
				role,
				guildName
			);
		}
	}

	private async _leaveGuild(msg: djs.Message, dbRow: NullableGuildRow, role: djs.Role | undefined, guildName: string) {
		if (!dbRow || !role) { return; }

		const cz = <DBController.IGuildCustomize> JSON.parse(dbRow.customize);

		if (isGuildManager(msg.member, dbRow)) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_LEAVE_ADMIN"
				)
			});
		}

		let str = await i18n.localizeForUser(
			msg.member,
			"GUILDS_LEAVE_CONFIRMATION", {
				guildName: utils.escapeDiscordMarkdown(dbRow.name, true)
			}
		);

		if (cz.invite_only) {
			str += "\n";
			str += await i18n.localizeForUser(
				msg.member,
				"GUILDS_LEAVE_INVITEWARNING"
			);
		}

		const confirmationEmbed = await i18n.generateLocalizedEmbed(
			utils.EmbedType.Question,
			msg.member, {
				custom: true,
				string: str
			}
		);

		const confirmation = await interactive.createConfirmationMessage(confirmationEmbed, msg);
		if (!confirmation) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.OK,
					msg.member,
					"GUILDS_CANCELED"
				)
			});
		}

		try {
			dbRow = await this._dbController.getGuild(
				msg.guild, guildName
			);
		} catch (err) {
			this.log("err", "Failed to get guild", err);
			dbRow = undefined;
		}

		if (!dbRow) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_LEAVE_ALREADYDESTROYED"
				)
			});
		}

		role = msg.guild.roles.get(dbRow.roleId);

		if (!role) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_LEAVE_ALREADYDELETEDROLE"
				)
			});
		}

		try {
			await msg.member.roles.remove(
				role,
				await i18n.localizeForGuild(
					msg.guild,
					"GUILDS_AUDITLOG_LEFT_GUILD", {
						guildName: dbRow.name
					}
				)
			);
		} catch (err) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_LEAVE_ROLEFAILED"
				)
			});
		}

		return msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(
				utils.EmbedType.OK,
				msg.member, {
					key: "GUILDS_LEAVE_DONE",
					formatOptions: {
						guildName: utils.escapeDiscordMarkdown(dbRow.name, true)
					}
				}
			)
		});
	}

	private static readonly _getProfilePicture = avatar.profilePicture(
		avatar.ProfilePictureFormat.TINY,
		avatar.ProfilePictureAnimatedBehavior.NO_ANIMATED
	);

	private static _getJoinGuildEmbed(str: string, author: djs.GuildMember, title: string) {
		return i18n.generateLocalizedEmbed(
			utils.EmbedType.Progress,
			author, {
				custom: true,
				string: str
			}, {
				universalTitle: title
			}
		);
	}

	private async _joinGuild(msg: djs.Message, dbRow: DBController.IGuildRow | undefined, role: djs.Role | undefined, guildName: string) {
		if (!dbRow || !role) { return; }

		let cz = <DBController.IGuildCustomize> JSON.parse(dbRow.customize);

		const isInvited =
			cz.invite_only ?
				Array.isArray(cz.invites) &&
				cz.invites.includes(msg.member.id) :
			true;

		if (!isInvited) {
			const message = cz.invite_only_msg;

			if (message != null) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(
						utils.EmbedType.Error,
						msg.member, {
							key: "GUILDS_JOIN_IOERR@MESSAGE",
							formatOptions: {
								message
							}
						}
					)
				});
			}

			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_JOIN_IOERR"
				)
			});
		}

		const isBanned =
			Array.isArray(cz.banned) &&
			cz.banned.includes(msg.member.id);

		if (isBanned) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_JOIN_BANNEDERR"
				)
			});
		}

		const progressMsgTitle = await i18n.localizeForUser(
			msg.member,
			"GUILDS_JOIN_PROGRESS_TITLE", {
				username: utils.getUserDisplayName(
					msg.member, true
				)
			}
		);

		const progressMsg = <djs.Message> await msg.channel.send({
			embed: await Guilds._getJoinGuildEmbed(
				await i18n.localizeForUser(
					msg.member,
					"GUILDS_JOIN_PROGRESS", {
						guildName: utils.escapeDiscordMarkdown(
							dbRow.name,
							true
						)
					}
				),
				msg.member,
				progressMsgTitle
			)
		});

		if (cz.rules) {
			const code = (randomString(6)).toUpperCase();

			let rulesMsg: djs.Message | undefined = undefined;

			// reuse?
			const embedTitle = await i18n.localizeForUser(
				msg.member,
				"GUILDS_JOIN_RULES_TITLE", {
					guildName: utils.escapeDiscordMarkdown(
						dbRow.name, true
					)
				}
			);

			try {
				rulesMsg = <djs.Message> await msg.author.send({
					embed: await i18n.generateLocalizedEmbed(
						utils.EmbedType.Information,
						msg.member, {
							custom: true,
							string: cz.rules
						}, {
							universalTitle: embedTitle,
							fields: [{
								name: await i18n.localizeForUser(
									msg.member,
									"GUILDS_JOIN_RULES_FIELDS_CODE"
								),
								value: code
							}],
							footerText: await i18n.localizeForUser(
								msg.member,
								"GUILDS_JOIN_RULES_FOOTER_TEXT"
							)
						}
					)
				});
			} catch (err) {
				return progressMsg.edit({
					embed: await i18n.generateLocalizedEmbed(
						utils.EmbedType.Error,
						msg.member, {
							key: "GUILDS_JOIN_FAILED_DM",
							formatOptions: {
								guildName: utils.escapeDiscordMarkdown(
									dbRow.name, true
								)
							}
						}
					)
				});
			}

			// await progressMsg.edit({
			// 	embed: await getEmbed(
			// 		await localizeForUser(
			// 			msg.member, "GUILDS_JOIN_PROGRESS_RULES", {
			// 				guildName: escapeDiscordMarkdown(
			// 					dbRow.name, true
			// 				)
			// 			}
			// 		)
			// 	)
			// });

			await progressMsg.edit({
				embed: await Guilds._getJoinGuildEmbed(
					await i18n.localizeForUser(
						msg.member,
						"GUILDS_JOIN_PROGRESS_RULES", {
							guildName: utils.escapeDiscordMarkdown(
								dbRow.name
							)
						}
					),
					msg.member,
					progressMsgTitle
				)
			});

			let confirmed = false;
			if (!$botConfig.sharded) {
				try {
					const msgs = await interactive.waitForMessages(
						<djs.DMChannel> rulesMsg.channel, {
							time: 60 * 1000,
							variants: [
								code, "-",
								code.toLowerCase()
							],
							maxMatches: 1,
							max: 1,
							authors: [msg.author.id]
						}
					);

					const msgContent = msgs
						.first()!
						.content
						.toLowerCase();

					confirmed = msgContent === code.toLowerCase();
				} catch (err) {
					confirmed = false;
				}
			} else if (process.send) {
				process.send({
					type: Consts.SHARDING_MESSAGE_TYPE.PENDING_INVITE_CREATE,
					payload: {
						uid: msg.author.id,
						code
					}
				});

				// TODO: think of this promise more, doesn't look good
				// Maybe I should use Bluebird one with .finally & .timeout?

				confirmed = await (new Promise<boolean>((res) => {
					let t: NodeJS.Timer; // predefines
					let resolve: (v: boolean) => void;

					const listener = (ipcMsg: InviteIPCMessage) => {

						// We actully could not use variable statements
						// because TypeScript doesn't find them relative
						// so if it would be a separate variable, then we
						// would not be able to check `ipcMsg.type` on bottom

						if (
							(typeof ipcMsg !== "object" || !ipcMsg.payload) ||
							(ipcMsg.type !== Consts.SHARDING_MESSAGE_TYPE.RULES_ACCEPTED &&
								ipcMsg.type !== Consts.SHARDING_MESSAGE_TYPE.RULES_REJECTED) ||
							ipcMsg.payload.uid !== msg.author.id
						) {
							return;
						}

						clearTimeout(t);

						resolve(ipcMsg.type === Consts.SHARDING_MESSAGE_TYPE.RULES_ACCEPTED);
					};

					resolve = (v) => {
						if (process.send) {
							process.send({
								type: Consts.SHARDING_MESSAGE_TYPE.PENDING_INVITE_CLEAR,
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
				throw new Error(
					"UNEXPECTED BEHAVIOR: Sharded run, but process.send isn't present"
				);
			}

			if (!confirmed) {
				await msg.author.send({
					embed: await i18n.generateLocalizedEmbed(
						utils.EmbedType.Warning,
						msg.member, {
							key: "GUILDS_JOIN_FAILED_RULES_DM",
							formatOptions: {
								guildName: utils.escapeDiscordMarkdown(
									dbRow.name, true
								)
							}
						}
					)
				});

				return progressMsg.edit({
					embed: await i18n.generateLocalizedEmbed(
						utils.EmbedType.Error,
						msg.member, {
							key: "GUILDS_JOIN_FAILED_RULES",
							formatOptions: {
								guildName: utils.escapeDiscordMarkdown(
									dbRow.name,
									true
								)
							}
						}
					)
				});
			}

			await rulesMsg.edit({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.OK,
					msg.member, {
						custom: true,
						string: cz.rules
					}, {
						universalTitle: embedTitle,
						footerText: await i18n.localizeForUser(
							msg.member,
							"GUILDS_JOIN_RULES_FOOTER_TEXT_OK"
						)
					}
				)
			});
		}

		try {
			dbRow = await this._dbController.getGuild(
				msg.guild, guildName
			);
		} catch (err) {
			this.log("err", "Failed to get guild", err);
			$snowball.captureException(err, { extra: messageToExtra(msg) });
			dbRow = undefined;
		}

		if (!dbRow) {
			return progressMsg.edit({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_JOIN_FAILED_DESTROYED"
				)
			});
		}

		role = msg.guild.roles.get(dbRow.roleId);

		cz = <DBController.IGuildCustomize> JSON.parse(dbRow.customize);

		if (!role) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_JOIN_FAILED_ROLEDELETED"
				)
			});
		}

		try {
			await msg.member.roles.add(
				role,
				await i18n.localizeForGuild(
					msg.guild,
					"GUILDS_AUDITLOG_JOINED_GUILD", {
						guildName: dbRow.name
					}
				)
			);
		} catch (err) {
			return progressMsg.edit({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_JOIN_FAILED_ROLEASSIGN"
				)
			});
		}

		if (cz.welcome_msg && cz.welcome_msg_channel) {
			const channel = msg.guild.channels.get(cz.welcome_msg_channel);

			if (!channel || channel.type !== "text") { return; }

			await (<djs.TextChannel> channel).send(
				cz.welcome_msg
					.replace("{usermention}", `<@${msg.author.id}>`)
					.replace("{username}", utils.escapeDiscordMarkdown(
						msg.author.username,
						true
					))
			);
		}

		if (cz.invite_only) {
			const invites = cz.invites!;

			invites.splice(invites.indexOf(msg.member.id), 1);

			cz.invites = invites;

			dbRow.customize = JSON.stringify(cz);

			await this._dbController.updateGuild(dbRow);
		}

		if (cz.rules) {
			await msg.author.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.OK,
					msg.member, {
						key: "GUILDS_JOIN_JOINED_RULES_DM",
						formatOptions: {
							guildName: utils.escapeDiscordMarkdown(dbRow.name, true),
							serverName: utils.escapeDiscordMarkdown(msg.guild.name, true)
						}
					}, {
						universalTitle: await i18n.localizeForUser(
							msg.member,
							"GUILDS_JOIN_JOINED_RULES_DM_TITLE"
						)
					}
				)
			});
		}

		return progressMsg.edit({
			embed: await i18n.generateLocalizedEmbed(
				utils.EmbedType.Tada,
				msg.member, {
					key: "GUILDS_JOIN_DONE",
					formatOptions: {
						guildName: utils.escapeDiscordMarkdown(dbRow.name, true)
					}
				}, {
					author: {
						icon_url: msg.author.displayAvatarURL({ format: "webp", size: 128 }),
						name: msg.member.displayName
					}
				}
			)
		});
	}

	private async _getGuildInfo(msg: djs.Message) {
		const guildName = msg.content
			.slice(CMD_GUILDS_INFO.length)
			.trim();

		if (guildName.length === 0) {
			return this._sendHelp(
				<djs.TextChannel> msg.channel,
				CMD_GUILDS_INFO,
				msg.member
			);
		}

		let dbRow: DBController.IGuildRow | undefined;

		try {
			dbRow = await this._dbController.getGuild(
				msg.guild, guildName
			);
		} catch (err) {
			this.log("err", "Failed to get guild", err);
			$snowball.captureException(err, { extra: messageToExtra(msg) });
			dbRow = undefined;
		}

		if (!dbRow) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_EDIT_GUILDNOTFOUND"
				)
			});
		}

		const role = msg.guild.roles.get(dbRow.roleId);

		if (!role) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_INFO_FAILED_ROLEFAILURE"
				)
			});
		}

		const guildAuthor = msg.guild.members.get(dbRow.ownerId);

		const fields: utils.IEmbedOptionsField[] = [];

		const guildMembers = msg.guild.members
			.filter(
				member => dbRow ?
					member.roles.has(dbRow.roleId) :
					false
			);

		fields.push({
			name: await i18n.localizeForUser(
				msg.member,
				"GUILDS_INFO_FIELDS_MEMBERS"
			),
			value: await i18n.localizeForUser(
				msg.member,
				"GUILDS_INFO_FIELDS_MEMBERS_VALUE", {
					count: guildMembers.size
				}
			),
			inline: true
		});

		const isMember = msg.member.roles.has(dbRow.roleId);

		fields.push({
			name: await i18n.localizeForUser(
				msg.member,
				"GUILDS_INFO_FIELDS_MEMBER"
			),
			value: await i18n.localizeForUser(
				msg.member,
				"GUILDS_INFO_FIELDS_MEMBER_VALUE", {
					member: isMember,
					greenTick: this._config.emojis.greenTick,
					redTick: this._config.emojis.redTick
				}
			),
			inline: true
		});

		const cz = <DBController.IGuildCustomize> JSON.parse(dbRow.customize);

		if (cz.invite_only) {
			let str = "";

			if (isMember) {
				if (dbRow.ownerId === msg.member.id) {
					str = await i18n.localizeForUser(
						msg.member, "GUILDS_INFO_FIELDS_IOSTATUS_VALUE_OWNER"
					);
				} else if (isGuildManager(msg.member, dbRow)) {
					str = await i18n.localizeForUser(
						msg.member, "GUILDS_INFO_FIELDS_IOSTATUS_VALUE_ADMIN"
					);
				} else {
					str = await i18n.localizeForUser(
						msg.member, "GUILDS_INFO_FIELDS_IOSTATUS_VALUE_MEMBER"
					);
				}
			} else {
				str = await i18n.localizeForUser(
					msg.member, "GUILDS_INFO_FIELDS_IOSTATUS_VALUE_INVITED", {
						invited:
							Array.isArray(cz.invites) ?
								cz.invites.includes(msg.author.id) :
								false,
						greenTick: this._config.emojis.greenTick,
						redTick: this._config.emojis.redTick
					}
				);
			}

			fields.push({
				name: await i18n.localizeForUser(
					msg.member,
					"GUILDS_INFO_FIELDS_IOSTATUS"
				),
				value: str
			});
		}

		return msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(
				utils.EmbedType.Empty, msg.member, {
					custom: true,
					string:
						dbRow.description ||
						await i18n.localizeForUser(
							msg.member,
							"GUILDS_INFO_DESCRIPTIONPLACEHOLDER"
						)
				}, {
					fields,
					author: guildAuthor ? {
						icon_url: Guilds._getProfilePicture(guildAuthor),
						name: guildAuthor.displayName
					} : {
						icon_url: msg.guild.iconURL(FMT_SMALL_GUILD_ICON),
						name: msg.guild.name
					},
					imageUrl: cz.image_url,
					thumbUrl: cz.icon_url,
					title: dbRow.name,
					footer: {
						icon_url: msg.guild.iconURL(FMT_SMALL_GUILD_ICON),
						text: msg.guild.name
					},
					ts: role.createdAt
				})
		});
	}

	private async _membersControl(msg: djs.Message) {
		if (msg.content === CMD_GUILDS_MEMBERS) { return; } // TODO: add instructions lata?

		let args = msg.content
			.split(",")
			.map(arg => arg.trim());

		args[0] = args[0]
			.slice(CMD_GUILDS_MEMBERS.length)
			.trim();

		args = args
			.filter(arg => arg.trim() !== "");

		// !guilds members guildName, [list/kick/add] <@mention>
		// guildName, list
		// guildName, kick, @mention
		// guildName, add, @mention
		// guildName, ban, @mention

		if (args.length < 2) { return; }

		let dbRow: DBController.IGuildRow | undefined;

		try {
			dbRow = await this._dbController.getGuild(
				msg.guild, args[0]
			);
		} catch (err) {
			this.log("err", "Failed to get guild", err);

			$snowball.captureException(
				err, {
					extra: messageToExtra(msg)
				}
			);

			dbRow = undefined;
		}

		if (!dbRow) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_EDIT_GUILDNOTFOUND"
				)
			});
		}

		if (!msg.guild.roles.has(dbRow.roleId)) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_INFO_FAILED_ROLEFAILURE"
				)
			});
		}

		if (args[1] === "list") {
			return this._membersControlAction(msg, dbRow, "list");
		} else if (["kick", "ban", "unban"].includes(args[1]) && args.length > 2) {
			if (msg.mentions.users.size === 0) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(
						utils.EmbedType.Error,
						msg.member,
						"GUILDS_MEMBERSCONTROL_NOMENTIONS"
					)
				});
			}

			if (!isGuildManager(msg.member, dbRow, false)) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(
						utils.EmbedType.Error,
						msg.member,
						"GUILDS_NOPERMISSIONS"
					)
				});
			}

			return this._membersControlAction(
				msg, dbRow,
				<"kick" | "ban" | "unban"> args[1]
			);
		}
	}

	private static _membersControlFixString(str: string) { return text.replaceAll(str, "`", "'"); }

	private async _membersControlAction(msg: djs.Message, dbRow: DBController.IGuildRow, action: "list" | "kick" | "ban" | "unban" | "add") {
		let statusMsg = <djs.Message> await msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(
				utils.EmbedType.Progress,
				msg.member,
				"GUILDS_MEMBERSCONTROL_LOADING"
			)
		});

		const members = msg.guild.members
			.filter(m => m.roles.has(dbRow.roleId));

		const cz = <DBController.IGuildCustomize> JSON.parse(dbRow.customize);

		switch (action) {
			case "list": {
				let str = `# ${await i18n.localizeForUser(
					msg.member,
					"GUILDS_MEMBERSCONTROL_LIST", {
						guildName: Guilds._membersControlFixString(dbRow.name)
					}
				)}`;

				let ownerStr: string | undefined;
				const admins: string[] = [];
				const otherMembers: string[] = [];

				for (const member of members.values()) {
					const memberEntry = `- ${Guilds._membersControlFixString(member.displayName)}`;

					const isOwner = dbRow.ownerId === ownerStr;
					if (isOwner) {
						ownerStr = memberEntry;
						continue;
					} // owner

					if (!isOwner && isGuildManager(member, dbRow, false)) {
						admins.push(memberEntry);
						continue;
					}

					otherMembers.push(memberEntry);
				}

				let membersStr = "";
				membersStr += `## ${await i18n.localizeForUser(
					msg.member,
					"GUILDS_MEMBERSCONTROL_LIST_OWNER"
				)}`;

				membersStr += `- ${ownerStr || "[Owner left](This guild is owned by server)"}\n\n`;

				if (admins.length > 0) {
					membersStr += `## ${await i18n.localizeForUser(
						msg.member,
						"GUILDS_MEMBERSCONTROL_LIST_ADMINS"
					)}\n`;
					membersStr += `${admins.join("\n")}\n\n`;
				}

				membersStr += `## ${await i18n.localizeForUser(
					msg.member,
					"GUILDS_MEMBERSCONTROL_LIST_EVERYONE"
				)}\n`;
				membersStr += otherMembers.join("\n");

				str += `\n\n${membersStr}`;

				statusMsg = await statusMsg.edit({
					embed: await i18n.generateLocalizedEmbed(
						utils.EmbedType.Progress,
						msg.member,
						"GUILDS_MEMBERSCONTROL_SENDING"
					)
				});

				try {
					await msg.author.send(str, {
						split: true,
						code: "md"
					});

					statusMsg = await statusMsg.edit({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.OK,
							msg.member,
							"GUILDS_MEMBERSCONTROL_SENT"
						)
					});
				} catch (err) {
					statusMsg = await statusMsg.edit({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member,
							"GUILDS_MEMBERSCONTROL_SENDINGERR"
						)
					});
				}
			} break;
			case "kick": case "ban": case "unban": {
				if (msg.mentions.users.size > MAX_MEMBERSCONTROL_MENTIONS) {
					statusMsg = await statusMsg.edit({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member, {
								key: "GUILDS_MEMBERSCONTROL_MAXMENTIONS",
								formatOptions: {
									maxMentions: MAX_MEMBERSCONTROL_MENTIONS
								}
							}
						)
					});
				}

				let str = "";
				let affected = 0;

				if (action === "unban" && (!cz.banned || cz.banned.length === 0)) {
					statusMsg = await statusMsg.edit({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Error,
							msg.member, 
							"GUILDS_MEMBERSCONTROL_NONEBANNED"
						)
					});
				}

				for (const mention of msg.mentions.users.values()) {
					const member = msg.guild.members.get(mention.id);
					let adminRemoved = false;

					if (!member) {
						str += `${await i18n.localizeForUser(msg.member,
							"GUILDS_MEMBERSCONTROL_NOTAMEMBEROFSERVER", {
								username: utils.escapeDiscordMarkdown(
									mention.username, true
								)
							}
						)}\n`;
						continue;
					}

					if (isGuildManager(msg.member, dbRow, true)) {
						// command called by admin or guild owner
						if (isGuildManager(member, dbRow, false)) {
							const cz = <DBController.IGuildCustomize> JSON.parse(dbRow.customize);
							const index = (cz.admins || []).indexOf(member.id);

							if (index < 0) {
								str += `${await i18n.localizeForUser(
									msg.member,
									"GUILDS_MEMBERSCONTROL_SERVERADM", {
										username: utils.escapeDiscordMarkdown(mention.username, true)
									}
								)}\n`;
								continue;
							}

							cz.admins.splice(index, 1);

							dbRow.customize = JSON.stringify(cz);

							await this._dbController.updateGuild(dbRow);

							adminRemoved = true;
						}
					} else if (isGuildManager(member, dbRow, false)) {
						str += `${
							await i18n.localizeForUser(
								msg.member, "GUILDS_MEMBERSCONTROL_GUILDADMOROWNR", {
									username: utils.escapeDiscordMarkdown(mention.username, true)
								}
							)}\n`;
						continue;
					}

					if (!member.roles.has(dbRow.roleId)) {
						if (action === "kick") {
							str += `${await i18n.localizeForUser(
								msg.member,
								"GUILDS_MEMBERSCONTROL_NOTAMEMBER", {
									username: utils.escapeDiscordMarkdown(member.displayName, true)
								}
							)}\n`;
							continue;
						}
					} else {
						const actionStr = action === "kick" ?
							"GUILDS_AUDITLOG_KICKED" :
							"GUILDS_AUDITLOG_BANNED";

						await member.roles.remove(
							dbRow.roleId, 
							await i18n.localizeForGuild(
								msg.guild,
								actionStr, {
									initiator: msg.author.tag,
									guildName: dbRow.name
								}
							)
						);
					}

					if (action === "kick") {
						const removeStr = adminRemoved ?
							"GUILDS_MEMBERSCONTROL_KICKEDADMITEM" :
							"GUILDS_MEMBERSCONTROL_KICKEDITEM";

						str += `${await i18n.localizeForUser(
							msg.member,
							removeStr, {
								username: utils.escapeDiscordMarkdown(member.displayName, true)
							}
						)}\n`;
					} else if (action === "ban") {
						if (!Array.isArray(cz.banned)) {
							cz.banned = [];
						}

						cz.banned.push(member.id);

						const removeStr = adminRemoved ?
							"GUILDS_MEMBERSCONTROL_BANNEDADMITEM" :
							"GUILDS_MEMBERSCONTROL_BANNEDITEM";

						str += `${await i18n.localizeForUser(
							msg.member,
							removeStr, {
								username: utils.escapeDiscordMarkdown(
									member.displayName, true
								)
							}
						)}\n`;
					} else if (action === "unban") {
						if (!Array.isArray(cz.banned)) { break; }

						const index = cz.banned.indexOf(member.id);

						if (index === -1) {
							str += `${await i18n.localizeForUser(
								msg.member,
								"GUILDS_MEMBERSCONTROL_NOTBANNED", {
									username: utils.escapeDiscordMarkdown(
										member.displayName, true
									)
								}
							)}\n`;
							continue;
						}

						cz.banned.splice(index, 1);

						str += `${await i18n.localizeForUser(
							msg.member,
							"GUILDS_MEMBERSCONTROL_UNBANNEDITEM", {
								username: utils.escapeDiscordMarkdown(
									member.displayName, true
								)
							}
						)}\n`;
					}

					affected++;
				}

				if (action === "ban" || action === "unban") {
					if (Array.isArray(cz.banned) && cz.banned.length === 0) {
						delete cz.banned;
					}
					
					dbRow.customize = JSON.stringify(cz);
					
					await this._dbController.updateGuild(dbRow);
				}

				const actionStr = 
					action === "kick" ?
						"GUILDS_MEMBERSCONTROL_KICKED" :
						action === "ban" ?
							"GUILDS_MEMBERSCONTROL_BANNED" :
							"GUILDS_MEMBERSCONTROL_UNBANNED";

				statusMsg = await statusMsg.edit({
					embed: await i18n.generateLocalizedEmbed(
						affected === 0 ? utils.EmbedType.Error : utils.EmbedType.OK,
						msg.member, {
							custom: true,
							string: str
						}, {
							title: await i18n.localizeForUser(
								msg.member,
								actionStr, {
									members: affected
								}
							)
						}
					)
				});

			} break;
		}
	}

	private async _inviteToGuild(msg: djs.Message) {
		if (msg.content === CMD_GUILDS_INVITE) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Information,
					msg.member,
					"GUILDS_INVITE_INFO"
				)
			});
		}

		const args = msg.content
			.split(",")
			.map(arg => arg.trim());

		if (args.length === 1) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Information,
					msg.member, {
						key: "GUILDS_INVITE_USAGE",
						formatOptions: {
							prefix: CMD_GUILDS_INVITE
						}
					}
				)
			});
		}

		args[0] = args[0].slice(CMD_GUILDS_INVITE.length + 1);

		let dbRow: DBController.IGuildRow | undefined;

		try {
			dbRow = await this._dbController.getGuild(
				msg.guild, args[0]
			);
			// args[0] supposed to be guild name
		} catch (err) {
			this.log("err", "Failed to get guild", err);

			$snowball.captureException(err, {
				extra: messageToExtra(msg)
			});

			dbRow = undefined;
		}

		if (!dbRow) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(utils.EmbedType.Error, msg.member, "GUILDS_EDIT_GUILDNOTFOUND")
			});
		}

		const isRevoke = args[1] === "revoke";

		const cz = <DBController.IGuildCustomize> JSON.parse(dbRow.customize);

		if (!isGuildManager(msg.member, dbRow)) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_NOPERMISSIONS"
				)
			});
		}

		if (msg.mentions.users.size === 0) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_INVITE_NOMENTIONS"
				)
			});
		}

		if (!cz.invites && isRevoke) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Error,
					msg.member,
					"GUILDS_INVITE_NOINVITES"
				)
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
					str += `${await i18n.localizeForUser(
						msg.member,
						"GUILDS_INVITE_NOTINVITED", {
							username: utils.escapeDiscordMarkdown(mention.username, true)
						}
					)}\n`;

					continue;
				}
				
				cz.invites.splice(index, 1);
				
				str += `${await i18n.localizeForUser(
					msg.member,
					"GUILDS_INVITE_REVOKEDITEM", {
						username: utils.escapeDiscordMarkdown(mention.username, true)
					}
				)}\n`;
			}

			for (let i = 0, l = cz.invites.length; i < l; i++) {
				const uid = cz.invites[i];
				const index = cz.invites.indexOf(uid);
				const member = msg.guild.members.get(uid);

				if (member) {
					if (!member.roles.has(dbRow.roleId)) {
						continue;
					}

					str += `${await i18n.localizeForUser(
						msg.member,
						"GUILDS_INVITE_AUTOREVOKED_1", {
							username: utils.escapeDiscordMarkdown(member.displayName, true)
						}
					)}\n`;
				} else {
					str += `${await i18n.localizeForUser(
						msg.member,
						"GUILDS_INVITE_AUTOREVOKED", {
							id: uid
						}
					)}\n`;
				}

				if (index !== -1) {
					cz.invites.splice(index, 1);
				}
			}

			revoked = a - cz.invites.length;
		} else {
			if (!Array.isArray(cz.invites)) {
				cz.invites = [];
			}

			for (const [userId, userObj] of msg.mentions.users) {
				const member = msg.guild.members.get(userId);
				if (!member) {
					str += `${await i18n.localizeForUser(
						msg.member,
						"GUILDS_INVITE_NOTAMEMBER", {
							username: utils.escapeDiscordMarkdown(
								userObj.username, true
							)
						}
					)}\n`;

					continue;
				}
				if (member.roles.has(dbRow.roleId)) {
					str += `${await i18n.localizeForUser(
						msg.member,
						"GUILDS_INVITE_GUILDMEMBER", {
							username: utils.escapeDiscordMarkdown(
								userObj.username, true
							)
						}
					)}\n`;

					continue;
				}
				if (cz.invites.includes(userId)) {
					str += `${await i18n.localizeForUser(
						msg.member,
						"GUILDS_INVITE_ALREADYINVITED", {
							username: utils.escapeDiscordMarkdown(
								userObj.username, true
							)
						}
					)}\n`;

					continue;
				}

				cz.invites.push(userId);

				try {
					await member.send({
						embed: await i18n.generateLocalizedEmbed(
							utils.EmbedType.Information,
							member, {
								key: "GUILDS_INVITE_INVITEMSG",
								formatOptions: {
									prefix: BASE_PREFIX,
									guildName: utils.escapeDiscordMarkdown(dbRow.name, true),
									serverName: utils.escapeDiscordMarkdown(msg.guild.name, true),
									RAWguildName: dbRow.name,
									botName: utils.escapeDiscordMarkdown(
										member.guild.me.displayName,
										true
									)
								}
							}
						)
					});

					str += `${await i18n.localizeForUser(
						msg.member,
						"GUILDS_INVITE_INVITESENT", {
							username: utils.escapeDiscordMarkdown(member.displayName, true)
						}
					)}\n`;
				} catch (err) {
					str += `${await i18n.localizeForUser(
						msg.member,
						"GUILDS_INVITE_NOTSENT", {
							username: utils.escapeDiscordMarkdown(member.displayName, true)
						}
					)}\n`;
				}

				invited++;
			}
		}

		dbRow.customize = JSON.stringify(cz);

		await this._dbController.updateGuild(dbRow);

		if (isRevoke) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					revoked === 0 ? utils.EmbedType.Error : utils.EmbedType.OK,
					msg.member, {
						custom: true, string: str
					}, {
						title: await i18n.localizeForUser(
							msg.member,
							"GUILDS_INVITE_REVOKED", { 
								revoked 
							}
						) 
					}
				)
			});
		} else {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					invited === 0 ? utils.EmbedType.Error : utils.EmbedType.OK,
					msg.member, {
						custom: true, string: str
					}, {
						title: await i18n.localizeForUser(
							msg.member,
							"GUILDS_INVITE_INVITED", { 
								invited 
							}
						) 
					}
				)
			});
		}
	}

	private async _getGuildsList(msg: djs.Message) {
		const pageVal = msg.content.slice(CMD_GUILDS_LIST.length);

		let list = 1;

		if (pageVal !== "") {
			list = parseInt(pageVal, 10);
			list = Math.abs(list);
			list = Math.max(1, list);

			if (isNaN(list)) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(
						utils.EmbedType.Error,
						msg.member,
						"GUILDS_LIST_WRONGUSAGE"
					)
				});
			}
		}

		const dbResp = await this._dbController.getGuilds(
			msg.guild, {
				offset: (Consts.GUILDS_PER_PAGE * list) - Consts.GUILDS_PER_PAGE,
				limit: Consts.GUILDS_PER_PAGE
			}
		);

		if (dbResp.guilds.length === 0) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					utils.EmbedType.Information,
					msg.member,
					"GUILDS_LIST_EMPTYPAGE"
				)
			});
		}

		const fields: utils.IEmbedOptionsField[] = [];

		for (let i = 0, l = dbResp.guilds.length; i < l; i++) {
			const row = dbResp.guilds[i];

			const hasDescription = 
				row.description &&
				row.description.length > 0;

			const description = hasDescription ?
				row.description :
				await i18n.localizeForUser(
					msg.member,
					"GUILDS_INFO_DESCRIPTIONPLACEHOLDER"
				);

			fields.push({
				inline: false,
				name: row.name,
				value: description
			});
		}

		return msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(
				utils.EmbedType.Information,
				msg.member, {
					key: "GUILDS_LIST_JOININFO",
					formatOptions: {
						prefix: BASE_PREFIX
					}
				}, { 
					informationTitle: await i18n.localizeForUser(
						msg.member, 
						"GUILDS_LIST_PAGE", { 
							list 
						}
					),
					fields
				}
			)
		});
	}

	// #endregion

	// #region Module functions

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
			process.removeListener(
				"message",
				this._processMessageListener
			);
		}

		this.unhandleEvents();

		return true;
	}

	// #endregion
}

const FMT_SMALL_GUILD_ICON : djs.AvatarOptions = { format: "webp", size: 128 };
type InviteIPCMessage = IPCMessage<{ uid: string }>;
type NullableGuildRow = DBController.IGuildRow | undefined | null;

export default Guilds;
