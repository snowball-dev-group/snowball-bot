import NotificationsSettingsDB from "./NotificationsSettingsDB";
import { NotificationsSettingsData, fulfillmentCheck } from "./NotificationsSettingsData";
import SharedSubscriptionData from "../Subscriptions/SubscriptionData";
import SubscriptionBasedController from "../SubscriptionBasedController";

type P = NotificationsSettingsDB;
type D = NotificationsSettingsData;

export class NotificationsSettingsController extends SubscriptionBasedController<P, D> {
	constructor(subscription: SharedSubscriptionData, parent: NotificationsSettingsDB) {
		super(subscription, parent);
	}

	public async fetch() {
		const currentData = this._data;

		const availableData = await this._getData();

		if (!availableData) { return false; }

		this._data = {
			...currentData,
			...availableData
		};

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
		}

		return true;
	}

	public fulfillmentCheck() {
		return fulfillmentCheck(this._data);
	}

	protected async _getData() {
		return this._parent.getSettings(
			this._subscription
		);
	}

	/**
	 * Gets text to use in messages when notification is being sent
	 */
	public getMessageText() : OptionalString {
		return this._data.messageText;
	}

	/**
	 * Sest text used in messages when notification is being sent
	 * @param text Text to use in messages
	 */
	public setMessageText(text: OptionalString) {
		if (text && text.length === 0) {
			throw new Error("Empty text");
		}

		this._data.messageText = text;
	}

	/**
	 * Sets the platform data
	 * @param data Platform data
	 */
	public setPlatformData(data: OptionalString) {
		this._data.platformData = data;
	}

	/**
	 * The platform data
	 */
	public getMessageData() : OptionalString {
		return this._data.platformData;
	}
}

type OptionalString = string | null | undefined;

export default NotificationsSettingsController;
