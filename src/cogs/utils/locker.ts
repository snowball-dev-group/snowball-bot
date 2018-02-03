import { INullableHashMap } from "../../types/Types";
import { Guild, GuildChannel } from "discord.js";
import { EventEmitter } from "events";
import { isPromise } from "./extensions";

type PossibleTargets = string | Guild | GuildChannel;
type EmptyVoid = () => void;

/**
 * # Discord Locker
 * 
 * Creates special class to lock and unlock some target.
 * 
 * ## Features:
 * 
 * - Can lock and unlock of course! 👌
 * - Calls any callback using process.nextTick (is this even a feature?)
 * - Has lock function that returns Promise that resolves with result of onLock function
 * - Has function to await for unlock and alias function to create Promise for this function
 * 
 * ## To note
 * 
 * Use semaphore if you could do changes at the same time or want to build queues.
 */
export default class DiscordLocker {
	private readonly _lockStates: INullableHashMap<boolean>;
	private readonly _dispatcher: EventEmitter;

	/**
	 * __Creates new locker__.
	 * Use it where changing of some resource at the same time is impossible
	 */
	constructor() {
		this._lockStates = Object.create(null);
		this._dispatcher = new EventEmitter();
	}

	/**
	 * Locks resource for selected target
	 * @param targetId Target of where resource lock happens
	 * @param onLock Callback function if lock happened
	 * @param lockFailed Callback function if lock failed
	 * @returns `true` if lock happened, otherwise `false`
	 */
	public lock(targetId: PossibleTargets, onLock: (unlock: EmptyVoid) => void, lockFailed?: EmptyVoid) {
		if(typeof targetId !== "string") { targetId = this._normalizeTarget(targetId); }
		if(this._lockStates[targetId]) {
			lockFailed && process.nextTick(lockFailed);
			return false;
		}
		this._lockStates[targetId] = true;
		process.nextTick(() => onLock(this._createSingletimeUnlocker(<string> targetId)));
		return true;
	}

	/**
	 * __Locks resource and returns promise__, which resolves once onLock function is executed
	 * @param targetId Target of where resource lock happens
	 * @param onLock Callback function if lock happened
	 * @param lockFailed Callback function if lock failed
	 * @returns Promise, which resolves with result of onLock function once unlock happens and rejects if lock failed
	 */
	public lockAwait<T = void>(targetId: PossibleTargets, onLock: (unlock: EmptyVoid) => T, lockFailed?: EmptyVoid) : Promise<T> {
		if(typeof targetId !== "string") { targetId = this._normalizeTarget(targetId); }
		return new Promise((res, rej) => {
			const isLocked = this.lock(targetId, async (unlock) => {
				const onLockResult = onLock(unlock);
				return isPromise<T>(onLockResult) ? res(await onLockResult) : res(onLockResult);
			}, lockFailed);

			if(!isLocked) {
				// `lock` always returns `false` if already locked
				return rej({
					code: "LOCK_IN_EFFECT",
					message: "The lock is already in effect"
				});
			}
		});
	}

	/**
	 * Waits till resource is unlocked and then calls special function (aka callback)
	 * @param targetId Target of where lock happened
	 * @param onUnlock Callback function if resource is not locked or was unlocked
	 * @param args Arguments to pass to callback function
	 */
	public waitForUnlock<T>(targetId: PossibleTargets, onUnlock: (...args: T[]) => void, ...args: T[]) {
		if(typeof targetId !== "string") { targetId = this._normalizeTarget(targetId); }
		if(!this._lockStates[targetId]) { return process.nextTick(onUnlock, ...args); }
		this._dispatcher.once(`${targetId}:unlock`, () => process.nextTick(onUnlock, ...args));
	}

	/**
	 * __Creates Promise, which resolves when resource is unlocked__.
	 * Use `waitForUnlock` instead if you don't need Promise
	 * @param targetId Target of where lock happened
	 * @param value Value to resolve Promise with
	 * @returns Promise, which resolves when resource is unlocked
	 */
	public awaitForUnlock<T>(targetId: PossibleTargets, value?: T) {
		return new Promise((res) => this.waitForUnlock(targetId, res, value));
	}

	/**
	 * Unlocks resource for selected target
	 * @param targetId Target of where lock in effect
	 * @returns `true` if unlock happened, otherwise `false`
	 */
	public unlock(targetId: PossibleTargets) {
		if(typeof targetId !== "string") { targetId = this._normalizeTarget(targetId); }
		if(!this._lockStates[targetId]) { return false; }
		this._lockStates[targetId] = false;
		this._dispatcher.emit(`${targetId}:unlock`);
		return true;
	}

	private _createSingletimeUnlocker(targetId: string) {
		let isUsed = false;
		return () => {
			if(isUsed) { throw new Error("This target is already unlocked"); }
			return (isUsed = true) && this.unlock(targetId);
		};
	}

	private _normalizeTarget(target: PossibleTargets) {
		if(target instanceof Guild) {
			return `g[${target.id}]`;
		} else if(target instanceof GuildChannel) {
			return `${target.type}[${target.id}]`;
		}
		return target;
	}
}
