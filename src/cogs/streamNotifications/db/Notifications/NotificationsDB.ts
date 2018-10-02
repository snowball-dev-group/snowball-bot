import BaseDBManager from "../BaseDBManager";
import { SharedSubscriptionData, addSharedSubscriptionColumns, getSelection } from "../Subscriptions/SubscriptionData";
import { NotificationData, addNotificationColumns } from "./NotificationData";
import * as db from "@utils/db";

//  Notifications

//   Notification modification
//    - [x] saveNotification
//    - [x] updateNotification
//    - [x] deleteNotification

//   Searching notifications
//    - [ ] getAllNotifications
//    - [ ] findNotification

const INIT_MAP = new WeakMap<NotificationsDB, boolean>();

export class NotificationsDB {
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
				addNotificationColumns(tb);
			}
		);

		INIT_MAP.set(this, true);
	}

	/**
	 * Gets a notification for the stream
	 * @param subscription Subscription details
	 * @param streamId Stream ID if mandatory
	 */
	public async getNotification(subscription: SharedSubscriptionData, streamId?: string) : Notification {
		NotificationsDB._checkInitDone(this);

		return this._db(this._tableName)
			.where(subscription)
			.where({ streamId })
			.first();
	}

	/**
	 * Creates the notification in the database
	 * @param data Notification data
	 */
	public async saveNotification(data: NotificationData) : Promise<void> {
		NotificationsDB._checkInitDone(this);

		return this._db(this._tableName)
			.insert(data);
	}

	/**
	 * Updates the notification
	 * @param data Notification data
	 * @param oldStreamId Old Stream ID if mandatory
	 */
	public async updateNotification(data: NotificationData, oldStreamId?: string) {
		NotificationsDB._checkInitDone(this);

		return this._db(this._tableName)
			.where(getSelection(data))
			.where({ streamId: oldStreamId })
			.update(data);
	}

	/**
	 * Deletes the notification
	 * @param data Notification data
	 */
	public async deleteNotification(data: NotificationData) {
		NotificationsDB._checkInitDone(this);

		return this._db(this._tableName)
			.where(data)
			.delete();
	}

	private static _checkInitDone(dbController: NotificationsDB) {
		if (!INIT_MAP.has(dbController)) {
			throw new Error("DB controller must be initialized first");
		}
	}
}

type Notification = Promise<NotificationData | undefined>;

export default NotificationsDB;
