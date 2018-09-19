import MessagesFlows, { IPublicFlowCommand, IMessageFlowContext } from "@cogs/cores/messagesFlows";
import { ErrorMessages } from "@sb-types/Consts";
import { extendAndAssign, generateLocalizedEmbed, localizeForGuild, localizeForUser } from "@utils/ez-i18n";
import { default as fetch } from "node-fetch";
import { GuildMember, Message } from "discord.js";
import { resolveGuildMember, EmbedType, getMessageMember } from "@utils/utils";
import * as getLogger from "loggy";

type Options = Partial<{
	token: string;
	roles: Partial<Roles>
}>;

type Roles = {
	balance: string;
	bravery: string;
	brilliance: string;
};

export class HouseRoles {
	public get signature() {
		return "snowball.partners.dnserv.house_roles";
	}

	private static readonly _log = getLogger("dnSERV Reborn - HouseRole");

	private readonly _userToken: string;
	private readonly _houseRoles: Roles;

	private _unloaded = false;
	private _flowHandler?: IPublicFlowCommand;
	private _i18nUnhandle: () => string[];

	constructor(opts?: Options) {
		if (!opts) {
			throw new Error("No options set");
		}

		const { roles, token } = opts;

		if (!roles) {
			throw new Error("No house roles specified");
		} else {
			for (let i = 0, l = HOUSE_ROLES.length; i < l; i++) {
				const role = HOUSE_ROLES[i];

				if (!roles[role]) {
					throw new Error(`No "${role}" role specified`);
				}
			}
		}

		if (!token) {
			throw new Error("No user token to check house specified");
		}

		this._houseRoles = <any> roles;
		this._userToken = token;
	}

	public async init() {
		if (!$modLoader.isPendingInitialization(this.signature)) {
			throw new Error(ErrorMessages.NOT_PENDING_INITIALIZATION);
		}

		this._i18nUnhandle = await extendAndAssign(
			[__dirname, "i18n"],
			this.signature
		);

		const flowsKeeper = $modLoader.findKeeper<MessagesFlows>(
			"snowball.core_features.messageflows"
		);

		if (!flowsKeeper) {
			throw new Error(
				"Cannot find MessagesFlows Keeper"
			);
		}

		flowsKeeper.onInit((flows) => {
			const handler = flows.watchForCommands(
				(ctx) => this._onMessage(ctx),
				"houserole"
			);

			if (this._unloaded) {
				handler.unhandle();

				return;
			}

			this._flowHandler = handler;
		});
	}

	private async _onMessage(ctx: IMessageFlowContext) {
		// 1. Called without any arguments → self-assign
		// 2. Called with subcommand of "remove" → remove roles
		//  2.1. … and argument of user mention (admin) → … of that user
		// 3. Called with subcommand of "assign"
		//    and user mention (admin) → assign role to user

		const { parsed } = ctx;
		const { arguments: args } = parsed;

		try {
			return await (() => {
				switch (parsed.subCommand) {
					case null:
						return this._selfAssign(ctx);
					case "assign":
						return args ?
							this._assignTo(ctx) :
							this._selfAssign(ctx);
					case "remove":
						return args ?
							this._deassignFrom(ctx) :
							this._selfDeassign(ctx);
					default:
						return this._invalidSubCmd(ctx);
				}
			})();
		} catch (err) {
			HouseRoles._log("err", "Failed to execute command", err);
		}
	}

	// #region UX handling

	/**
	 * Whenever the wrong subcommand called
	 */
	private async _invalidSubCmd(ctx: IMessageFlowContext) {
		const { message: msg } = ctx;

		const sender = await getMessageMember(ctx.message);

		if (!sender) {
			return;
		}

		return msg.channel.send({
			embed: await generateLocalizedEmbed(
				EmbedType.Information,
				sender,
				"DNSERV_HOUSEROLE_UNKNOWN_SUBCMD"
			)
		});
	}

