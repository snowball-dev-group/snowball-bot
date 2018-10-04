import { IModule } from "@sb-types/ModuleLoader/Interfaces";
import { Message } from "discord.js";
import { generateLocalizedEmbed } from "@utils/ez-i18n";
import { EmbedType, escapeDiscordMarkdown, getMessageMemberOrAuthor, getUserDisplayName } from "@utils/utils";
import { default as fetch } from "node-fetch";
import { createRedirector } from "@utils/command";
import { ErrorMessages } from "@sb-types/Consts";
import * as MF from "@cogs/cores/messagesFlows";
import * as getLogger from "loggy";

const EMOJI_OK = "👌";
const EMOJI_FAIL = "🚫";

class OwnerCommands implements IModule {
	public get signature() {
		return "snowball.core_features.ownercmds";
	}

	private static _log = getLogger("OwnerCommands");

	private _handler: MF.IPublicFlowCommand;
	private _isUnloaded = false;

	public async init() {
		if (!$modLoader.isPendingInitialization(this.signature)) {
			throw new Error(
				ErrorMessages.NOT_PENDING_INITIALIZATION
			);
		}

		const redirect = createRedirector<MF.IMessageFlowContext>({
			"change_name": (ctx) => OwnerCommands._changeName(ctx),
			"change_avatar": (ctx) => OwnerCommands._changeAvatar(ctx)
		});

		const mfKeeper = $modLoader.findKeeper<MF.MessagesFlows>(
			"snowball.core_features.messageflows"
		);

		if (!mfKeeper) {
			throw new Error("MessagesFlows Keeper not found");
		}

		mfKeeper.onInit((mf) => {
			const handler = mf.watchForCommands(
				redirect,
				["set_avatar", "set_username"]
			);

			if (this._isUnloaded) {
				return handler.unhandle();
			}

			this._handler = handler;
		});
	}

	/**
	 * Checks if message can be used by message sender
	 * @param msg Message to check again
	 */
	private static _canUseCommand(msg: Message) {
		return msg.author && msg.author.id === $botConfig.botOwner;
	}

	/**
	 * Changes the username of the bot
	 * @param ctx Command call context
	 */
	private static async _changeName(ctx: MF.IMessageFlowContext) {
		const { message: msg } = ctx;

		if (!OwnerCommands._canUseCommand(msg)) {
			return;
		}

		const caller = await getMessageMemberOrAuthor(msg);

		if (!caller) { return; }

		const { parsed } = ctx;

		try {
			const oldName = $discordBot.user.tag;

			const newUser = await $discordBot.user.setUsername(
				parsed.content
			);

			OwnerCommands._log("ok", `Changed profile picture from "${oldName}" to "${newUser.tag}" per ${getUserDisplayName(caller, true)}'s request`);

			await OwnerCommands._silentReaction(msg, EMOJI_OK);

			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.OK, caller, {
						key: "OWNERCMDS_CHANGENAME_DONE",
						formatOptions: {
							oldName: escapeDiscordMarkdown(oldName, true),
							newName: escapeDiscordMarkdown(newUser.username, true)
						}
					}
				)
			});
		} catch (err) {
			await OwnerCommands._silentReaction(msg, EMOJI_FAIL);

			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error, caller, {
						key: "OWNERCMDS_CHANGENAME_FAULT",
						formatOptions: {
							errMessage: err.message
						}
					}
				)
			});
		}
	}

	/**
	 * Changes the profile picture of the bot
	 * @param ctx Command call context
	 */
	private static async _changeAvatar(ctx: MF.IMessageFlowContext) {
		const { message: msg } = ctx;

		if (!OwnerCommands._canUseCommand(msg)) {
			return;
		}

		const caller = await getMessageMemberOrAuthor(msg);

		if (!caller) { return; }

		try {
			const attachment = msg.attachments.first();

			if (!attachment) {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(
						EmbedType.Error,
						caller,
						"OWNERCMDS_CHANGEAVY_NOATTACHMENT"
					)
				});
			}

			const resp = await fetch(attachment.url);

			if (resp.status !== 200) {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(
						EmbedType.Progress,
						caller,
						"OWNERCMDS_CHANGEAVY_FAULT_RESPERR"
					)
				});
			}

			try {
				const newUser = await $discordBot.user.setAvatar(
					await resp.buffer()
				);

				OwnerCommands._log("ok", `Changed profile avatar to "${newUser.displayAvatarURL()}" per ${getUserDisplayName(caller, true)}'s request`);

				return msg.channel.send({
					embed: await generateLocalizedEmbed(
						EmbedType.OK,
						caller,
						"OWNERCMDS_CHANGEAVY_DONE", {
							imageUrl: newUser.displayAvatarURL({ format: "png", size: 1024 })
						}
					)
				});
			} catch (err) {
				return msg.channel.send({
					embed: await generateLocalizedEmbed(
						EmbedType.Error,
						caller, {
							key: "OWNERCMDS_CHANGEAVY_FAULT_SETFAILED",
							formatOptions: {
								errMessage: err.message
							}
						}
					)
				});
			}
		} catch (err) {
			await OwnerCommands._silentReaction(msg, EMOJI_FAIL);

			return msg.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					caller, {
						key: "OWNERCMDS_CHANGEAVY_FAULT_REQERROR",
						formatOptions: {
							errMsg: err.message
						}
					}
				)
			});
		}
	}

	/**
	 * Leaves reaction on the message or silently ignores any error
	 * @param msg Message to leave reaction on
	 * @param reaction Reaction to leave
	 */
	private static async _silentReaction(msg: Message, reaction: string) {
		return msg.react(reaction).catch(
			// silently ignore error
			() => Promise.resolve()
		);
	}

	public async unload() {
		if (!$modLoader.isPendingUnload(this.signature)) {
			throw new Error(
				ErrorMessages.NOT_PENDING_UNLOAD
			);
		}

		if (this._handler) {
			this._handler.unhandle();
		} else {
			this._isUnloaded = true;
		}

		return true;
	}
}

module.exports = OwnerCommands;
