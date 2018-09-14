import MessagesFlows, { IMessageFlowContext, IPublicFlowCommand } from "@cogs/cores/messagesFlows";
import Infractions from "./infractions";
import { generateLocalizedEmbed, localizeForUser } from "@utils/ez-i18n";
import { EmbedType, getMessageMember, resolveGuildMember } from "@utils/utils";
import { GuildMember, TextChannel } from "discord.js";
import { IModule } from "@sb-types/ModuleLoader/Interfaces";
import ModuleBase from "@sb-types/ModuleLoader/ModuleBase";
import { ErrorMessages } from "@sb-types/Consts";

interface IPluginOptions {
	/**
	 * Should plugin allow to create notes on users?
	 * 
	 * If set to `false`, then disallows creation of notes.
	 * By default `true`.
	 */
	allowNotes?: boolean;
}

const INFRACTION_ID_REGEXP = /^[0-9]{1,}$/;
const INFRACTION_PLUGIN_TYPES = ["warn", "note"];
const DEFAULTS_ALLOW_NOTES = true;

export default class InfractionsPlugin implements IModule {
	public get signature() { return "snowball.modtools.infractions.plugin"; }

	private readonly _allowNotes: boolean;
	private _infKeeper: ModuleBase<Infractions>;
	private _flowHandler: IPublicFlowCommand;

	constructor(options: IPluginOptions) {
		if (options) {
			this._allowNotes = Boolean(options.allowNotes);
		} else {
			this._allowNotes = DEFAULTS_ALLOW_NOTES;
		}
	}

	public async init() {
		if (!$modLoader.isPendingInitialization(this.signature)) {
			throw new Error("This module is not pending initialization");
		}

		const infKeeper = $modLoader.findKeeper<Infractions>("snowball.modtools.infractions");

		if (!infKeeper) {
			throw new Error("Infraction Engine Keeper is not found. The plugin can't work alone by itself");
		}

		this._infKeeper = infKeeper;

		const flowsKeeper = $modLoader.findKeeper<MessagesFlows>("snowball.core_features.messageflows");

		if (!flowsKeeper) {
			throw new Error("Messages Flows Keeper not found");
		}

		flowsKeeper.onInit((flowMan) => {
			const handledCommands = [
				"infractions",
				"inf",
				"reason",
				"warn"
			];

			if (this._allowNotes) {
				handledCommands.push("note");
			}

			this._flowHandler =
				flowMan.watchForCommands(
					(ctx) => this.onMessage(ctx),
					handledCommands
				);
		});
	}

	// #region Message handling

	private async onMessage(ctx: IMessageFlowContext) {
		switch (ctx.parsed.command) {
			case "reason": return this.cmdReason(ctx);
			case "infractions": case "inf": {
				// tslint:disable-next-line:no-small-switch
				switch (ctx.parsed.subCommand) {
					case "search": return this.cmdSearch(ctx);
				}
			} break;
			case "warn": case "note": return this.cmdInfCreate(ctx);
		}
	}

	// #region Subcommands