	/**
	 * Assigns House Roles for the member per their request
	 */
	private async _selfAssign(ctx: IMessageFlowContext) {
		const { message: msg } = ctx;

		const sender = await getMessageMember(msg);
		
		if (!sender) { return; }

		let assignResult: AssignResult;

		try {
			assignResult = await this._assign(sender);
		} catch (err) {
			return HouseRoles._onError(
				msg, sender,
				err, "self"
			);
		}

		const currentHouses = assignResult[1];

		return msg.channel.send({
			embed: (
				currentHouses != null ?
					await generateLocalizedEmbed(
						EmbedType.OK,
						sender, {
							key: "DNSERV_HOUSEROLE_ASSIGNED",
							formatOptions: {
								...(
									await HouseRoles._housesArgs(
										currentHouses,
										sender
									)
								),
								caller: "self"
							}
						}
					) :
					await generateLocalizedEmbed(
						EmbedType.Error,
						sender, {
							key: "DNSERV_HOUSEROLE_ERR_NOHOUSE",
							formatOptions: {
								caller: "self"
							}
						}
					)
			)
		});
	}

	/**
	 * Removes House Roles from the member per their request
	 */
	private async _selfDeassign(ctx: IMessageFlowContext) {
		const { message: msg } = ctx;

		const sender = await getMessageMember(msg);

		if (!sender) { return; }

		let deassignResult: DeassignResult;

		try {
			deassignResult = await this._deassign(sender);
		} catch (err) {
			return HouseRoles._onError(
				msg, sender,
				err, "self"
			);
		}

		return msg.channel.send({
			embed: await (
				deassignResult == null ?
					generateLocalizedEmbed(
						EmbedType.Error,
						sender, {
							key: "DNSERV_HOUSEROLE_ERR_NOHOUSE",
							formatOptions: {
								caller: "self"
							}
						}
					) :
					generateLocalizedEmbed(
						EmbedType.OK,
						sender, {
							key: "DNSERV_HOUSEROLE_DEASSIGN",
							formatOptions: {
								...(
									await HouseRoles._housesArgs(
										deassignResult,
										sender
									)
								),
								caller: "self"
							}
						}
					)
			)
		});
	}

