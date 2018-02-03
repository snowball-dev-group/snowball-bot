import { INullableHashMap } from "../../types/Types";
import { Guild, TextChannel, DMChannel, GroupDMChannel } from "discord.js";
import { isPromise } from "./extensions";

export const DEFAULT_CAPACITY = 1;

type IQueueItem = (leave: () => number) => void;
type PossibleTargets = string | Guild | TextChannel | DMChannel | GroupDMChannel;

export default class DiscordSemaphore {
	private readonly _queue: INullableHashMap<IQueueItem[]> = Object.create(null);
	private readonly _currentWorkers: INullableHashMap<number> = Object.create(null);
	private readonly _capacity: number;

	/**
	 * Creates new semaphore for your 'track'
	 * @param capacity Capacity of 'track' after which other task should wait in queue
	 */
	constructor(capacity = DEFAULT_CAPACITY) {
		this._capacity = Math.max(1, capacity);
	}

	/**
	 * Checks if 'track' for selected target is free
	 * @param targetId Selected target
	 * @returns `true` if number of active workers is equal to zero, otherwise false
	 */
	public isFree(targetId: PossibleTargets) {
		targetId = this._normalizeTarget(targetId);
		return this._getWorkersCount(targetId) === 0;
	}

	/**
	 * Checks number of remaining tasks in the queue of selected target
	 * @param targetId Selected target
	 * @returns Number of remaining tasks in the queue
	 */
	public queueSize(targetId: PossibleTargets) {
		targetId = this._normalizeTarget(targetId);
		return this._getQueue(targetId).length;
	}

	/**
	 * Pushes function to the queue
	 * @param targetId Selected target
	 * @param task Task to run
	 */
	public take(targetId: PossibleTargets, task: IQueueItem) {
		targetId = this._normalizeTarget(targetId);

		const queue = this._getQueue(targetId);

		queue.push(task);

		process.nextTick(() => this._proceedQueue(<string> targetId));
	}

	/**
	 * __Pushes special function to the queue__, which resolves promise once task is done.
	 * This is preferable option if you want to get returned result of your task
	 * @param targetId Selected target
	 * @param task Task to run
	 * @returns Promise which resolves with number of remaining workers and returned result. Rejects if task returned an error
	 */
	public takeAsync<T = void>(targetId: PossibleTargets, task: () => T | Promise<T>): Promise<[number, T]> {
		return new Promise((res, rej) => {
			this.take(targetId, async (leaver) => {
				try {
					let taskResult: any = task();
					isPromise(taskResult) && (taskResult = await taskResult);
					return res([leaver(), taskResult]);
				} catch(err) {
					return rej(err);
				}
			});
		});
	}

	/**
	 * __Decrease number of workers by one__.
	 * Is is strongly unrecommended to use this function:
	 * instead use single use leaver function in callback
	 * @param targetId Discord Guild ID
	 * @returns Number of remaining workers
	 */
	public leave(targetId: string) {
		const workersRemaining = this._incrementWorkersCount(targetId, true); // decrement
		process.nextTick(() => this._proceedQueue(targetId));
		return workersRemaining; // useful data I guess
	}

	private _normalizeTarget(target: PossibleTargets) {
		if(typeof target === "string") { return target; }
		if(target instanceof Guild) { return `g[${target.id}]`; }
		return `${target.type}[${target.id}]`;
	}

	private _getQueue(targetId: string) {
		return this._queue[targetId] || (this._queue[targetId] = []);
	}

	private _getWorkersCount(targetId: string) {
		const workersCount = this._currentWorkers[targetId];
		if(workersCount == null) { return this._currentWorkers[targetId] = 0; }
		return workersCount;
	}

	private _incrementWorkersCount(targetId: string, invert = false) {
		let currentWorkers = this._currentWorkers[targetId] || 0;
		if(invert) {
			if(currentWorkers === 0) { return currentWorkers; } // can go lower than 0
			return this._currentWorkers[targetId] = currentWorkers--;
		}
		return this._currentWorkers[targetId] = currentWorkers++;
	}

	private _createSingleuseLeaver(targetId: string) {
		let isUsed = false;
		return () => {
			// anti-smartness: storing usage and throwing an error if used
			if(isUsed) { throw new Error("You already marked that this worker stopped working"); }
			return (isUsed = true) && this.leave(targetId);
		};
	}

	private _proceedQueue(targetId: string) {
		const activeWorkers = this._getWorkersCount(targetId);

		// are we working or overworking?
		if(activeWorkers >= this._capacity) { return; }

		const queue = this._getQueue(targetId);

		const runner = queue.shift();

		// do we need to run it?
		if(typeof runner !== "function") { return; }

		this._incrementWorkersCount(targetId);

		// kinda async?
		process.nextTick(() => runner(this._createSingleuseLeaver(targetId)));
	}
}
