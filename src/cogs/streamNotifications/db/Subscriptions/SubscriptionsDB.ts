import * as db from "@utils/db";
import BaseDBManager from "../BaseDBManager";
import { SubscriptionData, addSubscriptionColumns, getSelection } from "./SubscriptionData";

//  Subscriptions

//   Subscription modification
//    - [x] createSubscription
//    - [x] updateSubscription
//    - [x] deleteSubscription

//   Searching subscriptions:
//    - [ ] findSubscriptionsByFilter
//    - [ ] findSubscription

const INIT_MAP = new WeakMap<SubscriptionsDB, boolean>();

function checkInitDone(instance: SubscriptionsDB) {
	if (!INIT_MAP.has(instance)) {
		throw new Error("DB controller must be initialized first");
	}
}

export class SubscriptionsDB {
	private readonly _tableName: string;
	private readonly _db = db.getDB();

	constructor(tableName: string) {
		if (!tableName) {
			throw new Error("No table name specified");
		}

		this._tableName = tableName;
	}

	public async init() {
		BaseDBManager.createTableIfNotExists(
			this._tableName,
			(tb) => {
				addSubscriptionColumns(tb);
			}
		);

		INIT_MAP.set(this, true);
	}

	public async getSubscription(subscription: SubscriptionData) : OptionalSubscription {
		checkInitDone(this);

		return this._db(this._tableName)
			.where(getSelection(subscription))
			.first();
	}

	public async updateSubscription(data: SubscriptionData) {
		checkInitDone(this);

		return this._db(this._tableName)
			.where(getSelection(data))
			.update(data);
	}

	public async deleteSubscription(data: SubscriptionData) {
		checkInitDone(this);

		return this._db(this._tableName)
			.where(getSelection(data))
			.delete();
	}
}

type OptionalSubscription = Promise<SubscriptionData | null>;

export default SubscriptionsDB;
