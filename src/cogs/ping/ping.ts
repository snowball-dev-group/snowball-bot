import { IModule } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message } from "discord.js";
import { command } from "../utils/help";
import { getLogger } from "../utils/utils";
import MessagesFlows, { IPublicFlowUnit, IMessageFlowContext } from "../cores/messagesFlows";
import { getUserLanguage } from "../utils/ez-i18n";

const ALLOWED_CMDS = ["ping", "ping_embed"];

@command("UTILITES", "ping", "loc:PING_CMDMETA_DEFAULT_DESCRIPTION")
@command("UTILITES", "ping_embed", "loc:PING_CMDMETA_EMBED_DESCRIPTION")
class Ping extends Plugin implements IModule {
	public get signature() {
		return "snowball.core_features.ping";
	}

	private readonly log = getLogger("PingJS");
	private flowHandler: IPublicFlowUnit;

	constructor() {
		super({}, true);
	}

	public async init() {
		const messagesFlowsKeeper = $snowball.modLoader.findKeeper<MessagesFlows>("snowball.core_features.messageflows");
		if(!messagesFlowsKeeper) { throw new Error("`MessageFlows` not found!"); }

		messagesFlowsKeeper.onInit((flowsMan: MessagesFlows) => {
			return this.flowHandler = flowsMan.watchForMessages((ctx) => this.onMessage(ctx), ALLOWED_CMDS);
		});
	}

	async onMessage(ctx: IMessageFlowContext) {
		if(!ctx.parsed) { return; }
		if(!ALLOWED_CMDS.includes(ctx.parsed.command!)) { return; }

		const userLang = await getUserLanguage(ctx.message.member || ctx.message.member);

		let pongStr = $localizer.getString(userLang, "PING_PONG");

		const isEmbed = ctx.parsed.command === "ping_embed",
		startDate = Date.now(),
		msg = <Message> await ctx.message.channel.send(isEmbed ? { embed: { description: "Pong!" } } : "ℹ Pong!"),
		receivedTime = Date.now(),
		ping = Math.max(0, (msg.createdAt.getTime() - startDate)),
		delay = receivedTime - startDate,
		delayWoPing = delay - ping,
		isNegativeDelay = delayWoPing < 0,
		delayWoPingStr = isNegativeDelay ? `${delayWoPing}` : `+${delayWoPing}`;

		pongStr = $localizer.getFormattedString(userLang, "PING_PONG_DETAILS", {
			ping,
			delay: delayWoPing,
			total: delay,
			isNegativeDelay
		});

		this.log("info", `Ping for sendMessage#embed to Channel#${msg.channel.id}: ${ping}ms (${delayWoPingStr}ms, =${delay}ms)`);

		return msg.edit(isEmbed ? { embed: { description: pongStr } } : pongStr);
	}

	async unload() {
		if(this.flowHandler) {
			this.flowHandler.unhandle();
		}
		this.unhandleEvents();
		return true;
	}
}

module.exports = Ping;
