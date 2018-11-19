import SharedSubscriptionData from "../Subscriptions/SubscriptionData";
import NotificationsDB from "./NotificationsDB";
import { NotificationData, fulfillmentCheck } from "./NotificationData";
import SubscriptionBasedController from "../SubscriptionBasedController";

type D = NotificationData;
type P = NotificationsDB;

export class NotificationController extends SubscriptionBasedController<P, D> {
	constructor(subscription: SharedSubscriptionData, parent: NotificationsDB) {
		super(subscription, parent);
	}

	private _oldStreamId?: string;

	public async fetch() {
		const currentData = this._data;

		const availableData = await this._getData();

		if (!availableData) { return false; }

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
			await this._parent.updateNotification(
				data,
				this._oldStreamId
			);

			this._oldStreamId = undefined;
		} else {
			await this._parent.saveNotification(data);

			this._markCreated(true);
		}

		return true;
	}

	public getMessageId() {
		// ideally it never should be null
		// TODO: check if `messageId` is not null
		return this._data.messageId;
	}

	public setMessageId(value: string) {
		const currentMessageId = this._data.messageId;

		if (currentMessageId && this.isCreated()) {
			throw new Error("Cannot set message ID when it is already set");
		}

		// We cannot use spread because it will make default object
		// with such things such as `toString` that we don't really need

		// tslint:disable-next-line:prefer-object-spread
		this._data = Object.assign(
			this._data, {
				messageId: value
			}
		);

		return this;
	}

	public getStreamId() {
		return this._data.streamerId;
	}

	public setStreamId(value: string) {
		if (this.isCreated()) {
			const currentStreamId = this._data.streamId;

			if (currentStreamId && !this._oldStreamId) {
				this._oldStreamId = currentStreamId;
			}
		}

		this._data.streamId = value;

		return this;
	}

	public getPayload() {
		return this._data.platformPayload;
	}

	public setPayload(value: string) {
		this._data.platformPayload = value;

		return this;
	}

	protected async _getData() {
		return this._parent.getNotification(
			this._subscription
		);
	}

	public fulfillmentCheck() {
		return fulfillmentCheck(this._data);
	}
}

export default NotificationController;
