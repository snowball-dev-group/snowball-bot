import { BaseController } from "../SubscriptionBasedController";
import { GuildSettingsDB } from "./GuildSettingsDB";
import { GuildSettingsData, fulfillmentCheck, MatureStreamBehavior } from "./GuildSettingsData";

export class GuildSettingsController extends BaseController<GuildSettingsDB, GuildSettingsData> {
	private readonly _guildId: string;
	
	constructor(guildId: string, parent: GuildSettingsDB) {
		super(parent);

		this._guildId = guildId;

		// tslint:disable-next-line:prefer-object-spread
		this._data = Object.assign(
			this._data, {
				guildId
			}
		);
	}

	public async fetch() {
		const currentData = this._data;

		const availableData = await this._getData();

		if (!availableData) {
			this._markCreated(false);

			return false;
		}

		this._data = {
			...currentData,
			...availableData
		};

		this._markCreated(true);

		return true;
	}

	public async post() {
		const data = this._data;

		if (!fulfillmentCheck(data)) {
			return false;
		}

		const currentData = await this._getData();

		if (currentData) {
			await this._parent.updateSettings(data);
		} else {
			await this._parent.createSettings(data);

			this._markCreated(true);
		}

		return true;
	}

	public fulfillmentCheck() {
		return fulfillmentCheck(
			this._data
		);
	}

	protected async _getData() {
		return this._parent.getSettings(
			this._guildId
		);
	}

	public resolveGuild() {
		const { guildId } = this._data;

		if (!guildId) {
			return undefined;
		}

		return $discordBot.guilds.get(
			guildId
		);
	}

	public getGuildId() {
		return this._data.guildId!;
	}

	public getMatureBehavior() {
		return this._data.matureBehavior;
	}

	public setMatureBehavior(behavior?: MatureStreamBehavior) {
		this._data.matureBehavior = behavior;

		return this;
	}

	public resolveDefaultChannel() {
		const { defaultChannelId } = this._data;

		if (!defaultChannelId) {
			return undefined;
		}

		const guild = this.resolveGuild();

		if (!guild) {
			return undefined;
		}

		return guild.channels.get(defaultChannelId);
	}

	public getDefaultChannelId() {
		return this._data.defaultChannelId;
	}

	public setDefaultChannelId(id: string) {
		if (!id) {
			throw new Error("ID cannot be set to null");
		}

		this._data.defaultChannelId = id;

		return this;
	}
}
