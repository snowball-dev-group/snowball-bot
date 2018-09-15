import { default as fetch } from "node-fetch";
import { IModule } from "@sb-types/ModuleLoader/Interfaces";
import { MessagesFlows, IMessageFlowContext, IPublicFlowCommand } from "@cogs/cores/messagesFlows";
import { generateLocalizedEmbed, humanizeDurationForUser, extendAndAssign } from "@utils/ez-i18n";
import { getMessageMemberOrAuthor, EmbedType } from "@utils/utils";
import { ErrorMessages } from "@sb-types/Consts";
import { GuildMember, TextChannel } from "discord.js";

const NUMBER_REGEXP = /[0-9]{1,3}/;

export class Slowmode implements IModule {
	public get signature() {
		return "snowball.modtools.slowmode";
	}

	private _unloaded = false;
	private _flowHandler?: IPublicFlowCommand;
	private _i18nUnhandle: () => string[];

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
				"slowmode"
			);

			if (this._unloaded) {
				handler.unhandle();

				return;
			}

			this._flowHandler = handler;
		});
	}

	private async _onMessage(ctx: IMessageFlowContext) {
		const { parsed, message } = ctx;

		const author = await getMessageMemberOrAuthor(message);

		if (!author) { return; }

		if (message.channel.type !== "text") {
			return message.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					author,
					"MODTOOLS_SLOWMODE_CHANNELTYPE"
				)
			});
		}

		if (!(author instanceof GuildMember)) {
			return message.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					author,
					"MODTOOLS_SLOWMODE_PERMSERR@UNKNOWN_MEMBER"
				)
			});
		}

		{
			const permissions = 
				(<TextChannel> message.channel)
					.permissionsFor(author);

			if (!permissions || !permissions.has("MANAGE_CHANNELS", true)) {
				return author.send({
					embed: await generateLocalizedEmbed(
						EmbedType.Error,
						author,
						"MODTOOLS_SLOWMODE_PERMSERR@NO_MANAGE_CHANNEL"
					)
				});
			}
		}

		if (!parsed.subCommand) {
			return message.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Information,
					author, {
						key: "MODTOOLS_SLOWMODE_DEFAULT",
						formatOptions: {
							prefix: ctx.prefix!
						}
					}
				)
			});
		} else if (parsed.arguments) {
			return message.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					author,
					"MODTOOLS_SLOWMODE_ARGSERR@LENGTH"
				)
			});
		}

		const arg = parsed.subCommand;

		if (!NUMBER_REGEXP.test(arg)) {
			return message.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					author,
					"MODTOOLS_SLOWMOdE_ARGSERR@NOTNUMBER"
				)
			});
		}

		const seconds = parseInt(
			arg, 10
		);

		if (isNaN(seconds)) {
			return message.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					author,
					"MODTOOLS_SLOWMODE_ARGSERR@NAN"
				)
			});
		}

		if (seconds > 120) {
			return message.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					author,
					"MODTOOLS_SLOWMODE_ARGSERR@120"
				)
			});
		} else if (seconds < 0) {
			return message.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					author,
					"MODTOOLS_SLOWMODE_ARGSERR@LESSTHAN0"
				)
			});
		}

		const resp = await Slowmode._switch(message.channel.id, seconds);

		const respCode = resp[0];

		if (respCode !== 200) {
			let errStr = "MODTOOLS_SLOWMODE_APIERR@";

			switch (respCode) {
				case 403:
					errStr += "PERMS";
					break;
				case 429:
					errStr += "RATELIMITED";
					break;
				case 500:
					errStr += "API_UNAVAILABLE";
					break;
				default:
					errStr += "UNKNOWN";
					break;
			}

			return message.channel.send({
				embed: await generateLocalizedEmbed(
					EmbedType.Error,
					author,
					errStr
				)
			});
		}

		const interval = resp[1].rate_limit_per_user;

		return message.channel.send({
			embed: await generateLocalizedEmbed(
				EmbedType.OK,
				author, {
					key: `MODTOOLS_SLOWMODE_DONE@${
						interval !== 0 ?
							"ENABLED" :
							"DISABLED"
						}`,
					formatOptions: {
						duration:
							await humanizeDurationForUser(
								author,
								interval,
								"s"
							)
					}
				}
			)
		});
	}

	private static async _switch(channelId: string, rateLimit: number) {
		return fetch(`https://canary.discordapp.com/api/channels/${channelId}`, {
			method: "PATCH",
			body: JSON.stringify({
				rate_limit_per_user: rateLimit
			}),
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bot ${$discordBot.token}`
			}
		}).then(async resp => [
			resp.status,
			await resp.json().catch(() => {
				return { rate_limit_per_user: 0 };
			})
		]);
	}

	public async unload() {
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

export default Slowmode;
