import { IModule, ModuleBase } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message, Guild, Role, GuildMember } from "discord.js";
import { EmbedType, resolveGuildRole, IEmbedOptionsField, escapeDiscordMarkdown } from "../utils/utils";
import { getDB } from "../utils/db";
import { command as cmd } from "../utils/help";
import { createConfirmationMessage } from "../utils/interactive";
import { localizeForUser, generateLocalizedEmbed, localizeForGuild } from "../utils/ez-i18n";
import { getPreferenceValue, setPreferenceValue, removePreference } from "../utils/guildPrefs";
import { randomPick } from "../utils/random";
import { isVerified, isInitializated as isVerifiedEnabled } from "../utils/verified";
import { messageToExtra } from "../utils/failToDetail";
import { Whitelist } from "../whitelist/whitelist";
import { join as pathJoin } from "path";
import { IHashMap, createHashMap } from "../../types/Types";
import * as knex from "knex";
import * as getLogger from "loggy";

const TABLE_NAME = "color_prefixes";
const COLORFUL_PREFIX = "!color";
const COLORFUL_HELP_PREFIX = COLORFUL_PREFIX.slice(1);
const HELP_CATEGORY = "COLORS";
const DB_VERSION = 2;

export interface IColorfulGuildColorInfo {
	required_role?: string[] | string;
	role: string;
}

export interface IColorfulGuildInfo {
	guildId: string;
	rolePrefixes: IHashMap<IColorfulGuildColorInfo>;
}

export interface IColorfulMigration {
	perform(db: knex, tableName: string) : Promise<boolean>;
	description: string;
	name: string;
}

const checkPerms = (member: GuildMember) => member.permissions.has(["MANAGE_ROLES", "MANAGE_GUILD"]);

const isChat = (msg: Message) => msg.channel.type === "text";

const isChatAndHasPermissions = (msg: Message) => (isChat(msg) && checkPerms(msg.member));

@cmd(HELP_CATEGORY, COLORFUL_HELP_PREFIX, "loc:COLORS_META_ASSIGN", {
	"loc:COLORS_META_COLORNAME": {
		optional: false,
		description: "loc:COLORS_META_ASSIGN_ARG_DESC"
	}
}, isChat)
@cmd(HELP_CATEGORY, `${COLORFUL_HELP_PREFIX} list`, "loc:COLORS_META_LIST", undefined, isChat)
@cmd(HELP_CATEGORY, `${COLORFUL_HELP_PREFIX} info`, "loc:COLORS_META_INFO", {
	"loc:COLORS_META_COLORNAME": {
		optional: false,
		description: "loc:COLORS_META_INFO_ARG_DESC"
	}
}, isChat)
@cmd(HELP_CATEGORY, `${COLORFUL_HELP_PREFIX} onjoin`, "loc:COLORS_META_ONJOIN", {
	"loc:COLORS_META_ONJOIN_ARG0": {
		optional: false,
		values: ["off", "set", "random"],
		description: "loc:COLORS_META_ONJOIN_ARG0_DESC"
	},
	"loc:COLORS_META_ONJOIN_ARG1": {
		optional: true,
		description: "loc:COLORS_META_ONJOIN_ARG1_DESC"
	}
}, isChatAndHasPermissions)
@cmd(HELP_CATEGORY, `${COLORFUL_HELP_PREFIX} reset`, "loc:COLORS_META_RESET", undefined, isChat)
@cmd(HELP_CATEGORY, `${COLORFUL_HELP_PREFIX} add`, "loc:COLORS_META_ADD", {
	"loc:COLORS_META_COLORNAME": {
		optional: false,
		description: "loc:COLORS_META_ADD_ARG0_DESC"
	},
	"loc:COLORS_META_ADD_ARG1": {
		optional: true,
		description: "loc:COLORS_META_ADD_ARG1_DESC"
	},
	"loc:COLORS_META_ADD_ARG2": {
		optional: false,
		description: "loc:COLORS_META_ADD_ARG2"
	}
}, isChatAndHasPermissions)
@cmd(HELP_CATEGORY, `${COLORFUL_HELP_PREFIX} rename`, "loc:COLORS_META_RENAME", {
	"loc:COLORS_META_RENAME_ARG0": {
		optional: false,
		description: "loc:COLORS_META_RENAME_ARG0_DESC"
	},
	"loc:COLORS_META_RENAME_ARG1": {
		optional: false,
		description: "loc:COLORS_META_RENAME_ARG1_DESC"
	}
}, isChatAndHasPermissions)
@cmd(HELP_CATEGORY, `${COLORFUL_HELP_PREFIX} delete`, "loc:COLORS_META_DELETE", {
	"loc:COLORS_META_COLORNAME": {
		optional: false,
		description: "loc:COLORS_META_DELETE_ARG_DESC"
	}
}, isChatAndHasPermissions)
class Colors extends Plugin implements IModule {
	public get signature () {
		return "snowball.features.colors";
	}

