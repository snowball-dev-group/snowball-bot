import { IModule } from "./../types/ModuleLoader";
import { Plugin } from "./plugin";
import { Message, Guild, Role, GuildMember } from "discord.js";
import { getLogger, EmbedType, resolveGuildRole, IEmbedOptionsField, escapeDiscordMarkdown } from "./utils/utils";
import { getDB } from "./utils/db";
import { command as cmd, Category } from "./utils/help";
import { createConfirmationMessage } from "./utils/interactive";
import { localizeForUser, generateLocalizedEmbed } from "./utils/ez-i18n";
import { getPreferenceValue, setPreferenceValue, removePreference } from "./utils/guildPrefs";
import { randomPick } from "./utils/random";
import { isVerified } from "./utils/verified";

const TABLE_NAME = "color_prefixes";
const COLORFUL_PREFIX = "!color";
const COLORFUL_HELP_PREFIX = COLORFUL_PREFIX.slice(1);

interface IColorfulGuildColorInfo {
	required_role?: string[] | string;
	role: string;
}

interface IColorfulGuildInfo {
	guildId: string;
	rolePrefixes: Map<string, IColorfulGuildColorInfo>;
}

function checkPerms(member: GuildMember) {
	return member.hasPermission(["MANAGE_ROLES", "MANAGE_GUILD", "MANAGE_ROLES_OR_PERMISSIONS"]);
}

function isChat(msg: Message) {
	return msg.channel.type === "text";
}

