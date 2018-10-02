import SharedSubscriptionData from "./Subscriptions/SubscriptionData";

const CREATE_STATES = new WeakMap<BaseController<any, any>, boolean>();

export abstract class BaseController<P, D> {
	protected readonly _parent: P;
	protected _data: Partial<D>;

	constructor(parent: P) {
		this._parent = parent;
		this._data = Object.create(null);
	}

	/**
	 * Fetches data from the database, it's the first thing you must do
	 * 
	 * Wasn't data posted to DB before fetch, it will override the current data
	 */
	public abstract async fetch() : Promise<boolean>;

	/**
	 * Posts data to the database
	 */
	public abstract async post() : Promise<boolean>;

	/**
	 * Gets data from the database
	 */
	protected abstract _getData() : Promise<D | undefined>;

	/**
	 * Checks if the current data meets the requirements to be posted
	 * 
	 * If data didn't meet this requirements it cannot be posted
	 * 
	 * @throws 
	 */
	public abstract fulfillmentCheck() : boolean;

	protected _markCreated(state: boolean) {
		CREATE_STATES.set(this, state);
	}

	public isCreated() {
		const fetchState = CREATE_STATES.get(this);

		if (fetchState == null) {
			return false;
		}

		return fetchState;
	}
}

export abstract class SubscriptionBasedController<P, D> extends BaseController<P, D> {
	protected readonly _subscription: SharedSubscriptionData;

	constructor(subscription: SharedSubscriptionData, parent: P) {
		super(parent);

		this._subscription = subscription;
	}
}

export class MissingPropertyError<T> extends Error {
	private readonly _prop: keyof T;

	public get property() {
		return this._prop;
	}

	constructor(missedProp: keyof T) {
		super(`The data is missing "${missedProp}"`);
		this._prop = missedProp;
	}
}

export class ValueError<T> extends Error {
	private readonly _prop: keyof T;

	public get property() {
		return this._prop;
	}

	constructor(prop: keyof T, reason: string) {
		super(`The data has invalid type for "${prop}": ${reason}`);
		this._prop = prop;
	}
}

export default SubscriptionBasedController;