	/**
	 * Assigns House Roles for the member per manager request
	 */
	private async _assignTo(ctx: IMessageFlowContext) {
		const { message: msg } = ctx;

		const sender = await getMessageMember(msg);
		
		if (!sender) { return; }

		const { parsed } = ctx;

		const { arguments: args } = parsed;

		const proposal = args ? args[0] : null;

		if (!proposal) {
			return this._selfAssign(ctx);
		}

		const resolvedProposal = await resolveGuildMember(
			proposal.value,
			msg.guild, {
				strict: false,
				caseStrict: false,
				fetch: false,
				possibleMention: true
			}
		);

		if (!resolvedProposal) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					sender,
					"DNSERV_HOUSEROLE_UNKNOWN_PROPOSE"
				)
			});
		}

		if (!canManageHouseRole(sender)) {
			if (resolvedProposal.id !== sender.id) {
				// silently ignore
				return;
			}

			return this._selfAssign(ctx);
		}

		let assignResult: AssignResult;

		try {
			assignResult = await this._assign(resolvedProposal);
		} catch (err) {
			return HouseRoles._onError(
				msg, sender,
				err, "managed"
			);
		}

		const currentHouses = assignResult[1];

		return msg.channel.send({
			embed: await (
				currentHouses != null ?
					generateLocalizedEmbed(
						EmbedType.OK,
						sender, {
							key: "DNSERV_HOUSEROLE_ASSIGNED",
							formatOptions: {
								...(
									await HouseRoles._housesArgs(
										currentHouses,
										sender
									)
								),
								username: resolvedProposal.toString(),
								caller: "managed"
							}
						}
					) :
					generateLocalizedEmbed(
						EmbedType.Error,
						sender, {
							key: "DNSERV_HOUSEROLE_ERR_NOHOUSE",
							formatOptions: {
								username: resolvedProposal.toString(),
								caller: "managed"
							}
						}
					)
			)
		});
	}

	/**
	 * Removes House Roles from the member per manager request
	 */
	private async _deassignFrom(ctx: IMessageFlowContext) {
		const { message: msg } = ctx;

		const sender = await getMessageMember(msg);

		if (!sender) { return; }

		const { parsed } = ctx;

		const { arguments: args } = parsed;

		const proposal = args ? args[0].value : null;

		if (!proposal) {
			return this._selfDeassign(ctx);
		}

		const resolvedProposal = await resolveGuildMember(
			proposal,
			msg.guild, {
				strict: false,
				caseStrict: false,
				fetch: false,
				possibleMention: true
			}
		);

		if (!resolvedProposal) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					sender,
					"DNSERV_HOUSEROLE_UNKNOWN_PROPOSE"
				)
			});
		}

		if (!canManageHouseRole(sender)) {
			if (resolvedProposal.id !== sender.id) {
				// silently ignore
				return;
			}

			return this._selfDeassign(ctx);
		}

		let deassignResult: DeassignResult;

		try {
			deassignResult = await this._deassign(resolvedProposal);
		} catch (err) {
			return HouseRoles._onError(
				msg, sender,
				err, "managed"
			);
		}

		return msg.channel.send({
			embed: await (
				deassignResult == null ?
					generateLocalizedEmbed(
						EmbedType.Error,
						sender, {
							key: "DNSERV_HOUSEROLE_ERR_NOROLES",
							formatOptions: {
								username: resolvedProposal.toString(),
								caller: "managed"
							}
						}
					) : 
					generateLocalizedEmbed(
						EmbedType.OK,
						sender, {
							key: "DNSERV_HOUSEROLE_DEASSIGN",
							formatOptions: {
								...(
									await HouseRoles._housesArgs(
										deassignResult,
										sender
									)
								),
								username: resolvedProposal.toString(),
								caller: "managed"
							}
						}
					)
			)
		});
	}

	private static async _onError(msg: Message, sender: GuildMember, err: Error, caller: "self" | "managed") {
		if (err instanceof HousesFetchError) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					sender, {
						key: "DNSERV_HOUSEROLE_ERR_APIERR",
						formatOptions: {
							caller,
							username: sender.toString()
						}
					}
				)
			});
		}

		return msg.channel.send({
			embed: await generateLocalizedEmbed(
				EmbedType.Error,
				sender,
				"DNSERV_HOUSEROLE_ERR_UNKNOWN"
			)
		});
	}

	// #region UX Helpful Functions

	private static async _housesArgs(houses: House[], sender: GuildMember) {
		const names: string[] = [];
		const rolesCount = houses.length;

		for (let i = 0; i < rolesCount; i++) {
			names.push(
				await HouseRoles._houseName(
					houses[i],
					sender
				)
			);
		}

		return {
			houses: names.join(
				await localizeForUser(
					sender,
					"DNSERV_HOUSEROLE_HOUSE+JOINER"
				)
			),
			rolesCount,
		};
	}

	private static async _houseName(house: House, sender: GuildMember) {
		return localizeForUser(
			sender,
			`DNSERV_HOUSEROLE_HOUSE_${house.toUpperCase()}`
		);
	}

	// #endregion

	// #endregion

	// #region Backend

	// #region Role Manage

	// FIXME: remove useless `changes` and array with it
	/**
	 * Assigns House Roles to the member
	 * 
	 * @returns Array of two elements: 0 — if there were any changes?
	 * 1 — current houses of the member, `null` if none
	 */
	private async _assign(member: GuildMember): Promise<AssignResult> {
		let changes = false;

		// Check member's roles

		const mRoles = this._memberHavesRoles(member);

		// Fetch his roles

		const mHouses = await HouseRoles._checkHouse(
			member.id, this._userToken
		);

		if (mRoles.length === 0 && mHouses.length === 0) {
			return [changes, null];
		}

		const houseRoles = this._houseRoles;

		for (let i = 0, l = HOUSE_ROLES.length; i < l; i++) {
			const house = HOUSE_ROLES[i];

			const hasRole = mRoles.includes(house);
			const inHouse = mHouses.includes(house);

			if (
				hasRole === inHouse
			) {
				continue;
			}

			const houseRole = houseRoles[house];

			if (!hasRole && inHouse) {
				await member.roles.add(
					houseRole,
					await localizeForGuild(
						member.guild,
						"DNSERV_HOUSEROLE_AUDITLOG@ASSIGN"
					)
				);
			} else if (hasRole && !inHouse) {
				await member.roles.remove(
					houseRole,
					await localizeForGuild(
						member.guild,
						"DNSERV_HOUSEROLE_AUDITLOG@DEASSIGN"
					)
				);
			}

			if (!changes) {
				changes = true;
			}
		}

		return [changes, mHouses];
	}

	/**
	 * Removed House Roles from the member
	 * 
	 * @returns Array of Houses whose roles were deleted
	 */
	private async _deassign(member: GuildMember): Promise<DeassignResult> {
		const removedHouses: House[] = [];
		const houses = HOUSE_ROLES;
		const houseRoles = this._houseRoles;

		for (let i = 0, l = houses.length; i < l; i++) {
			const house = houses[i];
			const role = houseRoles[house];

			if (!member.roles.has(role)) {
				continue;
			}

			await member.roles.remove(
				role,
				await localizeForGuild(
					member.guild,
					"DNSERV_HOUSEROLE_AUDITLOG@DEASSIGN"
				)
			);

			removedHouses.push(house);
		}

		return removedHouses.length === 0 ? null : removedHouses;
	}

	private _memberHavesRoles(member: GuildMember) {
		const set: House[] = [];

		const houseRoles = this._houseRoles;

		for (const role in houseRoles) {
			if (member.roles.has(houseRoles[role])) {
				set.push(<House> role);
			}
		}

		return set;
	}

	// #endregion

	private static async _checkHouse(userId: string, token: string) {
		// https://discordapp.com/api/v6/users/${userId}/profile

		const profile = await fetch(
			`https://discordapp.com/api/v6/users/${userId}/profile`, {
				headers: {
					"Authorization": token
				}
			}
		).then((response) => {
			if (response.status !== 200) {
				return Promise.reject(
					new HousesFetchError()
				);
			}

			return response.json();
		});

		const { flags } = profile.user;

		const houses: House[] = [];

		if (hasFlag(flags, DiscordHouse.BALANCE)) {
			houses.push("balance");
		}

		if (hasFlag(flags, DiscordHouse.BRAVERY)) {
			houses.push("bravery");
		}

		if (hasFlag(flags, DiscordHouse.BRILLIANCE)) {
			houses.push("brilliance");
		}

		return houses;
	}

	// #endregion

	public unload() {
		if (!$modLoader.isPendingUnload(this.signature)) {
			throw new Error(ErrorMessages.NOT_PENDING_UNLOAD);
		}

		if (this._flowHandler) {
			this._flowHandler.unhandle();
		}

		if (this._i18nUnhandle) {
			this._i18nUnhandle();
		}

		return true;
	}
}

function canManageHouseRole(member: GuildMember) {
	return member.permissions.has("MANAGE_ROLES");
}

function hasFlag(flags: number, flag: number) {
	return (flags & flag) === flag;
}

type House = keyof Roles;

const HOUSE_ROLES: House[] = [
	"balance",
	"bravery",
	"brilliance"
];

export const enum DiscordHouse {
	BALANCE = 256,
	BRILLIANCE = 128,
	BRAVERY = 64
}

type DeassignResult = House[] | null;
type AssignResult = [boolean, House[] | null];

class HousesFetchError extends Error { }

export default HouseRoles;
