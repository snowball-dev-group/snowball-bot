import BaseDBManager from "@cogs/streamNotifications/db/BaseDBManager";
import { SharedSubscriptionData, addSharedSubscriptionColumns } from "@cogs/streamNotifications/db/Subscriptions/SubscriptionData";
import { NotificationsSettingsData, addNotificationSettingsColumns } from "@cogs/streamNotifications/db/Settings/NotificationsSettingsData";
import * as db from "@utils/db";

//  Settings

//   Settings modifications
//    - [x] createSettings
//    - [x] updateSettings
//    - [x] deleteSettings

//   Searching settings:
//    - [x] getSettings

const INIT_MAP = new WeakMap<NotificationsSettingsDB, boolean>();

export class NotificationsSettingsDB {
	private readonly _tableName: string;
	private readonly _db = db.getDB();

	constructor(tableName: string) {
		if (!tableName) {
			throw new Error("No table name specified");
		}

		this._tableName = tableName;
	}

	/**
	 * Initializes and checks the database
	 */
	public async init() {
		await BaseDBManager.createTableIfNotExists(
			this._tableName,
			(tb) => {
				addSharedSubscriptionColumns(tb);
				addNotificationSettingsColumns(tb);
			}
		);

		INIT_MAP.set(this, true);
	}

	/**
	 * Inserts settings into the database
	 * @param data Settings
	 */
	public async createSettings(data: NotificationsSettingsData) : Promise<void> {
		NotificationsSettingsDB._checkInitDone(this);

		return this._db(this._tableName)
			.insert(data);
	}

	/**
	 * Finds the settings for guild
	 * @param guildId Guild ID of settings
	 * @param platform Platform signature
	 * @param streamerId Streamer ID
	 */
	public async getSettings(subscription: SharedSubscriptionData) : OptionalSettings {
		NotificationsSettingsDB._checkInitDone(this);

		const {
			guildId,
			platform,
			streamerId
		} = subscription;

		return this._db(this._tableName)
			.where({
				guildId,
				platform,
				streamerId
			})
			.first();
	}

	/**
	 * Updates settings for guild
	 * @param settings New settings
	 */
	public async updateSettings(settings: NotificationsSettingsData) {
		NotificationsSettingsDB._checkInitDone(this);

		return this._db(this._tableName)
			.where(
				NotificationsSettingsDB._getSelect(
					settings
				)
			)
			.update(settings);
	}

	/**
	 * Deletes settings from the table
	 * @param settings Settings to delet
	 */
	public async deleteSettings(settings: NotificationsSettingsData) {
		NotificationsSettingsDB._checkInitDone(this);

		return this._db(this._tableName)
			.where(
				NotificationsSettingsDB._getSelect(
					settings
				)
			)
			.delete();
	}

	private static _getSelect(obj: NotificationsSettingsData) {
		const {
			guildId,
			alternativeChannel,
			platform,
			streamerId
		} = obj;

		return { guildId, alternativeChannel, platform, streamerId };
	}

	private static _checkInitDone(dbController: NotificationsSettingsDB) {
		if (!INIT_MAP.has(dbController)) {
			throw new Error("DB controller must be initialized first");
		}

		return true;
	}
}

type OptionalSettings = Promise<NotificationsSettingsData | undefined>;

export default NotificationsSettingsDB;