@cmd(Category.Colors, COLORFUL_HELP_PREFIX, "loc:COLORS_META_ASSIGN", {
	"loc:COLORS_META_COLORNAME": {
		optional: false,
		description: "loc:COLORS_META_ASSIGN_ARG_DESC"
	}
}, isChat)
@cmd(Category.Colors, `${COLORFUL_HELP_PREFIX} list`, "loc:COLORS_META_LIST", undefined, isChat)
@cmd(Category.Colors, `${COLORFUL_HELP_PREFIX} info`, "loc:COLORS_META_INFO", {
	"loc:COLORS_META_COLORNAME": {
		optional: false,
		description: "loc:COLORS_META_INFO_ARG_DESC"
	}
}, isChat)
@cmd(Category.Colors, `${COLORFUL_HELP_PREFIX} onjoin`, "loc:COLORS_META_ONJOIN", {
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
@cmd(Category.Colors, `${COLORFUL_HELP_PREFIX} reset`, "loc:COLORS_META_RESET", undefined, isChat)
@cmd(Category.Colors, `${COLORFUL_HELP_PREFIX} add`, "loc:COLORS_META_ADD", {
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
@cmd(Category.Colors, `${COLORFUL_HELP_PREFIX} rename`, "loc:COLORS_META_RENAME", {
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
@cmd(Category.Colors, `${COLORFUL_HELP_PREFIX} delete`, "loc:COLORS_META_DELETE", {
	"loc:COLORS_META_COLORNAME": {
		optional: false,
		description: "loc:COLORS_META_DELETE_ARG_DESC"
	}
}, (msg: Message) => {
	return isChat(msg) && checkPerms(msg.member);
})
class Colors extends Plugin implements IModule {
	// ===========================================
	// INITIAL VARIABLES & CONSTRUCTOR
	// ===========================================
	log = getLogger("ColorsJS");
	db = getDB();

	constructor() {
		super({
			"message": (msg) => this.onMessage(msg),
			"guildMemberAdd": (member) => this.onMemberJoin(member)
		}, true);
		// this.init();
	}

	// ===========================================
	// MESSAGE HANDLING
	// ===========================================

	async onMessage(msg: Message) {
		if(msg.channel.type !== "text") { return; }
		if(!msg.content || !msg.content.startsWith(COLORFUL_PREFIX)) { return; }
		let args = msg.content.split(" ");
		if(args.length === 1 && args[0] === COLORFUL_PREFIX) {
			return;
		}
		args.shift();
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
		}
	}

	async onMemberJoin(member:GuildMember) {
		if(!(await isVerified(member))) {
			return;
		}

		let role = await getPreferenceValue(member.guild, "colors:join");
		
		if(typeof role !== "string") { return; }

		let colorfulInfo = await this.getInfo(member.guild);

		let roles = Array.from(colorfulInfo.rolePrefixes.values());

		if(role === "random") {
			// pick random
			roles = roles.filter((r) => !r.required_role);
			if(roles.length === 0) { return; } // no colors to give
			
			let randomColor = randomPick(roles);
			try {
				member.addRole(randomColor.role);
			} catch (err) {
				this.log("err", "Failed to assing random color", err, member.guild.id);
			}
		} else {
			let color = roles.find(r => r.role === role);
			if(!color) { return; } // color was removed prob

			try {
				member.addRole(color.role);
			} catch (err) {
				this.log("err", "Failed to assign color role", err, member.guild.id);
			}
		}
	}

	// ===========================================
	// USER'S FUNCTIONS
	// ===========================================

	async assignColor(msg: Message, args: string[]) {
		// Синий
		let colorName = args.join(" ").trim();

		let colorfulInfo = await this.getInfo(msg.guild);

		let colorInfo = colorfulInfo.rolePrefixes.get(colorName);

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

		let colorRole = msg.guild.roles.get(colorInfo.role);

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

		let _confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, "COLORS_ASSIGN_CONFIRMATION", {
			thumbUrl: `http://www.colorhexa.com/${colorRole.hexColor.slice(1)}.png`
		});

		let confirmation = await createConfirmationMessage(_confirmationEmbed, msg);

		if(!confirmation) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_CANCELED")
			});
			return;
		}

		let toUnassign: Role[] = [] as Role[];
		colorfulInfo.rolePrefixes.forEach(info => {
			let role = msg.member.roles.get(info.role);
			if(role) {
				toUnassign.push(role);
			}
		});

		try {
			await msg.member.removeRoles(toUnassign);
		} catch(err) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_FAILED_UNASSIGN")
			});
			return;
		}

		try {
			await msg.member.addRole(colorInfo.role);
		} catch(err) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_FAILED_ASSIGN")
			});
			return;
		}

		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.Tada, msg.member, "COLORS_ASSIGN_DONE")
		});
	}

	async resetColor(msg: Message) {
		let _confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, "COLORS_RESET_CONFIRMATION");

		let confirmation = await createConfirmationMessage(_confirmationEmbed, msg);

		if(!confirmation) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_CANCELED")
			});
			return;
		}

		let colorfulInfo = await this.getInfo(msg.guild);

		let toUnassign: Role[] = [];
		for(let colorInfo of colorfulInfo.rolePrefixes.values()) {
			let role = msg.member.roles.get(colorInfo.role);
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

		if(colorfulInfo.rolePrefixes.has(args[0])) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ADD_ALREADYEXISTS")
			});
			return;
		}

		let namedArgs = {
			required_role: args.length === 3 ? args[1] : undefined,
			role: args.length === 3 ? args[2] : args[1],
			name: args[0]
		};


		let colorRole = resolveGuildRole(namedArgs.role, msg.guild);
		if(!colorRole) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ADD_ROLENOTFOUND")
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
				let requiredRolesNames = namedArgs.required_role.split("|").map(arg => arg.trim());
				requiredRoles = [];
				for(let nameToResolve of requiredRolesNames) {
					let resolvedRole = resolveGuildRole(nameToResolve, msg.guild);
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

		let _confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
			custom: true,
			string: _confirmationString
		}, {
				thumbUrl: `http://www.colorhexa.com/${colorRole.hexColor.slice(1)}.png`
			});

		let confirmed = await createConfirmationMessage(_confirmationEmbed, msg);

		if(!confirmed) {
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

		if(colorfulInfo.rolePrefixes.has(namedArgs.name)) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_ADD_ALREADYEXISTS")
			});
			return;
		}

		colorfulInfo.rolePrefixes.set(namedArgs.name, {
			required_role: !!requiredRoles ? requiredRoles instanceof Array ? requiredRoles.map(r => r.id) : requiredRoles.id : undefined,
			role: namedArgs.role
		});

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

		let previousColor = colorfulInfo.rolePrefixes.get(args[0]);

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

		if(colorfulInfo.rolePrefixes.has(args[1])) {
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

		// 
		let _confirmationEmbed = await generateLocalizedEmbed(EmbedType.Question, msg.member, {
			key: "COLORS_RENAME_CONFIRMATION",
			formatOptions: {
				before: args[0],
				after: args[1]
			}
		});

		let confirmation = await createConfirmationMessage(_confirmationEmbed, msg);

		if(!confirmation) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_CANCELED")
			});
			return;
		}

		colorfulInfo = await this.getInfo(msg.guild);

		previousColor = colorfulInfo.rolePrefixes.get(args[0]);

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

		if(colorfulInfo.rolePrefixes.has(args[1])) {
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

		colorfulInfo.rolePrefixes.set(args[1], previousColor);

		colorfulInfo.rolePrefixes.delete(args[0]);

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

		let colorName = args.join(" ").trim();

		// Синий
		if(colorName.length === 0) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_DELETE_INFO")
			});
			return;
		}

		let colorfulInfo = await this.getInfo(msg.guild);

		let colorInfo = colorfulInfo.rolePrefixes.get(colorName);

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

		let colorRole = msg.guild.roles.get(colorInfo.role);

		if(!colorRole) {
			colorfulInfo.rolePrefixes.delete(colorName);
			await this.updateInfo(colorfulInfo);
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_DELETE_REMOVEDWITHOUTCONFIRMATION")
			});
			return;
		}

		let confirmed = await createConfirmationMessage(
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

		colorInfo = colorfulInfo.rolePrefixes.get(colorName);

		if(!colorInfo) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_DELETE_ALREADYDELETED")
			});
			return;
		}

		colorfulInfo.rolePrefixes.delete(colorName);

		await this.updateInfo(colorfulInfo);

		msg.channel.send("", {
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, "COLORS_DELETE_DONE")
		});
	}

	async getColorInfo(msg: Message, args: string[]) {
		// info Синий
		args.shift();
		let colorName = (args as string[]).join(" ").trim();

		// Синий
		if(colorName.length === 0) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_GETINFO_INFO")
			});
			return;
		}

		let colorfulInfo = await this.getInfo(msg.guild);

		let colorInfo = colorfulInfo.rolePrefixes.get(colorName);

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

		let colorRole = msg.guild.roles.get(colorInfo.role);
		if(!colorRole) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "COLORS_GETINFO_ROLEREMOVED")
			});
			return;
		}

		let isAvailable = true;

		if(colorInfo.required_role) {
			isAvailable = false;
			if(colorInfo.required_role instanceof Array) {
				isAvailable = !!colorInfo.required_role.find(roleId => msg.member.roles.has(roleId));
			} else {
				isAvailable = msg.member.roles.has(colorInfo.required_role);
			}
		}

		let fields: IEmbedOptionsField[] = [] as IEmbedOptionsField[];

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

		let colorfulInfo = await this.getInfo(msg.guild);

		if(colorfulInfo.rolePrefixes.size === 0) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_DIAG_NOCOLORS")
			});
			return;
		}

		let str = "";
		for(let [name, colorInfo] of colorfulInfo.rolePrefixes) {
			str += `**${escapeDiscordMarkdown(name)}**\n`;
			if(colorInfo.required_role) {
				if(colorInfo.required_role instanceof Array) {
					str += "  " + (await localizeForUser(msg.member, "COLORS_DIAG_REPORT_REQUIRESROLES")) + "\n";
					let foundOne = !!colorInfo.required_role.find(roleId => msg.guild.roles.has(roleId));
					let notFoundOne = false;
					str += "    " + (await localizeForUser(msg.member, "COLORS_DIAG_REPORT_ROLESSEARCH")) + "\n";
					for(let roleId of colorInfo.required_role) {
						let role = msg.guild.roles.get(roleId);
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
					let role = msg.guild.roles.get(colorInfo.required_role);
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
			let role = msg.guild.roles.get(colorInfo.role);
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
		let colorfulInfo = await this.getInfo(msg.guild);

		if(colorfulInfo.rolePrefixes.size === 0) {
			msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "COLORS_LIST_NOCOLORS")
			});
			return;
		}

		let ok: string[] = [],
			unavailable: {
				due_role: string[],
				// due_deleted: WhyReason[]
			} = {
					due_role: [],
					// due_deleted: []
				};

		colorfulInfo.rolePrefixes.forEach((colorInfo, colorName) => {
			if(!msg.guild.roles.has(colorInfo.role)) {
				// unavailable.due_deleted.push(colorName);
				return;
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
					return;
				}
			}
			// if(colorInfo.required_role && !msg.guild.roles.has(colorInfo.required_role)) {
			//	 unavailable.due_deleted.push(colorName);
			//	 return;
			// }
			// if(colorInfo.required_role && !msg.member.roles.has(colorInfo.required_role)) {
			//	 unavailable.due_role.push(colorName);
			//	 return;
			// }
			ok.push(colorName);
		});

		let fields: IEmbedOptionsField[] = [];

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
		//	 fields.push({
		//		 inline: true,
		//		 name: "Роль удалена:",
		//		 value: unavailable.due_deleted.join("\n")
		//	 });
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

		if(moduleWhitelist) {
			let whitelistStatus = await moduleWhitelist.isWhitelisted(msg.guild);
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
			
			let colorfulInfo = await this.getInfo(msg.guild);

			let color = await colorfulInfo.rolePrefixes.get(args[1]);
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
		}
		if(!dbCreated) {
			try {
				await this.db.schema.createTable(TABLE_NAME, (tb) => {
					tb.string("guildId", 20).notNullable();
					tb.string("rolePrefixes", 10240).notNullable();
					// JSON<name:String, prefix:String>
				});
			} catch(err) {
				this.log("err", "Can't create table in database!", err);
				return;
			}
		} else {
			this.log("ok", "Nice! DB table is already created");
		}
		this.log("info", "Handling events");
		this.handleEvents();
		this.log("ok", "We're done here, LET'S GO TO WORK!");
	}

	/**
	 * Update guild's colorful info
	 * @param info Colorful information
	 */
	async updateInfo(info: IColorfulGuildInfo) {
		let inf = info as any;
		inf.rolePrefixes = JSON.stringify([...info.rolePrefixes]);
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
		let prefixes = await this.db(TABLE_NAME).where({
			guildId
		}).first();
		if(!prefixes) {
			if(deep) {
				throw new Error("Cannot get colorful info!");
			}
			let emptyMap = new Map<string, string>();
			await this.db(TABLE_NAME).insert({
				guildId: guildId,
				rolePrefixes: JSON.stringify([...emptyMap])
			});
			return await this.getInfo(guildId, true) as IColorfulGuildInfo;
		}
		prefixes.rolePrefixes = new Map(JSON.parse(prefixes.rolePrefixes)) as Map<string, IColorfulGuildColorInfo>;
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