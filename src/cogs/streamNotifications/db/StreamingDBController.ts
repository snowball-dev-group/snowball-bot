import NotificationsDB from "./Notifications/NotificationsDB";
import NotificationsSettingsDB from "./Settings/NotificationsSettingsDB";
import SubscriptionsDB from "./Subscriptions/SubscriptionsDB";
import SharedSubscriptionData from "./Subscriptions/SubscriptionData";
import NotificationsSettingsController from "./Settings/NotificationsSettingsController";
import NotificationController from "./Notifications/NotificationController";
import { GuildSettingsController } from "./GuildSettings/GuildSettingsController";
import { GuildSettingsDB } from "./GuildSettings/GuildSettingsDB";
import { INullableHashMap } from "@sb-types/Types";

const INIT_MAP = new WeakMap<StreamingDBController, boolean>();

type GuildSettingsActuals = INullableHashMap<GuildSettingsController>;
type NotificationsSettingsActuals = INullableHashMap<NotificationsSettingsController>;
type NotificationsActuals = INullableHashMap<NotificationController>;

const ACTUALS_GUILD_SETTINGS: GuildSettingsActuals = Object.create(null);
const ACTUALS_NOTIFICATIONS_SETTINGS: NotificationsSettingsActuals = Object.create(null);
const ACTUALS_NOTIFICATIONS: NotificationsActuals = Object.create(null);

export class StreamingDBController {
	public readonly notifications: NotificationsDB;
	public readonly settings: NotificationsSettingsDB;
	public readonly subscriptions: SubscriptionsDB;
	public readonly guildSettings: GuildSettingsDB;

	/**
	 * Controls all the tables at once
	 * @param baseName Base name for the tables
	 */
	constructor(baseName: string) {
		this.notifications = new NotificationsDB(`${baseName}_notifications`);
		this.settings = new NotificationsSettingsDB(`${baseName}_settings`);
		this.subscriptions = new SubscriptionsDB(`${baseName}_subscriptions`);
		this.guildSettings = new GuildSettingsDB(`${baseName}_guild-settings`);
	}

	public async init() {
		if (INIT_MAP.has(this)) {
			throw new Error("Controller is already initalized");
		}

		INIT_MAP.set(this, true);
	}

	// #region Settings

	private _notificationsSettingsController(subscription: SharedSubscriptionData) {
		const lookup = StreamingDBController._squashSubscription(
			subscription
		);

		const actual = ACTUALS_NOTIFICATIONS_SETTINGS[lookup];

		if (actual) {
			return actual;
		}

		return ACTUALS_NOTIFICATIONS_SETTINGS[lookup] =
			new NotificationsSettingsController(
				subscription,
				this.settings
			);
	}

	public async getSettingsController(subscription: SharedSubscriptionData) {
		const controller = this._notificationsSettingsController(
			subscription
		);

		await controller.fetch();

		return controller;
	}

	// #endregion

	// #region Notifications

	private _notificationsController(subscription: SharedSubscriptionData) {
		const lookup = StreamingDBController._squashSubscription(
			subscription
		);

		const actual = ACTUALS_NOTIFICATIONS[lookup];

		if (actual) {
			return actual;
		}

		return ACTUALS_NOTIFICATIONS[lookup] =
			new NotificationController(
				subscription,
				this.notifications
			);
	}

	public async getNotificationController(subscription: SharedSubscriptionData) {
		const controller = this._notificationsController(subscription);

		await controller.fetch();

		return controller;
	}

	// #endregion

	// #region Guild Settings

	private _guildSettingsController(guildId: string) {
		const actual = ACTUALS_GUILD_SETTINGS[guildId];

		if (actual) {
			return actual;
		}

		return ACTUALS_GUILD_SETTINGS[guildId] =
			new GuildSettingsController(
				guildId,
				this.guildSettings
			);
	}

	public async getGuildController(guildId: string) {
		const controller = this._guildSettingsController(guildId);

		await controller.fetch();

		return controller;
	}

	// #endregion

	private static _squashSubscription(subscription: SharedSubscriptionData) {
		let squashed = "";

		squashed += `${subscription.platform}-`;
		squashed += `${subscription.streamerId}::`;

		squashed += `${subscription.guildId}`;

		if (subscription.alternativeChannel) {
			squashed += `-${subscription.alternativeChannel}`;
		}

		return squashed;
	}
}

export default StreamingDBController;
