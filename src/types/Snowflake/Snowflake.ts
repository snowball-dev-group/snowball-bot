import { sleep } from "@utils/utils";

// tslint:disable-next-line:no-var-requires
const bin2dec = require("@sb-types/Snowflake/binaryToDec.x.js");

interface IFlakeIdOptions {
	machineId?: number;
	processId?: number;
	timeOffset?: number;
}

/**
 * @license MIT Copyright (c) 2013 Sudhanshu Yadav
 * @see https://github.com/s-yadav/FlakeId
 */
export class FlakeId {
	private readonly _machineId: string;
	private readonly _timeOffset: number;
	private _seq: number;
	private _lastTime: number;

	constructor(opts?: IFlakeIdOptions) {
		const options = {
			machineId: 0,
			timeOffset: 0,
			processId: 1,
			...opts
		};

		this._seq = 0;

		let machineId = "";

		if (options.machineId) {
			if (options.machineId > 31) {
				throw new Error("`machineId` cannot be higher than 31");
			}
		} else {
			options.machineId = 0;
		}

		if (options.processId) {
			if (options.processId > 31) {
				throw new Error("`processId` cannot be higher than 31");
			}
		} else {
			options.processId = 1;
		}

		machineId += options.machineId.toString(2).padStart(5, "0");
		machineId += ((options.machineId || 1) % 31).toString(2).padStart(5, "0");

		this._machineId = machineId;

		this._timeOffset = options.timeOffset || 0;
		this._lastTime = 0;
	}

	public async generate() {
		const time = Date.now();

		// get the sequence number
		if (this._lastTime === time) {
			this._seq++;

			if (this._seq > 4095) {
				this._seq = 0;

				// make system wait till time is been shifted by one millisecond
				// tslint:disable-next-line:no-empty
				await sleep(Date.now() - time);
			}
		} else {
			this._seq = 0;
		}

		this._lastTime = time;

		const timestamp = (time - this._timeOffset)
			.toString(2)
			.padStart(42, "0");

		const increment = this._seq
			.toString(2)
			.padStart(12, "0");

		const machineId = this._machineId;

		const binary = `${timestamp}${machineId}${increment}`;

		return bin2dec(binary);
	}
}

export default FlakeId;
