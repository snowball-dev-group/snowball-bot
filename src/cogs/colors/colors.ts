import { IModule, ModuleBase } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message, Guild, Role, GuildMember } from "discord.js";
import { getLogger, EmbedType, resolveGuildRole, IEmbedOptionsField, escapeDiscordMarkdown } from "../utils/utils";
import { getDB } from "../utils/db";
import { command as cmd } from "../utils/help";
import { createConfirmationMessage } from "../utils/interactive";
import { localizeForUser, generateLocalizedEmbed } from "../utils/ez-i18n";
import { getPreferenceValue, setPreferenceValue, removePreference } from "../utils/guildPrefs";
import { randomPick } from "../utils/random";
import { isVerified, isInitDone as isVerifiedEnabled } from "../utils/verified";
import { messageToExtra } from "../utils/failToDetail";
import { Whitelist } from "../whitelist/whitelist";
import * as knex from "knex";
import { join as pathJoin } from "path";
import { IHashMap, createHashMap } from "../../types/Types";

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

function checkPerms(member: GuildMember) {
	return member.permissions.has(["MANAGE_ROLES", "MANAGE_GUILD"]);
}

function isChat(msg: Message) {
	return msg.channel.type === "text";
}

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
}, (msg: Message) => {
	return isChat(msg) && checkPerms(msg.member);
})
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
}, (msg: Message) => {
	return isChat(msg) && checkPerms(msg.member);
})
@cmd(HELP_CATEGORY, `${COLORFUL_HELP_PREFIX} rename`, "loc:COLORS_META_RENAME", {
	"loc:COLORS_META_RENAME_ARG0": {
		optional: false,
		description: "loc:COLORS_META_RENAME_ARG0_DESC"
	},
	"loc:COLORS_META_RENAME_ARG1": {
		optional: false,
		description: "loc:COLORS_META_RENAME_ARG1_DESC"
	}
}, (msg: Message) => {
	return isChat(msg) && checkPerms(msg.member);
})
@cmd(HELP_CATEGORY, `${COLORFUL_HELP_PREFIX} delete`, "loc:COLORS_META_DELETE", {
	"loc:COLORS_META_COLORNAME": {
		optional: false,
		description: "loc:COLORS_META_DELETE_ARG_DESC"
	}
}, (msg: Message) => {
	return isChat(msg) && checkPerms(msg.member);
})
class Colors extends Plugin implements IModule {
	public get signature () {
		return "snowball.features.colors";
	}

	// ===========================================
	// INITIAL VARIABLES & CONSTRUCTOR
	// ===========================================
	log = getLogger("ColorsJS");
	db = getDB();
	whitelistModule:ModuleBase<Whitelist>|null = null;

	constructor() {
		super({
			"message": (msg) => this.onMessage(msg),
			"guildMemberAdd": (member) => this.onMemberJoin(member)
		}, true);
	}

	// ===========================================
	// MESSAGE HANDLING
	// ===========================================

