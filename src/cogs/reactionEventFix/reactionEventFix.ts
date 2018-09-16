import { IModule } from "@sb-types/ModuleLoader/Interfaces";
import { ErrorMessages } from "@sb-types/Consts";
import * as djs from "discord.js";
import * as getLogger from "loggy";

const EVENTS = {
	MESSAGE_REACTION_ADD: "messageReactionAdd",
	MESSAGE_REACTION_REMOVE: "messageReactionRemove",
};

export class ReactionEventFix implements IModule {
	public get signature() {
		return "snowball.fixes.reactions";
	}

	private static readonly _log = getLogger("ReactionEventFix");

	constructor() {
		ReactionEventFix._log(
			"info", "This fix is based on the GitHub Gist provided by Lewdcario"
		);

		ReactionEventFix._log(
			"info", "https://gist.github.com/Lewdcario/52e1c66433c994c5c3c272284b9ab29c"
		);
	}

	private _rawListener: (event: any) => Promise<void>;

	public async init() {
		if (!$modLoader.isPendingInitialization(this.signature)) {
			throw new Error(
				ErrorMessages.NOT_PENDING_INITIALIZATION
			);
		}

		$discordBot.on(
			"raw",
			this._rawListener = (event) => this._onRawReaction(event)
		);
	}

	private async _onRawReaction(event) {
		const djsEventName = EVENTS[event.t];

		if (!djsEventName) {
			return;
		}

		const { d: data } = event;

		const user = await $discordBot.users.fetch(data.user_id, true);

		const channel =
			<TChannel> $discordBot.channels.get(data.channel_id) ||
			await user.createDM();

		if (channel.messages.has(data.message_id)) {
			return;
		}

		const message = await channel.messages.fetch(data.message_id);

		const emojiKey = data.emoji.id || data.emoji.name;

		const reaction =
			message.reactions.get(emojiKey) ||
			message.reactions.add(data);

		$discordBot.emit(djsEventName, reaction, user);

		if (message.reactions.size === 1) {
			message.reactions.delete(emojiKey);
		}
	}

	public async unload() {
		if (!$modLoader.isPendingUnload(this.signature)) {
			throw new Error(
				ErrorMessages.NOT_PENDING_UNLOAD
			);
		}

		if (this._rawListener) {
			$discordBot.removeListener(
				"raw",
				this._rawListener
			);
		}

		return true;
	}
}

type TChannel = djs.DMChannel | djs.TextChannel;

export default ReactionEventFix;