	private async cmdInfCreate(ctx: IMessageFlowContext) {
		const parsed = ctx.parsed;
		const msg = ctx.message;

		const infType = parsed.command.toLowerCase();

		if (!INFRACTION_PLUGIN_TYPES.includes(infType)) {
			return;
		}

		const caller = await getMessageMember(msg);

		if (!caller) { return; }

		if (!InfractionsPlugin._canManageInfractions(caller)) {
			return InfractionsPlugin._missingPermissionsSend(
				<TextChannel> msg.channel, caller
			);
		}

		if (!parsed.subCommand || !parsed.arguments) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Information, caller,
					`INFRACTIONS_CREATE_USAGE@${infType.toUpperCase()}`, {
						universalTitle: await localizeForUser(
							caller,
							`INFRACTIONS_CREATE_USAGE_TITLE@${infType.toUpperCase()}`
						)
					}
				)
			});
		}

		const member = await resolveGuildMember(
			parsed.subCommand,
			msg.guild, {
				strict: false,
				caseStrict: false,
				fetch: false,
				possibleMention: false
			}
		);

		if (!member) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Information,
					caller,
					"INFRACTIONS_CREATE_MEMBERNOTFOUND", {
						universalTitle: await localizeForUser(
							caller, "INFRACTIONS_CREATE_MEMBERNOTFOUND_TITLE"
						)
					}
				)
			});
		}

		const infractions = this._getInfractionModule();

		const inf = infractions.createInfraction(
			msg.guild,
			infType,
			parsed.arguments.original,
			member,
			caller
		);

		await inf.push();

		return msg.channel.send(
			await localizeForUser(
				caller,
				"INFRACTIONS_CREATE_CREATED", {
					id: inf.ID
				}
			)
		);
	}

	private async cmdReason(ctx: IMessageFlowContext) {
		if (!this._infKeeper.base) { return; }

		// > !reason 12345 hello, world!
		const parsed = ctx.parsed;

		if (parsed.command !== "reason") { return; }

		const msg = ctx.message;
		const caller = await getMessageMember(msg);

		if (!caller) { return; }

		if (!InfractionsPlugin._canManageInfractions(caller)) {
			return InfractionsPlugin._missingPermissionsSend(
				<TextChannel> msg.channel, caller
			);
		}

		if (!parsed.subCommand) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Information,
					caller,
					"INFRACTIONS_REASON_USAGE", {
						universalTitle: await localizeForUser(
							caller, "INFRACTIONS_REASON_USAGE_TITLE"
						)
					}
				)
			});
		}

		const infId = InfractionsPlugin._parseInfractionID(parsed.subCommand);

		if (infId === null) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Information,
					caller,
					"INFRACTIONS_REASON_INVALIDID", {
						universalTitle: await localizeForUser(
							caller, "INFRACTIONS_REASON_INVALIDID_TITLE"
						)
					}
				)
			});
		}

		const inf = await (this._getInfractionModule().getInfraction(msg.guild, infId));

		if (!inf) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error, caller, "INFRACTIONS_REASON_NOTFOUND"
				)
			});
		}

		if (!parsed.arguments) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error, caller, "INFRACTIONS_REASON_NOTSPECIFIED"
				)
			});
		}

		await inf.setReason(parsed.arguments.original);

		return msg.channel.send({
			embed: await generateLocalizedEmbed(
				EmbedType.Information, caller, "INFRACTIONS_REASON_DONE"
			)
		});
	}

	private async cmdSearch(ctx: IMessageFlowContext) {
		return ctx;
	}

	private static _canManageInfractions(member: GuildMember) {
		return member.permissions.has([
			"MANAGE_MESSAGES", "MANAGE_ROLES",
			"BAN_MEMBERS", "KICK_MEMBERS"
		]);
	}

	private static async _missingPermissionsSend(channel: TextChannel, member: GuildMember) {
		return channel.send({
			embed: await generateLocalizedEmbed(
				EmbedType.Error,
				member,
				"INFRACTIONS_GENERIC_MISSINGPERMS", {
					universalTitle: await localizeForUser(
						member,
						"INFRACTIONS_GENERIC_MISSINGPERMS_TITLE"
					)
				}
			)
		});
	}

	private static _parseInfractionID(str: string) {
		if (!INFRACTION_ID_REGEXP.test(str)) {
			return null;
		}

		const id = parseInt(str, 10);

		if (isNaN(id)) {
			return null;
		}

		return id;
	}

	private _getInfractionModule() {
		const base = this._infKeeper.base;

		if (!base) {
			throw new Error("Infraction Engine Module is not yet loaded");
		}

		return base;
	}

	// #endregion

	// #endregion

	public async unload() {
		if (!$modLoader.isPendingUnload(this.signature)) {
			throw new Error(ErrorMessages.NOT_PENDING_UNLOAD);
		}

		if (this._flowHandler) {
			this._flowHandler.unhandle();
		}

		return true;
	}
}
