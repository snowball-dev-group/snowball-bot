import { IModule } from "@sb-types/ModuleLoader/ModuleLoader";
import { IPCMessage, INullableHashMap } from "@sb-types/Types";
import { profilePicture, ProfilePictureFormat, ProfilePictureAnimatedBehavior } from "@utils/avatar";
import { localizeForUser, generateLocalizedEmbed, localizeForGuild } from "@utils/ez-i18n";
import { messageToExtra } from "@utils/failToDetail";
import { createConfirmationMessage, waitForMessages } from "@utils/interactive";
import { command } from "@utils/help";
import { randomString } from "@utils/random";
import { replaceAll, startsWith, removeEveryoneMention } from "@utils/text";
import { EmbedType, IEmbedOptionsField, resolveGuildRole, escapeDiscordMarkdown, resolveEmojiMap, getUserDisplayName } from "@utils/utils";
import { Plugin } from "@cogs/plugin";
import { GuildsDBController, IGuildRow, IGuildCustomize } from "@cogs/guilds/dbController";
import { GUILD_HELP_KEYS, SHARDING_MESSAGE_TYPE, isHostBanned, EDITABLE_PARAMS, RESERVER_GUILD_NAMES, GUILDS_PER_PAGE } from "@cogs/guilds/consts";
import { Message, GuildMember, Role, TextChannel, DMChannel, DiscordAPIError, Emoji, MessageAttachment, AvatarOptions } from "discord.js";
import { parse as parseURI } from "url";
import { default as fetch } from "node-fetch";
import * as ua from "universal-analytics";
import * as getLogger from "loggy";

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

function isServerAdmin(member: GuildMember) {
	return member.permissions.has([
		"MANAGE_CHANNELS",
		"MANAGE_ROLES"
	], true);
}

function isGuildManager(member: GuildMember, row?: IGuildRow, noAdmins = false) {
	const serverAdmin = isServerAdmin(member);

	let guildOwner = false;

	if (row) {
		const cz = <IGuildCustomize> JSON.parse(row.customize);

		guildOwner = row.ownerId === member.id || member.id === $botConfig.botOwner;

		if (!noAdmins) {
			guildOwner = guildOwner || (cz.admins && cz.admins.includes(member.id));
		}
	}

	return serverAdmin || guildOwner;
}

function helpCheck(msg: Message) {
	return msg.channel.type === "text" && isGuildManager(msg.member);
}

function defHelpCheck(msg: Message) {
	return msg.channel.type === "text";
}