	// ===========================================
	// INITIAL VARIABLES & CONSTRUCTOR
	// ===========================================
	private readonly log = getLogger("ColorsJS");
	private readonly db = getDB();
	private whitelistModule : ModuleBase<Whitelist>|undefined = undefined;

	constructor() {
		super({
			"message": (msg) => this.onMessage(msg),
			"guildMemberAdd": (member) => this.onMemberJoin(member)
		}, true);
	}

	// ===========================================
	// MESSAGE HANDLING
	// ===========================================

	private async onMessage(msg: Message) {
		if(msg.channel.type !== "text") { return; }
		if(!msg.content || !msg.content.startsWith(COLORFUL_PREFIX)) { return; }
		
		const args = msg.content.split(" ");

		if(args.length === 1 && args[0] === COLORFUL_PREFIX) { return; }

		args.shift(); // skip prefix

		try {
			switch(args[0]) {
				// add Blue, color_blue
				case "add": return await this.cmd_add(msg, args);
				// delete Blue
				case "delete": return await this.cmd_delete(msg, args);
				// info Blue
				case "info": return await this.cmd_info(msg, args);
				// list 5
				case "list": return await this.cmd_list(msg);
				// reset
				case "reset": return await this.cmd_reset(msg);
				// rename Blue, blue
				case "rename": return await this.cmd_rename(msg, args);
				case "onjoin": return await this.cmd_onjoin(msg, args);
				// diag
				case "diag": return await this.cmd_diag(msg);
				// Blue
				default: return await this.cmd_assign(msg, args);
			}
		} catch(err) {
			this.log("err", `Error due running command \`${msg.content}\``, err);
			$snowball.captureException(err, { extra: messageToExtra(msg) });
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_RUNNINGFAILED")
			});
		}
	}

	private async onMemberJoin(member:GuildMember) {
		if(isVerifiedEnabled() && !(await isVerified(member))) {
			return;
		}

		const role = await getPreferenceValue(member.guild, "colors:join");

		if(typeof role !== "string") { return; }

		const colorfulInfo = await this.getInfo(member.guild);

		let roles = Object.values(colorfulInfo.rolePrefixes);

		if(role === "random") {
			// pick random
			roles = roles.filter((r) => !r.required_role);
			if(roles.length === 0) { return; } // no colors to give

			const randomColor = randomPick(roles);
			try {
				await member.roles.add(randomColor.role, await localizeForGuild(member.guild, "COLORS_AUDITLOG_ONJOIN_RANDOM_ROLE"));
			} catch(err) {
				this.log("err", "Failed to assing random color", err, member.guild.id);
				$snowball.captureException(err, {
					extra: {
						guild: member.guild,
						member: member,
						randomColor,
						originalError: err
					}
				});
			}
		} else {
			const color = roles.find(r => r.role === role);
			if(!color) { return; } // color was removed prob

			try {
				await member.roles.add(color.role, await localizeForGuild(member.guild, "COLORS_AUDITLOG_ONJOIN_ROLE"));
			} catch(err) {
				this.log("err", "Failed to assign color role", err, member.guild.id);
				$snowball.captureException(err, {
					extra: {
						guild: member.guild,
						member: member,
						color,
						originalError: err
					}
				});
			}
		}
	}

	// ===========================================
	// USER'S FUNCTIONS
	// ===========================================

	private async cmd_assign(msg: Message, args: string[]) {
		// Синий
		const colorName = args.join(" ").trim();

		const colorfulInfo = await this.getInfo(msg.guild);

		const colorInfo = colorfulInfo.rolePrefixes[colorName];

		if(!colorInfo) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_NOTFOUND")
			});
		}

		if(colorInfo.required_role) {
			let canApply = false;
			if(colorInfo.required_role instanceof Array) {
				canApply = !!colorInfo.required_role.find(roleId => msg.member.roles.has(roleId));
				if(!canApply) {
					return msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_NOREQUIREDROLES")
					});
				}
			} else {
				canApply = msg.member.roles.has(colorInfo.required_role);
				if(!canApply) {
					return msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_NOREQUIREDROLE")
					});
				}
			}
		}

		const colorRole = msg.guild.roles.get(colorInfo.role);

		if(!colorRole) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ROLENOTFOUND")
			});
		}

		if(msg.member.roles.has(colorInfo.role)) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ALREADYSET")
			});
		}

		const _confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, "COLORS_ASSIGN_CONFIRMATION", {
			thumbUrl: `http://www.colorhexa.com/${colorRole.hexColor.slice(1)}.png`
		});

		const confirmation = await createConfirmationMessage(_confirmationEmbed, msg);

		if(!confirmation) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_CANCELED")
			});
		}

		const toUnassign: Role[] = [] as Role[];
		for(const info of Object.values(colorfulInfo.rolePrefixes)) {
			const role = msg.member.roles.get(info.role);
			if(role) { toUnassign.push(role); }
		}

		if(toUnassign.length > 0) {
			try {
				await msg.member.roles.remove(toUnassign, await localizeForGuild(msg.guild, "COLORS_AUDITLOG_PREVIOUS_COLOR_REMOVED"));
			} catch(err) {
				$snowball.captureException(err, {
					extra: messageToExtra(msg, { toUnassign })
				});
				return msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_FAILED_UNASSIGN")
				});
			}
		}

		try {
			await msg.member.roles.add(colorInfo.role, await localizeForGuild(msg.guild, "COLORS_AUDITLOG_COLOR_ASSIGNED", {
				colorName
			}));
		} catch(err) {
			$snowball.captureException(err, {
				extra: messageToExtra(msg, { roleId: colorInfo.role })
			});
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_FAILED_ASSIGN")
			});
		}

		return msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Tada, msg.member, "COLORS_ASSIGN_DONE")
		});
	}

	private async cmd_reset(msg: Message) {
		const _confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, "COLORS_RESET_CONFIRMATION");

		const confirmation = await createConfirmationMessage(_confirmationEmbed, msg);

		if(!confirmation) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_CANCELED")
			});
		}

		const colorfulInfo = await this.getInfo(msg.guild);

		const toUnassign: Role[] = [];
		for(const colorInfo of Object.values(colorfulInfo.rolePrefixes)) {
			const role = msg.member.roles.get(colorInfo.role);
			if(role) { toUnassign.push(role); }
		}

		try {
			await msg.member.roles.remove(toUnassign, await localizeForGuild(msg.guild, "COLORS_AUDITLOG_COLORS_RESET"));
		} catch(err) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_RESET_FAILED")
			});
		}

		return msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Tada, msg.member, "COLORS_RESET_DONE")
		});
	}

	private async cmd_add(msg: Message, args: string[]) {
		if(!checkPerms(msg.member)) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_NOPERMISSION")
			});
		}

		if(!msg.guild.me.permissions.has("MANAGE_ROLES")) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_INVALIDBOTPERMS")
			});
		}

		// ["add", "Синий,", "color_blue"]
		args.shift();
		// [ "Синий,", " color_blue"] -> "Синий, color_blue" -> ["Синий", " color_blue"] -> ["Синий", "color_blue"]
		args = args.join(" ").split(",").map(arg => arg.trim());
		if(args.length !== 2 && args.length !== 3) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_ADD_ARGSERR")
			});
		}

		let colorfulInfo = await this.getInfo(msg.guild);

		if(["list", "info", "reset", "add", "rename", "delete"].includes(args[0].toLowerCase())) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ADD_NAMERESERVED")
			});
		}

		if(colorfulInfo.rolePrefixes[args[0]]) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ADD_ALREADYEXISTS")
			});
		}

		const namedArgs = {
			required_role: args.length === 3 ? args[1] : undefined,
			role: args.length === 3 ? args[2] : args[1],
			name: args[0]
		};

		const colorRole = resolveGuildRole(namedArgs.role, msg.guild);
		if(!colorRole) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ADD_ROLENOTFOUND")
			});
		}

		if(colorRole.position > msg.guild.me.roles.highest.position) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ADD_INVALIDROLEPOSITION")
			});
		}

		let requiredRoles: Role[] | Role | undefined = undefined;
		if(namedArgs.required_role) {
			if(namedArgs.required_role.indexOf("|") === -1) {
				requiredRoles = resolveGuildRole(namedArgs.required_role, msg.guild, false, false);
				if(!requiredRoles) {
					return msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ADD_REQUIREDROLENOTFOUND")
					});
				}
			} else {
				const requiredRolesNames = namedArgs.required_role.split("|").map(arg => arg.trim());
				requiredRoles = [];
				for(const nameToResolve of requiredRolesNames) {
					const resolvedRole = resolveGuildRole(nameToResolve, msg.guild, false, false);
					if(!resolvedRole) {
						return msg.channel.send("", {
							embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
								key: "COLORS_ADD_REQUIREDROLENOTFOUND2",
								formatOptions: {
									rolename: nameToResolve
								}
							})
						});
					}
					if(requiredRoles && requiredRoles instanceof Array) {
						requiredRoles.push(resolvedRole);
					}
				}
			}
		}

		// Вы собираетесь добавить цвет {colorName}, роль которого - `{colorRoleName}` ({colorHEX}, цвет показан справа)

		let _confirmationString = `${(await localizeForUser(msg.member, "COLORS_ADD_CONFIRMATION", {
			colorName: namedArgs.name,
			colorRoleName: colorRole.name,
			colorHEX: colorRole.hexColor.toUpperCase()
		}))}.\n`;

		if(requiredRoles) {
			if(requiredRoles instanceof Role) {
				_confirmationString += (await localizeForUser(msg.member, "COLORS_ADD_CONFIRMATION_REQUIREDROLE", {
					requiredRoleName: escapeDiscordMarkdown(requiredRoles.name)
				}));
			} else {
				_confirmationString += await localizeForUser(msg.member, "COLORS_ADD_CONFIRMATION_REQUIREDROLES");
				for(let i = 0; i < requiredRoles.length; i++) {
					const requiredRole = requiredRoles[i];
					_confirmationString += await localizeForUser(msg.member, "COLORS_ADD_CONFIRMATION_REQUIREDROLES_ITEM", {
						roleName: escapeDiscordMarkdown(requiredRole.name),
						latest: (i + 1) === requiredRoles.length
					});
				}
			}
		}

		_confirmationString += `"\n\n${await localizeForUser(msg.member, "COLORS_ADD_CONFIRMATION_RIGHTSWARNING")}`;

		const _confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
			custom: true,
			string: _confirmationString
		}, {
				thumbUrl: `http://www.colorhexa.com/${colorRole.hexColor.slice(1)}.png`
			});

		const confirmation = await createConfirmationMessage(_confirmationEmbed, msg);

		if(!confirmation) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_CANCELED")
			});
		}

		// namedArgs.required_role = JSON.stringify(requiredRoles);
		namedArgs.role = colorRole.id;

		try {
			await colorRole.edit({
				permissions: [],
				hoist: colorRole.hoist,
				color: colorRole.color,
				mentionable: false
			}, await localizeForGuild(msg.guild, "COLORS_AUDITLOG_ROLE_PERMISSIONS_ANNULLED", {
				initiator: msg.author.tag,
				colorName: namedArgs.name
			}));
		} catch(err) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ADD_ROLEFIX_FAILED")
			});
		}

		// re-request colorful info, because it can be changed
		colorfulInfo = await this.getInfo(msg.guild);

		if(colorfulInfo.rolePrefixes[namedArgs.name]) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ADD_ALREADYEXISTS")
			});
		}

		colorfulInfo.rolePrefixes[namedArgs.name] = {
			required_role: requiredRoles ? requiredRoles instanceof Array ? requiredRoles.map(r => r.id) : requiredRoles.id : undefined,
			role: namedArgs.role
		};

		await this.updateInfo(colorfulInfo);

		return msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Tada, msg.member, "COLORS_ADD_DONE")
		});
	}

	private async cmd_rename(msg: Message, args: string[]) {
		if(!checkPerms(msg.member)) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_NOPERMISSION")
			});
		}

		// rename Синий, blue
		args.shift();

		// Синий, blue
		args = args.join(" ").split(",").map(arg => arg.trim());

		// ["Синий", "blue"]
		if(args.length !== 2) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_RENAME_ARGSERR")
			});
		}

		let colorfulInfo = await this.getInfo(msg.guild);

		let previousColor = colorfulInfo.rolePrefixes[args[0]];

		if(!previousColor) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
					key: "COLORS_COLORNOTFOUND",
					formatOptions: {
						colorName: escapeDiscordMarkdown(args[0])
					}
				})
			});
		}

		if(colorfulInfo.rolePrefixes[args[1]]) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
					key: "COLORS_RENAME_ALREADYEXISTS",
					formatOptions: {
						colorName: args[1]
					}
				})
			});
		}

		const _confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
			key: "COLORS_RENAME_CONFIRMATION",
			formatOptions: {
				before: args[0],
				after: args[1]
			}
		});

		const confirmation = await createConfirmationMessage(_confirmationEmbed, msg);

		if(!confirmation) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_CANCELED")
			});
		}

		colorfulInfo = await this.getInfo(msg.guild);

		previousColor = colorfulInfo.rolePrefixes[args[0]];

		if(!previousColor) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
					key: "COLORS_RENAME_CONFIRMATIONWAITREMOVED",
					formatOptions: {
						colorName: escapeDiscordMarkdown(args[0])
					}
				})
			});
		}

		if(colorfulInfo.rolePrefixes[args[1]]) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
					key: "COLORS_RENAME_CONFIRMATIONWAITBINDED",
					formatOptions: {
						colorName: args[1]
					}
				})
			});
		}

		colorfulInfo.rolePrefixes[args[1]] = previousColor;

		delete colorfulInfo.rolePrefixes[args[0]];

		await this.updateInfo(colorfulInfo);

		return msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "COLORS_RENAME_DONE")
		});
	}

	private async cmd_delete(msg: Message, args: string[]) {
		if(!checkPerms(msg.member)) { return; }

		// delete Синий
		args.shift();

		const colorName = args.join(" ").trim();

		// Синий
		if(colorName.length === 0) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_DELETE_INFO")
			});
		}

		let colorfulInfo = await this.getInfo(msg.guild);

		let colorInfo = colorfulInfo.rolePrefixes[colorName];

		if(!colorInfo) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
					key: "COLORS_COLORNOTFOUND",
					formatOptions: {
						colorName
					}
				})
			});
		}

		const colorRole = msg.guild.roles.get(colorInfo.role);

		if(!colorRole) {
			delete colorfulInfo.rolePrefixes[colorName];
			await this.updateInfo(colorfulInfo);
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_DELETE_REMOVEDWITHOUTCONFIRMATION")
			});
		}

		const confirmed = await createConfirmationMessage(
			await generateLocalizedEmbed(EmbedType.Question, msg.member, "COLORS_DELETE_CONFIRMATION", {
				thumbUrl: `http://www.colorhexa.com/${colorRole.hexColor.slice(1)}.png`
			}),
			msg
		);

		if(!confirmed) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_CANCELED")
			});
		}

		// because it can be updated due confirmation
		colorfulInfo = await this.getInfo(msg.guild);

		colorInfo = colorfulInfo.rolePrefixes[colorName];

		if(!colorInfo) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_DELETE_ALREADYDELETED")
			});
		}

		delete colorfulInfo.rolePrefixes[colorName];

		await this.updateInfo(colorfulInfo);

		return msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "COLORS_DELETE_DONE")
		});
	}

	private async cmd_info(msg: Message, args: string[]) {
		// info Синий
		args.shift();
		const colorName = (args as string[]).join(" ").trim();

		// Синий
		if(colorName.length === 0) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_GETINFO_INFO")
			});
		}

		const colorfulInfo = await this.getInfo(msg.guild);

		const colorInfo = colorfulInfo.rolePrefixes[colorName];

		if(!colorInfo) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
					key: "COLORS_GETINFO_NOTFOUND",
					formatOptions: {
						prefix: COLORFUL_PREFIX
					}
				})
			});
		}

		const colorRole = msg.guild.roles.get(colorInfo.role);
		if(!colorRole) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_GETINFO_ROLEREMOVED")
			});
		}

		const fields: IEmbedOptionsField[] = [] as IEmbedOptionsField[];
		let isAvailable = false;
		let requiredRolesToObtain: undefined | string[] = undefined;

		if(colorInfo.required_role) {
			const resolvedRequiredRoles: Array<{
				roleName: string; has: boolean;
			}> = [];

			for(const requiredRoleId of colorInfo.required_role!) {
				const role = msg.guild.roles.get(requiredRoleId);
				if(role) {
					const obj = {
						roleName: role.name,
						has: msg.member.roles.has(requiredRoleId)
					};
					if(!isAvailable && obj.has) { isAvailable = true; }
					resolvedRequiredRoles.push(obj);
				}
			}

			if(resolvedRequiredRoles.length > 0) {
				requiredRolesToObtain = [];

				for(const role of resolvedRequiredRoles) {
					requiredRolesToObtain.push(await localizeForUser(msg.member, "COLORS_GETINFO_FIELD_REQUIREDROLES_ITEM", {
						name: escapeDiscordMarkdown(role.roleName),
						status: await localizeForUser(msg.member, role.has ? "COLORS_GETINFO_FIELD_REQUIREDROLES_ITEM_STATUS_YES" : "COLORS_GETINFO_FIELD_REQUIREDROLES_ITEM_STATUS_NO")
					}));
				}
			}
		} else { isAvailable = true; }

		fields.push({
			inline: true,
			name: await localizeForUser(msg.member, "COLORS_GETINFO_FIELD_AVAILABLE"),
			value: isAvailable ? await localizeForUser(msg.member, "COLORS_GETINFO_FIELD_AVAILABLE_YES") : await localizeForUser(msg.member, "COLORS_GETINFO_FIELD_AVAILABLE_NO")
		});

		if(requiredRolesToObtain) {
			fields.push({
				inline: false,
				name: await localizeForUser(msg.member, "COLORS_GETINFO_FIELD_REQUIREDROLES"),
				value: requiredRolesToObtain.join("\n")
			});
		}

		fields.push({
			inline: true,
			name: await localizeForUser(msg.member, "COLORS_GETINFO_FIELD_ROLE"),
			value: await localizeForUser(msg.member, "COLORS_GETINFO_FIELD_ROLE_VALUE", {
				roleName: colorRole.name,
				roleId: colorRole.id
			})
		});

		return msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_GETINFO_DESCRIPTION", {
				thumbUrl: `http://www.colorhexa.com/${colorRole.hexColor.slice(1)}.png`,
				fields
			})
		});
	}

	private async cmd_diag(msg: Message) {
		if(!checkPerms(msg.member)) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_DIAG_NOTPERMISSIONS")
			});
		}

		const colorfulInfo = await this.getInfo(msg.guild);

		if(Object.keys(colorfulInfo.rolePrefixes).length === 0) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_DIAG_NOCOLORS")
			});
		}

		let str = "";
		for(const name in colorfulInfo.rolePrefixes) {
			const colorInfo = colorfulInfo.rolePrefixes[name];
			str += `**${escapeDiscordMarkdown(name)}**\n`;
			if(colorInfo.required_role) {
				if(colorInfo.required_role instanceof Array) {
					str += `  ${await localizeForUser(msg.member, "COLORS_DIAG_REPORT_REQUIRESROLES")}\n`;
					const foundOne = !!colorInfo.required_role.find(roleId => msg.guild.roles.has(roleId));
					let notFoundOne = false;
					str += `    ${await localizeForUser(msg.member, "COLORS_DIAG_REPORT_ROLESSEARCH")}\n`;
					for(const roleId of colorInfo.required_role) {
						const role = msg.guild.roles.get(roleId);
						if(!role) {
							if(!notFoundOne) { notFoundOne = true; }
							str += `      ${await localizeForUser(msg.member, "COLORS_DIAG_REPORT_ROLENOTFOUND", {
								roleId: roleId
							})}\n`;
						} else {
							str += `      ${await localizeForUser(msg.member, "COLORS_DIAG_REPORT_ROLEROW", {
								roleName: role.name,
								roleId: role.id
							})}\n`;
						}
					}
					str += `    ${await localizeForUser(msg.member, foundOne ? "COLORS_DIAG_REPORT_BAD_HEALTH" : notFoundOne ? "COLORS_DIAG_REPORT_MED_HEALTH" : "COLORS_DIAG_REPORT_GOOD_HEALTH")}`;
					str += "\n";
				} else {
					str += `  ${await localizeForUser(msg.member, "COLORS_DIAG_REPORT_REQUIRESROLE", {
						roleId: colorInfo.required_role
					})}\n`;
					const role = msg.guild.roles.get(colorInfo.required_role);
					if(!role) {
						str += `    ${await localizeForUser(msg.member, "COLORS_DIAG_REPORT_REQUIREDROLEDELETED")}`;
					} else {
						str += `    ${await localizeForUser(msg.member, "COLORS_DIAG_REPORT_REQUIREDROLEFOUND", {
							roleName: role.name
						})}`;
					}
					str += "\n";
				}
			}
			str += `  ${await localizeForUser(msg.member, "COLORS_DIAG_REPORT_ROLE", {
				roleId: colorInfo.role
			})}\n`;
			const role = msg.guild.roles.get(colorInfo.role);
			if(!role) {
				str += `    ${await localizeForUser(msg.member, "COLORS_DIAG_REPORT_ROLEDELETED")}`;
			} else {
				str += `    ${await localizeForUser(msg.member, "COLORS_DIAG_REPORT_ROLEFOUND", {
					roleName: role.name
				})}`;
			}
			str += "\n";
		}

		return msg.channel.send(str, {
			split: true
		});
	}

	private async cmd_list(msg: Message) {
		const colorfulInfo = await this.getInfo(msg.guild);

		if(Object.keys(colorfulInfo.rolePrefixes).length === 0) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_LIST_NOCOLORS")
			});
		}

		const ok: string[] = [];
		const unavailable: { due_role: string[] } = { due_role: [] };

		for(const colorName in colorfulInfo.rolePrefixes) {
			const colorInfo = colorfulInfo.rolePrefixes[colorName];
			if(!msg.guild.roles.has(colorInfo.role)) {
				// unavailable.due_deleted.push(colorName);
				continue;
			}
			if(colorInfo.required_role) {
				let isAvailable = false;
				if(colorInfo.required_role instanceof Array) {
					isAvailable = !!colorInfo.required_role.find(roleId => msg.member.roles.has(roleId));
				} else {
					isAvailable = msg.member.roles.has(colorInfo.required_role);
				}

				if(!isAvailable) {
					unavailable.due_role.push(colorName);
					continue;
				}
			}
			// if(colorInfo.required_role && !msg.guild.roles.has(colorInfo.required_role)) {
			// 	unavailable.due_deleted.push(colorName);
			// 	continue;
			// }
			// if(colorInfo.required_role && !msg.member.roles.has(colorInfo.required_role)) {
			// 	unavailable.due_role.push(colorName);
			// 	continue;
			// }
			ok.push(colorName);
		}

		const fields: IEmbedOptionsField[] = [];

		fields.push({
			inline: true,
			name: await localizeForUser(msg.member, "COLORS_LIST_FIELDS_AVAILABLE"),
			value: ok.length === 0 ? await localizeForUser(msg.member, "COLORS_LIST_FIELDS_NOTHINGAVAILABLE") : ok.join("\n")
		});

		if(unavailable.due_role.length > 0) {
			fields.push({
				inline: true,
				name: await localizeForUser(msg.member, "COLORS_LIST_FIELDS_NOROLE"),
				value: unavailable.due_role.join("\n")
			});
		}

		// if(unavailable.due_deleted.length > 0) {
		// 	fields.push({
		// 		inline: true,
		// 		name: "Роль удалена:",
		// 		value: unavailable.due_deleted.join("\n")
		// 	});
		// }

		return msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
				key: "COLORS_LIST_DESCRIPTION",
				formatOptions: {
					prefix: COLORFUL_PREFIX
				}
			}, { fields })
		});
	}

	private async cmd_onjoin(msg: Message, args: string[]) {
		if(!checkPerms(msg.member)) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_NOPERMISSION")
			});
		}

		if(this.whitelistModule && this.whitelistModule.base) {
			const whitelistStatus = await this.whitelistModule.base.isWhitelisted(msg.guild);
			if(!whitelistStatus) {
				return msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ONLYPARTNERED")
				});
			}
		}

		args.shift();

		if(args.length < 1) {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_RANDOM_ARGERR0")
			});
		}

		if(args[0] === "off") {
			if(args.length > 1) {
				return msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_RANDOM_ARGERR1")
				});
			}

			await removePreference(msg.guild, "colors:join");

			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "COLORS_RANDOM_REMOVED")
			});
		} else if(args[0] === "random") {
			if(args.length > 1) {
				return msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_RANDOM_ARGERR3")
				});
			}

			await setPreferenceValue(msg.guild, "colors:join", "random");

			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
					custom: true,
					string: `${await localizeForUser(msg.member, "COLORS_RANDOM_SETRANDOM")}\n\n${await localizeForUser(msg.member, "COLORS_RANDOM_SET_WARN")}`
				})
			});
		} else if(args[0] === "set") {
			if(args.length !== 2) {
				return msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_RANDOM_ARGERR2")
				});
			}

			// second arg = color name

			const colorfulInfo = await this.getInfo(msg.guild);

			const color = colorfulInfo.rolePrefixes[args[1]];
			if(!color) {
				return msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_NOTFOUND")
				});
			}

			if(color.required_role) {
				return msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_RANDOM_REQUIRESROLE")
				});
			}

			await setPreferenceValue(msg.guild, "colors:join", color.role);

			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
					custom: true,
					string: `${await localizeForUser(msg.member, "COLORS_RANDOM_SET")}\n\n${await localizeForUser(msg.member, "COLORS_RANDOM_SET_WARN")}`
				})
			});
		} else {
			return msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_RANDOM_ARGERR0")
			});
		}
	}

	// ===========================================
	// DATABASE FUNCTIONS
	// ===========================================

	/**
	 * Check & Create database
	 */
	public async init() {
		let dbCreated = false;
		try {
			dbCreated = await this.db.schema.hasTable(TABLE_NAME);
		} catch(err) {
			this.log("err", "Can't check table in database.", err);
			$snowball.captureException(err);
		}
		if(!dbCreated) {
			try {
				await this.db.schema.createTable(TABLE_NAME, (tb) => {
					tb.string("guildId", 20).notNullable();
					tb.string("rolePrefixes", 10240).notNullable();
					// JSON<name:String, prefix:String>
				});
				await setPreferenceValue("global", "colors:dbversion", DB_VERSION);
			} catch(err) {
				this.log("err", "Can't create table in database!", err);
				$snowball.captureException(err);
				return;
			}
		} else {
			this.log("ok", "Nice! DB table is already created");
		}
		this.log("info", "Checking if could use whitelist module");

		const whitelistModule = $modLoader.findKeeper<Whitelist>("snowball.core_features.whitelist");
		if(!whitelistModule) {
			this.log("warn", "Whitelist module not found");
		} else {
			this.whitelistModule = whitelistModule;
		}

		let currentDBVersion = await getPreferenceValue("global", "colors:dbversion", true) as number|null;
		if(!currentDBVersion || currentDBVersion < DB_VERSION) {
			this.log("info", "Outdated DB detected. Performing migrations...");

			if(!currentDBVersion) { currentDBVersion = 1; }

			for(let nextVersion = currentDBVersion; nextVersion < DB_VERSION; nextVersion++) {
				const migrationVersion = nextVersion + 1;
				const migrationClass = require(pathJoin(__dirname, "migrations", `migration-${migrationVersion}.js`));
				const migration = new migrationClass() as IColorfulMigration;
				const result = await migration.perform(this.db, TABLE_NAME);
				if(!result) { throw new Error(`Unsuccessful migration - ${currentDBVersion} to ${migrationVersion}`); }
				this.log("ok", `Migration complete to version ${migrationVersion}`);
				await setPreferenceValue("global", "colors:dbversion", migrationVersion);
			}

			currentDBVersion = await getPreferenceValue("global", "colors:dbversion", true) as null|number;
			if(!currentDBVersion) { throw new Error("Version unknown after migrations. Unexpected behavior"); }

			this.log("ok", `Migrations are complete, new version - ${currentDBVersion}`);
		}

		this.log("info", `Current DB version - ${currentDBVersion}, latest DB version - ${DB_VERSION}`);

		this.log("info", "Handling events");
		this.handleEvents();
		this.log("ok", "We're done here, LET'S GO TO WORK!");
	}

	/**
	 * Update guild's colorful info
	 * @param info Colorful information
	 */
	private async updateInfo(info: IColorfulGuildInfo) {
		const inf = info as any;
		inf.rolePrefixes = JSON.stringify(info.rolePrefixes);
		await this.db(TABLE_NAME).where({
			guildId: info.guildId
		}).update(inf);
	}

	/**
	 * Get guild's colorful information
	 */
	private async getInfo(guildId: string | Guild, deep: boolean = false): Promise<IColorfulGuildInfo> {
		if(typeof guildId !== "string") { guildId = guildId.id; }

		const prefixes = await this.db(TABLE_NAME).where({
			guildId
		}).first();
		if(!prefixes) {
			if(deep) { throw new Error("Cannot get colorful info!"); }
			await this.db(TABLE_NAME).insert({
				guildId: guildId,
				rolePrefixes: "{}"
			});
			return this.getInfo(guildId, true);
		}
		prefixes.rolePrefixes = createHashMap<IColorfulGuildColorInfo>(JSON.parse(prefixes.rolePrefixes));
		return prefixes as IColorfulGuildInfo;
	}

	// ===========================================
	// PLUGIN FUNCTIONS
	// ===========================================

	public async unload() {
		this.unhandleEvents();
		return true;
	}
}

module.exports = Colors;
