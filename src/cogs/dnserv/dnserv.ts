import { IModule } from "@sb-types/ModuleLoader/Interfaces";
import { Plugin } from "@cogs/plugin";
import { MessageReaction, User } from "discord.js";
import { getMessageMember } from "@utils/utils";
import { ErrorMessages } from "@sb-types/Consts";
import * as getLogger from "loggy";

const STAR = "⭐";

interface IPluginOptions {
	serverId: string;
}

export class DNServReborn extends Plugin implements IModule {
	public get signature() {
		return "snowball.partners.dnserv";
	}

	private readonly _serverId: string;
	private static readonly _log = getLogger("dnSERV Reborn");

	constructor(options: IPluginOptions) {
		super({
			"messageReactionAdd": (reaction, user) => this._removeSelfStar(reaction, user)
		});

		const { serverId } = options;

		if (!serverId) {
			throw new Error("dnSERV server ID is not specified");
		}

		this._serverId = serverId;
	}

	private async _removeSelfStar(reaction: MessageReaction, user: User) {
		DNServReborn._log("info", reaction, user);

		// Remove self-assigned stars

		const { message } = reaction;

		if (
			message.channel.type !== "text" ||
			message.guild.id !== this._serverId ||
			reaction.emoji.name !== STAR
		) {
			return;
		}

		const messageSender = await getMessageMember(message);

		if (!messageSender) {
			return;
		}

		if (messageSender.id === user.id) {
			await reaction.users.remove(messageSender);
		}
	}

	public async unload() {
		if (!$modLoader.isPendingUnload(this.signature)) {
			throw new Error(
				ErrorMessages.NOT_PENDING_UNLOAD
			);
		}

		this.unhandleEvents();

		return true;
	}
}

export default DNServReborn;