	async onMessage(msg: Message) {
		if(msg.channel.type !== "text") { return; }
		if(!msg.content || !msg.content.startsWith(COLORFUL_PREFIX)) { return; }
		
		const args = msg.content.split(" ");

		if(args.length === 1 && args[0] === COLORFUL_PREFIX) {
			return;
		}
		args.shift(); // skip prefix

		try {
			switch(args[0]) {
				// add Синий, color_blue
				case "add": return await this.addColor(msg, args);
				// delete Синий
				case "delete": return await this.deleteColor(msg, args);
				// info Синий
				case "info": return await this.getColorInfo(msg, args);
				// list 5
				case "list": return await this.getColorsList(msg);
				// reset
				case "reset": return await this.resetColor(msg);
				// rename Синий, blue
				case "rename": return await this.renameColor(msg, args);
				case "onjoin": return await this.randomColorSetting(msg, args);
				// diag
				case "diag": return await this.performDiag(msg);
				// Синий
				default: return await this.assignColor(msg, args);
			}
		} catch(err) {
			this.log("err", "Error due running command `", msg.content + "`:", err);
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_RUNNINGFAILED")
			});
			$snowball.captureException(err, { extra: messageToExtra(msg) });
		}
	}

	async onMemberJoin(member:GuildMember) {
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
				member.addRole(randomColor.role);
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
				member.addRole(color.role);
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

	async assignColor(msg: Message, args: string[]) {
		// Синий
		const colorName = args.join(" ").trim();

		const colorfulInfo = await this.getInfo(msg.guild);

		const colorInfo = colorfulInfo.rolePrefixes[colorName];

		if(!colorInfo) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_NOTFOUND")
			});
			return;
		}

		if(colorInfo.required_role) {
			let canApply = false;
			if(colorInfo.required_role instanceof Array) {
				canApply = !!colorInfo.required_role.find(roleId => msg.member.roles.has(roleId));
				if(!canApply) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_NOREQUIREDROLES")
					});
					return;
				}
			} else {
				canApply = msg.member.roles.has(colorInfo.required_role);
				if(!canApply) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_NOREQUIREDROLE")
					});
					return;
				}
			}
		}

		const colorRole = msg.guild.roles.get(colorInfo.role);

		if(!colorRole) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ROLENOTFOUND")
			});
			return;
		}

		if(msg.member.roles.has(colorInfo.role)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ALREADYSET")
			});
			return;
		}

		const _confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, "COLORS_ASSIGN_CONFIRMATION", {
			thumbUrl: `http://www.colorhexa.com/${colorRole.hexColor.slice(1)}.png`
		});

		const confirmation = await createConfirmationMessage(_confirmationEmbed, msg);

		if(!confirmation) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_CANCELED")
			});
			return;
		}

		const toUnassign: Role[] = [] as Role[];
		for(const info of Object.values(colorfulInfo.rolePrefixes)) {
			const role = msg.member.roles.get(info.role);
			if(role) { toUnassign.push(role); }
		}

		if(toUnassign.length > 0) {
			try {
				await msg.member.removeRoles(toUnassign);
			} catch(err) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_FAILED_UNASSIGN")
				});
				$snowball.captureException(err, {
					extra: messageToExtra(msg, { toUnassign })
				});
				return;
			}
		}

		try {
			await msg.member.addRole(colorInfo.role);
		} catch(err) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_FAILED_ASSIGN")
			});
			$snowball.captureException(err, {
				extra: messageToExtra(msg, { roleId: colorInfo.role })
			});
			return;
		}

		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Tada, msg.member, "COLORS_ASSIGN_DONE")
		});
	}

	async resetColor(msg: Message) {
		const _confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, "COLORS_RESET_CONFIRMATION");

		const confirmation = await createConfirmationMessage(_confirmationEmbed, msg);

		if(!confirmation) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_CANCELED")
			});
			return;
		}

		const colorfulInfo = await this.getInfo(msg.guild);

		const toUnassign: Role[] = [];
		for(const colorInfo of Object.values(colorfulInfo.rolePrefixes)) {
			const role = msg.member.roles.get(colorInfo.role);
			if(role) { toUnassign.push(role); }
		}

		try {
			await msg.member.removeRoles(toUnassign);
		} catch(err) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_RESET_FAILED")
			});
			return;
		}

		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Tada, msg.member, "COLORS_RESET_DONE")
		});
	}

	async addColor(msg: Message, args: string[]) {
		if(!checkPerms(msg.member)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_NOPERMISSION")
			});
			return;
		}

		if(!msg.guild.me.permissions.has("MANAGE_ROLES")) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_INVALIDBOTPERMS")
			});
			return;
		}

		// ["add", "Синий,", "color_blue"]
		args.shift();
		// [ "Синий,", " color_blue"] -> "Синий, color_blue" -> ["Синий", " color_blue"] -> ["Синий", "color_blue"]
		args = args.join(" ").split(",").map(arg => arg.trim());
		if(args.length !== 2 && args.length !== 3) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_ADD_ARGSERR")
			});
			return;
		}

		let colorfulInfo = await this.getInfo(msg.guild);

		if(["list", "info", "reset", "add", "rename", "delete"].includes(args[0].toLowerCase())) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ADD_NAMERESERVED")
			});
			return;
		}

		if(!!colorfulInfo.rolePrefixes[args[0]]) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ADD_ALREADYEXISTS")
			});
			return;
		}

		const namedArgs = {
			required_role: args.length === 3 ? args[1] : undefined,
			role: args.length === 3 ? args[2] : args[1],
			name: args[0]
		};

		const colorRole = resolveGuildRole(namedArgs.role, msg.guild);
		if(!colorRole) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ADD_ROLENOTFOUND")
			});
			return;
		}

		if(colorRole.position > msg.guild.me.highestRole.position) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ADD_INVALIDROLEPOSITION")
			});
			return;
		}

		let requiredRoles: Role[] | Role | undefined = undefined;
		if(namedArgs.required_role) {
			if(namedArgs.required_role.indexOf("|") === -1) {
				requiredRoles = resolveGuildRole(namedArgs.required_role, msg.guild);
				if(!requiredRoles) {
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ADD_REQUIREDROLENOTFOUND")
					});
					return;
				}
			} else {
				const requiredRolesNames = namedArgs.required_role.split("|").map(arg => arg.trim());
				requiredRoles = [];
				for(const nameToResolve of requiredRolesNames) {
					const resolvedRole = resolveGuildRole(nameToResolve, msg.guild);
					if(!resolvedRole) {
						msg.channel.send("", {
							embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
								key: "COLORS_ADD_REQUIREDROLENOTFOUND2",
								formatOptions: {
									rolename: nameToResolve
								}
							})
						});
						return;
					}
					if(requiredRoles && requiredRoles instanceof Array) {
						requiredRoles.push(resolvedRole);
					}
				}
			}
		}

		// Вы собираетесь добавить цвет {colorName}, роль которого - `{colorRoleName}` ({colorHEX}, цвет показан справа)

		let _confirmationString = (await localizeForUser(msg.member, "COLORS_ADD_CONFIRMATION", {
			colorName: namedArgs.name,
			colorRoleName: colorRole.name,
			colorHEX: colorRole.hexColor.toUpperCase()
		})) + ".\n";

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

		_confirmationString += "\n\n" + (await localizeForUser(msg.member, "COLORS_ADD_CONFIRMATION_RIGHTSWARNING"));

		const _confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
			custom: true,
			string: _confirmationString
		}, {
				thumbUrl: `http://www.colorhexa.com/${colorRole.hexColor.slice(1)}.png`
			});

		const confirmation = await createConfirmationMessage(_confirmationEmbed, msg);

		if(!confirmation) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_CANCELED")
			});
			return;
		}

		// namedArgs.required_role = JSON.stringify(requiredRoles);
		namedArgs.role = colorRole.id;

		try {
			await colorRole.edit({
				permissions: [],
				hoist: colorRole.hoist,
				color: colorRole.color,
				mentionable: false
			});
		} catch(err) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ADD_ROLEFIX_FAILED")
			});
			return;
		}

		// re-request colorful info, because it can be changed
		colorfulInfo = await this.getInfo(msg.guild);

		if(!!colorfulInfo.rolePrefixes[namedArgs.name]) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ADD_ALREADYEXISTS")
			});
			return;
		}

		colorfulInfo.rolePrefixes[namedArgs.name] = {
			required_role: !!requiredRoles ? requiredRoles instanceof Array ? requiredRoles.map(r => r.id) : requiredRoles.id : undefined,
			role: namedArgs.role
		};

		await this.updateInfo(colorfulInfo);

		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Tada, msg.member, "COLORS_ADD_DONE")
		});
	}

	async renameColor(msg: Message, args: string[]) {
		if(!checkPerms(msg.member)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_NOPERMISSION")
			});
			return;
		}

		// rename Синий, blue
		args.shift();

		// Синий, blue
		args = args.join(" ").split(",").map(arg => arg.trim());

		// ["Синий", "blue"]
		if(args.length !== 2) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_RENAME_ARGSERR")
			});
			return;
		}

		let colorfulInfo = await this.getInfo(msg.guild);

		let previousColor = colorfulInfo.rolePrefixes[args[0]];

		if(!previousColor) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
					key: "COLORS_COLORNOTFOUND",
					formatOptions: {
						colorName: escapeDiscordMarkdown(args[0])
					}
				})
			});
			return;
		}

		if(colorfulInfo.rolePrefixes[args[1]]) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
					key: "COLORS_RENAME_ALREADYEXISTS",
					formatOptions: {
						colorName: args[1]
					}
				})
			});
			return;
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
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_CANCELED")
			});
			return;
		}

		colorfulInfo = await this.getInfo(msg.guild);

		previousColor = colorfulInfo.rolePrefixes[args[0]];

		if(!previousColor) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
					key: "COLORS_RENAME_CONFIRMATIONWAITREMOVED",
					formatOptions: {
						colorName: escapeDiscordMarkdown(args[0])
					}
				})
			});
			return;
		}

		if(!!colorfulInfo.rolePrefixes[args[1]]) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
					key: "COLORS_RENAME_CONFIRMATIONWAITBINDED",
					formatOptions: {
						colorName: args[1]
					}
				})
			});
			return;
		}

		colorfulInfo.rolePrefixes[args[1]] = previousColor;

		delete colorfulInfo.rolePrefixes[args[0]];

		await this.updateInfo(colorfulInfo);

		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "COLORS_RENAME_DONE")
		});
	}

	async deleteColor(msg: Message, args: string[]) {
		if(!checkPerms(msg.member)) {
			return;
		}

		// delete Синий
		args.shift();

		const colorName = args.join(" ").trim();

		// Синий
		if(colorName.length === 0) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_DELETE_INFO")
			});
			return;
		}

		let colorfulInfo = await this.getInfo(msg.guild);

		let colorInfo = colorfulInfo.rolePrefixes[colorName];

		if(!colorInfo) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
					key: "COLORS_COLORNOTFOUND",
					formatOptions: {
						colorName
					}
				})
			});
			return;
		}

		const colorRole = msg.guild.roles.get(colorInfo.role);

		if(!colorRole) {
			delete colorfulInfo.rolePrefixes[colorName];
			await this.updateInfo(colorfulInfo);
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_DELETE_REMOVEDWITHOUTCONFIRMATION")
			});
			return;
		}

		const confirmed = await createConfirmationMessage(
			await generateLocalizedEmbed(EmbedType.Question, msg.member, "COLORS_DELETE_CONFIRMATION", {
				thumbUrl: `http://www.colorhexa.com/${colorRole.hexColor.slice(1)}.png`
			}),
			msg
		);

		if(!confirmed) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_CANCELED")
			});
			return;
		}

		// because it can be updated due confirmation
		colorfulInfo = await this.getInfo(msg.guild);

		colorInfo = colorfulInfo.rolePrefixes[colorName];

		if(!colorInfo) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_DELETE_ALREADYDELETED")
			});
			return;
		}

		delete colorfulInfo.rolePrefixes[colorName];

		await this.updateInfo(colorfulInfo);

		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "COLORS_DELETE_DONE")
		});
	}

	async getColorInfo(msg: Message, args: string[]) {
		// info Синий
		args.shift();
		const colorName = (args as string[]).join(" ").trim();

		// Синий
		if(colorName.length === 0) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_GETINFO_INFO")
			});
			return;
		}

		const colorfulInfo = await this.getInfo(msg.guild);

		const colorInfo = colorfulInfo.rolePrefixes[colorName];

		if(!colorInfo) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
					key: "COLORS_GETINFO_NOTFOUND",
					formatOptions: {
						prefix: COLORFUL_PREFIX
					}
				})
			});
			return;
		}

		const colorRole = msg.guild.roles.get(colorInfo.role);
		if(!colorRole) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_GETINFO_ROLEREMOVED")
			});
			return;
		}

		let isAvailable = true;
		const requiredRoles:string[] = [];

		if(colorInfo.required_role) {
			isAvailable = false;
			if(colorInfo.required_role instanceof Array) {
				isAvailable = !!colorInfo.required_role.find(roleId => {
					const hasRole = msg.member.roles.has(roleId);
					if(!hasRole) { requiredRoles.push(roleId); }
					return hasRole;
				});
			} else {
				isAvailable = msg.member.roles.has(colorInfo.required_role);
				if(!isAvailable) { requiredRoles.push(colorInfo.required_role); }
			}
		}

		const fields: IEmbedOptionsField[] = [] as IEmbedOptionsField[];

		fields.push({
			inline: true,
			name: await localizeForUser(msg.member, "COLORS_GETINFO_FIELD_AVAILABLE"),
			value: isAvailable ? await localizeForUser(msg.member, "COLORS_GETINFO_FIELD_AVAILABLE_YES") : await localizeForUser(msg.member, "COLORS_GETINFO_FIELD_AVAILABLE_NO")
		});

		fields.push({
			inline: true,
			name: await localizeForUser(msg.member, "COLORS_GETINFO_FIELD_ROLE"),
			value: await localizeForUser(msg.member, "COLORS_GETINFO_FIELD_ROLE_VALUE", {
				roleName: colorRole.name,
				roleId: colorRole.id
			})
		});

		if(colorInfo.required_role && !isAvailable && requiredRoles.length > 0) {
			// constucting "good" array of names
			const requiredRolesToObtain = (() => {
				const arr: string[] = [];
				for(const requiredRoleId of requiredRoles) {
					const role = msg.guild.roles.get(requiredRoleId);
					if(role) { arr.push(role.name); }
				}
				arr.map(roleName => `- ${roleName}`);
				return arr;
			})();

			fields.push({
				inline: false,
				name: await localizeForUser(msg.member, "COLORS_GETINFO_FIELD_REQUIREDROLES"),
				value: requiredRolesToObtain.join("\n")
			});
		}

		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_GETINFO_DESCRIPTION", {
				thumbUrl: `http://www.colorhexa.com/${colorRole.hexColor.slice(1)}.png`,
				fields
			})
		});
	}

	async performDiag(msg: Message) {
		if(!checkPerms(msg.member)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_DIAG_NOTPERMISSIONS")
			});
			return;
		}

		const colorfulInfo = await this.getInfo(msg.guild);

		if(Object.keys(colorfulInfo.rolePrefixes).length === 0) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_DIAG_NOCOLORS")
			});
			return;
		}

		let str = "";
		for(const name in colorfulInfo.rolePrefixes) {
			const colorInfo = colorfulInfo.rolePrefixes[name];
			str += `**${escapeDiscordMarkdown(name)}**\n`;
			if(colorInfo.required_role) {
				if(colorInfo.required_role instanceof Array) {
					str += "  " + (await localizeForUser(msg.member, "COLORS_DIAG_REPORT_REQUIRESROLES")) + "\n";
					const foundOne = !!colorInfo.required_role.find(roleId => msg.guild.roles.has(roleId));
					let notFoundOne = false;
					str += "    " + (await localizeForUser(msg.member, "COLORS_DIAG_REPORT_ROLESSEARCH")) + "\n";
					for(const roleId of colorInfo.required_role) {
						const role = msg.guild.roles.get(roleId);
						if(!role) {
							if(!notFoundOne) { notFoundOne = true; }
							str += "      " + (await localizeForUser(msg.member, "COLORS_DIAG_REPORT_ROLENOTFOUND", {
								roleId: roleId
							}));
						} else {
							str += "      " + (await localizeForUser(msg.member, "COLORS_DIAG_REPORT_ROLEROW", {
								roleName: role.name,
								roleId: role.id
							})) + "\n";
						}
					}
					if(!foundOne) {
						str += "    " + (await localizeForUser(msg.member, "COLORS_DIAG_REPORT_BAD_HEALTH"));
					} else if(notFoundOne) {
						str += "    " + (await localizeForUser(msg.member, "COLORS_DIAG_REPORT_MED_HEALTH"));
					} else {
						str += "    " + (await localizeForUser(msg.member, "COLORS_DIAG_REPORT_GOOD_HEALTH"));
					}
					str += "\n";
				} else {
					str += "  " + (await localizeForUser(msg.member, "COLORS_DIAG_REPORT_REQUIRESROLE", {
						roleId: colorInfo.required_role
					})) + "\n";
					const role = msg.guild.roles.get(colorInfo.required_role);
					if(!role) {
						str += "    " + (await localizeForUser(msg.member, "COLORS_DIAG_REPORT_REQUIREDROLEDELETED"));
					} else {
						str += "    " + (await localizeForUser(msg.member, "COLORS_DIAG_REPORT_REQUIREDROLEFOUND", {
							roleName: role.name
						}));
					}
					str += "\n";
				}
			}
			str += "  " + (await localizeForUser(msg.member, "COLORS_DIAG_REPORT_ROLE", {
				roleId: colorInfo.role
			})) + "\n";
			const role = msg.guild.roles.get(colorInfo.role);
			if(!role) {
				str += "    " + (await localizeForUser(msg.member, "COLORS_DIAG_REPORT_ROLEDELETED"));
			} else {
				str += "    " + (await localizeForUser(msg.member, "COLORS_DIAG_REPORT_ROLEFOUND", {
					roleName: role.name
				}));
			}
			str += "\n";
		}

		msg.channel.send(str, {
			split: true
		});
	}

	async getColorsList(msg: Message) {
		const colorfulInfo = await this.getInfo(msg.guild);

		if(Object.keys(colorfulInfo.rolePrefixes).length === 0) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_LIST_NOCOLORS")
			});
			return;
		}

		const ok: string[] = [],
			unavailable: {
				due_role: string[],
				// due_deleted: WhyReason[]
			} = {
					due_role: [],
					// due_deleted: []
				};

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
			// 	return;
			// }
			// if(colorInfo.required_role && !msg.member.roles.has(colorInfo.required_role)) {
			// 	unavailable.due_role.push(colorName);
			// 	return;
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

		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
				key: "COLORS_LIST_DESCRIPTION",
				formatOptions: {
					prefix: COLORFUL_PREFIX
				}
			}, {
					fields
				})
		});
	}

	async randomColorSetting(msg: Message, args: string[]) {
		if(!checkPerms(msg.member)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_NOPERMISSION")
			});
			return;
		}

		if(this.whitelistModule && this.whitelistModule.base) {
			const whitelistStatus = await this.whitelistModule.base.isWhitelisted(msg.guild);
			if(whitelistStatus.state !== 0 && whitelistStatus.state === 1) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ONLYPARTNERED")
				});
				return;
			}
		}

		args.shift();

		if(args.length < 1) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_RANDOM_ARGERR0")
			});
			return;
		}

		if(args[0] === "off") {
			if(args.length > 1) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_RANDOM_ARGERR1")
				});
				return;
			}

			await removePreference(msg.guild, "colors:join");

			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "COLORS_RANDOM_REMOVED")
			});
		} else if(args[0] === "random") {
			if(args.length > 1) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_RANDOM_ARGERR3")
				});
				return;
			}

			await setPreferenceValue(msg.guild, "colors:join", "random");

			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
					custom: true,
					string: (await localizeForUser(msg.member, "COLORS_RANDOM_SETRANDOM")) + "\n\n" + (await localizeForUser(msg.member, "COLORS_RANDOM_SET_WARN"))
				})
			});
		} else if(args[0] === "set") {
			if(args.length !== 2) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_RANDOM_ARGERR2")
				});
				return;
			}

			// second arg = color name

			const colorfulInfo = await this.getInfo(msg.guild);

			const color = colorfulInfo.rolePrefixes[args[1]];
			if(!color) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_NOTFOUND")
				});
				return;
			}

			if(color.required_role) {
				msg.channel.send("", {
					embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_RANDOM_REQUIRESROLE")
				});
				return;
			}

			await setPreferenceValue(msg.guild, "colors:join", color.role);

			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
					custom: true,
					string: await localizeForUser(msg.member, "COLORS_RANDOM_SET") + "\n\n" + (await localizeForUser(msg.member, "COLORS_RANDOM_SET_WARN"))
				})
			});
		} else {
			msg.channel.send("", {
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
	async init() {
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
		
		const whitelistModule = $modLoader.signaturesRegistry["snowball.core_features.whitelist"];
		if(!whitelistModule) {
			this.log("warn", "Whitelist module not found");
		} else {
			this.whitelistModule = whitelistModule as ModuleBase<Whitelist>;
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
	async updateInfo(info: IColorfulGuildInfo) {
		const inf = info as any;
		inf.rolePrefixes = JSON.stringify(info.rolePrefixes);
		await this.db(TABLE_NAME).where({
			guildId: info.guildId
		}).update(inf);
	}

	/**
	 * Get guild's colorful information
	 * @param guildId
	 */
	async getInfo(guildId: string | Guild, deep: boolean = false): Promise<IColorfulGuildInfo> {
		if(typeof guildId !== "string") {
			guildId = guildId.id;
		}
		const prefixes = await this.db(TABLE_NAME).where({
			guildId
		}).first();
		if(!prefixes) {
			if(deep) { throw new Error("Cannot get colorful info!"); }
			await this.db(TABLE_NAME).insert({
				guildId: guildId,
				rolePrefixes: "{}"
			});
			return await this.getInfo(guildId, true) as IColorfulGuildInfo;
		}
		prefixes.rolePrefixes = createHashMap<IColorfulGuildColorInfo>(JSON.parse(prefixes.rolePrefixes));
		return prefixes as IColorfulGuildInfo;
	}

	// ===========================================
	// PLUGIN FUNCTIONS
	// ===========================================

	async unload() {
		this.unhandleEvents();
		return true;
	}
}

module.exports = Colors;