@command(HELP_CATEGORY, BASE_PREFIX.slice(1), GUILD_HELP_KEYS.joinLeaveDesc, {
	[GUILD_HELP_KEYS.guildNameArg]: {
		optional: false,
		description: GUILD_HELP_KEYS.joinLeaveArg0Desc
	}
}, defHelpCheck)
@command(HELP_CATEGORY, CMD_GUILDS_CREATE.slice(1), GUILD_HELP_KEYS.createDesc, {
	[GUILD_HELP_KEYS.guildNameArg]: {
		optional: false,
		description: GUILD_HELP_KEYS.createArg0Desc
	},
	[GUILD_HELP_KEYS.createArg1]: {
		optional: true,
		description: GUILD_HELP_KEYS.createArg1Desc
	}
}, helpCheck)
@command(HELP_CATEGORY, CMD_GUILDS_EDIT.slice(1), GUILD_HELP_KEYS.editDesc, {
	[GUILD_HELP_KEYS.guildNameArg]: {
		optional: false,
		description: GUILD_HELP_KEYS.editArg0Desc
	},
	[GUILD_HELP_KEYS.editArg1]: {
		optional: false,
		description: GUILD_HELP_KEYS.editArg1Desc
	},
	[GUILD_HELP_KEYS.editArg2]: {
		optional: false,
		description: GUILD_HELP_KEYS.editArg2Desc
	}
}, helpCheck)
@command(HELP_CATEGORY, CMD_GUILDS_INVITE.slice(1), GUILD_HELP_KEYS.inviteDesc, {
	[GUILD_HELP_KEYS.guildNameArg]: {
		optional: false,
		description: GUILD_HELP_KEYS.inviteArg0Desc
	},
	[GUILD_HELP_KEYS.inviteArg1]: {
		optional: true,
		description: GUILD_HELP_KEYS.inviteArg1Desc
	},
	[GUILD_HELP_KEYS.inviteArg2]: {
		optional: false,
		description: GUILD_HELP_KEYS.inviteArg2Desc
	}
})
@command(HELP_CATEGORY, CMD_GUILDS_DELETE.slice(1), GUILD_HELP_KEYS.deleteDesc, {
	[GUILD_HELP_KEYS.guildNameArg]: {
		optional: false,
		description: GUILD_HELP_KEYS.deleteArg0Desc
	}
}, helpCheck)
@command(HELP_CATEGORY, CMD_GUILDS_LIST.slice(1), GUILD_HELP_KEYS.listDesc, {
	[GUILD_HELP_KEYS.listArg0]: {
		optional: true,
		description: `${GUILD_HELP_KEYS.listArg0Desc}`
	}
}, defHelpCheck)
@command(HELP_CATEGORY, CMD_GUILDS_INFO.slice(1), GUILD_HELP_KEYS.infoDesc, {
	[GUILD_HELP_KEYS.guildNameArg]: {
		optional: true,
		description: GUILD_HELP_KEYS.infoArg0Desc
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

	private readonly _dbController: GuildsDBController;
	private readonly _pendingInvites: INullableHashMap<{ code: string; }> = Object.create(null);

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

	// #region Process/message listener

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

	// #endregion

	// #region General message handler & router

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

	// #endregion

	// #region Handlers

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

	private async _sendHelp(channel: TextChannel, cmd: string = BASE_PREFIX, member: GuildMember) {
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
			embed: await generateLocalizedEmbed(EmbedType.Information, member, {
				key,
				formatOptions: {
					prefix: cmd
				}
			})
		});
	}

	// #endregion

	// #region Commands

	private async _createGuild(msg: Message) {
		// !guilds create Overwatch, !Overwatch
		if (msg.content === CMD_GUILDS_CREATE) {
			return this._sendHelp(
				<TextChannel> msg.channel,
				CMD_GUILDS_CREATE,
				msg.member
			);
		}

		if (!isGuildManager(msg.member)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
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
			const fields: IEmbedOptionsField[] = [];
			if ((msg.content.match(/\,/g) || []).length > 1) {
				fields.push({
					name: await localizeForUser(
						msg.member,
						"GUILDS_CREATE_FIELD_TIP"
					),
					value: await localizeForUser(
						msg.member,
						"GUILDS_CREATE_FILED_TIP_TEXT"
					),
				});
			}
			fields.push({
				name: await localizeForUser(
					msg.member, "GUILDS_CREATE_FIELDS_USAGE"
				),
				value: await localizeForUser(
					msg.member,
					"GUILDS_CREATE_FIELDS_USAGE_TEXT", {
						prefix: CMD_GUILDS_CREATE
					}
				)
			});

			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_CREATE_WRONGARGSCOUNT", {
						fields
					}
				)
			});
		}

		if (RESERVER_GUILD_NAMES.includes(args[0].toLowerCase())) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
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
					embed: await generateLocalizedEmbed(
						EmbedType.Error,
						msg.member,
						"GUILDS_CREATE_ALREADYFOUND_NOROLE"
					)
				});
			}

			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_CREATE_ALREADYFOUND_ROLE"
				)
			});
		}

		let role: Role | undefined;

		if (args.length === 1) {
			const roleName = `${DEFAULT_ROLE_PREFIX}${args[0]}`;

			// creating role
			const _confirmationEmbed = await generateLocalizedEmbed(
				EmbedType.Progress,
				msg.member, {
					key: "GUILDS_CREATE_ROLECREATING_CONFIRMATION",
					formatOptions: {
						roleName
					}
				}
			);

			const confirmation = await createConfirmationMessage(
				_confirmationEmbed,
				msg
			);

			if (!confirmation) {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(
						EmbedType.Error,
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
				reason: await localizeForGuild(
					msg.guild, "GUILDS_AUDITLOG_ROLE_CREATED", {
						initiator: msg.author.tag,
						guildName: args[0]
					}
				)
			});
		} else {
			role = resolveGuildRole(args[1],
				msg.guild,
				false, false
			);

			if (!role) {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(
						EmbedType.Error,
						msg.member,
						"GUILDS_CREATE_RESOLVINGFAILED"
					)
				});
			}
		}

		try {
			await msg.member.roles.add(
				role,
				await localizeForGuild(
					msg.guild,
					"GUILDS_AUDITLOG_CREATED_OWNER", {
						guildName: args[0]
					}
				)
			);
		} catch (err) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
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
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_CREATE_DBERROR"
				)
			});
		}

		return msg.channel.send({
			embed: await generateLocalizedEmbed(
				EmbedType.OK,
				msg.member,
				"GUILDS_CREATE_DONE"
			)
		});
	}

	private async _editGuild(msg: Message) {
		// !guilds edit Overwatch, description, Для фанатов этой отвратительной игры
		if (msg.content === CMD_GUILDS_EDIT) {
			return this._sendHelp(<TextChannel> msg.channel, CMD_GUILDS_EDIT, msg.member);
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

		if (EDITABLE_PARAMS.indexOf(editParam) === -1) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_EDIT_INVALIDPARAM"
				)
			});
		}

		let dbRow: IGuildRow | undefined | null;

		dbRow = await this._dbController.getGuild(
			msg.guild, guildName
		);

		if (!dbRow) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Information,
					msg.member,
					"GUILDS_EDIT_GUILDNOTFOUND"
				)
			});
		}

		if (!isGuildManager(msg.member, dbRow)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_NOPERMISSIONS"
				)
			});
		}

		const customize = <IGuildCustomize> JSON.parse(dbRow.customize);

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
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_INVALIDLINK"
						)
					});
				}

				const resolved = parseURI(content);

				const hostBanned =
					!resolved.hostname ||
					isHostBanned(resolved.hostname);

				if (hostBanned) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
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
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_IMAGELOADINGFAILED"
						)
					});
				}

				customize[editParam === "image" ? "image_url" : "icon_url"] =
					content;

				doneString = await localizeForUser(
					msg.member,
					"GUILDS_EDIT_IMAGESET"
				);
			} break;
			case "rules": {
				content = removeEveryoneMention(content);
				customize.rules = content;

				doneString = await localizeForUser(
					msg.member,
					"GUILDS_EDIT_RULESSET"
				);
			} break;
			case "welcome_msg_channel": {
				const channel = $discordBot.channels.get(content);

				if (!channel) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_CHANNELNOTFOUND"
						)
					});
				}

				if (channel.type !== "text") {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_WRONGCHANNEL"
						)
					});
				}

				if ((<TextChannel> channel).guild.id !== msg.guild.id) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_OTHERCHANNEL"
						)
					});
				}

				customize.welcome_msg_channel = content;

				doneString = await localizeForUser(
					msg.member,
					"GUILDS_EDIT_WELCOMECHANNELSET"
				);
			} break;
			case "welcome_msg": {
				content = removeEveryoneMention(content);

				const noMentions =
					!content.includes("{usermention}") &&
					!content.includes("{username}");

				if (noMentions) {
					let confirmation = false;

					try {
						confirmation = await createConfirmationMessage(
							await generateLocalizedEmbed(
								EmbedType.Error,
								msg.member,
								"GUILDS_EDIT_NOUSERMENTION"
							), msg
						);
					} catch (err) {
						confirmation = false;
					}

					if (confirmation) {
						return msg.channel.send({
							embed: await generateLocalizedEmbed(
								EmbedType.Error,
								msg.member,
								"GUILDS_CANCELED"
							)
						});
					}
				}

				customize.welcome_msg = content;

				doneString = await localizeForUser(
					msg.member,
					"GUILDS_EDIT_WELCOMEMSGSET"
				);
			} break;
			case "description": {
				content = removeEveryoneMention(content);

				dbRow.description = content;

				doneString = await localizeForUser(
					msg.member,
					"GUILDS_EDIT_DESCRIPTIONSET"
				);
			} break;
			case "owner": {
				if (isCalledByAdmin) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
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
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_MEMBERNOTFOUND"
						)
					});
				}

				if (member.id === dbRow.ownerId) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member, {
								key: "GUILDS_EDIT_TRANSFEROWNERSHIPTOOWNER",
								formatOptions: {
									serverAdmin
								}
							}
						)
					});
				}

				const confirmation = await createConfirmationMessage(
					await generateLocalizedEmbed(
						EmbedType.Question,
						msg.member, {
							key: "GUILDS_EDIT_TRANSFERCONFIRMATION",
							formatOptions: {
								username: escapeDiscordMarkdown(
									member.displayName, true
								)
							}
						}
					), msg
				);

				if (!confirmation) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.OK,
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

				doneString = await localizeForUser(
					msg.member,
					"GUILDS_EDIT_TRANSFERDONE", {
						serverAdmin
					}
				);
			} break;
			case "google-ua": {
				if (isCalledByAdmin) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_NOPERMS"
						)
					});
				}

				if (!content.startsWith("UA-")) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_GOOGLEUAWRONGCODE"
						)
					});
				}

				customize.ua = content;

				doneString = await localizeForUser(
					msg.member,
					"GUILDS_EDIT_GOOGLEUADONE"
				);
			} break;
			case "invite_only": case "private": {
				if (isCalledByAdmin) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_NOPERMS"
						)
					});
				}

				if (!["true", "false"].includes(content)) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_TRUEFALSEERR"
						)
					});
				}

				if (content === "true" && customize.invite_only) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.OK, msg.member, {
								key: "GUILDS_EDIT_IOALREADY",
								formatOptions: {
									ioAlreadyEnabled: true
								}
							}
						)
					});
				} else if (content === "false" && !customize.invite_only) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.OK, msg.member, {
								key: "GUILDS_EDIT_IOALREADY",
								formatOptions: {
									ioAlreadyEnabled: false
								}
							}
						)
					});
				}

				customize.invite_only = content === "true";

				doneString = await localizeForUser(
					msg.member, "GUILDS_EDIT_IOCHANGED", {
						ioEnabled: customize.invite_only
					}
				);
			} break;
			case "add_admin": case "add_adm": {
				if (isCalledByAdmin) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_ADDADMPERMS"
						)
					});
				}

				if (msg.mentions.members.size === 0) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_ADDADMNOMENTIONS"
						)
					});
				}

				if (msg.mentions.members.size > 1) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
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
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
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
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_RMADMPERMS"
						)
					});
				}

				if (msg.mentions.members.size === 0) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_NOMENTIONS"
						)
					});
				}

				if (msg.mentions.members.size > 1) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_SINGLEMENTION"
						)
					});
				}

				if (!customize.admins) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
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
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_INVALIDEMOJINAME"
						)
					});
				}

				if (msg.attachments.size === 0) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_NOATTACHMENT"
						)
					});
				} else if (msg.attachments.size > 1) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_TOOMANYATTACHMENTS"
						)
					});
				}

				const attachment = msg.attachments.first()!;

				if (!EMOJI_ACCESSIBLE_FORMATS.find(t => attachment.url.endsWith(t))) {
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member,
							"GUILDS_EDIT_INVALIDTYPE"
						)
					});
				} else if ((<number> attachment["size"]) > EMOJI_MAXSIZE) {
					// by some reason discord.js has no typedefs for `size`
					return msg.channel.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
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

				let emoji: Emoji;
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
					if (err instanceof DiscordAPIError) {
						return msg.channel.send({
							embed: await generateLocalizedEmbed(
								EmbedType.Error,
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

				doneString = await localizeForUser(
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
			embed: await generateLocalizedEmbed(
				EmbedType.OK, msg.member, {
					custom: true,
					string: doneString
				}
			)
		});
	}

	private static _emojiAPIErrorStr(err: DiscordAPIError, content: string, attachment: MessageAttachment) {
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

	private async _deleteGuild(msg: Message) {
		const guildName = msg.content.slice(CMD_GUILDS_DELETE.length).trim();

		if (guildName === "") {
			return this._sendHelp(
				<TextChannel> msg.channel,
				CMD_GUILDS_DELETE,
				msg.member
			);
		}

		let dbRow: IGuildRow | undefined | null;

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
				embed: await generateLocalizedEmbed(
					EmbedType.Information,
					msg.member,
					"GUILDS_EDIT_GUILDNOTFOUND"
				)
			});
		}

		if (!isGuildManager(msg.member, dbRow, true)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_NOPERMISSIONS"
				)
			});
		}

		const confirmation = await createConfirmationMessage(
			await generateLocalizedEmbed(
				EmbedType.Question,
				msg.member,
				"GUILDS_DELETE_CONFIRMATION"
			), msg
		);

		if (!confirmation) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.OK,
					msg.member,
					"GUILDS_CANCELED"
				)
			});
		}

		await this._dbController.deleteGuild(dbRow);

		return msg.channel.send({
			embed: await generateLocalizedEmbed(
				EmbedType.OK,
				msg.member,
				"GUILDS_DELETE_DONE"
			)
		});
	}

	private async _joinLeaveGuild(msg: Message) {
		// !guilds Overwatch
		const guildName = msg.content.slice(BASE_PREFIX.length).trim();

		if (guildName.length === 0) {
			return this._sendHelp(
				<TextChannel> msg.channel,
				undefined,
				msg.member
			);
		}

		let dbRow: IGuildRow | undefined | null;

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
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_EDIT_GUILDNOTFOUND"
				)
			});
		}

		const role = msg.guild.roles.get(dbRow.roleId);

		if (!role) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
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

	private async _leaveGuild(msg: Message, dbRow: IGuildRow | undefined | null, role: Role | undefined, guildName: string) {
		if (!dbRow || !role) { return; }

		const cz = <IGuildCustomize> JSON.parse(dbRow.customize);

		if (isGuildManager(msg.member, dbRow)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_LEAVE_ADMIN"
				)
			});
		}

		let visitor: ua.Visitor | undefined;

		if (cz.ua) {
			visitor = ua(
				cz.ua,
				msg.guild.id, {
					strictCidFormat: false,
					https: true,
					uid: msg.member.id
				}
			);
		}

		let str = await localizeForUser(
			msg.member,
			"GUILDS_LEAVE_CONFIRMATION", {
				guildName: escapeDiscordMarkdown(dbRow.name, true)
			}
		);

		if (cz.invite_only) {
			str += "\n";
			str += await localizeForUser(
				msg.member,
				"GUILDS_LEAVE_INVITEWARNING"
			);
		}

		const confirmationEmbed = await generateLocalizedEmbed(
			EmbedType.Question,
			msg.member, {
				custom: true,
				string: str
			}
		);

		const confirmation = await createConfirmationMessage(confirmationEmbed, msg);
		if (!confirmation) {
			visitor && visitor.event("Members", "Saved from leave", msg.member.id).send();

			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.OK,
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
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_LEAVE_ALREADYDESTROYED"
				)
			});
		}

		role = msg.guild.roles.get(dbRow.roleId);

		if (!role) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_LEAVE_ALREADYDELETEDROLE"
				)
			});
		}

		try {
			await msg.member.roles.remove(
				role,
				await localizeForGuild(
					msg.guild,
					"GUILDS_AUDITLOG_LEFT_GUILD", {
						guildName: dbRow.name
					}
				)
			);

			visitor && visitor
				.event("Members", "Left", msg.member.id)
				.send();
		} catch (err) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_LEAVE_ROLEFAILED"
				)
			});
		}

		return msg.channel.send({
			embed: await generateLocalizedEmbed(
				EmbedType.OK,
				msg.member, {
					key: "GUILDS_LEAVE_DONE",
					formatOptions: {
						guildName: escapeDiscordMarkdown(dbRow.name, true)
					}
				}
			)
		});
	}

	private static readonly _getProfilePicture = profilePicture(
		ProfilePictureFormat.TINY,
		ProfilePictureAnimatedBehavior.NO_ANIMATED
	);

	private static _getJoinGuildEmbed(str: string, author: GuildMember, title: string) {
		return generateLocalizedEmbed(
			EmbedType.Progress,
			author, {
				custom: true,
				string: str
			}, {
				universalTitle: title
			}
		);
	}

	private async _joinGuild(msg: Message, dbRow: IGuildRow | undefined, role: Role | undefined, guildName: string) {
		if (!dbRow || !role) { return; }

		let cz = <IGuildCustomize> JSON.parse(dbRow.customize);

		let visitor: ua.Visitor | undefined;

		if (cz.ua) {
			visitor = ua(
				cz.ua,
				msg.guild.id, {
					strictCidFormat: false,
					https: true,
					uid: msg.member.id
				}
			);
		}

		const isInvited =
			cz.invite_only ?
				Array.isArray(cz.invites) &&
				cz.invites.includes(msg.member.id) :
			true;

		if (!isInvited) {
			visitor && visitor
				.event(
					"Members",
					"Attempt to join without invitation",
					msg.member.id
				)
				.send();

			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_JOIN_IOERR"
				)
			});
		}

		const isBanned =
			Array.isArray(cz.banned) &&
			cz.banned.includes(msg.member.id);

		if (isBanned) {
			visitor && visitor
				.event(
					"Members",
					"Banned user attempted to join",
					msg.member.id
				)
				.send();

			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_JOIN_BANNEDERR"
				)
			});
		}

		const progressMsgTitle = await localizeForUser(
			msg.member,
			"GUILDS_JOIN_PROGRESS_TITLE", {
				username: getUserDisplayName(
					msg.member, true
				)
			}
		);

		const progressMsg = <Message> await msg.channel.send({
			embed: await Guilds._getJoinGuildEmbed(
				await localizeForUser(
					msg.member,
					"GUILDS_JOIN_PROGRESS", {
						guildName: escapeDiscordMarkdown(
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

			let rulesMsg: Message | undefined = undefined;

			// reuse?
			const embedTitle = await localizeForUser(
				msg.member,
				"GUILDS_JOIN_RULES_TITLE", {
					guildName: escapeDiscordMarkdown(
						dbRow.name, true
					)
				}
			);

			try {
				rulesMsg = <Message> await msg.author.send({
					embed: await generateLocalizedEmbed(
						EmbedType.Information,
						msg.member, {
							custom: true,
							string: cz.rules
						}, {
							universalTitle: embedTitle,
							fields: [{
								name: await localizeForUser(
									msg.member,
									"GUILDS_JOIN_RULES_FIELDS_CODE"
								),
								value: code
							}],
							footerText: await localizeForUser(
								msg.member,
								"GUILDS_JOIN_RULES_FOOTER_TEXT"
							)
						}
					)
				});
			} catch (err) {
				return progressMsg.edit({
					embed: await generateLocalizedEmbed(
						EmbedType.Error,
						msg.member, {
							key: "GUILDS_JOIN_FAILED_DM",
							formatOptions: {
								guildName: escapeDiscordMarkdown(
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
					await localizeForUser(
						msg.member,
						"GUILDS_JOIN_PROGRESS_RULES", {
							guildName: escapeDiscordMarkdown(
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
					const msgs = await waitForMessages(
						<DMChannel> rulesMsg.channel, {
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
					type: SHARDING_MESSAGE_TYPE.PENDING_INVITE_CREATE,
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
				throw new Error(
					"UNEXPECTED BEHAVIOR: Sharded run, but process.send isn't present"
				);
			}

			if (!confirmed) {
				await msg.author.send({
					embed: await generateLocalizedEmbed(
						EmbedType.Warning,
						msg.member, {
							key: "GUILDS_JOIN_FAILED_RULES_DM",
							formatOptions: {
								guildName: escapeDiscordMarkdown(
									dbRow.name, true
								)
							}
						}
					)
				});

				visitor && visitor
					.event(
						"Members",
						"User rejected the given rules",
						msg.member.id
					)
					.send();

				return progressMsg.edit({
					embed: await generateLocalizedEmbed(
						EmbedType.Error,
						msg.member, {
							key: "GUILDS_JOIN_FAILED_RULES",
							formatOptions: {
								guildName: escapeDiscordMarkdown(
									dbRow.name,
									true
								)
							}
						}
					)
				});
			}

			await rulesMsg.edit({
				embed: await generateLocalizedEmbed(
					EmbedType.OK,
					msg.member, {
						custom: true,
						string: cz.rules
					}, {
						universalTitle: embedTitle,
						footerText: await localizeForUser(
							msg.member,
							"GUILDS_JOIN_RULES_FOOTER_TEXT_OK"
						)
					}
				)
			});

			visitor && visitor
				.event(
					"Members",
					"User accepted the given rules",
					msg.member.id
				)
				.send();
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
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_JOIN_FAILED_DESTROYED"
				)
			});
		}

		role = msg.guild.roles.get(dbRow.roleId);

		cz = <IGuildCustomize> JSON.parse(dbRow.customize);

		if (!role) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_JOIN_FAILED_ROLEDELETED"
				)
			});
		}

		try {
			await msg.member.roles.add(
				role,
				await localizeForGuild(
					msg.guild,
					"GUILDS_AUDITLOG_JOINED_GUILD", {
						guildName: dbRow.name
					}
				)
			);

			visitor && visitor.event("Members", "Joined", msg.member.id).send();
		} catch (err) {
			return progressMsg.edit({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_JOIN_FAILED_ROLEASSIGN"
				)
			});
		}

		if (cz.welcome_msg && cz.welcome_msg_channel) {
			const channel = msg.guild.channels.get(cz.welcome_msg_channel);

			if (!channel || channel.type !== "text") { return; }

			await (<TextChannel> channel).send(
				cz.welcome_msg
					.replace("{usermention}", `<@${msg.author.id}>`)
					.replace("{username}", escapeDiscordMarkdown(
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
				embed: await generateLocalizedEmbed(
					EmbedType.OK,
					msg.member, {
						key: "GUILDS_JOIN_JOINED_RULES_DM",
						formatOptions: {
							guildName: escapeDiscordMarkdown(dbRow.name, true),
							serverName: escapeDiscordMarkdown(msg.guild.name, true)
						}
					}, {
						universalTitle: await localizeForUser(
							msg.member,
							"GUILDS_JOIN_JOINED_RULES_DM_TITLE"
						)
					}
				)
			});
		}

		return progressMsg.edit({
			embed: await generateLocalizedEmbed(
				EmbedType.Tada,
				msg.member, {
					key: "GUILDS_JOIN_DONE",
					formatOptions: {
						guildName: escapeDiscordMarkdown(dbRow.name, true)
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

	private async _getGuildInfo(msg: Message) {
		const guildName = msg.content
			.slice(CMD_GUILDS_INFO.length)
			.trim();

		if (guildName.length === 0) {
			return this._sendHelp(
				<TextChannel> msg.channel,
				CMD_GUILDS_INFO,
				msg.member
			);
		}

		let dbRow: IGuildRow | undefined;

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
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_EDIT_GUILDNOTFOUND"
				)
			});
		}

		const role = msg.guild.roles.get(dbRow.roleId);

		if (!role) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_INFO_FAILED_ROLEFAILURE"
				)
			});
		}

		const guildAuthor = msg.guild.members.get(dbRow.ownerId);

		const fields: IEmbedOptionsField[] = [];

		const guildMembers = msg.guild.members
			.filter(
				member => dbRow ?
					member.roles.has(dbRow.roleId) :
					false
			);

		fields.push({
			name: await localizeForUser(
				msg.member,
				"GUILDS_INFO_FIELDS_MEMBERS"
			),
			value: await localizeForUser(
				msg.member,
				"GUILDS_INFO_FIELDS_MEMBERS_VALUE", {
					count: guildMembers.size
				}
			),
			inline: true
		});

		const isMember = msg.member.roles.has(dbRow.roleId);

		fields.push({
			name: await localizeForUser(
				msg.member,
				"GUILDS_INFO_FIELDS_MEMBER"
			),
			value: await localizeForUser(
				msg.member,
				"GUILDS_INFO_FIELDS_MEMBER_VALUE", {
					member: isMember,
					greenTick: this._config.emojis.greenTick,
					redTick: this._config.emojis.redTick
				}
			),
			inline: true
		});

		const cz = <IGuildCustomize> JSON.parse(dbRow.customize);

		if (cz.invite_only) {
			let str = "";

			if (isMember) {
				if (dbRow.ownerId === msg.member.id) {
					str = await localizeForUser(
						msg.member, "GUILDS_INFO_FIELDS_IOSTATUS_VALUE_OWNER"
					);
				} else if (isGuildManager(msg.member, dbRow)) {
					str = await localizeForUser(
						msg.member, "GUILDS_INFO_FIELDS_IOSTATUS_VALUE_ADMIN"
					);
				} else {
					str = await localizeForUser(
						msg.member, "GUILDS_INFO_FIELDS_IOSTATUS_VALUE_MEMBER"
					);
				}
			} else {
				str = await localizeForUser(
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
				name: await localizeForUser(
					msg.member,
					"GUILDS_INFO_FIELDS_IOSTATUS"
				),
				value: str
			});
		}

		return msg.channel.send({
			embed: await generateLocalizedEmbed(
				EmbedType.Empty, msg.member, {
					custom: true,
					string:
						dbRow.description ||
						await localizeForUser(
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

	private async _membersControl(msg: Message) {
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

		let dbRow: IGuildRow | undefined;

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
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_EDIT_GUILDNOTFOUND"
				)
			});
		}

		if (!msg.guild.roles.has(dbRow.roleId)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
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
					embed: await generateLocalizedEmbed(
						EmbedType.Error,
						msg.member,
						"GUILDS_MEMBERSCONTROL_NOMENTIONS"
					)
				});
			}

			if (!isGuildManager(msg.member, dbRow, false)) {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(
						EmbedType.Error,
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

	private static _membersControlFixString(str: string) { return replaceAll(str, "`", "'"); }

	private async _membersControlAction(msg: Message, dbRow: IGuildRow, action: "list" | "kick" | "ban" | "unban" | "add") {
		let statusMsg = <Message> await msg.channel.send({
			embed: await generateLocalizedEmbed(
				EmbedType.Progress,
				msg.member,
				"GUILDS_MEMBERSCONTROL_LOADING"
			)
		});

		const members = msg.guild.members
			.filter(m => m.roles.has(dbRow.roleId));

		const cz = <IGuildCustomize> JSON.parse(dbRow.customize);

		let visitor: ua.Visitor | undefined = undefined;
		if (cz.ua) {
			visitor = ua(
				cz.ua,
				msg.guild.id, {
					strictCidFormat: false,
					https: true,
					uid: msg.member.id
				}
			);
		}

		switch (action) {
			case "list": {
				let str = `# ${await localizeForUser(
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
				membersStr += `## ${await localizeForUser(
					msg.member,
					"GUILDS_MEMBERSCONTROL_LIST_OWNER"
				)}`;

				membersStr += `- ${ownerStr || "[Owner left](This guild is owned by server)"}\n\n`;

				if (admins.length > 0) {
					membersStr += `## ${await localizeForUser(
						msg.member,
						"GUILDS_MEMBERSCONTROL_LIST_ADMINS"
					)}\n`;
					membersStr += `${admins.join("\n")}\n\n`;
				}

				membersStr += `## ${await localizeForUser(
					msg.member,
					"GUILDS_MEMBERSCONTROL_LIST_EVERYONE"
				)}\n`;
				membersStr += otherMembers.join("\n");

				str += `\n\n${membersStr}`;

				statusMsg = await statusMsg.edit({
					embed: await generateLocalizedEmbed(
						EmbedType.Progress,
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
						embed: await generateLocalizedEmbed(
							EmbedType.OK,
							msg.member,
							"GUILDS_MEMBERSCONTROL_SENT"
						)
					});
				} catch (err) {
					statusMsg = await statusMsg.edit({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member,
							"GUILDS_MEMBERSCONTROL_SENDINGERR"
						)
					});
				}
			} break;
			case "kick": case "ban": case "unban": {
				if (msg.mentions.users.size > MAX_MEMBERSCONTROL_MENTIONS) {
					statusMsg = await statusMsg.edit({
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
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
						embed: await generateLocalizedEmbed(
							EmbedType.Error,
							msg.member, 
							"GUILDS_MEMBERSCONTROL_NONEBANNED"
						)
					});
				}

				for (const mention of msg.mentions.users.values()) {
					const member = msg.guild.members.get(mention.id);
					let adminRemoved = false;

					if (!member) {
						str += `${await localizeForUser(msg.member,
							"GUILDS_MEMBERSCONTROL_NOTAMEMBEROFSERVER", {
								username: escapeDiscordMarkdown(
									mention.username, true
								)
							}
						)}\n`;
						continue;
					}

					if (isGuildManager(msg.member, dbRow, true)) {
						// command called by admin or guild owner
						if (isGuildManager(member, dbRow, false)) {
							const cz = <IGuildCustomize> JSON.parse(dbRow.customize);
							const index = (cz.admins || []).indexOf(member.id);

							if (index < 0) {
								str += `${await localizeForUser(
									msg.member,
									"GUILDS_MEMBERSCONTROL_SERVERADM", {
										username: escapeDiscordMarkdown(mention.username, true)
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
							await localizeForUser(
								msg.member, "GUILDS_MEMBERSCONTROL_GUILDADMOROWNR", {
									username: escapeDiscordMarkdown(mention.username, true)
								}
							)}\n`;
						continue;
					}

					if (!member.roles.has(dbRow.roleId)) {
						if (action === "kick") {
							str += `${await localizeForUser(
								msg.member,
								"GUILDS_MEMBERSCONTROL_NOTAMEMBER", {
									username: escapeDiscordMarkdown(member.displayName, true)
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
							await localizeForGuild(
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

						str += `${await localizeForUser(
							msg.member,
							removeStr, {
								username: escapeDiscordMarkdown(member.displayName, true)
							}
						)}\n`;

						visitor && visitor
							.event(
								"Users Management",
								"Member kicked",
								member.id
							)
							.send();
					} else if (action === "ban") {
						if (!Array.isArray(cz.banned)) {
							cz.banned = [];
						}

						cz.banned.push(member.id);

						const removeStr = adminRemoved ?
							"GUILDS_MEMBERSCONTROL_BANNEDADMITEM" :
							"GUILDS_MEMBERSCONTROL_BANNEDITEM";

						str += `${await localizeForUser(
							msg.member,
							removeStr, {
								username: escapeDiscordMarkdown(
									member.displayName, true
								)
							}
						)}\n`;

						visitor && visitor
							.event(
								"Users Management",
								"Member banned",
								member.id
							)
							.send();
					} else if (action === "unban") {
						if (!Array.isArray(cz.banned)) { break; }

						const index = cz.banned.indexOf(member.id);

						if (index === -1) {
							str += `${await localizeForUser(
								msg.member,
								"GUILDS_MEMBERSCONTROL_NOTBANNED", {
									username: escapeDiscordMarkdown(
										member.displayName, true
									)
								}
							)}\n`;
							continue;
						}

						cz.banned.splice(index, 1);

						str += `${await localizeForUser(
							msg.member,
							"GUILDS_MEMBERSCONTROL_UNBANNEDITEM", {
								username: escapeDiscordMarkdown(
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
					embed: await generateLocalizedEmbed(
						affected === 0 ? EmbedType.Error : EmbedType.OK,
						msg.member, {
							custom: true,
							string: str
						}, {
							title: await localizeForUser(
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

	private async _inviteToGuild(msg: Message) {
		if (msg.content === CMD_GUILDS_INVITE) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Information,
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
				embed: await generateLocalizedEmbed(
					EmbedType.Information,
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

		let dbRow: IGuildRow | undefined;

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
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "GUILDS_EDIT_GUILDNOTFOUND")
			});
		}

		const isRevoke = args[1] === "revoke";

		const cz = <IGuildCustomize> JSON.parse(dbRow.customize);

		if (!isGuildManager(msg.member, dbRow)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_NOPERMISSIONS"
				)
			});
		}

		if (msg.mentions.users.size === 0) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					msg.member,
					"GUILDS_INVITE_NOMENTIONS"
				)
			});
		}

		if (!cz.invites && isRevoke) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
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
					str += `${await localizeForUser(
						msg.member,
						"GUILDS_INVITE_NOTINVITED", {
							username: escapeDiscordMarkdown(mention.username, true)
						}
					)}\n`;

					continue;
				}
				
				cz.invites.splice(index, 1);
				
				str += `${await localizeForUser(
					msg.member,
					"GUILDS_INVITE_REVOKEDITEM", {
						username: escapeDiscordMarkdown(mention.username, true)
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

					str += `${await localizeForUser(
						msg.member,
						"GUILDS_INVITE_AUTOREVOKED_1", {
							username: escapeDiscordMarkdown(member.displayName, true)
						}
					)}\n`;
				} else {
					str += `${await localizeForUser(
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
					str += `${await localizeForUser(
						msg.member,
						"GUILDS_INVITE_NOTAMEMBER", {
							username: escapeDiscordMarkdown(
								userObj.username, true
							)
						}
					)}\n`;

					continue;
				}
				if (member.roles.has(dbRow.roleId)) {
					str += `${await localizeForUser(
						msg.member,
						"GUILDS_INVITE_GUILDMEMBER", {
							username: escapeDiscordMarkdown(
								userObj.username, true
							)
						}
					)}\n`;

					continue;
				}
				if (cz.invites.includes(userId)) {
					str += `${await localizeForUser(
						msg.member,
						"GUILDS_INVITE_ALREADYINVITED", {
							username: escapeDiscordMarkdown(
								userObj.username, true
							)
						}
					)}\n`;

					continue;
				}

				cz.invites.push(userId);

				try {
					await member.send({
						embed: await generateLocalizedEmbed(
							EmbedType.Information,
							member, {
								key: "GUILDS_INVITE_INVITEMSG",
								formatOptions: {
									prefix: BASE_PREFIX,
									guildName: escapeDiscordMarkdown(dbRow.name, true),
									serverName: escapeDiscordMarkdown(msg.guild.name, true),
									RAWguildName: dbRow.name,
									botName: escapeDiscordMarkdown(
										member.guild.me.displayName,
										true
									)
								}
							}
						)
					});

					str += `${await localizeForUser(
						msg.member,
						"GUILDS_INVITE_INVITESENT", {
							username: escapeDiscordMarkdown(member.displayName, true)
						}
					)}\n`;
				} catch (err) {
					str += `${await localizeForUser(
						msg.member,
						"GUILDS_INVITE_NOTSENT", {
							username: escapeDiscordMarkdown(member.displayName, true)
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
				embed: await generateLocalizedEmbed(
					revoked === 0 ? EmbedType.Error : EmbedType.OK,
					msg.member, {
						custom: true, string: str
					}, {
						title: await localizeForUser(
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
				embed: await generateLocalizedEmbed(
					invited === 0 ? EmbedType.Error : EmbedType.OK,
					msg.member, {
						custom: true, string: str
					}, {
						title: await localizeForUser(
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

	private async _getGuildsList(msg: Message) {
		const pageVal = msg.content.slice(CMD_GUILDS_LIST.length);

		let list = 1;

		if (pageVal !== "") {
			list = parseInt(pageVal, 10);
			list = Math.abs(list);
			list = Math.max(1, list);

			if (isNaN(list)) {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(
						EmbedType.Error,
						msg.member,
						"GUILDS_LIST_WRONGUSAGE"
					)
				});
			}
		}

		const dbResp = await this._dbController.getGuilds(
			msg.guild, {
				offset: (GUILDS_PER_PAGE * list) - GUILDS_PER_PAGE,
				limit: GUILDS_PER_PAGE
			}
		);

		if (dbResp.guilds.length === 0) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Information,
					msg.member,
					"GUILDS_LIST_EMPTYPAGE"
				)
			});
		}

		const fields: IEmbedOptionsField[] = [];

		for (let i = 0, l = dbResp.guilds.length; i < l; i++) {
			const row = dbResp.guilds[i];

			const hasDescription = 
				row.description &&
				row.description.length > 0;

			const description = hasDescription ?
				row.description :
				await localizeForUser(
					msg.member,
					"GUILDS_LIST_DESCRIPTIONPLACEHOLDER"
				);

			fields.push({
				inline: false,
				name: row.name,
				value: description
			});
		}

		return msg.channel.send({
			embed: await generateLocalizedEmbed(
				EmbedType.Information,
				msg.member, {
					key: "GUILDS_LIST_JOININFO",
					formatOptions: {
						prefix: BASE_PREFIX
					}
				}, { 
					informationTitle: await localizeForUser(
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

const FMT_SMALL_GUILD_ICON : AvatarOptions = { format: "webp", size: 128 };
type InviteIPCMessage = IPCMessage<{ uid: string }>;

export default Guilds;
