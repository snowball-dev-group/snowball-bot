import { IModule } from "@sb-types/ModuleLoader/ModuleLoader";
import { Plugin } from "@cogs/plugin";
import { command } from "@utils/help";
import MessagesFlows, { IMessageFlowContext, IPublicFlowCommand } from "../cores/messagesFlows";
import { getUserLanguage } from "@utils/ez-i18n";
import * as getLogger from "loggy";
import { getMessageMemberOrAuthor } from "@utils/utils";

const ALLOWED_CMDS = ["ping", "ping_embed"];

@command("UTILITES", "ping", "loc:PING_CMDMETA_DEFAULT_DESCRIPTION")
@command("UTILITES", "ping_embed", "loc:PING_CMDMETA_EMBED_DESCRIPTION")
class Ping extends Plugin implements IModule {
	public get signature() {
		return "snowball.core_features.ping";
	}

	private static readonly _log = getLogger("PingJS");
	private _flowHandler: IPublicFlowCommand;

	constructor() {
		super({}, true);
	}

	public async init() {
		const messagesFlowsKeeper = $snowball.modLoader.findKeeper<MessagesFlows>("snowball.core_features.messageflows");
		if (!messagesFlowsKeeper) { throw new Error("`MessageFlows` not found!"); }

		messagesFlowsKeeper.onInit((flowsMan: MessagesFlows) => {
			return this._flowHandler = flowsMan.watchForCommands(
				(ctx) => this._onMessage(ctx),
				ALLOWED_CMDS
			);
		});
	}

	private async _onMessage(ctx: IMessageFlowContext) {
		const msg = ctx.message;
		const author = await getMessageMemberOrAuthor(msg);

		if (
			!ctx.parsed ||
			!author ||
			!ALLOWED_CMDS.includes(ctx.parsed.command)
		) {
			return;
		}

		const userLang = await getUserLanguage(author);

		let pongStr = $localizer.getString(userLang, "PING_PONG");

		const isEmbed = ctx.parsed.command === "ping_embed";

		const msgContent = 
			isEmbed ? {
				description: pongStr
			} : pongStr;

		const startDate = Date.now();

		await msg.channel.send(msgContent);

		const ping = Date.now() - startDate;

		pongStr = $localizer.getFormattedString(
			userLang,
			"PING_PONG_DETAILS", {
				ping: ping
			}
		);

		Ping._log("info", `Ping for sendMessage#embed to Channel#${msg.channel.id}: ${ping}ms`);

		return msg.edit(isEmbed ? { embed: { description: pongStr } } : pongStr);
	}

	public async unload() {
		if (this._flowHandler) {
			this._flowHandler.unhandle();
		}

		this.unhandleEvents();

		return true;
	}
}

module.exports = Ping;
